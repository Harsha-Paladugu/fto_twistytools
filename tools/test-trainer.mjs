/* fto.twistytools.com — trainer substrate tests (src/trainer/fto-core.mjs). M4+.
 *
 * Asserts the trainer's math against the shared FTO engine: the case model
 * over data/fto_algs.json (counts, groups, dialect plumbing), the native-move
 * flattening (walkParsed-exact, brackets/rotations/wides included), the
 * merge/cancel pass, and the setup scrambles — every drill machine-verified:
 * the scramble reproduces the shown state from solved, and undoing the AUF
 * then running the case's alg (in its authored hold dialect) solves it.
 *
 * Plus the FIRST CENTER step trainer (the first Bencisco step mode): the
 * white-hexagon goal set (12 formations, 3 per tetrad-A face), the exact BFS
 * distance tables over the 290,400-state coordinate, God's number pinned in
 * both metrics (7 face turns; 6 with slice turns at unit cost), the mirror
 * false-solve fact (visually complete, unsolvable, at exactly God's number),
 * and every drill + displayed solution re-proved on full states. Derivation
 * 2026-07-13, adversarially reviewed; docs/fto-ground-truth.md §Methods.
 *
 * Plus the FIRST TWO TRIPLES step trainer (2026-07-15): the sealed
 * turn-metric marginal tables (eccentricities pinned), the white anchor /
 * physical sealed alphabet / entry brackets, per-mode drills (short
 * white-center-sealing scrambles, mode conditions, the 26-facelet mask),
 * exact optimals cross-checked by a heuristic-free brute force, and every
 * displayed solver-style line re-proved end-to-end from the drill state.
 *
 * Plus the SECOND/THIRD CENTERS step trainer (2026-07-15): the sealed
 * turn-metric hexagon tables (eccentricities + sealed-reachable cell counts
 * pinned; the sealed group's invariants shrink every coordinate), the
 * index-carrying DFS against full-state predicates, per-mode drills
 * (triples pre-solved by appended machine-optimal words, mode conditions,
 * the 53-facelet mask), exact optimals cross-checked by a heuristic-free
 * brute force, and every displayed {R,U,Rw,BL} line re-proved end-to-end.
 *
 * Run: node tools/test-trainer.mjs   (exit 0 = OK, 1 = a test failed)
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
const E = globalThis.window.OOEngine;
const T = globalThis.window.OOTables;

const { createCore, SEP, AUF, AUF_UNDO } = await import('../src/trainer/fto-core.mjs');
const core = createCore(E);

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
const FACE_TOK = /^(U|F|R|L|D|B|BR|BL)'?$/;
const U_CW = 2 * E.FIDX.U, U_CCW = U_CW + 1;
const applyAlg = (alg, st, dialect) => E.applyParsed(E.parseAlg(alg), st, dialect);
const foldNatives = (mis, st) => mis.reduce((s, m) => E.move(s, m), st);

// ---------------- case model ----------------
const JSON_DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'fto_algs.json'), 'utf8'));
const model = core.buildModel(JSON_DATA);
const ALL_CASES = model.subsets.flatMap((s) => s.cases);

t('model: TCP present; empty subsets skipped; counts match the JSON', () => {
  const jsonSubsets = Object.entries(JSON_DATA.subsets).filter(([, s]) => s.cases && s.cases.length);
  if (model.subsets.length !== jsonSubsets.length) return false;
  const jsonCases = jsonSubsets.reduce((a, [, s]) => a + s.cases.length, 0);
  const jsonAlgs = jsonSubsets.reduce((a, [, s]) => a + s.cases.reduce((b, c) => b + c.algs.length, 0), 0);
  const cases = ALL_CASES.length;
  const algs = ALL_CASES.reduce((a, c) => a + c.algs.length, 0);
  return model.subsets.some((s) => s.key === 'TCP') && cases === jsonCases && algs === jsonAlgs && cases > 0;
});
t('model: uid = subset␟name; dialect cif; AUF on for last-layer sets, off for LBT', () =>
  ALL_CASES.every((c) => c.uid === c.subset + SEP + c.name && c.dialect === 'cif' &&
    c.auf === (c.subset !== 'LBT')));
t('model: authored groups partition every subset, no strays', () =>
  model.subsets.every((s) =>
    s.groups.reduce((a, g) => a + g.cases.length, 0) === s.cases.length &&
    !s.groups.some((g) => g.label === 'Other')));
t('model: TCP groups are Even/Odd/2-Flip at 6 cases each', () => {
  const tcp = model.subsets.find((s) => s.key === 'TCP');
  return tcp.groups.map((g) => g.value).join(',') === 'Even,Odd,2-Flip' &&
    tcp.groups.every((g) => g.cases.length === 6);
});
t('model: empty-subset shells are skipped', () =>
  core.buildModel({ subsets: { X: { cases: [] }, Y: {} } }).subsets.length === 0);

// ---------------- native-move flattening ----------------
t('caseSpec: every case usable; every authored alg parses to natives + a state', () =>
  ALL_CASES.every((c) => {
    const spec = core.caseSpec(c);
    return spec.ok && spec.rows.length === c.algs.length &&
      spec.rows.every((r) => r.natives && r.natives.every((m) => Number.isInteger(m) && m >= 0 && m < 16) && r.state);
  }));
t('caseSpec: memoized (same object on the second call)', () =>
  core.caseSpec(ALL_CASES[0]) === core.caseSpec(ALL_CASES[0]));
t('nativeMovesOf ≡ the alg\'s state effect (brackets/rotations flatten exactly)', () =>
  ALL_CASES.every((c) => core.caseSpec(c).rows.every((r) =>
    E.eq(foldNatives(r.natives, E.solved()), applyAlg(r.a.alg, E.solved(), r.dialect)))));
t('nativeMovesOf: null on unparseable text, impossible bracket, or move-free alg', () =>
  core.nativeMovesOf('Q7 zz', 'cif') === null &&
  core.nativeMovesOf('{U,D} R', 'cif') === null &&      // opposite faces: impossible hold
  core.nativeMovesOf("Uo T'", 'cif') === null);          // rotations only, no moves
t('anchor alg sits at AUF offset 0 of its own case', () =>
  ALL_CASES.every((c) => core.caseSpec(c).anchor.k === 0));

// ---------------- mergeMoves ----------------
t('mergeMoves: X X → X\'; X X\' → (nothing); X X X → (nothing)', () => {
  const U = U_CW, Up = U_CCW;
  return core.mergeMoves([U, U]).join() === String(Up) &&
    core.mergeMoves([U, Up]).length === 0 &&
    core.mergeMoves([U, U, U]).length === 0;
});
t('mergeMoves: cancellation exposes the previous face (R U U\' R → R\')', () => {
  const Rm = 2 * E.FIDX.R;
  return core.mergeMoves([Rm, U_CW, U_CCW, Rm]).join() === String(Rm + 1);
});
t('mergeMoves: effect-preserving and same-face-free on 200 random runs', () => {
  for (let i = 0; i < 200; i++) {
    const seq = [];
    for (let j = 0; j < 20; j++) {
      const m = Math.floor(Math.random() * 16);
      seq.push(m);
      if (Math.random() < 0.4) seq.push(Math.random() < 0.5 ? m : m ^ 1); // engineered same-face runs
    }
    const merged = core.mergeMoves(seq);
    if (!E.eq(foldNatives(seq, E.solved()), foldNatives(merged, E.solved()))) return false;
    for (let j = 1; j < merged.length; j++) if ((merged[j] >> 1) === (merged[j - 1] >> 1)) return false;
  }
  return true;
});

// ---------------- setup scrambles ----------------
const RNGS = [() => 0, () => 0.34, () => 0.67]; // force auf = 0 / 1 / 2

t('makeDrill: every case × every AUF — scramble is plain face letters only', () =>
  ALL_CASES.every((c) => RNGS.every((rng) => {
    const d = core.makeDrill(c, rng);
    return d && d.scramble.split(/\s+/).every((tok) => FACE_TOK.test(tok));
  })));
t('makeDrill: the scramble reproduces the shown state from solved (all cases × AUFs)', () =>
  ALL_CASES.every((c) => RNGS.every((rng) => {
    const d = core.makeDrill(c, rng);
    return E.eq(applyAlg(d.scramble, E.solved()), d.state);
  })));
t('makeDrill: undo the AUF, run the alg in its dialect — solved (all cases × AUFs)', () =>
  ALL_CASES.every((c) => RNGS.every((rng, k) => {
    const d = core.makeDrill(c, rng);
    if (d.auf !== (c.auf === false ? 0 : k)) return false;
    let st = d.state;
    if (d.auf) st = E.move(st, d.auf === 1 ? U_CCW : U_CW);
    const spec = core.caseSpec(c);
    return E.eq(applyAlg(spec.anchor.a.alg, st, spec.anchor.dialect), E.solved());
  })));
t('verifyDrill agrees (and rejects a tampered state)', () =>
  ALL_CASES.every((c) => RNGS.every((rng) => {
    const d = core.makeDrill(c, rng);
    if (!core.verifyDrill(d)) return false;
    const bad = { ...d, state: E.move(d.state, 2 * E.FIDX.R) };
    return !core.verifyDrill(bad);
  })));
t('makeDrill: scramble stays merged (no adjacent same-face tokens) and short', () =>
  ALL_CASES.every((c) => RNGS.every((rng) => {
    const d = core.makeDrill(c, rng);
    const toks = d.scramble.split(/\s+/).filter(Boolean);
    for (let i = 1; i < toks.length; i++) {
      if (toks[i].replace("'", '') === toks[i - 1].replace("'", '')) return false;
    }
    return toks.length >= 1 && toks.length <= core.caseSpec(c).anchor.natives.length + 1;
  })));
t('makeDrill: AUF distribution — all three offsets appear over 100 draws (AUF-on cases)', () => {
  const aufCases = ALL_CASES.filter((c) => c.auf);
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(core.makeDrill(aufCases[i % aufCases.length]).auf);
  return seen.size === 3;
});
t('LBT subset (real data): 95 cases, auf:false throughout, drills pinned to AUF 0', () => {
  const lbt = model.subsets.find((s) => s.key === 'LBT');
  if (!lbt || lbt.cases.length !== 95 || !lbt.cases.every((c) => c.auf === false)) return false;
  return lbt.cases.every((c) => RNGS.every((rng) => {
    const d = core.makeDrill(c, rng);
    return d && d.auf === 0 && d.aufUndo === '' && core.verifyDrill(d);
  }));
});
t('rowAufToken: anchor row chip = the drill\'s AUF undo', () =>
  ALL_CASES.every((c) => RNGS.every((rng) => {
    const d = core.makeDrill(c, rng);
    return core.rowAufToken(core.caseSpec(c).anchor, d) === AUF_UNDO[d.auf];
  })));

// ---------------- multi-alg AUF offsets (synthetic) ----------------
t('caseSpec: a U\'-prefixed variant lands on an AUF offset; its chip solves the drill', () => {
  const base = 'TCP 1';
  const src = JSON_DATA.subsets.TCP.cases.find((c) => c.name === base).algs[0].alg; // B' R B R'
  const m2 = core.buildModel({ subsets: { 'SYN-AUF': { notation: 'cif', cases: [
    { name: 'S1', algs: [{ alg: src }, { alg: "U' " + src }] },
  ] } } });
  const c = m2.subsets[0].cases[0];
  const spec = core.caseSpec(c);
  const row = spec.rows[1];
  if (row.k < 1) return false;                       // authored one AUF off the anchor
  for (const rng of RNGS) {
    const d = core.makeDrill(c, rng);
    const tok = core.rowAufToken(row, d);            // "do this U turn, then the alg"
    if (tok === null) return false;
    let st = d.state;
    if (tok === 'U') st = E.move(st, U_CW);
    else if (tok === "U'") st = E.move(st, U_CCW);
    if (!E.eq(applyAlg(row.a.alg, st, row.dialect), E.solved())) return false;
  }
  return true;
});
t('makeDrill: subset auf:false pins the AUF to 0', () => {
  const src = JSON_DATA.subsets.TCP.cases[0].algs[0].alg;
  const m2 = core.buildModel({ subsets: { 'SYN-NOAUF': { auf: false, cases: [{ name: 'S1', algs: [{ alg: src }] }] } } });
  const c = m2.subsets[0].cases[0];
  return RNGS.every((rng) => core.makeDrill(c, rng).auf === 0 && core.verifyDrill(core.makeDrill(c, rng)));
});

// ---------------- dialect plumbing (synthetic EIF) ----------------
t('EIF dialect: letters resolve through the EIF hold (differs from CIF), drills verify', () => {
  const text = "R B' R' B";
  const cif = core.nativeMovesOf(text, 'cif');
  const eif = core.nativeMovesOf(text, 'eif');
  if (!cif || !eif || cif.join() === eif.join()) return false;   // a dropped dialect would collapse these
  if (!E.eq(foldNatives(eif, E.solved()), applyAlg(text, E.solved(), 'eif'))) return false;
  const m2 = core.buildModel({ subsets: { 'SYN-EIF': { notation: 'eif', cases: [{ name: 'S1', algs: [{ alg: text }] }] } } });
  const c = m2.subsets[0].cases[0];
  return c.dialect === 'eif' && RNGS.every((rng) => core.verifyDrill(core.makeDrill(c, rng)));
});
t('per-alg notation overrides the subset dialect', () => {
  const text = "R B' R' B";
  const m2 = core.buildModel({ subsets: { 'SYN-OVR': { notation: 'eif', cases: [{ name: 'S1', algs: [{ alg: text, notation: 'cif' }] }] } } });
  const spec = core.caseSpec(m2.subsets[0].cases[0]);
  return spec.ok && spec.anchor.dialect === 'cif' &&
    spec.anchor.natives.join() === core.nativeMovesOf(text, 'cif').join();
});

// ---------------- broken data degrades cleanly ----------------
t('unusable algs: broken text is skipped for anchor; all-broken case yields no drill', () => {
  const src = JSON_DATA.subsets.TCP.cases[0].algs[0].alg;
  const m2 = core.buildModel({ subsets: { 'SYN-BROKEN': { cases: [
    { name: 'S1', algs: [{ alg: 'Q7 zz' }, { alg: src }] },
    { name: 'S2', algs: [{ alg: '{U,D} R' }] },
  ] } } });
  const [s1, s2] = m2.subsets[0].cases;
  const sp1 = core.caseSpec(s1);
  return sp1.ok && sp1.anchor === sp1.rows[1] && core.makeDrill(s1) !== null &&
    !core.caseSpec(s2).ok && core.makeDrill(s2) === null;
});

// ---------------- exports ----------------
t('exports: AUF/AUF_UNDO are inverse token pairs', () =>
  AUF.length === 3 && AUF_UNDO.length === 3 && AUF[0] === '' && AUF_UNDO[0] === '' &&
  AUF[1] === 'U' && AUF_UNDO[1] === "U'" && AUF[2] === "U'" && AUF_UNDO[2] === 'U');

// ================ first-center step trainer ================
const FC = T.buildFirstCenter(E);
const FC_HIST16 = [12, 72, 648, 5868, 39780, 139368, 102900, 1752];
const FC_HIST24 = [12, 72, 936, 11412, 82548, 172248, 23172];

// synthetic full state realizing a coordinate (predicates read ep/ctr only;
// the fill for the untracked pieces is arbitrary)
function fcStateWithCoord(c) {
  const st = E.solved();
  const pos = T.edgePlaceUnrank((c / T.NMASK) | 0, 3);
  const ep = new Array(12).fill(-1);
  pos.forEach((s, i) => { ep[s] = FC.U_EDGES[i]; });
  const rest = [...Array(12).keys()].filter((q) => !FC.U_EDGES.includes(q));
  let ri = 0;
  for (let s = 0; s < 12; s++) if (ep[s] < 0) ep[s] = rest[ri++];
  st.ep = ep;
  const mk = c % T.NMASK;
  let mpos = null;
  outer: for (let a = 0; a < 12; a++) for (let b = a + 1; b < 12; b++) for (let d = b + 1; d < 12; d++)
    if (T.maskIndex(a, b, d) === mk) { mpos = [a, b, d]; break outer; }
  const fill = [1, 1, 1, 2, 2, 2, 3, 3, 3];
  let fi = 0;
  for (let i = 0; i < 12; i++) st.ctr[i] = mpos.includes(i) ? 0 : fill[fi++];
  return st;
}

t('FC: coordinate space 290,400; 12 goals, 3 per tetrad-A face; 12 disjoint mirrors', () => {
  if (FC.N !== 290400 || FC.goals.length !== 12 || FC.mirrors.length !== 12) return false;
  if (FC.mirrors.some((c) => FC.goalSet.has(c))) return false;
  const perFace = [0, 1, 2, 3].map((X) => FC.goals.filter((c) => FC.landingFace(c) === X).length);
  return perFace.every((n) => n === 3);
});
t("FC: God's number pinned — 7 face turns, 6 with slice turns at unit cost", () =>
  FC.gn16 === 7 && FC.gn24 === 6);
t('FC: exact depth histograms pinned (both metrics; all coordinates reached)', () =>
  FC.hist16.join() === FC_HIST16.join() && FC.hist24.join() === FC_HIST24.join() &&
  FC_HIST16.reduce((a, b) => a + b, 0) === 290400 && FC_HIST24.reduce((a, b) => a + b, 0) === 290400);
t("FC: the 12 mirror false-solves sit at exactly God's number in both metrics", () =>
  FC.mirrors.every((c) => FC.dist16[c] === FC.gn16 && FC.dist24[c] === FC.gn24));
t('FC: mirror formations look complete at facelet level (the trap is real)', () =>
  FC.mirrors.every((c) => {
    const st = fcStateWithCoord(c);
    if (FC.coordOf(st) !== c) return false;
    const X = FC.landingFace(c);
    const fl = E.toFacelets(st);
    return [1, 2, 3, 5, 6, 7].every((p) => fl[9 * X + p] === 0);   // centre + edge stickers all white
  }));
t('fcStateOK: accepts all 12 goal formations, rejects all 12 mirrors', () =>
  FC.goals.every((c) => core.fcStateOK(FC, fcStateWithCoord(c))) &&
  FC.mirrors.every((c) => !core.fcStateOK(FC, fcStateWithCoord(c))));
t('FC: coordOf tracks the engine through 50 random scrambles; dist 0 ⇔ fcStateOK', () => {
  for (let i = 0; i < 50; i++) {
    let st = E.solved();
    let c = FC.coordOf(st);
    const scr = E.randomScramble(30, Math.random);
    E.walkParsed(E.parseAlg(scr), (m) => { st = E.move(st, m); c = FC.stepNative(c, m); });
    if (FC.coordOf(st) !== c) return false;
    if ((FC.dist24[c] === 0) !== core.fcStateOK(FC, st)) return false;
    if ((FC.dist16[c] === 0) !== (FC.dist24[c] === 0)) return false;
  }
  return true;
});
t('FC: all 24 generators match the engine on a random state (parse → same coordinate)', () => {
  const st = E.applyParsed(E.parseAlg(E.randomScramble(25, Math.random)), E.solved());
  const c = FC.coordOf(st);
  return FC.GENS.every((g, gi) =>
    FC.stepGen(c, gi) === FC.coordOf(E.applyParsed(E.parseAlg(g.tok), st)));
});
t('makeFcDrill: any target — 30 plain face letters, machine-verified, optimal in 1..gn', () => {
  for (const metric of ['token', 'native']) {
    for (let i = 0; i < 5; i++) {
      const d = core.makeFcDrill(FC, { metric, target: 0 });
      if (!d || !core.verifyFcDrill(FC, d)) return false;
      const toks = d.scramble.split(/\s+/);
      if (toks.length !== 30 || !toks.every((x) => FACE_TOK.test(x))) return false;
      const gn = metric === 'native' ? FC.gn16 : FC.gn24;
      if (d.optimal < 1 || d.optimal > gn) return false;
    }
  }
  return true;
});
t('makeFcDrill: exact-N hits every level 1..gn in both metrics', () => {
  for (const metric of ['token', 'native']) {
    const gn = metric === 'native' ? FC.gn16 : FC.gn24;
    for (let n = 1; n <= gn; n++) {
      const d = core.makeFcDrill(FC, { metric, target: n });
      if (!d || d.optimal !== n || !core.verifyFcDrill(FC, d)) return false;
    }
  }
  return true;
});
t('fcSolutions: every displayed line re-proved on the full state, token count = optimal,\n  landing face correct through the walked hold, none dropped', () => {
  for (const metric of ['token', 'native']) {
    for (let i = 0; i < 8; i++) {
      const d = core.makeFcDrill(FC, { metric, target: 0 });
      const res = core.fcSolutions(FC, d, 10);
      if (!res.lines.length || res.dropped !== 0 || res.total < res.lines.length) return false;
      for (const l of res.lines) {
        const parsed = E.parseAlg(l.text);
        if (E.countMoves(parsed) !== d.optimal) return false;
        if (metric === 'native' && /s/.test(l.text)) return false;   // no slices in the pure metric
        const st2 = E.applyParsed(parsed, d.state);
        if (!core.fcStateOK(FC, st2)) return false;
        let X = -1;
        for (let f = 0; f < 4; f++) if (st2.ctr[3 * f] === 0 && st2.ctr[3 * f + 1] === 0 && st2.ctr[3 * f + 2] === 0) X = f;
        const hold = E.walkParsed(parsed, () => {});
        if (hold[E.FIDX[l.landing]] !== X) return false;
      }
    }
  }
  return true;
});
t('makeFcDrill: a stuck injected rng exhausts the attempt cap and returns null (no hang)', () =>
  core.makeFcDrill(FC, { metric: 'token', target: 3 }, () => 0) === null);
t('verifyFcDrill: rejects a tampered state, scramble, coordinate, or optimal', () => {
  const d = core.makeFcDrill(FC, { metric: 'token', target: 0 });
  if (!core.verifyFcDrill(FC, d)) return false;
  return !core.verifyFcDrill(FC, { ...d, state: E.move(d.state, 0) }) &&
    !core.verifyFcDrill(FC, { ...d, scramble: d.scramble + ' R' }) &&
    !core.verifyFcDrill(FC, { ...d, coord: (d.coord + 1) % FC.N }) &&
    !core.verifyFcDrill(FC, { ...d, optimal: d.optimal + 1 });
});

// ================ first-two-triples step trainer ================
const FT = await T.buildF2T(E);
const F2T_ENV = core.f2tEnv(FT);
const F2T_TOK = /^(U|F|BR|BL|D)'?$/;
const lcg = (seed) => { let x = seed; return () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x80000000; }; };
const f2tWhiteHomePhys = (s) =>
  E.EDGES.every((q, i) => q[2] !== E.FIDX.U || s.ep[i] === i) &&
  s.ctr[0] === 0 && s.ctr[1] === 0 && s.ctr[2] === 0;
// heuristic-free exhaustive proof that no sealed word shorter than L solves `goal`
function f2tNoShorter(s0, goal, L) {
  if (core.f2tGoalOK(s0, goal)) return false;
  let found = false;
  const rec = (s, g, lastFace) => {
    if (found || g >= L - 1) return;
    for (const m of FT.BL.SEALED_MOVES) {
      const f = m >> 1;
      if (f === lastFace || (E.OPPF[f] === lastFace && f > lastFace)) continue;
      const s2 = E.move(s, m);
      if (core.f2tGoalOK(s2, goal)) { found = true; return; }
      rec(s2, g + 1, f);
      if (found) return;
    }
  };
  if (L > 1) rec(s0, 0, -1);
  return !found;
}

t('F2T tables: full sealed reachability, turn-metric eccentricities pinned', () => {
  const ecc = {};
  for (const fam of ['dA', 'dC']) for (const k of Object.keys(FT[fam])) {
    let max = 0;
    for (const v of FT[fam][k]) { if (v === T.UNREACHED) return false; if (v > max) max = v; }
    ecc[fam + '.' + k] = max;
  }
  return ecc['dA.6,9'] === 4 && ecc['dA.5,8'] === 4 && ecc['dA.5,6,8,9'] === 6 &&
    ecc['dC.3'] === 3 && ecc['dC.5'] === 3 && ecc['dC.3,5'] === 4;
});
t('F2T tables: 1-Lipschitz along sealed moves; dist 0 ⇔ the goal slots read solved', () => {
  const rnd = lcg(20260715);
  let s = E.solved();
  for (let i = 0; i < 400; i++) {
    const m = FT.BL.SEALED_MOVES[(rnd() * 10) | 0];
    const s2 = E.move(s, m);
    for (const [k, want] of [['6,9', [[6, 2], [9, 3]]], ['5,8', [[5, 1], [8, 2]]], ['5,6,8,9', [[5, 1], [6, 2], [8, 2], [9, 3]]]]) {
      const a = FT.dA[k][FT.encA(s.ctr)], b = FT.dA[k][FT.encA(s2.ctr)];
      if (Math.abs(a - b) > 1) return false;
      if ((b === 0) !== want.every(([x, c]) => s2.ctr[x] === c)) return false;
    }
    for (const [k, slots] of [['3', [3]], ['5', [5]], ['3,5', [3, 5]]]) {
      const a = FT.dC[k][FT.cornerIndex(s.cp, s.co)], b = FT.dC[k][FT.cornerIndex(s2.cp, s2.co)];
      if (Math.abs(a - b) > 1) return false;
      if ((b === 0) !== slots.every((v) => s2.cp[v] === v && s2.co[v] === 0)) return false;
    }
    s = s2;
  }
  return true;
});
t('F2T env: anchor {D,L}; physical sealed alphabet = {U,F,BR,BL,D}±; entry brackets walk-proved', () => {
  if (F2T_ENV.anchorSpell !== '{D,L}') return false;
  const faces = [...new Set(F2T_ENV.PHYS.map((m) => m >> 1))].sort((a, b) => a - b);
  if (faces.join() !== [E.FIDX.U, E.FIDX.F, E.FIDX.BR, E.FIDX.BL, E.FIDX.D].sort((a, b) => a - b).join()) return false;
  if (F2T_ENV.ENTRY.join(' ') !== '{F,BL} {BL,BR} {BR,F}') return false;
  // each entry bracket lands exactly the anchor∘grip hold it claims
  return F2T_ENV.ENTRY.every((spell, j) =>
    E.walkParsed(E.parseAlg(spell), () => {}).join() ===
    E.walkParsed(E.parseAlg(F2T_ENV.anchorSpell + ' ' + FT.BL.SPELLS[j]), () => {}).join());
});
t('makeF2tDrill: per mode — plain sealed letters, no same-face runs, state re-proved,\n  white center exactly home, mode conditions, verifyF2tDrill agrees', () => {
  for (const mode of ['first', 'second', 'both']) {
    for (let i = 0; i < 6; i++) {
      const d = core.makeF2tDrill(FT, { mode }, lcg(1000 * i + mode.length));
      if (!d || d.mode !== mode) return false;
      const toks = d.scramble.split(/\s+/).filter(Boolean);
      if (!toks.every((x) => F2T_TOK.test(x))) return false;
      if (mode !== 'second' && toks.length !== 16) return false;
      if (toks.length > 28) return false;
      for (let j = 1; j < toks.length; j++)
        if (toks[j].replace("'", '') === toks[j - 1].replace("'", '')) return false;
      const st = E.applyParsed(E.parseAlg(d.scramble), E.solved());
      if (!E.eq(st, d.state) || !f2tWhiteHomePhys(st)) return false;
      const sM = d.stateM;
      if (mode === 'second') {
        if (![3, 5].includes(d.presolved)) return false;
        if (!core.f2tTripleOK(sM, d.presolved) || core.f2tTripleOK(sM, d.presolved === 3 ? 5 : 3)) return false;
      } else if (d.presolved !== 0 || core.f2tTripleOK(sM, 3) || core.f2tTripleOK(sM, 5)) return false;
      if (d.optimal < 1 || !core.verifyF2tDrill(FT, d)) return false;
    }
  }
  return true;
});
t('makeF2tDrill: mask keeps exactly 26 facelets — the home white hexagon, both triple\n  corners, and the 9 candidate triangles; everything else neutral', () => {
  for (const mode of ['first', 'second', 'both']) {
    const d = core.makeF2tDrill(FT, { mode }, lcg(77 + mode.length));
    if (!d || d.mask.length !== 72 - 26) return false;
    const keep = new Set();
    for (let i = 0; i < 72; i++) keep.add(i);
    for (const i of d.mask) keep.delete(i);
    if (keep.size !== 26) return false;
    // the white hexagon home facelets are all kept
    for (let i = 0; i < 72; i++) {
      const ft = E.FEAT[i];
      const isWhiteHex = (ft.t === 'x' && ft.f === E.FIDX.U) ||
        (ft.t === 'e' && E.EDGES.some((q, e) => q[2] === E.FIDX.U && q[0] === ft.v && q[1] === ft.v2 && ft.f !== undefined &&
          (ft.f === q[2] || ft.f === q[3])));
      if (isWhiteHex && !keep.has(i)) return false;
    }
    // kept feature census: 3 white-hex centres + 9 triangles = 12 'x', 6 edge stickers, 8 corner stickers
    let x = 0, e = 0, c = 0;
    for (const i of keep) { const ft = E.FEAT[i]; if (ft.t === 'x') x++; else if (ft.t === 'e') e++; else c++; }
    if (x !== 12 || e !== 6 || c !== 8) return false;
  }
  return true;
});
t('F2T optimal is exact: a heuristic-free brute force finds nothing shorter (per mode)', () => {
  for (const mode of ['first', 'second', 'both']) {
    let checked = 0;
    for (let i = 0; i < 40 && checked < 3; i++) {
      const d = core.makeF2tDrill(FT, { mode }, lcg(9000 + 31 * i + mode.length));
      if (!d || d.optimal > 5) continue;               // keep the brute force tractable
      if (!f2tNoShorter(d.stateM, d.goal, d.optimal)) return false;
      checked++;
    }
    if (checked < 3) return false;
  }
  return true;
});
t('f2tSolutions: every line proved end-to-end — entry bracket + tokens from the drill\n  state reach the goal with the white center home; turn count = optimal; none dropped', () => {
  for (const mode of ['first', 'second', 'both']) {
    for (let i = 0; i < 4; i++) {
      const d = core.makeF2tDrill(FT, { mode }, lcg(400 + 13 * i + mode.length));
      if (!d) return false;
      const res = core.f2tSolutions(FT, d, 10);
      if (!res.lines.length || res.dropped !== 0) return false;
      if (!res.capped && res.total < res.lines.length) return false;
      for (const l of res.lines) {
        const toks = l.text.split(/\s+/).filter(Boolean);
        if (!/^\{[A-Z]+,[A-Z]+\}$/.test(toks[0])) return false;          // entry bracket first
        if (!toks.slice(1).every((x) => /^\{[A-Z]+,[A-Z]+\}$/.test(x) || /^(R|U|Rw)'?$/.test(x))) return false;
        const parsed = E.parseAlg(l.text);
        if (E.countMoves(parsed) !== d.optimal) return false;
        const st2 = E.applyParsed(parsed, d.state);
        if (!f2tWhiteHomePhys(st2)) return false;                        // physical-frame re-proof
        const sM2 = core.f2tEnv(FT) && (() => {                          // method-frame goal re-proof
          const F = E.toFacelets(st2), P = E.rotFaceletPerm(F2T_ENV.M), F2 = new Array(72);
          for (let k = 0; k < 72; k++) F2[k] = E.faceImg(F2T_ENV.M, F[P[k]]);
          return E.fromFacelets(F2);
        })();
        if (mode === 'first') {
          if (!core.f2tTripleOK(sM2, 3) && !core.f2tTripleOK(sM2, 5)) return false;
          if (!['back', 'right', 'both'].includes(l.corner)) return false;
        } else {
          if (!core.f2tTripleOK(sM2, 3) || !core.f2tTripleOK(sM2, 5)) return false;
          if (l.corner !== null) return false;
        }
      }
    }
  }
  return true;
});
t('makeF2tDrill: a stuck injected rng exhausts the attempt cap and returns null (no hang)', () =>
  core.makeF2tDrill(FT, { mode: 'both' }, () => 0) === null);
t('verifyF2tDrill: rejects a tampered state, scramble, optimal, presolved, or mode', () => {
  const d = core.makeF2tDrill(FT, { mode: 'second' }, lcg(5150));
  if (!d || !core.verifyF2tDrill(FT, d)) return false;
  return !core.verifyF2tDrill(FT, { ...d, state: E.move(d.state, 2 * E.FIDX.R) }) &&
    !core.verifyF2tDrill(FT, { ...d, scramble: d.scramble + ' R' }) &&
    !core.verifyF2tDrill(FT, { ...d, optimal: d.optimal + 1 }) &&
    !core.verifyF2tDrill(FT, { ...d, presolved: d.presolved === 3 ? 5 : 3 }) &&
    !core.verifyF2tDrill(FT, { ...d, mode: 'both', presolved: 0 });
});

// ================ second/third-center step trainer ================
const CT = await T.buildC23(E);
const C23_TOK = /^(R|U|Rw|BL)'?$/;
const C23_FACES = ['L', 'R', 'B'];
const C23_PHYS = {};                    // method-frame face -> scrambling-hold letter
for (const f of C23_FACES) C23_PHYS[f] = E.FACES[E.faceImg(F2T_ENV.Minv, E.FIDX[f])];
const orbitView = (ctr, orbit) => {
  const p = new Array(12);
  for (let i = 0; i < 12; i++) p[i] = orbit === 'A' ? ctr[i] : ctr[12 + i] - 4;
  return p;
};
// heuristic-free exhaustive proof that no sealed word shorter than L reaches `goal`
function c23NoShorter(s0, goal, L) {
  if (core.c23GoalOK(s0, goal)) return false;
  let found = false;
  const rec = (s, g, lastFace) => {
    if (found || g >= L - 1) return;
    for (const m of FT.BL.SEALED_MOVES) {
      const f = m >> 1;
      if (f === lastFace || (E.OPPF[f] === lastFace && f > lastFace)) continue;
      const s2 = E.move(s, m);
      if (core.c23GoalOK(s2, goal)) { found = true; return; }
      rec(s2, g + 1, f);
      if (found) return;
    }
  };
  if (L > 1) rec(s0, 0, -1);
  return !found;
}

t('C23 tables: eccentricities + sealed-reachable cell counts pinned', () => {
  const scan = (arr) => {
    let max = 0, reach = 0;
    for (const v of arr) { if (v === T.UNREACHED) continue; reach++; if (v > max) max = v; }
    return { max, reach };
  };
  for (const f of C23_FACES) {
    const { max, reach } = scan(CT.dH1[f]);
    if (max !== 12 || reach !== 42336) return false;       // 9P3 x C(9,3): D slots sealed
  }
  for (const fg of ['LR', 'LB', 'RB']) {
    const { max, reach } = scan(CT.dE33[fg]);
    if (max !== 12 || reach !== 60480) return false;       // 9P6 disjoint placements
  }
  if (scan(CT.dB.L).max !== 5 || scan(CT.dB.R).max !== 5 || scan(CT.dB.B).max !== 5) return false;
  const all = scan(CT.dB.all);
  if (all.max !== 9 || all.reach !== 1680) return false;   // 9!/(3!)^3 valid mask pairs
  if (scan(CT.dAm.F).max !== 2 || scan(CT.dAm.BR).max !== 3 || scan(CT.dAm.BL).max !== 2) return false;
  return CT.dAm.F.every((v) => v !== T.UNREACHED);          // single masks: fully sealed-reachable
});
t('C23 tables: dist 0 ⇔ the goal reads solved; 1-Lipschitz along sealed moves', () => {
  const rnd = lcg(20260716);
  let s = E.solved();
  const ixOf = (st) => ({
    h1: Object.fromEntries(C23_FACES.map((f) => [f, T.h1Index(st.ep, st.ctr, f, T.HEX_EDGES[f])])),
    e3: Object.fromEntries(['L', 'R', 'B'].map((f) => [f, T.edgePlaceIndex(st.ep, T.HEX_EDGES[f])])),
    mk: [T.maskOfColor(orbitView(st.ctr, 'B'), 0), T.maskOfColor(orbitView(st.ctr, 'B'), 1)],
    ma: [1, 2, 3].map((c) => T.maskOfColor(orbitView(st.ctr, 'A'), c)),
  });
  let prev = ixOf(s);
  for (let i = 0; i < 400; i++) {
    const m = FT.BL.SEALED_MOVES[(rnd() * 10) | 0];
    const s2 = E.move(s, m);
    const cur = ixOf(s2);
    for (const f of C23_FACES) {
      const a = CT.dH1[f][prev.h1[f]], b = CT.dH1[f][cur.h1[f]];
      if (a === T.UNREACHED || b === T.UNREACHED || Math.abs(a - b) > 1) return false;
      if ((b === 0) !== core.c23HexOK(s2, f)) return false;
    }
    for (const [fg, i1, i2] of [['LR', 'L', 'R'], ['LB', 'L', 'B'], ['RB', 'R', 'B']]) {
      const a = CT.dE33[fg][prev.e3[i1] * 1320 + prev.e3[i2]];
      const b = CT.dE33[fg][cur.e3[i1] * 1320 + cur.e3[i2]];
      if (a === T.UNREACHED || b === T.UNREACHED || Math.abs(a - b) > 1) return false;
      if ((b === 0) !== [...T.HEX_EDGES[i1], ...T.HEX_EDGES[i2]].every((e) => s2.ep[e] === e)) return false;
    }
    const ua = prev.mk[0] * 220 + prev.mk[1], ub = cur.mk[0] * 220 + cur.mk[1];
    const ba = CT.dB.all[ua], bb = CT.dB.all[ub];
    if (ba === T.UNREACHED || bb === T.UNREACHED || Math.abs(ba - bb) > 1) return false;
    if ((bb === 0) !== [...Array(12).keys()].every((k) => s2.ctr[12 + k] === 4 + ((k / 3) | 0))) return false;
    const wantA = [[5, 1], [6, 2], [8, 2], [9, 3]];
    const aOK = [wantA.slice(0, 1), wantA.slice(1, 3), wantA.slice(3)].map((w) => w.every(([x, c]) => s2.ctr[x] === c));
    [CT.dAm.F, CT.dAm.BR, CT.dAm.BL].forEach((tab, k) => {
      const a = tab[prev.ma[k]], b = tab[cur.ma[k]];
      if (Math.abs(a - b) > 1 || (b === 0) !== aOK[k]) throw new Error('dAm ' + k);
    });
    s = s2; prev = cur;
  }
  return true;
});
const C23_PRE = { second: 0, third: 1, both: 0, fourth: 2, l2c: 1 };
const C23_GOAL = { second: 'c1', third: 'c2', both: 'c2', fourth: 'c3', l2c: 'c3' };
const C23_ALL_MODES = Object.keys(C23_PRE);

t('makeC23Drill: per mode — plain sealed letters, no same-face runs, state re-proved,\n  white center + both triples solved at start, mode conditions, verifyC23Drill agrees', () => {
  for (const mode of C23_ALL_MODES) {
    for (let i = 0; i < 3; i++) {
      const d = core.makeC23Drill(FT, CT, { mode }, lcg(3000 * i + 17 * mode.length));
      if (!d || d.mode !== mode || d.goal !== C23_GOAL[mode]) return false;
      const toks = d.scramble.split(/\s+/).filter(Boolean);
      if (!toks.every((x) => F2T_TOK.test(x)) || toks.length > 42) return false;
      for (let j = 1; j < toks.length; j++)
        if (toks[j].replace("'", '') === toks[j - 1].replace("'", '')) return false;
      const st = E.applyParsed(E.parseAlg(d.scramble), E.solved());
      if (!E.eq(st, d.state) || !f2tWhiteHomePhys(st)) return false;
      const sM = d.stateM;
      if (!core.f2tGoalOK(sM, 'pair')) return false;      // triples + white solved at start
      const solved = C23_FACES.filter((f) => core.c23HexOK(sM, f));
      if (solved.length !== C23_PRE[mode]) return false;
      if (d.presolved.join() !== solved.join()) return false;
      if (d.presolvedFaces.join() !== solved.map((f) => C23_PHYS[f]).join()) return false;
      if (core.c23GoalOK(sM, d.goal)) return false;
      if (d.optimal < 1 || !core.verifyC23Drill(FT, CT, d)) return false;
    }
  }
  return true;
});
t("fourth-center structure: the last hexagon's triangles are forced (two blocks + D\n  imply the third), so the drill is edges-only — optimal is always 1 or 3", () => {
  for (let i = 0; i < 8; i++) {
    const d = core.makeC23Drill(FT, CT, { mode: 'fourth' }, lcg(15000 + 137 * i));
    if (!d) return false;
    if (![1, 3].includes(d.optimal)) return false;
    const last = C23_FACES.find((f) => !d.presolved.includes(f));
    const fi = E.FIDX[last];
    for (let k = 0; k < 3; k++) if (d.stateM.ctr[3 * fi + k] !== fi) return false;   // triangles home
    if (T.HEX_EDGES[last].every((e) => d.stateM.ep[e] === e)) return false;          // edges are not
  }
  return true;
});
t('makeC23Drill: mask keeps exactly 53 facelets — all 12 edges, all 12 orbit-B\n  triangles, the 9 candidate source triangles, both triple corners', () => {
  for (const mode of C23_ALL_MODES) {
    const d = core.makeC23Drill(FT, CT, { mode }, lcg(881 + mode.length));
    if (!d || d.mask.length !== 72 - 53) return false;
    const keep = new Set([...Array(72).keys()]);
    for (const i of d.mask) keep.delete(i);
    if (keep.size !== 53) return false;
    let x = 0, e = 0, c = 0;
    for (const i of keep) { const ft = E.FEAT[i]; if (ft.t === 'x') x++; else if (ft.t === 'e') e++; else c++; }
    if (x !== 21 || e !== 24 || c !== 8) return false;
    // the home white hexagon is always among the kept facelets
    for (let i = 0; i < 72; i++) {
      const ft = E.FEAT[i];
      const isWhiteHex = (ft.t === 'x' && ft.f === E.FIDX.U) ||
        (ft.t === 'e' && E.EDGES.some((q) => q[2] === E.FIDX.U && q[0] === ft.v && q[1] === ft.v2));
      if (isWhiteHex && !keep.has(i)) return false;
    }
  }
  return true;
});
t('C23 optimal is exact: a heuristic-free brute force finds nothing shorter (per mode)', () => {
  const CAPS = { second: 6, third: 7, both: 8, fourth: 3, l2c: 8 };
  for (const mode of C23_ALL_MODES) {
    let checked = 0;
    for (let i = 0; i < 40 && checked < 2; i++) {
      const d = core.makeC23Drill(FT, CT, { mode }, lcg(7100 + 61 * i + mode.length));
      if (!d || d.optimal > CAPS[mode]) continue;
      if (!c23NoShorter(d.stateM, d.goal, d.optimal)) return false;
      checked++;
    }
    if (checked < 2) return false;
  }
  return true;
});
t('C23 exactness on synthetic short walks: searchLen equals the brute-force optimal\n  for every goal (c1, c2, c3) from solved-side states', () => {
  for (const goal of ['c1', 'c2', 'c3']) {
    let checked = 0;
    for (let seed = 0; seed < 20 && checked < 4; seed++) {
      const rnd = lcg(90000 + 7 * seed + goal.charCodeAt(1));
      let s = E.solved(), last = -1;
      for (let k = 0; k < 5; k++) {
        let m;
        do { m = FT.BL.SEALED_MOVES[(rnd() * 10) | 0]; } while ((m >> 1) === last);
        s = E.move(s, m); last = m >> 1;
      }
      if (core.c23GoalOK(s, goal)) continue;
      const opt = core.c23SearchLen(FT, CT, s, goal);
      if (opt == null || opt < 1 || opt > 5) return false;
      if (!c23NoShorter(s, goal, opt)) return false;
      checked++;
    }
    if (checked < 4) return false;
  }
  return true;
});
t('c23Solutions: every line proved end-to-end — entry bracket + {R,U,Rw,BL} tokens from\n  the drill state reach the goal with white + triples re-solved; count = optimal; none dropped', () => {
  for (const mode of C23_ALL_MODES) {
    for (let i = 0; i < (mode === 'second' || mode === 'third' ? 3 : 2); i++) {
      const d = core.makeC23Drill(FT, CT, { mode }, lcg(650 + 29 * i + mode.length));
      if (!d) return false;
      const res = core.c23Solutions(FT, CT, d, 8);
      if (!res.lines.length || res.dropped !== 0) return false;
      if (!res.capped && res.total < res.lines.length) return false;
      for (const l of res.lines) {
        const toks = l.text.split(/\s+/).filter(Boolean);
        if (!/^\{[A-Z]+,[A-Z]+\}$/.test(toks[0])) return false;
        if (!toks.slice(1).every((x) => /^\{[A-Z]+,[A-Z]+\}$/.test(x) || C23_TOK.test(x))) return false;
        const parsed = E.parseAlg(l.text);
        if (E.countMoves(parsed) !== d.optimal) return false;
        const st2 = E.applyParsed(parsed, d.state);
        if (!f2tWhiteHomePhys(st2)) return false;
        const F = E.toFacelets(st2), P = E.rotFaceletPerm(F2T_ENV.M), F2 = new Array(72);
        for (let k = 0; k < 72; k++) F2[k] = E.faceImg(F2T_ENV.M, F[P[k]]);
        const sM2 = E.fromFacelets(F2);
        if (!core.c23GoalOK(sM2, d.goal)) return false;
        const want = C23_FACES.filter((f) => core.c23HexOK(sM2, f)).map((f) => C23_PHYS[f]).sort();
        if (l.centers.slice().sort().join() !== want.join()) return false;
        if (l.centers.length < { c1: 1, c2: 2, c3: 3 }[d.goal]) return false;
      }
    }
  }
  return true;
});
t('makeC23Drill: a stuck injected rng exhausts the attempt cap and returns null (no hang)', () =>
  core.makeC23Drill(FT, CT, { mode: 'second' }, () => 0) === null);
t('verifyC23Drill: rejects a tampered state, scramble, optimal, presolved, or mode', () => {
  const d = core.makeC23Drill(FT, CT, { mode: 'third' }, lcg(6021));
  if (!d || !core.verifyC23Drill(FT, CT, d)) return false;
  return !core.verifyC23Drill(FT, CT, { ...d, state: E.move(d.state, 2 * E.FIDX.R) }) &&
    !core.verifyC23Drill(FT, CT, { ...d, scramble: d.scramble + ' R' }) &&
    !core.verifyC23Drill(FT, CT, { ...d, optimal: d.optimal + 1 }) &&
    !core.verifyC23Drill(FT, CT, { ...d, presolved: [d.presolved[0] === 'L' ? 'R' : 'L'] }) &&
    !core.verifyC23Drill(FT, CT, { ...d, mode: 'both', presolved: [] }) &&
    !core.verifyC23Drill(FT, CT, { ...d, mode: 'l2c' });   // same pre count, different goal
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
