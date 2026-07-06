/* Skewbiks.com — Diagram renderer: 2D dual-view net + draggable 3D view. */
(function(){const module={exports:{}};
// Skewb OO — renderer.
// 2D: two fixed orthographic corner views side by side — "front" (U/F/L, the
//     WCA scrambling hold: white top, green left, red right, UFL corner toward
//     you) and "back" (D/B/R) — every one of the 30 stickers visible exactly
//     once. Matching the scrambling hold means a scramble executed in
//     competition orientation looks exactly like the front view, and a
//     position and its LR mirror render as visual mirror images.
// 3D: orthographic render of the real cube with the skewb cut (4 corner
//     triangles + center diamond per face), rotatable (yaw/pitch).
// All sticker colors come from the engine's facelet model via
// E.toFixedFacelets — the WCA-scrambling-frame presentation, in which the
// white/red/green (UFL) corner always reads solved, exactly like a real cube
// scrambled in the WCA hold. (Raw E.toFacelets is the engine's internal
// pinned frame, which after any written B is the real cube rotated about the
// UFL–DBR diagonal — rendering that made B look like a UFL twist.) The
// renderer carries no move/twist logic of its own.
// Browser loads engine.js first (window.OOEngine). Node tools stub
// globalThis.window before requiring engine.js for its side effect.
const E = (typeof window !== 'undefined' && window.OOEngine) ? window.OOEngine
  : (typeof globalThis !== 'undefined' && globalThis.window && globalThis.window.OOEngine) ? globalThis.window.OOEngine
  : (typeof require !== 'undefined' ? require('./engine.js') : null);

// WCA scheme (TNoodle default), dark-theme adjusted to the site palette
const COLORS = { U:'#e8edf6', R:'#3a7fe8', F:'#e8473d', D:'#f2cf3c', L:'#3fbf52', B:'#f28c3c' };
const FACES = ['U','R','F','D','L','B'];
const FIDX = { U:0, R:1, F:2, D:3, L:4, B:5 };
const FNORM = { U:[0,1,0], R:[1,0,0], F:[0,0,1], D:[0,-1,0], L:[-1,0,0], B:[0,0,-1] };

function shade(hex, f) {
  if (f >= 1) return hex;
  const v = parseInt(hex.slice(1), 16);
  const ch = sh => Math.round(((v >> sh) & 255) * f).toString(16).padStart(2, '0');
  return '#' + ch(16) + ch(8) + ch(0);
}
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const mid = (a,b) => [(a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2];

/* ---- geometry: per face, 4 corner triangles + center diamond ---- */
// corners of each face ordered cyclically, counter-clockwise seen from outside
function faceQuad(f) {
  const n = FNORM[f];
  const cs = Object.keys(E.CPOS).filter(c => dot(E.CPOS[c], n) > 0);
  // basis in the face plane
  const u = n[0] ? [0,1,0] : [1,0,0];
  const v = [n[1]*u[2]-n[2]*u[1], n[2]*u[0]-n[0]*u[2], n[0]*u[1]-n[1]*u[0]];
  return cs.sort((a, b) => {
    const ang = c => Math.atan2(dot(E.CPOS[c], v), dot(E.CPOS[c], u));
    return ang(a) - ang(b);
  });
}
// stickers: { fi: facelet index, face, pts: [3d...] }
const STICKERS = (() => {
  const out = [];
  for (const f of FACES) {
    const quad = faceQuad(f).map(c => ({ name: c, p: E.CPOS[c] }));
    const mids = quad.map((c, i) => mid(c.p, quad[(i + 1) % 4].p));
    out.push({ fi: FIDX[f]*5, face: f, pts: mids });   // center diamond
    quad.forEach((c, i) => {
      out.push({ fi: FIDX[f]*5 + 1 + E.STICKER_POS[f].indexOf(c.name), face: f,
                 pts: [c.p, mids[i], mids[(i + 3) % 4]] });
    });
  }
  return out;
})();

/* ---- projection ---- */
function viewMatrix(yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return [[cy, 0, sy], [sp * sy, cp, -sp * cy], [-cp * sy, sp, cp * cy]];
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

// render all visible faces of one view; cull + depth-sort whole faces (the cube
// is convex, so faces never interleave). Returns svg polygon markup.
// `mask` (optional Set of DISPLAY facelet indices) hides those stickers behind a
// neutral fill — used by the trainer's partial-recognition diagrams.
const MASKED_FILL = '#252c39';
function renderView(fl, M, ox, oy, mask) {
  const vis = [];
  for (const f of FACES) {
    const n = applyM(M, FNORM[f]);
    if (n[2] > 0.02) vis.push({ f, nz: n[2] });
  }
  vis.sort((a, b) => a.nz - b.nz);
  const polys = [];
  for (const fc of vis) {
    const bright = 0.62 + 0.38 * fc.nz;
    for (const s of STICKERS) {
      if (s.face !== fc.f) continue;
      const pp = s.pts.map(p => { const r = applyM(M, p); return [(r[0] + ox), (-r[1] + oy)]; });
      const fill = mask && mask.has(s.fi) ? MASKED_FILL : shade(COLORS[FACES[fl[s.fi]]], bright);
      polys.push(`<polygon points="${pp.map(p => p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' ')}" fill="${fill}"/>`);
    }
  }
  return polys.join('');
}

/* ---- 2D net: front (U/F/L, the WCA hold) + back (D/B/R) corner views ---- */
const ISO = Math.atan(1 / Math.sqrt(2));            // 35.26°
const M_FRONT = viewMatrix(Math.PI / 4, ISO);       // shows U, F, L (UFL toward viewer)
const M_BACK  = viewMatrix(Math.PI + Math.PI / 4, -ISO); // antipode: D, B, R
function netSVG(state, width, opts) {
  const o = opts || {};
  // opts.pinned: render the engine's pinned frame instead of the WCA-hold
  // re-anchor — a whole-cube rotation of the same physical cube. Use it where
  // a state-level face must stay put on screen (e.g. a solved-layer-down case
  // reveal); the tradeoff is that the fixed UFL corner may read twisted.
  const fl = o.pinned ? E.toFacelets(state) : E.toFixedFacelets(state);
  const mask = o.mask ? (o.mask instanceof Set ? o.mask : new Set(o.mask)) : null;
  const caps = o.thumb ? '' :
    `<text x="0" y="2.05" class="dcap" font-size="0.24" fill="#9fadc4" text-anchor="middle">front</text>` +
    `<text x="3.7" y="2.05" class="dcap" font-size="0.24" fill="#9fadc4" text-anchor="middle">back</text>`;
  return `<svg viewBox="-1.8 -1.8 7.3 4" width="${width}" height="${Math.round(width * 4 / 7.3)}" class="${o.cls || 'oonet'}" role="img" aria-label="puzzle state, front and back views">` +
    renderView(fl, M_FRONT, 0, 0, mask) + renderView(fl, M_BACK, 3.7, 0, mask) + caps + '</svg>';
}

/* ---- 3D view: one orbitable cube ---- */
function iso3dSVG(state, width, yawOrM, pitch, opts) {
  const o = opts || {};
  const M = Array.isArray(yawOrM) ? yawOrM : viewMatrix(yawOrM, pitch);
  const fl = E.toFixedFacelets(state);
  return `<svg viewBox="-2 -2 4 4" width="${width}" height="${width}" class="${o.cls || 'oonet oo3d'}" role="img" aria-label="puzzle state, 3D view">${renderView(fl, M, 0, 0)}</svg>`;
}

const DEFAULT_VIEW = { yaw: 0.6, pitch: 0.45 }; // shows U, L and F from a little above (WCA-hold side)

module.exports = { netSVG, iso3dSVG, viewMatrix, rotateView, DEFAULT_VIEW };
window.OORender = module.exports;})();
