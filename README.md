# Sakurajima Ashfall Sandbox

An interactive tephra transport and deposition model for Sakurajima volcano,
running in the browser on the Geospatial Information Authority of Japan's own
elevation data. Set an eruption and a wind field, watch the plume bend and the
deposit drape across the landscape.

The physics is an analytical advection–diffusion solution after Suzuki (1983),
following the formulation used by
[Tephra2](https://github.com/geoscience-community-codes/tephra2), with
Reynolds-dependent settling velocity and a Lagrangian particle view driven by
the same equations. It is not a decorative particle effect.

## Quick start

**Double-clicking `index.html` will not work.** Browsers refuse to load ES
modules over `file://`, and refuse to read the terrain PNG into a canvas from
there. The page detects this and says so, but there is nothing it can do about
it. Two options:

**Serve it** — the normal development path:

```bash
npm start            # node tools/serve.mjs 8000
# then open http://localhost:8000
```

Any static server does the same job (`python3 -m http.server 8000`).

**Or build the standalone file** — one HTML file that does open by double-click:

```bash
npm run bundle       # writes dist/index.html, ~0.8 MB
```

That flattens the modules, inlines the stylesheet, embeds the DEM as a data URI
and bundles three.js, so `dist/index.html` runs from disk with no server and no
network. It is also the thing to hand someone who just wants to look at it.

Run the checks with:

```bash
npm test
```

No dependencies to install for any of this.

## What it computes

Deposit mass per unit area is a sum of two-dimensional Gaussians, one per
combination of release height *i* and grain size *j*:

```
M(x,y) = Σᵢ Σⱼ  mᵢⱼ / (2πσ²ᵢⱼ) · exp( −[(x − Δxᵢⱼ)² + (y − Δyᵢⱼ)²] / 2σ²ᵢⱼ )
```

with

```
σ²ᵢⱼ = 2K(tᵢⱼ + τᵢ)          τᵢ = 0.0032 · hᵢ² / K
```

Fall time *t* and wind drift Δx, Δy come from integrating downward from the
release height in 100 m steps, recomputing settling velocity at each step as air
density changes. τ is the time a particle has already spent spreading inside the
rising column, so ash leaving the top of a tall plume starts wider than ash
leaving the vent.

Tephra2 writes the same kernel as `(M/πσ)·exp(−r²/σ)` with `σ = 4K(t+τ)`, which
works out to the same per-axis variance. Matching that convention means a `K`
here means the same thing as a `K` in a published Tephra2 inversion.

| Component | Treatment |
| --- | --- |
| Settling velocity | Three-regime scheme after Bonadonna et al. (1998): Stokes below Re 6, an intermediate law to Re 500, Newton above |
| Particle density | Scales with grain size, 1200 kg/m³ for coarse vesicular clasts to 2400 for fine glass and crystal fragments |
| Atmosphere | Exponential density profile, scale height 8200 m, viscosity 1.8 × 10⁻⁵ Pa·s |
| Column | Suzuki distribution over release height; mass peaks at 1 − 1/A of the plume height |
| Grain size | Gaussian in φ, 12 bins from φ −5 (32 mm) to φ 5 (31 µm), renormalised |
| Wind | Speed interpolated between the 2 km and 12 km values, direction rotating linearly by the shear angle |
| Source consistency | Mastin et al. (2009), `H = 2.00·V̇^0.241`, inverted to flag plume height and erupted mass that cannot belong to the same eruption |
| Terrain | GSI 標高タイル zoom 12, 36 tiles, resampled to 320 × 320 over 50.0 × 49.6 km |
| Damage thresholds | After Blong et al. (2017); nearly all building damage falls between 200 and 1000 mm |

The falling particles are a Lagrangian view of the same model, not decoration.
Each carries a real grain size, rises through the column to its own release
height, then falls using the same settling velocity, wind and diffusion. The
random walk's variance grows at `dV/dt = 2K`, the derivative of the field's σ².

## Validation

`npm test` runs two checks.

**`test/montecarlo.mjs`** samples 20,000 particles all the way to the ground and
compares the landing distribution to the analytical field. These are separate
implementations of the same model, so agreement is a real check.

```
                mean x    mean y   spread x  spread y   (km)
analytic         89.52    -21.21     162.82     40.07
dt=20s           88.22    -20.90     160.04     39.26
dt= 5s           89.58    -21.29     162.70     40.14
```

Under 1% on position, under 1.5% on spread, and stable across step size, so the
random walk is not step-size dependent.

**`test/orientation.mjs`** guards the south-up / north-up boundary. The physics
grid stores row 0 as the southern edge; the DEM and the drawn texture store row
0 as the northern edge. Getting that wrong renders the deposit mirrored against
the terrain **while every numeric readout stays correct** — and a deposit blown
due west looks almost identical mirrored, so it hides until the wind has a
north–south component. This bug was in the code once. The test drives the wind to
each cardinal direction and requires the two centroids to coincide.

## Known limitations

These matter if you are comparing against anything real.

- **Fickian diffusion only.** Tephra2 switches to a power law
  `σ = (8/5)·C·(t + τ_f)^2.5` with `τ_f = (0.2h²)^0.4` for particles whose fall
  time exceeds its `FALL_TIME_THRESHOLD`. Distal fine ash is too concentrated here.
- **No umbrella cloud.** Large eruptions spread radially at the neutral buoyancy
  level before the wind takes over, so strong plumes are too narrow near the vent.
- **Steady wind.** One profile for the whole eruption. Real deposits from
  multi-hour eruptions record the wind rotating underneath them.
- **No ash aggregation.** Fine ash clumps and falls like much larger particles,
  producing secondary thickness maxima tens of kilometres downwind.
- **Terrain is scenery.** The deposit is draped onto the DEM, not computed
  against it. Every particle falls to sea level. Tephra2 adjusts fall time for
  each grid point's own elevation; doing that here means a per-point loop rather
  than one splatted Gaussian per release height, roughly twenty million
  evaluations per frame.
- **Domain edge.** Anything blown past 50 km is gone. The readout reports what
  fraction of the erupted mass actually landed in view.
- **σ floor.** σ is clamped at 0.6 of a grid cell so coarse near-vent clasts do
  not alias into single-cell spikes, which smooths near-vent values.

See [docs/COMPARISON.md](docs/COMPARISON.md) for how this sits next to Tephra2
and Tephra4D.

## Where it could go

This is the hazard module of a catastrophe model and nothing else. Three pieces
would complete one:

1. **Stochastic event set** — replace the sliders with thousands of sampled
   eruptions, plume height and mass drawn from the Sakurajima record, wind
   profiles drawn from ERA5 reanalysis days so seasonality comes along for free,
   each with an annual rate.
2. **Exposure** — building counts and values per mesh cell from the Japanese
   census grid on e-Stat, in the OED schema so it is portable.
3. **Vulnerability** — ash load to damage ratio, after Blong et al. (2017), who
   work in static load rather than thickness because deposit density ranges from
   roughly 500 to 2000 kg/m³.

Sort the annual losses and the exceedance probability curve falls out.

## Layout

```
index.html              the app
css/style.css
js/params.js            constants, live parameters, presets  (no imports)
js/physics.js           settling, wind, fall integration, the deposit field
js/grid.js              orientation flip and marching squares (pure, tested)
js/terrain.js           DEM decode and elevation lookup
js/texture.js           land/sea base, deposit raster, isopachs
js/particles.js         Lagrangian cloud
js/scene.js             three.js, camera, labels
js/ui.js                sliders and readouts
js/main.js              wiring
data/terrain.png        packed DEM, see below
tools/build_terrain.py  rebuilds data/terrain.png from GSI tiles
tools/serve.mjs         zero-dependency static server
tools/bundle.mjs        flattens everything into dist/index.html
test/                   node test scripts
```

`tools/bundle.mjs` rewrites each module into an IIFE returning its exports, then
cross-checks every imported name against what the exporting module actually
exports. That check exists because the first version silently dropped the second
and later names in `export const A = 1, B = 2;` — the bundle loaded, looked
fine, and computed nothing. Keep one declarator per exported statement, and do
not export a binding you reassign later.

## Terrain data

`data/terrain.png` packs a 320 × 320 north-up grid:

| Channel | Meaning |
| --- | --- |
| R, G | elevation in decimetres, big-endian: `elev_m = ((R << 8) \| G) / 10` |
| B | land fraction, 0 = sea, 255 = land |

Rebuild it with `npm run terrain` (needs `numpy` and `Pillow`). The GSI tiles
return `"e"` for no-data, which over Kagoshima Bay means water, so the land mask
comes from the DEM itself and the coastline is real rather than drawn. The tiles
are public and need no key.

If you move the window, the script prints the km bounds to paste into
`js/params.js`.

## References

- Suzuki, T. (1983). A theoretical model for dispersion of tephra. *Arc Volcanism: Physics and Tectonics*, 95–113.
- Bonadonna, C., Ernst, G.G.J., Sparks, R.S.J. (1998). Thickness variations and volume estimates of tephra fall deposits: the importance of particle Reynolds number. *J. Volcanol. Geotherm. Res.* 81, 173–187.
- Connor, L.J., Connor, C.B. Tephra2. <https://github.com/geoscience-community-codes/tephra2>
- Mastin, L.G. et al. (2009). A multidisciplinary effort to assign realistic source parameters to models of volcanic ash-cloud transport and dispersion during eruptions. *J. Volcanol. Geotherm. Res.* 186, 10–21.
- Blong, R.J., Grasso, P., Jenkins, S.F. et al. (2017). Estimating building vulnerability to volcanic ash fall for insurance and other purposes. *J. Appl. Volcanol.* 6, 2. <https://doi.org/10.1186/s13617-017-0054-9>
- Takishita, K., Poulidis, A.P., Iguchi, M. (2021). Tephra4D: a Python-based model for high-resolution tephra transport and deposition simulations — applications at Sakurajima volcano, Japan. *Atmosphere* 12, 331. <https://doi.org/10.3390/atmos12030331>
- Woodhouse, M.J. et al. (2013). Interaction between volcanic plumes and wind during the 2010 Eyjafjallajökull eruption, Iceland. *J. Geophys. Res. Solid Earth* 118, 92–109.

## Licence

MIT, see [LICENSE](LICENSE). Elevation data © Geospatial Information Authority of
Japan, used under its terms of use.
