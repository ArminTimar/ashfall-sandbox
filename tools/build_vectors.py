#!/usr/bin/env python3
"""Build data/vectors.json for all of Kyushu from OpenStreetMap and GeoNames.

Fetches roads, railways, prefecture borders and settlements, clips them to the
map rectangle in data/terrain.json and projects them into JGD2011 / Japan Plane
Rectangular CS II (EPSG:6670). Coordinates are written in kilometres of that
system, rounded to 10 m.

Layers:

    major     motorway, trunk and primary roads
    minor     secondary roads (the app shows them only when zoomed in)
    rail      passenger railways
    boundary  prefecture borders on land (coastlines are left out, the
              terrain already draws them)

Settlements come in three tiers:

    1  cities of 100,000 people or more      OpenStreetMap place=city
    2  other cities, towns and villages      OpenStreetMap place=city|town|village
    3  districts and smaller towns           OpenStreetMap place=suburb with an
                                             English name, plus GeoNames
                                             populated places with a recorded
                                             population

Japanese municipalities were merged heavily in the 2000s, so many towns people
still know by name are not tagged as places in OpenStreetMap. GeoNames fills
some of that gap. Its coordinates are rougher, so a GeoNames place is only used
when nothing from OpenStreetMap lies within 2.5 km of it and it isn't a copy of
a nearby municipality.

Lines, borders and tiers 1 to 3 from OpenStreetMap, (c) OpenStreetMap
contributors, ODbL 1.0. Tier 3 additions from GeoNames, CC BY 4.0. Both need
attribution wherever the map is shown.

Overpass is queried in pieces so no single request times out, and every answer
is cached in tools/.cache/, so a rebuild after the first one is quick. Delete
tools/.cache/overpass-*.json to download fresh data.

    python3 tools/build_vectors.py
"""

import hashlib
import io
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
import proj  # noqa: E402

with open("data/terrain.json", encoding="utf-8") as f:
    GRID = json.load(f)
XW, XE = GRID["west"] / 1000, GRID["east"] / 1000
YS, YN = GRID["south"] / 1000, GRID["north"] / 1000

SIMPLIFY_KM = 0.06      # Douglas-Peucker tolerance, under a third of a 200 m cell
PRECISION = 2           # decimal places on km, i.e. 10 m
OUT = "data/vectors.json"
PIECES = 4              # Overpass bounding boxes per side

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

GEONAMES_URL = "https://download.geonames.org/export/dump/JP.zip"
GEONAMES_CACHE = "tools/.cache/geonames-JP.zip"
BIG_CITY = 100000       # population for tier 1
DEDUPE_KM = 2.5


def lonlat_box():
    """South, west, north, east in degrees, enclosing the projected rectangle."""
    pts = [proj.to_lonlat(e * 1000, n * 1000)
           for e in (XW, XE) for n in (YS, YN)]
    lons = [p[0] for p in pts]
    lats = [p[1] for p in pts]
    return min(lats) - 0.02, min(lons) - 0.02, max(lats) + 0.02, max(lons) + 0.02


def pieces():
    s, w, n, e = lonlat_box()
    for i in range(PIECES):
        for j in range(PIECES):
            yield (s + (n - s) * i / PIECES, w + (e - w) * j / PIECES,
                   s + (n - s) * (i + 1) / PIECES, w + (e - w) * (j + 1) / PIECES)


def lines_query(b):
    bb = ",".join(f"{v:.5f}" for v in b)
    return f"""
[out:json][timeout:240];
(
  way["highway"~"^(motorway|trunk|primary|secondary)$"]({bb});
  way["railway"="rail"]["railway:traffic_mode"!="freight"]
     ["usage"!="industrial"]["service"!~"."]({bb});
);
out tags geom;
"""


def borders_query():
    s, w, n, e = lonlat_box()
    bb = f"{s:.5f},{w:.5f},{n:.5f},{e:.5f}"
    return f"""
[out:json][timeout:240];
relation["boundary"="administrative"]["admin_level"="4"]({bb});
out geom;
"""


def places_query():
    s, w, n, e = lonlat_box()
    bb = f"{s:.5f},{w:.5f},{n:.5f},{e:.5f}"
    return f"""
[out:json][timeout:180];
node["place"~"^(city|town|village|suburb)$"]({bb});
out;
"""


def fetch(q):
    """Run an Overpass query, reusing the answer cached from an earlier run."""
    key = hashlib.sha1(q.encode()).hexdigest()[:12]
    cache = f"tools/.cache/overpass-{key}.json"
    if os.path.exists(cache):
        with open(cache, encoding="utf-8") as f:
            return json.load(f)
    res = fetch_live(q)
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    with open(cache, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False)
    return res


def fetch_live(q):
    data = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for attempt in range(6):
        for url in ENDPOINTS:
            try:
                req = urllib.request.Request(
                    url, data=data,
                    headers={"User-Agent": "ashfall-sandbox (+https://github.com/ArminTimar/ashfall-sandbox)"})
                with urllib.request.urlopen(req, timeout=300) as r:
                    return json.loads(r.read().decode())
            except Exception as exc:                      # noqa: BLE001
                last = f"{url}: {exc}"
                print(f"  {last}")
        wait = 10 * (attempt + 1)
        print(f"  retrying in {wait}s")
        time.sleep(wait)
    raise SystemExit(f"Overpass unavailable, last error: {last}")


def to_km(lon, lat):
    e, n = proj.to_en(lon, lat)
    return e / 1000, n / 1000


def inside(x, y):
    return XW <= x <= XE and YS <= y <= YN


def clip_segment(p, q):
    """Liang-Barsky against the map rectangle. None if wholly outside."""
    x0, y0 = p
    x1, y1 = q
    dx, dy = x1 - x0, y1 - y0
    t0, t1 = 0.0, 1.0
    for num, den in ((x0 - XW, -dx), (XE - x0, dx), (y0 - YS, -dy), (YN - y0, dy)):
        if den == 0:
            if num < 0:
                return None
            continue
        t = num / den
        if den < 0:
            if t > t1:
                return None
            t0 = max(t0, t)
        else:
            if t < t0:
                return None
            t1 = min(t1, t)
    if t0 > t1:
        return None
    return ((x0 + t0 * dx, y0 + t0 * dy), (x0 + t1 * dx, y0 + t1 * dy))


def clip_polyline(pts):
    """Split a polyline into the runs that fall inside the rectangle."""
    runs, run = [], []
    for a, b in zip(pts, pts[1:]):
        c = clip_segment(a, b)
        if c is None:
            if len(run) > 1:
                runs.append(run)
            run = []
            continue
        ca, cb = c
        if run and abs(run[-1][0] - ca[0]) < 1e-9 and abs(run[-1][1] - ca[1]) < 1e-9:
            run.append(cb)
        else:
            if len(run) > 1:
                runs.append(run)
            run = [ca, cb]
    if len(run) > 1:
        runs.append(run)
    return runs


def simplify(pts, tol):
    """Douglas-Peucker, iterative so long ways cannot blow the stack."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        ax, ay = pts[i]
        bx, by = pts[j]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        best, bi = -1.0, -1
        for k in range(i + 1, j):
            px, py = pts[k]
            if norm == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
            if d > best:
                best, bi = d, k
        if best > tol:
            keep[bi] = True
            stack.append((i, bi))
            stack.append((bi, j))
    return [p for p, k in zip(pts, keep) if k]


def prepare(ways, tol=SIMPLIFY_KM):
    """Project, clip, simplify and round a list of lon/lat point lists."""
    out = []
    for pts in ways:
        km = [to_km(p["lon"], p["lat"]) for p in pts]
        for run in clip_polyline(km):
            s = simplify(run, tol)
            if len(s) > 1:
                out.append([[round(x, PRECISION), round(y, PRECISION)] for x, y in s])
    return out


def geonames_rows():
    """Populated places from the GeoNames Japan dump, cached after one download."""
    if not os.path.exists(GEONAMES_CACHE):
        print(f"downloading {GEONAMES_URL} (about 5 MB) …")
        os.makedirs(os.path.dirname(GEONAMES_CACHE), exist_ok=True)
        req = urllib.request.Request(GEONAMES_URL, headers={"User-Agent": "ashfall-sandbox"})
        with urllib.request.urlopen(req, timeout=900) as r:
            data = r.read()
        with open(GEONAMES_CACHE, "wb") as f:
            f.write(data)
    with zipfile.ZipFile(GEONAMES_CACHE) as z:
        for line in io.TextIOWrapper(z.open("JP.txt"), encoding="utf-8"):
            f = line.rstrip("\n").split("\t")
            # PPL and the seat codes only. PPLL "localities" carry placeholder
            # populations, and PPLX are sections of a town.
            if f[6] != "P" or not f[7].startswith("PPL") or f[7] in ("PPLL", "PPLX") \
                    or not f[14] or int(f[14]) <= 0:
                continue
            yield f[1], float(f[5]), float(f[4]), int(f[14]), f[7]


def tidy_geonames(name):
    """'Sueyoshichō-ninokata' -> 'Sueyoshi', 'Kokubu-matsuki' -> 'Kokubu'."""
    head = name.split("-")[0]
    for suffix in ("chō", "machi", "mura"):
        if head.endswith(suffix) and len(head) > len(suffix) + 2:
            head = head[: -len(suffix)]
    return head


def build_places(els):
    """Three tiers of settlement labels, deduplicated by distance and name."""
    out = []

    def near(x, y, km=DEDUPE_KM):
        return any(math.hypot(x - p["x"], y - p["y"]) < km for p in out)

    osm = []
    for el in els:
        t = el.get("tags", {})
        x, y = to_km(el["lon"], el["lat"])
        name = t.get("name:en")
        if not name or not inside(x, y):
            continue
        kind = t.get("place")
        pop = int(t["population"]) if t.get("population", "").isdigit() else 0
        if kind == "city" and pop >= BIG_CITY:
            tier = 1
        elif kind in ("city", "town", "village"):
            tier = 2
        else:
            tier = 3
        osm.append((tier, -pop, name, x, y, pop))
    osm.sort()
    for tier, _, name, x, y, pop in osm:
        # A district on top of its own city, or sharing a name with a place
        # already in, adds nothing.
        if tier == 3 and (near(x, y) or any(p["n"] == name for p in out)):
            continue
        if tier < 3 and any(p["n"] == name and math.hypot(x - p["x"], y - p["y"]) < 10 for p in out):
            continue
        out.append({"n": name, "x": round(x, 2), "y": round(y, 2), "tier": tier, "pop": pop})

    extra = 0
    for name, lon, lat, pop, code in sorted(geonames_rows(), key=lambda r: -r[3]):
        x, y = to_km(lon, lat)
        label = tidy_geonames(name)
        # Very short heads ("Ko" from "Ko-...") are fragments, not town names.
        if not inside(x, y) or near(x, y) or len(label) < 3:
            continue
        # Municipal seats are already in from OpenStreetMap at better
        # positions. GeoNames marks some as seats (PPLA*). Others give
        # themselves away by carrying the population of the whole municipality
        # they sit in.
        if code.startswith("PPLA") or any(p["n"] == label for p in out):
            continue
        if any(p["pop"] and abs(pop - p["pop"]) <= 0.05 * p["pop"]
               and math.hypot(x - p["x"], y - p["y"]) < 15 for p in out):
            continue
        out.append({"n": label, "x": round(x, 2), "y": round(y, 2),
                    "tier": 3, "pop": pop, "src": "geonames"})
        extra += 1
    print(f"  places: {len(out)} ({extra} from GeoNames)")
    return out


def land_borders(els):
    """Prefecture border ways shared by two prefectures, so no coastlines."""
    count, geom = {}, {}
    for el in els:
        if el.get("type") != "relation":
            continue
        for m in el.get("members", []):
            if m.get("type") == "way" and m.get("geometry") and m.get("role") in ("outer", ""):
                count[m["ref"]] = count.get(m["ref"], 0) + 1
                geom[m["ref"]] = m["geometry"]
    return [geom[k] for k, c in count.items() if c >= 2]


def main():
    proj.self_check()
    s, w, n, e = lonlat_box()
    print(f"map {XW:.1f}..{XE:.1f} E km, {YS:.1f}..{YN:.1f} N km (EPSG:{proj.EPSG})")
    print(f"lon/lat box {s:.3f},{w:.3f} .. {n:.3f},{e:.3f}")

    seen = set()
    major, minor, rail = [], [], []
    for k, b in enumerate(pieces()):
        print(f"querying roads and rail, piece {k + 1} of {PIECES * PIECES} …", flush=True)
        for el in fetch(lines_query(b)).get("elements", []):
            if el["id"] in seen or not el.get("geometry"):
                continue
            seen.add(el["id"])
            tags = el.get("tags", {})
            if tags.get("railway") == "rail":
                rail.append(el["geometry"])
            elif tags.get("highway") == "secondary":
                minor.append(el["geometry"])
            else:
                major.append(el["geometry"])

    print("querying prefecture borders …", flush=True)
    borders = land_borders(fetch(borders_query()).get("elements", []))
    print("querying settlements …", flush=True)
    places = build_places(fetch(places_query()).get("elements", []))

    layers = {
        "boundary": prepare(borders),
        "major": prepare(major),
        "minor": prepare(minor),
        "rail": prepare(rail),
    }
    doc = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "source": "OpenStreetMap contributors, ODbL 1.0; settlements partly GeoNames, CC BY 4.0",
        "epsg": proj.EPSG,
        "units": "km",
        "bbox_km": [XW, YS, XE, YN],
        "layers": layers,
        "places": places,
    }
    text = json.dumps(doc, separators=(",", ":"), ensure_ascii=False)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    for k, v in layers.items():
        pts = sum(len(p) for p in v)
        print(f"  {k:9s} {len(v):6d} lines {pts:8d} points")
    print(f"wrote {OUT}  {len(text.encode()) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
