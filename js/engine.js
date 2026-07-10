/* fto.twistytools.com — FTO engine: state model, moves, rotations, parsing. */
(function(){const module={exports:{}};
// Face-Turning Octahedron engine. See docs/fto-ground-truth.md for the domain
// facts and docs/port-plan.md M1 for the contract changes vs the Skewb engine.
//
// Geometry: unit octahedron |x|+|y|+|z| <= 1. Faces are sign vectors s in
// {±1}^3 (plane s·p = 1), cut planes at s·p = 1/3. Vertices are ±e_k. Every
// face turns 120°; "clockwise" ALWAYS means clockwise viewed from OUTSIDE the
// turned face / rotated vertex, which equals the right-hand rotation about the
// outward axis by MINUS the angle. Direction and every move table are pinned
// against xyzzy's ftosolver.js tables in tools/test-engine.mjs.
//
// Facelet scheme (identical to xyzzy's ftosolver.js, by construction):
//   facelet index = 9*face + pos; faces [U, F, BR, BL, L, R, D, B];
//   pos 0/4/8 = corner stickers toward the face's ±x/±y/±z vertex,
//   pos 2/5/7 = centre stickers toward the same vertices,
//   pos 1/3/6 = edge stickers on the face's x–y / x–z / y–z edges.
//
// State: { cp:[6], co:[6], ep:[12], ctr:[24] }
//   cp/co: corner piece (by home vertex slot) + flip (0/1) per vertex slot
//          [+x,+y,+z,-x,-y,-z]; only 180° flips are reachable.
//   ep:    edge piece (by home slot) per edge slot; edges have no orientation.
//   ctr:   centre COLOR (face id 0..7) per centre slot (3*face + axis k);
//          same-color triplets are identical, so colors, not piece ids.
// Whole-puzzle rotations (o tokens, T) are FRAME-ONLY: applyParsed resolves
// written letters through the accumulated rotation and never rotates the
// state, so a pure rotation has identity effect (family convention).

'use strict';

// ---------------- basic geometry ----------------
const FACES = ['U','F','BR','BL','L','R','D','B'];
const FSIGN = [[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,-1],[-1,-1,-1],[-1,1,1]];
const FIDX = {}; FACES.forEach((f,i)=>{ FIDX[f]=i; });
const vkey = v => v.join(',');
const FACE_BY_S = {}; FSIGN.forEach((s,i)=>{ FACE_BY_S[vkey(s)]=i; });
const TETRAD = FSIGN.map(s => (s[0]*s[1]*s[2] > 0) ? 0 : 1);   // 0: U,F,BR,BL  1: L,R,D,B
const OPPF = FSIGN.map(s => FACE_BY_S[vkey(s.map(v=>-v))]);    // U-D F-B BR-L BL-R
const OPP = {}; FACES.forEach((f,i)=>{ OPP[f]=FACES[OPPF[i]]; });

// vertex slots 0..5 = +x,+y,+z,-x,-y,-z
const VAX = [[1,0,0],[0,1,0],[0,0,1],[-1,0,0],[0,-1,0],[0,0,-1]];
const VBY = {}; VAX.forEach((v,i)=>{ VBY[vkey(v)]=i; });
const dot = (a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];

// ---------------- rotations: signed axis permutations ----------------
// M = {p,s}: (Mv)[i] = s[i]*v[p[i]]. mul(A,B) = A∘B (apply B first).
const MID = { p:[0,1,2], s:[1,1,1] };
function mul(A,B){ const p=[0,0,0], s=[0,0,0];
  for (let i=0;i<3;i++){ p[i]=B.p[A.p[i]]; s[i]=A.s[i]*B.s[A.p[i]]; }
  return {p,s};
}
function mInv(M){ const p=[0,0,0], s=[0,0,0];
  for (let i=0;i<3;i++){ p[M.p[i]]=i; s[M.p[i]]=M.s[i]; }
  return {p,s};
}
function mApply(M,v){ return [M.s[0]*v[M.p[0]], M.s[1]*v[M.p[1]], M.s[2]*v[M.p[2]]]; }
const mKey = M => M.p.join('')+(M.s.map(x=>x>0?'+':'-').join(''));

// CW-from-outside 120° about face U's axis (1,1,1): point map (x,y,z)->(y,z,x).
const ROT_U = { p:[1,2,0], s:[1,1,1] };
// CW-from-outside 90° about the front vertex +x (the T rotation): (x,y,z)->(x,z,-y).
const ROT_T = { p:[0,2,1], s:[1,1,-1] };
// mirror y -> -y (xyzzy's Z symmetry: swaps U-L, F-R, BR-D, BL-B)
const MIRROR = { p:[0,1,2], s:[1,-1,1] };

// CW 120° rotation about face f: conjugate ROT_U by diag(s); an odd sign
// product makes diag(s) improper, so conjugate the INVERSE to stay clockwise.
function faceRot(f){
  const s = FSIGN[f], D = { p:[0,1,2], s:s.slice() };
  const core = TETRAD[f]===0 ? ROT_U : mInv(ROT_U);
  return mul(D, mul(core, D));
}
const FROT = FACES.map((_,f)=>faceRot(f));

// full rotation group (24) by closure from {faceRot(U), T}
const ROT24 = (() => {
  const seen = { [mKey(MID)]: MID };
  let frontier = [MID];
  while (frontier.length){
    const next = [];
    for (const g of frontier) for (const h of [ROT_U, ROT_T]){
      const e = mul(h,g), k = mKey(e);
      if (!seen[k]){ seen[k]=e; next.push(e); }
    }
    frontier = next;
  }
  return Object.values(seen);
})();

const faceImg = (M,f) => FACE_BY_S[vkey(mApply(M, FSIGN[f]))];
const vertImg = (M,v) => VBY[vkey(mApply(M, VAX[v]))];

// ---------------- facelet table ----------------
// FEAT[i] = {f, t:'c'|'x'|'e', v, v2}; lookups by (face, feature).
const CPOSN=[0,4,8], XPOSN=[2,5,7], EPOSN={ '01':1, '02':3, '12':6 };
const FEAT = new Array(72);
const cornerFacelet = {}, centreFacelet = {}, edgeFacelet = {};
for (let f=0; f<8; f++){
  const s = FSIGN[f];
  for (let k=0; k<3; k++){
    const v = VBY[vkey([0,1,2].map(i=>i===k?s[k]:0))];
    FEAT[9*f+CPOSN[k]] = { f, t:'c', v };
    FEAT[9*f+XPOSN[k]] = { f, t:'x', v };
    cornerFacelet[f+'|'+v] = 9*f+CPOSN[k];
    centreFacelet[f+'|'+v] = 9*f+XPOSN[k];
  }
  for (const kk of ['01','02','12']){
    const k1=+kk[0], k2=+kk[1];
    const v1 = VBY[vkey([0,1,2].map(i=>i===k1?s[k1]:0))];
    const v2 = VBY[vkey([0,1,2].map(i=>i===k2?s[k2]:0))];
    const lo = Math.min(v1,v2), hi = Math.max(v1,v2);
    FEAT[9*f+EPOSN[kk]] = { f, t:'e', v:lo, v2:hi };
    edgeFacelet[f+'|'+lo+'|'+hi] = 9*f+EPOSN[kk];
  }
}
function faceletImg(M, i){                 // push image of facelet i under rotation M
  const ft = FEAT[i], g = faceImg(M, ft.f);
  if (ft.t==='c') return cornerFacelet[g+'|'+vertImg(M,ft.v)];
  if (ft.t==='x') return centreFacelet[g+'|'+vertImg(M,ft.v)];
  const a = vertImg(M,ft.v), b = vertImg(M,ft.v2);
  return edgeFacelet[g+'|'+Math.min(a,b)+'|'+Math.max(a,b)];
}
function rotFaceletPerm(M){                // pull perm: new[i] = old[P[i]]
  const P = new Array(72);
  for (let i=0;i<72;i++) P[faceletImg(M,i)] = i;
  return P;
}

// which pieces a turn of face t moves (9*t·centroid tests; see ground truth)
function cornerInLayer(t,v){ return dot(FSIGN[t], VAX[v]) === 1; }
function edgeInLayer(t,v,v2){ return dot(FSIGN[t],VAX[v]) + dot(FSIGN[t],VAX[v2]) === 2; }
function centreInLayer(t,g,v){ return 2*dot(FSIGN[t],FSIGN[g]) + 3*dot(FSIGN[t],VAX[v]) > 3; }
function centreInSlice(t,g,v){ const d = 2*dot(FSIGN[t],FSIGN[g]) + 3*dot(FSIGN[t],VAX[v]); return d > -3 && d < 3; }
function edgeInSlice(t,v,v2){ return dot(FSIGN[t],VAX[v]) + dot(FSIGN[t],VAX[v2]) === 0; }

function pieceMoves(t, i, slice){          // does facelet i's PIECE move under face-turn/slice t?
  const ft = FEAT[i];
  if (!slice){
    if (ft.t==='c') return cornerInLayer(t, ft.v);
    if (ft.t==='e') return edgeInLayer(t, ft.v, ft.v2);
    return centreInLayer(t, ft.f, ft.v);
  }
  if (ft.t==='c') return false;
  if (ft.t==='e') return edgeInSlice(t, ft.v, ft.v2);
  return centreInSlice(t, ft.f, ft.v);
}
function layerFaceletPerm(t, ccw, slice){  // pull perm of a face turn or slice
  const M = ccw ? mul(FROT[t], FROT[t]) : FROT[t];
  const P = new Array(72); for (let i=0;i<72;i++) P[i]=i;
  for (let i=0;i<72;i++) if (pieceMoves(t,i,slice)) P[faceletImg(M,i)] = i;
  return P;
}

// native moves: MOVES[2f] = face f cw, MOVES[2f+1] = ccw
const MOVES = [];
FACES.forEach(f => { MOVES.push(f, f+"'"); });
const MOVE_FPERM = [];
for (let f=0; f<8; f++){ MOVE_FPERM.push(layerFaceletPerm(f,false,false), layerFaceletPerm(f,true,false)); }
const SLICE_FPERM = {};                     // slices spelled with U,F,R,L only
for (const f of ['U','F','R','L']){ SLICE_FPERM[f] = layerFaceletPerm(FIDX[f],false,true); }

function applyFaceletPerm(P, arr){ const o=new Array(arr.length); for (let i=0;i<arr.length;i++) o[i]=arr[P[i]]; return o; }

// ---------------- corner cyclic orders (orientation reference) ----------------
// CYC[v]: the 4 faces around vertex v in the CW-from-outside 90° order,
// rotated so CYC[v][0] is the smaller tetrad-A face; indices 0,2 = tetrad A.
const Q90 = VAX.map(a => {                 // CW-from-outside 90° about vertex axis a
  const k = a.findIndex(x=>x!==0), sign = a[k];
  const base = [ {p:[0,2,1],s:[1,-1,1]}, {p:[2,1,0],s:[1,1,-1]}, {p:[1,0,2],s:[-1,1,1]} ][k]; // RH +90° about +e_k
  // CW from outside about a = RH -90° about a = (RH +90° about +e_k)^(sign>0 ? 3 : 1)
  let M = MID; const n = sign>0 ? 3 : 1;
  for (let i=0;i<n;i++) M = mul(base, M);
  return M;
});
const CYC = VAX.map((a,v) => {
  const fs = [];
  let f = FSIGN.findIndex((s,i)=>dot(s,a)===1 && TETRAD[i]===0);  // smallest tetrad-A face at v
  for (let i=0;i<4;i++){ fs.push(f); f = faceImg(Q90[v], f); }
  return fs;
});
const CBYA = {};                            // sorted tetrad-A face pair -> home vertex
CYC.forEach((c,v)=>{ CBYA[Math.min(c[0],c[2])+','+Math.max(c[0],c[2])] = v; });

// edge slots: [vLo, vHi, faceA, faceB]
const EDGES = [];
const EBYP = {};                            // 'faceA,faceB' -> edge slot
for (let v=0; v<6; v++) for (let w=v+1; w<6; w++){
  if (dot(VAX[v],VAX[w]) !== 0) continue;
  const fs = FSIGN.map((s,i)=>i).filter(i => dot(FSIGN[i],VAX[v])===1 && dot(FSIGN[i],VAX[w])===1);
  const fa = TETRAD[fs[0]]===0 ? fs[0] : fs[1];
  const fb = TETRAD[fs[0]]===0 ? fs[1] : fs[0];
  EBYP[fa+','+fb] = EDGES.length;
  EDGES.push([v,w,fa,fb]);
}

// ---------------- state <-> facelets ----------------
function solved(){
  const ctr = new Array(24); for (let f=0;f<8;f++) for (let k=0;k<3;k++) ctr[3*f+k]=f;
  return { cp:[0,1,2,3,4,5], co:[0,0,0,0,0,0], ep:[0,1,2,3,4,5,6,7,8,9,10,11], ctr };
}
function copy(s){ return { cp:s.cp.slice(), co:s.co.slice(), ep:s.ep.slice(), ctr:s.ctr.slice() }; }
function eq(a,b){
  for (let i=0;i<6;i++) if (a.cp[i]!==b.cp[i] || a.co[i]!==b.co[i]) return false;
  for (let i=0;i<12;i++) if (a.ep[i]!==b.ep[i]) return false;
  for (let i=0;i<24;i++) if (a.ctr[i]!==b.ctr[i]) return false;
  return true;
}
function solvedFacelets(){ const fl=new Array(72); for (let i=0;i<72;i++) fl[i]=(i/9)|0; return fl; }

function toFacelets(st){
  const fl = new Array(72);
  for (let f=0;f<8;f++) for (let k=0;k<3;k++) fl[9*f+XPOSN[k]] = st.ctr[3*f+k];
  for (let v=0;v<6;v++){
    const q = st.cp[v], o = st.co[v];
    for (let i=0;i<4;i++) fl[cornerFacelet[CYC[v][(i+2*o)%4]+'|'+v]] = CYC[q][i];
  }
  for (let e=0;e<12;e++){
    const [v,w,fa,fb] = EDGES[e], hq = EDGES[st.ep[e]];
    fl[edgeFacelet[fa+'|'+v+'|'+w]] = hq[2];
    fl[edgeFacelet[fb+'|'+v+'|'+w]] = hq[3];
  }
  return fl;
}
function fromFacelets(fl){
  const st = { cp:new Array(6), co:new Array(6), ep:new Array(12), ctr:new Array(24) };
  for (let f=0;f<8;f++) for (let k=0;k<3;k++) st.ctr[3*f+k] = fl[9*f+XPOSN[k]];
  for (let v=0;v<6;v++){
    const col = CYC[v].map(f => fl[cornerFacelet[f+'|'+v]]);
    const q = CBYA[Math.min(col[0],col[2])+','+Math.max(col[0],col[2])];
    if (q === undefined) throw new Error('fromFacelets: no corner piece with colors '+col);
    const h = CYC[q];
    let o;
    if (col[0]===h[0] && col[1]===h[1] && col[2]===h[2] && col[3]===h[3]) o = 0;
    else if (col[0]===h[2] && col[1]===h[3] && col[2]===h[0] && col[3]===h[1]) o = 1;
    else throw new Error('fromFacelets: corner at slot '+v+' in an unreachable twist ['+col+']');
    st.cp[v]=q; st.co[v]=o;
  }
  for (let e=0;e<12;e++){
    const [v,w,fa,fb] = EDGES[e];
    const q = EBYP[fl[edgeFacelet[fa+'|'+v+'|'+w]]+','+fl[edgeFacelet[fb+'|'+v+'|'+w]]];
    if (q === undefined) throw new Error('fromFacelets: no edge piece with colors at slot '+e);
    st.ep[e]=q;
  }
  return st;
}

// ---------------- state-level move tables (derived from the facelet perms) ----------------
// TBL[m] = { cperm, cflip, eperm, xperm } with newX[t] = oldX[perm[t]] (pull).
const TBL = MOVE_FPERM.map(P => {
  const cperm=new Array(6), cflip=new Array(6), eperm=new Array(12), xperm=new Array(24);
  for (let v=0;v<6;v++){
    const src = FEAT[P[cornerFacelet[CYC[v][0]+'|'+v]]];   // where slot v's first A sticker came from
    cperm[v] = src.v;
    cflip[v] = CYC[src.v].indexOf(src.f) === 0 ? 0 : 1;
  }
  for (let e=0;e<12;e++){
    const [v,w,fa] = EDGES[e];
    const src = FEAT[P[edgeFacelet[fa+'|'+v+'|'+w]]];
    eperm[e] = EDGES.findIndex(E => E[0]===Math.min(src.v,src.v2) && E[1]===Math.max(src.v,src.v2));
  }
  for (let f=0;f<8;f++) for (let k=0;k<3;k++){
    const src = FEAT[P[9*f+XPOSN[k]]];
    xperm[3*f+k] = 3*src.f + (src.v % 3);    // vertex ids 0..5 = axis (v%3) with sign
  }
  return { cperm, cflip, eperm, xperm };
});
function move(st, m){
  const t = TBL[m], o = { cp:new Array(6), co:new Array(6), ep:new Array(12), ctr:new Array(24) };
  for (let v=0;v<6;v++){ o.cp[v]=st.cp[t.cperm[v]]; o.co[v]=st.co[t.cperm[v]]^t.cflip[v]; }
  for (let e=0;e<12;e++) o.ep[e]=st.ep[t.eperm[e]];
  for (let x=0;x<24;x++) o.ctr[x]=st.ctr[t.xperm[x]];
  return o;
}

// ---------------- notation ----------------
// Base system: Ben Streeter's "FTO Notes" (face moves U F R L D B BR BL + ',
// w wides, s slices with U/R/F/L spellings, o rotations, T/T'/T2), extended
// per the community "FTO Notation" doc (Sonja Black) for the M3 sheet data:
// {X,Y} bracket rotations (face at position X goes to the U position, face at
// position Y to the F position — may shift the hold between CIF and EIF),
// X2 ergonomic doubles (≡ X'), lowercase wide letters (r ≡ Rw), and an
// EIF (edge-in-front) starting-hold dialect for EIF-authored sheets.
function preprocessAlg(a){
  let s = ' ' + String(a).trim() + ' ';
  s = s.replace(/[’‘´`]/g, "'");          // normalize smart quotes to ASCII
  s = s.replace(/\{\s*(BR|BL|[UFRLDB])\s*,\s*(BR|BL|[UFRLDB])\s*\}/g, ' {$1,$2} ');
  s = s.replace(/[()]/g, ' ');            // sheets group with parens
  return s.replace(/\s+/g, ' ').trim();
}
const TOKRE = /^(BR|BL|[UFRLDB])(w|s|o)?(2)?(')?$/;
const WIDERE = /^(br|bl|[ufrldb])(2)?(')?$/;
function parseAlg(str){
  const out = [];
  const toks = preprocessAlg(str).split(' ').filter(Boolean);
  if (!toks.length) return out;
  for (const t of toks){
    let m;
    if ((m = /^\{(BR|BL|[UFRLDB]),(BR|BL|[UFRLDB])\}$/.exec(t))){
      out.push({ kind:'hold', x: FIDX[m[1]], y: FIDX[m[2]] }); continue;
    }
    if ((m = /^T(2)?(')?$/.exec(t))){ out.push({ kind:'rot', axis:'T', amt: m[1] ? 2 : (m[2] ? 3 : 1) }); continue; }
    if ((m = TOKRE.exec(t))){
      const f = m[1], suf = m[2] || '', dbl = !!m[3], ccw = !!m[4];
      if (suf === 's' && !(f==='U'||f==='R'||f==='F'||f==='L')) return null;  // slices are spelled with the front four
      if (suf === 'o') out.push({ kind:'rot', axis:f, amt: (ccw ? 2 : 1) * (dbl ? 2 : 1) % 3 || 1 });
      else out.push({ kind:'move', f, suf, ccw, dbl });
      continue;
    }
    if ((m = WIDERE.exec(t))){
      out.push({ kind:'move', f: m[1].toUpperCase(), suf: 'w', ccw: !!m[3], dbl: !!m[2] }); continue;
    }
    return null;
  }
  return out;
}
function countMoves(parsed){ let n=0; for (const t of parsed) if (t.kind==='move') n++; return n; }

// hold semantics: a HOLD maps the 8 written POSITIONS (same letters as faces)
// to the physical faces currently sitting there. CIF holds have vertex-
// adjacent U/F positions, EIF holds edge-adjacent ones — 24 of each, and the
// {X,Y} bracket picks the unique hold with face-at-X on top and face-at-Y in
// front (impossible pairs throw). Turn direction is hold-invariant (clockwise
// is always viewed from outside the turned face). Rotations never touch the
// state (family convention) — they only re-map positions.
function tokenRotMat(axis, amt){           // matrix form (renderer/tests); CIF-anchored
  const base = axis==='T' ? ROT_T : FROT[FIDX[axis]];
  let M = MID; for (let i=0;i<amt;i++) M = mul(base, M);
  return M;
}
// EIF base hold: positions [U,F,BR,BL,L,R,D,B] hold faces [U,L,R,B,BL,F,D,BR]
// (derived from the community notation doc's CIF/EIF illustrations; pinned by
// the TCP sheet's layer-locality + recognition structure in test-engine).
const EIF0 = [0,4,5,7,3,1,6,2];
const HOLDS = (() => {                      // 'u,f' -> position map (48 holds)
  const out = {};
  for (const g of ROT24){
    const cif = [0,1,2,3,4,5,6,7].map(p => faceImg(g, p));
    out[cif[0]+','+cif[1]] = cif;
    const eif = EIF0.map(f => faceImg(g, f));
    out[eif[0]+','+eif[1]] = eif;
  }
  return out;
})();
function holdAfterBracket(hold, x, y){
  const h2 = HOLDS[hold[x] + ',' + hold[y]];
  if (!h2) throw new Error('impossible rotation {' + FACES[x] + ',' + FACES[y] + '} from this hold');
  return h2;
}
// o-token: rotate the puzzle about the axis of POSITION X, in the direction of
// the face there. Positions permute by π = ε⁻¹∘ρ_{ε(X)}∘ε where ε is the
// hold-type base map (identity for CIF holds, EIF0 for EIF holds) — from a
// CIF hold this reproduces the community doc's bracket table (Uo = {U,BR},
// Ro = {F,BR}, …), and from an EIF hold it stays EIF, as physical rotation
// about a position axis must. T rotates about the front VERTEX, which only
// exists in CIF holds; per the doc it is the bracket {L,R}.
const EIF0INV = (() => { const o = new Array(8); EIF0.forEach((f,p)=>{ o[f]=p; }); return o; })();
function isEifHold(hold){
  const du = FSIGN[hold[0]], df = FSIGN[hold[1]];
  return (du[0]*df[0] + du[1]*df[1] + du[2]*df[2]) === 1;   // edge-adjacent U/F faces
}
function holdAfterRot(hold, axis, amt){
  if (axis === 'T'){
    for (let i=0;i<amt;i++) hold = holdAfterBracket(hold, 4, 5);   // {L,R}
    return hold;
  }
  const eif = isEifHold(hold);
  const eps = eif ? EIF0 : null, epsInv = eif ? EIF0INV : null;
  const M = FROT[eps ? eps[FIDX[axis]] : FIDX[axis]];
  const Mk = amt === 2 ? mul(M, M) : M;
  const out = new Array(8);
  for (let p=0;p<8;p++){
    // new_h(p) = h(π⁻¹(p)),  π(q) = ε⁻¹( ρ(ε(q)) )  ⇒  π⁻¹(p) = ε⁻¹( ρ⁻¹(ε(p)) )
    const q = eps ? epsInv[faceImg(mInv(Mk), eps[p])] : faceImg(mInv(Mk), p);
    out[p] = hold[q];
  }
  return out;
}
function walkParsed(parsed, onMove, dialect){  // shared resolution -> native move indices
  let hold = dialect === 'eif' ? EIF0 : [0,1,2,3,4,5,6,7];
  for (const t of parsed){
    if (t.kind === 'hold'){ hold = holdAfterBracket(hold, t.x, t.y); continue; }
    if (t.kind === 'rot'){ hold = holdAfterRot(hold, t.axis, t.amt); continue; }
    const d = t.ccw ? 1 : 0;
    const reps = t.dbl ? 2 : 1;
    for (let r=0;r<reps;r++){
      const f0 = hold[FIDX[t.f]];            // re-resolve: w/s reps rotate the hold
      if (t.suf === ''){ onMove(2*f0+d); continue; }
      // Xw = Xo ∘ OPP(X);  Xs = Xo ∘ X' ∘ OPP(X)  (same-axis factors commute)
      if (t.suf === 's') onMove(2*f0 + (d^1));
      onMove(2*OPPF[f0] + d);
      hold = holdAfterRot(hold, t.f, t.ccw ? 2 : 1);
    }
  }
  return hold;
}
function applyParsed(parsed, state, dialect){
  let s = copy(state);
  walkParsed(parsed, m => { s = move(s, m); }, dialect);
  return s;
}

// effect of an alg as an invertible slot-level table (centres as SLOT perms,
// so inversion is exact even though same-color centre pieces are identical)
function idTable(){
  return { cperm:[0,1,2,3,4,5], cflip:[0,0,0,0,0,0],
           eperm:[0,1,2,3,4,5,6,7,8,9,10,11],
           xperm: Array.from({length:24},(_,i)=>i) };
}
function composeTable(T, m){               // net' = m ∘ T (apply m after T)
  const o = idTable();
  for (let v=0;v<6;v++){ o.cperm[v]=T.cperm[m.cperm[v]]; o.cflip[v]=T.cflip[m.cperm[v]]^m.cflip[v]; }
  for (let e=0;e<12;e++) o.eperm[e]=T.eperm[m.eperm[e]];
  for (let x=0;x<24;x++) o.xperm[x]=T.xperm[m.xperm[x]];
  return o;
}
function invertTable(T){
  const o = idTable();
  for (let v=0;v<6;v++){ o.cperm[T.cperm[v]]=v; o.cflip[T.cperm[v]]=T.cflip[v]; }
  for (let e=0;e<12;e++) o.eperm[T.eperm[e]]=e;
  for (let x=0;x<24;x++) o.xperm[T.xperm[x]]=x;
  return o;
}
function applyTable(T, s){
  const o = { cp:new Array(6), co:new Array(6), ep:new Array(12), ctr:new Array(24) };
  for (let v=0;v<6;v++){ o.cp[v]=s.cp[T.cperm[v]]; o.co[v]=s.co[T.cperm[v]]^T.cflip[v]; }
  for (let e=0;e<12;e++) o.ep[e]=s.ep[T.eperm[e]];
  for (let x=0;x<24;x++) o.ctr[x]=s.ctr[T.xperm[x]];
  return o;
}
function effectTable(parsed, dialect){
  let T = idTable();
  walkParsed(parsed, m => { T = composeTable(T, TBL[m]); }, dialect);
  return T;
}

function invertAlg(str){
  // Valid WITHIN one token stream (each inverted token re-resolves through the
  // walked-back hold). Across separate applyParsed evaluations the hold
  // restarts, so this only inverts rotation-free algs (w/s inject rotations
  // too) — caseStateOf therefore inverts at the table level, not the text.
  // {X,Y} brackets are not textually invertible (the restoring bracket depends
  // on the hold at that point): returns null for bracket-containing algs.
  if (String(str).indexOf('{') >= 0) return null;
  return preprocessAlg(str).split(' ').filter(Boolean).reverse()
    .map(t => t === 'T2' || t === "T2'" ? 'T2' : (t.endsWith("'") ? t.slice(0,-1) : t + "'")).join(' ');
}
const MIRF = FSIGN.map(s => FACE_BY_S[vkey(mApply(MIRROR, s))]);  // U↔L F↔R BR↔D BL↔B
function mirrorAlg(str){
  if (String(str).indexOf('{') >= 0) return null;   // brackets: not textually mirrorable
  return preprocessAlg(str).split(' ').filter(Boolean).map(t => {
    let m;
    if ((m = /^T(2)?(')?$/.exec(t))) return m[1] ? 'T2' : (m[2] ? 'T' : "T'");
    if ((m = TOKRE.exec(t)))
      return FACES[MIRF[FIDX[m[1]]]] + (m[2]||'') + (m[3]||'') + (m[4] ? '' : "'");
    if ((m = WIDERE.exec(t)))
      return FACES[MIRF[FIDX[m[1].toUpperCase()]]].toLowerCase() + (m[2]||'') + (m[3] ? '' : "'");
    return t;
  }).join(' ');
}
function normAlg(alg){
  const p = parseAlg(alg);
  if (!p) return String(alg).replace(/\s+/g,' ').trim();
  return p.map(t => {
    if (t.kind==='hold') return '{' + FACES[t.x] + ',' + FACES[t.y] + '}';
    if (t.kind==='rot')
      return t.axis==='T' ? (t.amt===2?'T2':(t.amt===3?"T'":'T')) : t.axis+'o'+(t.amt===2?"'":'');
    return t.f + t.suf + (t.dbl?'2':'') + (t.ccw?"'":'');   // lowercase wides normalize to Xw
  }).join(' ');
}

// ---------------- keying ----------------
function stateKey(s){
  return s.cp.join('') + s.co.join('') + '|' + s.ep.map(e=>e.toString(12)).join('') + '|' + s.ctr.join('');
}
function keyToState(k){
  const parts = String(k).split('|');
  if (parts.length !== 3 || parts[0].length !== 12 || parts[1].length !== 12 || parts[2].length !== 24)
    throw new Error('keyToState: malformed key');
  const [c, e, x] = parts;
  return { cp: c.slice(0,6).split('').map(Number), co: c.slice(6).split('').map(Number),
           ep: e.split('').map(ch=>parseInt(ch,12)), ctr: x.split('').map(Number) };
}
// M1: identity fold — the case-symmetry fold is decided with the M3 sheet data
// (docs/port-plan.md). Widening this later must re-key the compiled sheet.
function realCanonKey(s){ return stateKey(s); }

function caseStateOf(algStr, dialect){
  const p = parseAlg(algStr);
  if (!p || !p.length) return null;
  try {
    const cs = applyTable(invertTable(effectTable(p, dialect)), solved());
    return eq(applyParsed(p, copy(cs), dialect), solved()) ? cs : null;
  } catch (e) { return null; }              // impossible {X,Y} bracket en route
}
function algSolvesKey(algStr, key, dialect){
  const p = parseAlg(algStr);
  if (!p) return false;
  let st;
  try { st = keyToState(key); } catch (e) { return false; }   // malformed key: no
  try { return eq(applyParsed(p, st, dialect), solved()); }
  catch (e) { return false; }               // impossible bracket
}

// ---------------- scrambles ----------------
function randomScramble(len, rnd){
  len = len || 30; rnd = rnd || Math.random;
  const out = []; let last = -1, prev = -1;
  while (out.length < len){
    const f = (rnd()*8)|0;
    if (f === last) continue;
    if (last >= 0 && OPPF[f] === last && f === prev) continue;  // no R BL R
    out.push(2*f + ((rnd()*2)|0)); prev = last; last = f;
  }
  return out.map(m => MOVES[m]).join(' ');
}

// ---------------- verifier helpers ----------------
function stateSpaceCount(){                 // 6!·2^3·11!·(12!)^2/(3!)^8 (Jaap)
  const fact = n => { let r=1n; for (let i=2n;i<=n;i++) r*=i; return r; };
  return (fact(6n) * 8n * fact(11n) * fact(12n)*fact(12n)) / (6n**8n);
}

module.exports = {
  FACES, FIDX, FSIGN, OPP, OPPF, TETRAD, MOVES, VAX, EDGES, CYC, FEAT,
  solved, copy, eq, move, applyMoveIdx: move, moveTables: TBL,
  parseAlg, countMoves, applyParsed, preprocessAlg, normAlg, invertAlg, mirrorAlg,
  effectTable, invertTable, applyTable, idTable,
  stateKey, keyToState, realCanonKey, caseStateOf, algSolvesKey,
  toFacelets, fromFacelets, solvedFacelets, applyFaceletPerm,
  moveFaceletPerm: MOVE_FPERM, sliceFaceletPerm: SLICE_FPERM,
  rotFaceletPerm, tokenRotMat, mul, mInv, mApply, MID, ROT_T, ROT24, MIRROR, faceImg, vertImg,
  EIF0, HOLDS, walkParsed,
  randomScramble, stateSpaceCount,
};
window.OOEngine=module.exports;})();
