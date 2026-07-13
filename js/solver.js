/* fto.twistytools.com — Bencisco method solver app (M5).
   Expects OOEngine, OOTables, OORender, OOSolverCore, SiteNavbar, OODom. */
(function () {
const E = window.OOEngine, T = window.OOTables, R = window.OORender, CORE = window.OOSolverCore;
const { h, $, toast, tick, copyBtn, installErrorToast } = window.OODom;

/* ---- boot: pruning tables (IndexedDB-cached; ~4 MB, seconds to build)
   + the alg data (fetched like the Algorithms page and the trainer — the
   LBT / 1L3T / TCP finishing algorithms are the sheets', verbatim) ---- */
let C = null;
async function boot() {
  if (!window.OOTables) throw new Error('js/tables.js must load before js/solver.js');
  const label = $('#boot-label'), bar = $('#boot-bar'), track = $('#boot-track');
  const rep = (t2, n, tot) => {
    const pct = Math.max(0, Math.min(100, Math.round(100 * n / tot)));
    label.textContent = t2; bar.style.width = pct + '%';
    if (track) track.setAttribute('aria-valuenow', pct);
  };
  const stage = (s, n, tot) => {
    if (s === 'cache') rep('Loading cached tables…', 1, 1);
    else if (s === 'mtab') rep('Deriving move tables…', n, tot);
    else rep('Building pruning tables…', n, tot);
  };
  const [pdb, algData] = await Promise.all([
    T.loadOrBuildPDBs(E, stage, tick),
    fetch('data/fto_algs.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status + ' loading alg data'); return r.json(); }),
  ]);
  rep('Preparing the solver…', 0, 1);
  await tick();
  C = CORE.makeSolverCore(E, T, pdb, algData);
  C.finishIndex();
  rep('Ready', 1, 1);
  const bootEl = $('#boot-status');
  bootEl.classList.add('gone');
  setTimeout(() => bootEl.remove(), 500);
  render();
  const A = window.OOAccount;
  if (A) {
    A.whenReady().then(() => { if (A.user) loadPrefs(); });
    A.onChange(() => { if (A.user) loadPrefs(); });
  }
}

/* ---- state ---- */
const ORIENT_LABEL = {
  auto: 'Auto', fixed: 'As scrambled', vertical: 'Vertical spins', full: 'Fully color neutral',
};
const ORIENT_HINT = {
  auto: 'Solve in the scrambling hold first; widen to other holds only when the sheets have no path.',
  fixed: 'One orientation: exactly the hold the scramble leaves.',
  vertical: 'Also try the two spins about the top face (3 holds).',
  full: 'Try all 24 holds. Slow: expect tens of seconds.',
};
const UI = {
  scramble: '',
  state: null,
  orient: 'auto',
  beam: CORE.DEFAULTS.beam,
  result: null,             // { byLength, best, ... } from the core
  moreLens: false,
  showAll: new Set(),
  searching: false,
  optionsOpen: false,
};
const SHOW_LENS = 3;

/* ---- per-user preferences ---- */
function snapshotPrefs() { return { orient: UI.orient, beam: UI.beam }; }
function applyPrefs(p) {
  if (!p || typeof p !== 'object') return;
  if (typeof p.orient === 'string' && ORIENT_LABEL[p.orient]) UI.orient = p.orient;
  if (Number.isInteger(p.beam) && p.beam >= 2 && p.beam <= 10) UI.beam = p.beam;
}
let _saveTimer = null;
function persistPrefs() {
  const A = window.OOAccount;
  if (!A || !A.user) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { A.saveUserDoc('solver', snapshotPrefs()).catch(e => console.error('Save prefs failed:', e)); }, 600);
}
async function loadPrefs() {
  const A = window.OOAccount;
  if (!A || !A.user) return;
  const p = await A.loadUserDoc('solver');
  if (p) { applyPrefs(p); render(); }
}

/* ---- search ---- */
async function runSearch() {
  if (!UI.state) return;
  UI.searching = true; UI.result = null; render();
  await tick(); await tick();
  try {
    UI.result = C.search(UI.state, { orient: UI.orient, beam: UI.beam });
  } catch (err) { console.error(err); toast('Something went wrong searching. Please try again.'); }
  UI.searching = false;
  render();
}
function onSolve() {
  const txt = $('#scr-in').value.trim();
  if (!txt) return;
  const parsed = E.parseAlg(txt);
  if (!parsed) { toast('We couldn’t read that scramble. Use the site notation (U F R L D B BR BL, w/s/o suffixes, T).'); return; }
  UI.scramble = txt;
  UI.state = E.applyParsed(parsed, E.solved());
  UI.result = null; UI.showAll = new Set(); UI.moreLens = false;
  if (E.eq(UI.state, E.solved())) { render(); return; }
  runSearch();
}
function onRandom() {
  const txt = E.randomScramble(30);
  UI.scramble = txt;
  const inp = $('#scr-in');
  if (inp) inp.value = txt;
  onSolve();
}

/* ---- views ---- */
// staged reconstruction rows for one solution line
function reconstruction(it) {
  const lines = [];
  if (it.rotSpell) lines.push({ mv: it.rotSpell, cmt: '// rotate the puzzle; the solve reads from this hold' });
  for (const seg of it.segs) {
    let cmt = '// ' + seg.label;
    if (seg.caseName) cmt += ' · ' + seg.subset + ' ' + seg.caseName;
    lines.push({ mv: seg.text, cmt, note: seg.note || null });
  }
  // one continuous line is shown only when the engine proves that flat
  // reading too (an algorithm that nets a re-grip would make it misleading)
  const flat = [it.rotSpell, ...it.segs.map(s => s.text)].filter(Boolean).join(' ');
  let flatOk = false;
  try {
    const p = E.parseAlg(flat);
    flatOk = !!p && E.eq(E.applyParsed(p, E.copy(UI.state)), E.solved());
  } catch (e) { flatOk = false; }
  const text = lines.map(l => (l.mv + '  ' + l.cmt).trim()).join('\n') + (flatOk ? '\nfull line\n' + flat : '');
  return { lines, flat: flatOk ? flat : null, text };
}
function solutionRow(it) {
  const rec = reconstruction(it);
  const recEls = rec.lines.map(l =>
    h('div', { class: 'recline' },
      h('span', { class: 'recmv mono' }, l.mv),
      l.cmt ? h('span', { class: 'reccmt', title: l.note || undefined }, l.cmt + (l.note ? ' ⚠' : '')) : null));
  if (rec.flat) {
    recEls.push(h('div', { class: 'reclabel' }, 'full line'));
    recEls.push(h('div', { class: 'recline final' }, h('code', { class: 'recmv mono sol' }, rec.flat)));
  }
  const badge = h('span', { class: 'mbadge', title: 'machine-verified end to end' }, 'Bencisco ✓');
  return h('div', { class: 'solrow solverrow' },
    h('div', { class: 'reconblock' }, h('div', { class: 'reconlines' }, ...recEls), copyBtn(rec.text)),
    h('div', { class: 'badgecell' }, badge),
    h('div', { class: 'solmeta', title: 'total turns as listed (rotations are free)' }, it.total + ' moves'));
}
function renderInner() {
  const prevIn = $('#scr-in');
  const draft = prevIn && prevIn.value !== UI.scramble
    ? { v: prevIn.value, focus: document.activeElement === prevIn, s: prevIn.selectionStart, e: prevIn.selectionEnd }
    : null;
  const root = $('#app'); root.innerHTML = '';
  root.appendChild(new SiteNavbar({ active: 'solver' }).element());
  const main = h('main', { class: 'page' }); root.appendChild(main);

  main.appendChild(h('section', { class: 'homeintro' },
    h('h1', null, 'Method solver'),
    h('p', { class: 'lede' },
      'Paste a scramble and get a full Bencisco solve you can actually follow: first center, two bottom triples, the remaining centers, then the sheet algorithms for the last bottom triple and the last three triples. Every line is checked by the computer, end to end.')));

  /* scramble row */
  main.appendChild(h('div', { class: 'searchrow' },
    h('input', { id: 'scr-in', class: 'searchin mono', value: UI.scramble,
      placeholder: "Scramble, e.g.  R U' B L' U R' B' D BR' L",
      onkeydown: ev => { if (ev.key === 'Enter') onSolve(); } }),
    h('button', { class: 'primary', onclick: onSolve }, 'Solve'),
    h('button', { class: 'ghost', onclick: onRandom, title: '30 random moves' }, 'Random')));

  /* options drawer */
  const drawer = h('section', { class: 'card optcard' },
    h('button', { class: 'opthead', onclick: () => { UI.optionsOpen = !UI.optionsOpen; render(); } },
      (UI.optionsOpen ? '▾' : '▸') + ' Options: orientations, search width'));
  if (UI.optionsOpen) {
    drawer.appendChild(h('div', { class: 'optgrid' },
      h('div', { class: 'optcol' },
        h('h4', null, 'Puzzle orientations'),
        h('div', { class: 'methodrow' }, ...Object.keys(ORIENT_LABEL).map(k =>
          h('button', { class: 'methodchip' + (UI.orient === k ? ' on' : ''), onclick: () => {
            UI.orient = k; persistPrefs(); render();
            if (UI.state && UI.result) runSearch();
          } }, ORIENT_LABEL[k]))),
        h('p', { class: 'opthint' }, ORIENT_HINT[UI.orient])),
      h('div', { class: 'optcol' },
        h('h4', null, 'Search width'),
        h('label', { class: 'capin' }, 'lines kept per step',
          h('input', { type: 'number', min: '2', max: '10', value: UI.beam, onchange: ev => {
            const v = +ev.target.value;
            if (Number.isInteger(v) && v >= 2 && v <= 10) { UI.beam = v; persistPrefs(); if (UI.state && UI.result) runSearch(); }
          } })),
        h('p', { class: 'opthint' },
          'More lines explore more step alternatives (slower, sometimes shorter). Solutions are organized purely by move count; the step searches are optimal for the first center and triples and near-optimal for the later centers. No global optimum is claimed; nobody knows FTO’s God’s number.'))));
  }
  main.appendChild(drawer);

  /* scramble preview */
  if (UI.state) {
    main.appendChild(h('section', { class: 'pairrow single' },
      h('div', { class: 'sidepanel' },
        h('div', { class: 'sidehead' },
          h('span', { class: 'sidelabel' }, 'scramble'),
          h('span', { class: 'depthchip' }, E.eq(UI.state, E.solved()) ? 'already solved' : 'Bencisco: center → triples → centers → LBT → L3T')),
        h('div', { class: 'netwrap', html: R.netSVG(UI.state, 300) }))));
  }

  if (UI.searching) main.appendChild(h('p', { class: 'empty' }, 'Searching… (a few seconds; the page may pause)'));

  /* results */
  const res = UI.result;
  if (res) {
    if (res.best == null) {
      main.appendChild(h('p', { class: 'warnline' },
        'No verified solve found for this scramble' + (UI.orient === 'auto' ? '' : ' in this orientation mode (try Auto)') + '. This should be rare; the search log counted ' +
        res.failures.step + ' step dead-ends and ' + (res.failures.lbt + res.failures.l3t) + ' junctions outside the sheets.'));
    } else {
      if (res.truncated) main.appendChild(h('p', { class: 'warnline' },
        'The search hit its work limit; the lists may be incomplete.'));
      const lens = Object.keys(res.byLength).map(Number).sort((a, b) => a - b);
      const shown = UI.moreLens ? lens : lens.slice(0, SHOW_LENS);
      for (const L of shown) {
        const items = res.byLength[L] || [];
        const sec = h('section', { class: 'card solcard' },
          h('h3', null, L + ' moves' + (L === res.best ? ', shortest found' : ''),
            h('span', { class: 'counttag' }, items.length + (items.length === 1 ? ' solution' : ' solutions'))));
        for (const it of items.slice(0, UI.showAll.has(L) ? items.length : 6)) sec.appendChild(solutionRow(it));
        if (items.length > 6 && !UI.showAll.has(L))
          sec.appendChild(h('button', { class: 'ghost sm', onclick: () => { UI.showAll.add(L); render(); } }, 'show all ' + items.length));
        main.appendChild(sec);
      }
      if (!UI.moreLens && lens.length > SHOW_LENS)
        main.appendChild(h('button', { class: 'ghost', onclick: () => { UI.moreLens = true; render(); } },
          'show longer solutions (' + (lens.length - SHOW_LENS) + ' more move counts)'));
    }
  }
  if (UI.state && E.eq(UI.state, E.solved()))
    main.appendChild(h('p', { class: 'empty' }, 'Nothing to solve. That scramble leaves the puzzle solved.'));
  if (!UI.state)
    main.appendChild(h('p', { class: 'empty hintline' },
      'Solves follow the Bencisco method. The algorithms for the last bottom triple and the last three triples come verbatim from the sheets on the Algorithms page.'));
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
    root.appendChild(h('div', { class: 'card solcard', style: 'margin:48px auto;max-width:680px;border-color:rgba(232,71,61,.5)' },
      'Something went wrong loading this page. Try reloading.'));
  }
}
installErrorToast();
window.OOSolver = { get UI() { return UI; }, runSearch, onSolve, get C() { return C; } };
window.addEventListener('DOMContentLoaded', boot);
})();
