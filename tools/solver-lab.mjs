/* Pyraminx.net — solver tuning lab (dev scratch, not shipped).
 *
 * Runs js/solver-core.js on real scrambles exactly as solver.html does (same
 * dist table, rotations, defaults) and prints the ranked solutions so we can
 * judge whether the #1 result is actually the best solve. Lets us A/B ergonomic
 * weights / slack / caps without a browser.
 *
 *   node tools/solver-lab.mjs                      # default scramble set, default tuning
 *   node tools/solver-lab.mjs "R U' B L' U R' B'"  # one scramble
 *   node tools/solver-lab.mjs --top 6              # show more per length
 *   node tools/solver-lab.mjs --w bColdExtra=2 --caps tl4eb=4,l5e=3   # override tuning
 *   node tools/solver-lab.mjs --scan 200           # tally stats over random scrambles
 *   node tools/solver-lab.mjs --duel 12 --w2 excursion=0.8   # blind A/B: pick the nicer solve
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { buildDist } from './lib/bfs-dist.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = {};
require(path.join(ROOT, 'js', 'engine.js'));
const E = globalThis.window.OOEngine;
require(path.join(ROOT, 'js', 'sheet.js'));
const S = globalThis.window.OOSheet || null;
require(path.join(ROOT, 'js', 'solver-core.js'));
const { makeSolverCore, METHOD_DEFS, METHOD_PRIORITY } = globalThis.window.OOSolverCore;

/* ---- the optimal-distance table (shared tools/lib builder) ---- */
const dist = buildDist(E);
const C = makeSolverCore(E, dist);
const { syms, rotBy } = C;   // built once inside the core
const rotations = C.buildRotations();

/* ---- defaults straight from solver.js UI ---- */
const DEFAULTS = {
  methods: { l4e: true, ml4e: true, l5e: true, tl4eb: true, psl4e: false, psml4e: false },
  caps: { l4e: 7, ml4e: 7, tl4eb: 6, l5e: 4, psl4e: 5, psml4e: 5 },
  offsetsText: 'L, R',
  slack: 0,
  maxCancel: 2,
  weights: {},
};

// labels from the core's method registry (single source with solver.js)
const METHOD_LABEL = Object.fromEntries(Object.entries(METHOD_DEFS).map(([id, d]) => [id, d.name]));

function caseNameOf(jstate) {
  if (!S || !jstate) return null;
  try { return S.nameForState(jstate); } catch (e) { return null; }
}

function runOne(scramble, tuning, top) {
  const parsed = E.parseAlg(scramble);
  if (!parsed) { console.log(`!! could not parse: ${scramble}`); return; }
  const state = E.applyParsed(parsed, E.solved(), syms, rotBy);
  const dopt = dist[E.idx(state)];
  console.log('\n' + '='.repeat(78));
  console.log(`SCRAMBLE  ${scramble}`);
  console.log(`optimal   ${dopt} moves`);
  if (dopt === 0) { console.log('(already solved)'); return; }

  const offsets = (tuning.methods.psl4e || tuning.methods.psml4e)
    ? tuning.offsetsText.split(',').map(x => x.trim()).filter(Boolean).map(C.parseOffset).filter(Boolean)
    : [];
  const lengths = [dopt, dopt + 1].filter(L => L <= 11);
  const t0 = process.hrtime.bigint();
  const res = C.search(state, {
    methods: tuning.methods, caps: tuning.caps, offsets,
    slack: tuning.slack, maxCancel: tuning.maxCancel,
    lengths, rotations,
    budget: Math.max(...lengths) >= 10 ? 2.5e7 : 8e6,
    weights: tuning.weights,
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  // overall best across all requested lengths (the "single best" the UI will surface)
  let best = null;
  for (const L of lengths) for (const it of (res.byLength[L] || [])) if (!best || it.score < best.score) best = { ...it, L };
  if (best) {
    const blen = best.L === dopt ? 'optimal' : 'optimal+1';
    console.log(`\n  >> OVERALL BEST  score ${best.score}  (${best.L} moves, ${blen})  ${best.display}`);
  }

  for (const L of lengths) {
    const items = res.byLength[L] || [];
    const tag = L === dopt ? ' (optimal)' : ' (optimal+1)';
    console.log(`\n  ${L} moves${tag} — ${items.length} solution(s)`);
    items.slice(0, top).forEach((it, i) => {
      const badges = Object.entries(it.methods)
        .map(([id, m]) => `${METHOD_LABEL[id]} ${m.v}+${m.fin}${m.cancel ? '−' + m.cancel : ''}`)
        .join(', ');
      // representative decomposition (mirrors solver.js primaryMethod: shortest V, then priority)
      const [pid, pm] = Object.entries(it.methods).sort(
        (a, b) => a[1].v - b[1].v || METHOD_PRIORITY.indexOf(a[0]) - METHOD_PRIORITY.indexOf(b[0]))[0];
      const cname = caseNameOf(pm.jstate);
      const recon = `${pm.vmoves || '—'}  |  ${pm.amoves || '—'}${cname ? '  (' + cname + ')' : ''}`;
      console.log(`    #${i + 1}  score ${String(it.score).padEnd(6)} ${it.display}`);
      console.log(`         [${badges}]`);
      console.log(`         V: ${recon}`);
    });
    if (!items.length) console.log('    (none)');
  }
  console.log(`\n  search ${ms.toFixed(0)}ms  work=${res.work}${res.truncated ? '  TRUNCATED' : ''}`);
}

/* ---- scramble set (fixed for reproducible A/B) ---- */
const SAMPLES = [
  "R U' B L' U R' B'",
  "U L' R B U' L B'",
  "L R' U B' L' U' R B",
  "R' L U' B R B' U L'",
  "B U L R' U' B' L R",
  "U' R B L U R' B' L'",
  "L U B' R' U' L' B R'",
  "R B U L' B' R' U' L",
  "B' R U' L R' B U L'",
  "U L R B U' R' B' L'",
];

/* ---- args ---- */
const argv = process.argv.slice(2);
let top = 5;
const ti = argv.indexOf('--top');
if (ti >= 0) { top = +argv[ti + 1]; argv.splice(ti, 2); }
// key=val[,key=val] parser that refuses unknown keys (catches pre-rework weight names)
const parseKVs = (str, valid, what) => {
  const out = {};
  for (const kv of String(str).split(',')) {
    const [k, v] = kv.split('=');
    if (!(k in valid)) { console.error(`unknown ${what} '${k}' (valid: ${Object.keys(valid).join(' ')})`); process.exit(1); }
    out[k] = +v;
  }
  return out;
};
// --w wide=2,excursion=0.6  -> override ergonomic weights for A/B testing
const wi = argv.indexOf('--w');
if (wi >= 0) { Object.assign(DEFAULTS.weights, parseKVs(argv[wi + 1], C.ERGO_DEFAULTS, 'weight')); argv.splice(wi, 2); }
// --caps tl4eb=4,l5e=3  -> override first-step caps
const ci = argv.indexOf('--caps');
if (ci >= 0) { Object.assign(DEFAULTS.caps, parseKVs(argv[ci + 1], DEFAULTS.caps, 'cap')); argv.splice(ci, 2); }
// --scan N: generate N random scrambles, tally how often +1 wins / wides or cold B's
// appear in #1 / truncation, plus the #1-vs-#2 score margin (ranking sharpness)
const si = argv.indexOf('--scan');
if (si >= 0) {
  const N = +argv[si + 1] || 200;
  let plus1 = 0, wideTop = 0, coldTop = 0, trunc = 0, noSol = 0, maxMs = 0;
  const MOVES = E.MOVES;
  const plus1ex = [];
  const margins = [];
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let n = 0; n < N; n++) {
    const st = E.solved();
    const moves = [];
    for (let k = 0; k < 12; k++) { const m = Math.floor(rnd() * 8); moves.push(MOVES[m]); E.applyMoveIdx(st, m); }
    const dopt = dist[E.idx(st)];
    if (dopt === 0) continue;
    const lengths = [dopt, dopt + 1].filter(L => L <= 11);
    const t0 = process.hrtime.bigint();
    const res = C.search(st, { methods: DEFAULTS.methods, caps: DEFAULTS.caps, offsets: [],
      slack: DEFAULTS.slack, maxCancel: DEFAULTS.maxCancel, lengths, rotations,
      budget: Math.max(...lengths) >= 10 ? 2.5e7 : 8e6, weights: DEFAULTS.weights });
    maxMs = Math.max(maxMs, Number(process.hrtime.bigint() - t0) / 1e6);
    if (res.truncated) trunc++;
    let best = null, bestL = null;
    const scores = [];
    for (const L of lengths) for (const it of (res.byLength[L] || [])) {
      scores.push(it.score);
      if (!best || it.score < best.score) { best = it; bestL = L; }
    }
    if (!best) { noSol++; continue; }
    scores.sort((a, b) => a - b);
    if (scores.length > 1) margins.push(+(scores[1] - scores[0]).toFixed(2));
    if (bestL === dopt + 1) {
      plus1++;
      if (plus1ex.length < 3) {
        const bestOpt = (res.byLength[dopt] || [])[0];
        plus1ex.push({ scr: moves.join(' '), dopt, best, bestOpt });
      }
    }
    if (/[RL]w/.test(best.display)) wideTop++;
    const bd = C.ergoScore(best.exec, best.prefix, DEFAULTS.weights, true).breakdown;
    if (bd.steps.some(s => s.parts.some(p => p.label === 'B cold'))) coldTop++;
  }
  const med = margins.slice().sort((a, b) => a - b)[(margins.length - 1) >> 1];
  console.log(`\nscan ${N} random scrambles:`);
  console.log(`  best is optimal+1:  ${plus1} (${(100 * plus1 / N).toFixed(1)}%)`);
  console.log(`  wide move in best:  ${wideTop} (${(100 * wideTop / N).toFixed(1)}%)`);
  console.log(`  cold B in best:     ${coldTop} (${(100 * coldTop / N).toFixed(1)}%)`);
  console.log(`  #1 vs #2 margin:    median ${med}, <=0.25 in ${(100 * margins.filter(m => m <= 0.25).length / margins.length).toFixed(0)}%`);
  console.log(`  truncated:          ${trunc}`);
  console.log(`  no solution found:  ${noSol}`);
  console.log(`  slowest search:     ${maxMs.toFixed(0)}ms`);
  for (const ex of plus1ex) {
    console.log(`\n  optimal+1 wins:  ${ex.scr}  (optimal ${ex.dopt})`);
    if (ex.bestOpt) console.log(`    best optimal:    score ${ex.bestOpt.score}  ${ex.bestOpt.display}`);
    console.log(`    best overall:    score ${ex.best.score}  ${ex.best.display}  (+1)`);
  }
  process.exit(0);
}

// --duel N --w2 key=val[,key=val]: blind pairwise calibration. Finds scrambles where
// the base tuning (--w) and a challenger (--w2, applied over the base) disagree on the
// #1 solution, shows both picks unlabeled, and tallies which tuning matched your answers.
const di = argv.indexOf('--duel');
if (di >= 0) {
  const N = +argv[di + 1] || 12;
  argv.splice(di, 2);
  const w2i = argv.indexOf('--w2');
  if (w2i < 0) { console.error('--duel needs --w2 key=val[,key=val] (challenger weights, applied over the base --w)'); process.exit(1); }
  const W1 = { ...DEFAULTS.weights };
  const W2 = Object.assign({}, W1, parseKVs(argv[w2i + 1], C.ERGO_DEFAULTS, 'weight'));
  argv.splice(w2i, 2);
  const keyOf = it => it.prefix + '|' + it.exec.join(',');
  const pickTop = (items, w) => {
    let best = null;
    for (const it of items) {
      const sc = C.ergoScore(it.exec, it.prefix, w);
      const cand = { it, score: sc.score, display: (it.prefix ? it.prefix + ' ' : '') + sc.tokens.join(' ') };
      if (!best || cand.score < best.score - 1e-9 ||
        (Math.abs(cand.score - best.score) < 1e-9 && keyOf(it) < keyOf(best.it))) best = cand;
    }
    return best;
  };
  let seed = 777777;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const duels = [];
  for (let tries = 0; duels.length < N && tries < N * 60; tries++) {
    const st = E.solved();
    const moves = [];
    for (let k = 0; k < 12; k++) { const m = Math.floor(rnd() * 8); moves.push(E.MOVES[m]); E.applyMoveIdx(st, m); }
    const dopt = dist[E.idx(st)];
    if (dopt === 0) continue;
    const lengths = [dopt, dopt + 1].filter(L => L <= 11);
    const res = C.search(st, { methods: DEFAULTS.methods, caps: DEFAULTS.caps, offsets: [],
      slack: DEFAULTS.slack, maxCancel: DEFAULTS.maxCancel, lengths, rotations,
      budget: Math.max(...lengths) >= 10 ? 2.5e7 : 8e6, weights: W1 });
    const items = [];
    for (const L of lengths) for (const it of (res.byLength[L] || [])) items.push(it);
    if (items.length < 2) continue;
    const a = pickTop(items, W1), b = pickTop(items, W2);
    if (!a || !b || keyOf(a.it) === keyOf(b.it)) continue;
    duels.push({ scr: moves.join(' '), dopt, a, b, swap: rnd() < 0.5 });
  }
  if (!duels.length) { console.log('no disagreements found — these tunings rank identically on this sample'); process.exit(0); }
  const W1eff = Object.assign({}, C.ERGO_DEFAULTS, W1), W2eff = Object.assign({}, C.ERGO_DEFAULTS, W2);
  const diffKeys = Object.keys(W2eff).filter(k => W1eff[k] !== W2eff[k]);
  console.log(`\ndueling: ${diffKeys.map(k => `${k} ${W1eff[k]} vs ${W2eff[k]}`).join(', ')}`);
  console.log(`${duels.length} disagreement(s) found. For each, answer with the solution you would rather turn.\n`);
  const isTTY = process.stdin.isTTY;
  const rl = isTTY ? (await import('node:readline/promises')).createInterface({ input: process.stdin, output: process.stdout }) : null;
  let s1 = 0, s2 = 0, sk = 0;
  for (let i = 0; i < duels.length; i++) {
    const d = duels[i];
    const [first, second] = d.swap ? [d.b, d.a] : [d.a, d.b];
    console.log(`duel ${i + 1}/${duels.length}   ${d.scr}   (optimal ${d.dopt})`);
    console.log(`  [1] ${first.display}`);
    console.log(`  [2] ${second.display}`);
    if (!rl) { console.log(''); continue; }
    let ans;
    for (;;) {
      ans = (await rl.question('  nicer to turn? 1/2 (s skip, q quit): ')).trim().toLowerCase();
      if (['1', '2', 's', 'q'].includes(ans)) break;
    }
    if (ans === 'q') break;
    if (ans === 's') { sk++; console.log(''); continue; }
    const pickedBase = (ans === '1') !== d.swap;
    if (pickedBase) s1++; else s2++;
    console.log(`  -> the ${pickedBase ? 'base' : 'challenger'} tuning's pick\n`);
  }
  if (rl) rl.close();
  if (!isTTY) console.log('(not a TTY: pairs listed without prompting — run in a terminal to answer)');
  if (s1 + s2) {
    console.log(`\nverdict: base ${s1} — challenger ${s2}${sk ? ` (${sk} skipped)` : ''}`);
    console.log(s2 > s1 ? 'adopt the challenger values' : s1 > s2 ? 'keep the base values' : 'tied — run more duels');
  }
  process.exit(0);
}
const scrambles = argv.length ? argv : SAMPLES;

const effW = Object.assign({}, C.ERGO_DEFAULTS, DEFAULTS.weights);
console.log(`tuning: slack=${DEFAULTS.slack} maxCancel=${DEFAULTS.maxCancel} caps=${JSON.stringify(DEFAULTS.caps)}`);
console.log(`weights: ${Object.entries(effW).map(([k, v]) => k + '=' + v).join(' ')}`);
if (Object.keys(DEFAULTS.weights).length) console.log(`  overrides: ${JSON.stringify(DEFAULTS.weights)}`);
for (const scr of scrambles) runOne(scr, DEFAULTS, top);
