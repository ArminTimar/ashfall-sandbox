// The volcanoes on the map, their vents and their eruption presets.
//
// Every preset lists where each number comes from. Values marked "assumed" are
// not published for that eruption and were chosen as plausible starting
// points. Wind is usually one of those: papers give the direction the ash went,
// rarely the wind profile, so the direction is read from the deposit and the
// speeds are typical for the season.
//
// Mass from a dense rock equivalent (DRE) volume uses 2,500 kg/m^3.
//
// Each volcano also carries its own live parameters (p), its own deposit field
// and its own particle cloud, so eruptions at different volcanoes are set up
// independently and can run at the same time.

import { toEN } from './proj.js';

export const SOURCES = {
  takishita2024: {
    cite: 'Takishita, Poulidis & Iguchi (2024), Earth Planets Space 76, 29',
    url: 'https://doi.org/10.1186/s40623-023-01952-y'
  },
  oishi2018: {
    cite: 'Oishi et al. (2018), Bull. Volcanol. 80, 42',
    url: 'https://doi.org/10.1007/s00445-018-1215-3'
  },
  todde2017: {
    cite: 'Todde et al. (2017), Bull. Volcanol. 79, 72',
    url: 'https://doi.org/10.1007/s00445-017-1154-4'
  },
  nakada2013: {
    cite: 'Nakada et al. (2013), Earth Planets Space 65, 475',
    url: 'https://doi.org/10.5047/eps.2013.03.016'
  },
  maeno2014: {
    cite: 'Maeno et al. (2014), Bull. Volcanol. 76, 823',
    url: 'https://doi.org/10.1007/s00445-014-0823-9'
  },
  tsuji2020: {
    cite: 'Tsuji, Nishizaka & Ohnishi (2020), Earth Planets Space 72, 104',
    url: 'https://doi.org/10.1186/s40623-020-01233-y'
  },
  gsj1995kuju: {
    cite: 'Geological Survey of Japan, Kuju: 4. Historic eruptions',
    url: 'https://gbank.gsj.jp/volcano/Act_Vol/kuju/text/eng/exp-3e.html'
  },
  osm: {
    cite: 'OpenStreetMap summit node',
    url: 'https://www.openstreetmap.org/copyright'
  }
};

// Starting values for a volcano with no literature preset yet.
export const GENERIC = {
  H: 5, logM: 9, phi: 2, sig: 1.5, suz: 4,
  dir: 270, spd: 10, top: 25, shear: 0, K: 2500, rho: 1000, dur: 1800
};

export const VOLCANOES = [
  {
    id: 'sakurajima',
    name: 'Sakurajima',
    vent: 'Minamidake crater',
    lon: 130.6580, lat: 31.5806, ventZ: 1000,
    ventSrc: 'takishita2024',
    refs: ['Kagoshima', 'Tarumizu'],
    presets: [
      {
        id: 'vulcanian',
        name: 'Routine Vulcanian explosion',
        p: { H: 1.5, logM: 6.5, phi: 2.5, sig: 1.5, suz: 2,
             dir: 270, spd: 8, top: 20, shear: 0, K: 1000, rho: 1000, dur: 600 },
        notes: [
          ['Plume 1.5 km above the vent, the explosion of 27 June 2022', 'takishita2024'],
          ['Mass 3 × 10⁶ kg, within the 0.9 to 5.1 × 10⁶ kg per explosion measured in 2011 to 2015, which are minimum estimates', 'oishi2018'],
          ['Release low in the column (A = 2): most particles segregate at 1 to 3 km above sea level, far below the column top', 'takishita2024'],
          ['Grain size, wind and K assumed']
        ]
      },
      {
        id: 'taisho',
        name: 'Taishō 1914, subPlinian phase',
        p: { H: 15, logM: 11.35, phi: 1, sig: 2, suz: 4,
             dir: 290, spd: 15, top: 45, shear: 0, K: 5000, rho: 1000, dur: 7200 },
        notes: [
          ['Column 15.0 ± 1.2 km above the vent', 'todde2017'],
          ['Mass 2.25 × 10¹¹ kg from 0.09 km³ DRE (bulk 0.33 km³)', 'todde2017'],
          ['Wind from the WNW, read from the ESE to SE dispersal', 'todde2017'],
          ['Wind speeds, grain size and K assumed. The real deposit is polymodal']
        ]
      }
    ]
  },
  {
    id: 'shinmoedake',
    name: 'Shinmoedake',
    vent: 'Kirishima volcano group',
    lon: 130.88643, lat: 31.90965, ventZ: 1421,
    ventSrc: 'osm',
    refs: ['Miyakonojo', 'Takaharu'],
    presets: [
      {
        id: 'subplinian2011',
        name: '26 and 27 January 2011 subplinian explosions',
        p: { H: 7, logM: 10.3, phi: 1.5, sig: 2, suz: 4,
             dir: 315, spd: 15, top: 35, shear: 0, K: 3000, rho: 1000, dur: 7200 },
        notes: [
          ['Plumes 6.4 to 7.3 km above the vent', 'maeno2014'],
          ['Mass 2 × 10¹⁰ kg, within 1.4 to 2.5 × 10¹⁰ kg for the two main explosions together', 'nakada2013'],
          ['Wind from the NW, read from the dispersal to the SE', 'maeno2014'],
          ['Wind speeds, grain size and K assumed']
        ]
      }
    ]
  },
  {
    id: 'aso',
    name: 'Aso',
    vent: 'Nakadake first crater',
    lon: 131.0852, lat: 32.8845, ventZ: 1200,
    ventSrc: null,
    refs: ['Aso', 'Kumamoto'],
    presets: [
      {
        id: 'oct2016',
        name: '8 October 2016 phreatomagmatic explosion',
        p: { H: 10.7, logM: 8.8, phi: -0.5, sig: 2.3, suz: 4,
             dir: 225, spd: 9, top: 30, shear: 45, K: 3000, rho: 1000, dur: 190 },
        notes: [
          ['Plume top 11.9 km above sea level, 10.7 km above the vent', 'tsuji2020'],
          ['Mass 6.3 × 10⁸ kg, within 6.0 to 6.5 × 10⁸ kg in total', 'tsuji2020'],
          ['Grain size from the dry-sieved total distribution, mean −0.5 φ, sorting 2.3 φ', 'tsuji2020'],
          ['Wind from the SE to SW low down and from the west aloft, 2 to 39 m/s', 'tsuji2020'],
          ['Eruption 160 to 220 s long', 'tsuji2020'],
          ['Ash aggregation, important in this eruption, is not modelled. K assumed']
        ]
      }
    ]
  },
  {
    id: 'kuju',
    name: 'Kujū',
    vent: 'Hosshōzan north flank',
    lon: 131.2378, lat: 33.0985, ventZ: 1500,
    ventSrc: null,
    refs: ['Taketa', 'Kumamoto'],
    presets: [
      {
        id: 'oct1995',
        name: 'October 1995 phreatic eruption',
        p: { H: 1, logM: 7.35, phi: 3.5, sig: 1.5, suz: 2,
             dir: 80, spd: 8, top: 15, shear: 0, K: 1000, rho: 1000, dur: 3600 },
        notes: [
          ['Plume about 1,000 m high, on the evening of 11 October 1995', 'gsj1995kuju'],
          ['Wind from the east: the ash fell to the west, reaching Kumamoto about 70 km away', 'gsj1995kuju'],
          ['Mass 2.2 × 10⁷ kg, from a reported 2 × 10⁴ m³ of ash at 1,000 kg/m³. That volume is from secondary summaries of Japanese reports, not from a paper I could read, so treat it as a rough figure'],
          ['The eruption was phreatic, turning phreatomagmatic', 'gsj1995kuju'],
          ['Wind speeds, grain size and K assumed']
        ]
      }
    ]
  },
  {
    id: 'unzen',
    name: 'Unzen',
    vent: 'Heisei-shinzan',
    lon: 130.2989, lat: 32.76135, ventZ: 1483,
    ventSrc: 'osm',
    refs: ['Shimabara', 'Kumamoto'],
    presets: []
  },
  {
    id: 'kaimondake',
    name: 'Kaimondake',
    vent: 'summit',
    lon: 130.52844, lat: 31.17996, ventZ: 924,
    ventSrc: 'osm',
    refs: ['Ibusuki', 'Kagoshima'],
    presets: []
  }
];

for (const v of VOLCANOES) {
  const [E, N] = toEN(v.lon, v.lat);
  Object.assign(v, {
    E, N,
    p: Object.assign({}, v.presets.length ? v.presets[0].p : GENERIC),
    preset: v.presets.length ? v.presets[0].id : null,
    erupting: v.id === 'sakurajima',
    field: null,
    cloud: null
  });
}

export function volcanoById(id) {
  return VOLCANOES.find((v) => v.id === id) || null;
}

/** Load a preset into a volcano's live parameters. */
export function applyPreset(v, presetId) {
  const pr = v.presets.find((x) => x.id === presetId);
  if (!pr) return false;
  Object.assign(v.p, pr.p);
  v.preset = presetId;
  return true;
}
