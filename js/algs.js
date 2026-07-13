/* fto.twistytools.com — Algorithms page (M3): data-driven, read-only.
 *
 * Fetches data/fto_algs.json (the single authoring source) and renders one
 * tab per subset, group pills, search, and a case card per case: diagram
 * (the exact state the primary alg solves, via the engine's caseStateOf in
 * the subset's declared hold dialect), recognition text, and the authored
 * algs VERBATIM (brackets, doubles, wides as written) with move counts.
 * Editing happens in the JSON (commit + npm run build); the Skewb parent's
 * in-page admin editor returns later if needed — git history has it.
 * Expects OOEngine, OORender, SiteNavbar, OODom (script order in algs.html).
 */
(function () {
  'use strict';
  const E = window.OOEngine, R = window.OORender, D = window.OODom;
  const { h, $ } = D;
  D.installErrorToast();

  new SiteNavbar({ active: 'algs' }).mount(document.body);
  const app = $('#app');
  app.appendChild(h('div', { class: 'algwrap' }, h('p', { class: 'sub' }, 'Loading the algorithm sheet…')));

  const UI = { data: null, subset: null, group: 'All', q: '' };

  // tokenize an authored alg for display: rotations ({X,Y}, Xo, T…) tinted
  function algSpan(text) {
    const el = h('span', { class: 'alg' });
    for (const tok of String(text).replace(/\s+/g, ' ').trim().split(' ')) {
      const isRot = /^\{/.test(tok) || /o'?2?$/.test(tok) || /^T2?'?$/.test(tok);
      el.appendChild(h('span', { class: 'tok' + (isRot ? ' rot' : '') }, tok));
    }
    return el;
  }

  function caseCard(subset, c) {
    const primary = c.algs && c.algs.length ? c.algs[0] : null;
    const dial = (primary && primary.notation) || subset.notation;
    const cs = primary ? E.caseStateOf(primary.alg, dial) : null;
    return h('div', { class: 'casecard', id: 'case-' + encodeURIComponent(c.name) },
      h('div', { class: 'casehd' },
        h('span', { class: 'casename' }, c.name),
        c.group ? h('span', { class: 'ratetag', style: 'margin-left:10px' }, c.group) : null),
      h('div', { class: 'casebody' },
        h('div', { class: 'sidegrp' },
          h('div', { class: 'algnet' + (cs ? '' : ' empty'), html: cs ? R.netSVG(cs, 340, { cls: 'skewbsvg', thumb: true }) : '' }),
          h('div', { class: 'sidebody' },
            c.recognition ? h('p', { class: 'sub', style: 'margin:0 0 8px' }, c.recognition) : null,
            ...(c.algs || []).map(a =>
              h('div', { class: 'algrow' },
                algSpan(a.alg),
                h('span', { class: 'ratetag' }, (c.moves != null ? c.moves : E.countMoves(E.parseAlg(a.alg) || [])) + ' moves'),
                a.note ? h('span', { class: 'ratetag', title: a.note, style: 'cursor:help' },
                  /working-slot/.test(a.note) ? '⚠ variant' : '⚠ final AUF') : null,
                D.copyBtn(a.alg))),
            c.moves_note ? h('p', { class: 'sub', style: 'margin:6px 0 0;font-size:12px' }, '(' + c.moves_note + ')') : null))));
  }

  // a credit line with its URLs clickable
  function sourceLine(s) {
    const parts = String(s).split(/(https?:\/\/[^\s)]+)/g).filter(Boolean);
    return h('p', { class: 'sub', style: 'margin:2px 0;font-size:12px' },
      ...parts.map(p => /^https?:\/\//.test(p)
        ? h('a', { href: p, target: '_blank', rel: 'noopener' }, p)
        : p));
  }

  function matches(c) {
    if (UI.group !== 'All' && c.group !== UI.group) return false;
    if (!UI.q) return true;
    const hay = (c.name + ' ' + (c.recognition || '') + ' ' + (c.algs || []).map(a => a.alg).join(' ')).toLowerCase();
    return hay.indexOf(UI.q.toLowerCase()) >= 0;
  }

  function render() {
    const data = UI.data, subset = data.subsets[UI.subset];
    const subsetKeys = Object.keys(data.subsets);
    const groups = ['All'].concat(subset.groups || []);
    const cases = (subset.cases || []).filter(matches);
    app.replaceChildren(h('div', { class: 'algwrap' },
      h('div', { class: 'alghead' },
        h('h1', null, 'Algorithms'),
        h('p', { class: 'sub' }, subset.description || data.meta.description)),
      subsetKeys.length > 1
        ? h('div', { class: 'sectabs' }, subsetKeys.map(k =>
            h('button', { class: 'sectab' + (k === UI.subset ? ' on' : ''), onclick: () => { UI.subset = k; UI.group = 'All'; render(); } }, k)))
        : null,
      h('div', { class: 'algtoolbar' },
        h('div', { class: 'subtabs' }, groups.map(g =>
          h('button', { class: 'subtab' + (g === UI.group ? ' on' : ''), onclick: () => { UI.group = g; render(); } }, g))),
        (() => { const inp = h('input', { class: 'algsearch', type: 'search', placeholder: 'Search cases, recognition, algs…', value: UI.q,
          oninput: () => { UI.q = inp.value; renderCases(); } }); return inp; })(),
        h('span', { class: 'algstatus' }, cases.length + ' / ' + (subset.cases || []).length + ' cases')),
      h('div', { class: 'subset' }, h('div', { class: 'casegrid', id: 'casegrid' },
        cases.map(c => caseCard(subset, c)))),
      subset.notation_note
        ? h('p', { class: 'sub', style: 'margin-top:14px;font-size:12px' },
            'Hold: ' + (subset.notation || 'cif').toUpperCase() + '. ' + subset.notation_note)
        : null,
      subset.sources && subset.sources.length
        ? h('div', { style: 'margin-top:18px' },
            h('div', { class: 'sidehd' }, 'Sources & credits'),
            ...subset.sources.map(sourceLine))
        : null));
  }
  // search-only refresh (keeps the input focused)
  function renderCases() {
    const subset = UI.data.subsets[UI.subset];
    const cases = (subset.cases || []).filter(matches);
    const grid = $('#casegrid');
    if (grid) grid.replaceChildren(...cases.map(c => caseCard(subset, c)));
    const st = $('.algstatus');
    if (st) st.textContent = cases.length + ' / ' + (subset.cases || []).length + ' cases';
  }

  fetch('data/fto_algs.json')
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(data => {
      UI.data = data;
      UI.subset = Object.keys(data.subsets)[0];
      render();
    })
    .catch(err => {
      app.replaceChildren(h('div', { class: 'algwrap' },
        h('p', { class: 'sub' }, 'Could not load the algorithm data (' + err.message + '). Serve the site over HTTP (e.g. npx serve) — file:// cannot fetch JSON.')));
    });
})();
