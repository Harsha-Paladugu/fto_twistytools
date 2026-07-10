/* fto.twistytools.com — Diagram renderer: 2D dual diamond net + 3D view. */
(function(){const module={exports:{}};
// FTO renderer (M2).
// 2D: the community-standard two vertex-centered "diamond" views side by side
//     (csTimer and cubing.js draw exactly this — ground-truth §Rendering):
//     front = the CIF hold looking at the front vertex (+x): U top, L left,
//     R right, F bottom; back = the puzzle rotated 180° about the view-vertical
//     (the +y/+z edge axis): B top, BR left, BL right, D bottom. Every one of
//     the 72 stickers is visible exactly once, and a scramble executed in the
//     scrambling hold (white U, green F) looks exactly like the front view.
// 3D: orthographic render of the real octahedron, rotatable (yaw/pitch on top
//     of the CIF base view).
// All sticker triangles are EXACT barycentric facelet regions projected from
// 3D — the renderer carries no move logic and consumes only the engine's
// facelet model (E.toFacelets / raw 72-color arrays).
// Colors: no single hardware standard exists; default = the DianSheng-era
// scheme (what cubing.js/csTimer default to), LanLan = red/green placement
// swapped. Pass opts.colors to override per call.
const E = (typeof window !== 'undefined' && window.OOEngine) ? window.OOEngine
  : (typeof globalThis !== 'undefined' && globalThis.window && globalThis.window.OOEngine) ? globalThis.window.OOEngine
  : (typeof require !== 'undefined' ? require('./engine.js') : null);

// face order [U,F,BR,BL,L,R,D,B] (engine/facelet order), dark-theme adjusted
const PALETTES = {
  diansheng: ['#e8edf6', '#3fbf52', '#9aa4b5', '#f28c3c', '#a05ae8', '#e8473d', '#f2cf3c', '#3a7fe8'],
  lanlan:    ['#e8edf6', '#e8473d', '#9aa4b5', '#f28c3c', '#a05ae8', '#3fbf52', '#f2cf3c', '#3a7fe8'],
};

function shade(hex, f) {
  if (f >= 1) return hex;
  const v = parseInt(hex.slice(1), 16);
  const ch = sh => Math.round(((v >> sh) & 255) * f).toString(16).padStart(2, '0');
  return '#' + ch(16) + ch(8) + ch(0);
}

/* ---- geometry: exact facelet triangles from the barycentric subdivision ---- */
const add = (a,b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const sc = (a,k) => [a[0]*k, a[1]*k, a[2]*k];
const bary = (pts) => sc(pts.reduce(add), 1/3);

// FACELET_TRIS[i] = [p1,p2,p3] in 3D for facelet i (0..71)
const FACELET_TRIS = (() => {
  const tris = new Array(72);
  for (let i = 0; i < 72; i++) {
    const ft = E.FEAT[i], s = E.FSIGN[ft.f];
    const verts = [0,1,2].map(k => sc([k===0?1:0, k===1?1:0, k===2?1:0], s[k])); // face vertices ±e_k
    const P = k => verts[k];
    if (ft.t === 'c') {
      const V = P(ft.v % 3), others = [0,1,2].filter(k => k !== ft.v % 3).map(P);
      tris[i] = [V, sc(add(sc(V,2), others[0]), 1/3), sc(add(sc(V,2), others[1]), 1/3)];
    } else if (ft.t === 'x') {
      const V = P(ft.v % 3), others = [0,1,2].filter(k => k !== ft.v % 3).map(P);
      tris[i] = [sc(add(others[0], sc(V,2)), 1/3), sc(add(others[1], sc(V,2)), 1/3), bary(verts)];
    } else {
      const V = P(ft.v % 3), W = P(ft.v2 % 3);
      tris[i] = [sc(add(sc(V,2), W), 1/3), sc(add(V, sc(W,2)), 1/3), bary(verts)];
    }
  }
  return tris;
})();

/* ---- projection ---- */
const R2 = Math.SQRT1_2;
// CIF base: right = (0,1,-1)/√2, up = (0,1,1)/√2, toward viewer = +x
const M_FRONT = [[0, R2, -R2], [0, R2, R2], [1, 0, 0]];
// back view: puzzle turned 180° about the view-vertical (+y/+z edge axis)
const M_BACK  = [[0, -R2, R2], [0, R2, R2], [-1, 0, 0]];

function viewMatrix(yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const R = [[cy, 0, sy], [sp * sy, cp, -sp * cy], [-cp * sy, sp, cp * cy]];
  return mulM(R, M_FRONT);          // yaw/pitch on top of the CIF hold
}
function mulM(A, B) {
  const C = [[0,0,0],[0,0,0],[0,0,0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    C[i][j] = A[i][0]*B[0][j] + A[i][1]*B[1][j] + A[i][2]*B[2][j];
  return C;
}
function applyM(M, p) {
  return [M[0][0]*p[0]+M[0][1]*p[1]+M[0][2]*p[2],
          M[1][0]*p[0]+M[1][1]*p[1]+M[1][2]*p[2],
          M[2][0]*p[0]+M[2][1]*p[1]+M[2][2]*p[2]];
}
function rotateView(M, dx, dy) {
  const cy = Math.cos(dx), sy = Math.sin(dx), cx = Math.cos(dy), sx = Math.sin(dy);
  const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
  return mulM(Rx, mulM(Ry, M));
}

// render one view of the octahedron: cull + depth-sort whole faces (convex,
// so faces never interleave). `mask`: Set of facelet indices → neutral fill.
const MASKED_FILL = '#252c39';
const S3 = Math.sqrt(3);
function renderView(fl, M, ox, oy, mask, colors, flat) {
  const vis = [];
  for (let f = 0; f < 8; f++) {
    const n = applyM(M, E.FSIGN[f]);
    if (n[2] > 0.02) vis.push({ f, nz: n[2] / S3 });
  }
  vis.sort((a, b) => a.nz - b.nz || a.f - b.f);   // explicit tie-break: 2D views have 4 equal-nz faces
  const polys = [];
  for (const fc of vis) {
    const bright = flat ? 1 : 0.62 + 0.38 * fc.nz;
    for (let i = 9 * fc.f; i < 9 * fc.f + 9; i++) {
      const pp = FACELET_TRIS[i].map(p => { const r = applyM(M, p); return [r[0] + ox, -r[1] + oy]; });
      const fill = mask && mask.has(i) ? MASKED_FILL : shade(colors[fl[i]], bright);
      polys.push(`<polygon points="${pp.map(p => p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' ')}" fill="${fill}"/>`);
    }
  }
  return polys.join('');
}

function faceletsOf(x) {
  return (Array.isArray(x) && x.length === 72) ? x : E.toFacelets(x);
}
function colorsOf(o) {
  const c = o && o.colors;
  if (!c) return PALETTES.diansheng;
  if (Array.isArray(c)) return c;
  if (typeof c === 'string') return PALETTES[c] || PALETTES.diansheng;
  return E.FACES.map((f, i) => c[f] || PALETTES.diansheng[i]);   // {U:'#…',…} form
}

/* ---- 2D net: front (U/L/R/F) + back (B/BR/BL/D) diamond views ---- */
function netSVG(state, width, opts) {
  const o = opts || {};
  const fl = faceletsOf(state);
  const colors = colorsOf(o);
  const mask = o.mask ? (o.mask instanceof Set ? o.mask : new Set(o.mask)) : null;
  const caps = o.thumb ? '' :
    `<text x="0" y="0.93" class="dcap" font-size="0.13" fill="#9fadc4" text-anchor="middle">front</text>` +
    `<text x="1.75" y="0.93" class="dcap" font-size="0.13" fill="#9fadc4" text-anchor="middle">back</text>`;
  return `<svg viewBox="-0.78 -0.78 3.31 1.85" width="${width}" height="${Math.round(width * 1.85 / 3.31)}" class="${o.cls || 'oonet'}" role="img" aria-label="puzzle state, front and back views">` +
    `<g stroke="#10151f" stroke-width="0.012" stroke-linejoin="round">` +
    renderView(fl, M_FRONT, 0, 0, mask, colors, true) + renderView(fl, M_BACK, 1.75, 0, mask, colors, true) +
    '</g>' + caps + '</svg>';
}

/* ---- 3D view: one orbitable octahedron ---- */
function iso3dSVG(state, width, yawOrM, pitch, opts) {
  const o = opts || {};
  const M = Array.isArray(yawOrM) ? yawOrM : viewMatrix(yawOrM, pitch);
  const fl = faceletsOf(state);
  return `<svg viewBox="-1.1 -1.1 2.2 2.2" width="${width}" height="${width}" class="${o.cls || 'oonet oo3d'}" role="img" aria-label="puzzle state, 3D view">` +
    `<g stroke="#10151f" stroke-width="0.012" stroke-linejoin="round">` +
    renderView(fl, M, 0, 0, o.mask ? new Set(o.mask) : null, colorsOf(o)) + '</g></svg>';
}

const DEFAULT_VIEW = { yaw: 0.55, pitch: 0.35 };  // front vertex + U readable

module.exports = { netSVG, iso3dSVG, viewMatrix, rotateView, DEFAULT_VIEW, PALETTES };
window.OORender = module.exports;})();
