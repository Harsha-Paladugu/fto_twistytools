/* Import zwegner's Algorithmic LBT sheet (M3 phase 3) into data/fto_algs.json.
 *
 * Source: data/sources/lbt-zwegner.html (SVG-stripped snapshot of
 * https://zwegner.github.io/cubing/fto/lbt-algs.html — see the header comment
 * there for provenance). Dialect: plain Streeter CIF — Uo rotations, Uw/BLw/
 * BRw wides, Us slices; no S/H macros, no brackets, no [U] marks. Only the
 * CURATED algs are imported; the page's hidden "raw dump of all generated
 * algs" (class="gen") is deliberately left behind.
 *
 * LBT = the Bencisco method's Last Bottom Triple: the bottom-left slot
 * between the F and BL faces — corner slot 4 + centre slots F(4) and BL(10).
 * At this step the whole last layer is still junk, so the locality region is
 * EXACTLY the 1L3T sheet's region plus the slot itself (cross-sheet pin):
 *   corners {0,1,2} ∪ {4}, edges {0,1,4},
 *   centres L3T {0,1,2,3,6,7,11,12,14,15,16,22,23} ∪ {4,10}.
 *
 * Machine verification (the importer REFUSES to write on any failure):
 *   - page structure: 96 cases numbered 1..96 in 24 groups of 4 across 6
 *     sections; case 21 is the page's solved-state placeholder (no alg);
 *   - every kept alg parses and solves a definite non-solved state;
 *   - every kept alg's state is LBT-local, either as printed (99 algs) or
 *     after appending ONE closing wide/slice token (21 algs): those are
 *     written with a leading Uw/Us SETUP whose restore the page leaves
 *     implicit — the closing token is always the textual inverse of the
 *     alg's first wide/slice token, its net frame rotation is a U-axis
 *     rotation, and each such alg gets a machine-verified JSON note;
 *   - all algs of a case agree on the corner: piece 4's location + flip
 *     (centre sources may differ per alg — the page says "there are two of
 *     each color's triangles that can be used", and cases 56/84 do differ);
 *   - the corner is in the slot iff the case is in section 1, and on a
 *     front-top slot ({0,2}) otherwise; every group of four has exactly two
 *     corner-flipped cases (section 1 quads follow the page's fixed
 *     [base, mirror, flipped, flipped-mirror] = flips 0,0,1,1);
 *   - cases 7 and 8 each list two algs the page calls "the same, just
 *     notated differently" — pinned state-identical; all other alg states
 *     are distinct, and the 95 primary case states are distinct.
 *
 * Run: node tools/import-lbt.mjs   (rewrites data/fto_algs.json, then run
 * npm run build && npm run test:engine && npm run test:trainer)
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

const SRC = path.join(ROOT, 'data', 'sources', 'lbt-zwegner.html');
const OUT = path.join(ROOT, 'data', 'fto_algs.json');
const html = fs.readFileSync(SRC, 'utf8');

const fail = (msg) => { console.error('IMPORT FAILED: ' + msg); process.exit(1); };
const solved = E.solved();
const SOLVED_KEY = E.stateKey(solved);
const SOLVED_CASE = 21;
const SOLVED_TEXT = "Uhh you probably don't need an alg here";

// ---- LBT locality region: the 1L3T region (tools/import-1l3t.mjs) + the
// bottom-left triple slot {corner 4, F(4), BL(10)} ----
const LBT_CORNERS = new Set([0, 1, 2, 4]);
const LBT_EDGES = new Set([0, 1, 4]);
const LBT_CENTRES = new Set([0, 1, 2, 3, 4, 6, 7, 10, 11, 12, 14, 15, 16, 22, 23]);
function isLocal(s) {
  for (let i = 0; i < 6; i++) if ((s.cp[i] !== i || s.co[i] !== 0) && !LBT_CORNERS.has(i)) return false;
  for (let i = 0; i < 12; i++) if (s.ep[i] !== i && !LBT_EDGES.has(i)) return false;
  for (let i = 0; i < 24; i++) if (s.ctr[i] !== solved.ctr[i] && !LBT_CENTRES.has(i)) return false;
  return true;
}
// corner meaning: where piece 4 sits and whether it is flipped there
function cornerOf(s) {
  for (let i = 0; i < 6; i++) if (s.cp[i] === 4) return { pos: i, flip: s.co[i] };
  fail('corner piece 4 not found (corrupt state)');
}

// ---- parse the page ----
const rows = html.split(/<tr>/).slice(1);
const cases = [];
let section = null, group = null, pendingLabels = null;
for (const row of rows) {
  const mSec = row.match(/class="big-header"[^>]*>(Section \d+: [^<]+)/);
  if (mSec) { section = mSec[1].trim(); pendingLabels = null; continue; }
  const mGrp = row.match(/class="header"[^>]*>(Group \d+: [^<]+)/);
  if (mGrp) { group = mGrp[1].trim(); pendingLabels = null; continue; }
  const cells = [...row.matchAll(/<td>(.*?)<\/td>/gs)].map((m) => m[1]);
  if (!cells.length) continue;
  if (cells.every((c) => /^Case \d+$/.test(c.trim()))) {
    pendingLabels = cells.map((c) => parseInt(c.trim().slice(5), 10));
    continue;
  }
  if (cells.every((c) => c.trim() === '')) continue;     // stripped diagram row
  if (!pendingLabels) continue;
  if (cells.length !== pendingLabels.length) fail('label/alg row mismatch near case ' + pendingLabels[0]);
  cells.forEach((cell, i) => {
    let body = cell.replace(/<div class="gen">.*?<\/div>/gs, '');
    const notes = [...body.matchAll(/<div class="notes">(.*?)<\/div>/gs)]
      .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
    body = body.replace(/<div class="notes">.*?<\/div>/gs, '');
    const algs = body.split(/<br\/?>/).map((s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    cases.push({ num: pendingLabels[i], section, group, algs, note: notes.join(' ') });
  });
  pendingLabels = null;
}
cases.sort((a, b) => a.num - b.num);
if (cases.length !== 96) fail('expected 96 case cells, got ' + cases.length);
if (!cases.every((c, i) => c.num === i + 1)) fail('case numbering is not 1..96');
if (new Set(cases.map((c) => c.group)).size !== 24) fail('expected 24 groups');
if (new Set(cases.map((c) => c.section)).size !== 6) fail('expected 6 sections');
const solvedCell = cases[SOLVED_CASE - 1];
if (solvedCell.algs.join(' ') !== SOLVED_TEXT) fail('case 21 is no longer the solved-state placeholder (revisit the import)');

// ---- verify every alg ----
const stateOf = (text) => { try { return E.caseStateOf(text, 'cif'); } catch (e) { return null; } };
const stats = { algs: 0, plain: 0, setup: 0 };
for (const c of cases) {
  c.rows = [];
  if (c.num === SOLVED_CASE) continue;
  if (!c.algs.length) fail('case ' + c.num + ' has no algs');
  for (const text of c.algs) {
    stats.algs++;
    const s = stateOf(text);
    if (!s) fail('case ' + c.num + ': unparseable alg: ' + text);
    if (E.stateKey(s) === SOLVED_KEY) fail('case ' + c.num + ': identity alg: ' + text);
    if (isLocal(s)) {
      stats.plain++;
      c.rows.push({ alg: text, state: s });
    } else {
      // must be a leading-setup alg: net frame rotation about the U axis
      // (identity when a pure Uo prefix cancels the wide's rotation, as in
      // case 6's "Uo' Uw ..."), closed by the textual inverse of its first
      // wide/slice token
      const hold = E.walkParsed(E.parseAlg(text), () => {}, 'cif');
      const g = E.ROT24.find((r) => [0, 1, 2, 3, 4, 5, 6, 7].every((p) => hold[p] === E.faceImg(r, p)));
      if (!g || E.faceImg(g, E.FIDX.U) !== E.FIDX.U)
        fail('case ' + c.num + ': non-local alg without a U-axis net frame: ' + text);
      const setup = (text.match(/(?:^|\s)(Uw'?|Us'?)(?=\s|$)/) || [])[1];
      if (!setup) fail('case ' + c.num + ': non-local alg without a Uw/Us setup token: ' + text);
      const closing = setup.endsWith("'") ? setup.slice(0, -1) : setup + "'";
      const s2 = stateOf(text + ' ' + closing);
      if (!s2 || !isLocal(s2)) fail('case ' + c.num + ': appending ' + closing + ' does not close the setup: ' + text);
      stats.setup++;
      c.rows.push({
        alg: text, state: s2,
        note: 'the leading ' + setup + ' is a setup move the page leaves unrestored — as printed this ends one ' +
          closing + ' short of solved; append ' + closing + ' (machine-verified)',
      });
    }
  }
}
if (stats.setup !== 21) fail('expected exactly 21 leading-setup algs, got ' + stats.setup);
if (stats.algs !== 120) fail('expected 120 curated algs, got ' + stats.algs);

// ---- intra-case + section/group structure ----
const SEC_NUM = (c) => parseInt(c.section.match(/^Section (\d+)/)[1], 10);
for (const c of cases) {
  if (c.num === SOLVED_CASE) continue;
  const corners = c.rows.map((r) => cornerOf(r.state));
  if (!corners.every((k) => k.pos === corners[0].pos && k.flip === corners[0].flip))
    fail('case ' + c.num + ': algs disagree on the corner: ' + JSON.stringify(corners));
  c.corner = corners[0];
  const inSlot = c.corner.pos === 4;
  if (inSlot !== (SEC_NUM(c) === 1)) fail('case ' + c.num + ': corner in slot must hold exactly in section 1');
  if (!inSlot && ![0, 2].includes(c.corner.pos)) fail('case ' + c.num + ': on-top corner outside the front-top slots: ' + c.corner.pos);
}
for (let q = 0; q < 24; q++) {
  const quad = cases.slice(q * 4, q * 4 + 4).filter((c) => c.num !== SOLVED_CASE);
  const flips = quad.map((c) => c.corner.flip);
  if (flips.reduce((a, b) => a + b, 0) !== 2) fail('group ' + (q + 1) + ': expected exactly two corner-flipped cases, got flips ' + flips);
  if (SEC_NUM(quad[0]) === 1 && flips.join('') !== (quad.length === 4 ? '0011' : '011'))
    fail('group ' + (q + 1) + ': section-1 quad flip pattern is not base/mirror/flipped/flipped-mirror');
}

// ---- distinctness + the pinned "same alg notated differently" pairs ----
const keyOf = (r) => E.stateKey(stateOf(r.alg));
for (const n of [7, 8]) {
  const c = cases[n - 1];
  if (c.rows.length !== 2 || keyOf(c.rows[0]) !== keyOf(c.rows[1]))
    fail('case ' + n + ': the page\'s "same alg notated differently" pair is no longer state-identical');
}
const keys = cases.flatMap((c) => c.rows.map(keyOf));
if (new Set(keys).size !== 118) fail('expected 118 distinct alg states (120 minus the two pinned pairs), got ' + new Set(keys).size);
const primaries = new Set(cases.filter((c) => c.rows.length).map((c) => keyOf(c.rows[0])));
if (primaries.size !== 95) fail('expected 95 distinct primary case states, got ' + primaries.size);

// ---- assemble the subset ----
const GROUPS = ['S1 corner in slot', 'S2 one solved', 'S3 one in wrong slot', 'S4 one in middle', 'S5 all on top', 'S6 both in slot'];
const outCases = cases.filter((c) => c.num !== SOLVED_CASE).map((c) => {
  const secTitle = c.section.replace(/^Section \d+: /, '');
  const grpTitle = c.group.replace(/^Group \d+: /, '');
  let recognition = secTitle.charAt(0).toUpperCase() + secTitle.slice(1) + ' — ' + grpTitle + '.';
  if (c.note) recognition += ' ' + c.note + (/[.!?]$/.test(c.note) ? '' : '.');
  return {
    name: 'LBT ' + c.num,
    group: GROUPS[SEC_NUM(c) - 1],
    recognition,
    algs: c.rows.map((r) => (r.note ? { alg: r.alg, note: r.note } : { alg: r.alg })),
  };
});

const J = JSON.parse(fs.readFileSync(OUT, 'utf8'));
J.subsets.LBT = {
  name: 'LBT — Last Bottom Triple (Algorithmic)',
  notation: 'cif',
  auf: false,
  notation_note: "zwegner's page dialect is plain Streeter notation, all machine-verified: Uo rotations, Uw/BLw/BRw wides, Us slices. 21 algs are written with a leading Uw/Us setup whose restore the page leaves implicit — as printed they end one wide/slice turn short of solved, and each carries a note with the machine-verified closing token (hover the tag). Diagrams show the exact state the first alg solves; the whole last layer is junk at this step, so top-layer content is arbitrary. Trainer scrambles reproduce each alg's exact state, with AUF randomization off (a U pre-turn would change the case).",
  description: 'Algorithmic LBT: the Bencisco method’s last bottom triple (the corner and two triangles of the bottom-left slot, between the F and BL faces) solved in one look no matter where the pieces are. 95 cases plus the already-solved case (the page’s case 21, omitted here), in six sections by corner location, subdivided into groups of four: a case, its mirror, and the same two with the corner flipped. Case numbers match zwegner’s page.',
  groups: GROUPS,
  sources: [
    "zwegner, 'Algorithmic LBT' — https://zwegner.github.io/cubing/fto/lbt-algs.html (snapshot: data/sources/lbt-zwegner.html, fetched 2026-07-13)",
    '360cubed — the four keyhole cases (LBT 1, 2, 5, 6)',
    "Ben Streeter — the 'trapped triangles' cases (LBT 33, 34, 37, 38) and the traditional flipping-alg cases",
  ],
  cases: outCases,
};

// ---- meta ----
const totalCases = Object.values(J.subsets).reduce((a, s) => a + s.cases.length, 0);
const totalAlgs = Object.values(J.subsets).reduce((a, s) => a + s.cases.reduce((b, c) => b + c.algs.length, 0), 0);
J.meta.counts = { cases: totalCases, algs: totalAlgs };
J.meta.status = 'TCP (last layer) imported 2026-07-10; 1L3T (one-look last 3 triples) imported 2026-07-13 from zwegner’s page by tools/import-1l3t.mjs; LBT (last bottom triple) imported 2026-07-13 from zwegner’s page by tools/import-lbt.mjs.';

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

console.log('== imported LBT ==');
console.log('cases:', outCases.length, '(dropped: case 21 = the solved state)');
console.log('algs:', stats.algs, '| local as printed:', stats.plain, '| leading-setup (noted):', stats.setup);
console.log('totals now:', JSON.stringify(J.meta.counts));
