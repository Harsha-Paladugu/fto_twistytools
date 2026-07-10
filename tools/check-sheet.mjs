/* Skewbiks.com â€” sheet verifier.
 *
 * Checks the compiled js/sheet.js against js/engine.js, independent of the
 * compiler, so you can trust the data after any JSON edit + rebuild:
 *   1. every alg in SHEET.ALG actually solves the state at its render key;
 *   2. structural integrity â€” NAME present for every ALG key, PRES <-> ALG and
 *      CNAME consistent, render keys canonicalize to their CNAME entry.
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
// keying + algâ†’case helpers come from the engine (single source of truth); this
// verifier checks the shipped js/sheet.js data against them. NOTE: it therefore
// shares any engine-level keying bug â€” it is independent of the COMPILER only.
const { keyToState, realCanonKey, algSolvesKey } = E;
// Explicit allowlist of known-broken algs (parse fine but don't solve their
// render key), kept only to avoid empty panels. The shipped SHEET.ALG may
// contain exactly these and no other non-solving algs.
const BROKEN = require(path.join(ROOT, 'data', 'broken-algs.json'));
const BROKEN_KEYS = new Set(BROKEN.map(b => b.renderKey + ' :: ' + b.algorithm));

const SOLVED_KEY = E.stateKey(E.solved());
let tot = 0, noname = 0, badcanon = 0, solvedCase = 0; const samples = [], nosolveKeys = [];
for (const [rk, algs] of Object.entries(SHEET.ALG)) {
  if (SHEET.NAME[rk] == null) noname++;
  if (rk === SOLVED_KEY) solvedCase++; // a "case" at the solved state is always bogus
  for (const [alg] of algs) {
    tot++;
    if (!algSolvesKey(alg, rk)) { nosolveKeys.push(rk + ' :: ' + alg); if (samples.length < 8) samples.push(rk + ' :: ' + alg); }
  }
  if (!SHEET.CNAME[realCanonKey(keyToState(rk))]) badcanon++;
}
// PRES <-> ALG consistency, both directions: every PRES renderKey has algs, every
// ALG renderKey is listed in some PRES, and every CNAME canon has a PRES entry.
let presOrphan = 0;
const presKeys = new Set();
for (const pres of Object.values(SHEET.PRES))
  for (const [rk] of pres) { presKeys.add(rk); if (!SHEET.ALG[rk]) presOrphan++; }
const algNoPres = Object.keys(SHEET.ALG).filter(rk => !presKeys.has(rk)).length;
const cnameNoPres = Object.keys(SHEET.CNAME).filter(c => !(SHEET.PRES[c] || []).length).length;
console.log(`ALG entries: ${tot} | NOSOLVE: ${nosolveKeys.length} | missing NAME: ${noname} | render key not in CNAME: ${badcanon}`);
console.log(`PRES without ALG: ${presOrphan} | ALG not in any PRES: ${algNoPres} | CNAME without PRES: ${cnameNoPres} | solved-state cases: ${solvedCase}`);
samples.forEach(s => console.log('    NOSOLVE ' + s));
console.log(`\n${Object.keys(SHEET.CNAME).length} cases / ${new Set(Object.values(SHEET.CNAME)).size} names`);

// SHEET may keep the explicitly-allowlisted broken presentations
// (data/broken-algs.json) and NOTHING else that fails to solve. A non-solving
// alg not on the allowlist is a real problem; an allowlist entry that no longer
// ships is just a stale-manifest note (harmless â€” fewer broken algs).
const unexpectedBroken = nosolveKeys.filter(k => !BROKEN_KEYS.has(k));
const staleBroken = [...BROKEN_KEYS].filter(k => !nosolveKeys.includes(k));
unexpectedBroken.forEach(k => console.error('    UNEXPECTED BROKEN ' + k));
staleBroken.forEach(k => console.warn('    STALE allowlist entry (no longer present): ' + k));
const problems = unexpectedBroken.length || noname || badcanon || presOrphan || algNoPres || cnameNoPres || solvedCase;
console.log(problems ? '\n*** CHECK FAILED ***' : `\nCHECK OK (${nosolveKeys.length} allowlisted kept-broken algs; ${BROKEN_KEYS.size} in manifest)`);
process.exitCode = problems ? 1 : 0;
