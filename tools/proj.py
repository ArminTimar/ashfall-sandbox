"""JGD2011 / Japan Plane Rectangular CS II (EPSG:6670), without pyproj.

The same Krüger series as js/proj.js, written so it works on plain floats and
on numpy arrays alike. test/proj.mjs checks the JavaScript version against
pyproj, and tools/build_terrain.py checks this one against the JavaScript
reference values when it starts.
"""

import math

try:
    import numpy as np
except ImportError:          # the vector build uses plain floats only
    np = None

EPSG = 6670
A_AXIS = 6378137.0
FLAT = 1 / 298.257222101
K0 = 0.9999
LON0 = math.radians(131.0)
LAT0 = math.radians(33.0)

n = FLAT / (2 - FLAT)
n2, n3, n4, n5, n6 = n**2, n**3, n**4, n**5, n**6
AA = A_AXIS / (1 + n) * (1 + n2 / 4 + n4 / 64 + n6 / 256)

ALPHA = [
    n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180 - 127 * n5 / 288 + 7891 * n6 / 37800,
    13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440 + 281 * n5 / 630 - 1983433 * n6 / 1935360,
    61 * n3 / 240 - 103 * n4 / 140 + 15061 * n5 / 26880 + 167603 * n6 / 181440,
    49561 * n4 / 161280 - 179 * n5 / 168 + 6601661 * n6 / 7257600,
    34729 * n5 / 80640 - 3418889 * n6 / 1995840,
    212378941 * n6 / 319334400,
]
BETA = [
    n / 2 - 2 * n2 / 3 + 37 * n3 / 96 - n4 / 360 - 81 * n5 / 512 + 96199 * n6 / 604800,
    n2 / 48 + n3 / 15 - 437 * n4 / 1440 + 46 * n5 / 105 - 1118711 * n6 / 3870720,
    17 * n3 / 480 - 37 * n4 / 840 - 209 * n5 / 4480 + 5569 * n6 / 90720,
    4397 * n4 / 161280 - 11 * n5 / 504 - 830251 * n6 / 7257600,
    4583 * n5 / 161280 - 108847 * n6 / 3991680,
    20648693 * n6 / 638668800,
]
DELTA = [
    2 * n - 2 * n2 / 3 - 2 * n3 + 116 * n4 / 45 + 26 * n5 / 45 - 2854 * n6 / 675,
    7 * n2 / 3 - 8 * n3 / 5 - 227 * n4 / 45 + 2704 * n5 / 315 + 2323 * n6 / 945,
    56 * n3 / 15 - 136 * n4 / 35 - 1262 * n5 / 105 + 73814 * n6 / 2835,
    4279 * n4 / 630 - 332 * n5 / 35 - 399572 * n6 / 14175,
    4174 * n5 / 315 - 144838 * n6 / 6237,
    601676 * n6 / 22275,
]
E2N = 2 * math.sqrt(n) / (1 + n)


def _m(x):
    """numpy if the input is an array, math otherwise."""
    return np if (np is not None and isinstance(x, np.ndarray)) else math


def _conformal(lat):
    m = _m(lat)
    s = m.sin(lat)
    return m.sinh(m.atanh(s) - E2N * m.atanh(E2N * s))


def _s0():
    xi = math.atan(_conformal(LAT0))
    return K0 * AA * (xi + sum(ALPHA[j - 1] * math.sin(2 * j * xi) for j in range(1, 7)))


S0 = _s0()


def to_en(lon, lat):
    """Degrees to (E, N) metres. Accepts floats or numpy arrays."""
    m = _m(lat) if _m(lat) is not math else _m(lon)
    phi = lat * math.pi / 180
    dl = lon * math.pi / 180 - LON0
    t = _conformal(phi)
    xi = m.arctan(t / m.cos(dl)) if m is np else m.atan(t / m.cos(dl))
    eta = m.arctanh(m.sin(dl) / m.sqrt(1 + t * t)) if m is np else m.atanh(m.sin(dl) / m.sqrt(1 + t * t))
    x, y = xi, eta
    for j in range(1, 7):
        x = x + ALPHA[j - 1] * m.sin(2 * j * xi) * m.cosh(2 * j * eta)
        y = y + ALPHA[j - 1] * m.cos(2 * j * xi) * m.sinh(2 * j * eta)
    return K0 * AA * y, K0 * AA * x - S0


def to_lonlat(E, N):
    """(E, N) metres to degrees. Accepts floats or numpy arrays."""
    m = _m(E) if _m(E) is not math else _m(N)
    xi = (N + S0) / (K0 * AA)
    eta = E / (K0 * AA)
    xp, ep = xi, eta
    for j in range(1, 7):
        xp = xp - BETA[j - 1] * m.sin(2 * j * xi) * m.cosh(2 * j * eta)
        ep = ep - BETA[j - 1] * m.cos(2 * j * xi) * m.sinh(2 * j * eta)
    chi = (m.arcsin if m is np else m.asin)(m.sin(xp) / m.cosh(ep))
    lat = chi
    for j in range(1, 7):
        lat = lat + DELTA[j - 1] * m.sin(2 * j * chi)
    lon = LON0 + (m.arctan2 if m is np else m.atan2)(m.sinh(ep), m.cos(xp))
    return lon * 180 / math.pi, lat * 180 / math.pi


def self_check():
    """Reference values from pyproj, the same ones test/proj.mjs uses."""
    for lon, lat, E, N in [(130.6575, 31.5931, -32502.8479, -155947.5109),
                           (129.35, 34.1, -152248.6940, 123222.7769),
                           (132.15, 30.9, 109936.8658, -232270.6632)]:
        e, nn = to_en(lon, lat)
        assert abs(e - E) < 0.001 and abs(nn - N) < 0.001, (lon, lat, e, nn)
        lo, la = to_lonlat(E, N)
        assert abs(lo - lon) < 1e-8 and abs(la - lat) < 1e-8, (E, N, lo, la)


if __name__ == "__main__":
    self_check()
    print("proj.py agrees with pyproj reference values")
