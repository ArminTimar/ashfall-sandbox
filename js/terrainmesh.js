// The terrain surface.
//
// The whole grid is built once, at full resolution, and never rebuilt. An
// earlier version picked a vertex spacing per chunk from the camera distance.
// That was wrong in a way no amount of tuning fixes: sampling every 8th or
// 16th cell drops the cells that hold a coastline, so coastal land fell below
// the sea plane and the shore changed shape whenever the camera moved.
//
// The grid is still cut into chunks, but only so the renderer can cull the
// ones that are off screen. Chunks that contain no land at all are drawn with
// a coarse spacing, since they are flat at sea level and only exist to carry
// ash that fell on water. A chunk counts as sea only if every vertex it owns,
// including the ones it shares with its neighbours, is at sea level, so the
// two spacings always meet exactly and there are no cracks.
//
// Heights are stored in kilometres with no vertical exaggeration. The scene
// puts the terrain in a group it scales, so moving the exaggeration slider
// costs nothing.
//
// Normals come from the elevation grid rather than from the triangles, which
// keeps the shading smooth across chunk edges.

import { GRID } from './params.js';
import { DEM } from './terrain.js';

const CHUNK = 64;
const SEA_STEP = 8;

const chunks = [];
let group = null;

/** Build the whole surface and add it to the scene. */
export function initTerrainMesh(scene, material) {
  group = new THREE.Group();
  scene.add(group);
  const { nx, ny } = GRID;
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
      const c = { i0, r0, w, h, top, step: top > 0 ? 1 : SEA_STEP, mesh: null };
      build(c, material);
      chunks.push(c);
    }
  }
  return group;
}

function build(c, material) {
  const { nx, ny, cell, west, north } = GRID;
  const st = c.step;
  const cols = [], rows = [];
  for (let k = 0; k < c.w; k += st) cols.push(c.i0 + k);
  cols.push(c.i0 + c.w);
  for (let k = 0; k < c.h; k += st) rows.push(c.r0 + k);
  rows.push(c.r0 + c.h);
  const nu = cols.length, nv = rows.length;
  const nvert = nu * nv;
  const pos = new Float32Array(nvert * 3), nor = new Float32Array(nvert * 3), uv = new Float32Array(nvert * 2);
  const el = (i, r) => DEM.elev[Math.max(0, Math.min(ny - 1, r)) * nx + Math.max(0, Math.min(nx - 1, i))];

  for (let v = 0; v < nv; v++) {
    const r = rows[v];
    for (let u = 0; u < nu; u++) {
      const i = cols[u], k = v * nu + u;
      pos[k * 3] = (west + (i + 0.5) * cell) / 1000;
      pos[k * 3 + 1] = el(i, r) / 1000;
      pos[k * 3 + 2] = -(north - (r + 0.5) * cell) / 1000;
      const gx = (el(i + 1, r) - el(i - 1, r)) / (2 * cell);
      const gz = (el(i, r + 1) - el(i, r - 1)) / (2 * cell);
      const len = Math.hypot(gx, 1, gz);
      nor[k * 3] = -gx / len; nor[k * 3 + 1] = 1 / len; nor[k * 3 + 2] = -gz / len;
      uv[k * 2] = (i + 0.5) / nx;
      uv[k * 2 + 1] = 1 - (r + 0.5) / ny;
    }
  }

  const tris = (nu - 1) * (nv - 1) * 6;
  const idx = nvert > 65535 ? new Uint32Array(tris) : new Uint16Array(tris);
  let t = 0;
  for (let v = 0; v < nv - 1; v++) {
    for (let u = 0; u < nu - 1; u++) {
      const a = v * nu + u, b = a + 1, c2 = a + nu, d = c2 + 1;
      idx[t++] = a; idx[t++] = c2; idx[t++] = b;
      idx[t++] = b; idx[t++] = c2; idx[t++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  c.mesh = new THREE.Mesh(geo, material);
  group.add(c.mesh);
}

/** Vertical exaggeration, applied as a scale so nothing has to be rebuilt. */
export function setTerrainExaggeration(ex) {
  if (group) group.scale.y = ex;
}

export function terrainStats() {
  let verts = 0, land = 0;
  for (const c of chunks) {
    verts += c.mesh.geometry.attributes.position.count;
    if (c.step === 1) land++;
  }
  return { chunks: chunks.length, landChunks: land, verts };
}
