/* Skewbiks.com — method-sheet importer.
 *
 * Rebuilds the TCLL / EG2 / NS subsets of data/skewb_algs.json from the
 * community method sheets in data/sources/*.json (authored in NS notation),
 * converting every algorithm to WCA — the JSON's authored notation, same rule
 * as the Algorithms page's NS-mode adder (js/algs.js: "NS input is converted
 * and stored as WCA"). Re-runnable: each run regenerates exactly those three
 * subsets and leaves every other subset (FL, Sarah-*) untouched, so admin
 * edits to OTHER subsets survive; edits to the imported subsets belong in
 * data/sources/ (the sheets are the source of truth for their subsets).
 *
 * ROTATION-TOKEN CONVENTION (machine-derived 2026-07-06, do not "fix"):
 * the sheets' move letters are the standard NS binding (engine `parseAlg
 * (str, 'ns')`), but their whole-cube rotation letters differ from the
 * WCA/cubing.js convention the engine uses:
 *
 *     sheet x = engine z'      sheet y = engine y'      sheet z = engine x
 *
 * Derived by exhaustive search over all 48 axis relabelings, scored on two
 * independent truth sets — (a) NS-sheet L4C/L5C cases must solve to
 * corners-solved states (29/30 after relabeling vs 0/30 without), (b) TCLL's
 * `nsCase` cross-references must land on the NS sheet's case states up to
 * whole-cube rotation (19/19 vs 0/19) — and by within-case consistency over
 * all ~3,200 algs (EG2 439/439, TCLL 1669/1680, NS 637/659; identity reading
 * scores ~55-80%). Only algs with rotations AFTER the leading block can
 * distinguish the conventions (leading rotations only conjugate the case).
 * The absolute frame is confirmed by semantics: corner sets read naturally
 * (e.g. "Twoface" = two TOP corners twisted + the constraint-forced free
 * bottom compensator), and a mirror reading is ruled out by letter usage
 * (the sheets' dominant letters R r B b are the right-hand corners).
 *
 * A sheet "case" is orientation-free: alternates within one case solve the
 * same case seen from arbitrary holds (any of 24 rotations, not just the
 * site's four y-presentations). Each alg is keyed by the exact state it
 * solves, so the compiler/pages stay correct; the importer validates that
 * every alg of a case lands in ONE rotation-conjugacy class and flags the
 * rest (`"suspect": true` — almost certainly sheet typos) for later pruning.
 *
 * Per alg we keep provenance next to the converted form:
 *   { direction, alg (WCA, normAlg'd), ns (original string verbatim),
 *     rating, firstMove?, suspect? }
 * Slash tokens like "r'/r2" are equal-state notation alternatives (X2 == X'
 * on order-3 twists) — we verify that letter+amount match and take the first.
 *
 * Validation (any hard failure -> nothing is written):
 *   - every alg parses as NS (after rotation relabeling) and the WCA
 *     conversion reaches the same state
 *   - identity algs (solve nothing) are DROPPED and reported
 *
 * Run: node tools/import-method-sheets.mjs [--check]
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
const syms = E.buildSyms();
const rotBy = E.makeFrames(syms);

const ALGS_PATH = path.join(ROOT, 'data', 'skewb_algs.json');
const J = JSON.parse(fs.readFileSync(ALGS_PATH, 'utf8'));

// ---- alg string handling -------------------------------------------------
const hard = [];    // failures that block the write
const dropped = []; // identity algs removed from the import
const warns = [];   // non-blocking oddities

// normalize typography, then resolve "A/B" alternative tokens to A after
// checking the alternatives really are the same move (letter + amount).
function pickAlternatives(raw, where) {
  const s = String(raw).replace(/[’′]/g, "'").replace(/\s+/g, ' ').trim();
  const toks = s.split(' ').map(t => {
    if (!t.includes('/')) return t;
    const alts = t.split('/').filter(Boolean);
    const sig = (tok) => {
      const m = tok.match(/^([FRBLfrbl])(2'|2|')?$/);
      return m ? m[1] + ':' + ((m[2] === "'" || m[2] === '2') ? 2 : 1) : null;
    };
    const sigs = alts.map(sig);
    if (sigs.some(x => x === null) || new Set(sigs).size !== 1)
      warns.push(where + ': alternatives differ, kept first: ' + t);
    return alts[0];
  });
  return toks.join(' ');
}

// sheet rotation letters -> engine rotation letters (see header)
const ROT_RELABEL = { x: "z'", y: "y'", z: 'x' };
const SUFFIX_INV = { '': "'", "'": '', '2': '2', "2'": '2' };
function relabelRotations(s) {
  return s.split(' ').map(t => {
    const m = t.match(/^([xyz])(2'|2|')?$/);
    if (!m) return t;
    const base = ROT_RELABEL[m[1]];               // engine letter (+ maybe ')
    const suf = m[2] || '';
    if (base.endsWith("'")) return base[0] + SUFFIX_INV[suf];  // inverted axis
    return base + (suf === "2'" ? '2' : suf);
  }).join(' ');
}

// NS/WCA string -> exact state it applies to solved (null if unparseable)
function stOf(str, notation) {
  const p = E.parseAlg(E.preprocessAlg(str), notation);
  return p && E.applyParsed(p, E.solved(), syms, rotBy);
}
const SOLVED_KEY = E.stateKey(E.solved());

// first move of an alg, named in the sheets' first-move convention and in the
// frame of the alg's OWN case state (the angle its diagram shows) — the value
// the Algorithms page's first-move rows key on. The WCA conversion absorbs
// rotations, so its first token IS the physical first move in that frame; the
// sheets' letter convention for it is the fixed relabeling below (validated
// against the sheets' own firstMove columns: 97% agreement, disagreements are
// almost all the suspect-flagged typo algs).
const SHEET_FM = { R: 'B', U: 'b', L: 'r', B: 'R' };
function firstMoveOf(wca) {
  const m = String(wca).trim().split(/\s+/)[0].match(/^([ULRB])(2'|2|')?$/);
  if (!m) return null;
  return SHEET_FM[m[1]] + ((m[2] === "'" || m[2] === '2') ? "'" : '');
}
const fmStats = { agree: 0, differ: 0 };

// one source alg -> stored row, or null (reported)
function convert(a, where) {
  const picked = relabelRotations(pickAlternatives(a.alg, where));
  const stNS = stOf(picked, 'ns');
  if (!stNS) { hard.push(where + ': does not parse as NS: ' + JSON.stringify(a.alg)); return null; }
  const wca = E.nsToWCA(picked);
  const stW = wca && stOf(wca, 'wca');
  if (!stW || !E.eq(stNS, stW)) { hard.push(where + ': NS->WCA state mismatch: ' + JSON.stringify(a.alg)); return null; }
  const cs = E.caseStateOf(wca);
  if (!cs) { hard.push(where + ': converted alg has no clean case state: ' + wca); return null; }
  if (E.stateKey(cs) === SOLVED_KEY) { dropped.push(where + ': identity (solves nothing): ' + JSON.stringify(a.alg)); return null; }
  const row = { direction: 'Front', alg: E.normAlg(wca), ns: String(a.alg) };
  if (a.rating != null) row.rating = a.rating;
  row.firstMove = firstMoveOf(row.alg);
  // keep the sheet's own column when it disagrees with the computed value
  // (single-letter entries only; slash-alternatives and cw/ccw pass through)
  if (a.firstMove != null && a.firstMove !== row.firstMove) {
    if (/^[FRBLfrbl]'?$/.test(a.firstMove)) fmStats.differ++;
    row.firstMoveSheet = a.firstMove;
  } else if (a.firstMove != null) fmStats.agree++;
  return row;
}

// ---- rotation-conjugacy signature (case identity is orientation-free) ----
// 24 rotation-prefix words, deduped by their effect on a probe alg.
const ROT_WORDS = (() => {
  const gens = ['x', "x'", 'x2', 'y', "y'", 'y2', 'z', "z'", 'z2'];
  const cand = ['', ...gens, ...gens.flatMap(a => gens.map(b => a + ' ' + b))];
  const byKey = new Map();
  for (const w of cand) {
    const cs = E.caseStateOf((w ? w + ' ' : '') + 'R U B L R');
    const k = E.stateKey(cs);
    if (!byKey.has(k)) byKey.set(k, w);
  }
  return [...byKey.values()];
})();
function rotClassSig(wca) {
  let best = null;
  for (const w of ROT_WORDS) {
    const cs = E.caseStateOf((w ? w + ' ' : '') + wca);
    if (!cs) return null;
    const k = E.stateKey(cs);
    if (best === null || k < best) best = k;
  }
  return best;
}

// ---- per-method adapters: source case -> {name, section, extra} ----------
// Each case also carries its structured sheet fields (corner / sign / id /
// center / caseId / centerPattern) so the Algorithms page can group, filter
// and sort without parsing names; the subset's `nav` block tells the page
// how: `group` renders as a second-level tab row, `filter` as a dropdown,
// `sort` orders the visible cases. Distinct values keep sheet order.
const distinctVals = (cases, field) => {
  const seen = [];
  for (const c of cases) { const v = c[field]; if (v != null && !seen.includes(v)) seen.push(v); }
  return seen;
};
const ID_ORDER = ['U', 'FL', 'FR', 'BR', 'BL'];
const ADAPTERS = {
  tcll: {
    key: 'TCLL', name: 'TCLL',
    subsetExtras: (src) => ({ source: src.source, ratings: src.ratings, recognition: src.recognition, sheetNotes: src.sheetNotes }),
    caseOf: (c) => ({
      name: c.name,
      section: c.cornerName + (c.sign || ''),
      extra: Object.assign(
        { corner: c.corner, cornerName: c.cornerName, sign: c.sign, id: c.id, center: c.center },
        c.nsCase != null ? { nsCase: c.nsCase } : {}),
    }),
    nav: (cases) => ({
      group: { field: 'sign', values: distinctVals(cases, 'sign').map(v => ({ value: v, label: 'TCLL' + v })) },
      filter: { field: 'cornerName', label: 'Corner set' },
      sort: { field: 'id', order: ID_ORDER },
    }),
  },
  eg2: {
    key: 'EG2', name: 'EG2',
    subsetExtras: (src) => ({ source: src.source, ratings: src.ratings }),
    caseOf: (c) => ({
      name: [c.corner, c.id, c.center].filter(Boolean).join(' '),
      section: c.corner,
      extra: Object.assign({ corner: c.corner, center: c.center }, c.id != null ? { id: c.id } : {}),
    }),
    nav: (cases) => ({
      group: { field: 'corner', values: distinctVals(cases, 'corner').map(v => ({ value: v, label: v })) },
      filter: { field: 'center', label: 'Center case' },
      sort: { field: 'id', order: ID_ORDER },
    }),
  },
  ns: {
    key: 'NS', name: 'NS Method',
    subsetExtras: (src) => ({ source: src.source, ratings: src.ratings, firstMoveOrder: src.firstMoveOrder }),
    caseOf: (c) => ({
      name: c.corner + (c.centerPattern ? ' ' + c.centerPattern : '') + ' ' + c.caseId,
      section: c.centerPattern || c.corner,
      extra: Object.assign(
        { corner: c.corner, caseId: c.caseId },
        c.centerPattern != null ? { centerPattern: c.centerPattern } : {}),
    }),
    nav: (cases) => ({
      group: { field: 'corner', values: distinctVals(cases, 'corner').map(v => ({ value: v, label: v })) },
      filter: { field: 'centerPattern', label: 'Center pattern' },
      sort: { field: 'caseId', natural: true },
    }),
  },
};

// ---- build one subset from a source sheet --------------------------------
function buildSubset(fileKey) {
  const ad = ADAPTERS[fileKey];
  const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sources', fileKey + '.json'), 'utf8'));
  const byName = new Map(); // case name -> case (duplicate names merge)
  let algsIn = 0, merged = 0;
  for (const c of src.cases) {
    const meta = ad.caseOf(c);
    let out = byName.get(meta.name);
    if (!out) { out = Object.assign({ name: meta.name, section: meta.section, algs: [] }, meta.extra); byName.set(meta.name, out); }
    else merged++;
    for (const a of c.algs) {
      algsIn++;
      const row = convert(a, ad.key + ' / ' + meta.name);
      if (!row) continue;
      if (out.algs.some(x => x.alg === row.alg)) continue; // same WCA form already kept
      out.algs.push(row);
    }
  }
  const cases = [...byName.values()].filter(c => c.algs.length);

  // within-case consistency: every alg of a case should solve the same case
  // up to whole-cube rotation (the sheets present alternates from arbitrary
  // holds). Algs outside the case's plurality class are marked suspect —
  // they still ship (each alg files under the exact state it solves, with
  // its own correct diagram) but are near-certain sheet typos.
  let suspects = 0;
  for (const c of cases) {
    const sigs = c.algs.map(a => rotClassSig(a.alg));
    const counts = new Map();
    for (const s of sigs) if (s) counts.set(s, (counts.get(s) || 0) + 1);
    if (counts.size <= 1) continue;
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    c.algs.forEach((a, i) => { if (sigs[i] !== top) { a.suspect = true; suspects++; } });
    // suspects last (stable): the first alg anchors the case's diagram and
    // presentation labels on the Algorithms page — a typo shouldn't anchor.
    c.algs = [...c.algs.filter(a => !a.suspect), ...c.algs.filter(a => a.suspect)];
  }
  const algsOut = cases.reduce((n, c) => n + c.algs.length, 0);
  return { ad, subset: Object.assign({ name: ad.name, directional: true, nav: ad.nav(cases) }, ad.subsetExtras(src), { cases }),
           stats: { casesIn: src.cases.length, casesOut: cases.length, merged, algsIn, algsOut, suspects } };
}

const built = ['ns', 'eg2', 'tcll'].map(buildSubset);

// ---- assemble the new subsets object --------------------------------------
// Keep every non-imported subset as-is; EMPTY the machine-generated
// Sarah-Intermediate seed (v0 placeholder content — superseded by real
// authoring); imported subsets are fully regenerated. Tab order = key order:
// FL, Sarah-Intermediate, Sarah-Advanced, NS, EG2, TCLL.
const IMPORTED = new Set(built.map(b => b.ad.key));
const subsets = {};
for (const [k, v] of Object.entries(J.subsets)) {
  if (IMPORTED.has(k)) continue; // re-inserted below in canonical order
  subsets[k] = (k === 'Sarah-Intermediate') ? Object.assign({}, v, { cases: [] }) : v;
}
for (const key of ['NS', 'EG2', 'TCLL']) subsets[key] = built.find(b => b.ad.key === key).subset;

// ---- meta ------------------------------------------------------------------
let cases = 0, algs = 0;
for (const cont of [subsets, J.other_subsets || {}])
  for (const k of Object.keys(cont)) for (const c of cont[k].cases) { cases++; algs += c.algs.length; }
const meta = Object.assign({}, J.meta, {
  source: 'Skewbiks.com — authored algorithm data (TCLL / EG2 / NS imported from the community method sheets in data/sources/ by tools/import-method-sheets.mjs)',
  status: 'TCLL / EG2 / NS imported from data/sources/*.json (NS-notation sources converted to WCA; originals kept per-alg as `ns`; sheet rotation letters x/y/z = engine z\'/y\'/x — see the importer header). FL / Sarah-Intermediate / Sarah-Advanced await authoring.',
  counts: { cases, algs },
});
delete meta.exported; delete meta.note; // page-export markers, not authored state
const OUT = { meta, subsets, other_subsets: J.other_subsets || {} };

// ---- report + write --------------------------------------------------------
for (const b of built) {
  const s = b.stats;
  console.log(`${b.ad.key}: cases ${s.casesIn} -> ${s.casesOut}` + (s.merged ? ` (${s.merged} duplicate-name merges)` : '') +
    ` | algs ${s.algsIn} -> ${s.algsOut} | suspect (off-case, kept+flagged): ${s.suspects}`);
}
console.log('firstMove: computed vs sheet column — agree ' + fmStats.agree + ', differ ' + fmStats.differ + ' (sheet value kept as firstMoveSheet)');
if (warns.length) { console.log('\nWARN (' + warns.length + '):'); warns.forEach(w => console.log('   ' + w)); }
if (dropped.length) { console.log('\nDROPPED identity algs (' + dropped.length + '):'); dropped.forEach(d => console.log('   ' + d)); }
if (hard.length) {
  console.error('\nHARD FAILURES (' + hard.length + ') — nothing written:');
  hard.forEach(h2 => console.error('   ' + h2));
  process.exit(1);
}
const check = process.argv.includes('--check');
if (check) { console.log('\n== --check: not written =='); process.exit(0); }
fs.writeFileSync(ALGS_PATH, JSON.stringify(OUT, null, 2) + '\n');
console.log(`\n== wrote data/skewb_algs.json: ${cases} cases / ${algs} algs ==`);
