// The terrain surface, split into chunks drawn at a level of detail that
// follows the camera.
//
// Kyushu at 200 m is about 1,300 by 1,700 vertices, too many to draw as one
// mesh on a phone. The grid is cut into 64 by 64 cell chunks. Each frame every
// chunk picks a vertex spacing of 1, 2, 4 ... 64 cells from its distance to the
// camera, aiming for roughly six screen pixels per triangle edge, and rebuilds
// its geometry when that changes. Chunks that are entirely sea never need more
// than their corners.
//
// Neighbouring chunks at different spacings don't meet exactly, so every chunk
// has a skirt: a strip hanging down from its edge that hides the gap.
//
// Normals come from the full elevation grid, not from the triangles, so the
// shading doesn't jump where two spacings meet.

import { GRID, P } from './params.js';
import { DEM } from './terrain.js';

const CHUNK = 64;
const PX_ERROR = 6;
const REBUILDS_PER_FRAME = 24;

const chunks = [];
let group = null, material = null;

/** Build the chunk list and add the (still empty) group to the scene. */
export function initTerrainMesh(scene, mat) {
  material = mat;
  group = new THREE.Group();
  scene.add(group);
  const { nx, ny, cell, west, north } = GRID;
  for (let r0 = 0; r0 < ny - 1; r0 += CHUNK) {
    for (let i0 = 0; i0 < nx - 1; i0 += CHUNK) {
      const w = Math.min(CHUNK, nx - 1 - i0), h = Math.min(CHUNK, ny - 1 - r0);
      let top = 0;
      for (let r = r0; r <= r0 + h; r++) {
        for (let i = i0; i <= i0 + w; i++) {
          const e = DEM.elev[r * nx + i];
          if (e > top) top = e;
        }
      }
      chunks.push({
        i0, r0, w, h, top, level: 0, mesh: null,
        cx: (west + (i0 + w / 2 + 0.5) * cell) / 1000,
        cz: -(north - (r0 + h / 2 + 0.5) * cell) / 1000
      });
    }
  }
  return group;
}

/** Force every chunk to rebuild, e.g. after the vertical exaggeration changes. */
export function invalidateTerrain() {
  for (const c of chunks) c.level = 0;
}

/** Vertex spacing, in cells, a chunk needs at a camera distance of d km. */
function spacingFor(c, d, fpx) {
  if (c.top <= 0) return CHUNK;
  const cellKm = GRID.cell / 1000;
  const s = (d * PX_ERROR) / (cellKm * fpx);
  let st = 1;
  while (st * 2 <= s && st < CHUNK) st *= 2;
  return st;
}

/**
 * Pick a spacing for every chunk and rebuild the ones that changed. Nearest
 * chunks rebuild first, and only a limited number per frame unless `all`.
 */
export function updateTerrainLOD(cam, viewportHeight, all = false) {
  if (!group) return;
  const fpx = viewportHeight / (2 * Math.tan((cam.fov * Math.PI) / 360));
  const cp = cam.position;
  const todo = [];
  for (const c of chunks) {
    const dy = cp.y - (c.top / 1000) * P.ex * 0.5;
    const d = Math.max(Math.hypot(cp.x - c.cx, dy, cp.z - c.cz), 0.001);
    const want = spacingFor(c, d, fpx);
    if (want === c.level) continue;
    // A chunk with nothing drawn, or drawn for an old exaggeration, would
    // leave a hole or a step. Put in a cheap coarse version straight away and
    // let the detailed one follow within the per-frame limit.
    if (!c.level) build(c, Math.max(want, 16));
    if (want !== c.level) todo.push([d, c, want]);
  }
  todo.sort((a, b) => a[0] - b[0]);
  let n = 0;
  for (const [, c, want] of todo) {
    if (c.level === want) continue;
    if (!all && n >= REBUILDS_PER_FRAME) break;
    build(c, want);
    n++;
  }
}

function build(c, st) {
  const { nx, ny, cell, west, north } = GRID;
  const ex = P.ex;
  const cols = [], rows = [];
  for (let k = 0; k < c.w; k += st) cols.push(c.i0 + k);
  cols.push(c.i0 + c.w);
  for (let k = 0; k < c.h; k += st) rows.push(c.r0 + k);
  rows.push(c.r0 + c.h);
  const nu = cols.length, nv = rows.length;
  const ring = 2 * (nu + nv) - 4;
  const nvert = nu * nv + ring;
  const pos = new Float32Array(nvert * 3), nor = new Float32Array(nvert * 3), uv = new Float32Array(nvert * 2);
  const el = (i, r) => DEM.elev[Math.max(0, Math.min(ny - 1, r)) * nx + Math.max(0, Math.min(nx - 1, i))];
  const skirt = ((30 + 25 * st) / 1000) * ex;

  const put = (k, i, r, drop) => {
    const e = el(i, r);
    pos[k * 3] = (west + (i + 0.5) * cell) / 1000;
    pos[k * 3 + 1] = (e / 1000) * ex - drop;
    pos[k * 3 + 2] = -(north - (r + 0.5) * cell) / 1000;
    const gx = ((el(i + st, r) - el(i - st, r)) / (2 * st * cell)) * ex;
    const gz = ((el(i, r + st) - el(i, r - st)) / (2 * st * cell)) * ex;
    const len = Math.hypot(gx, 1, gz);
    nor[k * 3] = -gx / len; nor[k * 3 + 1] = 1 / len; nor[k * 3 + 2] = -gz / len;
    uv[k * 2] = (i + 0.5) / nx;
    uv[k * 2 + 1] = 1 - (r + 0.5) / ny;
  };

  for (let v = 0; v < nv; v++) for (let u = 0; u < nu; u++) put(v * nu + u, cols[u], rows[v], 0);

  // The edge ring, walked once around, and its skirt copy.
  const edge = [];
  for (let u = 0; u < nu; u++) edge.push(u);
  for (let v = 1; v < nv; v++) edge.push(v * nu + nu - 1);
  for (let u = nu - 2; u >= 0; u--) edge.push((nv - 1) * nu + u);
  for (let v = nv - 2; v >= 1; v--) edge.push(v * nu);
  const base = nu * nv;
  for (let k = 0; k < edge.length; k++) {
    const src = edge[k];
    const u = src % nu, v = (src / nu) | 0;
    put(base + k, cols[u], rows[v], skirt);
  }

  const idx = [];
  for (let v = 0; v < nv - 1; v++) {
    for (let u = 0; u < nu - 1; u++) {
      const a = v * nu + u, b = a + 1, c2 = a + nu, d = c2 + 1;
      idx.push(a, c2, b, b, c2, d);
    }
  }
  for (let k = 0; k < edge.length; k++) {
    const a = edge[k], b = edge[(k + 1) % edge.length];
    const a2 = base + k, b2 = base + ((k + 1) % edge.length);
    idx.push(a, b, a2, b, b2, a2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(nvert > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geo.computeBoundingSphere();

  if (c.mesh) {
    c.mesh.geometry.dispose();
    c.mesh.geometry = geo;
  } else {
    c.mesh = new THREE.Mesh(geo, material);
    group.add(c.mesh);
  }
  c.level = st;
}

/** Number of vertices currently built, for the dev hook. */
export function terrainStats() {
  let verts = 0;
  const byLevel = {};
  for (const c of chunks) {
    if (!c.mesh) continue;
    verts += c.mesh.geometry.attributes.position.count;
    byLevel[c.level] = (byLevel[c.level] || 0) + 1;
  }
  return { chunks: chunks.length, verts, byLevel };
}
