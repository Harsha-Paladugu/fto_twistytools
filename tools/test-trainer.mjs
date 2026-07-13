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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
