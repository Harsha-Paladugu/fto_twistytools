/* Import zwegner's 1L3T sheet (M3 phase 2) into data/fto_algs.json.
 *
 * Source: data/sources/1l3t-zwegner.html (SVG-stripped snapshot of
 * https://zwegner.github.io/cubing/fto/1l3t.html — see the header comment
 * there for provenance). Dialect: CIF, with S/H sledge-hedge macros and
 * [U]/[U'] pre-AUF marks (both now native in the engine parser), {X,Y}
 * bracket rotations, w-wides, s-slices.
 *
 * Machine verification (the importer REFUSES to write on any failure):
 *   - every kept alg parses and solves a definite state (engine caseStateOf);
 *   - every kept alg's state is L3T-LOCAL: corners/flips in the top three
 *     slots, edges in the three U-face slots, centres inside the empirically
 *     pinned region (top face + tetrad-A triple slots + the U-layer flanks);
 *   - per case, every alg is classified against the case's PRIMARY (first)
 *     alg: on its U-AUF orbit (clean), one final AUF short (noted), or a
 *     centre-only "working-slot" variant (noted) — anything else fails;
 *   - the two known-broken source algs (see ERRATA) must still be present in
 *     the source and still non-local — if the page gets fixed upstream, this
 *     importer fails so the exclusion gets revisited;
 *   - cross-sheet: at least 16 of our 18 TCP case states must appear among
 *     the imported states modulo AUF (the sheet's 6c section is the TCP set).
 *
 * Cases dropped by design: 1.E.1 (the solved state — no alg) and 6b.E.5
 * (its only published alg is broken). Both are documented in the subset
 * description.
 *
 * Run: node tools/import-1l3t.mjs   (rewrites data/fto_algs.json, then run
 * npm run build && npm run test:engine)
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

const SRC = path.join(ROOT, 'data', 'sources', '1l3t-zwegner.html');
const OUT = path.join(ROOT, 'data', 'fto_algs.json');
const html = fs.readFileSync(SRC, 'utf8');

const fail = (msg) => { console.error('IMPORT FAILED: ' + msg); process.exit(1); };

// ---- known source errata (machine-found 2026-07-13): these two texts do not
// solve L3T-local states (a real puzzle would end with pieces outside the last
// layer displaced), so they are transcription errors on the page. Excluded
// from the import; the exclusion self-checks below.
const ERRATA = [
  { caseLabel: '6b.E.5', alg: "[U] {U,BR} BLw' B U R U' B' BLw BR' R'", why: 'moves corners/edges outside the last layer' },
  { caseLabel: '4b.O.4', alg: "{L,U} U R U R' U' {L,BL} D' R' U' R D", why: 'moves edges outside the last layer' },
];
const ERRATA_TEXTS = new Set(ERRATA.map((e) => e.alg));

// ---- L3T locality region (empirically pinned over the full sheet; also
// asserted in tools/test-engine.mjs §14) ----
const L3T_CORNERS = new Set([0, 1, 2]);
const L3T_EDGES = new Set([0, 1, 4]);
const L3T_CENTRES = new Set([0, 1, 2, 3, 6, 7, 11, 12, 14, 15, 16, 22, 23]);
function isLocal(s) {
  const solved = E.solved();
  for (let i = 0; i < 6; i++) if ((s.cp[i] !== i || s.co[i] !== 0) && !L3T_CORNERS.has(i)) return false;
  for (let i = 0; i < 12; i++) if (s.ep[i] !== i && !L3T_EDGES.has(i)) return false;
  for (let i = 0; i < 24; i++) if (s.ctr[i] !== solved.ctr[i] && !L3T_CENTRES.has(i)) return false;
  return true;
}

// ---- parse the page ----
const cases = [];
const tdRe = /<td>\s*<div class="case-label">.*?<br\/>([^<]+)<\/div>\s*<div>(.*?)<\/div><\/td>/gs;
let m;
while ((m = tdRe.exec(html))) {
  const label = m[1].trim();
  const algs = [...m[2].matchAll(/<div class="alg">(.*?)<\/div>/gs)].map((x) => x[1].replace(/\s+/g, ' ').trim());
  cases.push({ label, algs });
}
if (cases.length !== 180) fail('expected 180 case cells, got ' + cases.length);
if (new Set(cases.map((c) => c.label)).size !== 180) fail('duplicate case labels');

// errata must still be present in the source, verbatim
for (const e of ERRATA) {
  const c = cases.find((x) => x.label === e.caseLabel);
  if (!c || !c.algs.includes(e.alg)) fail('erratum no longer in source (revisit exclusion): ' + e.caseLabel);
  const cs = E.caseStateOf(e.alg, 'cif');
  if (!cs || isLocal(cs)) fail('erratum now parses/solves locally (revisit exclusion): ' + e.caseLabel);
}

// ---- verify + classify ----
const U_CW = 2 * E.FIDX.U, U_CCW = U_CW + 1;
// vertical view rotations (fix the U face) + rotation-conjugation on states —
// a variant alg may be authored at a re-gripped view of the case
const VERT = E.ROT24.filter((g) => E.faceImg(g, E.FIDX.U) === E.FIDX.U);
function conj(M, s) {
  const F = E.toFacelets(s), P = E.rotFaceletPerm(M), F2 = new Array(72);
  for (let i = 0; i < 72; i++) F2[i] = E.faceImg(M, F[P[i]]);
  return E.fromFacelets(F2);
}
// centre slots a working-slot choice can move between: the top face's three +
// the tetrad-A parking slots next to the top corners
const VARIANT_CENTRES = new Set([0, 1, 2, 3, 6, 7, 11]);
const stateOf = (text) => E.caseStateOf(text, 'cif');
const orbitOf = (s) => {
  const o = [E.stateKey(s)];
  let t = s;
  for (let i = 0; i < 2; i++) { t = E.move(t, U_CW); o.push(E.stateKey(t)); }
  return o;
};
const outCases = [];
const stats = { algs: 0, clean: 0, postAuf: 0, variants: 0 };
const allKeys = new Map(); // primary stateKey -> label (distinctness check)
for (const c of cases) {
  if (c.label === '1.E.1') continue;                     // the solved state — no alg to import
  const kept = c.algs.filter((a) => !ERRATA_TEXTS.has(a));
  if (!kept.length) {
    if (c.label !== '6b.E.5') fail(c.label + ' unexpectedly has no usable algs');
    continue;                                            // 6b.E.5: only alg is broken — dropped, documented
  }
  const sec = c.label.split('.')[0];
  const rows = [];
  let anchorState = null, anchorOrbit = null;
  for (const text of kept) {
    stats.algs++;
    const s = stateOf(text);
    if (!s) fail(c.label + ': unparseable alg: ' + text);
    if (!isLocal(s)) fail(c.label + ': alg solves a non-L3T-local state: ' + text);
    if (!anchorState) {
      anchorState = s;
      anchorOrbit = orbitOf(s);
      rows.push({ alg: text });
      stats.clean++;
      continue;
    }
    const key = E.stateKey(s);
    if (anchorOrbit.includes(key)) { rows.push({ alg: text }); stats.clean++; continue; }
    // one final AUF short? (sheets often leave the last U turn implicit)
    let post = null;
    for (const tok of ['U', "U'"]) {
      const s2 = stateOf(text + ' ' + tok);
      if (s2 && anchorOrbit.includes(E.stateKey(s2))) { post = tok; break; }
    }
    if (post) {
      rows.push({ alg: text, note: 'as printed this ends one AUF short of the case — append ' + post + ' (machine-verified)' });
      stats.postAuf++;
      continue;
    }
    // working-slot variant: same case (possibly seen at a vertical re-grip)
    // with the unsolved triangles parked on other faces — corners and edges
    // must match exactly; centre diffs confined to the parking subsystem
    let variant = false;
    outer: for (const ok of anchorOrbit) {
      for (const g of VERT) {
        const a = conj(g, E.keyToState(ok));
        if (!a.cp.every((v, i) => v === s.cp[i]) || !a.co.every((v, i) => v === s.co[i])) continue;
        if (!a.ep.every((v, i) => v === s.ep[i])) continue;
        let ok2 = true;
        for (let x = 0; x < 24; x++) if (a.ctr[x] !== s.ctr[x] && !VARIANT_CENTRES.has(x)) { ok2 = false; break; }
        if (ok2) { variant = true; break outer; }
      }
    }
    if (variant) {
      rows.push({ alg: text, note: 'working-slot variant: solves this case with the unsolved triangles parked on different faces — machine-verified against its own state, not the pictured one' });
      stats.variants++;
      continue;
    }
    fail(c.label + ': alg relates to its case by no known transform: ' + text);
  }
  const key0 = E.stateKey(anchorState);
  if (allKeys.has(key0)) fail('duplicate primary case state: ' + c.label + ' == ' + allKeys.get(key0));
  allKeys.set(key0, c.label);
  outCases.push({
    name: c.label,
    group: 'OLP ' + sec,
    algs: rows,
    ...(c.label === '4b.O.4' ? { moves_note: 'the sheet lists a fourth alg here that does not solve a last-layer state (transcription error, machine-verified) — excluded; see data/sources/1l3t-zwegner.html' } : {}),
  });
}
if (outCases.length !== 178) fail('expected 178 imported cases, got ' + outCases.length);

// ---- cross-sheet check: the 6c section is the TCP set ----
const J = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const pageKeys = new Set();
for (const [k] of allKeys) {
  let s = E.keyToState(k);
  for (let i = 0; i < 3; i++) { pageKeys.add(E.stateKey(s)); s = E.move(s, U_CW); }
}
let tcpHits = 0;
for (const c of J.subsets.TCP.cases) {
  const cs = E.caseStateOf(c.algs[0].alg, 'cif');
  if (pageKeys.has(E.stateKey(cs))) tcpHits++;
}
if (tcpHits !== 16) fail('TCP cross-check: only ' + tcpHits + ' of 18 TCP states found (expected 16: TCP 11/12 appear as working-slot variants)');

// ---- assemble the subset ----
const GROUPS = ['OLP 1', 'OLP 2', 'OLP 3', 'OLP 4a', 'OLP 4b', 'OLP 4c', 'OLP 5', 'OLP 6a', 'OLP 6b', 'OLP 6c', 'OLP 7', 'OLP 8'];
J.subsets['1L3T'] = {
  name: '1L3T — One-Look Last 3 Triples',
  notation: 'cif',
  notation_note: "zwegner's page dialect, all machine-verified: S/H are the sledge (R' L R L') and hedge (R B' R' B) triggers (S'/H' their inverses), [U]/[U'] are pre-AUF marks executed as the plain move, {X,Y} bracket rotations as in the community notation. Two source algs are transcription errors (they do not solve last-layer states) and are excluded: 6b.E.5's only alg (the case is therefore omitted) and 4b.O.4's fourth alg. Case 1.E.1 is the solved state. Some algs are marked as working-slot variants or as ending one AUF short — hover their note tag.",
  description: 'One-look last 3 triples: all 179 cases of the Bencisco last layer solved in a single look. Cases are sorted by OLP (where the top face’s stickers are), then triangle permutation (E = even, O = odd), then corner permutation. Set 6c is the TCP set. Sourced from zwegner’s page; algs by Aedan Bryant, with the 6c algs largely from Edd Dibley’s document.',
  groups: GROUPS,
  sources: [
    "zwegner, '1L3T' — https://zwegner.github.io/cubing/fto/1l3t.html (snapshot: data/sources/1l3t-zwegner.html, fetched 2026-07-13)",
    "Aedan Bryant, original alg sheet — https://docs.google.com/spreadsheets/d/1ERlQ5R1m5UGBCi65WTi4IBVyIKj60oVWjOFknFA3Pcs",
    "Edd Dibley, TCP document (set 6c) — https://docs.google.com/document/d/16KaLlxaUujgYbCgs-QNCbJbA1Tgc23VsbgMrOhl8gig",
  ],
  cases: outCases,
};

// ---- meta ----
const totalCases = Object.values(J.subsets).reduce((a, s) => a + s.cases.length, 0);
const totalAlgs = Object.values(J.subsets).reduce((a, s) => a + s.cases.reduce((b, c) => b + c.algs.length, 0), 0);
J.meta.counts = { cases: totalCases, algs: totalAlgs };
J.meta.status = 'TCP (last layer) imported 2026-07-10; 1L3T (one-look last 3 triples) imported 2026-07-13 from zwegner’s page by tools/import-1l3t.mjs.';

// ---- stable serialization: pretty meta/subset scalars, one line per case ----
function serialize(j) {
  const subsetBlock = (key, s) => {
    const fields = [];
    for (const [k, v] of Object.entries(s)) {
      if (k === 'cases') continue;
      fields.push('      ' + JSON.stringify(k) + ': ' + (Array.isArray(v)
        ? '[\n' + v.map((x) => '        ' + JSON.stringify(x)).join(',\n') + '\n      ]'
        : JSON.stringify(v)));
    }
    const caseLines = s.cases.map((c) => '        ' + JSON.stringify(c)).join(',\n');
    return '    ' + JSON.stringify(key) + ': {\n' + fields.join(',\n') + ',\n      "cases": [\n' + caseLines + '\n      ]\n    }';
  };
  return '{\n  "meta": ' + JSON.stringify(j.meta, null, 2).replace(/\n/g, '\n  ') + ',\n' +
    '  "subsets": {\n' +
    Object.entries(j.subsets).map(([k, s]) => subsetBlock(k, s)).join(',\n') +
    '\n  }\n}\n';
}
const text = serialize(J);
JSON.parse(text); // must round-trip
fs.writeFileSync(OUT, text);

console.log('== imported 1L3T ==');
console.log('cases:', outCases.length, '(dropped: 1.E.1 solved, 6b.E.5 broken-only)');
console.log('algs:', stats.algs, '| clean (primary/AUF-orbit):', stats.clean, '| final-AUF-short:', stats.postAuf, '| working-slot variants:', stats.variants);
console.log('TCP cross-check:', tcpHits, 'of 18 TCP states present modulo AUF');
console.log('totals now:', JSON.stringify(J.meta.counts));
