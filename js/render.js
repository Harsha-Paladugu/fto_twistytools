/* Pyraminx.net — Diagram renderer: 2D net + draggable 3D view. */
(function(){
// Pyraminx OO — renderer v2.
// 2D: the community-standard top-down diagram (exact port of the V-First Trainer's
//     geometry: looking down at the U corner, faces F/Lf/Rf around it, per-face shading,
//     tips drawn twisted together with their axial center), plus a small inset showing
//     the bottom (D) face as seen by tipping the puzzle forward.
// 3D: orthographic render of the real tetrahedron, rotatable (yaw/pitch).
// Browser loads engine.js first (window.OOEngine). Node tools stub
// globalThis.window before requiring engine.js for its side effect, so read the
// global there too — require('./engine.js') returns {} (engine attaches to
// window, not module.exports). The require() is only a last resort.
const E = (typeof window !== 'undefined' && window.OOEngine) ? window.OOEngine
  : (typeof globalThis !== 'undefined' && globalThis.window && globalThis.window.OOEngine) ? globalThis.window.OOEngine
  : (typeof require !== 'undefined' ? require('./engine.js') : null);

const COLORS = { F: '#3fbf52', Lf: '#e8473d', Rf: '#3a7fe8', D: '#f2cf3c' };
// per-face brightness, as in the trainer (depth cue); D inset is its own viewpoint
const SHADE = { F: 1, Lf: .82, Rf: .91, D: .94 };

function shade(hex, f) {
  if (f >= 1) return hex;
  const v = parseInt(hex.slice(1), 16);
  const ch = sh => Math.round(((v >> sh) & 255) * f).toString(16).padStart(2, '0');
  return '#' + ch(16) + ch(8) + ch(0);
}

/* ---- sticker subdivision (exact port of the trainer's m4 scheme) ----
   corners: [n,L,l] corner names; pts: their positions (any dimension).
   Tips and axial centers share twist coloring; edges resolve via slot+side. */
function subdivide(face, cornerNames, pts) {
  const [n, L, l] = cornerNames, [r, i, o] = pts;
  const dim = r.length;
  const s = (p, q) => { const out = new Array(dim);
    for (let d = 0; d < dim; d++) out[d] = r[d] + p / 3 * (i[d] - r[d]) + q / 3 * (o[d] - r[d]);
    return out; };
  const c = (p, q) => [s(p, q), s(p + 1, q), s(p, q + 1)];           // upright
  const f = (p, q) => [s(p + 1, q), s(p, q + 1), s(p + 1, q + 1)];   // inverted
  const st = [
    { pts: c(0,0), kind: 'tip',    ref: n }, { pts: c(2,0), kind: 'tip',    ref: L }, { pts: c(0,2), kind: 'tip',    ref: l },
    { pts: f(0,0), kind: 'center', ref: n }, { pts: f(1,0), kind: 'center', ref: L }, { pts: f(0,1), kind: 'center', ref: l },
    { pts: c(1,0), kind: 'edge', pair: [n, L] }, { pts: c(0,1), kind: 'edge', pair: [n, l] }, { pts: c(1,1), kind: 'edge', pair: [L, l] },
  ];
  for (const x of st) {
    x.face = face;
    if (x.kind === 'edge') { const [slot, side] = edgeSlotFor(face, x.pair); x.slot = slot; x.side = side; }
  }
  return st;
}
function edgeSlotFor(face, pairCorners) {
  const cs = ['U','L','R','B'].filter(x => E.OPP[x] !== face);
  const third = cs.find(x => !pairCorners.includes(x));
  const g = E.OPP[third];
  for (let i = 0; i < 6; i++) {
    const [a, b] = E.XO[i];
    if ((a === face && b === g) || (a === g && b === face)) return [i, a === face ? 0 : 1];
  }
  throw new Error('no slot for ' + face + '/' + g);
}

/* ---- color resolution (identical math to the trainer's v4 / edge formula) ---- */
function axialColor(state, corner, face) {
  const tw = corner === 'U' ? state.u : state.c[{ L: 0, R: 1, B: 2 }[corner]];
  let f = face;
  for (let k = 0; k < tw; k++) f = Object.keys(E.G4[corner]).find(x => E.G4[corner][x] === f);
  return f;
}
function stickerColor(state, s) {
  if (s.kind === 'tip' || s.kind === 'center') return axialColor(state, s.ref, s.face);
  return E.XO[state.e[s.slot*2]][s.side ^ state.e[s.slot*2+1]];
}

/* ---- 2D top-down view: trainer coordinates, verbatim ---- */
const kl = [1, .1], Al = [.06, 1.74], xl = [1.94, 1.74], vl = [1, .97];
const TOP_FACES = [
  ['F',  ['U','L','R'], [vl, Al, xl]],
  ['Lf', ['U','L','B'], [vl, Al, kl]],
  ['Rf', ['U','R','B'], [vl, xl, kl]],
];
// bottom-face inset: tip the puzzle forward — L upper-left, R upper-right, B at the point
const Dl = [2.18, .56], Dr = [3.02, .56], Db = [2.60, 1.29];
const STICKERS_2D = [
  ...TOP_FACES.flatMap(([f, c, p]) => subdivide(f, c, p)),
  ...subdivide('D', ['L','R','B'], [Dl, Dr, Db]),
];
const ALL_STICKERS = STICKERS_2D; // 36: 12 tips, 12 centers, 12 edges

function netSVG(state, width, opts) {
  const o = opts || {};
  const polys = STICKERS_2D.map(s =>
    `<polygon points="${s.pts.map(p => p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' ')}" fill="${shade(COLORS[stickerColor(state, s)], SHADE[s.face])}"/>`).join('');
  const cap = o.thumb ? '' : `<text x="2.60" y="1.50" class="dcap" text-anchor="middle">bottom</text>`;
  return `<svg viewBox="-0.04 0 3.14 1.86" width="${width}" height="${Math.round(width * 1.86 / 3.14)}" class="${o.cls || 'oonet'}" role="img" aria-label="puzzle state, top view with bottom face">` +
    `<polygon points="${[kl, Al, xl].map(p => p.join(',')).join(' ')}" fill="none"/>${polys}${cap}</svg>`;
}

/* ---- 3D view: real tetrahedron, orthographic, orbitable ---- */
// regular tetrahedron, side 2, centered at the centroid; U up, L front-left, R front-right, B back
const V3 = (() => {
  const h = Math.sqrt(8 / 3);            // height for side 2
  const rb = 2 / Math.sqrt(3);           // base circumradius
  const U = [0, h, 0], L = [-1, 0, rb / 2], R = [1, 0, rb / 2], B = [0, 0, -rb];
  const cy = h / 4;
  for (const p of [U, L, R, B]) p[1] -= cy;
  return { U, L, R, B };
})();
const FACES_3D = [
  ['F',  ['U','L','R']], ['Lf', ['U','B','L']], ['Rf', ['U','R','B']], ['D',  ['L','B','R']],
];
const STICKERS_3D = FACES_3D.flatMap(([f, c]) => subdivide(f, c, c.map(x => V3[x])));

/* view rotation as a 3x3 matrix, so the puzzle can tumble freely (no pole limits) */
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
/* trackball increment: horizontal drag spins about the screen's vertical axis,
   vertical drag about its horizontal axis — always relative to the screen, never gimbal-locked */
function rotateView(M, dx, dy) {
  const cy = Math.cos(dx), sy = Math.sin(dx), cx = Math.cos(dy), sx = Math.sin(dy);
  const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
  return mulM(Rx, mulM(Ry, M));
}
function iso3dSVG(state, width, yawOrM, pitch, opts) {
  const o = opts || {};
  const M = Array.isArray(yawOrM) ? yawOrM : viewMatrix(yawOrM, pitch);
  // cull and depth-sort whole faces (a tetrahedron's faces never interleave)
  const faces = FACES_3D.map(([f, c]) => {
    const pts = c.map(x => applyM(M, V3[x]));
    const u = [pts[1][0]-pts[0][0], pts[1][1]-pts[0][1], pts[1][2]-pts[0][2]];
    const v = [pts[2][0]-pts[0][0], pts[2][1]-pts[0][1], pts[2][2]-pts[0][2]];
    const n3 = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const len = Math.hypot(n3[0], n3[1], n3[2]) || 1;
    return { f, z: (pts[0][2]+pts[1][2]+pts[2][2])/3, nz: n3[2]/len };
  });
  const drawn = faces.filter(fc => fc.nz > 0.02).sort((a, b) => a.z - b.z);
  const polys = [];
  for (const fc of drawn) {
    const bright = 0.62 + 0.38 * fc.nz;
    for (const s of STICKERS_3D) {
      if (s.face !== fc.f) continue;
      const pp = s.pts.map(p => { const r = applyM(M, p); return [r[0], -r[1]]; });
      polys.push(`<polygon points="${pp.map(p => p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' ')}" fill="${shade(COLORS[stickerColor(state, s)], bright)}"/>`);
    }
  }
  return `<svg viewBox="-1.5 -1.35 3 2.7" width="${width}" height="${Math.round(width * 0.9)}" class="${o.cls || 'oonet oo3d'}" role="img" aria-label="puzzle state, 3D view">${polys.join('')}</svg>`;
}

const DEFAULT_VIEW = { yaw: 0.55, pitch: 0.42 }; // shows F and Rf from a little above

const api = { netSVG, iso3dSVG, viewMatrix, rotateView, stickerColor, axialColor, ALL_STICKERS, STICKERS_3D, COLORS, DEFAULT_VIEW };
if (typeof module !== 'undefined') module.exports = api;
else window.OORender = api;

})();
