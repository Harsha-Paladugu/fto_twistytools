/* fto.twistytools.com — Bencisco solver tests (js/tables.js + js/solver-core.js). M5.
 *
 * The solver exit gate: coordinate codecs pinned, every pruning table
 * admissible and goal-exact, the Bencisco step regions re-derived against
 * the M3 sheet data, the orientation (conjugation + Streeter rotation
 * spelling) machinery proven, the LBT effect-matcher and L3T exact index
 * verified, and full pipelines on fixed seeds — every displayed line
 * re-proved end-to-end by applyParsed from the original scramble state.
 * The wide statistical scan (>= 200 scrambles, 0 verify failures) lives in
 * tools/solver-lab.mjs; this suite stays deterministic and CI-sized.
 *
 * Run: node tools/test-solver.mjs   (exit 0 = OK, 1 = a test failed)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = {};
require(path.join(ROOT, 'js', 'engine.js'));
require(path.join(ROOT, 'js', 'tables.js'));
require(path.join(ROOT, 'js', 'solver-core.js'));
const E = globalThis.window.OOEngine;
const T = globalThis.window.OOTables;
const { makeSolverCore, STEP_DEFS, STEP_ORDER } = globalThis.window.OOSolverCore;
const ALGDATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'fto_algs.json'), 'utf8'));

let passed = 0, failed = 0;
function t(name, fn) {
  try {
    const r = fn();
    if (r === false) throw new Error('assertion returned false');
    console.log('✓ ' + name); passed++;
  } catch (e) {
    console.log('✗ ' + name + '\n    ' + (e && e.message)); failed++;
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert'); }

// seeded RNG so every run tests the same states
let seed = 20260713;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
const randState = (n) => {
  let s = E.solved();
  for (let i = 0; i < (n || 30); i++) s = E.move(s, (rnd() * 16) | 0);
  return s;
};

console.log('building pruning tables…');
const PDB = await T.buildPDBs(E);
const solved = E.solved();

/* ---------- 1. codecs ---------- */
t('pattern codec: solved rank 0, bijective on samples, full-range round trip', () => {
  assert(T.encPattern([0,0,0,1,1,1,2,2,2,3,3,3]) === 0, 'solved pattern rank');
  for (let ix = 0; ix < T.NPAT; ix += 1237) {
    const pat = T.decPattern(ix, new Array(12));
    assert(T.encPattern(pat) === ix, 'round trip at ' + ix);
  }
});
t('corner codec: solved 0, round trip, flip parity forced', () => {
  assert(T.cornerIndex(solved.cp, solved.co) === 0, 'solved corner index');
  for (let ix = 0; ix < T.NCORNER; ix += 37) {
    const { cp, co } = T.cornerUnpack(ix);
    assert(T.cornerIndex(cp, co) === ix, 'round trip at ' + ix);
    assert(co.reduce((a, b) => a + b, 0) % 2 === 0, 'flip parity at ' + ix);
  }
});
t('edge placement codec: round trip; orbit views survive moves', () => {
  for (const f of Object.keys(T.HEX_EDGES)) {
    const ix = T.edgePlaceIndex(solved.ep, T.HEX_EDGES[f]);
    assert(T.edgePlaceUnrank(ix, 3).join() === T.HEX_EDGES[f].join(), 'home placement ' + f);
  }
  for (let i = 0; i < 40; i++) {
    const s = randState(25);
    assert(T.decPattern(T.encA(s.ctr), new Array(12)).join() === s.ctr.slice(0, 12).join(), 'encA view');
    assert(T.decPattern(T.encB(s.ctr), new Array(12)).join() === s.ctr.slice(12).map(c => c - 4).join(), 'encB view');
  }
});

/* ---------- 2. pruning tables ---------- */
t('every table: solved state at distance 0; no unreached entries', () => {
  for (const k of Object.keys(PDB.B)) assert(PDB.B[k][T.encB(solved.ctr)] === 0, 'B[' + k + ']');
  for (const k of Object.keys(PDB.A)) assert(PDB.A[k][T.encA(solved.ctr)] === 0, 'A[' + k + ']');
  for (const k of Object.keys(PDB.C)) assert(PDB.C[k][T.cornerIndex(solved.cp, solved.co)] === 0, 'C[' + k + ']');
  for (const k of Object.keys(PDB.E3)) assert(PDB.E3[k][T.edgePlaceIndex(solved.ep, T.HEX_EDGES[k])] === 0, 'E3[' + k + ']');
  for (const k of Object.keys(PDB.E6)) assert(PDB.E6[k][T.edgePlaceIndex(solved.ep, T.E6_PAIRS[k])] === 0, 'E6[' + k + ']');
  for (const k of Object.keys(PDB.H1)) assert(PDB.H1[k][T.h1Index(solved.ep, solved.ctr, k, T.HEX_EDGES[k])] === 0, 'H1[' + k + ']');
  for (const fam of [PDB.B, PDB.A, PDB.C, PDB.E3, PDB.E6, PDB.H1])
    for (const k of Object.keys(fam))
      for (let i = 0; i < fam[k].length; i += 101) assert(fam[k][i] >= 0, 'unreached entry');
});
t('every table is 1-Lipschitz along moves (BFS distance consistency)', () => {
  for (let trial = 0; trial < 60; trial++) {
    const s = randState(20);
    const m = (rnd() * 16) | 0;
    const s2 = E.move(s, m);
    const reads = (st) => [
      ...Object.keys(PDB.B).map(k => PDB.B[k][T.encB(st.ctr)]),
      ...Object.keys(PDB.A).map(k => PDB.A[k][T.encA(st.ctr)]),
      ...Object.keys(PDB.C).map(k => PDB.C[k][T.cornerIndex(st.cp, st.co)]),
      ...Object.keys(PDB.E3).map(k => PDB.E3[k][T.edgePlaceIndex(st.ep, T.HEX_EDGES[k])]),
      ...Object.keys(PDB.E6).map(k => PDB.E6[k][T.edgePlaceIndex(st.ep, T.E6_PAIRS[k])]),
      ...Object.keys(PDB.H1).map(k => PDB.H1[k][T.h1Index(st.ep, st.ctr, k, T.HEX_EDGES[k])]),
    ];
    const a = reads(s), b = reads(s2);
    for (let i = 0; i < a.length; i++)
      assert(Math.abs(a[i] - b[i]) <= 1, 'jump > 1 at table #' + i + ' (' + a[i] + '->' + b[i] + ')');
  }
});
t('B[D] ignores D turns (own triangles identical), sees BR turns', () => {
  assert(PDB.B.D[T.encB(E.move(solved, 2 * E.FIDX.D).ctr)] === 0, 'after D');
  assert(PDB.B.D[T.encB(E.move(solved, 2 * E.FIDX.BR).ctr)] === 1, 'after BR');
});

/* ---------- 3. the core: geometry + orientation machinery ---------- */
const C = makeSolverCore(E, T, PDB, ALGDATA);   // init self-checks throw on any mismatch
t('core init passes its construction asserts (regions, spelling, conjugation)', () => true);
t('hexagon edge sets partition the 12 edges across the tetrad-B faces', () => {
  const all = Object.values(C.HEX_EDGES).flat().sort((a, b) => a - b);
  assert(all.join() === '0,1,2,3,4,5,6,7,8,9,10,11', 'partition');
});
t('bottom triple slots match the sheet-pinned LBT pair {4,10}', () =>
  C.TRIPLE_SLOTS[4].join() === '4,10' && C.TRIPLE_SLOTS[3].join() === '6,9' && C.TRIPLE_SLOTS[5].join() === '5,8');
t('conjState: inverse round trip, solved invariance', () => {
  const s = randState(25);
  for (const o of C.ORIENTS.slice(0, 8)) {
    assert(E.eq(C.conjState(E.mInv(o.M), C.conjState(o.M, s)), s), 'round trip');
    assert(E.eq(C.conjState(o.M, solved), solved), 'solved invariance');
  }
});
t('all 24 orientations have distinct spells; identity spells empty', () => {
  const spells = new Set(C.ORIENTS.map(o => o.spell));
  assert(spells.size === 24, 'distinct spells');
  assert(C.ORIENTS.some(o => o.spell === ''), 'identity present');
});

/* ---------- 4. the finish index ---------- */
const fin = C.finishIndex();
t('finish index shape: LBT effect entries, L3T exact keys, TCP included', () => {
  assert(fin.lbt.length === 360, 'LBT entries (120 algs x 3 pre-AUFs): ' + fin.lbt.length);
  assert(fin.l3t.size > 1500, 'L3T keys: ' + fin.l3t.size);
  let tcp = 0;
  for (const list of fin.l3t.values()) for (const en of list) if (en.subset === 'TCP') tcp++;
  assert(tcp > 0, 'TCP entries present');
});
t('the 21 setup-undo LBT algs are indexed with their closing token appended', () => {
  const undone = new Set(fin.lbt.filter(en => /setup undo appended/.test(en.note || ''))
    .map(en => en.text.replace(/^U'? /, '')));
  assert(undone.size === 21, 'distinct closed texts: ' + undone.size);
});
t('every sampled finish entry text exactly solves its own case state', () => {
  const sample = fin.lbt.filter((_, i) => i % 7 === 0);
  for (const list of fin.l3t.values()) if (rnd() < 0.05) sample.push(list[0]);
  assert(sample.length > 60, 'sample size');
  for (const en of sample) {
    const cs = E.caseStateOf(en.text, en.dialect);
    assert(cs, 'parses: ' + en.text);
    assert(E.eq(E.applyParsed(E.parseAlg(en.text), cs, en.dialect), solved), 'solves: ' + en.text);
  }
});
t('LBT effect tables agree with applyParsed on random states', () => {
  for (let i = 0; i < 10; i++) {
    const en = fin.lbt[(rnd() * fin.lbt.length) | 0];
    const s = randState(15);
    assert(E.eq(E.applyTable(en.table, s), E.applyParsed(E.parseAlg(en.text), s, en.dialect)),
      'table/parse mismatch: ' + en.text);
  }
});

/* ---------- 5. full pipelines (the exit gate in miniature) ---------- */
const SCRAMBLES = [
  "R U' B L' U R' B' D BR' L F' D' BL R' F U' B' R D' BL' U F' L' BR D R' U' L B' F",
  "U L D' B R' F BL' U' BR D L' R' B U' F' BL R D' U' B' L F R' BR' D U B L' F' D",
  "BL' F R' U' D B L BR' F' U R D' B' L' U' F BL R' B D U' L' F' R BR B' U' D L F'",
];
t('three fixed scrambles solve end to end; every emitted line is machine-proved', () => {
  for (const scrText of SCRAMBLES) {
    const parsed = E.parseAlg(scrText);
    assert(parsed, 'scramble parses');
    const s = E.applyParsed(parsed, E.solved());
    const res = C.search(s, {});
    assert(res.best != null, 'solved: ' + scrText.slice(0, 20) + '…');
    assert(res.verifyFailures === 0, 'no dropped lines');
    assert(res.best < 90, 'sane total: ' + res.best);
    for (const it of res.byLength[res.best]) {
      assert(it.ok, 'ok flag');
      // independent replay of the DISPLAYED line, exactly as a human reads it
      let st = E.copy(s);
      for (const seg of it.segs) {
        const p = E.parseAlg(((it.rotSpell ? it.rotSpell + ' ' : '') + seg.text).trim());
        assert(p, 'segment parses: ' + seg.text);
        st = E.applyParsed(p, st, seg.dialect || 'cif');
      }
      assert(E.eq(st, solved), 'independent replay solves');
      // segments follow the Bencisco step order
      const order = it.segs.map(sg => STEP_ORDER.indexOf(sg.id));
      for (let i = 1; i < order.length; i++) assert(order[i] > order[i - 1], 'step order');
      // totals add up: segment moves sum to the badge total
      assert(it.segs.reduce((a, sg) => a + sg.moves, 0) === it.total, 'movecount adds up');
    }
  }
});
t('a rotated orientation produces a proven line (the conjugation sweep end to end)', () => {
  const s = E.applyParsed(E.parseAlg(SCRAMBLES[0]), E.solved());
  const vert = C.ORIENT_SETS.vertical().filter(i => C.ORIENTS[i].spell !== '');
  let provenRotated = false;
  for (const oi of vert) {
    const res = C.search(s, { orient: [oi] });
    if (res.best == null) continue;
    const it = res.byLength[res.best][0];
    assert(it.rotSpell !== '', 'rotated spell');
    let st = E.copy(s);
    for (const seg of it.segs)
      st = E.applyParsed(E.parseAlg((it.rotSpell + ' ' + seg.text).trim()), st, seg.dialect || 'cif');
    assert(E.eq(st, solved), 'rotated replay solves');
    provenRotated = true;
    break;
  }
  assert(provenRotated, 'no rotated orientation solved scramble 0 — investigate');
});
t('verifyLine rejects tampered lines', () => {
  const s = E.applyParsed(E.parseAlg(SCRAMBLES[0]), E.solved());
  const res = C.search(s, {});
  const it = res.byLength[res.best][0];
  const bad = { ...it, segs: it.segs.map((sg, i) => i === 0 ? { ...sg, text: sg.text + ' U' } : sg) };
  assert(C.verifyLine(s, bad) === false, 'tampered line must fail');
  assert(C.verifyLine(s, it) === true, 'original line must pass');
});
t('an already-solved input needs no line; a one-move scramble solves short', () => {
  const res0 = C.search(E.solved(), {});
  assert(res0.best === null || res0.best === 0, 'solved input');
  const res1 = C.search(E.move(E.solved(), 2 * E.FIDX.U), {});
  assert(res1.best != null && res1.best <= 4, 'one-move scramble: ' + res1.best);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
