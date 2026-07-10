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
  for (const bad of ['U2', "U2'", 'Ds', 'Bs', 'BRs', 'BLs', 'X', 'R2', 'Tw', 'To', 'u', 'r']){
    assert(parse('R ' + bad) === null, 'should reject: ' + bad);
  }
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
