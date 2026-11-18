# How this sits next to Tephra2 and Tephra4D

Notes taken from reading the source of both, not the manuals.

## Tephra2

[github.com/geoscience-community-codes/tephra2](https://github.com/geoscience-community-codes/tephra2)
— C, MPI-parallel. The reference implementation of this formulation.

### The same in both

| | |
| --- | --- |
| Kernel | Suzuki/Connor analytical advection–diffusion, summed over release heights and grain sizes |
| Settling | Reynolds-dependent three-regime terminal velocity, switched at Re 6 and Re 500, through an exponential atmosphere with an 8200 m scale height |
| Grain size | Gaussian in φ, particle density interpolated linearly with φ |
| Diffusion | Same coarse-particle law and the same plume head-start τ, matched to their constants, so `K` is directly comparable |

A note on that last row. Tephra2's kernel is `(M/πσ)·exp(−r²/σ)` normalised by
`πσ`, with `σ = 4K(t+τ)`. Because of where the factor of two sits in the
exponent, the per-axis variance is `2K(t+τ)`, not `4Kt`. This project originally
used `4Kt` as the per-axis variance — twice the diffusion for the same `K` —
which was not wrong so much as incomparable to the literature. It now matches.

The plume head start comes from `tephra2_calc.c`:

```c
T[i][j].plume_diffusion_coarse_particle =
    0.0032 * (ht_above_vent * ht_above_vent) / erupt->diffusion_coefficient;
```

### Different in detail

Checked against `common_src/tephra2_calc.c` and `parameters.h`.

| | Tephra2 | Here |
| --- | --- | --- |
| Column | `plume_pdf0` uniform above a set fraction of the column, `plume_pdf1` log-normal, `plume_pdf2` beta. No Suzuki function | Suzuki, `(1 − ζ)·exp(A(ζ − 1))` |
| Air | 1.293 kg/m³ at sea level, viscosity 1.8325 × 10⁻⁵ Pa·s | 1.225 kg/m³, 1.8 × 10⁻⁵ Pa·s |
| Particle density | Pumice density at φ −1 and coarser, lithic density at φ 7 and finer, both set by the user | 1200 kg/m³ at φ −5 to 2400 at φ 5, fixed |
| Buoyancy | Settling laws use the particle density | They use particle minus air density |

The air values make grains here settle 2 to 3% faster. An earlier version of
this page listed the column under "the same in both", which was wrong.

### Tephra2 has, this does not

- **Inversion.** The most important difference by far. Tephra2 ships an
  inversion built on a downhill simplex (`inversion_src/ameoba.c`) that fits
  plume height, erupted mass, diffusion coefficient and wind to measured deposit
  thicknesses. That inverts the problem you actually have as a field
  volcanologist: you have a deposit and want the eruption. This runs forward
  only.
- **Power-law diffusion.** A second regime for fine, long-falling particles,
  switched on `FALL_TIME_THRESHOLD`:

  ```c
  if (total_fall_time >= erupt->fall_time_threshold)
      sigma = erupt->eddy_constant
            * pow((total_fall_time + T[i][j].plume_diffusion_fine_particle), 2.5);
  ```

  with `eddy_constant` pre-multiplied by 8/5 at init and
  `plume_diffusion_fine_particle = (0.2·h²)^0.4`.
- **Ground elevation.** Tephra2 computes a fall-time adjustment between vent
  elevation and each grid point's own elevation, so ash landing on a ridge has
  fallen a shorter distance through denser air.
- **Real wind.** A layered wind file, one line per height with speed and
  direction, so you feed it an actual radiosonde or reanalysis profile.
- **Scale.** MPI across many cores, for thousands of grid points by thousands of
  scenarios, which is what probabilistic tephra hazard assessment needs.

### This has, Tephra2 does not

- Live interaction with 3D terrain.
- The Mastin source-consistency check, which flags a plume height and erupted
  mass that cannot belong to the same eruption. Tephra2 takes both as
  independent inputs and will not object.
- Wind and air density integrated every 100 m of fall rather than averaged over
  the path. Mostly cosmetic, since the input data is layered anyway.

## Tephra4D

[github.com/Kosei-Takishita/Tephra4D](https://github.com/Kosei-Takishita/Tephra4D)
— Python. Takishita, Poulidis & Iguchi (2021), built at the Sakurajima Volcano
Research Center, DPRI, Kyoto University.

Not a successor to Tephra2 but a modification of it, for this volcano. The "4D"
is three spatial dimensions plus time.

**The diffusion is Tephra2's, unchanged.** Same kernel, both regimes, with one
neat simplification: instead of a fall-time threshold parameter it takes
whichever regime gives the larger σ, so the crossover happens where the curves
cross.

```python
sigma1 = 1.6 * C * t ** 2.5
sigma2 = 4 * K * t
w0 = 1 / (np.maximum(sigma1, sigma2) * 3.141592) * np.exp(
     -(dx ** 2 + dy ** 2) / np.maximum(sigma1, sigma2))
```

What it replaces is the transport.

- **4D wind.** A full WRF field, 300 m horizontal, 58 vertical levels, updated
  every 10 minutes, cubic-spline interpolated — they reimplemented FALL3D's
  `setdbs` utility in Python to do it. Vertical wind and per-box air density come
  from WRF too, rather than an exponential profile. Tephra2's wind is
  horizontally uniform and steady; this is where the orographic effects at
  Sakurajima live.
- **Curved trajectories.** Each particle class is stepped box to box through that
  field, and Tephra2's Gaussian is then applied around wherever the trajectory
  ends up. Same kernel, bent path.
- **Measured settling.** Particles are discretised by the terminal-velocity bins
  of the team's own disdrometer, with diameters back-derived, plus a shape-factor
  correction. Tephra2 discretises by diameter and assumes spheres.
- **Real plume rise.** An optional Woodhouse et al. (2013) PlumeRise
  implementation: the coupled ODEs for mass flux, momentum, plume angle and
  enthalpy along the axis, Runge–Kutta integrated. A bent plume solved rather
  than a Suzuki column assumed. Combining it with Tephra2_PY reproduces WT
  (Mannen et al. 2020).
- **The cost.** It needs WRF output for the eruption you want to model, and the
  repository ships dummy data in place of the real inputs. That is the real
  barrier to using it, not the code.

## Summary

Tephra2 is an instrument for fitting real deposits. Tephra4D is what you reach
for when the volcano's own terrain bends the wind. This is a device for seeing
the shape of the answer — worth building because the parameters stop being
abstract once you have watched them move, and worth being honest about
afterwards.
