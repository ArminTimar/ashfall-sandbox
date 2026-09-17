// Volcanic Explosivity Index from erupted tephra volume.
//
// Newhall & Self (1982) define the VEI on several criteria, of which bulk
// tephra volume is the one a mass maps onto: each step above VEI 2 is a factor
// of ten. Column height is another criterion and is ignored here, so this is
// the volume-based class only. Mass becomes volume through the deposit bulk
// density, which means the class can move when that density does — a real
// ambiguity in the index, not an artefact of the sandbox.

export const VEI = [
  { vei: 0, lo: 0,    hi: 1e4,      example: 'Kīlauea lava lakes — effusive, barely explosive' },
  { vei: 1, lo: 1e4,  hi: 1e6,      example: "Stromboli's routine explosions" },
  { vei: 2, lo: 1e6,  hi: 1e7,      example: 'Whakaari / White Island, 2019' },
  { vei: 3, lo: 1e7,  hi: 1e8,      example: 'Nevado del Ruiz, 1985' },
  { vei: 4, lo: 1e8,  hi: 1e9,      example: 'Sakurajima, 1914 · Eyjafjallajökull, 2010' },
  { vei: 5, lo: 1e9,  hi: 1e10,     example: 'Mount St Helens, 1980' },
  { vei: 6, lo: 1e10, hi: 1e11,     example: 'Pinatubo, 1991' },
  { vei: 7, lo: 1e11, hi: 1e12,     example: 'Tambora, 1815' },
  { vei: 8, lo: 1e12, hi: Infinity, example: 'Toba, ~74 ka' }
];

/** VEI class for a bulk tephra volume in cubic metres. */
export function veiOfVolume(m3) {
  for (const c of VEI) if (m3 < c.hi) return c;
  return VEI[VEI.length - 1];
}

/** VEI class for an erupted mass in kg at a given bulk density in kg/m^3. */
export function veiOfMass(kg, rho) {
  return veiOfVolume(kg / Math.max(rho, 1));
}
