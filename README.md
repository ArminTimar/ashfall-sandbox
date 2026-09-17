# Sakurajima Ashfall Sandbox

An interactive model of volcanic ash fall from Sakurajima, running in the
browser on elevation data from the Geospatial Information Authority of Japan.
Set an eruption and a wind field, then watch the plume bend and the ash settle
across a 100 km stretch of southern Kyushu.

The deposit is an analytical advection and diffusion solution after Suzuki
(1983), in the form used by
[Tephra2](https://github.com/geoscience-community-codes/tephra2), with settling
speeds that depend on the particle Reynolds number. The moving particles follow
the same equations one grain at a time, and the tests check that they land
where the deposit says they should.

## Quick start

**Try it without installing anything.** The current `main` runs live at
[armintimar.github.io/ashfall-sandbox](https://armintimar.github.io/ashfall-sandbox/).

**Double-clicking `index.html` does not work.** Browsers refuse to load ES
modules from `file://`, and they also refuse to read the terrain PNG into a
canvas from there. The page detects this and says so. You have two options.

**Serve it.** This is the normal way to develop:

```bash
npm start            # node tools/serve.mjs 8000
# then open http://localhost:8000
```

Any static server works too (`python3 -m http.server 8000`).

**Or build the standalone file**, a single HTML file that opens by
double-click:

```bash
npm run bundle       # writes dist/index.html, about 1.7 MB
```

The build flattens the modules, inlines the stylesheet, the elevation model and
the map data, and embeds three.js. `dist/index.html` then runs from disk with
no server and no network, which also makes it the easiest thing to send to
someone.

`dist/` is generated, so it is not in version control. Each
[release](https://github.com/ArminTimar/ashfall-sandbox/releases) has a prebuilt
copy attached.

Run the checks with:

```bash
npm test
```

None of this needs anything installed beyond Node 18 or newer.

## Layout on screen

The map always stays in view. On a desktop the page is exactly one window tall,
the map fills the left side and only the control column scrolls. On a phone the
map is pinned to the top and everything else scrolls underneath it. The About
text and the data credits are at the bottom of the controls.

## Controls

Every numeric control has a slider and a text box. Click the number, type a
value and press Enter. Escape cancels the edit, and the arrow keys nudge the
value (hold Shift for bigger steps). A typed value can go past the end of the
slider, which then stays at its end. Values are only limited where the physics
stops making sense, and a note says when that happens.

The boxes accept the forms people usually write numbers in:

| Field | Examples that work |
| --- | --- |
| Erupted mass | `2e10`, `2×10¹⁰`, `2*10^10`, `200 Mt`, `1.5 Gt`, `500 t` |
| Plume height | `9.5`, `9500 m`, `30000 ft` |
| Grain size | `2` (φ), `φ 2.5`, `250 µm`, `0.5 mm` |
| Wind direction | `270`, `WSW` |
| Wind speed | `25`, `40 kt`, `90 km/h` |
| Density | `1200`, `1.2 g/cm³` |
| Eruption length | `45` (min), `1.5 h`, `300 s` |

A decimal comma works (`2,5`), and so does a thousands separator (`2,500`).

Controls whose meaning isn't obvious outside physical volcanology have a **?**
button: φ, sorting, Suzuki *A*, directional shear, eddy diffusivity, bulk
density, isopachs, the Mastin duration and the VEI. Each one explains what the
quantity is, what it does in this model and what a sensible value looks like.

The **VEI** readout under erupted mass is the volume-based class of Newhall &
Self (1982). It turns mass into volume with the deposit bulk density, and names
a historical eruption of about the same size.

## What it computes

Deposit mass per unit area is a sum of two-dimensional Gaussians, one for each
combination of release height *i* and grain size *j*:

```
M(x,y) = Σᵢ Σⱼ  mᵢⱼ / (2πσ²ᵢⱼ) · exp( −[(x − Δxᵢⱼ)² + (y − Δyᵢⱼ)²] / 2σ²ᵢⱼ )
```

with

```
σ²ᵢⱼ = 2K(tᵢⱼ + τᵢ)          τᵢ = 0.0032 · hᵢ² / K
```

Fall time *t* and wind drift Δx, Δy come from stepping down from the release
height in 100 m steps, recalculating the settling velocity at each step as the
air gets denser. τ stands for the time a particle has already spent spreading
inside the rising column, so ash leaving the top of a tall plume starts out
wider than ash leaving low down.

Tephra2 writes the same kernel as `(M/πσ)·exp(−r²/σ)` with `σ = 4K(t+τ)`, which
gives the same variance along each axis. Using that convention means a `K` here
means the same thing as a `K` in a published Tephra2 inversion.

| Component | Treatment |
| --- | --- |
| Settling velocity | Three regimes after Bonadonna et al. (1998): Stokes below Re 6, an intermediate law up to Re 500, Newton above that |
| Particle density | Depends on grain size, from 1200 kg/m³ for coarse vesicular clasts to 2400 for fine glass and crystal fragments |
| Atmosphere | Exponential density profile, scale height 8200 m, viscosity 1.8 × 10⁻⁵ Pa·s |
| Column | Suzuki distribution over release height. Release peaks at 1 − 1/A of the plume height |
| Grain size | Gaussian in φ, 12 bins from φ −5 (32 mm) to φ 5 (31 µm), renormalised |
| Wind | Speed interpolated between the 2 km and 12 km values, direction turning evenly by the shear angle over the same range |
| Source consistency | Mastin et al. (2009), `H = 2.00·V̇^0.241`, inverted to flag a plume height and erupted mass that can't belong to the same eruption |
| Terrain | GSI 標高タイル zoom 12, 144 tiles, resampled to 512 × 512 over 100.0 × 99.3 km |
| Map layers | OpenStreetMap main roads, railways, the Kagoshima city limit and place names, clipped to the domain |
| Damage thresholds | After Blong et al. (2017). Nearly all building damage happens between 200 and 1000 mm |

## Plume animation

Each particle carries a real grain size and a release height drawn from the
same Suzuki profile the deposit uses. It rides up the eruption column, leaves
it gradually around its release height and then falls with the deposit's
settling velocity, wind and diffusion.

Leaving the column is gradual. Each particle has a support fraction *S* that
starts at 1 and decays to 0 across a detrainment layer below its release
height, a quarter of the column deep:

| | With the column (S = 1) | Falling freely (S = 0) |
| --- | --- | --- |
| Vertical velocity | column updraft *W(z)* | minus the settling velocity |
| Horizontal velocity | the share of the wind the column has picked up | the full wind |
| Turbulent spread | none, the particle keeps its place in the plume | random walk growing at `dV/dt = 2K` |

In between, every quantity is blended by *S*, so a particle slows, arcs over
and starts to fall. *S* never increases, so nothing is caught and lifted again.
The updraft scales with the square root of plume height (about 34 m/s low in a
5 km plume), so plumes take a few minutes to reach their tops. How far the
column leans depends on the wind at the top compared with the updraft, after
the strong and weak plume distinction of Bonadonna & Phillips (2003). The plume
widens to 8% of the height climbed, which is exactly the starting spread the
deposit gives the cloud through τ.

The number of particles scales with erupted mass: about 250 at 10⁶ kg, 800 at
2 × 10⁸ kg and 3,100 at 10¹¹ kg, up to 6,000.

There are two modes.

**Continuous** is a cloud that has been erupting long enough to reach a steady
state. Particles are recycled forever. This mode matches the deposit on the
map, which is also a steady-state solution.

**Single eruption** plays one eruption of a set length at a set speed.
Particles are released over that time and then emission stops, so the column
dies back, the cloud drifts off and the sky empties. The deposit on the map
still shows the steady-state result.

Every parameter change re-seeds the continuous cloud, because the deposit field
jumps to the new numbers straight away and an untouched cloud would keep
pointing the old way. The fresh cloud has to match the one it replaces, or
every slider movement shows up as a flash. In a steady state the number of
particles at a stage of life is proportional to how long that stage lasts, so
the seeding traces a pool of particle lives and draws the cloud from it with
probability proportional to lifetime, at a random time along each life. An
eruption run isn't re-seeded when you change a parameter. Use **Replay** to
start a new one.

Playback speed and eruption length only affect the animation. Neither changes
the deposit.

## Validation

`npm test` runs six scripts.

**`test/montecarlo.mjs`** drops 60,000 particles to the ground and compares
where they land with the analytical field. The two are separate
implementations of the same model, so agreement is a real check.

```
                mean x    mean y   spread x  spread y   (km)
analytic         80.76    -16.55     146.93     31.54
dt=20s           79.90    -16.38     144.90     31.09
dt= 5s           80.96    -16.59     146.78     31.50
```

Position agrees within about 1% and spread within 1.5%, at both step sizes.

**`test/particles.mjs`** checks the animation. A fresh seed has to match a
cloud run to equilibrium in four grain size and wind regimes. The particle
count has to follow the erupted mass. An eruption run has to start empty, fill
and clear. No particle's vertical velocity may change by more than 4 m/s in
one second, and none may jump more than 700 m sideways (the previous scheme
reached 27 m/s and 1.4 km when it released a particle). Finally, particles have
to land within 15% of the deposit's centre.

**`test/orientation.mjs`** guards the boundary between south-up and north-up
grids. The physics grid stores row 0 as the southern edge, and the elevation
model and the drawn texture store row 0 as the northern edge. Getting that
wrong draws the deposit mirrored against the terrain **while every number in
the readouts stays correct**. A deposit blown due west looks almost the same
mirrored, so the bug hides until the wind has a north or south component. It
was in the code once. The test turns the wind to each compass point and
requires the two centres to coincide.

**`test/geography.mjs`** checks that the elevation model, the map layers and the
place labels describe the same window, that every label is on land and that no
place appears twice.

**`test/markup.mjs`** and **`test/inputs.mjs`** check that the page and the
modules agree on element ids and help entries, and that typed values and units
are read correctly.

## Known limitations

These matter if you compare the sandbox with anything real.

- **Fickian diffusion only.** For particles that fall for a long time, Tephra2
  switches to a power law, `σ = (8/5)·C·(t + τ_f)^2.5` with `τ_f = (0.2h²)^0.4`.
  Distant fine ash is too concentrated here.
- **No umbrella cloud.** In large eruptions the plume spreads outward at the
  level of neutral buoyancy before the wind takes over. Strong plumes are
  therefore too narrow near the vent.
- **Steady wind.** One profile covers the whole eruption, set at 2 km and 12 km
  with an even turn in direction between them. Deposits from eruptions lasting
  hours record the wind changing, and a real sounding has more structure than
  two levels can show.
- **No ash aggregation.** Fine ash clumps together and falls like much larger
  particles, which can make a second thickness maximum tens of kilometres
  downwind.
- **Terrain is scenery.** The deposit is draped over the elevation model and
  every particle in the deposit calculation falls to sea level. Tephra2 adjusts
  fall time for the ground height at each point. Doing that here would need a
  loop over every point instead of one Gaussian per release height and grain
  size, roughly fifty million evaluations per update on the larger grid.
- **Column motion is a sketch.** The updraft profile and plume lean in the
  animation are simple forms with round-number constants, chosen to look and
  behave plausibly. They are not a plume model such as the one in Degruyter &
  Bonadonna (2012), and they don't feed into the deposit.
- **Domain edge.** Anything blown more than about 50 km from the vent leaves the
  map. The readout reports how much of the erupted mass landed in view.
- **σ floor.** σ is held at 0.6 of a grid cell or more, so coarse clasts near
  the vent don't turn into single-cell spikes. This smooths values close to the
  vent.

See [docs/COMPARISON.md](docs/COMPARISON.md) for how this compares with Tephra2
and Tephra4D.

## Where it could go

This is the hazard part of a catastrophe model. Three more pieces would make a
complete one:

1. **Stochastic event set.** Replace the sliders with thousands of sampled
   eruptions, with plume height and mass drawn from the Sakurajima record and
   wind profiles drawn from ERA5 reanalysis days, so the seasons come along
   automatically. Each event gets an annual rate.
2. **Exposure.** Building counts and values per grid cell from the Japanese
   census grid on e-Stat, stored in the OED format so it can be reused.
3. **Vulnerability.** Damage as a function of ash load, after Blong et al.
   (2017). They work with load instead of thickness because deposit density
   ranges from about 500 to 2000 kg/m³.

Sorting the yearly losses then gives the exceedance probability curve.

Closer steps, roughly in order of how much each would change the result:

1. **A real wind profile.** Several levels, each with its own speed and
   direction, from a sounding or an ERA5 column. Only `windAt(z)` would change,
   because the particles and the deposit both call it.
2. **Wind that changes during the eruption.** `windAt(z)` becomes
   `windAt(z, t)`. The particles can use that straight away because they
   already move in time. The analytical deposit can't, since a steady-state
   Gaussian assumes one wind for all time. At that point the deposit has to be
   added up over the eruption.
3. **Umbrella cloud.** Outward spreading at the level of neutral buoyancy
   before the wind takes over. This is the main reason strong plumes are too
   narrow near the vent here.
4. **Another volcano.** The domain is already generated by scripts.
   `tools/build_terrain.py` builds an elevation model for any window in Japan,
   and `tools/build_vectors.py` takes roads, boundaries and places from
   OpenStreetMap anywhere. The Sakurajima-specific parts are the GSI elevation
   source, which only covers Japan, and the vent position, summit height and
   presets in `js/params.js`. Switching the elevation source to SRTM or the
   Copernicus DEM and moving those constants into one file per volcano would
   do it.

## Files

```
index.html              the app
css/style.css
js/params.js            constants, live parameters, presets  (no imports)
js/physics.js           settling, wind, fall integration, the deposit field
js/grid.js              orientation flip and marching squares (pure, tested)
js/terrain.js           elevation model decoding and lookup
js/texture.js           land and sea colours, deposit raster, isopachs
js/particles.js         the particle cloud
js/vectors.js           roads, rail and the city limit, draped on the terrain
js/scene.js             three.js, camera, place labels
js/ui.js                controls, typed values and readouts
js/parse.js             reads typed quantities and units  (pure, tested)
js/vei.js               VEI classes and example eruptions  (pure, tested)
js/help.js              the ? explanations and their popover
js/main.js              wiring
data/terrain.png        packed elevation model, see below
data/vectors.json       roads, railways, city limit and places, in model km
tools/build_terrain.py  rebuilds data/terrain.png from GSI tiles
tools/build_vectors.py  rebuilds data/vectors.json from OpenStreetMap and GeoNames
requirements.txt        python packages for build_terrain.py (see below)
tools/serve.mjs         static server with no dependencies
tools/bundle.mjs        flattens everything into dist/index.html
test/                   node test scripts
```

`tools/bundle.mjs` rewrites each module as a function that returns its
exports, then checks every imported name against what the exporting module
really exports. The check exists because the first version quietly dropped the
second and later names in `export const A = 1, B = 2;`. That bundle loaded,
looked fine and computed nothing. Keep one declaration per exported statement,
and don't export a binding that is reassigned later.

## Terrain data

`data/terrain.png` packs a 512 × 512 north-up grid:

| Channel | Meaning |
| --- | --- |
| R, G | elevation in decimetres, big-endian: `elev_m = ((R << 8) \| G) / 10` |
| B | land fraction, 0 = sea, 255 = land |

Rebuild it with `npm run terrain` after `pip install -r requirements.txt`.

numpy is kept below version 2.5 there. On Windows with Smart App Control
switched on, the 2.5.x extension module is refused (`An Application Control
policy has blocked this file`) because that build doesn't yet have a reputation
with the service. Version 2.4.2 loads under the same policy, and the script
works the same with either.

The GSI tiles mark missing data with `"e"`, which over the sea means water, and
they return no tile at all for open sea. The land mask therefore comes from the
elevation data itself, so the coastline is the real one. The tiles are public
and need no key.

If you move the window, the script prints the km bounds to paste into
`js/params.js`. Rebuild `data/vectors.json` as well, or the roads and labels
will sit in the wrong place. `npm test` checks that the two agree.

## Map layers and places

`data/vectors.json` holds the Kagoshima city limit, the main road network
(motorway to secondary), the railways and the place names. Everything is
already projected into the model's kilometre grid centred on the vent, clipped
to the domain and simplified to within 60 m. Rebuild it with
`npm run vectors`. The script only uses the Python standard library, and it
caches what it downloads in `tools/.cache/`, so later rebuilds are quick.

The lines are real geometry draped over the terrain. Painting them into the
deposit texture would make each road a blurry band 195 m wide, which would
also have to be redrawn under the ash after every parameter change.

Places come in three tiers, drawn with different markers:

| Tier | What | Source |
| --- | --- | --- |
| 1 | cities of 50,000 people or more | OpenStreetMap `place=city` |
| 2 | other cities and towns | OpenStreetMap `place=city` and `place=town` |
| 3 | districts and former towns | OpenStreetMap `place=suburb` with an English name, and GeoNames |

Tiers 1 and 2 hold every city (市) and town (町) whose OpenStreetMap centre is inside the
map. Japanese municipalities were merged heavily in the 2000s, so several towns
people still know by name, such as Kajiki, are not tagged as places in
OpenStreetMap. GeoNames fills some of those gaps. Its positions are rougher, so
a GeoNames place is only used when no OpenStreetMap place is within 2.5 km and
it isn't a duplicate of a municipality.

When labels would overlap on screen, the less important one is hidden, so
zooming in shows more names. The vent and the tier 1 cities are always shown.
The vent, Kagoshima Airport and Shinmoedake are fixed in `js/params.js` as
longitude and latitude, with their kilometre offsets calculated. They were once
typed in kilometres by hand, which is how Tarumizu ended up 1.5 km out in the
bay.

## References

- Bonadonna, C., Ernst, G.G.J., Sparks, R.S.J. (1998). Thickness variations and volume estimates of tephra fall deposits: the importance of particle Reynolds number. *J. Volcanol. Geotherm. Res.* 81, 173–187.
- Bonadonna, C., Phillips, J.C. (2003). Sedimentation from strong volcanic plumes. *J. Geophys. Res.* 108(B7), 2340.
- Blong, R.J., Grasso, P., Jenkins, S.F. et al. (2017). Estimating building vulnerability to volcanic ash fall for insurance and other purposes. *J. Appl. Volcanol.* 6, 2. <https://doi.org/10.1186/s13617-017-0054-9>
- Connor, L.J., Connor, C.B. Tephra2. <https://github.com/geoscience-community-codes/tephra2>
- Degruyter, W., Bonadonna, C. (2012). Improving on mass flow rate estimates of volcanic eruptions. *Geophys. Res. Lett.* 39, L16308.
- Mastin, L.G. et al. (2009). A multidisciplinary effort to assign realistic source parameters to models of volcanic ash-cloud transport and dispersion during eruptions. *J. Volcanol. Geotherm. Res.* 186, 10–21.
- Newhall, C.G., Self, S. (1982). The volcanic explosivity index (VEI): an estimate of explosive magnitude for historical volcanism. *J. Geophys. Res.* 87(C2), 1231–1238.
- Suzuki, T. (1983). A theoretical model for dispersion of tephra. *Arc Volcanism: Physics and Tectonics*, 95–113.
- Takishita, K., Poulidis, A.P., Iguchi, M. (2021). Tephra4D: a Python-based model for high-resolution tephra transport and deposition simulations, with applications at Sakurajima volcano, Japan. *Atmosphere* 12, 331. <https://doi.org/10.3390/atmos12030331>
- Woodhouse, M.J. et al. (2013). Interaction between volcanic plumes and wind during the 2010 Eyjafjallajökull eruption, Iceland. *J. Geophys. Res. Solid Earth* 118, 92–109.

## Licence

MIT, see [LICENSE](LICENSE). Elevation data © Geospatial Information Authority
of Japan, used under its terms of use. Roads, railways, administrative
boundaries and most place names are ©
[OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, licensed
[ODbL 1.0](https://opendatacommons.org/licenses/odbl/). Some place names are from
[GeoNames](https://www.geonames.org/), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). If you reuse the
rendered map or `data/vectors.json`, those credits have to go with it.
