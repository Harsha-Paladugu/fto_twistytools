/* fto.twistytools.com — solver lab (dev scratch, not shipped). M5.
 *
 * Runs js/solver-core.js on scrambles exactly as solver.html does (same
 * pruning tables, same alg data, same defaults) and prints the staged
 * Bencisco reconstructions — every emitted line already carries the core's
 * end-to-end applyParsed proof (search drops unproved lines and counts them
 * in verifyFailures, which this lab requires to be ZERO). The M5 exit gate:
 *
 *   node tools/solver-lab.mjs --scan 200      # >= 200 scrambles, 0 verify
 *                                             # failures, latency stats
 *
 *   node tools/solver-lab.mjs                 # demo: a few scrambles, lines shown
 *   node tools/solver-lab.mjs "R U' B L'"     # one scramble
 *   node tools/solver-lab.mjs --orient full   # force an orientation mode
 *   node tools/solver-lab.mjs --seed 7 --beam 6 --scan 50
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { readFileSync } from 'fs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = {};
require(path.join(ROOT, 'js', 'engine.js'));
require(path.join(ROOT, 'js', 'tables.js'));
require(path.join(ROOT, 'js', 'solver-core.js'));
const E = globalThis.window.OOEngine;
const T = globalThis.window.OOTables;
const { makeSolverCore } = globalThis.window.OOSolverCore;
const algData = JSON.parse(readFileSync(path.join(ROOT, 'data', 'fto_algs.json'), 'utf8'));

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const scanN = args.includes('--scan') ? Number(flag('scan', 200)) : 0;
const orient = flag('orient', 'auto');
const beam = Number(flag('beam', 0)) || undefined;
let seed = Number(flag('seed', 42));
const scrambleArg = args.find(a => !a.startsWith('--') && /[A-Z]/.test(a));
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };

console.log('building pruning tables…');
let t0 = Date.now();
const PDB = await T.buildPDBs(E);
console.log('  ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
const C = makeSolverCore(E, T, PDB, algData);
C.finishIndex();

function solveOne(scrText, show) {
  const parsed = E.parseAlg(scrText);
  if (!parsed) { console.log('unparseable scramble:', scrText); return null; }
  const s = E.applyParsed(parsed, E.solved());
  const t1 = Date.now();
  const res = C.search(s, { orient, beam });
  res.ms = Date.now() - t1;
  if (show) {
    console.log('\nscramble:', scrText);
    if (res.best == null) {
      console.log('  NO SOLUTION (failures ' + JSON.stringify(res.failures) +
        (res.truncated ? ', truncated' : '') + ')');
      return res;
    }
    const it = res.byLength[res.best][0];
    console.log('  best ' + res.best + ' moves, ' + Object.keys(res.byLength).length +
      ' movecounts, ' + res.ms + 'ms, orient ' + res.orientUsed +
      (res.truncated ? ', TRUNCATED' : ''));
    if (it.rotSpell) console.log('    rotate: ' + it.rotSpell);
    for (const seg of it.segs)
      console.log('    ' + seg.label.padEnd(26) + (seg.pre ? seg.pre + '  ' : '') + seg.text +
        (seg.caseName ? '   // ' + seg.subset + ' ' + seg.caseName : '') +
        (seg.note ? '  [' + seg.note + ']' : ''));
  }
  return res;
}

if (scrambleArg) {
  solveOne(scrambleArg, true);
} else if (scanN) {
  console.log('scanning ' + scanN + ' random scrambles (orient ' + orient + ')…');
  const totals = [], times = [];
  let solvedN = 0, verifyFailures = 0, truncated = 0;
  const ladder = {};
  const t2 = Date.now();
  for (let i = 0; i < scanN; i++) {
    const res = solveOne(E.randomScramble(30, rnd), false);
    if (!res) continue;
    times.push(res.ms);
    verifyFailures += res.verifyFailures;
    if (res.truncated) truncated++;
    if (res.best != null) {
      solvedN++;
      totals.push(res.best);
      ladder[res.orientUsed] = (ladder[res.orientUsed] || 0) + 1;
    } else {
      console.log('  UNSOLVED #' + i + ' (failures ' + JSON.stringify(res.failures) + ')');
    }
    if ((i + 1) % 25 === 0) console.log('  … ' + (i + 1) + '/' + scanN +
      ' (' + Math.round((Date.now() - t2) / 1000) + 's)');
  }
  totals.sort((a, b) => a - b);
  times.sort((a, b) => a - b);
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  console.log('\nsolved      ' + solvedN + '/' + scanN);
  console.log('verify fail ' + verifyFailures + '  (the gate: must be 0)');
  console.log('truncated   ' + truncated);
  console.log('totals      min ' + totals[0] + '  median ' + pct(totals, 0.5) +
    '  p90 ' + pct(totals, 0.9) + '  max ' + totals[totals.length - 1] +
    '  avg ' + (totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(1));
  console.log('time (ms)   median ' + pct(times, 0.5) + '  p90 ' + pct(times, 0.9) +
    '  max ' + times[times.length - 1]);
  console.log('orient use  ' + JSON.stringify(ladder));
  const ok = solvedN === scanN && verifyFailures === 0;
  console.log(ok ? '\nGATE PASS' : '\nGATE FAIL');
  process.exit(ok ? 0 : 1);
} else {
  for (let i = 0; i < 4; i++) solveOne(E.randomScramble(30, rnd), true);
}
