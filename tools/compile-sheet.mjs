/* Skewbiks.com â€” sheet compiler.
 *
 * Single source of truth: data/fto_algs.json (the authored algorithm list).
 * This regenerates the data block of js/sheet.js (SHEET = {ALG,NAME,CNAME,PRES})
 * so case names, recognition and algorithms all derive from the JSON, and
 * GENERATES data/classmap.json (canonical case key -> subset id) from subset
 * membership â€” the class map is build output, never hand-maintained.
 *
 * How a case is keyed (same coordinate system as js/engine.js):
 *   - parse the alg, apply it forward to solved, take the inverse permutation ->
 *     the exact state the alg solves (the "case state"). Self-validated: applying
 *     the alg to that state must return to solved.
 *   - render key  = stateKey(caseState)      (the full state â€” nothing is
 *     tip-fixable on a Skewb, so nothing is excluded)
 *   - canonical   = realCanonKey (folds the yÂ² view, the only tetrad-preserving
 *     U-face rotation; the four Front/Right/Back/Left presentations of a case
 *     pair at the DATA level via the JSON's `direction` field)
 *
 * Run: npm run build:sheet   (node tools/compile-sheet.mjs [--check])
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

globalThis.window = {};
require(path.join(ROOT, 'js', 'engine.js'));
const E = globalThis.window.OOEngine;
// Carry-forward baseline. Read from a COMMITTED snapshot (data/prior-sheet.json),
// not the compiler's own output (js/sheet.js), so the build is reproducible from
// version-controlled inputs alone. The Skewb sheet starts with an empty baseline
// ({} â€” the JSON is the sole authority from day one); re-baseline by overwriting
// prior-sheet.json with a freshly built sheet if the JSON ever stops reproducing
// shipped cases you want kept.
const OLD = Object.assign({ ALG: {}, NAME: {}, CNAME: {}, PRES: {} },
  require(path.join(ROOT, 'data', 'prior-sheet.json')));
const J = require(path.join(ROOT, 'data', 'fto_algs.json'));
// Explicit allowlist of known-broken algs (parse fine but don't solve their
// render key) carried forward only to avoid empty panels. Named manifest, not a
// count: a NEW broken alg that isn't listed here fails the build. Keys are
// `renderKey :: alg` on the SHIPPED (post-normAlg) notation; see check-sheet.mjs.
const BROKEN = require(path.join(ROOT, 'data', 'broken-algs.json'));
const BROKEN_KEYS = new Set(BROKEN.map(b => b.renderKey + ' :: ' + b.algorithm));

// keying + algâ†’case helpers are the engine's single source of truth.
const { stateKey, realCanonKey, caseStateOf, algSolvesKey } = E;

// ---- naming ----
const labelOf = (subsetKey, caseName) =>
  subsetKey === caseName ? caseName : subsetKey + ' · ' + caseName;
const casePart = (name) => String(name).split(' · ').slice(-1)[0];

// ---- pass 1: group every alg by the canonical key it actually solves ----
const byKey = {}; // canon -> { items:[{alg, renderKey, label, subset}] }
const report = { algs: 0, skipped: [], mislabels: 0, misfiled: [], renames: [], carried: 0, primaryNew: 0, keptBroken: 0 };
const SOLVED_KEY = stateKey(E.solved());
function collect(subsetKey, caseName, alg, dialect) {
  report.algs++;
  const dial = alg.notation || dialect;                 // per-alg override, else subset default
  const cs = caseStateOf(alg.alg, dial);
  if (!cs) { report.skipped.push(subsetKey + ' / ' + caseName + ': ' + alg.alg); return; }
  const renderKey = stateKey(cs);
  // An alg whose net effect is the identity (e.g. an empty/whitespace string, or
  // "R R'") would register a bogus case AT THE SOLVED STATE â€” and every
  // downstream check would pass (the identity trivially "solves" solved). Treat
  // it as a skip, which fails the build below.
  if (renderKey === SOLVED_KEY) { report.skipped.push(subsetKey + ' / ' + caseName + ': ' + JSON.stringify(alg.alg) + '  (identity â€” solves nothing)'); return; }
  const canon = realCanonKey(cs);
  const label = labelOf(subsetKey, caseName);
  (byKey[canon] = byKey[canon] || { items: [] }).items.push({ alg: alg.alg, renderKey, label, subset: subsetKey, dial });
}
for (const [sn, s] of Object.entries(J.subsets)) for (const c of s.cases) for (const a of c.algs) collect(sn, c.name, a, s.notation);
for (const [sn, s] of Object.entries(J.other_subsets || {})) for (const c of s.cases) for (const a of c.algs) collect(sn, c.name, a, s.notation);

// ---- pass 2: resolve names + emit ----
const MAIN = { ALG: {}, NAME: {}, CNAME: {}, PRES: {} };

function resolveName(canon, items) {
  const votes = {};
  for (const it of items) votes[it.label] = (votes[it.label] || 0) + 1;
  const top = Object.entries(votes).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
  const old = OLD.CNAME[canon];
  if (old) {
    if (votes[old]) return old;                          // old label still supported
    if (casePart(old) === casePart(top)) return old;     // same case, prefix-only change -> keep old
  }
  return top;
}
function emit(target, canon, items, name) {
  for (const it of items) {
    const arr = (target.ALG[it.renderKey] = target.ALG[it.renderKey] || []);
    if (!arr.some(r => r[0] === it.alg)) arr.push([it.alg, name, it.dial || null]);
    target.NAME[it.renderKey] = name;
  }
  target.CNAME[canon] = name;
  const pres = (target.PRES[canon] = target.PRES[canon] || []);
  for (const it of items) {
    if (!pres.some(p => p[0] === it.renderKey)) pres.push([it.renderKey, name]);
  }
}
for (const [canon, rec] of Object.entries(byKey)) {
  const name = resolveName(canon, rec.items);
  emit(MAIN, canon, rec.items, name);
  if (!OLD.CNAME[canon]) report.primaryNew++;
  else if (OLD.CNAME[canon] !== name) report.renames.push(canon + ' :: ' + OLD.CNAME[canon] + ' -> ' + name);
  // A real (non-tautological) check: an alg authored under one case but grouped
  // under a different CASE is a genuine mis-file â€” surface it. Advisory only;
  // it does not fail the build (the alg still ships under the case it solves).
  for (const it of rec.items) if (it.label !== name) {
    report.mislabels++;
    if (casePart(it.label) !== casePart(name)) report.misfiled.push(casePart(it.label) + ' â†’ ' + casePart(name) + '   [' + it.alg + ']');
  }
}

// ---- carry forward every old presentation/alg the JSON didn't reproduce, so
// MAIN.ALG stays a superset of OLD.ALG and coverage cannot regress. Carried
// algs adopt the canonical's resolved name; canonicals with no JSON alg keep
// their old name. Old algs that no longer solve their key are dropped unless a
// canonical would end up empty (then kept, gated by the broken-algs manifest).
for (const [canon, pres] of Object.entries(OLD.PRES)) {
  const hadPrimary = MAIN.CNAME[canon] != null;
  if (!hadPrimary) { MAIN.CNAME[canon] = OLD.CNAME[canon]; report.carried++; }
  const name = MAIN.CNAME[canon];
  const presArr = (MAIN.PRES[canon] = MAIN.PRES[canon] || []);
  for (const [rk] of pres) {
    const old = OLD.ALG[rk] || [];
    let keep = old.filter(([alg, , dial]) => algSolvesKey(alg, rk, dial || undefined));
    // If a canonical has NO JSON alg and NO valid old alg, keep OLD's entries
    // unfiltered (status quo) so the panel is never emptier than before.
    if (!keep.length && !hadPrimary && old.length) { keep = old; report.keptBroken += old.length; }
    if (!keep.length) continue;
    if (!presArr.some(q => q[0] === rk)) presArr.push([rk, name]);
    const arr = (MAIN.ALG[rk] = MAIN.ALG[rk] || []);
    for (const [alg, , dial] of keep) if (!arr.some(r => r[0] === alg)) arr.push([alg, name, dial || null]);
    MAIN.NAME[rk] = name;
  }
}

// ---- normalize displayed alg notation (engine.normAlg: R R -> R2) so the
// bundled sheet/trainer show the same clean notation as the algorithms page
// (which applies the same shared function to the JSON). Dedupe per key.
for (const rk of Object.keys(MAIN.ALG)) {
  const seen = new Set(), out = [];
  for (const [alg, name, dial] of MAIN.ALG[rk]) { const n = E.normAlg(alg); if (!seen.has(n)) { seen.add(n); out.push([n, name, dial || null]); } }
  MAIN.ALG[rk] = out;
}

// ---- class map: canonical case key -> subset id, generated from membership.
// The trainer's buildPools reads this (esbuild inlines it at bundle time).
const CLASSMAP = {};
const classmapConflicts = [];
for (const [canon, rec] of Object.entries(byKey)) {
  const subsets = [...new Set(rec.items.map(it => it.subset))];
  if (subsets.length > 1) classmapConflicts.push(canon + ' :: ' + subsets.join(' + '));
  CLASSMAP[canon] = subsets[0].toLowerCase();
}

// ---- self-check: every emitted MAIN alg solves its render key, except the
// explicitly-allowlisted broken algs in data/broken-algs.json. A failing alg
// that ISN'T allowlisted fails the build; an allowlisted entry that no longer
// fails is just a stale-manifest note.
const failingBroken = [];
for (const [rk, algs] of Object.entries(MAIN.ALG))
  for (const [alg, , dial] of algs) if (!algSolvesKey(alg, rk, dial || undefined)) failingBroken.push(rk + ' :: ' + alg);
const unexpectedBroken = failingBroken.filter(k => !BROKEN_KEYS.has(k));
const staleBroken = [...BROKEN_KEYS].filter(k => !failingBroken.includes(k));
const selfCheckOk = unexpectedBroken.length === 0;
if (!selfCheckOk) {
  console.error('SELF-CHECK FAILED: ' + unexpectedBroken.length + ' MAIN alg(s) do not solve their key and are not in data/broken-algs.json:');
  unexpectedBroken.forEach(k => console.error('   BROKEN ' + k));
  process.exitCode = 1;
}
if (staleBroken.length) {
  console.warn('NOTE: ' + staleBroken.length + ' allowlisted broken alg(s) no longer fail â€” data/broken-algs.json may be stale:');
  staleBroken.forEach(k => console.warn('   STALE ' + k));
}

// ---- remaining failure modes, evaluated BEFORE any write so a failed compile
// never overwrites the live data files.
// A NEW skipped (unparseable / identity) alg is silent data loss from the
// source of truth, so it fails the build. Add an entry to SKIP_ALLOW only to
// deliberately tolerate a known-bad alg.
const SKIP_ALLOW = new Set([]);
const unexpectedSkips = report.skipped.filter(s => !SKIP_ALLOW.has(s));
// coverage guarantee vs old: every old canonical must still be present.
const gaps = Object.keys(OLD.CNAME).filter(k => !MAIN.CNAME[k]);
const compileOk = selfCheckOk && !unexpectedSkips.length && !gaps.length;

// ---- write js/sheet.js (replace only the SHEET data line) + data/classmap.json.
// Never overwrite the live data files on a failed compile â€” only write output
// that passed EVERY check above. (--check is a dry run and never writes.)
const SHEET_PATH = path.join(ROOT, 'js', 'sheet.js');
const CLASSMAP_PATH = path.join(ROOT, 'data', 'classmap.json');
const check = process.argv.includes('--check');
// deterministic serialization: sort object keys recursively (arrays untouched)
// so the output is byte-stable across rebuilds regardless of insertion order.
const sortedStringify = (obj, space) => JSON.stringify(obj, (k, v) =>
  (v && typeof v === 'object' && !Array.isArray(v))
    ? Object.fromEntries(Object.keys(v).sort().map(kk => [kk, v[kk]]))
    : v, space);
if (!check && compileOk) {
  const src = fs.readFileSync(SHEET_PATH, 'utf8');
  const lines = src.split(/\r?\n/);
  const idx = lines.findIndex(l => /^\s*const SHEET\s*=\s*\{/.test(l));
  if (idx < 0) throw new Error('could not find SHEET declaration in js/sheet.js');
  lines[idx] = '  const SHEET = ' + sortedStringify(MAIN) + ';';
  fs.writeFileSync(SHEET_PATH, lines.join('\n'));
  fs.writeFileSync(CLASSMAP_PATH, sortedStringify(CLASSMAP, 2) + '\n');
} else if (!check) {
  console.error('NOT writing js/sheet.js or data/classmap.json â€” compile failed a check (see report below).');
}

// ---- report ----
const distinctMain = new Set(Object.values(MAIN.CNAME)).size;
console.log(check ? '== compile (--check, not written) ==' : compileOk ? '== compiled js/sheet.js + data/classmap.json ==' : '== COMPILE FAILED (nothing written) ==');
console.log('algs read:', report.algs, '| skipped (unparseable/identity):', report.skipped.length);
report.skipped.forEach(s => console.log('   SKIP', s));
if (unexpectedSkips.length) {
  process.exitCode = 1;
  console.error('*** ' + unexpectedSkips.length + ' UNEXPECTED skipped alg(s) â€” failing build (fix the JSON or extend parseAlg):');
  unexpectedSkips.forEach(s => console.error('   SKIP ' + s));
}
console.log('MAIN keys  ALG:', Object.keys(MAIN.ALG).length, 'NAME:', Object.keys(MAIN.NAME).length,
  'CNAME:', Object.keys(MAIN.CNAME).length, 'PRES:', Object.keys(MAIN.PRES).length, '| distinct names:', distinctMain);
console.log('classmap entries:', Object.keys(CLASSMAP).length,
  classmapConflicts.length ? '| MULTI-SUBSET canons (first wins): ' + classmapConflicts.length : '');
classmapConflicts.forEach(c => console.log('   MULTI ' + c));
console.log('carried forward (old keys w/o JSON primary):', report.carried);
console.log('primary-new cases:', report.primaryNew);
console.log('within-primary mislabeled algs (filed under the case they solve):', report.mislabels);
console.log('OLD broken algs kept (only where a canonical would otherwise be empty):', report.keptBroken);
// Advisory: algs authored under a different CASE than they actually solve. Not a
// build failure (the alg still ships under the case it geometrically solves), but
// each is a likely authoring typo worth a look.
if (report.misfiled.length) {
  console.log('\nADVISORY: ' + report.misfiled.length + ' alg(s) authored under a different case than they solve:');
  report.misfiled.forEach(s => console.log('   MISFILED ' + s));
}

console.log('\nself-check: every emitted alg solves its render key, except', failingBroken.length, 'allowlisted broken (' + BROKEN_KEYS.size + ' in manifest) ->',
  selfCheckOk ? 'PASS' : 'FAIL');
console.log('COVERAGE: old CNAME keys', Object.keys(OLD.CNAME).length, '| gaps in MAIN:', gaps.length,
  gaps.length ? '  *** REGRESSION ***' : '  (none)');
console.log('intentional renames vs old (' + report.renames.length + '):');
report.renames.forEach(r => console.log('   ', r));
if (gaps.length) { process.exitCode = 1; gaps.slice(0, 20).forEach(k => console.log('   GAP', k, OLD.CNAME[k])); }
