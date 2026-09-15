#!/usr/bin/env python3
"""Build data/vectors.json from OpenStreetMap.

Fetches the things that make the deposit map readable as a place rather than a
contour plot — the Kagoshima city limit, the trunk road network and the
railways — clips them to the model domain, projects them into the same
vent-relative kilometre frame the physics uses and writes a compact JSON the
browser drapes over the terrain.

Data is OpenStreetMap, © OpenStreetMap contributors, ODbL 1.0. Attribution is
required wherever the rendered map is shown; see index.html and the README.

Standard library only, so it runs wherever tools/build_terrain.py does without
numpy or Pillow. Overpass is rate-limited and occasionally busy; the script
retries and fails loudly rather than writing a partial file.

    python3 tools/build_vectors.py
"""

import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# Must match js/params.js and tools/build_terrain.py.
VENT_LON, VENT_LAT = 130.6575, 31.5931
XW, XE = -21.60, 28.40
YS, YN = -18.18, 31.45

KM_LON = 111.320 * math.cos(math.radians(VENT_LAT))
KM_LAT = 110.574

SIMPLIFY_KM = 0.05      # Douglas-Peucker tolerance; a third of a 156 m grid cell
PRECISION = 2           # decimal places on km, i.e. 10 m
OUT = "data/vectors.json"

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

CITY = "鹿児島市"       # Kagoshima City


def bbox():
    """Domain corners as Overpass wants them: south, west, north, east."""
    return (VENT_LAT + YS / KM_LAT, VENT_LON + XW / KM_LON,
            VENT_LAT + YN / KM_LAT, VENT_LON + XE / KM_LON)


def query():
    s, w, n, e = bbox()
    b = f"{s:.5f},{w:.5f},{n:.5f},{e:.5f}"
    return f"""
[out:json][timeout:180];
(
  relation["boundary"="administrative"]["admin_level"="7"]["name"="{CITY}"];
)->.city;
(
  way["highway"~"^(motorway|trunk|primary)$"]({b});
)->.major;
(
  way["highway"="secondary"]({b});
)->.minor;
(
  way["railway"="rail"]["railway:traffic_mode"!="freight"]
     ["usage"!="industrial"]["service"!~"."]({b});
)->.rail;
.city out geom;
.major out geom;
.minor out geom;
.rail out geom;
"""


def fetch(q):
    data = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for attempt in range(4):
        for url in ENDPOINTS:
            try:
                req = urllib.request.Request(
                    url, data=data,
                    headers={"User-Agent": "ashfall-sandbox/0.1 (+https://github.com/ArminTimar/ashfall-sandbox)"})
                with urllib.request.urlopen(req, timeout=240) as r:
                    return json.loads(r.read().decode())
            except Exception as exc:                      # noqa: BLE001
                last = f"{url}: {exc}"
                print(f"  {last}")
        wait = 5 * (attempt + 1)
        print(f"  retrying in {wait}s")
        time.sleep(wait)
    raise SystemExit(f"Overpass unavailable, last error: {last}")


def to_km(lon, lat):
    return ((lon - VENT_LON) * KM_LON, (lat - VENT_LAT) * KM_LAT)


def clip_segment(p, q):
    """Liang-Barsky against the domain rectangle. None if wholly outside."""
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
    """Split a polyline into the runs that fall inside the domain."""
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
    """Douglas-Peucker, iterative so long coastal ways cannot blow the stack."""
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


def main():
    s, w, n, e = bbox()
    print(f"domain  {s:.4f},{w:.4f} .. {n:.4f},{e:.4f}")
    print("querying Overpass (this takes a minute) …")
    res = fetch(query())
    els = res.get("elements", [])
    print(f"  {len(els)} elements")

    boundary, major, minor, rail = [], [], [], []
    for el in els:
        if el["type"] == "relation":
            for m in el.get("members", []):
                if m.get("type") == "way" and m.get("geometry"):
                    boundary.append(m["geometry"])
            continue
        if not el.get("geometry"):
            continue
        tags = el.get("tags", {})
        if tags.get("railway") == "rail":
            rail.append(el["geometry"])
        elif tags.get("highway") == "secondary":
            minor.append(el["geometry"])
        else:
            major.append(el["geometry"])

    layers = {
        # The city limit is an outline, so it keeps a finer tolerance.
        "boundary": prepare(boundary, SIMPLIFY_KM / 2),
        "major": prepare(major),
        "minor": prepare(minor),
        "rail": prepare(rail),
    }

    doc = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "source": "OpenStreetMap contributors, ODbL 1.0",
        "city": CITY,
        "bbox_km": [XW, YS, XE, YN],
        "layers": layers,
    }
    text = json.dumps(doc, separators=(",", ":"), ensure_ascii=False)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)

    for k, v in layers.items():
        pts = sum(len(p) for p in v)
        print(f"  {k:9s} {len(v):5d} lines {pts:7d} points")
    print(f"wrote {OUT}  {len(text.encode()) / 1024:.1f} KB")


if __name__ == "__main__":
    main()
