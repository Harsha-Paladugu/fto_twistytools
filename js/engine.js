/* Skewbiks.com — Skewb engine: full state space, moves, rotations, parsing. */
(function(){const module={exports:{}};
// Skewb OO engine — full state space (3,149,280 reachable of 9,447,840 slots),
// 12 tetrad-preserving rotations + mirror. See docs/skewb-ground-truth.md.
// State: { ctr:[6] centers, fx:[4] axis-corner twists, fp:[4] free-corner perm, fo:[4] free twists }
// Faces (TNoodle order): 0=U 1=R 2=F 3=D 4=L 5=B.
// Axis ("fixed") tetrad slots: 0=UBR 1=UFL 2=DFR 3=DBL — twist in place, never move.
// Free tetrad slots: 0=UFR 1=UBL 2=DFL 3=DBR — permute (A4) + twist.
// Native moves twist the four AXIS corners. Written WCA letters: R=DFR, U=UBR,
// L=DBL are native; written B (=DBR, a FREE corner) and x/y/z rotations are
// resolved by applyParsed's frame machinery (like the Pyraminx engine's wides):
// B = native move about UFL + a frame rotation about the UFL–DBR diagonal.
// All move/symmetry tables are DERIVED from 3D geometry + the facelet model at
// init and were validated against TNoodle single-move vectors and a real WCA
// scramble (see tools/test-engine.mjs).

const FACES = ['U','R','F','D','L','B'];
const FIDX = { U:0, R:1, F:2, D:3, L:4, B:5 };
const FNORM = { U:[0,1,0], R:[1,0,0], F:[0,0,1], D:[0,-1,0], L:[-1,0,0], B:[0,0,-1] };
const AXIS = ['UBR','UFL','DFR','DBL'];        // axis tetrad, slot order = fx index
const FREE = ['UFR','UBL','DFL','DBR'];        // free tetrad, slot order = fp/fo index
const AXIS_IDX = { UBR:0, UFL:1, DFR:2, DBL:3 };
const FREE_IDX = { UFR:0, UBL:1, DFL:2, DBR:3 };
const WCA_CORNER = { R:'DFR', U:'UBR', L:'DBL', B:'DBR' };

// corner coordinates (x=R, y=U, z=F)
const CPOS = {};
for (const x of [1,-1]) for (const y of [1,-1]) for (const z of [1,-1])
  CPOS[(y>0?'U':'D') + (z>0?'F':'B') + (x>0?'R':'L')] = [x,y,z];
const ALLC = Object.keys(CPOS);
const OPP = {}; for (const c of ALLC) OPP[c] = ALLC.find(d => CPOS[d].every((v,i) => v === -CPOS[c][i]));

// sticker layout (TNoodle net): per face, stickers 1..4 = corners at NW,NE,SW,SE
const STICKER_POS = {
  U: ['UBL','UBR','UFL','UFR'], R: ['UFR','UBR','DFR','DBR'], F: ['UFL','UFR','DFL','DFR'],
  D: ['DFL','DFR','DBL','DBR'], L: ['UBL','UFL','DBL','DFL'], B: ['UBR','UBL','DBR','DBL'],
};

const cross = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const vkey = v => v.map(Math.round).join(',');
const FACE_BY_N = {}; for (const f of FACES) FACE_BY_N[vkey(FNORM[f])] = f;
const CORNER_BY_P = {}; for (const c of ALLC) CORNER_BY_P[vkey(CPOS[c])] = c;

function cornerFaces(c) { return FACES.filter(f => dot(FNORM[f], CPOS[c]) > 0); }
// cyclic face order per corner, starting from its U/D face (twist reference)
function faceOrderOf(c) {
  const fs = cornerFaces(c), p = CPOS[c];
  const start = fs.find(f => f === 'U' || f === 'D');
  const rest = fs.filter(f => f !== start);
  const next = dot(cross(FNORM[start], FNORM[rest[0]]), p) > 0 ? rest[0] : rest[1];
  return [start, next, rest.find(f => f !== next)];
}
const CFACES = {}; for (const c of ALLC) CFACES[c] = faceOrderOf(c);

// 120° rotation about a corner diagonal in the native-move (CW-from-outside) direction
function rotAboutCorner(c) {
  const p = CPOS[c], n = Math.sqrt(3), k = [p[0]/n, p[1]/n, p[2]/n];
  const ct = -0.5, st = -Math.sqrt(3)/2; // sign pinned by TNoodle vectors
  return v => { const kxv = cross(k,v), kv = dot(k,v);
    return [0,1,2].map(i => ct*v[i] + st*kxv[i] + (1-ct)*k[i]*kv); };
}
function cornerMapOfFp(fp) {
  const m = {};
  for (const c of ALLC) {
    const set = cornerFaces(c).map(f => fp[f]).sort().join();
    m[c] = ALLC.find(d => cornerFaces(d).sort().join() === set);
  }
  return m;
}

// ---------------- facelet model (30 stickers; flat index face*5 + 0..4) ----------------
function stickerIdx(face, corner) { return FIDX[face]*5 + 1 + STICKER_POS[face].indexOf(corner); }
// per-corner sticker indices aligned with CFACES order
const CSTK = {}; for (const c of ALLC) CSTK[c] = CFACES[c].map(f => stickerIdx(f, c));

function solvedFacelets() { const fl = new Array(30); for (let f=0; f<6; f++) for (let k=0;k<5;k++) fl[f*5+k] = f; return fl; }
function toFacelets(s) {
  const fl = new Array(30);
  for (let f = 0; f < 6; f++) fl[f*5] = s.ctr[f];
  for (let a = 0; a < 4; a++) { const c = AXIS[a], t = s.fx[a];
    for (let i = 0; i < 3; i++) fl[CSTK[c][i]] = FIDX[CFACES[c][(i + t) % 3]];
  }
  for (let q = 0; q < 4; q++) { const c = FREE[q], p = FREE[s.fp[q]], t = s.fo[q];
    for (let i = 0; i < 3; i++) fl[CSTK[c][i]] = FIDX[CFACES[p][(i + t) % 3]];
  }
  return fl;
}
function fromFacelets(fl) {
  const s = { ctr: new Array(6), fx: new Array(4), fp: new Array(4), fo: new Array(4) };
  for (let f = 0; f < 6; f++) s.ctr[f] = fl[f*5];
  const readCorner = (c) => {
    const cols = CSTK[c].map(i => fl[i]);
    const set = cols.slice().sort().join();
    const piece = ALLC.find(d => cornerFaces(d).map(f => FIDX[f]).sort().join() === set);
    let t = -1;
    for (let cand = 0; cand < 3; cand++) {
      let ok = true;
      for (let i = 0; i < 3; i++) if (cols[i] !== FIDX[CFACES[piece][(i + cand) % 3]]) { ok = false; break; }
      if (ok) { t = cand; break; }
    }
    if (t < 0) throw new Error('bad facelets at ' + c);
    return [piece, t];
  };
  for (let a = 0; a < 4; a++) { const [p, t] = readCorner(AXIS[a]);
    if (AXIS_IDX[p] !== a) throw new Error('axis piece displaced');
    s.fx[a] = t;
  }
  for (let q = 0; q < 4; q++) { const [p, t] = readCorner(FREE[q]);
    if (!(p in FREE_IDX)) throw new Error('tetrad mixed');
    s.fp[q] = FREE_IDX[p]; s.fo[q] = t;
  }
  return s;
}
// facelet permutation of a native half-move about axis corner A (dst[i] = src)
function moveFaceletPerm(A) {
  const rot = rotAboutCorner(A);
  const half = ALLC.filter(c => c === A || CPOS[c].filter((v,i) => v === CPOS[A][i]).length === 2);
  const map = new Array(30); for (let i = 0; i < 30; i++) map[i] = i;
  for (const f of cornerFaces(A)) map[FIDX[FACE_BY_N[vkey(rot(FNORM[f]))]]*5] = FIDX[f]*5;
  for (const c of half) { const c2 = CORNER_BY_P[vkey(rot(CPOS[c]))];
    for (const f of cornerFaces(c)) {
      const f2 = FACE_BY_N[vkey(rot(FNORM[f]))];
      map[stickerIdx(f2, c2)] = stickerIdx(f, c);
    }
  }
  return map; // dst <- src
}
const applyFaceletPerm = (fl, map) => map.map(src => fl[src]);

// ---------------- state, moves (piece tables derived by probing the facelet model) ----------------
function solved() { return { ctr: [0,1,2,3,4,5], fx: [0,0,0,0], fp: [0,1,2,3], fo: [0,0,0,0] }; }
function copy(s) { return { ctr: s.ctr.slice(), fx: s.fx.slice(), fp: s.fp.slice(), fo: s.fo.slice() }; }
function eq(a, b) {
  for (let i=0;i<6;i++) if (a.ctr[i]!==b.ctr[i]) return false;
  for (let i=0;i<4;i++) if (a.fx[i]!==b.fx[i] || a.fp[i]!==b.fp[i] || a.fo[i]!==b.fo[i]) return false;
  return true;
}

// derive per-axis piece-level tables from the facelet model
const S4 = {}; // axisName -> { fc:[[src,dst,twistDelta]x3], cc:[[src,dst]x3] }
const MFP = {}; // axisName -> facelet perm (used for probing + tests)
for (const A of AXIS) {
  MFP[A] = moveFaceletPerm(A);
  const probe = fromFacelets(applyFaceletPerm(toFacelets(solved()), MFP[A]));
  const fc = [], cc = [];
  for (let dst = 0; dst < 4; dst++) if (probe.fp[dst] !== dst) fc.push([probe.fp[dst], dst, probe.fo[dst]]);
  for (let dst = 0; dst < 6; dst++) if (probe.ctr[dst] !== dst) cc.push([probe.ctr[dst], dst]);
  if (fc.length !== 3 || cc.length !== 3 || probe.fx[AXIS_IDX[A]] !== 1) throw new Error('move derivation failed for ' + A);
  S4[A] = { fc, cc };
}
// twist deltas must be leg-independent for the fast path below; assert
for (const A of AXIS) { const d = S4[A].fc[0][2];
  if (!S4[A].fc.every(l => l[2] === d)) throw new Error('non-uniform twist delta');
}
// fixed-frame facelet permutations of the literal WCA moves (B twists the free
// corner DBR). Used by tests against TNoodle vectors and by the renderer.
const WCA_FACELET_MOVES = { R: MFP.DFR, U: MFP.UBR, L: MFP.DBL, B: moveFaceletPerm('DBR') };

// Whole-cube 240° rotation about the UFL–DBR diagonal, extracted from the
// machine-verified deep-cut identity  B = (native UFL move) then (this
// rotation)  — the factors commute. Needed because the pinned state model
// absorbs each written B's rotation into the parsing frame: a pinned state's
// raw facelets can show the UFL corner twisted, which a real cube scrambled
// in the WCA hold NEVER does (no WCA move touches the white/red/green
// corner's half — its three stickers are invariant under R, U, L and B).
const ROT240_UFL = (() => {
  const inv = new Array(30);
  for (let i = 0; i < 30; i++) inv[MFP.UFL[i]] = i;
  const r = new Array(30);
  for (let i = 0; i < 30; i++) r[i] = inv[WCA_FACELET_MOVES.B[i]];
  return r;
})();
// Facelets of a state as a cube scrambled in the WCA hold actually looks:
// rotate by 240° x fx[UFL] about the UFL–DBR diagonal, so the white/red/green
// corner always reads solved. For EVERY rotation-free WCA alg A,
// toFixedFacelets(state after A) equals the literal fixed-frame facelet
// result of A (tests assert this against the TNoodle vectors) — so a diagram
// drawn from these facelets matches a real cube after the printed scramble.
// All rendering goes through this; toFacelets stays the raw pinned-frame view
// (fromFacelets can only read pinned facelets — don't feed it these).
function toFixedFacelets(s) {
  let fl = toFacelets(s);
  for (let k = 0; k < s.fx[AXIS_IDX.UFL]; k++) fl = applyFaceletPerm(fl, ROT240_UFL);
  return fl;
}

function move(s, axisName, prime) {
  const t = S4[axisName], a = AXIS_IDX[axisName], n = prime ? 2 : 1;
  for (let k = 0; k < n; k++) {
    const fp = s.fp.slice(), fo = s.fo.slice(), ctr = s.ctr.slice();
    for (const [src, dst, d] of t.fc) { s.fp[dst] = fp[src]; s.fo[dst] = (fo[src] + d) % 3; }
    for (const [src, dst] of t.cc) s.ctr[dst] = ctr[src];
    s.fx[a] = (s.fx[a] + 1) % 3;
  }
  return s;
}
const MOVES = ['U',"U'",'L',"L'",'R',"R'",'F',"F'"]; // F = native UFL axis (no WCA letter; see nativeToWCA)
const MOVE_AXIS = ['UBR','UBR','DBL','DBL','DFR','DFR','UFL','UFL'];
function applyMoveIdx(s, m) { return move(s, MOVE_AXIS[m], (m & 1) === 1); }

// ---------------- indexing ----------------
// idx = (evenRank6(ctr)*12 + evenRank4(fp)) * 2187 + twist(3^7: fx0..fx3, fo0..fo2)
// 9,447,840 slots; exactly 1/3 reachable (fixed-twist-sum ≡ free-perm class).
// Mixed-radix rank of the first four Lehmer digits (bases 6,5,4,3). Those four
// digits identify an even permutation of 6 uniquely — the last two elements'
// order is forced by parity — so even perms map 1:1 onto 0..359.
function evenRank6(p) {
  let r = 0;
  for (let i = 0; i < 4; i++) { let m = 0; for (let j = i+1; j < 6; j++) if (p[j] < p[i]) m++;
    r = r * (6 - i) + m; }
  return r;
}
function evenUnrank6(r) {
  const d = [0,0,0,0];
  d[3] = r % 3; r = (r - d[3]) / 3;
  d[2] = r % 4; r = (r - d[2]) / 4;
  d[1] = r % 5; r = (r - d[1]) / 5;
  d[0] = r;
  const avail = [0,1,2,3,4,5], p = [];
  for (let i = 0; i < 4; i++) p.push(avail.splice(d[i], 1)[0]);
  const even = p.concat(avail), odd = p.concat([avail[1], avail[0]]);
  return permParity(even) === 0 ? even : odd;
}
function evenRank4(p) {
  let m0 = 0; for (let j = 1; j < 4; j++) if (p[j] < p[0]) m0++;
  let m1 = 0; for (let j = 2; j < 4; j++) if (p[j] < p[1]) m1++;
  return m0 * 3 + m1;
}
function evenUnrank4(r) {
  const d0 = Math.floor(r / 3), d1 = r % 3;
  const avail = [0,1,2,3], p = [];
  p.push(avail.splice(d0, 1)[0]); p.push(avail.splice(d1, 1)[0]);
  const even = p.concat(avail), odd = p.concat([avail[1], avail[0]]);
  return permParity(even) === 0 ? even : odd;
}
function idx(s) {
  const tw = ((s.fx[0]*3 + s.fx[1])*3 + s.fx[2])*3 + s.fx[3];
  const fo = (s.fo[0]*3 + s.fo[1])*3 + s.fo[2];
  return (evenRank6(s.ctr)*12 + evenRank4(s.fp)) * 2187 + tw*27 + fo;
}
function unidx(ix) {
  const t = ix % 2187; ix = (ix - t) / 2187;
  const pr = ix % 12; const cr = (ix - pr) / 12;
  const fo = t % 27, tw = (t - fo) / 27;
  const s = { ctr: evenUnrank6(cr), fx: [0,0,0,0], fp: evenUnrank4(pr), fo: [0,0,0,0] };
  s.fx[3] = tw % 3; s.fx[2] = Math.floor(tw/3) % 3; s.fx[1] = Math.floor(tw/9) % 3; s.fx[0] = Math.floor(tw/27) % 3;
  s.fo[2] = fo % 3; s.fo[1] = Math.floor(fo/3) % 3; s.fo[0] = Math.floor(fo/9) % 3;
  s.fo[3] = (3 - (s.fo[0] + s.fo[1] + s.fo[2]) % 3) % 3;
  return s;
}
const NSLOTS = 360 * 12 * 2187; // 9,447,840

// A4/V4 class of a free-tetrad permutation (Z3): class(solved)=0, +1 per native move.
// Computed by closure so it is consistent with the move tables by construction.
const CLASS = new Array(12).fill(-1);
{
  CLASS[evenRank4([0,1,2,3])] = 0;
  let frontier = [[0,1,2,3]];
  while (frontier.length) {
    const next = [];
    for (const p of frontier) for (const A of AXIS) {
      const q = p.slice();
      for (const [src, dst] of S4[A].fc) q[dst] = p[src];
      const r = evenRank4(q);
      if (CLASS[r] < 0) { CLASS[r] = (CLASS[evenRank4(p)] + 1) % 3; next.push(q); }
    }
    frontier = next;
  }
  if (CLASS.some(v => v < 0)) throw new Error('class table incomplete');
}

// ---------------- free-slot pool enumeration ----------------
function permsOf(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permsOf(rest)) out.push([arr[i]].concat(p));
  }
  return out;
}
function permParity(p) {
  let par = 0; const seen = new Array(p.length).fill(false);
  for (let i = 0; i < p.length; i++) {
    if (seen[i]) continue;
    let j = i, len = 0;
    while (!seen[j]) { seen[j] = true; j = p[j]; len++; }
    par ^= (len - 1) & 1;
  }
  return par;
}
// enumFreeSlots({ corners:[freeSlotIdx], centers:[facePos], fixedTwists:[axisIdx] }):
// every reachable state where exactly the listed pieces are scrambled (even
// sub-permutations; twist digits satisfy the two reachability constraints) and
// everything else is solved.
function enumFreeSlots(spec) {
  const cor = (spec && spec.corners) || [], cen = (spec && spec.centers) || [], fxs = (spec && spec.fixedTwists) || [];
  const out = [];
  const twistDigits = (n, sumTo) => { // all length-n digit arrays mod 3; if sumTo!=null constrain sum
    const res = [];
    const rec = (acc) => {
      if (acc.length === n) { if (sumTo === null || acc.reduce((a,b)=>a+b,0) % 3 === sumTo) res.push(acc.slice()); return; }
      for (let d = 0; d < 3; d++) { acc.push(d); rec(acc); acc.pop(); }
    };
    rec([]);
    return res;
  };
  for (const cperm of permsOf(cor.length ? cor : [null])) {
    const fp = [0,1,2,3];
    if (cor.length) cor.forEach((slot, i) => { fp[slot] = cperm[i]; });
    if (permParity(fp) !== 0) continue;
    const cls = CLASS[evenRank4(fp)];
    for (const zperm of permsOf(cen.length ? cen : [null])) {
      const ctr = [0,1,2,3,4,5];
      if (cen.length) cen.forEach((pos, i) => { ctr[pos] = zperm[i]; });
      if (permParity(ctr) !== 0) continue;
      const foSets = cor.length ? twistDigits(cor.length, 0) : [[]];
      const fxSets = fxs.length ? twistDigits(fxs.length, cls) : (cls === 0 ? [[]] : []);
      for (const fod of foSets) for (const fxd of fxSets) {
        const s = { ctr: ctr.slice(), fx: [0,0,0,0], fp: fp.slice(), fo: [0,0,0,0] };
        cor.forEach((slot, i) => { s.fo[slot] = fod[i]; });
        fxs.forEach((a, i) => { s.fx[a] = fxd[i]; });
        out.push(s);
      }
    }
  }
  return out;
}

// ---------------- symmetries ----------------
// Sym = conjugation by a cube isometry that preserves the axis tetrad: relabels
// positions AND colors. 12 proper rotations (A4) + 12 improper (mirror ∘ rot).
// Fast tables are compiled by probing the exact facelet-level conjugation.
function faceCompose(a, b) { const r = {}; for (const f of FACES) r[f] = a[b[f]]; return r; }
const FACE_ID = { U:'U', R:'R', F:'F', D:'D', L:'L', B:'B' };
const MIRROR_FP = { U:'U', D:'D', R:'B', B:'R', F:'L', L:'F' }; // reflection across x+z=0 (fixes UFL, UBR)

function faceletConj(fp) { // sticker map dst<-src plus color relabel, as functions
  const cmap = cornerMapOfFp(fp);
  const map = new Array(30);
  for (const f of FACES) map[FIDX[fp[f]]*5] = FIDX[f]*5;
  for (const c of ALLC) for (const f of cornerFaces(c))
    map[stickerIdx(fp[f], cmap[c])] = stickerIdx(f, c);
  const col = new Array(6); for (const f of FACES) col[FIDX[f]] = FIDX[fp[f]];
  return fl => { const out = new Array(30); for (let i = 0; i < 30; i++) out[i] = col[fl[map[i]]]; return out; };
}
function symFromFacePerm(fp, mirror) {
  const conj = faceletConj(fp);
  const slow = s => fromFacelets(conj(toFacelets(s)));
  // compile fast tables by probing the slow path
  const ctrPos = new Array(6), ctrCol = new Array(6);
  for (const f of FACES) { ctrPos[FIDX[f]] = FIDX[fp[f]]; ctrCol[FIDX[f]] = FIDX[fp[f]]; }
  const cmap = cornerMapOfFp(fp);
  const axMap = AXIS.map(c => AXIS_IDX[cmap[c]]);
  const frMap = FREE.map(c => FREE_IDX[cmap[c]]);
  if (axMap.some(v => v === undefined) || frMap.some(v => v === undefined)) throw new Error('sym does not preserve tetrads');
  // twist offsets: off[q][p] for free (piece p at slot q, twist 0 -> image twist), offx[a]
  const offx = new Array(4), off = [[],[],[],[]];
  for (let a = 0; a < 4; a++) { const t = solved(); t.fx[a] = 1; offx[a] = slow(t).fx[axMap[a]] + (mirror ? 1 : -1); offx[a] = ((offx[a] % 3) + 3) % 3; }
  for (let q = 0; q < 4; q++) for (let p = 0; p < 4; p++) {
    const t = solved();
    // place piece p at slot q via a (possibly odd) assignment — to/fromFacelets don't require reachability
    t.fp[q] = p; t.fp[p] = q; // swap keeps it a permutation
    off[q][p] = slow(t).fo[frMap[q]];
  }
  const sign = mirror ? -1 : 1;
  return {
    fp, mirror: !!mirror,
    apply(s) {
      const o = { ctr: new Array(6), fx: new Array(4), fp: new Array(4), fo: new Array(4) };
      for (let f = 0; f < 6; f++) o.ctr[ctrPos[f]] = ctrCol[s.ctr[f]];
      for (let a = 0; a < 4; a++) o.fx[axMap[a]] = ((sign * s.fx[a] + offx[a]) % 3 + 3) % 3;
      for (let q = 0; q < 4; q++) { const p = s.fp[q];
        o.fp[frMap[q]] = frMap[p];
        o.fo[frMap[q]] = ((sign * s.fo[q] + off[q][p]) % 3 + 3) % 3;
      }
      return o;
    },
  };
}
function applySym(sym, s) { return sym.apply(s); }
function composeSym(a, b) { return symFromFacePerm(faceCompose(a.fp, b.fp), a.mirror !== b.mirror); }
// generate the 12 tetrad-preserving rotations + the 12 mirror images
const G4 = {}; // axis-corner rotation face perms (native-move direction)
for (const A of AXIS) { const rot = rotAboutCorner(A); const m = {}; for (const f of FACES) m[f] = FACE_BY_N[vkey(rot(FNORM[f]))]; G4[A] = m; }
function buildSyms() {
  const seen = new Map([[JSON.stringify(FACE_ID), FACE_ID]]);
  const queue = [FACE_ID];
  while (queue.length) {
    const fp = queue.pop();
    for (const A of AXIS) {
      const nf = faceCompose(G4[A], fp), k = JSON.stringify(nf);
      if (!seen.has(k)) { seen.set(k, nf); queue.push(nf); }
    }
  }
  const rots = [...seen.values()].map(fp => symFromFacePerm(fp, false));
  if (rots.length !== 12) throw new Error('expected 12 rotations, got ' + rots.length);
  const mirrors = rots.map(r => symFromFacePerm(faceCompose(r.fp, MIRROR_FP), true));
  return { rots, mirrors, all: rots.concat(mirrors) };
}

// ---------------- canonicalization ----------------
function makeCanon(syms) {
  return function canon(s) {
    let best = Infinity;
    for (const sym of syms.rots) { const v = idx(sym.apply(s)); if (v < best) best = v; }
    return best;
  };
}
function makeMirrorCanon(syms) {
  return function mcanon(s) {
    let best = Infinity;
    for (const sym of syms.mirrors) { const v = idx(sym.apply(s)); if (v < best) best = v; }
    return best;
  };
}
// full 24-element fold (12 rotations + 12 mirror images): 3,149,280 states
// come down to 131,391 classes (oracle in tools/verify-space.mjs). This is the
// census's class key — a position and its mirror share one class.
function makeFullCanon(syms) {
  return function fcanon(s) {
    let best = Infinity;
    for (const sym of syms.all) { const v = idx(sym.apply(s)); if (v < best) best = v; }
    return best;
  };
}

// ---------------- solution / scramble parsing ----------------
// WCA tokens: R U L B (+ ' / 2 / 2', order-3 twists: X2 == X'), rotations
// x y z (+ ' / 2 / 2', order 4). No tips, no wides. Lowercase is unparseable.
//
// NS ("Rubik'skewb") notation — parseAlg(str, 'ns'): all EIGHT corners get
// letters. Uppercase F R B L = the four TOP corners, lowercase f r b l = the
// four BOTTOM corners, named front/right/back/left in the WCA scrambling hold
// (UFL corner toward you). Plain = 120° CW seen from outside that corner,
// ' = CCW; x y z rotations as in WCA. Source (the notation the Sarah/NS 2.0
// alg sheets use): rubikskewb.web.fc2.com/skewb/notation.html — see
// docs/skewb-ground-truth.md. The WCA letters are the NS subset {r, B, l, b}
// (WCA R=NS r, U=B, L=l, B=b — a pure token rename); NS F f R L twist corners
// WCA can't name without rotations.
const NS_CORNER = { F:'UFL', R:'UFR', B:'UBR', L:'UBL', f:'DFL', r:'DFR', b:'DBR', l:'DBL' };
const WCA_TO_NS = { R:'r', U:'B', L:'l', B:'b' };
const amtOf = m => (m === "'" || m === '2') ? 2 : 1;              // order-3 moves
const rotAmtOf = m => m === "'" ? 3 : (m === '2' || m === "2'") ? 2 : 1; // order-4 rotations
function parseAlg(str, notation) {
  const ns = notation === 'ns';
  const out = [];
  const toks = String(str).replace(/[()，,]/g, ' ').trim().split(/\s+/).filter(Boolean);
  for (const t of toks) {
    let m;
    if ((m = t.match(/^([xyz])(2'|2|')?$/))) { out.push({ kind: 'rot', f: m[1], amt: rotAmtOf(m[2]) }); continue; }
    if (!ns && (m = t.match(/^([ULRB])(2'|2|')?$/))) { out.push({ kind: 'move', f: m[1], c: WCA_CORNER[m[1]], amt: amtOf(m[2]) }); continue; }
    if (ns && (m = t.match(/^([FRBLfrbl])(2'|2|')?$/))) { out.push({ kind: 'move', f: m[1], c: NS_CORNER[m[1]], amt: amtOf(m[2]) }); continue; }
    return null;
  }
  return out;
}
function countMoves(parsed) { let n = 0; for (const t of parsed) if (t.kind === 'move') n++; return n; }

// rotation frames: pure geometry (face perm + corner map), incl. tetrad-swapping
// 90° x/y/z. Never applied to states — only used to resolve written letters.
const XYZ_FP = {
  x: { R:'R', L:'L', F:'U', U:'B', B:'D', D:'F' },  // about R, in R's direction
  y: { U:'U', D:'D', F:'L', L:'B', B:'R', R:'F' },  // about U, in U's direction
  z: { F:'F', B:'B', U:'R', R:'D', D:'L', L:'U' },  // about F, in F's direction
};
function frameOf(fp) { return { fp, corner: cornerMapOfFp(fp) }; }
function frameCompose(a, b) { return frameOf(faceCompose(a.fp, b.fp)); }
function makeFrames(_syms) {
  const byCorner = {}; for (const A of AXIS) byCorner[A] = frameOf(G4[A]);
  const xyz = {}; for (const r of ['x','y','z']) xyz[r] = frameOf(XYZ_FP[r]);
  return { id: frameOf(FACE_ID), byCorner, xyz };
}
function applyParsed(parsed, state, _syms, rotBy) {
  let s = copy(state);
  let frame = rotBy.id;
  for (const t of parsed) {
    if (t.kind === 'rot') {
      // rotation tokens are written in the CURRENT (frame) coordinates -> right-compose
      for (let k = 0; k < t.amt; k++) frame = frameCompose(frame, rotBy.xyz[t.f]);
      continue;
    }
    const phys = frame.corner[t.c || WCA_CORNER[t.f]];
    if (AXIS_IDX[phys] !== undefined) {
      for (let k = 0; k < t.amt; k++) move(s, phys, false);
    } else {
      // written move about a free corner == native move about its opposite axis
      // corner + a LEFTOVER 240°-per-quarter-turn rotation of the real cube
      // about that diagonal (deep-cut identity). The frame resolves written
      // letters through the INVERSE of the accumulated leftover rotation, so
      // it advances by +amt powers of the native-direction 120° rotation.
      // (Getting this direction wrong makes every move AFTER a B act on the
      // wrong corner — caught against the TNoodle fixed-frame vectors.)
      const ax = OPP[phys];
      for (let k = 0; k < t.amt; k++) move(s, ax, false);
      const steps = t.amt % 3;
      for (let k = 0; k < steps; k++) frame = frameCompose(rotBy.byCorner[ax], frame);
    }
  }
  return s;
}
// convert native MOVES tokens (U/L/R/F axes) to written WCA notation (R/U/L/B)
function nativeToWCA(alg, rotBy) {
  rotBy = rotBy || makeFrames(null);
  const out = [];
  let frame = rotBy.id;
  for (const tok of String(alg).trim().split(/\s+/).filter(Boolean)) {
    const axisName = { U:'UBR', L:'DBL', R:'DFR', F:'UFL' }[tok[0]];
    const amt = tok.length > 1 ? 2 : 1;
    let letter = null;
    for (const w of ['R','U','L']) if (frame.corner[WCA_CORNER[w]] === axisName) { letter = w; break; }
    if (letter === null) {
      // this axis is currently the opposite of written B's corner -> emit B
      if (OPP[frame.corner[WCA_CORNER.B]] !== axisName) throw new Error('frame resolution failed');
      letter = 'B';
      const steps = amt % 3; // same frame walk as applyParsed's free-corner branch
      for (let k = 0; k < steps; k++) frame = frameCompose(rotBy.byCorner[axisName], frame);
    }
    out.push(letter + (amt === 2 ? "'" : ''));
  }
  return out.join(' ');
}

// flatten a parsed token stream to native axis tokens (rotations are absorbed
// into the frame; free-corner letters via the deep-cut identity). Exactly
// mirrors applyParsed's move branch, so state effect and movecount agree.
const NATIVE_LETTER = { UBR:'U', DBL:'L', DFR:'R', UFL:'F' };
function parsedToNative(parsed, rotBy) {
  rotBy = rotBy || makeFrames(null);
  const out = [];
  let frame = rotBy.id;
  for (const t of parsed) {
    if (t.kind === 'rot') { for (let k = 0; k < t.amt; k++) frame = frameCompose(frame, rotBy.xyz[t.f]); continue; }
    const phys = frame.corner[t.c || WCA_CORNER[t.f]];
    if (AXIS_IDX[phys] !== undefined) {
      out.push(NATIVE_LETTER[phys] + (t.amt === 2 ? "'" : ''));
    } else {
      const ax = OPP[phys];
      out.push(NATIVE_LETTER[ax] + (t.amt === 2 ? "'" : ''));
      const steps = t.amt % 3; // same frame walk as applyParsed's free-corner branch
      for (let k = 0; k < steps; k++) frame = frameCompose(rotBy.byCorner[ax], frame);
    }
  }
  return out;
}
// WCA -> NS display is a pure token rename (R->r, U->B, L->l, B->b; rotations
// unchanged). Non-WCA tokens pass through untouched (best-effort display).
function wcaToNS(alg) {
  return String(alg).trim().split(/\s+/).filter(Boolean).map(t => {
    const m = t.match(/^([ULRB])(2'|2|')?$/);
    return m ? WCA_TO_NS[m[1]] + (m[2] || '') : t;
  }).join(' ');
}
// NS -> WCA re-derives through the native stream: same state, same movecount,
// but input rotations are absorbed (NS F/f/R/L have no WCA letter). Null if
// the input doesn't parse as NS.
function nsToWCA(alg) {
  const p = parseAlg(alg, 'ns');
  return p === null ? null : nativeToWCA(parsedToNative(p).join(' '));
}
function convertAlg(alg, from, to) {
  if (from === to) return alg;
  return to === 'ns' ? wcaToNS(alg) : nsToWCA(alg);
}

// mirror a solution string token-by-token (the x+z=0 reflection):
// R<->L, U->U', B->B'; rotations: y->y', x<->z with reversed amount.
// The same letter map covers NS tokens too: the reflection fixes UFL, UBR,
// DFL, DBR (NS F, B, f, b — direction flips) and swaps DFR<->DBL (r<->l),
// UFR<->UBL (NS R<->L).
function mirrorToken(t) {
  let m;
  if ((m = t.match(/^([ULRBFfrbl])(2'|2|')?$/))) {
    const map = { U:'U', B:'B', R:'L', L:'R', F:'F', f:'f', b:'b', r:'l', l:'r' };
    return map[m[1]] + (amtOf(m[2]) === 1 ? "'" : '');
  }
  if ((m = t.match(/^([xyz])(2'|2|')?$/))) {
    const map = { x:'z', y:'y', z:'x' };
    const amt = (4 - rotAmtOf(m[2])) % 4;
    return amt === 0 ? '' : map[m[1]] + (amt === 1 ? '' : amt === 2 ? '2' : "'");
  }
  return t;
}
function mirrorAlg(str) {
  return String(str).trim().split(/\s+/).filter(Boolean).map(mirrorToken).filter(Boolean).join(' ');
}

// optimal solution from a state via the distance table (random tie-breaks if rand)
function nativeSolution(state, dist, rand) {
  const s = copy(state); const out = [];
  let d = dist[idx(s)];
  if (d < 0) return null;
  while (d > 0) {
    const opts = [];
    for (let m = 0; m < MOVES.length; m++) {
      const t = copy(s); applyMoveIdx(t, m);
      if (dist[idx(t)] === d - 1) opts.push(m);
    }
    const m = rand ? opts[Math.floor(Math.random()*opts.length)] : opts[0];
    applyMoveIdx(s, m); out.push(MOVES[m]); d--;
  }
  return out;
}
function optimalSolution(state, dist, rand) {
  const toks = nativeSolution(state, dist, rand);
  return toks === null ? null : nativeToWCA(toks.join(' '));
}
function invertAlg(str) {
  // NOTE: written algs containing B (or rotations) do NOT invert across separate
  // applyParsed evaluations (the frame restarts) — only within one token stream.
  // Engine-internal scramble generation therefore inverts at the NATIVE level.
  return str.split(/\s+/).filter(Boolean).reverse()
    .map(t => t.endsWith("'") ? t.slice(0, -1) : t + "'").join(' ');
}
function optimalScramble(state, dist, rand) {
  const toks = nativeSolution(state, dist, rand);
  if (toks === null) return null;
  if (!toks.length) return '';
  return nativeToWCA(invertAlg(toks.join(' ')));
}

// ---------------- string keying + alg→case helpers ----------------
// Full-state key (no tip-fixable pieces on a Skewb, so nothing is excluded).
function stateKey(s) { return s.ctr.join('') + '|' + s.fp.join('') + s.fo.join('') + '|' + s.fx.join(''); }
function keyToState(k) {
  const [c, m, x] = k.split('|');
  return { ctr: c.split('').map(Number), fp: m.slice(0,4).split('').map(Number),
           fo: m.slice(4).split('').map(Number), fx: x.split('').map(Number) };
}
// Case keying folds the y2 view (180° about the U axis) — the only U-face-
// preserving rotation that is tetrad-preserving. A 90° y view is NOT a state
// symmetry (it swaps the tetrads), so the four viewing presentations of a case
// are paired at the DATA level (the alg sheet's `direction` field), exactly
// like the Pyraminx sheet's bar directions.
let _y2sym = null;
function realCanonKey(st) {
  if (!_y2sym) _y2sym = symFromFacePerm(faceCompose(XYZ_FP.y, XYZ_FP.y), false);
  const a = stateKey(st), b = stateKey(_y2sym.apply(st));
  return a < b ? a : b;
}
function preprocessAlg(a) {
  let s = ' ' + String(a).trim() + ' ';
  s = s.replace(/([ULRBFfrbl])2'/g, '$1');      // order-3: X2' == X (WCA + NS letters)
  return s.trim().replace(/\s+/g, ' ');
}
// inverse of a state-as-permutation (the state an alg solves)
function inverseState(X) {
  const s = { ctr: new Array(6), fx: X.fx.map(v => (3 - v % 3) % 3), fp: new Array(4), fo: new Array(4) };
  for (let f = 0; f < 6; f++) s.ctr[X.ctr[f]] = f;
  for (let q = 0; q < 4; q++) { const p = X.fp[q]; s.fp[p] = q; s.fo[p] = (3 - X.fo[q] % 3) % 3; }
  return s;
}
let _syms = null, _rotBy = null;
function _keyEnsure() {
  if (_syms) return;
  _syms = buildSyms(); _rotBy = makeFrames(_syms);
}
// the exact state an alg solves, or null if it doesn't parse / doesn't solve cleanly
function caseStateOf(algStr) {
  _keyEnsure();
  const p = parseAlg(preprocessAlg(algStr));
  if (!p) return null;
  const cs = inverseState(applyParsed(p, solved(), _syms, _rotBy));
  const back = applyParsed(p, copy(cs), _syms, _rotBy);
  return eq(back, solved()) ? cs : null;
}
// display normalization: collapse adjacent identical face turns (R R -> R2, R' R' -> R2')
function normAlg(alg) {
  const toks = String(alg).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean), out = [];
  for (let i = 0; i < toks.length; i++) {
    const m = /^([ULRBFfrbl])('?)$/.exec(toks[i]);
    if (m && toks[i + 1] === toks[i]) { out.push(m[1] + (m[2] ? "2'" : '2')); i++; }
    else out.push(toks[i]);
  }
  return out.join(' ');
}
// prepend `p` quarter y-rotations (mod 4) to an alg, folding into a leading y token
const Y_QT = { y: 1, y2: 2, "y2'": 2, "y'": 3 };
function prependAUF(p, alg) {
  p = ((p % 4) + 4) % 4;
  const toks = String(alg).trim().split(/\s+/).filter(Boolean);
  const lead = toks.length && Y_QT[toks[0]] != null ? Y_QT[toks[0]] : 0;
  const v = (p + lead) % 4;
  const tok = v === 0 ? '' : v === 1 ? 'y' : v === 2 ? 'y2' : "y'";
  if (lead) { if (v === 0) toks.shift(); else toks[0] = tok; return toks.join(' '); }
  return tok ? (tok + (toks.length ? ' ' + toks.join(' ') : '')) : toks.join(' ');
}
// does an alg solve the given key exactly?
function algSolvesKey(algStr, key) {
  _keyEnsure();
  const p = parseAlg(preprocessAlg(algStr));
  if (!p) return false;
  return eq(applyParsed(p, keyToState(key), _syms, _rotBy), solved());
}

module.exports = {
  FACES, S4, G4, OPP, MOVES, NSLOTS,
  solved, copy, eq, move, applyMoveIdx, idx, unidx,
  buildSyms, symFromFacePerm, applySym, composeSym, makeCanon, makeMirrorCanon, makeFullCanon,
  parseAlg, countMoves, applyParsed, makeFrames, mirrorAlg,
  optimalSolution, optimalScramble, invertAlg, faceCompose, FACE_ID,
  // notation systems: WCA (default) and NS ("Rubik'skewb", the Sarah/NS sheets)
  wcaToNS, nsToWCA, convertAlg,
  // keying + alg→case (single source of truth)
  stateKey, realCanonKey, keyToState, permsOf, permParity, enumFreeSlots,
  preprocessAlg, inverseState, caseStateOf, algSolvesKey, normAlg, prependAUF,
  // skewb-specific: geometry + facelet model (renderer, tools, tests)
  AXIS, FREE, CFACES, STICKER_POS, CPOS, WCA_CORNER, CLASS,
  toFacelets, toFixedFacelets, fromFacelets, solvedFacelets, moveFaceletPerm: MFP, applyFaceletPerm,
  WCA_FACELET_MOVES, nativeToWCA,
};

window.OOEngine=module.exports;})();
