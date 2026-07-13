/* Import the 1LP sheet (M3 phase 4) into data/fto_algs.json.
 *
 * Source: data/sources/1lp-rotationless-v3.json — a verbatim transcription of
 * the user-supplied "One Look Pair Formation (1LP) Cases and Solutions" PDF
 * (1LP_Rotationless_V3.pdf; see the source file's provenance block). The PDF's
 * case images are NOT reproduced; case identity is machine-derived instead.
 *
 * Dialect (engine-native as of M3 phase 4): S/H sledge-hedge macros, (U)/(U')
 * paren AUF marks (parens strip; executed as the plain move), [Uo]/[Uo']
 * whole-puzzle rotation marks (executed as the state-neutral rotation —
 * leading ones respell the solution for a Uo-rotated view, trailing ones
 * annotate the ending orientation).
 *
 * What 1LP is (machine-established this import, see test-engine §16):
 * pair formation = the step before TCP. A line does NOT solve the puzzle from
 * a mid-solve state; it converts its case into a state whose top-layer pairs
 * are STRUCTURALLY FORMED (each top position is an upright pair — U triangle
 * up, a bottom triangle in the flank — or a flipped pair — bottom triangle
 * up, U triangle in the flank). "Neutral" means colors are ignored while
 * pairing, so the result lands in the TCP stage (one of the 18 TCP cases, or
 * a crossed cousin needing 2-look), exactly as the sheet's intro says.
 *
 * Machine verification (the importer REFUSES to write on any failure):
 *   - source shape: 12 cases, 29 sequences, case 6c = the solved placeholder;
 *   - every sequence parses, solves a definite non-solved state that is
 *     L3T-local AND inside the <U,S,H> closure (the full L3T coset, 4320
 *     states — sledge/hedge/U generate all of it, asserted);
 *   - the flip-sequence contract: every line maps EVERY closure state that
 *     shares its exact yellow/blue appearance (54 states each) into the
 *     structurally-formed family. That family is exactly 4 appearance
 *     classes x 54 = 216 states (flip sets {}, {0,1}, {0,2}, {1,2}), the 18
 *     TCP case states all sit in the flips-{1,2} class, and solved sits in
 *     the flips-{} class;
 *   - grip-respelling pairs: within cases 4a/4b/4c/6a/6b exactly one pair of
 *     lines is state-identical (the same physical solution spelled from a
 *     rotated grip — the sheet's "only one unique solution" cases); the 29
 *     lines resolve to exactly 24 distinct case states, all case-distinct;
 *   - cross-sheet (zwegner 1L3T): exactly one line state coincides with a
 *     zwegner primary case state; H sends exactly 11 of zwegner's group-1
 *     states into the TCP finish set — the sheet's own "this OLP has only 11
 *     possible permutations" count; |TCP/solved finish set ∩ zwegner states|
 *     = 51 (the 16-exact TCP cross-oracle + solved, x3 AUF).
 *
 * The sheet's Parity column (Stays/Flips) and per-case comments are carried
 * VERBATIM as display prose. The parity column is the author's own
 * permutation bookkeeping; it does not map onto zwegner's E/O case labels
 * under any state-level reading we tested, so it ships unverified and is
 * marked as sheet prose in the subset note.
 *
 * Run: node tools/import-1lp.mjs   (rewrites data/fto_algs.json, then run
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

const SRC = path.join(ROOT, 'data', 'sources', '1lp-rotationless-v3.json');
const OUT = path.join(ROOT, 'data', 'fto_algs.json');
const sheet = JSON.parse(fs.readFileSync(SRC, 'utf8'));

const fail = (msg) => { console.error('IMPORT FAILED: ' + msg); process.exit(1); };
const solved = E.solved();
const KEY = E.stateKey;
const SOLVED_KEY = KEY(solved);
const U_CW = 2 * E.FIDX.U, U_CCW = U_CW + 1;
const tbl = (t) => { const p = E.parseAlg(t); return p ? E.effectTable(p, 'cif') : null; };
const cso = (t) => { try { return E.caseStateOf(t, 'cif'); } catch (e) { return null; } };

// ---- source shape ----
if (sheet.cases.length !== 12) fail('expected 12 cases, got ' + sheet.cases.length);
const NSEQ = sheet.cases.reduce((a, c) => a + c.sequences.length, 0);
if (NSEQ !== 29) fail('expected 29 sequences, got ' + NSEQ);
const solvedCase = sheet.cases.find((c) => c.case === '6c');
if (!solvedCase || solvedCase.sequences.length !== 0 || !/solved/.test(solvedCase.comment)) {
  fail('case 6c is no longer the solved placeholder');
}

// ---- L3T locality (region pinned by the 1L3T import) ----
const L3T_CORNERS = new Set([0, 1, 2]), L3T_EDGES = new Set([0, 1, 4]),
  L3T_CENTRES = new Set([0, 1, 2, 3, 6, 7, 11, 12, 14, 15, 16, 22, 23]);
function isLocal(s) {
  for (let i = 0; i < 6; i++) if ((s.cp[i] !== i || s.co[i] !== 0) && !L3T_CORNERS.has(i)) return false;
  for (let i = 0; i < 12; i++) if (s.ep[i] !== i && !L3T_EDGES.has(i)) return false;
  for (let i = 0; i < 24; i++) if (s.ctr[i] !== solved.ctr[i] && !L3T_CENTRES.has(i)) return false;
  return true;
}

// ---- the L3T coset = closure of <U, S, H> from solved ----
const GENS = ['U', "U'", 'S', "S'", 'H', "H'"].map(tbl);
const closure = new Map([[SOLVED_KEY, solved]]);
{
  let fr = [solved];
  while (fr.length) {
    const nx = [];
    for (const s of fr) for (const g of GENS) {
      const t = E.applyTable(g, s), k = KEY(t);
      if (!closure.has(k)) { closure.set(k, t); nx.push(t); }
    }
    fr = nx;
  }
}
if (closure.size !== 4320) fail('L3T coset size changed: ' + closure.size + ' (expected 4320)');
for (const [, s] of closure) if (!isLocal(s)) fail('closure state escapes the L3T region');

// ---- appearance (the images' yellow/blue language) ----
const BLUEC = new Set([E.FIDX.F, E.FIDX.BR, E.FIDX.BL]);
function appearance(s) {
  const F = E.toFacelets(s);
  let out = '';
  for (let i = 0; i < 72; i++) {
    const ft = E.FEAT[i], c = F[i];
    out += ft.t === 'e' ? '.' : c === E.FIDX.U ? 'Y' : ft.t === 'c' ? 'b' : BLUEC.has(c) ? 'b' : '.';
  }
  return out;
}
const classOf = new Map(); // appearance -> [keys]
for (const [k, s] of closure) {
  const p = appearance(s);
  if (!classOf.has(p)) classOf.set(p, []);
  classOf.get(p).push(k);
}
if (classOf.size !== 80 || [...classOf.values()].some((v) => v.length !== 54)) {
  fail('appearance partition changed (expected 80 classes of 54)');
}

// ---- structurally-formed family ----
const USLOT = [0, 1, 2], FLANK = [3, 7, 11];
function structFormed(s) {
  for (let j = 0; j < 3; j++) {
    if (s.cp[j] > 2) return false;
    const flip = s.co[j];
    const uY = s.ctr[USLOT[j]] === E.FIDX.U, fY = s.ctr[FLANK[j]] === E.FIDX.U;
    if (!flip && !(uY && !fY)) return false;
    if (flip && !(!uY && fY)) return false;
  }
  return true;
}
const formedApp = new Set();
let formedN = 0;
for (const [, s] of closure) if (structFormed(s)) { formedN++; formedApp.add(appearance(s)); }
if (formedN !== 216 || formedApp.size !== 4) fail('structurally-formed family changed (expected 216 states / 4 appearances)');
if (!formedApp.has(appearance(solved))) fail('solved is not in the formed family');

// ---- the TCP finish set (P) + zwegner universe, from the live JSON ----
const J = JSON.parse(fs.readFileSync(OUT, 'utf8'));
if (!J.subsets.TCP || !J.subsets['1L3T']) fail('TCP/1L3T subsets missing from data/fto_algs.json (import order)');
const P = new Set();
{
  const add = (cs) => { let s = cs; for (let k = 0; k < 3; k++) { P.add(KEY(s)); s = E.move(s, U_CCW); } };
  add(solved);
  for (const c of J.subsets.TCP.cases) {
    const cs = cso(c.algs[0].alg);
    if (!cs) fail('TCP case unparseable: ' + c.name);
    if (!formedApp.has(appearance(cs))) fail('TCP case state not structurally formed: ' + c.name);
    add(cs);
  }
}
const zw = new Map(); // key -> zwegner label
{
  const add = (state, label) => { let s = state; for (let i = 0; i < 3; i++) { const k = KEY(s); if (!zw.has(k)) zw.set(k, label); s = E.move(s, U_CW); } };
  add(solved, '1.E.1');
  for (const c of J.subsets['1L3T'].cases) add(cso(c.algs[0].alg), c.name);
}
if (zw.size !== 537) fail('zwegner universe changed: ' + zw.size);
let pInZw = 0;
for (const k of P) if (zw.has(k)) pInZw++;
if (pInZw !== 51) fail('TCP finish set ∩ zwegner = ' + pInZw + ' (expected 51: 16-exact TCP oracle + solved, x3)');

// ---- verify every line ----
const lines = [];
for (const c of sheet.cases) c.sequences.forEach((text, i) => lines.push({ pdfCase: c.case, idx: i, text }));
for (const l of lines) {
  const p = E.parseAlg(l.text);
  if (!p) fail(l.pdfCase + ': unparseable: ' + l.text);
  l.moves = E.countMoves(p);
  l.T = E.effectTable(p, 'cif');
  l.state = cso(l.text);
  if (!l.state) fail(l.pdfCase + ': no case state: ' + l.text);
  l.key = KEY(l.state);
  if (l.key === SOLVED_KEY) fail(l.pdfCase + ': identity line: ' + l.text);
  if (!isLocal(l.state)) fail(l.pdfCase + ': state not L3T-local: ' + l.text);
  if (!closure.has(l.key)) fail(l.pdfCase + ': state outside the L3T coset: ' + l.text);
  // the flip-sequence contract: the whole appearance class lands formed
  l.app = appearance(l.state);
  for (const k of classOf.get(l.app)) {
    if (!structFormed(E.applyTable(l.T, closure.get(k)))) {
      fail(l.pdfCase + ': breaks the flip-sequence contract on a same-appearance state: ' + l.text);
    }
  }
}

// ---- grip-respelling pairs (state-identical lines within a case) ----
const RESPELL = { '4a': [0, 2], '4b': [1, 2], '4c': [0, 2], '6a': [0, 2], '6b': [1, 2] };
for (const c of sheet.cases) {
  if (c.sequences.length < 2) continue;
  const ls = lines.filter((l) => l.pdfCase === c.case);
  const pairs = [];
  for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) if (ls[i].key === ls[j].key) pairs.push([i, j]);
  const want = RESPELL[c.case];
  if (want) {
    if (pairs.length !== 1 || pairs[0][0] !== want[0] || pairs[0][1] !== want[1]) {
      fail('case ' + c.case + ': expected grip-respelling pair ' + JSON.stringify(want) + ', got ' + JSON.stringify(pairs));
    }
  } else if (pairs.length) {
    fail('case ' + c.case + ': unexpected state-identical lines ' + JSON.stringify(pairs));
  }
}
const distinct = new Set(lines.map((l) => l.key));
if (distinct.size !== 24) fail('expected 24 distinct line states, got ' + distinct.size);
// distinct across cases: no key belongs to two different pdf cases
{
  const owner = new Map();
  for (const l of lines) {
    if (owner.has(l.key) && owner.get(l.key) !== l.pdfCase) fail('cross-case state collision: ' + l.key);
    owner.set(l.key, l.pdfCase);
  }
}

// ---- cross-sheet pins ----
let zwExact = 0;
const zwPrimary = new Set(J.subsets['1L3T'].cases.map((c) => KEY(cso(c.algs[0].alg))));
for (const l of lines) if (zwPrimary.has(l.key)) zwExact++;
if (zwExact !== 1) fail('expected exactly 1 exact zwegner-primary collision, got ' + zwExact);
// the "11 possible permutations" pin: H over zwegner's group 1
{
  const TH = tbl('H');
  let n = 0;
  for (const [k, label] of zw) {
    if (!label.startsWith('1.') || P.has(k)) continue;
    if (P.has(KEY(E.applyTable(TH, closure.get(k))))) n++;
  }
  if (n !== 11) fail('H handles ' + n + ' zwegner group-1 states (sheet says 11)');
}

// ---- assemble the subset ----
const noteFor = (c, i, l) => {
  const want = RESPELL[c.case];
  if (want && i === want[1]) {
    return 'same physical solution as line ' + (want[0] + 1) + ', respelled from the rotated grip its leading [Uo] mark executes — state-identical, machine-verified';
  }
  if (/^\[Uo'?\]/.test(l.text)) {
    return 'solution for the Uo-rotated view of the case — the leading [Uo] mark executes as a whole-puzzle rotation (state-neutral re-grip)';
  }
  return null;
};
const outCases = [];
for (const c of sheet.cases) {
  if (c.case === '6c') continue;          // the solved/pair-formed placeholder — no sequence
  const ls = lines.filter((l) => l.pdfCase === c.case);
  outCases.push({
    name: '1LP ' + c.case,
    group: c.parity === 'Stays' ? 'Parity stays' : 'Parity flips',
    recognition: c.comment,
    moves_note: 'sheet parity column: ' + c.parity.toLowerCase() + ' — the author’s own permutation bookkeeping, carried verbatim',
    algs: ls.map((l, i) => {
      const note = noteFor(c, i, l);
      return note ? { alg: l.text, note } : { alg: l.text };
    }),
  });
}
if (outCases.length !== 11) fail('expected 11 imported cases, got ' + outCases.length);

J.subsets['1LP'] = {
  name: '1LP — One-Look Pair Formation',
  notation: 'cif',
  notation_note: 'The sheet’s dialect, all machine-verified: S/H are the sledge (R’ L R L’) and hedge (R B’ R’ B) triggers, (U)/(U’) are AUF turns written in parentheses (executed as the plain move), and [Uo]/[Uo’] are whole-puzzle rotation marks — a leading one gives the solution for a Uo-rotated view of the same case, a trailing one annotates the ending orientation (rotations never change the state). Diagrams show the exact state each case’s first sequence resolves. Every sequence is machine-verified as a correct flip sequence: from any state matching its case’s yellow/blue appearance it leaves all three pairs structurally formed, landing in the TCP stage. The parity column and comments are the sheet’s own prose.',
  description: 'One-look pair formation for the Bencisco last layer: form the three corner-triangle pairs in a single look, then finish with one of the 18 TCP algorithms (or 2-look). Pair formation is NEUTRAL (colors are ignored while pairing), rotationless, and ergonomic. Case 6c on the sheet is the already-paired state (omitted here). Solutions are given per AUF and per puzzle orientation; parity notes say whether a sequence preserves the permutation parity.',
  groups: ['Parity stays', 'Parity flips'],
  sources: [
    'One Look Pair Formation (1LP) Cases and Solutions, V3 — supplied as 1LP_Rotationless_V3.pdf (transcription: data/sources/1lp-rotationless-v3.json; author attribution pending)',
  ],
  cases: outCases,
};

// ---- meta ----
const totalCases = Object.values(J.subsets).reduce((a, s) => a + s.cases.length, 0);
const totalAlgs = Object.values(J.subsets).reduce((a, s) => a + s.cases.reduce((b, c) => b + c.algs.length, 0), 0);
J.meta.counts = { cases: totalCases, algs: totalAlgs };
J.meta.status = 'TCP (last layer) imported 2026-07-10; 1L3T (one-look last 3 triples) imported 2026-07-13 from zwegner’s page by tools/import-1l3t.mjs; LBT (last bottom triple) imported 2026-07-13 from zwegner’s page by tools/import-lbt.mjs; 1LP (one-look pair formation) imported 2026-07-13 from the user-supplied sheet by tools/import-1lp.mjs.';

// ---- stable serialization (same shape as import-1l3t/import-lbt) ----
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

console.log('== imported 1LP ==');
console.log('cases:', outCases.length, '(case 6c = solved placeholder, omitted)');
console.log('sequences:', lines.length, '| distinct states:', distinct.size, '| grip-respelled pairs:', Object.keys(RESPELL).length);
console.log('flip-sequence contract: every line, all 54 same-appearance states -> structurally formed  PASS');
console.log('coset 4320 | appearances 80x54 | formed 216 (4 appearances) | zwegner universe 537 | H-on-group-1 = 11');
console.log('totals now:', JSON.stringify(J.meta.counts));
