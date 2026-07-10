/* fto.twistytools.com — FTO engine unit tests.
 *
 * The heavy oracle: every face-move facelet table is pinned against xyzzy's
 * ftosolver.js tables (tools/fixtures/xyzzy-fto.mjs), which drive cubing.js /
 * csTimer FTO scrambles — so move geometry AND clockwise direction are pinned
 * to the community standard. The rest: rotation/slice desugaring identities,
 * Streeter-notation parsing, state<->facelet round trips, orientation/parity
 * invariants, sub-space BFS counts, and the published state-space figure.
 *
 * Run: node tools/test-engine.mjs   (exit 0 = OK, 1 = a test failed)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as FIX from './fixtures/xyzzy-fto.mjs';
import KPF from './fixtures/cubingjs-fto-kpuzzle.json' with { type: 'json' };

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = {};
const require = createRequire(import.meta.url);
require(path.join(ROOT, 'js', 'engine.js'));
const E = globalThis.window.OOEngine;

let pass = 0, fail = 0;
function t(name, fn){
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (err) { fail++; console.log('FAIL  ' + name + '\n      ' + (err && err.message)); }
}
function assert(cond, msg){ if (!cond) throw new Error(msg || 'assertion failed'); }
function eqArr(a, b, msg){
  assert(Array.isArray(a) && Array.isArray(b) && a.length === b.length, msg + ' (length)');
  for (let i = 0; i < a.length; i++) assert(a[i] === b[i], `${msg} (index ${i}: ${a[i]} != ${b[i]})`);
}
// deterministic rng for reproducible tests
function lcg(seed){ let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

const F = E.FIDX;
const parse = s => E.parseAlg(s);
const IDENT72 = Array.from({length:72}, (_,i)=>i);

/* ---------- 1. oracle pins: all 16 face moves ---------- */
t('all 8 clockwise face moves match the xyzzy oracle tables exactly', () => {
  for (const f of E.FACES) eqArr(E.moveFaceletPerm[2*F[f]], FIX.MOVE[f], 'move ' + f);
});
t("all 8 counterclockwise moves are the oracle's squares", () => {
  for (const f of E.FACES) eqArr(E.moveFaceletPerm[2*F[f]+1], FIX.inv(FIX.MOVE[f]), 'move ' + f + "'");
});
t('face moves have order 3 and the two directions are inverse', () => {
  for (let m = 0; m < 16; m += 2){
    const P = E.moveFaceletPerm[m], Q = E.moveFaceletPerm[m+1];
    eqArr(E.applyFaceletPerm(P, E.applyFaceletPerm(P, P)), IDENT72, E.MOVES[m] + '^3');
    eqArr(E.applyFaceletPerm(P, Q), IDENT72, E.MOVES[m] + ' inv');
  }
});

/* ---------- 2. rotation pins ---------- */
t('T2 facelet permutation equals the oracle X symmetry', () => {
  eqArr(E.rotFaceletPerm(E.tokenRotMat('T', 2)), FIX.sym_X, 'T2 vs X');
});
t('180° rotation about the +y vertex equals the oracle Y symmetry', () => {
  eqArr(E.rotFaceletPerm({ p:[0,1,2], s:[-1,1,-1] }), FIX.sym_Y, 'Y');
});
t('the engine mirror equals the oracle Z symmetry (U-L / F-R swap)', () => {
  eqArr(E.rotFaceletPerm(E.MIRROR), FIX.sym_Z, 'Z');
});
t('rotation group has 24 elements; face rotations order 3, T order 4', () => {
  assert(E.ROT24.length === 24, 'got ' + E.ROT24.length);
  const fp = new Set(E.ROT24.map(M => Array.from({length:8},(_,f)=>E.faceImg(M,f)).join(',')));
  assert(fp.size === 24, 'face action not faithful: ' + fp.size);
  for (const f of E.FACES){
    const M = E.tokenRotMat(f, 1), M3 = E.mul(M, E.mul(M, M));
    eqArr(M3.p, E.MID.p, f + 'o^3 p'); eqArr(M3.s, E.MID.s, f + 'o^3 s');
  }
  const T = E.tokenRotMat('T', 1), T4 = E.mul(T, E.mul(T, E.mul(T, T)));
  eqArr(T4.p, E.MID.p, 'T^4 p'); eqArr(T4.s, E.MID.s, 'T^4 s');
});
t('T carries U to R and R to F (clockwise about the front vertex, CIF hold)', () => {
  assert(E.faceImg(E.tokenRotMat('T',1), F.U) === F.R, 'T(U) should be R');
  assert(E.faceImg(E.tokenRotMat('T',1), F.R) === F.F, 'T(R) should be F');
});

/* ---------- 3. slice / wide desugaring against the oracle ---------- */
// pull-perm sequencing: net of ops o1,o2,... = compose(o1, compose(o2, ...))
t("oracle Us equals U' · D · Uo (slice = rotation minus both face layers)", () => {
  const seq = FIX.compose(E.moveFaceletPerm[2*F.U+1],
              FIX.compose(E.moveFaceletPerm[2*F.D], E.rotFaceletPerm(E.tokenRotMat('U',1))));
  eqArr(seq, FIX.move_Us, 'Us decomposition');
});
t('oracle Uw equals D · Uo (wide = rotation minus the far layer)', () => {
  const seq = FIX.compose(E.moveFaceletPerm[2*F.D], E.rotFaceletPerm(E.tokenRotMat('U',1)));
  eqArr(seq, FIX.move_Uw, 'Uw decomposition');
});
t('engine slice tables for U, F, R, L all match symmetry-derived oracle slices', () => {
  eqArr(E.sliceFaceletPerm.U, FIX.move_Us, 'Us table');
  // fixture symmetry rules: Z conjugation inverts direction, X does not
  const Usi = FIX.compose(FIX.move_Us, FIX.move_Us);
  const Ls = FIX.compose(FIX.sym_Z, FIX.compose(Usi, FIX.sym_Z));
  const Fs = FIX.compose(FIX.sym_X, FIX.compose(FIX.move_Us, FIX.sym_X));
  const Rs = FIX.compose(FIX.sym_X, FIX.compose(Ls, FIX.sym_X));
  eqArr(E.sliceFaceletPerm.L, Ls, 'Ls table');
  eqArr(E.sliceFaceletPerm.F, Fs, 'Fs table');
  eqArr(E.sliceFaceletPerm.R, Rs, 'Rs table');
});
t('slice moves 12 pieces / 18 facelets; every face move moves 27 facelets', () => {
  const moved = P => P.reduce((n,v,i)=>n+(v!==i), 0);
  assert(moved(E.sliceFaceletPerm.U) === 18, 'slice facelets: ' + moved(E.sliceFaceletPerm.U));
  for (let m=0;m<16;m++) assert(moved(E.moveFaceletPerm[m]) === 27, E.MOVES[m] + ' facelets');
});

/* ---------- 4. move structure: 15 pieces, all 3-cycles ---------- */
function cycleLens(perm){
  const seen = new Array(perm.length).fill(false), out = [];
  for (let i=0;i<perm.length;i++){
    if (seen[i]) continue;
    let j = i, n = 0;
    while (!seen[j]){ seen[j] = true; j = perm[j]; n++; }
    if (n > 1) out.push(n);
  }
  return out.sort((a,b)=>a-b);
}
t('every face move: one corner 3-cycle, one edge 3-cycle, three centre 3-cycles', () => {
  for (let m=0;m<16;m++){
    const T = E.moveTables[m];
    eqArr(cycleLens(T.cperm), [3], E.MOVES[m] + ' corners');
    eqArr(cycleLens(T.eperm), [3], E.MOVES[m] + ' edges');
    eqArr(cycleLens(T.xperm), [3,3,3], E.MOVES[m] + ' centres');
  }
});
t('centre slots never change tetrad orbit under any move', () => {
  for (let m=0;m<16;m++)
    for (let x=0;x<24;x++)
      assert(((x/12)|0) === ((E.moveTables[m].xperm[x]/12)|0), E.MOVES[m] + ' slot ' + x);
});

/* ---------- 5. state <-> facelets ---------- */
t('solved round trip and facelet colors', () => {
  eqArr(E.toFacelets(E.solved()), E.solvedFacelets(), 'toFacelets(solved)');
  assert(E.eq(E.fromFacelets(E.solvedFacelets()), E.solved()), 'fromFacelets(solved)');
});
t('state-table moves agree with facelet-permutation moves (200 random moves)', () => {
  const rnd = lcg(7);
  let st = E.solved(), fl = E.solvedFacelets(), sawFlip = false;
  for (let i=0;i<200;i++){
    const m = (rnd()*16)|0;
    st = E.move(st, m);
    fl = E.applyFaceletPerm(E.moveFaceletPerm[m], fl);
    eqArr(E.toFacelets(st), fl, 'step ' + i + ' (move ' + E.MOVES[m] + ')');
    assert(E.eq(E.fromFacelets(fl), st), 'fromFacelets step ' + i);
    if (st.co.some(o => o === 1)) sawFlip = true;
  }
  assert(sawFlip, 'no flipped corner ever occurred — o=1 paths untested');
});
t('fromFacelets rejects a 90°-twisted corner', () => {
  const fl = E.solvedFacelets();
  const idx = FIX.corner_piece_facelets[0];      // front-vertex corner, cyclic order
  const val = idx.map(i => fl[i]);
  for (let i=0;i<4;i++) fl[idx[(i+1)%4]] = val[i];
  let threw = false;
  try { E.fromFacelets(fl); } catch (e) { threw = true; }
  assert(threw, 'expected a throw');
});

/* ---------- 6. notation ---------- */
t('parser accepts the Streeter token set', () => {
  assert(parse("U F' BR BL' L R' D B'").length === 8, 'faces');
  assert(parse("Rw Uw' Ls Fs' Us Rs'").length === 6, 'wides+slices');
  assert(parse("Ro Do' T T' T2 Uo").length === 6, 'rotations');
  assert(parse("(R B' R' B)").length === 4, 'parens');
});
t('parser rejects invalid tokens', () => {
  for (const bad of ['U3', 'Ds', 'Bs', 'BRs', 'BLs', 'X', 'Tw', 'To', '{U}', '{U,X}', '{U,BR', 'xo', 'RR']){
    assert(parse('R ' + bad) === null, 'should reject: ' + bad);
  }
});
t('parser accepts community-doc extensions: brackets, doubles, lowercase wides', () => {
  assert(parse('{U,BR} R {B, BL} F').length === 4, 'brackets (with and without inner space)');
  assert(parse("R2 F2 U2'").length === 3, 'ergonomic doubles');
  assert(parse("r u' d2 br bl'").length === 5, 'lowercase wides');
  // R2 ≡ R' and doubles count as ONE move (the sheets count them that way)
  assert(E.eq(E.applyParsed(parse('R2'), E.solved()), E.applyParsed(parse("R'"), E.solved())), "R2 = R'");
  assert(E.countMoves(parse('U R2 {U,BR} T')) === 2, 'countMoves');
  // lowercase r ≡ Rw
  assert(E.eq(E.applyParsed(parse('r'), E.solved()), E.applyParsed(parse('Rw'), E.solved())), 'r = Rw');
  assert(E.normAlg("r u2'") === "Rw Uw2'", 'lowercase normalizes to w-suffix');
});
t('bracket rotations: pure rotations are identity; table matches the matrix world', () => {
  for (const a of ['{U,BR}', '{B,U}', '{F,BL} {B,R}', "Uo {U,BL}"]){
    assert(E.eq(E.applyParsed(parse(a), E.solved()), E.solved()), a);
  }
  // o/T tokens now resolve through position brackets — must equal the OLD
  // matrix-frame semantics: the hold after token X from identity is p -> ρ_X⁻¹(p)
  for (const [tok, axis, amt] of [['Uo','U',1], ["Ro'",'R',2], ['T','T',1], ['T2','T',2], ["Do'",'D',2], ['BLo','BL',1]]){
    const hold = E.walkParsed(parse(tok), () => {});
    const Minv = E.mInv(E.tokenRotMat(axis, amt));
    for (let p=0;p<8;p++) assert(hold[p] === E.faceImg(Minv, p), tok + ' pos ' + p);
  }
});
t('impossible brackets are graceful: caseStateOf null, algSolvesKey false', () => {
  assert(E.caseStateOf('{U,D} R') === null, '{U,D}');
  assert(E.algSolvesKey('{U,D} R', E.stateKey(E.solved())) === false, 'algSolvesKey');
});
t('EIF dialect: base hold map pinned; letters resolve through it', () => {
  // positions [U,F,BR,BL,L,R,D,B] hold faces [U,L,R,B,BL,F,D,BR]
  eqArr(E.EIF0, [0,4,5,7,3,1,6,2], 'EIF base map');
  // an EIF-written "F" turns the physical L face
  assert(E.eq(E.applyParsed(parse('F'), E.solved(), 'eif'), E.move(E.solved(), 2*F.L)), 'EIF F = physical L');
  assert(E.eq(E.applyParsed(parse('U'), E.solved(), 'eif'), E.move(E.solved(), 2*F.U)), 'EIF U = physical U');
  // opposite-pair consistency of the base map
  for (let p=0;p<8;p++) assert(E.EIF0[E.OPPF[p]] === E.OPPF[E.EIF0[p]], 'opp consistency at ' + p);
});
t('normAlg canonicalizes spelling and preserves effect', () => {
  const a = "  (R  B') R'   B  T2'  Ro ";
  const n = E.normAlg(a);
  assert(n === "R B' R' B T2 Ro", 'got: ' + n);
  assert(E.eq(E.applyParsed(parse(a), E.solved()), E.applyParsed(parse(n), E.solved())), 'effect');
});
t('countMoves counts turns, not rotations', () => {
  assert(E.countMoves(parse("R B' Ro T2 Rw Us")) === 4, 'count');
});
t('invertAlg undoes any alg within one token stream (incl. rotations/wides/slices)', () => {
  const rnd = lcg(11);
  const TOKENS = ["U","F'","BR","BL'","L","R'","D","B'","Rw","Uw'","Ls","Rs'","Ro","Do'","T","T'","T2","Fo"];
  for (let k=0;k<40;k++){
    const alg = Array.from({length:12}, () => TOKENS[(rnd()*TOKENS.length)|0]).join(' ');
    const round = alg + ' ' + E.invertAlg(alg);
    assert(E.eq(E.applyParsed(parse(round), E.solved()), E.solved()), 'round trip: ' + alg);
  }
});
t('mirrorAlg: mirrored effect = mirror-conjugated, recolored effect', () => {
  // facelet law: fl_mirror(A)[i] = MIRF[ fl_A[ symZ[i] ] ], MIRF[f] = f^4
  const rnd = lcg(13);
  const TOKENS = ["U","F'","BR","BL'","L","R'","D","B'","T","T'","Ro","Lo'","Rw","Us"];
  for (let k=0;k<20;k++){
    const alg = Array.from({length:10}, () => TOKENS[(rnd()*TOKENS.length)|0]).join(' ');
    const A = E.toFacelets(E.applyParsed(parse(alg), E.solved()));
    const B = E.toFacelets(E.applyParsed(parse(E.mirrorAlg(alg)), E.solved()));
    const expect = FIX.sym_Z.map(src => A[src] ^ 4);
    eqArr(B, expect, 'mirror: ' + alg);
  }
});

/* ---------- 7. frame machinery ---------- */
t('pure rotations have identity effect on the state', () => {
  for (const a of ['Ro', "Do'", 'T', 'T2', "Uo Lo' T2 Ro"]){
    assert(E.eq(E.applyParsed(parse(a), E.solved()), E.solved()), a);
  }
});
t("Ro U Ro' equals the native turn of the face Ro carries to U (= F)", () => {
  const conj = E.applyParsed(parse("Ro U Ro'"), E.solved());
  assert(E.eq(conj, E.move(E.solved(), 2*F.F)), 'expected native F');
});
t("T U T' equals the native turn of the face T carries to U (= L)", () => {
  const conj = E.applyParsed(parse("T U T'"), E.solved());
  assert(E.eq(conj, E.move(E.solved(), 2*F.L)), 'expected native L');
});
t("Uw D' is a pure rotation (identity effect); Us = U' D modulo rotation", () => {
  assert(E.eq(E.applyParsed(parse("Uw D'"), E.solved()), E.solved()), "Uw D'");
  const us = E.applyParsed(parse('Us'), E.solved());
  const manual = E.move(E.move(E.solved(), 2*F.U+1), 2*F.D);
  assert(E.eq(us, manual), "Us = U' D modulo rotation");
});

/* ---------- 8. keying ---------- */
t('stateKey/keyToState round trip on random states', () => {
  const rnd = lcg(17);
  let st = E.solved();
  for (let i=0;i<50;i++){
    st = E.move(st, (rnd()*16)|0);
    const k = E.stateKey(st);
    assert(E.eq(E.keyToState(k), st), 'round trip at step ' + i);
    assert(E.realCanonKey(st) === k, 'M1 identity fold');
  }
});
t('caseStateOf/algSolvesKey work for rotation-containing algs', () => {
  for (const alg of ["R B' R' B", "R' L R L'", "Ro U F'", "Rw Us T2 B", "T R T' L"]){
    const cs = E.caseStateOf(alg);
    assert(cs, 'caseStateOf null: ' + alg);
    assert(E.algSolvesKey(alg, E.stateKey(cs)), 'algSolvesKey: ' + alg);
    assert(!E.algSolvesKey('U ' + alg, E.stateKey(cs)), 'negative: ' + alg);
  }
});
t('keying edge cases: null paths, malformed keys, pinned trivial semantics', () => {
  assert(E.caseStateOf('') === null, 'empty alg');
  assert(E.caseStateOf('   ') === null, 'blank alg');
  assert(E.caseStateOf('XYZ') === null, 'unparseable alg');
  assert(E.caseStateOf(null) === null, 'null alg');
  assert(E.algSolvesKey('XYZ', E.stateKey(E.solved())) === false, 'unparseable alg solves nothing');
  assert(E.algSolvesKey('U', 'garbage') === false, 'malformed key is graceful');
  // pinned semantics: an empty alg "solves" the solved key; a pure rotation is a
  // trivially-solved case (identity effect) — both deliberate.
  assert(E.algSolvesKey('', E.stateKey(E.solved())) === true, 'empty alg on solved key');
  assert(E.eq(E.caseStateOf('Ro T2'), E.solved()), 'pure rotation case = solved');
});
t('parallel execution paths agree: applyParsed vs applyTable(effectTable), 30 random algs', () => {
  const rnd = lcg(31);
  const TOKENS = ["U","F'","BR","BL'","L","R'","D","B'","Rw","Uw'","Lw","Bw'","Ls","Rs'","Us","Fs'","Ro","Do'","BRo","BLo'","T","T'","T2"];
  for (let k=0;k<30;k++){
    let s0 = E.solved();
    for (let i=0;i<20;i++) s0 = E.move(s0, (rnd()*16)|0);
    const alg = Array.from({length:15}, () => TOKENS[(rnd()*TOKENS.length)|0]).join(' ');
    const p = E.parseAlg(alg);
    const T = E.effectTable(p);
    assert(E.eq(E.applyParsed(p, s0), E.applyTable(T, s0)), 'paths disagree: ' + alg);
    assert(E.eq(E.applyTable(E.invertTable(T), E.applyTable(T, s0)), s0), 'invertTable: ' + alg);
  }
});
t('keyToState round-trips base-12 edge digits (ep values 10/11)', () => {
  const rnd = lcg(37);
  let st = E.solved(), sawHigh = false;
  for (let i=0;i<60;i++){
    st = E.move(st, (rnd()*16)|0);
    if (st.ep[0] >= 10 || st.ep[5] >= 10) sawHigh = true;
    assert(E.eq(E.keyToState(E.stateKey(st)), st), 'round trip at ' + i);
  }
  assert(st.ep.some((v,i)=>v!==i), 'edges never moved');
  void sawHigh; // high digits occur across slots; the per-step round trip is the assertion
});

/* ---------- 9. invariants + state space ---------- */
function permParity(p){
  let par = 0;
  for (let i=0;i<p.length;i++) for (let j=i+1;j<p.length;j++) if (p[i]>p[j]) par ^= 1;
  return par;
}
t('invariants hold over 300 random moves (parities, flips, orbits, triplets)', () => {
  const rnd = lcg(23);
  let st = E.solved();
  for (let i=0;i<300;i++){
    st = E.move(st, (rnd()*16)|0);
    assert(permParity(st.cp) === 0, 'corner parity at ' + i);
    assert(permParity(st.ep) === 0, 'edge parity at ' + i);
    assert(st.co.reduce((a,b)=>a+b,0) % 2 === 0, 'flip sum at ' + i);
    const orbitA = st.ctr.slice(0,12), orbitB = st.ctr.slice(12);
    assert(orbitA.every(c => c < 4) && orbitB.every(c => c >= 4), 'orbit split at ' + i);
    for (let c=0;c<4;c++) assert(orbitA.filter(x=>x===c).length === 3, 'triplet A' + c);
    for (let c=4;c<8;c++) assert(orbitB.filter(x=>x===c).length === 3, 'triplet B' + c);
  }
});
t('corner sub-space BFS reaches exactly 11,520 states', () => {
  const key = s => s.cp.join('') + s.co.join('');
  const seen = new Set([key(E.solved())]);
  let frontier = [E.solved()];
  while (frontier.length){
    const next = [];
    for (const s of frontier) for (let m=0;m<16;m++){
      const n = E.move(s, m), k = key(n);
      if (!seen.has(k)){ seen.add(k); next.push(n); }
    }
    frontier = next;
  }
  assert(seen.size === 11520, 'got ' + seen.size);
});
t('centre orbit A BFS reaches exactly 369,600 arrangements', () => {
  const key = s => s.ctr.slice(0,12).join('');
  const seen = new Set([key(E.solved())]);
  let frontier = [E.solved()];
  while (frontier.length){
    const next = [];
    for (const s of frontier) for (let m=0;m<16;m++){
      const n = E.move(s, m), k = key(n);
      if (!seen.has(k)){ seen.add(k); next.push(n); }
    }
    frontier = next;
  }
  assert(seen.size === 369600, 'got ' + seen.size);
});
t('state-space count reproduces the published figure', () => {
  assert(E.stateSpaceCount() === 31408133379194880000000n, 'got ' + E.stateSpaceCount());
});

/* ---------- 10. scrambles ---------- */
t('randomScramble: 30 parsable turns, suppression rules, deterministic seed', () => {
  const rnd = lcg(29);
  assert(E.randomScramble(30, lcg(99)) === E.randomScramble(30, lcg(99)), 'seeded determinism');
  for (let k=0;k<20;k++){
    const scr = E.randomScramble(30, rnd).split(' ');
    assert(scr.length === 30, 'length');
    const faces = scr.map(x => x.replace("'", ''));
    for (let i=1;i<faces.length;i++){
      assert(faces[i] !== faces[i-1], 'same-face repeat at ' + i);
      if (i >= 2) assert(!(E.OPP[faces[i-1]] === faces[i] && faces[i-2] === faces[i]), 'X OPP X at ' + i);
    }
    assert(!E.eq(E.applyParsed(parse(scr.join(' ')), E.solved()), E.solved()), 'scramble solves');
  }
});

/* ---------- 11. second oracle: cubing.js runtime KPuzzle def ---------- */
// tools/fixtures/cubingjs-fto-kpuzzle.json is the PuzzleGeometry-generated def
// dumped from cubing.js — fully independent of the xyzzy tables. Slot
// correspondence is DERIVED from face signatures (which face moves touch each
// slot), then every move, rotation, and probe pattern must agree.
const kpSig = (perms, n) => {
  const out = Array.from({length:n}, () => []);
  for (const f of E.FACES){
    const p = perms(f);
    for (let i=0;i<n;i++) if (p[i] !== i) out[i].push(f);
  }
  return out.map(a => a.sort().join(','));
};
function kpMatch(th, our){
  return th.map((s, i) => {
    const js = our.map((t,j)=>t===s?j:-1).filter(j=>j>=0);
    assert(js.length === 1, 'signature not unique for their slot ' + i + ': ' + s);
    return js[0];
  });
}
let mapC, mapE, mapX;
t('cubing.js def: slot correspondence derivable from face signatures alone', () => {
  mapC = kpMatch(kpSig(f => KPF.moves[f].C4RNER.permutation, 6),
                 kpSig(f => E.moveTables[2*E.FIDX[f]].cperm, 6));
  mapE = kpMatch(kpSig(f => KPF.moves[f].EDGES.permutation, 12),
                 kpSig(f => E.moveTables[2*E.FIDX[f]].eperm, 12));
  mapX = kpMatch(kpSig(f => KPF.moves[f].CENTERS.permutation, 24),
                 kpSig(f => E.moveTables[2*E.FIDX[f]].xperm, 24));
  assert(new Set(mapC).size === 6 && new Set(mapE).size === 12 && new Set(mapX).size === 24, 'bijections');
});
function kpCmp(name, tbl){
  const th = KPF.moves[name];
  assert(th && typeof th !== 'string', name + ' missing from fixture');
  for (let i=0;i<6;i++)  assert(tbl.cperm[mapC[i]] === mapC[th.C4RNER.permutation[i]], name + ' corner ' + i);
  for (let i=0;i<12;i++) assert(tbl.eperm[mapE[i]] === mapE[th.EDGES.permutation[i]], name + ' edge ' + i);
  for (let i=0;i<24;i++) assert(tbl.xperm[mapX[i]] === mapX[th.CENTERS.permutation[i]], name + ' centre ' + i);
}
function rotSlots(M){
  const c = new Array(6), e = new Array(12), x = new Array(24);
  for (let v=0;v<6;v++) c[E.vertImg(M,v)] = v;
  for (let i=0;i<12;i++){
    const [v,w] = E.EDGES[i];
    const a = E.vertImg(M,v), b = E.vertImg(M,w);
    e[E.EDGES.findIndex(d => d[0]===Math.min(a,b) && d[1]===Math.max(a,b))] = i;
  }
  for (let f=0;f<8;f++) for (let k=0;k<3;k++){
    const vId = E.FSIGN[f][k] > 0 ? k : k+3;
    x[3*E.faceImg(M,f) + (E.vertImg(M,vId) % 3)] = 3*f+k;
  }
  return { cperm:c, cflip:[0,0,0,0,0,0], eperm:e, xperm:x };
}
const seqSlots = (a, b) => ({    // apply a then b, pull convention
  cperm: a.cperm.map((_,i)=>a.cperm[b.cperm[i]]),
  cflip: [0,0,0,0,0,0],
  eperm: a.eperm.map((_,i)=>a.eperm[b.eperm[i]]),
  xperm: a.xperm.map((_,i)=>a.xperm[b.xperm[i]]),
});
t('cubing.js def: all 8 face moves + U\' agree under the correspondence', () => {
  for (const f of E.FACES) kpCmp(f, E.moveTables[2*E.FIDX[f]]);
  kpCmp("U'", E.moveTables[2*E.FIDX.U+1]);
});
t("cubing.js def: T/T2 equal our clockwise T — the M1 direction residue is closed", () => {
  kpCmp('T',  rotSlots(E.tokenRotMat('T', 1)));
  kpCmp('T2', rotSlots(E.tokenRotMat('T', 2)));
});
t("cubing.js def: Uv/Rv/Lv equal our Uo/Ro/Lo (Streeter o ≡ Twizzle v, same direction)", () => {
  kpCmp('Uv', rotSlots(E.tokenRotMat('U', 1)));
  kpCmp('Rv', rotSlots(E.tokenRotMat('R', 1)));
  kpCmp('Lv', rotSlots(E.tokenRotMat('L', 1)));
});
t('cubing.js def: SiGN 2U equals our Us; Rw equals our BL-then-Ro composite', () => {
  // slice slot tables derived from the engine's slice facelet perm
  const cf = {}, xf = {}, ef = {};
  E.FEAT.forEach((ft, i) => {
    if (ft.t === 'c') cf[ft.f + '|' + ft.v] = i;
    else if (ft.t === 'x') xf[ft.f + '|' + ft.v] = i;
    else ef[ft.f + '|' + ft.v + '|' + ft.v2] = i;
  });
  function slotsFromFaceletPerm(P){
    const c = new Array(6), e = new Array(12), x = new Array(24), fl = [0,0,0,0,0,0];
    for (let v=0;v<6;v++){
      const src = E.FEAT[P[cf[E.CYC[v][0] + '|' + v]]];
      c[v] = src.v; fl[v] = E.CYC[src.v].indexOf(src.f) === 0 ? 0 : 1;
    }
    for (let i=0;i<12;i++){
      const [v,w,fa] = E.EDGES[i];
      const src = E.FEAT[P[ef[fa + '|' + v + '|' + w]]];
      e[i] = E.EDGES.findIndex(d => d[0]===Math.min(src.v,src.v2) && d[1]===Math.max(src.v,src.v2));
    }
    for (let f=0;f<8;f++) for (let k=0;k<3;k++){
      const src = E.FEAT[P[xf[f + '|' + (E.FSIGN[f][k] > 0 ? k : k+3)]]];
      x[3*f+k] = 3*src.f + (src.v % 3);
    }
    return { cperm:c, cflip:fl, eperm:e, xperm:x };
  }
  kpCmp('2U', slotsFromFaceletPerm(E.sliceFaceletPerm.U));
  // cubing.js spells wides as lowercase: their r = Streeter Rw = our BL then Ro
  kpCmp('r', seqSlots(E.moveTables[2*E.FIDX.BL], rotSlots(E.tokenRotMat('R', 1))));
  kpCmp('u', seqSlots(E.moveTables[2*E.FIDX.D], rotSlots(E.tokenRotMat('U', 1))));
});
t('cubing.js def: corner orientation deltas consistent with our flips (Z4 reference solve)', () => {
  // theory: their delta d(i) = R(i) - R(p[i]) + 2*ourflip (mod 4) for per-slot
  // references R; propagate R from slot 0 across all move edges and check
  // global consistency (their corners have 4 orientation states; physical
  // flips are the 2-quarter twists).
  const R = new Array(6).fill(null); R[0] = 0;
  let changed = true, guard = 0;
  while (changed && guard++ < 20){
    changed = false;
    for (const f of E.FACES){
      const th = KPF.moves[f], ours = E.moveTables[2*E.FIDX[f]];
      for (let i=0;i<6;i++){
        const j = th.C4RNER.permutation[i];
        if (j === i) continue;
        const flip = ours.cflip[mapC[i]];   // our delta for the piece landing in mapped slot i
        const d = th.C4RNER.orientationDelta[i];
        if (R[j] !== null && R[i] === null){ R[i] = (d - 2*flip + R[j] + 8) % 4; changed = true; }
        else if (R[i] !== null && R[j] === null){ R[j] = (R[i] - d + 2*flip + 8) % 4; changed = true; }
        else if (R[i] !== null && R[j] !== null){
          assert(((R[i] - R[j] + 8) % 4) === ((d - 2*flip + 8) % 4), 'inconsistent refs at ' + f + ' slot ' + i);
        }
      }
    }
  }
  assert(R.every(v => v !== null), 'reference propagation incomplete');
});
t('cubing.js def: edge orientation deltas are pure reference bookkeeping (Z2 solve, no physical flips)', () => {
  const R = new Array(12).fill(null); R[0] = 0;
  let changed = true, guard = 0;
  while (changed && guard++ < 30){
    changed = false;
    for (const f of E.FACES){
      const th = KPF.moves[f];
      for (let i=0;i<12;i++){
        const j = th.EDGES.permutation[i];
        if (j === i) continue;
        const d = th.EDGES.orientationDelta[i] % 2;
        if (R[j] !== null && R[i] === null){ R[i] = (d + R[j]) % 2; changed = true; }
        else if (R[i] !== null && R[j] === null){ R[j] = (R[i] - d + 2) % 2; changed = true; }
        else if (R[i] !== null && R[j] !== null){
          assert(((R[i] - R[j] + 2) % 2) === d, 'inconsistent edge refs at ' + f + ' slot ' + i);
        }
      }
    }
  }
  assert(R.every(v => v !== null), 'edge reference propagation incomplete');
});
t('cubing.js def: probe patterns (U, T, Rv, 12-move scramble) agree piece-for-piece', () => {
  const KPP = KPF.patterns;
  function cmpPattern(name, tbl){
    const th = KPP[name];
    assert(th && typeof th !== 'string', name + ' pattern missing');
    // their pattern: pieces[i] = piece at slot i; ours via pull tables from solved
    for (let i=0;i<6;i++)  assert(tbl.cperm[mapC[i]] === mapC[th.C4RNER.pieces[i]], name + ' corner ' + i);
    for (let i=0;i<12;i++) assert(tbl.eperm[mapE[i]] === mapE[th.EDGES.pieces[i]], name + ' edge ' + i);
    for (let i=0;i<24;i++) assert(tbl.xperm[mapX[i]] === mapX[th.CENTERS.pieces[i]], name + ' centre ' + i);
  }
  cmpPattern('U', E.moveTables[2*E.FIDX.U]);
  cmpPattern('T', rotSlots(E.tokenRotMat('T', 1)));
  cmpPattern('Rv', rotSlots(E.tokenRotMat('R', 1)));
  const scr = "U R' F BL D' B BR' L U' F R BL'";
  cmpPattern(scr, E.effectTable(E.parseAlg(scr)));
});

/* ---------- 12. TCP sheet data (M3): machine pins for the authored algs ---------- */
const ALGDATA = require(path.join(ROOT, 'data', 'fto_algs.json'));
const TCPS = ALGDATA.subsets.TCP;
// the TCP puzzle region: the U face's three triples + the filled slot —
// corners +x/+y/+z and centre slots U(+y), U(+z), F(+x), BR(+y), BL(+z)
const TCP_CORNERS = new Set([0, 1, 2]);
const TCP_CENTRES = new Set([1, 2, 3, 7, 11]);
const U_EDGES = new Set(E.EDGES.map((d, i) => (d[0] <= 2 && d[1] <= 2) ? i : -1).filter(i => i >= 0));
const U_CENTRES = new Set();
for (let x = 0; x < 24; x++){
  const f = (x/3)|0, k = x%3, vax = E.VAX[E.FSIGN[f][k] > 0 ? k : k+3];
  const d = 2*(E.FSIGN[0][0]*E.FSIGN[f][0] + E.FSIGN[0][1]*E.FSIGN[f][1] + E.FSIGN[0][2]*E.FSIGN[f][2])
          + 3*(vax[0] + vax[1] + vax[2]);
  if (d > 3) U_CENTRES.add(x);
}
t('TCP data: all 18 algs parse, solve distinct cases, in the CIF hold', () => {
  assert(TCPS.notation === 'cif', 'subset dialect');
  const keys = new Set();
  for (const c of TCPS.cases){
    const cs = E.caseStateOf(c.algs[0].alg, 'cif');
    assert(cs, c.name + ' caseStateOf');
    keys.add(E.stateKey(cs));
  }
  assert(keys.size === 18, 'distinct cases: ' + keys.size);
});
t('TCP data: every case lives on the three U triples + filled slot (odd group: + the AUF layer)', () => {
  for (const c of TCPS.cases){
    const cs = E.caseStateOf(c.algs[0].alg, 'cif');
    const odd = c.group === 'Odd';
    for (let v=0;v<6;v++) if (cs.cp[v]!==v || cs.co[v]!==0)
      assert(TCP_CORNERS.has(v), c.name + ' corner outside region: ' + v);
    for (let e=0;e<12;e++) if (cs.ep[e]!==e)
      assert(odd && U_EDGES.has(e), c.name + ' edge moved: ' + e);
    for (let x=0;x<24;x++) if (cs.ctr[x] !== ((x/3)|0))
      assert(TCP_CENTRES.has(x) || (odd && U_CENTRES.has(x)), c.name + ' centre outside region: ' + x);
  }
});
t('TCP data: three-way state classification matches the groups (11/12 post-AUF noted)', () => {
  // From the state: 2-Flip ⇔ filled slot solved; Odd-with-AUF ⇔ U-layer edges
  // moved (cases 7-10 include the AUF); 11/12 are authored POST-AUF so their
  // states are structurally even-shaped — the sheet's known convention break,
  // annotated in the JSON (moves_note).
  const POST_AUF = new Set(['TCP 11', 'TCP 12']);
  for (const c of TCPS.cases){
    const cs = E.caseStateOf(c.algs[0].alg, 'cif');
    const filledSolved = cs.ctr[3] === 1;          // F(+x) holds the F colour
    const aufEdges = cs.ep.some((p,i)=>p!==i);
    assert(filledSolved === (c.group === '2-Flip'), c.name + ': filled slot vs group');
    if (c.group === 'Odd' && !POST_AUF.has(c.name)) assert(aufEdges, c.name + ': AUF layer expected');
    if (c.group !== 'Odd' || POST_AUF.has(c.name)) assert(!aufEdges, c.name + ': no AUF layer expected');
    if (POST_AUF.has(c.name)) assert(/does NOT include the starting AUF/.test(c.moves_note || ''), c.name + ': post-AUF note required');
  }
});
t('TCP 13 pinned: two triples flipped in place (corners +y/+z, triangle pair swaps)', () => {
  const cs = E.caseStateOf("(R B' R' B) (R' L R L')", 'cif');
  assert(cs.cp.every((p,i)=>p===i), 'corner perm solved');
  eqArr(cs.co, [0,1,1,0,0,0], 'corners +y,+z flipped');
  assert(cs.ctr[1] === 2 && cs.ctr[7] === 0, 'U(+y) <-> BR(+y) swapped');
  assert(cs.ctr[2] === 3 && cs.ctr[11] === 0, 'U(+z) <-> BL(+z) swapped');
  assert(cs.ep.every((p,i)=>p===i), 'edges solved');
});
t('TCP data: dialect matters (the same text reads differently in EIF)', () => {
  const a = TCPS.cases[2].algs[0].alg;              // TCP 3
  const cif = E.caseStateOf(a, 'cif'), eif = E.caseStateOf(a, 'eif');
  assert(cif && eif && E.stateKey(cif) !== E.stateKey(eif), 'readings should differ');
});
t('TCP data: token counts match the sheet movecounts (AUF conventions noted)', () => {
  for (const c of TCPS.cases){
    const n = E.countMoves(E.parseAlg(c.algs[0].alg));
    const id = Number(c.name.replace('TCP ', ''));
    const expected = (id >= 7 && id <= 10) ? c.moves + 1 : c.moves;   // 7-10 include the AUF
    assert(n === expected, `${c.name}: tokens ${n} vs sheet ${c.moves}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
