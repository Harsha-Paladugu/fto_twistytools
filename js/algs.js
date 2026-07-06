/* Skewbiks.com — algorithm reference + admin editor.
 *
 * Browse every subset and case with its algorithms, search across them, and —
 * when signed in as an admin — add or remove algorithms per case.
 *
 * Single source of truth: data/skewb_algs.json (version-controlled). This
 * page reads it directly; the trainer/solver read the compiled js/sheet.js
 * derived from it. There is no live shared store — admin edits are a per-browser
 * DRAFT (localStorage) published with the Export button (download JSON → commit
 * → rebuild). Alg display notation is normalized by the shared engine.normAlg,
 * the same function the compiler uses, so this page and the trainer match.
 *
 * Presentations: there is no state-level 90° y symmetry on a Skewb (a y swaps
 * the corner tetrads), so the four viewing presentations of a case pair at the
 * DATA level. prependAUF(p, frontAlg) is the alg for the case seen at
 *   p = 0 Front, 1 Right, 2 Back, 3 Left
 * (standard convention: the case appears on the Right → rotate y → the former
 * Right face is in front → run the Front alg). Each case card shows one
 * diagram + alg list per presentation; the labels are computed geometrically
 * from the case's first parsable alg (the anchor), seeded by its authored
 * `direction` — the JSON `direction` field itself is authoring metadata.
 *
 * A newly entered alg is auto-checked: it must actually solve one of the
 * case's presentations, which decides the direction group it is filed under.
 * Algs that don't solve the case are rejected. Input follows the WCA / NS
 * toolbar switch; NS input is converted and stored as WCA (the JSON's
 * authored notation).
 */
(function () {
  'use strict';

  const A = window.OOAccount;
  const R = window.OORender;
  const E = window.OOEngine;
  const CFG = window.OO_CONFIG || {};
  const adminEmails = (CFG.adminEmails || []).map(e => e.toLowerCase());
  const app = document.getElementById('app');

  // ---------- tiny hyperscript (shared, js/dom.js) ----------
  const { h } = window.OODom;

  // ---------- engine keying / canonicalization (single source: js/engine.js) ----------
  const { stateKey, realCanonKey, caseStateOf, prependAUF } = E;

  // ---------- notation (NS default here — the method sheets are NS-native and
  // their authored form, rotations included, is the executable one; shared
  // preference key with oo.html, so an explicit choice anywhere sticks) ----------
  const NOTA_KEY = 'skewbiks-notation';
  let NOTA = 'ns';
  try { const v = localStorage.getItem(NOTA_KEY); if (v === 'wca' || v === 'ns') NOTA = v; } catch (e) {}
  function setNota(v) {
    NOTA = v === 'ns' ? 'ns' : 'wca';
    try { localStorage.setItem(NOTA_KEY, NOTA); } catch (e) {}
    renderToolbarNota();
    renderMain();
  }
  const dispAlg = (s) => (s && NOTA === 'ns') ? E.wcaToNS(s) : s; // stored WCA -> active notation
  // active-notation input -> stored WCA (null if unparseable in that notation)
  const inputToWCA = (raw) => NOTA === 'ns' ? E.nsToWCA(raw) : raw;

  // ---------- presentations ----------
  const DIRS = ['Front', 'Right', 'Back', 'Left'];
  const dirLabel = (side) => side || 'Algorithms';
  const sideRank = (side) => { const i = DIRS.indexOf(side); return i < 0 ? DIRS.length : i; };
  const isRotTok = (t) => /^[xyz](2'|2|')?$/.test(t);
  function stripPostRot(alg) { // trailing whole-cube rotations are cosmetic
    const toks = String(alg).trim().split(/\s+/).filter(Boolean);
    while (toks.length && isRotTok(toks[toks.length - 1])) toks.pop();
    return toks.join(' ');
  }

  // ---------- data model ----------
  let DATA = null;                 // parsed skewb_algs.json
  let SUBSETMAP = {};              // subsetKey -> {key, name, cases:[{name, algs}]}
  let SECTIONS = [];               // one top-level tab per subset, in authored order
  const overrides = new Map();     // caseId -> {subset, case, added:[{alg,side}], removed:Set, order:[]}

  const getCase = (subKey, name) => { const s = SUBSETMAP[subKey]; return s && s.cases.find(c => c.name === name); };
  const caseId = (subsetKey, caseName) => subsetKey + ' ' + caseName;

  function buildModel() {
    SUBSETMAP = {};
    SECTIONS = [];
    for (const cont of [DATA.subsets, DATA.other_subsets || {}]) {
      for (const key of Object.keys(cont)) {
        // keep every authored case field (corner/sign/id/center/caseId/…) —
        // the subset's `nav` block groups, filters and sorts by them.
        SUBSETMAP[key] = { key, name: cont[key].name || key, nav: cont[key].nav || null,
          cases: cont[key].cases.map(c => Object.assign({}, c, { algs: c.algs.slice() })) };
        SECTIONS.push({ id: key, label: cont[key].name || key });
      }
    }
  }

  // ---------- subset navigation (authored `nav`: group tabs + filter + sort) ----------
  const groupSel = {};   // subset key -> selected group value
  const filterSel = {};  // subset key + '::' + group -> selected dropdown value ('' = all)
  function activeGroup(sub) {
    if (!sub.nav || !sub.nav.group || !sub.nav.group.values.length) return null;
    const vals = sub.nav.group.values.map(v => v.value);
    return vals.indexOf(groupSel[sub.key]) >= 0 ? groupSel[sub.key] : vals[0];
  }
  function activeFilter(sub) {
    const g = activeGroup(sub);
    return (g !== null && filterSel[sub.key + '::' + g]) || '';
  }
  // comparator from the subset's sort spec: explicit `order` list, or
  // `natural` (numeric prefix + suffix, so 2a < 10a); authored order breaks ties.
  function navCmp(sub) {
    const ix = new Map(sub.cases.map((c, i) => [c, i]));
    const spec = sub.nav && sub.nav.sort;
    if (!spec) return (a, b) => ix.get(a) - ix.get(b);
    const rank = (c) => {
      const v = c[spec.field];
      if (spec.order) { const i = spec.order.indexOf(v); return [i < 0 ? 1e9 : i, '']; }
      const m = spec.natural && String(v == null ? '' : v).match(/^(\d+)(.*)$/);
      return m ? [parseInt(m[1], 10), m[2]] : [1e9, String(v == null ? '' : v)];
    };
    return (a, b) => {
      const ra = rank(a), rb = rank(b);
      return (ra[0] - rb[0]) || (ra[1] < rb[1] ? -1 : ra[1] > rb[1] ? 1 : 0) || (ix.get(a) - ix.get(b));
    };
  }
  // the browsing view: the active group, narrowed by the dropdown, in nav order
  function visibleCases(sub) {
    let list = sub.cases;
    const g = activeGroup(sub);
    if (g !== null) {
      list = list.filter(c => c[sub.nav.group.field] === g);
      const f = activeFilter(sub);
      if (f) list = list.filter(c => c[sub.nav.filter.field] === f);
    }
    return list.slice().sort(navCmp(sub));
  }

  // per-case presentation geometry, derived from the anchor = the first
  // surviving (not tombstoned) alg that parses to a clean case state:
  //   pks[p]   = render key of the case seen at presentation offset p from the
  //              anchor's own view (prependAUF(p, anchor))
  //   canons   = the case's canonical keys (≤ 2: Front/Back + Right/Left)
  //   anchorDir= the anchor's authored direction (labels pks[0]); Front if unset
  const presCache = new Map();
  function casePres(subsetKey, c) {
    const id = caseId(subsetKey, c.name);
    if (presCache.has(id)) return presCache.get(id);
    const ov = overrides.get(id);
    const removed = (ov && ov.removed) || new Set();
    const pool = [...c.algs.filter(a => !removed.has(a.alg)), ...((ov && ov.added) || [])];
    let out = { pks: null, canons: new Set(), anchorDir: 'Front' };
    for (const a of pool) {
      const core = stripPostRot(E.normAlg(a.alg));
      const cs = caseStateOf(core);
      if (!cs) continue;
      const pks = [], canons = new Set();
      let ok = true;
      for (let p = 0; p < 4; p++) {
        const st = p === 0 ? cs : caseStateOf(prependAUF(p, core));
        if (!st) { ok = false; break; }
        pks.push(stateKey(st));
        canons.add(realCanonKey(st));
      }
      if (!ok) continue;
      const dir = a.side || a.direction; // added rows carry `side`, baseline `direction`
      out = { pks, canons, anchorDir: DIRS.includes(dir) ? dir : 'Front' };
      break;
    }
    presCache.set(id, out);
    return out;
  }
  function dirOfKey(subsetKey, c, key) {
    const cp = casePres(subsetKey, c);
    const p = cp.pks ? cp.pks.indexOf(key) : -1;
    return p < 0 ? '' : DIRS[(DIRS.indexOf(cp.anchorDir) + p) % 4];
  }

  // one display row from a stored alg: trailing rotations stripped, plus the
  // exact case state the core solves. `meta` is the authored item (ns original,
  // rating, firstMove, …) so display can show the sheet's executable form.
  const ordIx = (ord, alg) => { const i = ord.indexOf(alg); return i < 0 ? 1e9 : i; };
  function makeRow(a, source) {
    const core = stripPostRot(E.normAlg(a.alg));
    const cs = caseStateOf(core);
    return { alg: a.alg, meta: a, source, core, state: cs, display: core, solves: !!cs };
  }
  // Sheet algs always display their authored notation verbatim — rotations
  // included, they're part of how the alg is executed. (WCA's four letters
  // can't name the free-corner moves, so no rotation-preserving WCA form
  // exists; the rotationless conversion is kept for keying and for the WCA
  // input mode only.) Algs without an authored form (admin-added) follow the
  // notation toggle.
  const rowText = (r) => (r.meta && r.meta.ns) ? r.meta.ns : dispAlg(r.display);
  // alg text as evenly-spaced tokens, rotations tinted so the regrips pop
  const isRotTok2 = (t) => /^[xyz](2'|2|')?$/.test(t);
  function algText(r) {
    return h('span', { class: 'mono alg' },
      String(rowText(r)).split(/\s+/).filter(Boolean).map(t =>
        h('span', { class: isRotTok2(t) ? 'tok rot' : 'tok' }, t)));
  }

  // ---------- first moves ----------
  // Every case lists the 8 possible first moves (the sheets' convention); each
  // alg files under the first move it makes FROM THE ANGLE ITS DIAGRAM SHOWS —
  // so you can pick the alg that cancels your last first-layer move. Imported
  // algs carry the value; for admin-added ones we compute it: the WCA→NS→WCA
  // round trip absorbs any typed rotations, so the first token is the physical
  // first move in the diagram's frame, then the sheets' letter map names it.
  const FM_ORDER = ['r', "r'", 'R', "R'", 'B', "B'", 'b', "b'"];
  const SHEET_FM = { R: 'B', U: 'b', L: 'r', B: 'R' };
  function firstMoveOf(r) {
    if (r.meta && r.meta.firstMove) return r.meta.firstMove;
    const flat = E.nsToWCA(E.wcaToNS(r.core)) || r.core;
    const m = String(flat).trim().split(/\s+/)[0].match(/^([ULRB])(2'|2|')?$/);
    return m ? SHEET_FM[m[1]] + ((m[2] === "'" || m[2] === '2') ? "'" : '') : '';
  }
  const RATING_RANK = { best: 0, neutral: 1, poor: 3 };
  const rateRank = (r) => (r.meta && RATING_RANK[r.meta.rating] !== undefined) ? RATING_RANK[r.meta.rating] : 2;

  // merged, display-ready algs for a case: baseline (minus removed) + added,
  // grouped by the exact presentation each alg solves (every alg in a group
  // solves the group's diagram position exactly — no per-row realignment is
  // needed). Groups are labelled Front/Right/Back/Left by their y-offset from
  // the case anchor; algs that don't parse to a clean state go in an unlabelled
  // group and are flagged. Rows follow the admin's saved order.
  function mergedGroups(subsetKey, c) {
    const id = caseId(subsetKey, c.name);
    const ov = overrides.get(id) || { added: [], removed: new Set(), order: [] };
    const rows = [];
    for (const a of c.algs) { if (ov.removed.has(a.alg)) continue; rows.push(makeRow(a, 'base')); }
    for (const a of ov.added) rows.push(makeRow(a, 'add'));

    const groups = new Map(); // presentation render key ('' = unparseable) -> rows
    for (const r of rows) { const k = r.state ? stateKey(r.state) : ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    const ord = ov.order || [];
    const out = [];
    for (const [key, grp] of groups) {
      const side = key ? dirOfKey(subsetKey, c, key) : '';
      // image = the first authored (insertion-order) solving alg's position —
      // computed BEFORE the display sort, so reordering never changes the diagram.
      const anchor = grp.find(r => r.state) || grp[0];
      const image = anchor && anchor.state ? anchor.state : null;
      grp.sort((x, y) => ordIx(ord, x.alg) - ordIx(ord, y.alg));
      out.push({ side, rows: grp, image });
    }
    return out.sort((a, b) => sideRank(a.side) - sideRank(b.side));
  }

  // validate a candidate WCA alg for a case -> {ok, side} | {ok:false, reason}
  function validate(subsetKey, c, alg) {
    const cs = caseStateOf(alg);
    if (!cs) return { ok: false, reason: 'That isn’t a valid algorithm in ' + (NOTA === 'ns' ? 'NS' : 'WCA') + ' notation, or it doesn’t solve to a single state.' };
    const cp = casePres(subsetKey, c);
    // No reference alg means we can't confirm the new one solves THIS case (it
    // could solve a different position). Refuse rather than accept blindly.
    if (!cp.pks) return { ok: false, reason: 'There’s no reference algorithm for this case yet, so we can’t check it.' };
    const p = cp.pks.indexOf(stateKey(cs));
    if (p < 0) return { ok: false, reason: 'Those are valid moves, but they don’t solve this case.' };
    return { ok: true, side: DIRS[(DIRS.indexOf(cp.anchorDir) + p) % 4] };
  }

  // ---------- edit drafts ----------
  // The single source of truth is data/skewb_algs.json. Admin edits are kept
  // as a per-browser DRAFT in localStorage and published with the Export button
  // (download JSON → commit → rebuild). There is no shared live store, so the
  // committed JSON is the one authority.
  const LIVE = A && A.mode === 'live';
  const DRAFT_KEY = 'skewbiks-algsheet-draft';
  function isAdmin() {
    if (!A || !A.user) return false;
    if (LIVE) return adminEmails.includes((A.user.email || '').toLowerCase());
    return true; // demo mode (no Firebase): allow local editing
  }
  let draftError = ''; // surfaced by refreshStatus when a draft read/write fails
  const Store = {
    async loadAll() {
      overrides.clear();
      presCache.clear();
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      try {
        const m = JSON.parse(raw) || {};
        for (const k in m) {
          const v = m[k];
          // Self-heal against the published baseline: once an exported draft is
          // committed and redeployed, its additions exist in the baseline (drop
          // them, or they'd render as duplicates) and tombstones for algs the
          // baseline no longer has are moot.
          const base = getCase(v.subset, v.case);
          const baseAlgs = new Set(base ? base.algs.map(a => a.alg) : []);
          const added = (v.added || []).filter(a => !baseAlgs.has(a.alg));
          const removed = new Set((v.removed || []).filter(a => baseAlgs.has(a)));
          const order = (v.order || []).slice();
          if (!added.length && !removed.size && !order.length) continue;
          overrides.set(caseId(v.subset, v.case), { subset: v.subset, case: v.case, added, removed, order });
        }
      } catch (e) {
        // Don't silently discard the user's draft — set it aside and tell them.
        console.error('algs: unreadable draft, set aside as ' + DRAFT_KEY + '.bad', e);
        try { localStorage.setItem(DRAFT_KEY + '.bad', raw); } catch (_) {}
        draftError = 'We couldn’t read your saved draft, so we set it aside (' + DRAFT_KEY + '.bad) and started from the published algs.';
      }
    },
    async save(subsetKey, caseName) {
      const ov = overrides.get(caseId(subsetKey, caseName)) || { added: [], removed: new Set(), order: [] };
      let m = {};
      try { m = JSON.parse(localStorage.getItem(DRAFT_KEY)) || {}; }
      catch (e) {
        // Mirror loadAll: don't silently overwrite an unreadable draft — set it aside and warn.
        const raw = localStorage.getItem(DRAFT_KEY);
        console.error('algs: unreadable draft on save, set aside as ' + DRAFT_KEY + '.bad', e);
        try { localStorage.setItem(DRAFT_KEY + '.bad', raw); } catch (_) {}
        draftError = 'We couldn’t read your saved draft, so we set it aside (' + DRAFT_KEY + '.bad) and kept your current edits.';
      }
      m[caseId(subsetKey, caseName)] = { subset: subsetKey, case: caseName, added: ov.added, removed: [...ov.removed], order: ov.order || [] };
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(m)); draftError = ''; return true; }
      catch (e) {
        // Don't pretend the edit persisted — make the failure visible.
        console.error('algs: draft save failed', e);
        draftError = 'We couldn’t save your draft (storage may be full or blocked). Your edits only live in this tab and will be lost on reload, so export now to keep them.';
        if (typeof refreshStatus === 'function') refreshStatus();
        return false;
      }
    },
  };
  // ov carries its own {subset,case} so exportJSON can map an edit back to the
  // authored subset/case it belongs to.
  function getOv(subsetKey, caseName) {
    const id = caseId(subsetKey, caseName);
    let ov = overrides.get(id);
    if (!ov) { ov = { subset: subsetKey, case: caseName, added: [], removed: new Set(), order: [] }; overrides.set(id, ov); }
    return ov;
  }

  async function addAlg(subsetKey, c, alg, side) {
    const ov = getOv(subsetKey, c.name);
    // re-adding a removed baseline alg just clears the tombstone
    if (ov.removed.has(alg)) ov.removed.delete(alg);
    else if (!ov.added.some(x => x.alg === alg) && !c.algs.some(x => x.alg === alg)) ov.added.push({ alg, side });
    await Store.save(subsetKey, c.name);
  }
  async function removeAlg(subsetKey, c, row) {
    const ov = getOv(subsetKey, c.name);
    if (row.source === 'add') ov.added = ov.added.filter(x => x.alg !== row.alg);
    else if (!ov.removed.has(row.alg)) ov.removed.add(row.alg);
    if (ov.order) ov.order = ov.order.filter(a => a !== row.alg);
    await Store.save(subsetKey, c.name);
  }

  // the current full display order of a case's alg strings (groups in DIRS
  // order, within group by the saved order) — used to materialize ov.order.
  function fullOrder(subKey, c) {
    return mergedGroups(subKey, c).flatMap(g => g.rows.map(r => r.alg));
  }
  // move `row` up (dir=-1) or down (dir=+1) within its side group; persisted.
  async function moveAlg(subKey, c, rows, row, dir) {
    const i = rows.findIndex(r => r.alg === row.alg), j = i + dir;
    if (i < 0 || j < 0 || j >= rows.length) return;
    const ov = getOv(subKey, c.name);
    let order = (ov.order && ov.order.length) ? ov.order.slice() : fullOrder(subKey, c);
    let pa = order.indexOf(row.alg), pb = order.indexOf(rows[j].alg);
    if (pa < 0 || pb < 0) { order = fullOrder(subKey, c); pa = order.indexOf(row.alg); pb = order.indexOf(rows[j].alg); }
    if (pa < 0 || pb < 0) return;
    const t = order[pa]; order[pa] = order[pb]; order[pb] = t;
    ov.order = order;
    await Store.save(subKey, c.name);
  }

  // ---------- rendering ----------
  let query = '';
  let section = null;              // current subset key
  let main, sideNav, statusEl, notaBox, subNav;

  const matchCase = (subsetKey, c) => {
    if (!query) return true;
    const q = query.toLowerCase();
    if (c.name.toLowerCase().includes(q) || subsetKey.toLowerCase().includes(q)) return true;
    // search baseline (minus tombstoned) + admin-added algs, in raw, normalized,
    // active-notation and authored-sheet form (so an alg typed as seen on
    // screen still matches).
    const ov = overrides.get(caseId(subsetKey, c.name)) || { added: [], removed: new Set() };
    const texts = [];
    for (const a of c.algs) if (!ov.removed.has(a.alg)) { texts.push(a.alg); if (a.ns) texts.push(a.ns); }
    for (const a of ov.added) texts.push(a.alg);
    return texts.some(a => a.toLowerCase().includes(q) || E.normAlg(a).toLowerCase().includes(q)
      || (NOTA === 'ns' && E.wcaToNS(E.normAlg(a)).toLowerCase().includes(q)));
  };

  function caseDiagram(state) {
    if (!state || !R) return h('div', { class: 'algnet empty' });
    return h('div', { class: 'algnet', html: R.netSVG(state, 160, { cls: 'skewbsvg', thumb: true }) });
  }

  function algRow(subKey, c, r, rows, rerender) {
    const i = rows.indexOf(r), admin = isAdmin();
    return h('div', { class: 'algrow' + (r.solves ? '' : ' warn') },
      admin ? h('span', { class: 'ord' },
        h('button', { class: 'mv', title: 'Move up', 'aria-label': 'Move alg up', disabled: i <= 0 ? 'disabled' : null, onclick: async (ev) => { ev.target.disabled = true; await moveAlg(subKey, c, rows, r, -1); rerender(); } }, '↑'),
        h('button', { class: 'mv', title: 'Move down', 'aria-label': 'Move alg down', disabled: i >= rows.length - 1 ? 'disabled' : null, onclick: async (ev) => { ev.target.disabled = true; await moveAlg(subKey, c, rows, r, 1); rerender(); } }, '↓')) : null,
      algText(r),
      r.meta && r.meta.rating === 'best' ? h('span', { class: 'ratetag best' }, 'best') : null,
      r.meta && r.meta.rating === 'poor' ? h('span', { class: 'ratetag poor' }, 'poor') : null,
      r.source === 'add' ? h('span', { class: 'addedtag' }, 'added') : null,
      !r.solves ? h('span', { class: 'warntag', role: 'img', 'aria-label': 'Warning: this stored alg does not parse to a clean case state.', title: 'This stored alg does not parse to a clean case state.' }, '⚠') : null,
      admin ? h('button', { class: 'rm', title: 'Remove', 'aria-label': 'Remove alg', onclick: async (ev) => { ev.target.disabled = true; await removeAlg(subKey, c, r); rerender(); } }, '×') : null);
  }

  // first-move table for one presentation group: all 8 possible first moves in
  // sheet order, each with the alg(s) whose first move (from the diagram's
  // angle) is that move — best-rated first unless the admin reordered.
  function fmTable(subKey, c, rows, rerender) {
    const ord = (overrides.get(caseId(subKey, c.name)) || {}).order || [];
    const byFm = new Map(FM_ORDER.map(k => [k, []]));
    const extra = [];
    for (const r of rows) {
      const fm = firstMoveOf(r);
      if (byFm.has(fm)) byFm.get(fm).push(r); else extra.push(r);
    }
    const out = [];
    for (const [fm, list] of byFm) {
      list.sort((x, y) => (ordIx(ord, x.alg) - ordIx(ord, y.alg)) || (rateRank(x) - rateRank(y)));
      out.push(h('div', { class: 'fmrow' + (list.length ? '' : ' empty') },
        h('span', { class: 'fmkey' }, fm),
        list.length
          ? h('div', { class: 'fmalgs' }, list.map(r => algRow(subKey, c, r, list, rerender)))
          : h('span', { class: 'fmnone' }, '—')));
    }
    if (extra.length) out.push(h('div', { class: 'fmrow' },
      h('span', { class: 'fmkey' }, '·'),
      h('div', { class: 'fmalgs' }, extra.map(r => algRow(subKey, c, r, extra, rerender)))));
    return h('div', { class: 'fmtable' }, out);
  }

  // one labelled row: diagram + heading + first-move table. The diagram shows
  // the group's exact position; every alg in the table solves it as written.
  function sideRow(subKey, c, labelText, rows, image, rerender) {
    return h('div', { class: 'sidegrp' },
      caseDiagram(image),
      h('div', { class: 'sidebody' },
        h('div', { class: 'sidehd' }, labelText),
        fmTable(subKey, c, rows, rerender)));
  }

  const anchorIdOf = (name) => 'case-' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  function renderCase(subKey, c) {
    const card = h('div', { class: 'casecard', id: anchorIdOf(c.name) });
    const rerender = () => { presCache.delete(caseId(subKey, c.name)); card.replaceWith(renderCase(subKey, c)); };
    card.appendChild(h('div', { class: 'casehd' }, h('span', { class: 'casename' }, c.name)));
    const body = h('div', { class: 'casebody' });
    const groups = mergedGroups(subKey, c);
    if (!groups.length) body.appendChild(h('div', { class: 'noalgs' }, 'No algorithms yet.'));
    for (const g of groups) body.appendChild(sideRow(subKey, c, dirLabel(g.side), g.rows, g.image, rerender));
    if (isAdmin()) body.appendChild(adminAdder(subKey, c, () => rerender()));
    card.appendChild(body);
    return card;
  }

  // add-an-alg box. The entered alg (in the active notation) is stored as WCA
  // and filed under whichever presentation it actually solves.
  function adminAdder(subKey, c, rerender) {
    const input = h('input', { class: 'mono addin', type: 'text', placeholder: 'Add an algorithm (we check it for you)', spellcheck: 'false' });
    const fb = h('span', { class: 'addfb' });
    const check = (raw) => {
      const wca = inputToWCA(raw);
      if (wca == null) return { reason: 'We couldn’t read that as NS notation (corners F R B L f r b l, rotations x y z). If it uses R U L B, switch to WCA.' };
      const v = validate(subKey, c, wca);
      return v.ok ? { wca, side: v.side } : { reason: v.reason };
    };
    const submit = async () => {
      const raw = input.value.trim().replace(/\s+/g, ' ');
      if (!raw) return;
      const hit = check(raw);
      if (!hit.wca) { fb.className = 'addfb err'; fb.textContent = hit.reason; return; }
      input.value = ''; fb.className = 'addfb'; fb.textContent = '';
      await addAlg(subKey, c, hit.wca, hit.side);
      rerender();
    };
    input.addEventListener('input', () => {
      const raw = input.value.trim();
      if (!raw) { fb.className = 'addfb'; fb.textContent = ''; return; }
      const hit = check(raw);
      fb.className = 'addfb ' + (hit.wca ? 'ok' : 'err');
      fb.textContent = hit.wca ? '✓ ' + dirLabel(hit.side).toLowerCase() : hit.reason;
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    return h('div', { class: 'adder' }, input, h('button', { class: 'primary sm', onclick: submit }, 'Add'), fb);
  }

  function renderMain() {
    main.innerHTML = '';
    const sub = SUBSETMAP[section];
    if (!sub) return;
    if (!sub.cases.length) { main.appendChild(h('div', { class: 'nomatch big' }, 'No cases in this subset yet.')); return; }
    // a search looks across the WHOLE subset (ignoring group/filter) so any
    // case stays findable; plain browsing shows the group + dropdown view.
    const pool = query ? sub.cases.slice().sort(navCmp(sub)) : visibleCases(sub);
    const cases = pool.filter(c => matchCase(sub.key, c));
    if (!cases.length) { main.appendChild(h('div', { class: 'nomatch big' }, query ? 'No cases match “' + query + '”.' : 'No cases here yet.')); return; }
    main.appendChild(h('section', { class: 'subset' },
      h('div', { class: 'casegrid' }, cases.map(c => renderCase(sub.key, c)))));
  }

  function renderSidebar() {
    sideNav.innerHTML = '';
    const sub = SUBSETMAP[section];
    if (!sub) return;
    for (const c of visibleCases(sub)) {
      sideNav.appendChild(h('a', {
        class: 'navcase', href: '#' + anchorIdOf(c.name),
      }, h('span', null, c.name), h('span', { class: 'navct' }, c.algs.length)));
    }
  }

  // second-level nav: group pills (e.g. Pi / Peanut, TCLL+ / TCLL-) and the
  // per-group dropdown (center pattern / corner set), from the authored nav.
  function renderSubNav() {
    if (!subNav) return;
    subNav.innerHTML = '';
    const sub = SUBSETMAP[section];
    if (!sub || !sub.nav || !sub.nav.group || !sub.nav.group.values.length) { subNav.style.display = 'none'; return; }
    subNav.style.display = '';
    const g = activeGroup(sub);
    subNav.appendChild(h('div', { class: 'subtabs', role: 'group', 'aria-label': 'case group' },
      sub.nav.group.values.map(v =>
        h('button', {
          class: 'subtab' + (v.value === g ? ' on' : ''), 'aria-pressed': v.value === g ? 'true' : 'false',
          onclick: () => { groupSel[sub.key] = v.value; renderSubNav(); renderSidebar(); renderMain(); },
        }, v.label))));
    const nf = sub.nav.filter;
    if (nf) {
      const opts = [];
      for (const c of sub.cases) {
        if (c[sub.nav.group.field] !== g) continue;
        const v = c[nf.field];
        if (v != null && opts.indexOf(v) < 0) opts.push(v);
      }
      if (opts.length) {
        const cur = activeFilter(sub);
        const sel = h('select', { 'aria-label': nf.label },
          h('option', { value: '' }, 'All'),
          opts.map(v => { const o = h('option', { value: v }, v); if (v === cur) o.selected = true; return o; }));
        sel.addEventListener('change', () => { filterSel[sub.key + '::' + g] = sel.value; renderSidebar(); renderMain(); });
        subNav.appendChild(h('label', { class: 'navfilter' }, nf.label + ':', sel));
      }
    }
  }

  function switchSection(id) {
    section = id;
    document.querySelectorAll('.sectab').forEach(t => {
      const on = t.getAttribute('data-sec') === id;
      t.className = 'sectab' + (on ? ' on' : '');
      t.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    renderSubNav();
    renderSidebar();
    renderMain();
  }

  // Export the AUTHORED schema (meta + subsets + other_subsets), not the
  // display view, so the file round-trips: tools/compile-sheet.mjs can consume
  // it and every authored field is preserved verbatim. We deep-clone the
  // original data and apply the admin's add/remove deltas in place.
  function exportJSON() {
    const out = JSON.parse(JSON.stringify(DATA));
    out.meta = Object.assign({}, DATA.meta, { exported: true, note: 'edited via the Algorithms tab' });
    const findCase = (key, name) => {
      const cont = (out.subsets && out.subsets[key]) ? out.subsets
        : (out.other_subsets && out.other_subsets[key]) ? out.other_subsets : null;
      return cont ? (cont[key].cases.find(c => c.name === name) || null) : null;
    };
    for (const ov of overrides.values()) {
      if (!ov.subset) continue;
      const c = findCase(ov.subset, ov.case);
      if (!c) continue;
      if (ov.removed && ov.removed.size) c.algs = c.algs.filter(a => !ov.removed.has(a.alg));
      for (const a of (ov.added || []))
        if (!c.algs.some(x => x.alg === a.alg)) c.algs.push({ direction: DIRS.includes(a.side) ? a.side : 'Front', alg: a.alg });
      // publish the admin's saved display order too (stable sort: algs the
      // order list doesn't know keep their authored position at the end)
      if (ov.order && ov.order.length) c.algs.sort((x, y) => ordIx(ov.order, x.alg) - ordIx(ov.order, y.alg));
    }
    // the counts are part of the authored meta — keep them true for the new set
    if (out.meta.counts) {
      let cases = 0, algs = 0;
      for (const cont of [out.subsets || {}, out.other_subsets || {}])
        for (const key of Object.keys(cont)) for (const c of cont[key].cases) { cases++; algs += c.algs.length; }
      out.meta.counts = { cases, algs };
    }
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: 'skewb_algs.json' });
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  // ---------- page shell ----------
  function renderToolbarNota() {
    if (!notaBox) return;
    notaBox.innerHTML = '';
    notaBox.appendChild(h('button', { class: 'notabtn' + (NOTA === 'wca' ? ' on' : ''), 'aria-pressed': NOTA === 'wca' ? 'true' : 'false',
      title: 'WCA notation — R U L B turn the fixed corners (official scrambles)', onclick: () => setNota('wca') }, 'WCA'));
    notaBox.appendChild(h('button', { class: 'notabtn' + (NOTA === 'ns' ? ' on' : ''), 'aria-pressed': NOTA === 'ns' ? 'true' : 'false',
      title: 'NS notation — top corners F R B L, bottom corners f r b l (Sarah / NS alg sheets)', onclick: () => setNota('ns') }, 'NS'));
  }

  function build() {
    new SiteNavbar({ active: 'algs' }).mount(document.body);
    const search = h('input', { class: 'algsearch', type: 'search', placeholder: 'Search cases, subsets, or algorithms…', 'aria-label': 'search' });
    search.addEventListener('input', () => { query = search.value.trim(); renderMain(); });
    statusEl = h('span', { class: 'algstatus' });
    notaBox = h('div', { class: 'notaswitch', role: 'group', 'aria-label': 'move notation' });
    renderToolbarNota();
    const exportBtn = h('button', { class: 'ghost sm export', onclick: exportJSON }, 'Export JSON');

    const tabs = h('div', { class: 'sectabs' }, SECTIONS.map(s =>
      h('button', { class: 'sectab' + (s.id === section ? ' on' : ''), 'data-sec': s.id, 'aria-pressed': s.id === section ? 'true' : 'false', onclick: () => switchSection(s.id) }, s.label)));
    subNav = h('div', { class: 'subnav' });
    const toolbar = h('div', { class: 'algtoolbar' }, search, statusEl, notaBox, exportBtn);
    sideNav = h('nav', { class: 'algside', 'aria-label': 'cases' });
    main = h('div', { class: 'algmain' });
    app.appendChild(h('div', { class: 'algwrap' },
      h('div', { class: 'alghead' }, h('h1', null, 'Algorithms'),
        h('p', { class: 'sub' }, 'Pick a subset, then browse its cases — each shown from every angle it’s solved at. Use search to find a case fast.')),
      tabs, subNav, toolbar,
      h('div', { class: 'algcols' }, h('aside', { class: 'algsidewrap' }, sideNav), main)));

    switchSection(section);
    refreshStatus();
    // the single auth-change handler is registered in boot() (after build()).
  }

  function refreshStatus() {
    if (!statusEl) return;
    const admin = isAdmin();
    if (draftError) {            // a save/load failure outranks the normal status line
      statusEl.textContent = draftError;
      statusEl.className = 'algstatus err';
    } else {
      const keys = Object.keys(SUBSETMAP);
      const total = keys.reduce((n, k) => n + SUBSETMAP[k].cases.length, 0);
      statusEl.textContent = keys.length + ' subsets · ' + total + ' cases'
        + (admin ? ' · editing as admin. Changes save to this browser; use Export to publish.' : '');
      statusEl.className = 'algstatus' + (admin ? ' admin' : '');
    }
    const exp = document.querySelector('.export'); if (exp) exp.style.display = admin ? '' : 'none';
  }

  // ---------- boot ----------
  async function boot() {
    try {
      const res = await fetch('data/skewb_algs.json');
      DATA = await res.json();
    } catch (e) {
      app.appendChild(h('div', { class: 'algerr' }, 'We couldn’t load the algorithms. Try reloading the page.'));
      return;
    }
    buildModel();
    // land on the first subset that has cases (tabs keep the authored order)
    const first = SECTIONS.find(s => SUBSETMAP[s.id].cases.length) || SECTIONS[0];
    section = first ? first.id : null;
    if (A && A.whenReady) { try { await A.whenReady(); } catch (e) {} }
    await Store.loadAll();
    build();
    // single auth-change handler: re-pull overrides + admin state after auth
    // settles (cloud may differ from anon), then refresh the UI once.
    if (A && A.onChange) A.onChange(async () => { await Store.loadAll(); refreshStatus(); renderMain(); });
  }
  boot();
})();
