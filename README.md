# Kyushu Ashfall Sandbox

An interactive model of volcanic ash fall for the volcanoes of Kyushu, running
in the browser on elevation data from the Geospatial Information Authority of
Japan. Pick a volcano, set its eruption and its wind, then watch the plume bend
and the ash settle over the island. Several volcanoes can erupt at once, each
with its own settings.

Everything is in JGD2011 / Japan Plane Rectangular CS II (EPSG:6670) on a 200 m
grid aligned to round coordinates, so saved views and future exports line up
with QGIS and other GIS software.

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
npm run bundle       # writes dist/index.html, about 5.6 MB
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

**Camera.** Drag to orbit, right-drag or Shift-drag to pan, scroll or pinch to
zoom, and drag with two fingers to pan on a phone. The camera centre can follow
any volcano, which is what Rotate and the Oblique and Plan buttons turn around.
Picking a volcano there flies the camera to it. Panning switches to a free
camera. The Kyushu button shows the whole island. The camera target can't
leave the map.

**Themes.** Dark has a dark sky and warm ash colours. Light has a blue sky, a
blue sea running to the horizon and ash in greys to near black. The choice is
remembered in the browser.

**Saving.** "Save view as PNG" downloads the current frame.

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

## Volcanoes and presets

| Volcano | Vent | Presets |
| --- | --- | --- |
| Sakurajima | Minamidake crater, 1,000 m | Routine Vulcanian explosion. Taishō 1914, subPlinian phase |
| Shinmoedake | summit crater, 1,421 m | 26 and 27 January 2011 subplinian explosions |
| Aso | Nakadake first crater, about 1,200 m | 8 October 2016 phreatomagmatic explosion |
| Kujū | Hosshōzan north flank, about 1,500 m | 11 October 1995 phreatic eruption |
| Unzen | Heisei-shinzan, 1,483 m | none yet |
| Kaimondake | summit, 924 m | none yet |

Every preset lists the source of each number next to the buttons, with links.
Plume heights, masses and, where published, grain size and wind come from the
literature. Anything not published for that eruption is marked as assumed. Wind
is usually one of those: papers give the direction the ash went more often than
the wind profile, so the direction is read from the deposit and the speeds are
typical for the season. Unzen and Kaimondake are on the map as vents, but I
didn't find a published plume height and mass for a single eruption at either,
so they start from round values.

The catalogue lives in `js/volcanoes.js`. Adding a volcano means adding a vent
position, a vent height, two reference places for the readouts and any presets.

Each volcano keeps its own eruption parameters, wind, deposit and particle
cloud. Deposits from several erupting volcanoes add together on the map. Their
clouds don't interact, so two eruptions with different winds simply overlap.

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

A big eruption has Gaussians tens of kilometres wide, and evaluating each one
at every 200 m cell would take seconds. Each Gaussian is instead sampled on a
coarser lattice, every 2nd to 64th cell, with a spacing of at most a third of
its σ, and each lattice is interpolated up to 200 m once. Against a brute-force
sum the total mass and the peak agree within 0.01% and the worst single cell
above 1% of the peak within about 6%.

| Component | Treatment |
| --- | --- |
| Settling velocity | Three regimes after Bonadonna et al. (1998): Stokes below Re 6, an intermediate law up to Re 500, Newton above that |
| Particle density | Depends on grain size, from 1200 kg/m³ for coarse vesicular clasts to 2400 for fine glass and crystal fragments |
| Atmosphere | Exponential density profile, scale height 8200 m, viscosity 1.8 × 10⁻⁵ Pa·s |
| Column | Suzuki distribution over release height. Release peaks at 1 − 1/A of the plume height |
| Grain size | Gaussian in φ, 12 bins from φ −5 (32 mm) to φ 5 (31 µm), renormalised |
| Wind | Speed interpolated between the 2 km and 12 km values, direction turning evenly by the shear angle over the same range. One profile per volcano |
| Source consistency | Mastin et al. (2009), `H = 2.00·V̇^0.241`, inverted to flag a plume height and erupted mass that can't belong to the same eruption |
| Coordinates | JGD2011 / Japan Plane Rectangular CS II (EPSG:6670), transverse Mercator on GRS80, checked against pyproj to under 0.1 mm |
| Terrain | GSI 標高タイル (PNG) zoom 11, warped to a 200 m grid of 1,310 × 1,710 cells covering 262 × 342 km |
| Map layers | OpenStreetMap main roads, railways, prefecture borders and place names |
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

Ash stays up a long time. Measured over the presets, the median particle is in
the air 16 to 53 model minutes, and the finest tail drifts for hours before
landing or leaving the map. Nothing hangs there forever: in five model hours a
steady cloud turns over two to ten times. Playback defaults to 120 times real
speed, so a typical flight takes about ten seconds to watch.

### The cloud and the deposit are the same model

The particles follow the settling velocity, wind and diffusion the deposit is
built from, so they have to put the same share of the mass at the same
distances. For a 9 km plume of 10¹¹ kg:

| Beyond | Deposit mass | Landed particles |
| --- | --- | --- |
| 10 km | 84.4% | 85.8% |
| 25 km | 54.2% | 56.1% |
| 50 km | 27.0% | 26.3% |

`test/particles.mjs` checks this on every run and fails if any ring differs by
more than 8 points.

The cloud still looks wider than the isopachs, for two reasons that are both
real rather than a disagreement. It shows ash that is still in the air, which
is spread along the whole flight rather than gathered where it will land. And
some of that ash lands beyond the map: for the Taishō preset 26% of the
particles leave the map, so the deposit never draws them. The readout under the
map reports that share.

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

`npm test` runs seven scripts.

**`test/proj.mjs`** compares the projection with pyproj at six points across
Kyushu and round-trips a grid covering the map. The largest difference is
0.06 mm.

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
and clear. Particles have to land at the same distances as the deposit puts its
mass. No particle's vertical velocity may change by more than 4 m/s in
one second, and none may jump more than 700 m sideways (the previous scheme
reached 27 m/s and 1.4 km when it released a particle). Particles have to land
within 15% of the deposit's centre, and two volcanoes' clouds have to stay
separate.

**`test/orientation.mjs`** guards the boundary between south-up and north-up
grids. The physics grid stores row 0 as the southern edge, and the elevation
model and the drawn texture store row 0 as the northern edge. Getting that
wrong draws the deposit mirrored against the terrain **while every number in
the readouts stays correct**. A deposit blown due west looks almost the same
mirrored, so the bug hides until the wind has a north or south component. It
was in the code once. The test turns the wind to each compass point and
requires the two centres to coincide. It also checks the multi-resolution
deposit against a brute-force sum of every Gaussian at every cell.

**`test/geography.mjs`** checks that the elevation model, the map layers and the
place labels describe the same map, that the map includes Kitakyushu, Nagasaki,
Hirado, Amakusa, Oita and Cape Sata but not Tsushima, Gotō, Tanegashima or
Satsuma-Iōjima, that every vent is on land within 350 m of its DEM height, and
that every readout place exists.

**`test/markup.mjs`** and **`test/inputs.mjs`** check that the page and the
modules agree on element ids and help entries, that typed values and units are
read correctly, and that the cache-busting stamp matches the version.

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
  fall time for the ground height at each point. Doing that here would mean
  evaluating every Gaussian at every cell again, which the multi-resolution
  scheme exists to avoid.
- **Column motion is a sketch.** The updraft profile and plume lean in the
  animation are simple forms with round-number constants, chosen to look and
  behave plausibly. They are not a plume model such as the one in Degruyter &
  Bonadonna (2012), and they don't feed into the deposit.
- **Map edge.** Ash blown out to sea past the map edge is gone. The readout
  reports how much of the selected volcano's erupted mass landed on the map,
  which for the Taishō preset is about three quarters.
- **The far tail is too heavy.** With no aggregation and Fickian diffusion
  only, the finest ash drifts further than it would in reality, which puts more
  mass at the edges of the map than a real deposit would have.
- **Independent eruptions.** Each volcano has its own wind, so two eruptions on
  the same day can have contradictory winds. That is deliberate for now.
- **Presets are partly assumed.** See the notes under each preset for which
  numbers are published and which are not.
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
4. **More volcanoes and presets.** Add them to `js/volcanoes.js`. Kikai and the
   other volcanoes south of Kyushu would need the map extended or a second
   map.
5. **Exports.** The grid is already aligned to 200 m in EPSG:6670. A GeoTIFF or
   ASCII grid of the deposit, and isopachs as GeoJSON, would open directly in
   QGIS. Recording the canvas over time would give animations.

## Files

```
index.html              the app
css/style.css
js/proj.js              EPSG:6670 projection  (no imports, tested against pyproj)
js/params.js            constants, map grid, display settings, airports
js/volcanoes.js         vents, presets and their sources
js/physics.js           settling, wind, fall integration, deposit fields
js/grid.js              orientation flip and marching squares (pure, tested)
js/terrain.js           elevation model decoding and lookup
js/terrainmesh.js       chunked level-of-detail terrain surface
js/texture.js           land and sea colours, deposit raster, isopachs, themes
js/particles.js         particle clouds, one per erupting volcano
js/vectors.js           roads, rail and prefecture borders, draped on the terrain
js/scene.js             three.js, sea and sky, camera, labels
js/ui.js                controls, typed values and readouts
js/parse.js             reads typed quantities and units  (pure, tested)
js/vei.js               VEI classes and example eruptions  (pure, tested)
js/help.js              the ? explanations and their popover
js/main.js              wiring
data/terrain.png        packed elevation model, see below
data/terrain.json       its grid: EPSG code, edges, cell size, dimensions
data/vectors.json       roads, railways, borders and places, in km of EPSG:6670
tools/proj.py           the same projection for the build scripts
tools/build_terrain.py  rebuilds data/terrain.png from GSI tiles
tools/build_vectors.py  rebuilds data/vectors.json from OpenStreetMap and GeoNames
requirements.txt        python packages for build_terrain.py (see below)
tools/serve.mjs         static server with no dependencies
tools/stamp.mjs         tags modules and data with the version, see below
tools/bundle.mjs        flattens everything into dist/index.html
test/                   node test scripts
```

## Releasing

GitHub Pages tells browsers to keep files for ten minutes. After a release a
browser can therefore load the new `index.html` alongside modules it cached
from the previous version, and the page breaks on ids that no longer exist.
That happened once, between v0.4.0 and v0.5.0.

So before a release, bump the version in `package.json` and run:

```bash
node tools/stamp.mjs
```

It writes an import map into `index.html` that points every module at
`js/<name>.js?v=<version>`, and a `data-version` meta tag that `main.js` uses
for the data files. New version, new URLs, nothing stale reused. The source
files keep plain relative imports, so the tests and the bundler are unaffected,
and `npm test` fails if the stamp is missing or out of date.

`tools/bundle.mjs` rewrites each module as a function that returns its
exports, then checks every imported name against what the exporting module
really exports. The check exists because the first version quietly dropped the
second and later names in `export const A = 1, B = 2;`. That bundle loaded,
looked fine and computed nothing. Keep one declaration per exported statement,
and don't export a binding that is reassigned later.

## Terrain data

`data/terrain.png` packs a 1,310 × 1,710 north-up grid (1.7 MB), described by
`data/terrain.json`:

| Channel | Meaning |
| --- | --- |
| R, G | elevation in decimetres, big-endian: `elev_m = ((R << 8) \| G) / 10` |
| B | land fraction, 0 = sea, 255 = land |

The map is a rectangle from −154 to +108 km east and −230 to +112 km north in
EPSG:6670, which is mainland Kyushu plus the islands close to it: Amakusa,
Nagashima, Hirado, the Koshiki islands and Iki. Tsushima, Gotō, Tanegashima,
Yakushima and Kikai are outside it. A little of Honshu around Shimonoseki is
inside it too.

Rebuild it with `npm run terrain` after `pip install -r requirements.txt`. The
script downloads 437 GSI elevation PNG tiles at zoom 11 (about 64 m per pixel),
caches them in `tools/.cache/`, averages 3 × 3 pixels and warps the result onto
the 200 m grid.

numpy is kept below version 2.5 there. On Windows with Smart App Control
switched on, the 2.5.x extension module is refused (`An Application Control
policy has blocked this file`) because that build doesn't yet have a reputation
with the service. Version 2.4.2 loads under the same policy, and the script
works the same with either.

GSI returns no tile at all for open sea and marks missing values inside tiles,
which over water means sea. The land mask comes from that, so the coastline is
the real one. The tiles are public and need no key.

To move the map, change the rectangle at the top of `tools/build_terrain.py`
and rebuild `data/vectors.json` as well. `npm test` checks that the two agree.

On screen the whole grid is built once, at full resolution, about 1.6 million
vertices. It is cut into 64 × 64 cell chunks only so the renderer can skip the
ones that are off screen, and chunks with no land in them are drawn coarsely
since they are flat.

An earlier version chose a vertex spacing per chunk from the camera distance.
That looked fine inland and was wrong on every coast: sampling every 8th or
16th cell drops the cells that carry a coastline, so coastal land sank under
the sea plane and the shore changed shape whenever the camera moved. Drawing
every cell all the time costs about 8 ms a frame on Intel integrated graphics,
which is cheaper than the bugs.

Heights are stored in real kilometres and the vertical exaggeration is a scale
applied to the whole scene, so that slider never rebuilds anything.

Low ground needs two more things to draw correctly. The camera sees from a few
hundred metres to hundreds of kilometres, which an ordinary depth buffer cannot
resolve, so the renderer uses a logarithmic one and the near and far planes
follow the camera distance. The ground also carried a polygon offset, added so
draped roads would win the depth test, and at a shallow viewing angle that
offset grows with the depth slope and pushed flat land behind the sea. The
roads lift themselves in their own shader instead. Without those two fixes the
Saga and Chikugo plains, a few metres above sea level, flickered underwater and
the coastline changed shape as the camera turned.

## Map layers and places

`data/vectors.json` (2.7 MB, 770 KB compressed) holds the main road network,
the railways, the prefecture borders on land and the place names, already in
kilometres of EPSG:6670, clipped to the map and simplified to within 60 m.
Rebuild it with `npm run vectors`. The script only uses the Python standard
library. It queries Overpass in 16 pieces so no request times out, and caches
the answers in `tools/.cache/`, so later rebuilds take seconds.

The lines are real geometry draped over the terrain. Far from the camera the
terrain is drawn with fewer vertices than the roads follow, so the lines are
lifted in the shader by an amount that grows with camera distance. Secondary
roads only show within 90 km of the camera.

Place names are grouped by size, and each group has its own switch:

| Group | What | Shown within | On by default |
| --- | --- | --- | --- |
| Major cities | 300,000 people or more | any distance | yes |
| Cities | 100,000 or more | 340 km | yes |
| Airports | the nine in the window | 200 km | yes |
| Towns | 10,000 or more | 150 km | no |
| Villages | under 10,000 | 70 km | no |
| Districts | city wards and former towns | 45 km | no |

Anything within 30 km of a volcano is shown whatever its size, out to 160 km
of camera distance, since those are the places an ashfall map is about. That
is a switch too.

Labels never overlap. Each name tries six positions around its dot, above
first and then beside or below it, and is hidden if none of them is free. The
text also shrinks from 10 px to about 7 px as the camera pulls back. A label's
dot stays on its place even when the name moves aside.

The data behind the groups is OpenStreetMap `place=city`, `town`, `village` and
`suburb`, plus GeoNames. Japanese municipalities were merged heavily in the
2000s, so many towns people still know by name, such as Kajiki, are not tagged
as places in OpenStreetMap.
GeoNames fills some of those gaps. Its positions are rougher, so a GeoNames
place is only used when no OpenStreetMap place is within 2.5 km and it isn't a
copy of a nearby municipality.

Airports and volcanoes are defined by longitude and latitude in `js/params.js`
and `js/volcanoes.js`, with their grid positions calculated.

## References

- Bonadonna, C., Ernst, G.G.J., Sparks, R.S.J. (1998). Thickness variations and volume estimates of tephra fall deposits: the importance of particle Reynolds number. *J. Volcanol. Geotherm. Res.* 81, 173–187.
- Bonadonna, C., Phillips, J.C. (2003). Sedimentation from strong volcanic plumes. *J. Geophys. Res.* 108(B7), 2340.
- Blong, R.J., Grasso, P., Jenkins, S.F. et al. (2017). Estimating building vulnerability to volcanic ash fall for insurance and other purposes. *J. Appl. Volcanol.* 6, 2. <https://doi.org/10.1186/s13617-017-0054-9>
- Connor, L.J., Connor, C.B. Tephra2. <https://github.com/geoscience-community-codes/tephra2>
- Degruyter, W., Bonadonna, C. (2012). Improving on mass flow rate estimates of volcanic eruptions. *Geophys. Res. Lett.* 39, L16308.
- Mastin, L.G. et al. (2009). A multidisciplinary effort to assign realistic source parameters to models of volcanic ash-cloud transport and dispersion during eruptions. *J. Volcanol. Geotherm. Res.* 186, 10–21.
- Maeno, F., Nagai, M., Nakada, S. et al. (2014). Constraining tephra dispersion and deposition from three subplinian explosions in 2011 at Shinmoedake volcano, Kyushu, Japan. *Bull. Volcanol.* 76, 823. <https://doi.org/10.1007/s00445-014-0823-9>
- Nakada, S., Nagai, M., Kaneko, T., Suzuki, Y., Maeno, F. (2013). The outline of the 2011 eruption at Shinmoe-dake (Kirishima), Japan. *Earth Planets Space* 65, 475–488. <https://doi.org/10.5047/eps.2013.03.016>
- Newhall, C.G., Self, S. (1982). The volcanic explosivity index (VEI): an estimate of explosive magnitude for historical volcanism. *J. Geophys. Res.* 87(C2), 1231–1238.
- Oishi, M., Nishiki, K., Geshi, N. et al. (2018). Distribution and mass of tephra-fall deposits from volcanic eruptions of Sakurajima Volcano based on posteruption surveys. *Bull. Volcanol.* 80, 42. <https://doi.org/10.1007/s00445-018-1215-3>
- Suzuki, T. (1983). A theoretical model for dispersion of tephra. *Arc Volcanism: Physics and Tectonics*, 95–113.
- Takishita, K., Poulidis, A.P., Iguchi, M. (2021). Tephra4D: a Python-based model for high-resolution tephra transport and deposition simulations, with applications at Sakurajima volcano, Japan. *Atmosphere* 12, 331. <https://doi.org/10.3390/atmos12030331>
- Takishita, K., Poulidis, A.P., Iguchi, M. (2024). Tephra segregation profiles based on disdrometer observations and tephra dispersal modeling: Vulcanian eruptions of Sakurajima volcano, Japan. *Earth Planets Space* 76, 29. <https://doi.org/10.1186/s40623-023-01952-y>
- Todde, A., Cioni, R., Pistolesi, M., Geshi, N., Bonadonna, C. (2017). The 1914 Taisho eruption of Sakurajima volcano: stratigraphy and dynamics of the largest explosive event in Japan during the twentieth century. *Bull. Volcanol.* 79, 72. <https://doi.org/10.1007/s00445-017-1154-4>
- Tsuji, T., Nishizaka, N., Ohnishi, K. (2020). Influence of particle aggregation on the tephra dispersal and sedimentation from the October 8, 2016, eruption of Aso volcano. *Earth Planets Space* 72, 104. <https://doi.org/10.1186/s40623-020-01233-y>
- Geological Survey of Japan. Kuju: 4. Historic eruptions. <https://gbank.gsj.jp/volcano/Act_Vol/kuju/text/eng/exp-3e.html>
- Woodhouse, M.J. et al. (2013). Interaction between volcanic plumes and wind during the 2010 Eyjafjallajökull eruption, Iceland. *J. Geophys. Res. Solid Earth* 118, 92–109.

## Licence

MIT, see [LICENSE](LICENSE). Elevation data © Geospatial Information Authority
of Japan, used under its terms of use. Roads, railways, prefecture borders and
most place names are ©
[OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, licensed
[ODbL 1.0](https://opendatacommons.org/licenses/odbl/). Some place names are from
[GeoNames](https://www.geonames.org/), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). If you reuse the
rendered map or `data/vectors.json`, those credits have to go with it.
