/* Skewbiks.com — Method solver app. Expects OOEngine, OORender, OOSolverCore, SiteNavbar. */
/* Skewb OO — Solver tab app. Expects OOEngine, OORender, OOSolverCore. */
(function () {
const E = window.OOEngine, R = window.OORender, CORE = window.OOSolverCore;
const { h, $, toast, tick, copyBtn, installErrorToast } = window.OODom;

/* ---- tables (shared dist cache via js/tables.js — same IndexedDB the OO page uses)
   + the alg data (fetched like the Algorithms page and the trainer: the
   finishing algorithms are the sheet's, their leading setup rotations
   folded into the one printed rotation) ---- */
let dist = null, C = null;
async function boot() {
  if (!window.OOTables) throw new Error('js/tables.js must load before js/solver.js');
  const label = $('#boot-label'), bar = $('#boot-bar'), track = $('#boot-track');
  const rep = (t, n, tot) => { const pct = Math.round(100 * n / tot); label.textContent = t; bar.style.width = pct + '%'; if (track) track.setAttribute('aria-valuenow', pct); };
  // dist is shared with the OO census (KEY_DIST); the census enriches the same
  // IndexedDB with its class tables under a separate key, so neither clobbers the other.
  const [d, algData] = await Promise.all([
    window.OOTables.loadOrBuildDist(E,
      (stage, n, tot) => rep(stage === 'cache' ? 'Loading cached tables…' : 'Mapping all 3,149,280 positions…', n, tot),
      tick),
    fetch('data/skewb_algs.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status + ' loading alg data'); return r.json(); }),
  ]);
  dist = d;
  rep('Preparing solver…', 0, 1);
  await tick();
  C = CORE.makeSolverCore(E, dist, algData);
  rep('Indexing the algorithm sheets…', 0, 1);
  await tick();
  C.algIndex();
  rep('Ready', 1, 1);
  const bootEl = $('#boot-status');
  bootEl.classList.add('gone');
  setTimeout(() => bootEl.remove(), 500);
  render();
  // restore saved preferences for a signed-in user, and again on any sign-in
  const A = window.OOAccount;
  if (A) {
    A.whenReady().then(() => { if (A.user) loadPrefs(); });
    A.onChange(() => { if (A.user) loadPrefs(); });
  }
}

/* ---- notation (shared preference with the other pages) ---- */
const NOTA_KEY = 'skewbiks-notation';
let NOTA = 'wca';
try { if (localStorage.getItem(NOTA_KEY) === 'ns') NOTA = 'ns'; } catch (e) {}
function setNota(v) {
  const next = v === 'ns' ? 'ns' : 'wca';
  if (next === NOTA) return;
  // carry the scramble text into the new notation — otherwise a re-Solve would
  // reparse the visible text under the other system and silently solve a
  // DIFFERENT scramble (most WCA strings are also valid NS with other corners)
  if (UI.scramble) {
    const conv = E.convertAlg(UI.scramble, NOTA, next);
    if (conv != null) UI.scramble = conv;
  }
  NOTA = next;
  try { localStorage.setItem(NOTA_KEY, NOTA); } catch (e) {}
  render();
}
const dispAlg = s => (s && NOTA === 'ns') ? E.wcaToNS(s) : s;   // engine WCA string -> active notation

/* ---- state ---- */
const UI = {
  scramble: '',
  parsed: null, state: null, dopt: null,
  methods: { fl: true, tcll: true, eg2: true },
  caps: Object.fromEntries(Object.keys(CORE.METHOD_DEFS).map(id => [id, CORE.METHOD_DEFS[id].cap])),
  buckets: null,            // total movecount -> items (raw from core)
  moreLens: false,          // longer-movecount cards expanded
  showAll: new Set(),       // totals whose full result list is expanded
  searching: false, truncated: false,
  optionsOpen: false,
};
const SHOW_LENS = 3;        // movecount cards shown before the expander
// labels come from the core's method registry (single source)
const METHOD_LABEL = Object.fromEntries(Object.keys(CORE.METHOD_DEFS).map(id => [id, CORE.METHOD_DEFS[id].name]));
const METHOD_ORDER = ['fl', 'tcll', 'eg2'];
// first-step comment for the reconstruction view, per method
const FACE_NAME = { U: 'top', D: 'bottom', F: 'front', B: 'back', R: 'right', L: 'left' };
const VLABEL = {
  fl: f => 'first layer (' + FACE_NAME[f] + ')',
  tcll: f => 'TCLL layer — one corner twisted (' + FACE_NAME[f] + ')',
  eg2: f => 'EG2 layer — corners swapped (' + FACE_NAME[f] + ')',
};
const RATING_TAG = { best: 'best', poor: 'poor' };

// build the staged reconstruction (first step / rotation / the sheet's
// algorithm verbatim / full line) for a solution
function reconstruction(it) {
  const mv = C.methodView(UI.state, it);
  if (!mv || !mv.ok) return null;
  const lines = [];
  lines.push({ mv: dispAlg(mv.vmoves) || '-', cmt: '// ' + VLABEL[it.id](mv.face) });
  if (it.row) {
    // the rotation is spelled in the sheets' physical letters (the letters
    // this community reads) in both notation modes — the engine's internal
    // x/y/z letters are never shown (see the core's physical model)
    if (mv.rot) lines.push({ mv: mv.rot, cmt: '// rotate — the algorithm runs from here' });
    const tag = RATING_TAG[mv.rating] ? ' · ' + RATING_TAG[mv.rating] : '';
    lines.push({ mv: mv.alg, cmt: '// ' + mv.name + tag + (mv.suspect ? ' · suspect' : '') });
  }
  const text = lines.map(l => (l.mv + (l.cmt ? '  ' + l.cmt : '')).trim()).join('\n')
    + '\nfull solution (NS)\n' + mv.text;
  return { lines, finalLabel: 'full solution (NS)', final: mv.text, text };
}

/* ---- per-user preferences (saved to the account when signed in) ---- */
// Only the tuning lives here — scramble and results stay session-local.
const PREF_KEYS = ['methods', 'caps'];
function snapshotPrefs() { const o = {}; for (const k of PREF_KEYS) o[k] = UI[k]; return o; }
function applyPrefs(p) {
  if (!p || typeof p !== 'object') return;
  // shape-validate against the current method registry (ignore foreign keys)
  if (p.methods && typeof p.methods === 'object')
    for (const id of Object.keys(CORE.METHOD_DEFS)) if (typeof p.methods[id] === 'boolean') UI.methods[id] = p.methods[id];
  if (p.caps && typeof p.caps === 'object')
    for (const id of Object.keys(CORE.METHOD_DEFS)) if (Number.isInteger(p.caps[id]) && p.caps[id] >= 0 && p.caps[id] <= 9) UI.caps[id] = p.caps[id];
}
let _saveTimer = null;
function persistPrefs() {
  const A = window.OOAccount;
  if (!A || !A.user) return;                 // nothing to save when signed out
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { A.saveUserDoc('solver', snapshotPrefs()).catch(e => console.error('Save prefs failed:', e)); }, 600);
}
async function loadPrefs() {
  const A = window.OOAccount;
  if (!A || !A.user) return;
  const p = await A.loadUserDoc('solver');     // cloud wins: account settings replace local
  if (p) { applyPrefs(p); render(); }
}

async function runSearch() {
  if (!UI.state) return;
  UI.searching = true; render();
  await tick(); await tick();
  try {
    const res = C.search(UI.state, { methods: UI.methods, caps: UI.caps });
    UI.buckets = res.byLength;
    UI.truncated = res.truncated;
  } catch (err) { console.error(err); toast('Something went wrong searching. Please try again.'); }
  UI.searching = false;
  render();
}
function fullResearch() { // a method or cap changed
  persistPrefs();
  UI.buckets = null; UI.showAll = new Set(); UI.moreLens = false;
  if (UI.state && UI.dopt > 0) runSearch();
}

function onSolve() {
  const txt = $('#scr-in').value.trim();
  if (!txt) return;
  const parsed = E.parseAlg(txt, NOTA === 'ns' ? 'ns' : undefined);
  if (!parsed) { toast('We couldn’t read that scramble. Use ' + (NOTA === 'ns' ? 'NS' : 'WCA') + ' notation (rotations are fine).'); return; }
  const st = E.applyParsed(parsed, E.solved(), C.syms, C.rotBy);
  UI.scramble = txt; UI.parsed = parsed; UI.state = st;
  UI.dopt = dist[E.idx(st)];
  UI.buckets = null; UI.showAll = new Set(); UI.moreLens = false; UI.truncated = false;
  if (UI.dopt === 0) { render(); return; }
  runSearch();
}

/* ---- views ---- */
// one solution: reconstruction block + method badge + movecount
function solutionRow(it) {
  const rec = reconstruction(it);
  if (!rec) return null;                     // never show a line that doesn't verify
  const badge = h('span', { class: 'mbadge', title: 'first step ' + it.v + ' moves → algorithm ' + it.fin + ' moves' },
    METHOD_LABEL[it.id] + ' ' + it.v + '+' + it.fin);
  const recEls = rec.lines.map(l =>
    h('div', { class: 'recline' }, h('span', { class: 'recmv mono' }, l.mv), l.cmt ? h('span', { class: 'reccmt' }, l.cmt) : null));
  recEls.push(h('div', { class: 'reclabel' }, rec.finalLabel));
  recEls.push(h('div', { class: 'recline final' }, h('code', { class: 'recmv mono sol' }, rec.final)));
  return h('div', { class: 'solrow solverrow' },
    h('div', { class: 'reconblock' }, h('div', { class: 'reconlines' }, ...recEls), copyBtn(rec.text)),
    h('div', { class: 'badgecell' }, badge),
    h('div', { class: 'solmeta', title: 'total moves as listed (first step + algorithm; rotations are free)' }, it.total + ' moves'));
}
function renderInner() {
  // a render can land while the user is typing (async loadPrefs, sign-in) —
  // carry an in-progress scramble draft across the rebuild instead of wiping it
  const prevIn = $('#scr-in');
  const draft = prevIn && prevIn.value !== UI.scramble
    ? { v: prevIn.value, focus: document.activeElement === prevIn, s: prevIn.selectionStart, e: prevIn.selectionEnd }
    : null;
  const root = $('#app'); root.innerHTML = '';
  root.appendChild(new SiteNavbar({ active: 'solver' }).element());
  const main = h('main', { class: 'page' }); root.appendChild(main);

  main.appendChild(h('section', { class: 'homeintro' },
    h('h1', null, 'Method solver'),
    h('p', { class: 'lede' }, 'Paste a scramble and get solutions you can actually find at the table: a first layer — or a TCLL / EG2 pre-layer — into an algorithm from the sheets, organized by move count. Every solution is checked by the computer.')));

  /* scramble row + notation switch */
  main.appendChild(h('div', { class: 'searchrow' },
    h('input', { id: 'scr-in', class: 'searchin mono', value: UI.scramble,
      placeholder: NOTA === 'ns' ? "Scramble, e.g.  r B' b l' B r' b'" : "Scramble, e.g.  R U' B L' U R' B'",
      onkeydown: ev => { if (ev.key === 'Enter') onSolve(); } }),
    h('button', { class: 'primary', onclick: onSolve }, 'Solve'),
    h('div', { class: 'notaswitch', role: 'group', 'aria-label': 'notation' },
      h('button', { class: 'notabtn' + (NOTA === 'wca' ? ' on' : ''), onclick: () => setNota('wca') }, 'WCA'),
      h('button', { class: 'notabtn' + (NOTA === 'ns' ? ' on' : ''), onclick: () => setNota('ns') }, 'NS'))));

  /* method toggles */
  const togRow = h('div', { class: 'methodrow' });
  for (const id of METHOD_ORDER) {
    togRow.appendChild(h('button', { class: 'methodchip' + (UI.methods[id] ? ' on' : ''), onclick: () => {
      UI.methods[id] = !UI.methods[id];
      fullResearch();
      render();
    } }, METHOD_LABEL[id]));
  }
  main.appendChild(togRow);

  /* options drawer */
  const drawer = h('section', { class: 'card optcard' },
    h('button', { class: 'opthead', onclick: () => { UI.optionsOpen = !UI.optionsOpen; render(); } },
      (UI.optionsOpen ? '▾' : '▸') + ' Options: first-step caps'));
  if (UI.optionsOpen) {
    const capIn = (id) => h('label', { class: 'capin' }, METHOD_LABEL[id],
      h('input', { type: 'number', min: '0', max: '9', value: UI.caps[id], onchange: ev => { UI.caps[id] = +ev.target.value; fullResearch(); } }));
    drawer.appendChild(h('div', { class: 'optgrid' },
      h('div', { class: 'optcol' },
        h('h4', null, 'First-step length caps'),
        h('div', { class: 'caprow' }, ...METHOD_ORDER.map(capIn)),
        h('p', { class: 'opthint' }, 'How many moves the layer (or pre-layer) may take. Every first layer is reachable in 6; TCLL in 6; EG2 in 7.')),
      h('div', { class: 'optcol' },
        h('h4', null, 'Ranking'),
        h('p', { class: 'opthint' }, 'Solutions are organized purely by move count for now — the first step plus the sheet’s algorithm. Fingertrick / comfort ranking is planned once the metrics are worked out with top solvers.'))));
  }
  main.appendChild(drawer);

  /* scramble preview */
  if (UI.state) {
    main.appendChild(h('section', { class: 'pairrow single' },
      h('div', { class: 'sidepanel' },
        h('div', { class: 'sidehead' },
          h('span', { class: 'sidelabel' }, 'scramble'),
          h('span', { class: 'depthchip' }, UI.dopt === 0 ? 'already solved' : 'optimal: ' + UI.dopt + ' moves')),
        h('div', { class: 'netwrap', html: R.netSVG(UI.state, 300) }))));
  }

  if (UI.searching) main.appendChild(h('p', { class: 'empty' }, 'Searching…'));
  if (UI.truncated) main.appendChild(h('p', { class: 'warnline' }, 'The search hit its work limit, so the lists may be incomplete. Tighten the caps to search everything.'));

  /* results, shortest movecount first */
  if (UI.buckets) {
    const lens = Object.keys(UI.buckets).map(Number).sort((a, b) => a - b);
    const shown = UI.moreLens ? lens : lens.slice(0, SHOW_LENS);
    let anyRow = false;
    for (const L of shown) {
      const items = UI.buckets[L] || [];
      const rows = [];
      for (const it of items.slice(0, UI.showAll.has(L) ? items.length : 10)) {
        const el = solutionRow(it);
        if (el) { rows.push(el); anyRow = true; }
      }
      const sec = h('section', { class: 'card solcard' },
        h('h3', null, L + ' moves' + (L === UI.dopt ? ', optimal' : ''),
          h('span', { class: 'counttag' }, items.length + (items.length === 1 ? ' solution' : ' solutions'))));
      rows.forEach(r => sec.appendChild(r));
      if (!rows.length) sec.appendChild(h('p', { class: 'empty' }, 'No method solutions at this length.'));
      if (items.length > 10 && !UI.showAll.has(L))
        sec.appendChild(h('button', { class: 'ghost sm', onclick: () => { UI.showAll.add(L); render(); } }, 'show all ' + items.length));
      main.appendChild(sec);
    }
    if (!UI.moreLens && lens.length > SHOW_LENS)
      main.appendChild(h('button', { class: 'ghost', onclick: () => { UI.moreLens = true; render(); } },
        'show longer solutions (' + (lens.length - SHOW_LENS) + ' more move counts)'));
    if (!lens.length || (!anyRow && !UI.moreLens && lens.length <= SHOW_LENS))
      main.appendChild(h('p', { class: 'empty' }, 'No method solutions found — the cases these first steps leave aren’t in the sheets yet. Try enabling more methods or raising the caps.'));
  }
  if (UI.state && UI.dopt === 0) main.appendChild(h('p', { class: 'empty' }, 'Nothing to solve. That scramble leaves the puzzle solved.'));
  if (!UI.state) main.appendChild(h('p', { class: 'empty hintline' }, 'The badge on each solution reads like “Layer 3+9”: a 3-move first layer, then the 9-move sheet algorithm that finishes it.'));
  if (draft) {
    const inp = $('#scr-in');
    inp.value = draft.v;
    if (draft.focus) { inp.focus(); try { inp.setSelectionRange(draft.s, draft.e); } catch (e) {} }
  }
}
function render() {
  try { renderInner(); }
  catch (err) {
    console.error(err);
    const root = $('#app'); root.innerHTML = '';
    const card = h('div', { class: 'card solcard', style: 'margin:48px auto;max-width:680px;border-color:rgba(232,71,61,.5)' },
      'Something went wrong loading this page. Try reloading.');
    root.appendChild(card);
  }
}
installErrorToast();
window.OOSolver = { get UI() { return UI; }, runSearch, onSolve, get C() { return C; } };
window.addEventListener('DOMContentLoaded', boot);
})();
