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
 * the short 10-move scrambles + 9-facelet mask (2026-07-16: the drill
 * assumes a solved puzzle and shows only the white-center pieces), and
 * every drill + displayed solution re-proved on full states. Derivation
 * 2026-07-13, adversarially reviewed; docs/fto-ground-truth.md §Methods.
 *
 * Plus the FIRST TWO TRIPLES step trainer (2026-07-15): the sealed
 * turn-metric marginal tables (eccentricities pinned), the white anchor /
 * physical sealed alphabet / entry brackets, per-mode drills (short
 * white-center-sealing scrambles, mode conditions, the 26-facelet mask),
 * exact optimals cross-checked by a heuristic-free brute force, and every
 * displayed solver-style line re-proved end-to-end from the drill state.
 *
 * Plus the SECOND/THIRD CENTERS step trainer (2026-07-15; restricted metric
 * 2026-07-16): the RESTRICTED triple-preserving hexagon tables over
 * (cell, b) (eccentricities + reachable node counts pinned — every
 * sealed-reachable cell stays reachable at every drift), the restricted
 * move-system theorem (a {R,U,Rw} word from the aligned entry can never
 * move the solved triples; BL immediately makes the U token unsafe), the
 * index-carrying DFS against full-state predicates, per-mode drills
 * (triples pre-solved by appended machine-optimal words, mode conditions,
 * the 53-facelet mask), exact optimals cross-checked by a heuristic-free
 * restricted brute force, and every displayed {R,U,Rw} line re-proved
 * end-to-end INCLUDING a per-prefix block-intactness walk.
 *
 * Plus the BENCISCO STEP SPANS (step trainers v4, 2026-07-16): spanPlan's
 * contiguity rule and routing (single-regime selections = the drills above),
 * the 12 landing anchors + rebase
 * (every Q-rotated solved state reads SOLVED in all 3 of its method views —
 * built independently from uniform facelet arrays), per-span drills
 * (30-native-move scrambles fc-led / sealed walks + presolves tri-led,
 * start conditions, breakdown sums, the 30-facelet fc-led union mask), the
 * PHASED step-optimal target cross-checked by an independent phased brute
 * force (raw full-alphabet fc DFS over every optimal endstate + table-free
 * sealed/restricted existence searches), and every continuous reveal line
 * re-proved: count = target, split sums, phase goals through the line's own
 * landing view, per-prefix block intactness across center segments.
 *
 * Plus the LBT / L3T FINISH drills (step trainers v5, 2026-07-17): the
 * buildFinish bundle over the fetched alg data (the {U,S,H} coset with BFS
 * scramble words, the grip-folded 1L3T+TCP exact index, the 1LP appearance
 * matcher, the TCP ≤2-look finish maps, the LBT entry set), CANONICAL
 * physical counting (finCanonText: our AUF/re-grip decorations merged with
 * the algs' own edge turns — targets must be unbeatable, cross-checked by
 * an independent merge-counter that also expands S/H macros), uniform LBT
 * sampling (inverse-entry construction + 1/k thinning), the both-systems
 * L3T drill space (every drill shows a proven 1L3T line AND a proven
 * 1LP→TCP chain), and the lbt+l3t span's phased target with per-line
 * boundary proofs.
 *
 * Plus EVERY CONTIGUOUS RUN (step trainers v6, 2026-07-18): all 28 runs of
 * the 7-step chain valid; the centers→finish seam bridged by the 'call'
 * center goal (the retired last-center edges residue FUSED into the center
 * phase — same restricted regime — whose drift-0 states are exactly the
 * before-LBT junction, pinned live), crossing-span targets cross-checked by
 * an independent phased brute force across the seam (raw restricted DFS to
 * every call-optimal endstate, every sheet entry replayed, best L3T
 * continuation re-derived), fc-led spans past t2 via the index-carrying
 * sealed DFS (FT.aux — word-identical to the full-state DFS, pinned), and
 * every crossing reveal line walked independently through its center block
 * proof, before-LBT junction, coset entry and solved end.
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
t('makeFcDrill: any target — 10 plain face letters, machine-verified, optimal in 1..gn', () => {
  for (const metric of ['token', 'native']) {
    for (let i = 0; i < 5; i++) {
      const d = core.makeFcDrill(FC, { metric, target: 0 });
      if (!d || !core.verifyFcDrill(FC, d)) return false;
      const toks = d.scramble.split(/\s+/);
      if (toks.length !== 10 || !toks.every((x) => FACE_TOK.test(x))) return false;
      const gn = metric === 'native' ? FC.gn16 : FC.gn24;
      if (d.optimal < 1 || d.optimal > gn) return false;
    }
  }
  return true;
});
t('makeFcDrill: mask keeps exactly 9 facelets — the three white-sticker edges (both\n  stickers) and the three white triangles, wherever they sit', () => {
  for (const metric of ['token', 'native']) {
    for (let i = 0; i < 5; i++) {
      const d = core.makeFcDrill(FC, { metric, target: 0 });
      if (!d || d.mask.length !== 72 - 9) return false;
      const keep = new Set([...Array(72).keys()]);
      for (const k of d.mask) keep.delete(k);
      if (keep.size !== 9) return false;
      const fl = E.toFacelets(d.state);
      let x = 0, e = 0;
      for (const k of keep) {
        const ft = E.FEAT[k];
        if (ft.t === 'x') {
          if (fl[k] !== 0) return false;                     // a white triangle, wherever it sits
          x++;
        } else if (ft.t === 'e') {
          const slot = E.EDGES.findIndex((q) => q[0] === ft.v && q[1] === ft.v2);
          if (!FC.U_EDGES.includes(d.state.ep[slot])) return false;   // a white-hexagon edge piece
          e++;
        } else return false;                                 // never a corner facelet
      }
      if (x !== 3 || e !== 6) return false;
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
const C23_TOK = /^(R|U|Rw)'?$/;          // the restricted alphabet: no BL, no brackets
const C23_FACES = ['L', 'R', 'B'];
const C23_PHYS = {};                    // method-frame face -> scrambling-hold letter
for (const f of C23_FACES) C23_PHYS[f] = E.FACES[E.faceImg(F2T_ENV.Minv, E.FIDX[f])];
const orbitView = (ctr, orbit) => {
  const p = new Array(12);
  for (let i = 0; i < 12; i++) p[i] = orbit === 'A' ? ctr[i] : ctr[12 + i] - 4;
  return p;
};
const D_CW = 2 * E.FIDX.D;
const bShift = (m) => (m === D_CW ? 1 : m === D_CW + 1 ? 2 : 0);
// heuristic-free exhaustive proof that no RESTRICTED word shorter than L
// reaches `goal` (the target metric is triple-preserving words only)
function c23NoShorter(s0, goal, L) {
  if (core.c23GoalOK(s0, goal)) return false;
  let found = false;
  const rec = (s, b, g, lastFace) => {
    if (found || g >= L - 1) return;
    for (const [m, db] of CT.RES.MOVES[b]) {
      const f = m >> 1;
      if (f === lastFace || (E.OPPF[f] === lastFace && f > lastFace)) continue;
      const s2 = E.move(s, m);
      if (core.c23GoalOK(s2, goal)) { found = true; return; }
      rec(s2, (b + db) % 3, g + 1, f);
      if (found) return;
    }
  };
  if (L > 1) rec(s0, 0, 0, -1);
  return !found;
}
// independent per-prefix block predicate (does NOT reuse core.c23BlockOK):
// after b net drifts the block must read exactly as D^b applied to solved
const C23_REFS = (() => {
  const refs = [];
  let s = E.solved();
  for (let b = 0; b < 3; b++) { refs.push(s); s = E.move(s, D_CW); }
  return refs;
})();
const C23_SLOTS = (() => {
  const inv = (p) => { const q = new Array(p.length); for (let i = 0; i < p.length; i++) q[p[i]] = i; return q; };
  const t0 = E.moveTables[D_CW];
  const cI = inv(t0.cperm), eI = inv(t0.eperm), xI = inv(t0.xperm);
  const out = [];
  let c = [3, 5], e = [9, 10, 11], x = [5, 6, 8, 9, 18, 19, 20];
  for (let b = 0; b < 3; b++) {
    out.push({ c, e, x });
    c = c.map((v) => cI[v]); e = e.map((v) => eI[v]); x = x.map((v) => xI[v]);
  }
  return out;
})();
function blockIntact(s, b) {
  const S = C23_SLOTS[b], R = C23_REFS[b];
  return S.e.every((v) => s.ep[v] === R.ep[v]) &&
    S.c.every((v) => s.cp[v] === R.cp[v] && s.co[v] === R.co[v]) &&
    S.x.every((v) => s.ctr[v] === R.ctr[v]);
}

t('C23 restricted system: engine derivation pinned — working faces L/R/B by drift,\n  aligned entry grip, {R,U,Rw} words NEVER move the block, BL immediately would', () => {
  if (CT.RES.j0 !== 0) return false;
  if (CT.RES.XF.join() !== [E.FIDX.L, E.FIDX.R, E.FIDX.B].join()) return false;
  // fuzz: random restricted words from solved keep block = D^b(home) at every prefix
  const rnd = lcg(773311);
  for (let trial = 0; trial < 60; trial++) {
    let s = E.solved(), b = 0;
    const len = 1 + ((rnd() * 22) | 0);
    for (let i = 0; i < len; i++) {
      const [m, db] = CT.RES.MOVES[b][(rnd() * 6) | 0];
      s = E.move(s, m); b = (b + db) % 3;
      if (!blockIntact(s, b)) return false;
    }
  }
  // BL (engine D with NO drift) breaks the alignment: the very next U token
  // (the grip's unchanged working face) takes a triple out of place
  const sBL = E.move(E.solved(), D_CW);              // token BL from the entry grip
  if (!blockIntact(sBL, 1)) return false;            // the block itself just rotated
  const wrongU = E.move(sBL, 2 * CT.RES.XF[0]);      // grip unchanged -> face XF[0], block at b=1
  return !blockIntact(wrongU, 1);
});
t('C23 tables: restricted (cell x drift) eccentricities + reachable node counts pinned —\n  every sealed-reachable cell stays reachable at every drift', () => {
  const scan = (arr) => {
    let max = 0, reach = 0;
    for (const v of arr) { if (v === T.UNREACHED) continue; reach++; if (v > max) max = v; }
    return { max, reach };
  };
  const H1_MAX = { L: 16, R: 17, B: 17 };
  for (const f of C23_FACES) {
    const { max, reach } = scan(CT.dH1[f]);
    if (max !== H1_MAX[f] || reach !== 127008) return false;   // 42,336 sealed cells x 3 drifts
  }
  const E33_MAX = { LR: 17, LB: 17, RB: 18 };
  for (const fg of ['LR', 'LB', 'RB']) {
    const { max, reach } = scan(CT.dE33[fg]);
    if (max !== E33_MAX[fg] || reach !== 181440) return false; // 60,480 placements x 3 drifts
  }
  if (scan(CT.dB.L).max !== 8 || scan(CT.dB.R).max !== 8 || scan(CT.dB.B).max !== 8) return false;
  const all = scan(CT.dB.all);
  return all.max === 12 && all.reach === 5040;                 // 1,680 valid mask pairs x 3
});
t('C23 tables: dist 0 ⇔ the goal reads solved at drift 0; 1-Lipschitz along restricted moves', () => {
  const rnd = lcg(20260716);
  // start from a sealed-scrambled state so the walk covers deep cells
  let s = E.solved();
  for (let i = 0; i < 30; i++) s = E.move(s, FT.BL.SEALED_MOVES[(rnd() * 10) | 0]);
  let b = 0;
  const ixOf = (st) => ({
    h1: Object.fromEntries(C23_FACES.map((f) => [f, T.h1Index(st.ep, st.ctr, f, T.HEX_EDGES[f])])),
    e3: Object.fromEntries(['L', 'R', 'B'].map((f) => [f, T.edgePlaceIndex(st.ep, T.HEX_EDGES[f])])),
    mk: [T.maskOfColor(orbitView(st.ctr, 'B'), 0), T.maskOfColor(orbitView(st.ctr, 'B'), 1)],
  });
  let prev = ixOf(s);
  for (let i = 0; i < 400; i++) {
    const [m, db] = CT.RES.MOVES[b][(rnd() * 6) | 0];
    const s2 = E.move(s, m);
    const b2 = (b + db) % 3;
    const cur = ixOf(s2);
    for (const f of C23_FACES) {
      const a = CT.dH1[f][prev.h1[f] * 3 + b], v = CT.dH1[f][cur.h1[f] * 3 + b2];
      if (a === T.UNREACHED || v === T.UNREACHED || Math.abs(a - v) > 1) return false;
      if ((v === 0) !== (b2 === 0 && core.c23HexOK(s2, f))) return false;
    }
    for (const [fg, i1, i2] of [['LR', 'L', 'R'], ['LB', 'L', 'B'], ['RB', 'R', 'B']]) {
      const a = CT.dE33[fg][(prev.e3[i1] * 1320 + prev.e3[i2]) * 3 + b];
      const v = CT.dE33[fg][(cur.e3[i1] * 1320 + cur.e3[i2]) * 3 + b2];
      if (a === T.UNREACHED || v === T.UNREACHED || Math.abs(a - v) > 1) return false;
      const edgesHome = [...T.HEX_EDGES[i1], ...T.HEX_EDGES[i2]].every((e) => s2.ep[e] === e);
      if ((v === 0) !== (b2 === 0 && edgesHome)) return false;
    }
    const ua = (prev.mk[0] * 220 + prev.mk[1]) * 3 + b, ub = (cur.mk[0] * 220 + cur.mk[1]) * 3 + b2;
    const ba = CT.dB.all[ua], bb = CT.dB.all[ub];
    if (ba === T.UNREACHED || bb === T.UNREACHED || Math.abs(ba - bb) > 1) return false;
    const orbitHome = [...Array(12).keys()].every((k) => s2.ctr[12 + k] === 4 + ((k / 3) | 0));
    if ((bb === 0) !== (b2 === 0 && orbitHome)) return false;
    s = s2; b = b2; prev = cur;
  }
  return true;
});
t('makeC23Drill: per mode — plain sealed letters, no same-face runs, state re-proved,\n  white center + both triples solved at start, mode conditions, verifyC23Drill agrees', () => {
  for (const mode of ['second', 'third', 'both']) {
    for (let i = 0; i < 3; i++) {
      const d = core.makeC23Drill(FT, CT, { mode }, lcg(3000 * i + 17 * mode.length));
      if (!d || d.mode !== mode) return false;
      const toks = d.scramble.split(/\s+/).filter(Boolean);
      if (!toks.every((x) => F2T_TOK.test(x)) || toks.length > 48) return false;
      for (let j = 1; j < toks.length; j++)
        if (toks[j].replace("'", '') === toks[j - 1].replace("'", '')) return false;
      const st = E.applyParsed(E.parseAlg(d.scramble), E.solved());
      if (!E.eq(st, d.state) || !f2tWhiteHomePhys(st)) return false;
      const sM = d.stateM;
      if (!core.f2tGoalOK(sM, 'pair')) return false;      // triples + white solved at start
      const solved = C23_FACES.filter((f) => core.c23HexOK(sM, f));
      if (mode === 'third') {
        if (solved.length !== 1 || d.presolved !== solved[0]) return false;
        if (d.presolvedFace !== C23_PHYS[d.presolved]) return false;
      } else if (solved.length !== 0 || d.presolved !== null) return false;
      if (core.c23GoalOK(sM, d.goal)) return false;
      if (d.optimal < 1 || !core.verifyC23Drill(FT, CT, d)) return false;
    }
  }
  return true;
});
t('makeC23Drill: mask keeps exactly 53 facelets — all 12 edges, all 12 orbit-B\n  triangles, the 9 candidate source triangles, both triple corners', () => {
  for (const mode of ['second', 'third', 'both']) {
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
t('C23 optimal is exact: a heuristic-free restricted brute force finds nothing shorter (per mode)', () => {
  const CAPS = { second: 7, third: 8, both: 9 };
  for (const mode of ['second', 'third', 'both']) {
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
t('c23Solutions: every line proved end-to-end — the ONE fixed entry bracket, then plain\n  {R,U,Rw} tokens (no BL, no rotations); the solved triples never leave their place at\n  ANY prefix; count = optimal; none dropped', () => {
  for (const mode of ['second', 'third', 'both']) {
    for (let i = 0; i < 3; i++) {
      const d = core.makeC23Drill(FT, CT, { mode }, lcg(650 + 29 * i + mode.length));
      if (!d) return false;
      const res = core.c23Solutions(FT, CT, d, 8);
      if (!res.lines.length || res.dropped !== 0) return false;
      if (!res.capped && res.total < res.lines.length) return false;
      for (const l of res.lines) {
        const toks = l.text.split(/\s+/).filter(Boolean);
        if (toks[0] !== '{F,BL}') return false;            // the aligned entry grip, constant
        if (!toks.slice(1).every((x) => C23_TOK.test(x))) return false;
        const parsed = E.parseAlg(l.text);
        if (E.countMoves(parsed) !== d.optimal) return false;
        // per-prefix walk in the method frame: the block (white hexagon +
        // both triples) must sit exactly at D^b(home) after EVERY move
        let sP = d.stateM, bP = 0, intact = true;
        E.walkParsed(parsed, (mp) => {
          const mM = 2 * E.faceImg(F2T_ENV.M, mp >> 1) + (mp & 1);
          sP = E.move(sP, mM);
          bP = (bP + bShift(mM)) % 3;
          if (!blockIntact(sP, bP)) intact = false;
        });
        if (!intact || bP !== 0) return false;
        const st2 = E.applyParsed(parsed, d.state);
        if (!f2tWhiteHomePhys(st2)) return false;
        const F = E.toFacelets(st2), P = E.rotFaceletPerm(F2T_ENV.M), F2 = new Array(72);
        for (let k = 0; k < 72; k++) F2[k] = E.faceImg(F2T_ENV.M, F[P[k]]);
        const sM2 = E.fromFacelets(F2);
        if (!E.eq(sM2, sP)) return false;                  // the walk and the end proof agree
        if (!core.c23GoalOK(sM2, d.goal)) return false;
        const want = C23_FACES.filter((f) => core.c23HexOK(sM2, f)).map((f) => C23_PHYS[f]).sort();
        if (l.centers.slice().sort().join() !== want.join()) return false;
        if (l.centers.length < (d.goal === 'c2' ? 2 : 1)) return false;
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
    !core.verifyC23Drill(FT, CT, { ...d, presolved: d.presolved === 'L' ? 'R' : 'L' }) &&
    !core.verifyC23Drill(FT, CT, { ...d, mode: 'both', presolved: null });
});

// ================ Bencisco step spans (step trainers v4) ================
const SPANV = core.spanEnv(FT, FC);        // init-asserted: anchors, spells, rebase pairing
const SPAN_NATIVE_TOK = /^(BR|BL|[UFRLDB])'?$/;
// independent method-frame conjugation (the f2t re-proof pattern)
const conjM = (s) => {
  const F = E.toFacelets(s), P = E.rotFaceletPerm(F2T_ENV.M), F2 = new Array(72);
  for (let k = 0; k < 72; k++) F2[k] = E.faceImg(F2T_ENV.M, F[P[k]]);
  return E.fromFacelets(F2);
};
// independent exact sealed / restricted lengths by pure existence DFS (no tables)
function indepSealedLen(s0, goal, cap) {
  if (core.f2tGoalOK(s0, goal)) return 0;
  for (let L = 1; L <= cap; L++) {
    let found = false;
    const rec = (s, g, lastFace) => {
      if (found) return;
      for (const m of FT.BL.SEALED_MOVES) {
        const f = m >> 1;
        if (f === lastFace || (E.OPPF[f] === lastFace && f > lastFace)) continue;
        const s2 = E.move(s, m);
        if (g + 1 === L) { if (core.f2tGoalOK(s2, goal)) { found = true; return; } }
        else rec(s2, g + 1, f);
        if (found) return;
      }
    };
    rec(s0, 0, -1);
    if (found) return L;
  }
  return null;
}
function indepRestrictedLen(s0, goal, cap) {
  if (core.c23GoalOK(s0, goal)) return 0;
  for (let L = 1; L <= cap; L++) {
    let found = false;
    const rec = (s, b, g, lastFace) => {
      if (found) return;
      for (const [m, db] of CT.RES.MOVES[b]) {
        const f = m >> 1;
        if (f === lastFace || (E.OPPF[f] === lastFace && f > lastFace)) continue;
        const s2 = E.move(s, m);
        if (g + 1 === L) { if (core.c23GoalOK(s2, goal)) { found = true; return; } }
        else rec(s2, (b + db) % 3, g + 1, f);
        if (found) return;
      }
    };
    rec(s0, 0, 0, -1);
    if (found) return L;
  }
  return null;
}

t('spanPlan: contiguity rule + routing — ALL 28 contiguous runs are valid (v6);\n  singles and single-regime runs map to the existing drills, multi-regime runs\n  are spans; gapped picks refuse; crossing spans promote the center goal to call', () => {
  const want = [
    [['fc'], 'fc', undefined], [['t1'], 'f2t', 'first'], [['t2'], 'f2t', 'second'],
    [['t1', 't2'], 'f2t', 'both'], [['sc'], 'c23', 'second'], [['c3'], 'c23', 'third'],
    [['sc', 'c3'], 'c23', 'both'],
    [['fc', 't1'], 'span', undefined], [['t1', 'fc'], 'span', undefined],   // order-insensitive
    [['fc', 't1', 't2'], 'span', undefined], [['t1', 't2', 'sc'], 'span', undefined],
    [['t2', 'sc'], 'span', undefined], [['t2', 'sc', 'c3'], 'span', undefined],
    [['t1', 't2', 'sc', 'c3'], 'span', undefined],
    [['lbt'], 'lbt', undefined], [['l3t'], 'l3t', undefined],
    [['lbt', 'l3t'], 'span', undefined], [['l3t', 'lbt'], 'span', undefined],
  ];
  for (const [steps, kind, mode] of want) {
    const p = core.spanPlan(steps);
    if (!p.ok || p.kind !== kind || (mode !== undefined && p.mode !== mode)) return false;
    if (p.key !== steps.slice().sort((a, b) => core.SPAN_STEPS.indexOf(a) - core.SPAN_STEPS.indexOf(b)).join('+')) return false;
  }
  const pf = core.spanPlan(['lbt', 'l3t']);
  if (pf.start !== 'lbt' || pf.phases.map((x) => x.kind).join() !== 'lbt,l3t') return false;
  // every contiguous run [i..j] of the 7 steps is valid — 28 selections
  for (let i = 0; i < core.SPAN_STEPS.length; i++) {
    for (let j = i; j < core.SPAN_STEPS.length; j++) {
      const steps = core.SPAN_STEPS.slice(i, j + 1);
      const p = core.spanPlan(steps);
      if (!p.ok || p.key !== steps.join('+')) return false;
      if (p.kind !== 'span') continue;
      // phase shape: kinds in step order; the center phase goal is 'call'
      // exactly when a finish step follows it (the fused residue rule)
      const fin = steps.includes('lbt') || steps.includes('l3t');
      const ctr = p.phases.find((x) => x.kind === 'ctr');
      if (ctr && fin && ctr.goal !== 'call') return false;
      if (ctr && !fin && ctr.goal === 'call') return false;
      if (p.start !== steps[0]) return false;
    }
  }
  for (const [steps, reason] of [
    [[], 'empty'], [['xx'], 'empty'], [['fc', 'fc'], 'empty'],
    [['fc', 't2'], 'gap'], [['t1', 'sc'], 'gap'], [['fc', 'c3'], 'gap'],
    [['fc', 'lbt'], 'gap'], [['t2', 'lbt'], 'gap'], [['sc', 'l3t'], 'gap'],
    [['c3', 'l3t'], 'gap'], [['t1', 't2', 'lbt'], 'gap'],
  ]) {
    const p = core.spanPlan(steps);
    if (p.ok || p.reason !== reason) return false;
  }
  return true;
});
t('span landing views: 12 anchors (3 per tetrad-A face, the U triple = the solver\'s\n  white anchors); every Q-rotated solved state reads SOLVED in all 3 of its views', () => {
  if (SPANV.ANCH.some((a) => a.length !== 3)) return false;
  if (!SPANV.ANCH[E.FIDX.U].some((a) => a.M === F2T_ENV.M)) return false;
  // independent uniform construction of each rotated solved state
  for (const Q of E.ROT24.filter((M) => E.faceImg(M, 0) < 4)) {
    const inv = new Array(8);
    for (let f = 0; f < 8; f++) inv[E.faceImg(Q, f)] = f;
    const F = new Array(72);
    for (let f = 0; f < 8; f++) for (let k = 0; k < 9; k++) F[9 * f + k] = inv[f];
    const rot = E.fromFacelets(F);
    if (!core.fcStateOK(FC, rot)) return false;            // a valid first-center formation
    const views = SPANV.viewsOf(rot);
    if (!views || views.length !== 3) return false;
    for (const v of views) if (!E.eq(v.sM, E.solved())) return false;
  }
  return true;
});
t('span views: every optimal first-center landing gets exactly 3 method views, each\n  with the white hexagon exactly home (independent of the landing face)', () => {
  for (let i = 0; i < 4; i++) {
    const d = core.makeFcDrill(FC, { metric: 'token', target: 0 }, lcg(8100 + i));
    if (!d) return false;
    const sols = core.fcSolutions(FC, d, 4);
    for (const l of sols.lines) {
      const e = E.applyParsed(E.parseAlg(l.text), d.state);
      const views = SPANV.viewsOf(e);
      if (!views || views.length !== 3) return false;
      for (const v of views) {
        if (v.sM.ep[9] !== 9 || v.sM.ep[10] !== 10 || v.sM.ep[11] !== 11) return false;
        if (v.sM.ctr[18] !== 6 || v.sM.ctr[19] !== 6 || v.sM.ctr[20] !== 6) return false;
      }
    }
  }
  return true;
});
t('makeSpanDrill: per span — scramble shape (30 natives fc-led / sealed letters tri-led),\n  no same-face runs, state re-proved, start conditions, breakdown sums, verify agrees', () => {
  const SPANS = [['fc', 't1'], ['fc', 't1', 't2'], ['t1', 't2', 'sc'], ['t2', 'sc'], ['t1', 't2', 'sc', 'c3']];
  for (const steps of SPANS) {
    const plan = core.spanPlan(steps);
    if (!plan.ok || plan.kind !== 'span') return false;
    const n = steps.includes('fc') && steps.includes('t2') ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const d = core.makeSpanDrill(FC, FT, CT, plan, { metric: 'token' }, lcg(9000 + 31 * i + steps.length));
      if (!d || d.kind !== 'span' || d.spanKey !== plan.key) return false;
      const toks = d.scramble.split(/\s+/).filter(Boolean);
      if (plan.start === 'fc') {
        if (toks.length !== 30 || !toks.every((x) => SPAN_NATIVE_TOK.test(x))) return false;
      } else {
        if (!toks.every((x) => F2T_TOK.test(x))) return false;
        if (toks.length > 28) return false;
      }
      for (let j = 1; j < toks.length; j++)
        if (toks[j].replace("'", '') === toks[j - 1].replace("'", '')) return false;
      const st = E.applyParsed(E.parseAlg(d.scramble), E.solved());
      if (!E.eq(st, d.state)) return false;
      if (plan.start === 'fc') {
        if (core.fcStateOK(FC, st)) return false;          // white center displaced
      } else {
        if (!f2tWhiteHomePhys(st)) return false;
        const sM = conjM(st);
        if (plan.start === 't2') {
          if (![3, 5].includes(d.presolved)) return false;
          if (!core.f2tTripleOK(sM, d.presolved) || core.f2tTripleOK(sM, d.presolved === 3 ? 5 : 3)) return false;
        } else if (d.presolved !== 0 || core.f2tTripleOK(sM, 3) || core.f2tTripleOK(sM, 5)) return false;
      }
      const regimes = (steps.includes('fc') ? 1 : 0) +
        (steps.includes('t1') || steps.includes('t2') ? 1 : 0) +
        (steps.includes('sc') || steps.includes('c3') ? 1 : 0);
      if (d.breakdown.length !== regimes) return false;
      if (d.breakdown.reduce((a, b) => a + b, 0) !== d.optimal || d.optimal < 1) return false;
      if (!core.verifySpanDrill(FC, FT, CT, d)) return false;
    }
  }
  return true;
});
t('makeSpanDrill: fc-led mask keeps exactly 30 facelets — the 9 white-center pieces,\n  the 3 white-adjacent corners, the 9 candidate source triangles (union over landings)', () => {
  for (let i = 0; i < 3; i++) {
    const d = core.makeSpanDrill(FC, FT, CT, core.spanPlan(['fc', 't1']), { metric: 'token' }, lcg(4300 + i));
    if (!d || d.mask.length !== 72 - 30) return false;
    const keep = new Set(Array.from({ length: 72 }, (_, k) => k).filter((k) => !d.mask.includes(k)));
    let x = 0, e = 0, c = 0;
    for (const k of keep) { const ft = E.FEAT[k]; if (ft.t === 'x') x++; else if (ft.t === 'e') e++; else c++; }
    if (x !== 12 || e !== 6 || c !== 12) return false;
    // the white pieces (3 white triangles + the 3 U-edge pieces) are always kept
    const F = E.toFacelets(d.state);
    for (let k = 0; k < 72; k++) {
      const ft = E.FEAT[k];
      if (ft.t === 'x' && F[k] === 0 && !keep.has(k)) return false;
      if (ft.t === 'e') {
        const slot = E.EDGES.findIndex((q) => q[0] === ft.v && q[1] === ft.v2);
        const piece = d.state.ep[slot];
        if (E.EDGES[piece][2] === E.FIDX.U && !keep.has(k)) return false;
      }
    }
  }
  return true;
});
t('span target is exact: an independent phased brute force (raw full-alphabet fc DFS +\n  table-free sealed/restricted searches) reproduces the step-optimal total', () => {
  let checkedFc = 0, checkedTri = 0;
  for (let i = 0; i < 60 && checkedFc < 2; i++) {
    const d = core.makeSpanDrill(FC, FT, CT, core.spanPlan(['fc', 't1']), { metric: 'token' }, lcg(5200 + i));
    if (!d || d.breakdown[0] > 4 || d.breakdown[1] > 3) continue;
    // every fc-optimal endstate by raw DFS over ALL 24 generators (no canonical
    // ordering, no suppression): the phased min must match the drill target
    const L1 = d.breakdown[0];
    const ends = new Map();
    const rec = (s, g) => {
      if (g === L1) { if (core.fcStateOK(FC, s)) ends.set(E.stateKey(s), s); return; }
      for (let gi = 0; gi < FC.GENS.length; gi++) {
        let s2 = s;
        for (const m of FC.GENS[gi].moves) s2 = E.move(s2, m);
        rec(s2, g + 1);
      }
    };
    rec(d.state, 0);
    if (!ends.size) return false;
    // no shorter fc solve exists (raw DFS at every shorter length)
    for (let L = 0; L < L1; L++) {
      let hit = false;
      const rec2 = (s, g) => {
        if (hit) return;
        if (g === L) { if (core.fcStateOK(FC, s)) hit = true; return; }
        for (let gi = 0; gi < FC.GENS.length && !hit; gi++) {
          let s2 = s;
          for (const m of FC.GENS[gi].moves) s2 = E.move(s2, m);
          rec2(s2, g + 1);
        }
      };
      rec2(d.state, 0);
      if (hit) return false;
    }
    // cap = the claimed continuation: anything shorter would surface and
    // fail the equality; nothing at all leaves best at Infinity and fails it
    let best = Infinity;
    for (const e of ends.values()) {
      const views = SPANV.viewsOf(e);
      if (!views) return false;
      for (const v of views) {
        const len = indepSealedLen(v.sM, 'either', d.breakdown[1]);
        if (len != null) best = Math.min(best, L1 + len);
      }
    }
    if (best !== d.optimal) return false;
    checkedFc++;
  }
  for (let i = 0; i < 40 && checkedTri < 2; i++) {
    const d = core.makeSpanDrill(FC, FT, CT, core.spanPlan(['t1', 't2', 'sc']), {}, lcg(6600 + i));
    if (!d || d.breakdown[0] > 4 || d.breakdown[1] > 5) continue;
    const sM0 = conjM(d.state);
    const L1 = indepSealedLen(sM0, 'pair', 6);
    if (L1 !== d.breakdown[0]) return false;
    // all pair-optimal endstates by raw sealed DFS (no canonical ordering)
    const ends = new Map();
    const rec = (s, g) => {
      if (g === L1) { if (core.f2tGoalOK(s, 'pair')) ends.set(E.stateKey(s), s); return; }
      for (const m of FT.BL.SEALED_MOVES) rec(E.move(s, m), g + 1);
    };
    rec(sM0, 0);
    if (!ends.size) return false;
    let best = Infinity;
    for (const e of ends.values()) {
      const len = indepRestrictedLen(e, 'c1', d.breakdown[1]);
      if (len != null) best = Math.min(best, L1 + len);
    }
    if (best !== d.optimal) return false;
    checkedTri++;
  }
  return checkedFc >= 2 && checkedTri >= 2;
});
t('spanSolutions: every line is ONE continuous proved text — parses, count = target,\n  split sums, phase goals hold through the line\'s own landing view, and center\n  segments keep the solved block at D^b(home) at EVERY prefix', () => {
  const SPANS = [['fc', 't1'], ['fc', 't1', 't2'], ['t1', 't2', 'sc'], ['t2', 'sc', 'c3']];
  for (const steps of SPANS) {
    const plan = core.spanPlan(steps);
    const n = steps.includes('fc') && steps.includes('t2') ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const d = core.makeSpanDrill(FC, FT, CT, plan, { metric: 'token' }, lcg(7300 + 13 * i + steps.length));
      if (!d) return false;
      const res = core.spanSolutions(FC, FT, CT, d, 8);
      if (!res.lines.length || res.dropped !== 0) return false;
      for (const l of res.lines) {
        const parsed = E.parseAlg(l.text);
        if (!parsed) return false;
        if (E.countMoves(parsed) !== d.optimal) return false;
        if (l.split.reduce((a, b) => a + b, 0) !== d.optimal) return false;
        if (l.split.length !== d.breakdown.length) return false;
        const stF = E.applyParsed(parsed, d.state);
        const triGoal = steps.includes('t1') && !steps.includes('t2') ? 'either' : 'pair';
        if (plan.start === 'fc') {
          // the line must end white-formed with its landing view solving the goal
          if (!core.fcStateOK(FC, stF)) return false;
          const views = SPANV.viewsOf(stF);
          if (!views || !views.some((v) => core.f2tGoalOK(v.sM, triGoal))) return false;
        } else {
          // method-frame walk: triples segment first, then the center segment
          // must keep the block at D^b(home) after EVERY single move
          const fired = [];
          E.walkParsed(parsed, (m) => fired.push(m));
          if (fired.length !== d.optimal) return false;    // sealed/restricted words: 1 token = 1 native
          let sP = conjM(d.state), bP = 0;
          for (let k = 0; k < fired.length; k++) {
            const mM = 2 * E.faceImg(F2T_ENV.M, fired[k] >> 1) + (fired[k] & 1);
            sP = E.move(sP, mM);
            if (k >= l.split[0]) {
              bP = (bP + bShift(mM)) % 3;
              if (!blockIntact(sP, bP)) return false;
            } else if (k === l.split[0] - 1) {
              if (!core.f2tGoalOK(sP, 'pair')) return false;     // triples done at the boundary
            }
          }
          if (bP !== 0) return false;
          if (!E.eq(sP, conjM(stF))) return false;
          const ctrGoal = steps.includes('sc') && !steps.includes('c3') ? 'c1' : 'c2';
          if (!core.c23GoalOK(sP, ctrGoal)) return false;
          if (!l.centers || l.centers.length < (ctrGoal === 'c2' ? 2 : 1)) return false;
        }
      }
    }
  }
  return true;
});
t('makeSpanDrill: a stuck injected rng exhausts the attempt cap and returns null (no hang)', () =>
  core.makeSpanDrill(FC, FT, CT, core.spanPlan(['fc', 't1']), { metric: 'token' }, () => 0) === null &&
  core.makeSpanDrill(FC, FT, CT, core.spanPlan(['t1', 't2', 'sc']), {}, () => 0) === null);
t('verifySpanDrill: rejects a tampered state, scramble, optimal, breakdown, mask, or steps', () => {
  const d = core.makeSpanDrill(FC, FT, CT, core.spanPlan(['fc', 't1']), { metric: 'token' }, lcg(8801));
  if (!d || !core.verifySpanDrill(FC, FT, CT, d)) return false;
  return !core.verifySpanDrill(FC, FT, CT, { ...d, state: E.move(d.state, 2 * E.FIDX.R) }) &&
    !core.verifySpanDrill(FC, FT, CT, { ...d, scramble: d.scramble + ' R' }) &&
    !core.verifySpanDrill(FC, FT, CT, { ...d, optimal: d.optimal + 1 }) &&
    !core.verifySpanDrill(FC, FT, CT, { ...d, breakdown: [d.optimal] }) &&
    !core.verifySpanDrill(FC, FT, CT, { ...d, mask: d.mask.slice(1) }) &&
    !core.verifySpanDrill(FC, FT, CT, { ...d, steps: ['fc', 't1', 't2'], spanKey: 'fc+t1+t2' });
});

// ---------------- LBT / L3T finish drills (step trainers v5) ----------------
const FIN = core.buildFinish(JSON_DATA);

// independent coset (test-engine §16 construction: effect-table closure)
const indepCoset = (() => {
  const tbl = (x) => E.effectTable(E.parseAlg(x), 'cif');
  const gens = ['U', "U'", 'S', "S'", 'H', "H'"].map(tbl);
  const seen = new Map([[E.stateKey(E.solved()), E.solved()]]);
  let fr = [E.solved()];
  while (fr.length) {
    const nx = [];
    for (const s of fr) for (const g of gens) {
      const t2 = E.applyTable(g, s), k = E.stateKey(t2);
      if (!seen.has(k)) { seen.set(k, t2); nx.push(t2); }
    }
    fr = nx;
  }
  return seen;
})();
// independent implementation of the axis-run floor (the adversarial review's
// model, 2026-07-17): fired natives fold within maximal same-AXIS runs —
// opposite-face layer turns commute, so a run's net twists (a, b) cost
// 0 / 1 (single face, or the slice a+b≡0) / 2, realizable as engine tokens
// plus free rotations. Everything the core's finPhysMoves must agree with,
// written differently: face-amount maps per run + a cost function.
function indepFloor(text) {
  const p = E.parseAlg(text);
  if (!p) return null;
  const nat = [];
  try { E.walkParsed(p, (m) => nat.push(m)); } catch (e) { return null; }
  const runs = [];
  for (const m of nat) {
    const f = m >> 1, axis = Math.min(f, E.OPPF[f]);
    if (!runs.length || runs[runs.length - 1].axis !== axis) runs.push({ axis, amt: {} });
    const r = runs[runs.length - 1];
    r.amt[f] = ((r.amt[f] || 0) + ((m & 1) ? 2 : 1)) % 3;
  }
  let total = 0;
  for (const r of runs) {
    const live = Object.keys(r.amt).filter((f) => r.amt[f] !== 0);
    if (live.length === 2) total += (r.amt[live[0]] + r.amt[live[1]]) % 3 === 0 ? 1 : 2;
    else total += live.length;
  }
  return total;
}
const indepFormed = (s) => {
  const US = [0, 1, 2], FLK = [3, 7, 11];
  for (let j = 0; j < 3; j++) {
    if (s.cp[j] > 2) return false;
    const uY = s.ctr[US[j]] === E.FIDX.U, fY = s.ctr[FLK[j]] === E.FIDX.U;
    if (s.co[j] ? !(!uY && fY) : !(uY && !fY)) return false;
  }
  return true;
};

t('buildFinish: coset 4320 (1440 edges-home, 3 trivial) matches an independent closure;\n  3 grips; 360 LBT entries; 1L3T+TCP index covers 3237 of the 4317 non-trivial states', () => {
  if (FIN.coset.size !== 4320 || indepCoset.size !== 4320) return false;
  for (const k of FIN.coset.keys()) if (!indepCoset.has(k)) return false;
  let eh = 0, cov = 0, nt = 0;
  for (const [k, n] of FIN.coset) {
    if (n.s.ep.every((v, i) => v === i)) eh++;
    if (FIN.trivial.has(k)) continue;
    nt++;
    if (FIN.l3t.has(k)) cov++;
  }
  return eh === 1440 && FIN.trivial.size === 3 && nt === 4317 && cov === 3237 &&
    FIN.GRIPS.length === 3 && FIN.GRIPS.map((g) => g.spell).join(' ') === ' {U,BR} {U,BL}' &&
    FIN.lbt.length === 360;
});
t('buildFinish: every coset BFS word reproduces its state from solved (spot 200)', () => {
  const keys = FIN.cosetKeys;
  for (let i = 0; i < 200; i++) {
    const k = keys[(i * 21 + 7) % keys.length];
    let st = E.solved();
    for (const m of FIN.cosetWord(k)) st = E.move(st, m);
    if (E.stateKey(st) !== k) return false;
  }
  return true;
});
t('finCanonText folds ONLY our plain decorations (verbatim sheet texts untouched —\n  parens and (U) markers survive); finPhysMoves is the axis-run floor', () => {
  const cc = core.finCanonText, fm = core.finPhysMoves;
  if (!cc("B' R B R' U' U") || cc("B' R B R' U' U").text !== "B' R B R'") return false;
  if (!cc('U U') || cc('U U').text !== "U'") return false;
  const across = cc("U' {U,BR} U");
  if (!across || across.text !== '{U,BR}') return false;
  if (cc("Rw Rw'") !== null) return false;              // no plain fold: keep verbatim
  if (cc("R' L R L'") !== null) return false;           // already canonical: keep
  if (cc("{B,U} (U' R' D R') (U R D' R)") !== null) return false;   // sheet parens survive
  // the floor merges what a human merges: slice/wide pairs, macro edges, AUFs
  const want = [['U U', 1], ["U U'", 0], ["Rw Rw'", 0], ["Rw R'", 1], ["BL R'", 1],
                ["U' Uw", 1], ['U Us', 1], ['U Uw', 2], ['R S', 3], ["R' L R L'", 4],
                ['Rs', 1], ['R2', 1], ["B' R B R' U' U", 4], ['S', 4], ['U R BL R', 2]];
  return want.every(([tx, n]) => fm(tx) === n && indepFloor(tx) === n);
});
t('buildFinish: every LBT entry and 1L3T index entry is priced at its physical floor\n  (the independent axis-run counter agrees; sampled across the index)', () => {
  for (const en of FIN.lbt) if (indepFloor(en.text) !== en.moves) return false;
  let i = 0;
  for (const list of FIN.l3t.values()) for (const en of list) {
    if (i++ % 17 !== 0) continue;                       // ~400 sampled entries
    if (indepFloor(en.text) !== en.moves) return false;
  }
  return true;
});
t('buildFinish: TCP ≤2-look finish closes ALL 216 formed states, worst 14 floor turns\n  (the sheet\'s own "or 2-look"); the formed census matches an independent predicate', () => {
  let formed = 0, worst = 0;
  for (const [k, n] of FIN.coset) {
    if (!indepFormed(n.s)) continue;
    formed++;
    if (k === FIN.SOLVED_KEY) continue;
    const cands = FIN.finishCands(n.s, k);
    if (!cands.length) return false;
    if (cands[0].moves > worst) worst = cands[0].moves;
  }
  return formed === 216 && worst === 14;
});

t('makeLbtDrill: state re-proved from the scramble, before-LBT start (everything but\n  slot 4 + top solved, edges home, slot unsolved), optimal = fewest applicable entry,\n  verify agrees, mask keeps the 30 slot-region facelets', () => {
  for (let i = 0; i < 12; i++) {
    const d = core.makeLbtDrill(FIN, lcg(4400 + 7 * i));
    if (!d || d.kind !== 'lbt') return false;
    const toks = d.scramble.split(/\s+/);
    if (!toks.every((x) => FACE_TOK.test(x))) return false;
    for (let j = 1; j < toks.length; j++)
      if (toks[j].replace("'", '') === toks[j - 1].replace("'", '')) return false;
    let st = E.solved();
    E.walkParsed(E.parseAlg(d.scramble), (m) => { st = E.move(st, m); });
    if (!E.eq(st, d.state)) return false;
    if (!core.beforeLbtOK(st)) return false;
    if (st.cp[4] === 4 && st.co[4] === 0 && st.ctr[4] === 1 && st.ctr[10] === 3) return false;
    // independent optimal: every entry replayed on the full state; a landing
    // must sit inside the independent coset (or be solved)
    let best = Infinity;
    for (const en of FIN.lbt) {
      let post = null;
      try { post = E.applyParsed(E.parseAlg(en.text), E.copy(st), 'cif'); } catch (e) { continue; }
      const pk = E.stateKey(post);
      if (pk !== E.stateKey(E.solved()) && !indepCoset.has(pk)) continue;
      const mc = indepFloor(en.text);
      if (mc < best) best = mc;
    }
    if (best !== d.optimal || d.optimal < 1) return false;
    if (!core.verifyLbtDrill(FIN, d)) return false;
    if (d.mask.length !== 72 - 30) return false;
    const keep = new Set(Array.from({ length: 72 }, (_, x) => x).filter((x) => !d.mask.includes(x)));
    for (const x of keep) {
      const ft = E.FEAT[x];
      const okC = ft.t === 'c' && [0, 1, 2, 4].includes(ft.v);
      const okX = ft.t === 'x' && [0, 1, 2, 3, 4, 7, 10, 11].includes(3 * ft.f + (ft.v % 3));
      const okE = ft.t === 'e' && (ft.v === E.FIDX.U || ft.v2 === E.FIDX.U ||
        E.EDGES.some((q, e) => q[0] === ft.v && q[1] === ft.v2 && (q[2] === E.FIDX.U || q[3] === E.FIDX.U)));
      if (!okC && !okX && !okE) return false;
    }
  }
  return true;
});
t('lbtSolutions: every displayed line re-proved (parses, count exact, landing inside the\n  L3T coset), best-first, and the target is UNBEATABLE by the independent merge-counter', () => {
  for (let i = 0; i < 10; i++) {
    const d = core.makeLbtDrill(FIN, lcg(5500 + 11 * i));
    if (!d) return false;
    const res = core.lbtSolutions(FIN, d, 6);
    if (!res.lines.length || res.dropped) return false;
    if (res.lines[0].moves !== d.optimal) return false;
    let prev = 0;
    for (const l of res.lines) {
      if (l.moves < prev) return false;
      prev = l.moves;
      const p = E.parseAlg(l.text);
      if (!p || E.countMoves(p) !== l.tokens || l.tokens < l.moves) return false;
      if (indepFloor(l.text) !== l.moves) return false;   // the floor IS the price
      const post = E.applyParsed(p, E.copy(d.state), 'cif');
      const pk = E.stateKey(post);
      if (pk !== E.stateKey(E.solved()) && !indepCoset.has(pk)) return false;
    }
  }
  return true;
});
t('makeL3tDrill: state = a non-trivial coset member re-proved from the scramble; BOTH\n  sheet routes produce proven lines; target = their minimum; parts recorded; verify\n  agrees; mask keeps the 24 top-region facelets', () => {
  for (let i = 0; i < 10; i++) {
    const d = core.makeL3tDrill(FIN, lcg(6600 + 13 * i));
    if (!d || d.kind !== 'l3t') return false;
    let st = E.solved();
    E.walkParsed(E.parseAlg(d.scramble), (m) => { st = E.move(st, m); });
    if (!E.eq(st, d.state)) return false;
    const k = E.stateKey(st);
    if (!indepCoset.has(k) || FIN.trivial.has(k)) return false;
    const res = core.l3tSolutions(FIN, d, 6);
    if (!res.sys1.length || !res.sys2.length) return false;
    if (Math.min(res.sys1[0].moves, res.sys2[0].moves) !== d.optimal) return false;
    if (d.parts.l3t !== res.sys1[0].moves || d.parts.chain !== res.sys2[0].moves) return false;
    if (!core.verifyL3tDrill(FIN, d)) return false;
    if (d.mask.length !== 72 - 24) return false;
  }
  return true;
});
t('l3tSolutions: every line of BOTH routes re-proved from the drill state to EXACTLY\n  solved; counts exact and unbeatable by the independent merge-counter (which also\n  merges across the 1LP→TCP junctions)', () => {
  for (let i = 0; i < 8; i++) {
    const d = core.makeL3tDrill(FIN, lcg(7700 + 17 * i));
    if (!d) return false;
    const res = core.l3tSolutions(FIN, d, 6);
    let beatable = Infinity;
    for (const l of [...res.sys1, ...res.sys2]) {
      const p = E.parseAlg(l.text);
      if (!p || E.countMoves(p) !== l.tokens || l.tokens < l.moves) return false;
      if (indepFloor(l.text) !== l.moves) return false;
      if (!E.eq(E.applyParsed(p, E.copy(d.state), 'cif'), E.solved())) return false;
      const mc = indepFloor(l.text);
      if (mc < beatable) beatable = mc;
    }
    if (beatable < d.optimal) return false;
    // and the full index at this key holds nothing shorter than the target
    for (const en of FIN.l3t.get(E.stateKey(d.state)) || [])
      if (indepFloor(en.text) < d.optimal) return false;
  }
  return true;
});
t('makeSpanDrill lbt+l3t: phased target = LBT optimal + best L3T continuation over the\n  optimal landings (independently recomputed); start conditions; verify agrees', () => {
  const plan = core.spanPlan(['lbt', 'l3t']);
  for (let i = 0; i < 8; i++) {
    const d = core.makeSpanDrill(null, null, null, plan, {}, lcg(8800 + 19 * i), FIN);
    if (!d || d.kind !== 'span' || d.start !== 'lbt' || d.metric !== null) return false;
    let st = E.solved();
    E.walkParsed(E.parseAlg(d.scramble), (m) => { st = E.move(st, m); });
    if (!E.eq(st, d.state) || !core.beforeLbtOK(st)) return false;
    // independent phase 1: replay every entry; collect optimal landings
    let L1 = Infinity;
    const lands = new Map();
    for (const en of FIN.lbt) {
      let post = null;
      try { post = E.applyParsed(E.parseAlg(en.text), E.copy(st), 'cif'); } catch (e) { continue; }
      const pk = E.stateKey(post);
      if (pk !== E.stateKey(E.solved()) && !indepCoset.has(pk)) continue;
      if (en.moves < L1) { L1 = en.moves; }
      if (!lands.has(pk) || en.moves < lands.get(pk)) lands.set(pk, en.moves);
    }
    if (d.breakdown[0] !== L1) return false;
    let v = Infinity;
    for (const [pk, mv] of lands) {
      if (mv !== L1) continue;
      const vv = pk === E.stateKey(E.solved()) ? 0 : core.l3tOptOf(FIN, indepCoset.get(pk), pk);
      if (vv != null && vv < v) v = vv;
    }
    if (!isFinite(v) || d.breakdown[1] !== v || d.optimal !== L1 + v) return false;
    if (!core.verifySpanDrill(null, null, null, d, FIN)) return false;
  }
  return true;
});
t('spanSolutions lbt+l3t: every line is one continuous proved text — parses, per-phase\n  floor split sums to the target, the LBT/L3T boundary state sits inside the coset,\n  ends solved (the seam is priced per phase, never merged)', () => {
  const plan = core.spanPlan(['lbt', 'l3t']);
  for (let i = 0; i < 8; i++) {
    const d = core.makeSpanDrill(null, null, null, plan, {}, lcg(9900 + 23 * i), FIN);
    if (!d) return false;
    const res = core.spanSolutions(null, null, null, d, 6, FIN);
    if (!res.lines.length) return false;
    for (const l of res.lines) {
      const p = E.parseAlg(l.text);
      if (!p) return false;
      if (l.split.reduce((a, b) => a + b, 0) !== d.optimal) return false;
      if (l.split.join() !== d.breakdown.join()) return false;
      const fired = [];
      E.walkParsed(p, (m) => fired.push(m));
      // walk prefixes until the state enters the coset (the LBT phase done),
      // then the whole text must end exactly solved
      let mid = E.copy(d.state);
      let enteredAt = -1;
      for (let j = 0; j < fired.length; j++) {
        mid = E.move(mid, fired[j]);
        if (enteredAt < 0 && indepCoset.has(E.stateKey(mid))) enteredAt = j + 1;
      }
      if (enteredAt < 0) return false;
      if (!E.eq(mid, E.solved())) return false;
    }
  }
  return true;
});
t('the FIN_CANON_WINDOW is sufficient: windowed chain minima equal an unwindowed\n  search over a seeded coset sample (cross-seam merges never beat the window)', () => {
  const rnd = lcg(87654321);
  let checked = 0;
  while (checked < 24) {
    const k = FIN.cosetKeys[(rnd() * FIN.cosetKeys.length) | 0];
    if (FIN.trivial.has(k)) continue;
    checked++;
    const s = FIN.coset.get(k).s;
    const a = core.l3tChainLines(FIN, s, k);
    const b = core.l3tChainLines(FIN, s, k, 99);
    const am = a.length ? a[0].moves : null, bm = b.length ? b[0].moves : null;
    if (am !== bm) return false;
  }
  return true;
});
t('the TCP-direct route is GATED on formed-modulo-view states: chain lines from\n  never-formed states are 1LP-routed only (no \"pairs formed\" label)', () => {
  const rnd = lcg(24681357);
  let formedSeen = 0, unformedSeen = 0;
  for (let i = 0; i < 400 && (formedSeen < 8 || unformedSeen < 8); i++) {
    const k = FIN.cosetKeys[(rnd() * FIN.cosetKeys.length) | 0];
    if (FIN.trivial.has(k)) continue;
    const s = FIN.coset.get(k).s;
    const lines = core.l3tChainLines(FIN, s, k);
    if (!lines.length) continue;
    if (FIN.formedish(s)) formedSeen++;
    else {
      unformedSeen++;
      if (lines.some((l) => /pairs formed/.test(l.label))) return false;
    }
  }
  return formedSeen >= 8 && unformedSeen >= 8;
});
t('finSpanSolutions: a show-capped listing reports capped (the reveal header shows\n  N+, never a truncated count as exact)', () => {
  const plan = core.spanPlan(['lbt', 'l3t']);
  for (let i = 0; i < 40; i++) {
    const d = core.makeSpanDrill(null, null, null, plan, {}, lcg(5000 + 17 * i), FIN);
    if (!d) return false;
    const big = core.spanSolutions(null, null, null, d, 60, FIN);
    if (big.lines.length <= 1) continue;
    const small = core.spanSolutions(null, null, null, d, 1, FIN);
    return small.lines.length === 1 && small.capped === true;
  }
  return false;                               // no multi-line drill found in 40 seeds
});
t('makeLbtDrill / makeL3tDrill: a stuck injected rng exhausts the caps and returns null', () =>
  core.makeLbtDrill(FIN, () => 0.99999) === null && core.makeL3tDrill(FIN, () => 0) === null);
t('verifyLbtDrill / verifyL3tDrill / lbt-span verify: tampering rejected', () => {
  const d1 = core.makeLbtDrill(FIN, lcg(31337));
  if (!core.verifyLbtDrill(FIN, d1)) return false;
  if (core.verifyLbtDrill(FIN, { ...d1, optimal: d1.optimal + 1 })) return false;
  if (core.verifyLbtDrill(FIN, { ...d1, scramble: d1.scramble + ' U' })) return false;
  if (core.verifyLbtDrill(FIN, { ...d1, state: E.move(E.copy(d1.state), 0) })) return false;
  if (core.verifyLbtDrill(FIN, { ...d1, mask: d1.mask.slice(1) })) return false;
  const d2 = core.makeL3tDrill(FIN, lcg(31338));
  if (!core.verifyL3tDrill(FIN, d2)) return false;
  if (core.verifyL3tDrill(FIN, { ...d2, optimal: d2.optimal + 1 })) return false;
  if (core.verifyL3tDrill(FIN, { ...d2, parts: { ...d2.parts, chain: d2.parts.chain + 1 } })) return false;
  const plan = core.spanPlan(['lbt', 'l3t']);
  const d3 = core.makeSpanDrill(null, null, null, plan, {}, lcg(31339), FIN);
  if (!core.verifySpanDrill(null, null, null, d3, FIN)) return false;
  if (core.verifySpanDrill(null, null, null, { ...d3, breakdown: [d3.breakdown[0] + 1, d3.breakdown[1] - 1] }, FIN)) return false;
  if (core.verifySpanDrill(null, null, null, { ...d3, optimal: d3.optimal + 1 }, FIN)) return false;
  return true;
});

// ================ every contiguous run (step trainers v6) ================
// The 12 selections the v4/v5 rules refused: fc-led runs past t2, and spans
// crossing the centers -> finish seam. The seam is bridged by the 'call'
// center goal (all three hexagons — the retired last-center edges residue
// fused into the center phase, same restricted regime), whose drift-0 states
// are exactly the before-LBT junction.

t("'call' goal: c23GoalOK call ⇔ beforeLbtOK — every LBT drill state satisfies call,\n  every unfinished c23 drill state does not, every call-optimal word lands before-LBT", () => {
  for (let i = 0; i < 4; i++) {
    const d = core.makeLbtDrill(FIN, lcg(60100 + 7 * i));
    if (!d || !core.c23GoalOK(d.state, 'call')) return false;
  }
  for (let i = 0; i < 3; i++) {
    const d = core.makeC23Drill(FT, CT, { mode: 'both' }, lcg(60200 + 11 * i));
    if (!d || core.c23GoalOK(d.stateM, 'call')) return false;
    const L = core.c23SearchLen(FT, CT, d.stateM, 'call');
    if (L == null || L < d.optimal) return false;       // call ⊇ c2 work
    const w = core.c23Enumerate(FT, CT, d.stateM, 'call', L, 1).words[0];
    if (!w) return false;
    let s = d.stateM;
    for (const m of w) s = E.move(s, m);
    if (!core.beforeLbtOK(s) || !core.c23GoalOK(s, 'call')) return false;
  }
  return true;
});
t("'call' optimal is exact: the heuristic-free restricted no-shorter proof agrees\n  (the same independent search the c1/c2 goals are pinned by)", () => {
  let checked = 0;
  for (let i = 0; i < 30 && checked < 3; i++) {
    const d = core.makeC23Drill(FT, CT, { mode: 'third' }, lcg(60300 + 13 * i));
    if (!d) return false;
    const L = core.c23SearchLen(FT, CT, d.stateM, 'call');
    if (L == null) return false;
    if (L > 7) continue;                                // keep the raw proof tractable
    if (!c23NoShorter(d.stateM, 'call', L)) return false;
    checked++;
  }
  return checked >= 3;
});
t("the fused-residue corollary holds live: from a c2-optimal endstate the remaining\n  call distance is always 0, 1 or 3 turns (the retired fourth-center measurement)", () => {
  let checked = 0;
  for (let i = 0; i < 20 && checked < 6; i++) {
    const d = core.makeC23Drill(FT, CT, { mode: 'third' }, lcg(60400 + 17 * i));
    if (!d) return false;
    const w = core.c23Enumerate(FT, CT, d.stateM, 'c2', d.optimal, 1).words[0];
    if (!w) continue;
    let s = d.stateM;
    for (const m of w) s = E.move(s, m);
    const r = core.c23SearchLen(FT, CT, s, 'call');
    if (![0, 1, 3].includes(r)) return false;
    if (r > 0 && r <= 4 && indepRestrictedLen(s, 'call', 4) !== r) return false;
    checked++;
  }
  return checked >= 6;
});

const V6_SPANS = [
  ['c3', 'lbt'], ['sc', 'c3', 'lbt'], ['c3', 'lbt', 'l3t'],
  ['t2', 'sc', 'c3', 'lbt'], ['sc', 'c3', 'lbt', 'l3t'],
  ['t1', 't2', 'sc', 'c3', 'lbt', 'l3t'],
];
t('v6 crossing spans: drill shape per start (sealed letters, sc/c3 presolves), start\n  conditions, breakdown = one part per phase summing to the target, mask = show all,\n  verify agrees', () => {
  for (const steps of V6_SPANS) {
    const plan = core.spanPlan(steps);
    if (!plan.ok || plan.kind !== 'span') return false;
    for (let i = 0; i < 2; i++) {
      const d = core.makeSpanDrill(FC, FT, CT, plan, {}, lcg(61000 + 37 * i + 7 * steps.length), FIN);
      if (!d || d.kind !== 'span' || d.spanKey !== plan.key) return false;
      const toks = d.scramble.split(/\s+/).filter(Boolean);
      if (!toks.every((x) => F2T_TOK.test(x))) return false;
      for (let j = 1; j < toks.length; j++)
        if (toks[j].replace("'", '') === toks[j - 1].replace("'", '')) return false;
      const st = E.applyParsed(E.parseAlg(d.scramble), E.solved());
      if (!E.eq(st, d.state) || !f2tWhiteHomePhys(st)) return false;
      const sM = conjM(st);
      if (plan.start === 'sc' || plan.start === 'c3') {
        if (!core.f2tGoalOK(sM, 'pair') || d.presolved !== 0) return false;
        const formed = ['L', 'R', 'B'].filter((f) => {
          const fi = E.FIDX[f];
          return sM.ctr[3 * fi] === fi && sM.ctr[3 * fi + 1] === fi && sM.ctr[3 * fi + 2] === fi &&
            E.EDGES.every((q, e) => (q[2] !== fi && q[3] !== fi) || sM.ep[e] === e);
        });
        if (plan.start === 'c3') {
          if (formed.length !== 1 || formed[0] !== d.presolvedCtr) return false;
        } else if (formed.length !== 0 || d.presolvedCtr !== null) return false;
      } else if (plan.start === 't2') {
        if (![3, 5].includes(d.presolved)) return false;
      }
      if (d.breakdown.length !== plan.phases.length) return false;
      if (d.breakdown.reduce((a, b) => a + b, 0) !== d.optimal || d.optimal < 1) return false;
      if (d.mask.length !== 0) return false;             // finish spans show everything
      if (!core.verifySpanDrill(FC, FT, CT, d, FIN)) return false;
    }
  }
  return true;
});
t('v6 crossing target is exact: an independent phased brute force across the seam —\n  raw restricted DFS to ALL call-optimal endstates, every sheet entry replayed at\n  each, best L3T continuation re-derived — reproduces the c3+lbt(+l3t) target', () => {
  const SOLVED_KEY = E.stateKey(E.solved());
  const lbtValOf = (sM) => {                    // independent LBT step value + landings
    if (sM.cp[4] === 4 && sM.co[4] === 0 && sM.ctr[4] === 1 && sM.ctr[10] === 3) {
      const k = E.stateKey(sM);
      return (k === SOLVED_KEY || indepCoset.has(k)) ? { v: 0, lands: [k] } : null;
    }
    let v = Infinity;
    const lands = [];
    for (const en of FIN.lbt) {
      let post = null;
      try { post = E.applyParsed(E.parseAlg(en.text), E.copy(sM), 'cif'); } catch (e) { continue; }
      const pk = E.stateKey(post);
      if (pk !== SOLVED_KEY && !indepCoset.has(pk)) continue;
      if (en.moves < v) { v = en.moves; lands.length = 0; }
      if (en.moves === v) lands.push(pk);
    }
    return isFinite(v) ? { v, lands } : null;
  };
  for (const steps of [['c3', 'lbt'], ['c3', 'lbt', 'l3t']]) {
    let checked = 0;
    for (let i = 0; i < 40 && checked < 2; i++) {
      const plan = core.spanPlan(steps);
      const d = core.makeSpanDrill(FC, FT, CT, plan, {}, lcg(62000 + 41 * i + steps.length), FIN);
      if (!d || d.breakdown[0] > 6) continue;            // keep the raw DFS tractable
      const sM0 = conjM(d.state);
      const L1 = indepRestrictedLen(sM0, 'call', 8);
      if (L1 !== d.breakdown[0]) return false;
      // ALL call-optimal endstates by raw restricted DFS (canonical
      // opposite-face suppression only — endstate-complete, no tables)
      const ends = new Map();
      const rec = (s, b, g, lastFace) => {
        if (g === L1) { if (core.c23GoalOK(s, 'call')) ends.set(E.stateKey(s), s); return; }
        for (const [m, db] of CT.RES.MOVES[b]) {
          const f = m >> 1;
          if (f === lastFace || (E.OPPF[f] === lastFace && f > lastFace)) continue;
          rec(E.move(s, m), (b + db) % 3, g + 1, f);
        }
      };
      rec(sM0, 0, 0, -1);
      if (!ends.size) return false;
      let best = Infinity;
      for (const e of ends.values()) {
        const r = lbtValOf(e);
        if (!r) continue;
        if (steps.length === 2) { best = Math.min(best, L1 + r.v); continue; }
        for (const pk of r.lands) {
          const tail = pk === SOLVED_KEY ? 0 : core.l3tOptOf(FIN, indepCoset.get(pk), pk);
          if (tail != null) best = Math.min(best, L1 + r.v + tail);
        }
      }
      if (best !== d.optimal) return false;
      checked++;
    }
    if (checked < 2) return false;
  }
  return true;
});
t('v6 reveal lines: one continuous proved text per chain — split sums to the target,\n  the center segment keeps the block at D^b(home) per prefix and lands before-LBT,\n  the finish enters the coset and (with l3t) ends exactly solved', () => {
  for (const steps of [['t2', 'sc', 'c3', 'lbt'], ['sc', 'c3', 'lbt', 'l3t']]) {
    const plan = core.spanPlan(steps);
    for (let i = 0; i < 2; i++) {
      const d = core.makeSpanDrill(FC, FT, CT, plan, {}, lcg(63000 + 29 * i + steps.length), FIN);
      if (!d) return false;
      const res = core.spanSolutions(FC, FT, CT, d, 6, FIN);
      if (!res.lines.length || res.dropped !== 0) return false;
      for (const l of res.lines) {
        const parsed = E.parseAlg(l.text);
        if (!parsed) return false;
        if (l.split.length !== plan.phases.length) return false;
        if (l.split.reduce((a, b) => a + b, 0) !== d.optimal) return false;
        const fired = [];
        E.walkParsed(parsed, (m) => fired.push(m));
        // method-frame walk: move phases first (1 token = 1 native), then
        // the finish part (sheet texts, floor-priced — count unknown here)
        const nMovePhases = plan.phases.filter((p) => p.kind === 'tri' || p.kind === 'ctr').length;
        const nMoves = l.split.slice(0, nMovePhases).reduce((a, b) => a + b, 0);
        let sP = conjM(d.state), bP = 0, k = 0;
        const triLen = plan.phases[0].kind === 'tri' ? l.split[0] : 0;
        for (; k < nMoves; k++) {
          const mM = 2 * E.faceImg(F2T_ENV.M, fired[k] >> 1) + (fired[k] & 1);
          sP = E.move(sP, mM);
          if (k >= triLen) {
            bP = (bP + bShift(mM)) % 3;
            if (!blockIntact(sP, bP)) return false;
          } else if (k === triLen - 1 && !core.f2tGoalOK(sP, 'pair')) return false;
        }
        if (bP !== 0 || !core.beforeLbtOK(sP)) return false;
        for (; k < fired.length; k++) {
          const mM = 2 * E.faceImg(F2T_ENV.M, fired[k] >> 1) + (fired[k] & 1);
          sP = E.move(sP, mM);
        }
        const endKey = E.stateKey(sP);
        if (steps.includes('l3t')) { if (endKey !== E.stateKey(E.solved())) return false; }
        else if (endKey !== E.stateKey(E.solved()) && !indepCoset.has(endKey)) return false;
      }
    }
  }
  return true;
});
const AUX = await T.buildF2TAux(E);
const FTX = { ...FT, aux: AUX };               // the fc-led crossing spans' fast path
t('v6 aux: the index-carrying sealed DFS is word-IDENTICAL to the full-state DFS\n  (same lengths, same harvested words in the same canonical order, per goal)', () => {
  for (const mode of ['first', 'second', 'both']) {
    for (let i = 0; i < 2; i++) {
      const d = core.makeF2tDrill(FT, { mode }, lcg(67000 + 1000 * i + mode.length));
      if (!d) return false;
      for (const goal of ['3', '5', 'either', 'pair']) {
        const a = core.f2tSearchLen(FT, d.stateM, goal);
        const b = core.f2tSearchLen(FTX, d.stateM, goal);
        if (a !== b) return false;
        if (a == null || a === 0) continue;
        const wa = core.f2tEnumerate(FT, d.stateM, goal, a, 256);
        const wb = core.f2tEnumerate(FTX, d.stateM, goal, a, 256);
        if (wa.capped !== wb.capped) return false;
        if (JSON.stringify(wa.words) !== JSON.stringify(wb.words)) return false;
      }
    }
  }
  return true;
});
t('v6 fc-led spans past t2: drill shape (30 natives, white displaced), breakdown per\n  phase, verify agrees, and every line re-enters through a landing view and meets\n  the center goal', () => {
  const plan = core.spanPlan(['fc', 't1', 't2', 'sc']);
  if (!plan.ok || plan.kind !== 'span' || plan.phases.map((p) => p.kind).join() !== 'fc,tri,ctr') return false;
  if (plan.phases[2].goal !== 'c1') return false;        // sc alone: any ONE hexagon
  for (let i = 0; i < 2; i++) {
    const d = core.makeSpanDrill(FC, FTX, CT, plan, { metric: 'token' }, lcg(64000 + 31 * i), FIN);
    if (!d) return false;
    const toks = d.scramble.split(/\s+/).filter(Boolean);
    if (toks.length !== 30 || !toks.every((x) => SPAN_NATIVE_TOK.test(x))) return false;
    const st = E.applyParsed(E.parseAlg(d.scramble), E.solved());
    if (!E.eq(st, d.state) || core.fcStateOK(FC, st)) return false;
    if (d.breakdown.length !== 3) return false;
    if (d.breakdown.reduce((a, b) => a + b, 0) !== d.optimal || d.optimal < 1) return false;
    if (!core.verifySpanDrill(FC, FTX, CT, d, FIN)) return false;
    // the aux fast path and the classic full-state path certify the same
    // drill (one seed — the classic DP costs ~25 s per run)
    if (i === 0 && !core.verifySpanDrill(FC, FT, CT, d, FIN)) return false;
    const res = core.spanSolutions(FC, FTX, CT, d, 4, FIN);
    if (!res.lines.length || res.dropped !== 0) return false;
    for (const l of res.lines) {
      const parsed = E.parseAlg(l.text);
      if (!parsed || E.countMoves(parsed) !== d.optimal) return false;
      if (l.split.reduce((a, b) => a + b, 0) !== d.optimal) return false;
      const stF = E.applyParsed(parsed, d.state);
      if (!core.fcStateOK(FC, stF)) return false;
      const views = SPANV.viewsOf(stF);
      if (!views || !views.some((v) => core.c23GoalOK(v.sM, 'c1') &&
        core.f2tGoalOK(v.sM, 'pair'))) return false;
      if (!l.centers || l.centers.length < 1) return false;
    }
  }
  return true;
});
t('v6: a 0-turn LBT phase is honest — an edges-home coset state IS the L3T stage\n  (slot solved by the coset construction) and lbtPhaseOf prices the step at 0 with\n  the state itself as the landing; slot-unsolved junctions always cost ≥ 1', () => {
  let solved0 = 0;
  const rnd = lcg(65000);
  for (let i = 0; i < 200 && solved0 < 5; i++) {
    const k = FIN.cosetKeys[(rnd() * FIN.cosetKeys.length) | 0];
    const s = FIN.coset.get(k).s;
    if (!core.beforeLbtOK(s)) continue;                  // edges-home coset states only
    if (!(s.cp[4] === 4 && s.co[4] === 0 && s.ctr[4] === 1 && s.ctr[10] === 3)) return false;
    const r = core.lbtPhaseOf(FIN, s);
    if (!r || r.v !== 0 || r.opt !== null) return false;
    solved0++;
  }
  if (solved0 < 5) return false;
  for (let i = 0; i < 3; i++) {                          // slot unsolved: value ≥ 1
    const d = core.makeLbtDrill(FIN, lcg(65500 + 3 * i));
    const r = d && core.lbtPhaseOf(FIN, d.state);
    if (!r || r.v < 1 || !r.opt.length) return false;
  }
  return true;
});
t('v6 tamper rejection: a crossing-span drill rejects a changed state, optimal,\n  breakdown, mask, presolved center, or step list', () => {
  const plan = core.spanPlan(['c3', 'lbt']);
  let d = null;
  for (let i = 0; i < 6 && !d; i++)
    d = core.makeSpanDrill(FC, FT, CT, plan, {}, lcg(66000 + i), FIN);
  if (!d || !core.verifySpanDrill(FC, FT, CT, d, FIN)) return false;
  return !core.verifySpanDrill(FC, FT, CT, { ...d, state: E.move(d.state, 2 * E.FIDX.R) }, FIN) &&
    !core.verifySpanDrill(FC, FT, CT, { ...d, optimal: d.optimal + 1 }, FIN) &&
    !core.verifySpanDrill(FC, FT, CT, { ...d, breakdown: [d.optimal] }, FIN) &&
    !core.verifySpanDrill(FC, FT, CT, { ...d, mask: [0] }, FIN) &&
    !core.verifySpanDrill(FC, FT, CT, { ...d, presolvedCtr: d.presolvedCtr === 'L' ? 'R' : 'L' }, FIN) &&
    !core.verifySpanDrill(FC, FT, CT, { ...d, steps: ['sc', 'c3', 'lbt'], spanKey: 'sc+c3+lbt' }, FIN);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
