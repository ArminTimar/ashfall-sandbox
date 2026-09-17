#!/usr/bin/env python3
"""Build data/terrain.png and data/terrain.json for all of Kyushu.

Downloads GSI 標高タイル in PNG form (dem_png) from the Geospatial Information
Authority of Japan, assembles them and warps them onto a 200 m grid in
JGD2011 / Japan Plane Rectangular CS II (EPSG:6670). Grid cells line up with
multiples of 200 m in that system, so an exported raster drops straight into
QGIS on the same grid.

The map is a rectangle around mainland Kyushu. Islands inside it come along
(Amakusa, Nagashima, Hirado, Koshiki, Iki). Islands farther out are left out
(Tsushima, Goto, Tanegashima, Yakushima, Kikai).

Output PNG, north-up:

    R, G  elevation in decimetres, big-endian  ->  elev_m = ((R << 8) | G) / 10
    B     land fraction, 0 = sea, 255 = land

data/terrain.json records the grid: EPSG code, west and south edges in
metres, cell size and dimensions.

Tiles are public and need no key. They are cached in tools/.cache/dem_png/.

    python3 tools/build_terrain.py
"""

import concurrent.futures as cf
import io
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import proj  # noqa: E402

# --- the map rectangle, EPSG:6670 metres ------------------------------------
# Must match js/params.js (read at runtime from data/terrain.json).
CELL = 200
E_WEST, E_EAST = -154000, 108000
N_SOUTH, N_NORTH = -230000, 112000

Z = 11                      # source zoom, about 64 m per pixel at this latitude
OUT_PNG = "data/terrain.png"
OUT_JSON = "data/terrain.json"
CACHE = "tools/.cache/dem_png"
N_TILES = 2 ** Z


def tile_x(lon):
    return (lon + 180) / 360 * N_TILES


def tile_y(lat):
    r = math.radians(lat)
    return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * N_TILES


def fetch(args):
    """One tile as elevation in metres, NaN where GSI has no data (sea)."""
    tx, ty = args
    path = f"{CACHE}/{tx}_{ty}.png"
    if not os.path.exists(path):
        url = f"https://cyberjapandata.gsi.go.jp/xyz/dem_png/{Z}/{tx}/{ty}.png"
        data = None
        for attempt in range(5):
            try:
                with urllib.request.urlopen(url, timeout=30) as r:
                    data = r.read()
                break
            except urllib.error.HTTPError as exc:
                # No tile at all means open sea.
                if exc.code == 404:
                    data = b""
                    break
            except Exception:
                pass
            time.sleep(1 + attempt)
        if data is None:
            return tx, ty, None
        with open(path, "wb") as f:
            f.write(data)
    with open(path, "rb") as f:
        data = f.read()
    if not data:
        return tx, ty, np.full((256, 256), np.nan, dtype=np.float32)
    rgb = np.asarray(Image.open(io.BytesIO(data)).convert("RGB")).astype(np.int64)
    v = (rgb[:, :, 0] << 16) + (rgb[:, :, 1] << 8) + rgb[:, :, 2]
    h = np.where(v < 2 ** 23, v, v - 2 ** 24).astype(np.float32) * 0.01
    h[v == 2 ** 23] = np.nan                          # GSI's no-data value
    return tx, ty, h


def main():
    proj.self_check()
    os.makedirs(CACHE, exist_ok=True)

    nx = (E_EAST - E_WEST) // CELL
    ny = (N_NORTH - N_SOUTH) // CELL

    # Tile range covering the rectangle, with a one-tile margin.
    corners = [proj.to_lonlat(float(e), float(nn)) for e in (E_WEST, E_EAST) for nn in (N_SOUTH, N_NORTH)]
    lons = [c[0] for c in corners]
    lats = [c[1] for c in corners]
    X0, X1 = int(tile_x(min(lons))) - 1, int(tile_x(max(lons))) + 1
    Y0, Y1 = int(tile_y(max(lats))) - 1, int(tile_y(min(lats))) + 1
    tiles = [(tx, ty) for tx in range(X0, X1 + 1) for ty in range(Y0, Y1 + 1)]
    print(f"grid {nx} x {ny} cells at {CELL} m, {len(tiles)} source tiles at zoom {Z}")

    mosaic = np.full(((Y1 - Y0 + 1) * 256, (X1 - X0 + 1) * 256), np.nan, dtype=np.float32)
    missing = 0
    with cf.ThreadPoolExecutor(12) as ex:
        for tx, ty, t in ex.map(fetch, tiles):
            if t is None:
                missing += 1
                print(f"  MISSING tile {tx}/{ty}")
                continue
            mosaic[(ty - Y0) * 256:(ty - Y0 + 1) * 256, (tx - X0) * 256:(tx - X0 + 1) * 256] = t
    if missing:
        raise SystemExit(f"{missing} tiles could not be downloaded, run again")

    land = np.isfinite(mosaic).astype(np.float32)
    elev = np.nan_to_num(mosaic, nan=0.0)
    elev = np.clip(elev, 0, None)

    # Average 3 x 3 source pixels (about 190 m) before sampling at 200 m, so
    # the grid is not aliased from single 64 m pixels.
    def box3(a):
        p = np.pad(a, 1, mode="edge")
        s = np.zeros_like(a)
        for dy in range(3):
            for dx in range(3):
                s += p[dy:dy + a.shape[0], dx:dx + a.shape[1]]
        return s / 9
    elev = box3(elev)
    land = box3(land)

    # Cell centres of the output grid, north-up (row 0 = north).
    E = E_WEST + (np.arange(nx) + 0.5) * CELL
    N = N_NORTH - (np.arange(ny) + 0.5) * CELL
    EE, NN = np.meshgrid(E, N)
    lon, lat = proj.to_lonlat(EE, NN)
    px = (lon + 180) / 360 * N_TILES * 256 - X0 * 256 - 0.5
    lr = np.radians(lat)
    py = (1 - np.log(np.tan(lr) + 1 / np.cos(lr)) / np.pi) / 2 * N_TILES * 256 - Y0 * 256 - 0.5

    def bilinear(a):
        x0 = np.clip(np.floor(px).astype(np.int64), 0, a.shape[1] - 2)
        y0 = np.clip(np.floor(py).astype(np.int64), 0, a.shape[0] - 2)
        fx = np.clip(px - x0, 0, 1)
        fy = np.clip(py - y0, 0, 1)
        top = a[y0, x0] * (1 - fx) + a[y0, x0 + 1] * fx
        bot = a[y0 + 1, x0] * (1 - fx) + a[y0 + 1, x0 + 1] * fx
        return top * (1 - fy) + bot * fy

    dem = bilinear(elev)
    mask = bilinear(land)
    dem[mask < 0.5] = np.minimum(dem[mask < 0.5], 0)   # sea stays at sea level
    print(f"elevation {dem.min():.0f} to {dem.max():.0f} m, land {100 * (mask > 0.5).mean():.0f}%")

    q = np.round(np.clip(dem, 0, 6553.5) * 10).astype(np.uint16)
    rgb = np.zeros((ny, nx, 3), dtype=np.uint8)
    rgb[:, :, 0] = (q >> 8).astype(np.uint8)
    rgb[:, :, 1] = (q & 255).astype(np.uint8)
    rgb[:, :, 2] = np.round(np.clip(mask, 0, 1) * 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(rgb).save(buf, format="PNG", optimize=True, compress_level=9)
    with open(OUT_PNG, "wb") as f:
        f.write(buf.getvalue())

    meta = {
        "epsg": proj.EPSG,
        "crs": "JGD2011 / Japan Plane Rectangular CS II",
        "west": E_WEST, "south": N_SOUTH, "east": E_EAST, "north": N_NORTH,
        "cell": CELL, "nx": int(nx), "ny": int(ny),
        "encoding": "north-up; R,G elevation in decimetres big-endian; B land fraction 0-255",
        "source": f"GSI 標高タイル dem_png zoom {Z}",
    }
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(f"wrote {OUT_PNG}  {len(buf.getvalue()) / 1024:.0f} KB  and {OUT_JSON}")


if __name__ == "__main__":
    main()
