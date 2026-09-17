#!/usr/bin/env python3
"""Build data/terrain.png from GSI elevation tiles.

Downloads 標高タイル (elevation tiles) from the Geospatial Information Authority
of Japan, assembles them, resamples to the model grid and packs the result into
a PNG the browser can decode without a server-side step:

    R, G  elevation in decimetres, big-endian  ->  elev_m = ((R << 8) | G) / 10
    B     land fraction, 0 = sea, 255 = land

The GSI tiles return the string "e" for no-data, which over Kagoshima Bay means
water, so the land mask comes from the DEM itself and the coastline is real
rather than drawn.

Tiles are public and need no key. Usage:

    python3 tools/build_terrain.py

Re-run with different X0/X1/Y0/Y1 to move the window; print the reported km
bounds into js/params.js (XW, XE, YS, YN) if you do.
"""

import base64
import concurrent.futures as cf
import io
import math
import time
import urllib.error
import urllib.request

import numpy as np
from PIL import Image

# --- window -----------------------------------------------------------------
Z = 12                      # zoom: each tile is ~8.3 km at this latitude
X0, X1 = 3529, 3540         # tile x range, inclusive (12 tiles, ~100 km)
Y0, Y1 = 1662, 1673         # tile y range, inclusive
GRID = 512                  # output grid side; must match N in js/params.js

VENT_LON, VENT_LAT = 130.6575, 31.5931   # Minamidake
OUT = "data/terrain.png"

N_TILES = 2 ** Z


def lon_of(x):
    return x / N_TILES * 360 - 180


def lat_of(y):
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / N_TILES))))


def fetch(args):
    tx, ty = args
    url = f"https://cyberjapandata.gsi.go.jp/xyz/dem/{Z}/{tx}/{ty}.txt"
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                txt = r.read().decode()
            rows = [[0.0 if v == "e" else float(v) for v in line.split(",")]
                    for line in txt.strip().split("\n")]
            return tx, ty, np.array(rows, dtype=np.float32)
        except urllib.error.HTTPError as exc:
            # GSI serves no tile for open sea. A 404 means all water, so fill
            # it with zeros and don't report it as missing.
            if exc.code == 404:
                return tx, ty, np.zeros((256, 256), dtype=np.float32)
        except Exception:
            pass
        time.sleep(1 + attempt)
    return tx, ty, None


def main():
    w = (X1 - X0 + 1) * 256
    h = (Y1 - Y0 + 1) * 256
    arr = np.zeros((h, w), dtype=np.float32)

    tiles = [(tx, ty) for tx in range(X0, X1 + 1) for ty in range(Y0, Y1 + 1)]
    ok = 0
    with cf.ThreadPoolExecutor(12) as ex:
        for tx, ty, t in ex.map(fetch, tiles):
            if t is None:
                print(f"  MISSING tile {tx}/{ty}")
                continue
            arr[(ty - Y0) * 256:(ty - Y0 + 1) * 256,
                (tx - X0) * 256:(tx - X0 + 1) * 256] = t
            ok += 1
    print(f"tiles {ok}/{len(tiles)}  raw {w}x{h}  elev {arr.min():.0f}..{arr.max():.0f} m")

    lon_w, lon_e = lon_of(X0), lon_of(X1 + 1)
    lat_n, lat_s = lat_of(Y0), lat_of(Y1 + 1)
    km_lon = 111.320 * math.cos(math.radians(VENT_LAT))
    xw = (lon_w - VENT_LON) * km_lon
    xe = (lon_e - VENT_LON) * km_lon
    ys = (lat_s - VENT_LAT) * 110.574
    yn = (lat_n - VENT_LAT) * 110.574
    print("\nPut these in js/params.js:")
    print(f"  export const XW = {xw:.2f}, XE = {xe:.2f}, "
          f"YS = {ys:.2f}, YN = {yn:.2f};")
    print(f"  ({xe - xw:.2f} x {yn - ys:.2f} km)\n")

    dem = np.clip(np.asarray(
        Image.fromarray(arr, mode="F").resize((GRID, GRID), Image.LANCZOS)), 0, None)
    mask = np.asarray(Image.fromarray(((arr > 0.5) * 255).astype(np.uint8))
                      .resize((GRID, GRID), Image.BILINEAR))
    print(f"resampled {GRID}x{GRID}  elev {dem.min():.0f}..{dem.max():.0f} m")

    # sanity: the vent cell should land near the real summit height
    vx = int((VENT_LON - lon_w) / (lon_e - lon_w) * GRID)
    vy = int((lat_n - VENT_LAT) / (lat_n - lat_s) * GRID)
    print(f"vent cell ({vx},{vy}) = {dem[vy, vx]:.0f} m   (Minamidake ~1060 m, "
          f"resampling smooths the summit)")

    q = np.round(np.clip(dem, 0, 6553.5) * 10).astype(np.uint16)
    rgb = np.zeros((GRID, GRID, 3), dtype=np.uint8)
    rgb[:, :, 0] = (q >> 8).astype(np.uint8)
    rgb[:, :, 1] = (q & 255).astype(np.uint8)
    rgb[:, :, 2] = mask

    buf = io.BytesIO()
    Image.fromarray(rgb).save(buf, format="PNG", optimize=True, compress_level=9)
    with open(OUT, "wb") as f:
        f.write(buf.getvalue())
    print(f"wrote {OUT}  {len(buf.getvalue()) / 1024:.1f} KB")


if __name__ == "__main__":
    main()
