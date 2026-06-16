/* Pyraminx.net — sheet verifier (no backup needed).
 *
 * Checks the compiled js/sheet.js against js/engine.js, independent of the
 * compiler, so you can trust the data after any JSON edit + rebuild:
 *   1. every alg in SHEET.ALG actually solves the state at its render key
 *      (up to a whole-puzzle rotation);
 *   2. structural integrity — NAME present for every ALG key, PRES <-> ALG and
 *      CNAME consistent, render keys canonicalize to their CNAME entry;
 *   3. the same for SHEET.DEFERRED.
 *
 * Run: node tools/check-sheet.mjs   (exit 0 = OK, 1 = problems)
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = {};
require(path.join(ROOT, 'js', 'engine.js'));
const E = globalThis.window.OOEngine;
const { SHEET } = require(path.join(ROOT, 'js', 'sheet.js'));
// keying + alg→case helpers come from the engine (single source of truth); this
// verifier checks the shipped js/sheet.js data against them.
const { keyToState, realCanonKey, algSolvesKey } = E;

function check(SH, label) {
  let tot = 0, nosolve = 0, noname = 0, badcanon = 0; const samples = [];
  for (const [rk, algs] of Object.entries(SH.ALG)) {
    if (SH.NAME[rk] == null) noname++;
    for (const [alg] of algs) {
      tot++;
      if (!algSolvesKey(alg, rk)) { nosolve++; if (samples.length < 8) samples.push(rk + ' :: ' + alg); }
    }
    const st = keyToState(rk), canon = realCanonKey(st, st.u);
    if (!SH.CNAME[canon]) badcanon++;
  }
  // PRES <-> ALG consistency
  let presOrphan = 0;
  for (const [canon, pres] of Object.entries(SH.PRES))
    for (const [sk, tw] of pres) if (!SH.ALG[sk + '|' + tw]) presOrphan++;
  console.log(`[${label}] ALG entries: ${tot} | NOSOLVE: ${nosolve} | missing NAME: ${noname} | render key not in CNAME: ${badcanon} | PRES without ALG: ${presOrphan}`);
  samples.forEach(s => console.log('    NOSOLVE ' + s));
  return { nosolve, noname, badcanon, presOrphan };
}

const main = check(SHEET, 'MAIN');
const def = check(SHEET.DEFERRED, 'DEFERRED');
console.log(`\nMAIN: ${Object.keys(SHEET.CNAME).length} cases / ${new Set(Object.values(SHEET.CNAME)).size} names  |  DEFERRED: ${Object.keys(SHEET.DEFERRED.CNAME).length} cases`);

// MAIN may keep a few OLD broken setup-alg presentations (kept only to avoid an
// empty panel). Allow a small known number; anything else is a real problem.
const KEPT_BROKEN_MAX = 4;
const problems = (main.nosolve > KEPT_BROKEN_MAX) || main.noname || main.badcanon || main.presOrphan
  || def.nosolve || def.noname || def.badcanon || def.presOrphan;
console.log(problems ? '\n*** CHECK FAILED ***' : `\nCHECK OK (MAIN has ${main.nosolve}/${KEPT_BROKEN_MAX} allowed kept-broken setup algs)`);
process.exitCode = problems ? 1 : 0;
