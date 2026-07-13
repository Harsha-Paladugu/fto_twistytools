/* fto.twistytools.com — trainer substrate tests (src/trainer/fto-core.mjs). M4.
 *
 * Asserts the trainer's math against the shared FTO engine: the case model
 * over data/fto_algs.json (counts, groups, dialect plumbing), the native-move
 * flattening (walkParsed-exact, brackets/rotations/wides included), the
 * merge/cancel pass, and the setup scrambles — every drill machine-verified:
 * the scramble reproduces the shown state from solved, and undoing the AUF
 * then running the case's alg (in its authored hold dialect) solves it.
 *
 * No distance tables anywhere (the FTO state space has no full-state BFS) —
 * this suite is light, unlike its Skewb ancestor.
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
const E = globalThis.window.OOEngine;

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
t('model: uid = subset␟name; dialect cif; AUF randomization on', () =>
  ALL_CASES.every((c) => c.uid === c.subset + SEP + c.name && c.dialect === 'cif' && c.auf === true));
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
    if (d.auf !== k) return false;
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
t('makeDrill: AUF distribution — all three offsets appear over 100 draws', () => {
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(core.makeDrill(ALL_CASES[i % ALL_CASES.length]).auf);
  return seen.size === 3;
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
