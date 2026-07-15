/* fto.twistytools.com — Bencisco solver tests (js/tables.js + js/solver-core.js). M5.
 *
 * The solver exit gate: coordinate codecs pinned, every pruning table
 * admissible and goal-exact (the r* families in the sealed hold group's
 * own 10-native-move metric — the token metric once re-grips are free —
 * first center on BL), the hold machinery itself (grip spells, token
 * reading incl. the re-grip-fused U composites, the sealed group, the
 * structural ban on redundant Rw/BL re-grip pairs), WHITE-FIRST
 * orientation policy (the 3 white anchors {D,L}/{D,R}/{D,B}; every solve
 * builds the white center first — cross-pinned against the trainer's
 * placement-neutral first-center goal set), the Bencisco step regions
 * re-derived against the M3 sheet data, the orientation (conjugation +
 * {X,Y} bracket spelling) machinery proven, the LBT effect-matcher and
 * L3T exact index verified, and full pipelines on fixed seeds — every
 * displayed line re-proved end-to-end by applyParsed from the original
 * scramble state, the hold steps emitting ONLY their step's ergonomic
 * tokens (triples {R,U,Rw}, centers + BL, either with rare {X,Y}
 * re-grips) under their grip spells. The wide statistical scan (>= 200
 * scrambles, 0 verify failures) lives in tools/solver-lab.mjs; this
 * suite stays deterministic and CI-sized.
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
const BL = T.makeBLHold(E);
const readAll = (st) => [
  ...Object.keys(PDB.rB).map(k => PDB.rB[k][T.encB(st.ctr)]),
  ...Object.keys(PDB.rA).map(k => PDB.rA[k][T.encA(st.ctr)]),
  ...Object.keys(PDB.rC).map(k => PDB.rC[k][T.cornerIndex(st.cp, st.co)]),
  ...Object.keys(PDB.rE6).map(k => PDB.rE6[k][T.edgePlaceIndex(st.ep, T.E6_PAIRS[k])]),
  ...Object.keys(PDB.rH1).map(k => PDB.rH1[k][T.h1Index(st.ep, st.ctr, k, T.HEX_EDGES[k])]),
];
t('every table: solved state at distance 0; no negative entries', () => {
  for (const k of Object.keys(PDB.rB)) assert(PDB.rB[k][T.encB(solved.ctr)] === 0, 'rB[' + k + ']');
  for (const k of Object.keys(PDB.rA)) assert(PDB.rA[k][T.encA(solved.ctr)] === 0, 'rA[' + k + ']');
  for (const k of Object.keys(PDB.rC)) assert(PDB.rC[k][T.cornerIndex(solved.cp, solved.co)] === 0, 'rC[' + k + ']');
  for (const k of Object.keys(PDB.E3)) assert(PDB.E3[k][T.edgePlaceIndex(solved.ep, T.HEX_EDGES[k])] === 0, 'E3[' + k + ']');
  for (const k of Object.keys(PDB.rE6)) assert(PDB.rE6[k][T.edgePlaceIndex(solved.ep, T.E6_PAIRS[k])] === 0, 'rE6[' + k + ']');
  assert(PDB.H1.D[T.h1Index(solved.ep, solved.ctr, 'D', T.HEX_EDGES.D)] === 0, 'H1.D');
  for (const k of Object.keys(PDB.rH1)) assert(PDB.rH1[k][T.h1Index(solved.ep, solved.ctr, k, T.HEX_EDGES[k])] === 0, 'rH1[' + k + ']');
  // the restricted families carry BOTH triple steps' keys and the center
  // steps' combined keys (the triples run inside the sealed group again)
  assert(Object.keys(PDB.rA).sort().join('|') === '5,6,8,9|5,8|6,9', 'rA keys');
  assert(Object.keys(PDB.rC).sort().join('|') === '3|3,5|5', 'rC keys');
  for (const fam of [PDB.rB, PDB.rA, PDB.rC, PDB.E3, PDB.rE6, PDB.H1, PDB.rH1])
    for (const k of Object.keys(fam))
      for (let i = 0; i < fam[k].length; i += 101) {
        const v = fam[k][i];
        assert(v >= 0 && (v <= 40 || v === T.UNREACHED), 'bad entry ' + v);
      }
});
t('full-metric tables (E3, H1.D) are 1-Lipschitz along native moves', () => {
  for (let trial = 0; trial < 60; trial++) {
    const s = randState(20);
    const s2 = E.move(s, (rnd() * 16) | 0);
    const reads = (st) => [
      ...Object.keys(PDB.E3).map(k => PDB.E3[k][T.edgePlaceIndex(st.ep, T.HEX_EDGES[k])]),
      PDB.H1.D[T.h1Index(st.ep, st.ctr, 'D', T.HEX_EDGES.D)],
    ];
    const a = reads(s), b = reads(s2);
    for (let i = 0; i < a.length; i++)
      assert(Math.abs(a[i] - b[i]) <= 1, 'jump > 1 at table #' + i + ' (' + a[i] + '->' + b[i] + ')');
  }
});
t('the sealed move set is the 10 moves of engine {U, L, R, D, B}', () => {
  assert(BL.SEALED_MOVES.length === 10, 'count');
  const faces = [...new Set(BL.SEALED_MOVES.map(m => m >> 1))].map(f => E.FACES[f]).sort().join(',');
  assert(faces === 'B,D,L,R,U', 'faces: ' + faces);
});
t('restricted tables are admissible along hold walks (composites cost 2)', () => {
  // solved satisfies every r* goal; the tables are min-over-grips of the
  // search's own cost metric (tokens 1, re-grip composites 2), so after a
  // walk of total cost k every table must read <= k, whatever grip the
  // walk started in
  for (let trial = 0; trial < 60; trial++) {
    let s = E.solved(), j = (rnd() * 3) | 0, k = 0;
    for (let n = 1 + ((rnd() * 8) | 0); n > 0; n--) {
      if (rnd() < 0.25) {                      // re-grip composite: cost 2
        let tg = (rnd() * 3) | 0; if (tg === j) tg = (tg + 1) % 3;
        s = E.move(s, BL.gen[tg][2 + ((rnd() * 2) | 0)].m); j = tg; k += 2;
      } else {
        const g = BL.gen[j][(rnd() * 8) | 0];
        s = E.move(s, g.m); j = g.nj; k += 1;
      }
    }
    for (const v of readAll(s)) assert(v <= k, 'inadmissible: ' + v + ' > ' + k);
  }
});
t('restricted tables are 2-Lipschitz along sealed moves; sentinels are closed', () => {
  // one sealed move changes any r* read by at most its worst-grip cost —
  // 1 for the R-BL axis faces (engine U/D: one token from every grip), 2
  // for the hold-U faces (engine L/R/B: a composite from the wrong grip) —
  // and can never cross the sentinel boundary (the reachable set is closed
  // under the group)
  const uAxis = new Set([2 * E.FIDX.U, 2 * E.FIDX.U + 1, 2 * E.FIDX.D, 2 * E.FIDX.D + 1]);
  for (let trial = 0; trial < 60; trial++) {
    const s = randState(20);
    const m = BL.SEALED_MOVES[(rnd() * 10) | 0];
    const lip = uAxis.has(m) ? 1 : 2;
    const s2 = E.move(s, m);
    const a = readAll(s), b = readAll(s2);
    for (let i = 0; i < a.length; i++) {
      if (a[i] === T.UNREACHED || b[i] === T.UNREACHED)
        assert(a[i] === b[i], 'sentinel not closed at table #' + i);
      else assert(Math.abs(a[i] - b[i]) <= lip, 'jump > ' + lip + ' at table #' + i);
    }
  }
});
t('rB.D ignores D turns; a BR turn leaves the restricted group (sentinel)', () => {
  assert(PDB.rB.D[T.encB(E.move(solved, 2 * E.FIDX.D).ctr)] === 0, 'after D');
  // BR pulls first-center triangles out of the sealed D block — the hold
  // move group can never bring them back, and the table says so
  assert(PDB.rB.D[T.encB(E.move(solved, 2 * E.FIDX.BR).ctr)] === T.UNREACHED, 'after BR');
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
t('Bencisco hold: grip spells pinned; words (re-grip composites incl.) read as tracked', () => {
  assert(C.BL.SPELLS.join('|') === '{L,R}|{R,B}|{B,L}', 'spells: ' + C.BL.SPELLS.join('|'));
  assert(C.BL.TOKS.join(' ') === "R R' U U' Rw Rw' BL BL'", 'token alphabet');
  // random words over the full alphabet, re-grip-fused U composites
  // included: tracked application must equal the engine's reading of the
  // exact rendered text (mid-word {X,Y} brackets and all)
  for (let trial = 0; trial < 40; trial++) {
    const j0 = trial % 3;
    const s0 = randState(12);
    let s = E.copy(s0), j = j0;
    const word = [];
    for (let n = 1 + ((rnd() * 7) | 0); n > 0; n--) {
      let k;
      if (rnd() < 0.25) {                      // a re-grip fused to a U turn
        let tg = (rnd() * 3) | 0; if (tg === j) tg = (tg + 1) % 3;
        k = 100 + 2 * tg + ((rnd() * 2) | 0);
        const g = C.BL.gen[tg][2 + ((k - 100) & 1)];
        s = E.move(s, g.m); j = tg;
      } else {
        k = (rnd() * 8) | 0;
        const g = C.BL.gen[j][k];
        s = E.move(s, g.m); j = g.nj;
      }
      word.push(k);
    }
    const pt = C.pathToText(j0, word);
    assert(pt.jEnd === j, 'grip walk diverged');
    const text = C.BL.SPELLS[j0] + ' ' + pt.text;
    assert(E.eq(s, E.applyParsed(E.parseAlg(text), s0)), 'reading mismatch: ' + text);
  }
});
t("a re-grip is one bracket, never a token pair: Rw BL' = {F,BR}, Rw' BL = {BR,U}", () => {
  // the user's 2026-07-14 report machine-pinned: the token pair Rw BL'
  // changes NO state (engine D then D'), only the grip — the search bans
  // every Rw<->BL adjacency (equal ranks) and spells re-grips as brackets
  assert(T.makeBLHold(E).RANK.join() === '0,0,-1,-1,1,1,1,1', 'rank table');
  for (let j = 0; j < 3; j++) {
    const probe = randState(15);
    for (const [pair, tok] of [["Rw BL'", 4], ["Rw' BL", 5]]) {
      const a = E.applyParsed(E.parseAlg(C.BL.SPELLS[j] + ' ' + pair), probe);
      assert(E.eq(a, probe), pair + ' must not change the state');
      const tgt = C.BL.gen[j][tok].nj;         // the pair's net re-grip target
      const viaPair = E.walkParsed(E.parseAlg(C.BL.SPELLS[j] + ' ' + pair), () => {});
      const viaBracket = E.walkParsed(E.parseAlg(C.BL.SPELLS[j] + ' ' + C.REGRIP[j][tgt]), () => {});
      assert(viaPair.join() === viaBracket.join(), pair + ' lands the bracket hold');
    }
  }
  // the relative bracket letters are grip-independent: {F,BR} forward,
  // {BR,U} backward (what solutions display for a mid-word re-grip)
  for (let j = 0; j < 3; j++) {
    assert(C.REGRIP[j][(j + 1) % 3] === '{F,BR}', 'forward bracket at grip ' + j);
    assert(C.REGRIP[j][(j + 2) % 3] === '{BR,U}', 'backward bracket at grip ' + j);
  }
});
t('white first, every time: the 3 anchors are exactly the U-to-D rotations', () => {
  assert(C.ORIENT_SETS.fixed().length === 1, 'one primary anchor');
  assert(C.ORIENT_SETS.vertical().length === 3 && C.ORIENT_SETS.full().length === 3, 'three spins');
  assert(C.WHITE_ORIENTS.length === 3, 'anchor count');
  const spells = C.WHITE_ORIENTS.map(i => C.ORIENTS[i].spell).sort().join('|');
  assert(spells === '{D,B}|{D,L}|{D,R}', 'anchor spells: ' + spells);
  for (const i of C.WHITE_ORIENTS)
    assert(E.faceImg(C.ORIENTS[i].M, E.FIDX.U) === E.FIDX.D, 'anchor maps white home to the D region');
});
t('the center move group seals the first center (spin-only, one BL realigns)', () => {
  const D = E.FIDX.D;
  for (let trial = 0; trial < 30; trial++) {
    // any state with the D hexagon formed, walked by random hold tokens
    let s = E.solved(), j = (rnd() * 3) | 0;
    for (let i = 0; i < 2 + ((rnd() * 12) | 0); i++) { const g = C.BL.gen[j][(rnd() * 8) | 0]; s = E.move(s, g.m); j = g.nj; }
    for (const e of C.HEX_EDGES.D) assert(s.ep[e] >= 9 && s.ep[e] <= 11, 'D edge escaped');
    for (let k = 0; k < 3; k++) assert(s.ctr[3 * D + k] === D, 'D triangle escaped');
    let ok = false;
    for (let k = 0; k < 3 && !ok; k++) { if (C.hexOK(s, 'D')) ok = true; s = E.move(s, 2 * D); }
    assert(ok, 'not realignable by D spins');
  }
});
// a hold-step word: the mode's plain tokens (triples R/U/Rw, centers + BL)
// with an optional {X,Y} re-grip bracket immediately before a U turn —
// nothing else, and never an Rw/BL adjacency in either order (the redundant
// re-grip pair the canonicalization bans)
function assertHoldWord(text, withBL) {
  const parts = text.split(' ');
  const tok = withBL ? /^(?:R|U|Rw|BL)'?$/ : /^(?:R|U|Rw)'?$/;
  let last = '';
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (/^\{(?:BR|BL|[UFRLDB]),(?:BR|BL|[UFRLDB])\}$/.test(p)) {
      assert(/^U'?$/.test(parts[i + 1] || ''), 're-grip not before a U: ' + text);
      last = '';
      continue;
    }
    assert(tok.test(p), 'hold token: ' + p + ' in ' + text);
    const a = p.replace(/'$/, ''), b = last.replace(/'$/, '');
    assert(!((a === 'Rw' && b === 'BL') || (a === 'BL' && b === 'Rw')),
      'Rw/BL adjacency: ' + text);
    last = p;
  }
}
const assertTripleWord = text => assertHoldWord(text, false);
t('triple-mode t1 searchStep solves spun-center states with R/U/Rw words', () => {
  for (let trial = 0; trial < 8; trial++) {
    let s = E.solved(), j = (rnd() * 3) | 0;
    for (let i = 0; i < 4 + ((rnd() * 8) | 0); i++) { const g = C.BL.gen[j][(rnd() * 8) | 0]; s = E.move(s, g.m); j = g.nj; }
    const stage = { id: 't1', opt: { corner: 3, aKey: '6,9', cKey: '3' } };
    const line = { st: s, hexes: ['D'] };
    C.resetWork(1e8);
    const sols = C.searchStep(s, C.stageGoal(stage, line), C.stageH(stage, line),
      C.STEP_DEFS.t1.cap, 2, 0, 1, 1e7, 'triple');
    assert(sols.length > 0, 'no t1 solution');
    for (const sol of sols) {
      if (!sol.moves.length) continue;
      const text = C.pathToText(sol.j0, sol.moves).text;
      assertTripleWord(text);
      const replay = E.applyParsed(E.parseAlg(C.BL.SPELLS[sol.j0] + ' ' + text), s);
      assert(E.eq(replay, sol.st), 'replay mismatch');
      assert(C.stageGoal(stage, line)(replay), 'goal fails');
    }
  }
});
t('the whole hold alphabet seals the first center: no triple/center word can break it', () => {
  // both step alphabets (tokens AND the re-grip composites) live inside
  // the sealed group, so mid-word the D hexagon can only spin — walk random
  // words over the full code set and check the D block never leaks
  const D = E.FIDX.D;
  for (let trial = 0; trial < 30; trial++) {
    let s = E.solved(), j = (rnd() * 3) | 0;
    for (let i = 0; i < 2 + ((rnd() * 12) | 0); i++) {
      if (rnd() < 0.25) {                      // re-grip composite
        let tg = (rnd() * 3) | 0; if (tg === j) tg = (tg + 1) % 3;
        s = E.move(s, C.BL.gen[tg][2 + ((rnd() * 2) | 0)].m); j = tg;
      } else {
        const g = C.BL.gen[j][(rnd() * 8) | 0];
        s = E.move(s, g.m); j = g.nj;
      }
    }
    for (const e of C.HEX_EDGES.D) assert(s.ep[e] >= 9 && s.ep[e] <= 11, 'D edge escaped');
    for (let k = 0; k < 3; k++) assert(s.ctr[3 * D + k] === D, 'D triangle escaped');
  }
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
const FC = T.buildFirstCenter(E);   // the trainer's placement-neutral white goal set
t('three fixed scrambles solve end to end; every emitted line is machine-proved', () => {
  const whiteSpells = new Set(C.WHITE_ORIENTS.map(i => C.ORIENTS[i].spell));
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
      // white first, every time: the line's pre-rotation is a white anchor,
      // and executing it plus the first-center segment forms the WHITE
      // hexagon in the trainer's placement-neutral goal set (cross-pin)
      assert(whiteSpells.has(it.rotSpell), 'white anchor: ' + it.rotSpell);
      const fcSeg = it.segs.find(sg => sg.id === 'fc');
      const upTo = [it.rotSpell, fcSeg ? fcSeg.text : ''].filter(Boolean).join(' ');
      const afterFc = E.applyParsed(E.parseAlg(upTo), E.copy(s));
      assert(FC.goalSet.has(FC.coordOf(afterFc)), 'white center formed after fc');
      // independent replay of the DISPLAYED line, exactly as a human reads
      // it: ONE continuous text — junction re-grips (wide-drift compensation
      // included) are printed tokens, not a hidden reset convention
      const p = E.parseAlg(C.lineText(it));
      assert(p, 'line parses: ' + C.lineText(it));
      assert(E.eq(E.applyParsed(p, E.copy(s)), solved), 'continuous replay solves');
      // segments follow the Bencisco step order
      const order = it.segs.map(sg => STEP_ORDER.indexOf(sg.id));
      for (let i = 1; i < order.length; i++) assert(order[i] > order[i - 1], 'step order');
      // totals add up: segment moves sum to the badge total
      assert(it.segs.reduce((a, sg) => a + sg.moves, 0) === it.total, 'movecount adds up');
      // t1..c4 live in the Bencisco hold: the TRIPLE steps emit {R,U,Rw}
      // words, the CENTER steps add BL, and either may carry a rare {X,Y}
      // re-grip bracket immediately before a U turn — never an Rw/BL
      // adjacency (the banned redundant pair). Every pre is a single
      // relative {X,Y} bracket (or absent when the previous segment
      // already leaves the right hold); entering the hold always re-grips;
      // fc reads plain natives in the line's own hold, never a pre
      const BRK = /^\{(?:BR|BL|[UFRLDB]),(?:BR|BL|[UFRLDB])\}$/;
      let firstHold = true;
      for (const seg of it.segs) {
        assert(seg.pre === undefined || BRK.test(seg.pre), 'pre is one bracket: ' + seg.pre);
        if (['t1', 't2'].includes(seg.id)) {
          assertHoldWord(seg.text, false);
          if (firstHold) { assert(seg.pre, 'hold entry re-grips'); firstHold = false; }
        } else if (['sc', 'c3', 'c4'].includes(seg.id)) {
          assertHoldWord(seg.text, true);
          if (firstHold) { assert(seg.pre, 'hold entry re-grips'); firstHold = false; }
        } else if (seg.id === 'fc') {
          assert(!seg.pre, 'fc carries no pre');
        }
      }
    }
  }
});
t('every white anchor produces a proven line (the conjugation sweep end to end)', () => {
  const s = E.applyParsed(E.parseAlg(SCRAMBLES[0]), E.solved());
  let proven = 0;
  for (const oi of C.ORIENT_SETS.vertical()) {
    const res = C.search(s, { orient: [oi] });
    if (res.best == null) continue;
    const it = res.byLength[res.best][0];
    assert(it.rotSpell === C.ORIENTS[oi].spell, 'anchor spell');
    const st = E.applyParsed(E.parseAlg(C.lineText(it)), E.copy(s));
    assert(E.eq(st, solved), 'anchored replay solves');
    proven++;
  }
  assert(proven >= 2, 'at least two anchors solve scramble 0: ' + proven);
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
