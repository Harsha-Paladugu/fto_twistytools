/* Skewbiks.com — OO solutions app. Expects OOEngine, OORender, SiteNavbar, OOAccount (auth) and OO_CONFIG (config.js). */
/* Skewb OO — app layer. Expects window.OOEngine (engine) + window.OORender (net renderer). */
(function () {
const E = window.OOEngine, R = window.OORender;
const CFG = window.OO_CONFIG || {};
const { h, $, toast, tick, copyBtn, installErrorToast } = window.OODom;
const fmt = n => n.toLocaleString('en-US');

/* ---------------- notation (WCA default, NS switch) ---------------- */
// One per-browser preference. WCA letters R U L B are the official scramble
// notation; NS ("Rubik'skewb", used by the Sarah/NS alg sheets) names all
// eight corners: top F R B L, bottom f r b l. Engine-generated strings are
// always WCA and get display-converted; stored solutions carry the notation
// they were typed in (doc field `notation`, default 'wca').
const NOTA_KEY = 'skewbiks-notation';
let NOTA = 'wca';
try { if (localStorage.getItem(NOTA_KEY) === 'ns') NOTA = 'ns'; } catch {}
function setNota(v) {
  NOTA = v === 'ns' ? 'ns' : 'wca';
  try { localStorage.setItem(NOTA_KEY, NOTA); } catch {}
  render();
}
const dispAlg = s => (s && NOTA === 'ns') ? E.wcaToNS(s) : s;                 // engine WCA string -> active notation
const notaOf = sol => sol.notation === 'ns' ? 'ns' : 'wca';
const dispSol = sol => E.convertAlg(sol.solution, notaOf(sol), NOTA) || sol.solution;
const dispSolMirror = sol => E.convertAlg(E.mirrorAlg(sol.solution), notaOf(sol), NOTA) || E.mirrorAlg(sol.solution);

// Each scramble (a position + its mirror — one census class, keyed by pairId)
// keeps at most this many approved solutions. Enforced app-side — in the submit
// form and at approval — since Firestore rules can't count sibling docs.
// Approving/creating past it is blocked.
const MAX_SOLUTIONS = 2;
const moderatorFormUrl = () => String(CFG.moderatorFormUrl || '').trim();

/* ---------------- tables: BFS + canonical classes, cached in IndexedDB ---------------- */
// The IndexedDB cache + BFS/class-enumeration live in the shared js/tables.js
// (window.OOTables), so the census and the solver share one dist table without
// the old single-key value-shape ambiguity. tables.js must load before this file.
const T = { dist: null, reps: null, depths: null, depthIdx: null, syms: null, rotByCorner: null, ready: false };
// Depth-0 (the solved state) can't take a length-0 solution, so it counts as
// solved by definition. `o` is an ordinal into T.reps.
const isTrivial = (o) => T.depths[o] === 0;
let browseFilter = 'all';   // depth browser: 'all' | 'unsolved' | 'solved'

async function buildTables(report) {
  if (!window.OOTables) throw new Error('js/tables.js must load before js/oo.js');
  T.syms = E.buildSyms();
  // Build the canonicalizers once (each closes over T.syms); canonOf/mirrorOf
  // below delegate to these, so the closures aren't rebuilt per call in hot loops.
  // canonOf folds ALL 24 symmetries (12 rotations + 12 mirrors) — the census
  // class key, matching tables.js; rotCanonOf folds rotations only (it tells a
  // class's two mirror sides apart); mirrorOf gives the rotation-canonical id
  // of a state's mirror image.
  T.canonOf = E.makeFullCanon(T.syms);
  T.rotCanonOf = E.makeCanon(T.syms);
  T.mirrorOf = E.makeMirrorCanon(T.syms);
  T.rotByCorner = E.makeFrames(T.syms);
  // dist is shared with the solver (KEY_DIST); the canonical-class tables are
  // census-only (KEY_CLASSES). Either cache miss rebuilds just that piece.
  T.dist = await window.OOTables.loadOrBuildDist(E, report, tick);
  const cls = await window.OOTables.loadOrBuildClassTables(E, T.dist, report, tick);
  T.reps = cls.reps;
  T.depths = cls.depths;
  T.depthIdx = Array.from({ length: 12 }, () => []);
  for (let o = 0; o < T.reps.length; o++) T.depthIdx[T.depths[o]].push(o);
  T.ready = true;
}
function ordinalOf(classId) { // binary search in reps
  let lo = 0, hi = T.reps.length - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1;
    if (T.reps[mid] === classId) return mid;
    if (T.reps[mid] < classId) lo = mid + 1; else hi = mid - 1; }
  return -1;
}
const canonOf = s => T.canonOf(s);      // 24-sym class id (a position and its mirror share it)
const mirrorOf = s => T.mirrorOf(s);    // rotation-canonical id of the mirror image
// done-bitmap accessors: one bit per class ordinal
const testBit = (bm, o) => !!(bm[o >> 3] & (1 << (o & 7)));
const setBit = (bm, o) => { bm[o >> 3] |= 1 << (o & 7); };
// decode a base64 done-bitmap into a fresh Uint8Array sized to the class count
// (a missing/empty string yields the all-zero bitmap).
function decodeBitmap(b64) {
  const bm = new Uint8Array(Math.ceil(T.reps.length / 8));
  const bin = atob(b64 || '');
  for (let i = 0; i < bin.length && i < bm.length; i++) bm[i] = bin.charCodeAt(i);
  return bm;
}
// a state index is usable only if it's an in-range integer (E.unidx has no bounds
// guard); client-side mirror of the Firestore create-rule bounds.
const validId = id => Number.isInteger(id) && id >= 0 && id < E.NSLOTS;
function variantsOf(classId) { // unique rotation variants of a class, each with its sym
  const s = E.unidx(classId), seen = new Set(), out = [];
  for (const sym of T.syms.rots) {
    const v = E.applySym(sym, s), ix = E.idx(v);
    if (!seen.has(ix)) { seen.add(ix); out.push({ ix, state: v }); }
  }
  return out;
}

/* ---------------- solution verification ---------------- */
// Returns {ok, side:'a'|'b', moves, error?} — accepts a solution for any rotation
// variant of either side of the pair.
function verifySolution(text, pair, notation) {
  const nota = notation || NOTA;
  // The solved position (depth 0) takes no solutions: any accepted "solution"
  // (e.g. R R') would mark it done a second time — pageHome already counts
  // depth-0 as solved by definition. Also disables Approve for any legacy
  // pending depth-0 submission in the moderation queue.
  if (pair.a.depth === 0) return { ok: false, error: 'This is the solved position — there’s nothing to solve.' };
  const parsed = E.parseAlg(text, nota);
  if (!parsed) return { ok: false, error: nota === 'ns'
    ? 'We couldn\u2019t read that as NS notation (corners F R B L f r b l, rotations x y z).'
    : 'We couldn\u2019t read that. Use R U L B (with \u2032 or 2) and rotations x y z.' };
  const moves = E.countMoves(parsed);
  if (moves === 0) return { ok: false, error: 'Add some moves first.' };
  if (moves > 15) return { ok: false, error: 'That\u2019s ' + moves + ' moves. Solutions have to be 15 or fewer.' };
  for (const side of ['a', 'b']) {
    if (!pair[side]) continue;
    for (const v of pair[side].variants) {
      const end = E.applyParsed(parsed, v.state, T.syms, T.rotByCorner);
      if (E.eq(end, E.solved())) return { ok: true, side, moves };
    }
  }
  return { ok: false, moves, error: 'That doesn\u2019t solve this scramble. We checked it from every rotation of both mirrors.' };
}
// One census class covers a position AND its LR mirror (24-sym fold). The page
// still shows the two mirror "sides" separately: `a` is the class rep (which is
// also the smaller rotation-canonical id), `b` its mirror image — null for the
// 108 self-mirror classes. Both sides share the class ordinal and done-bit.
// Accepts ANY in-range state index and normalizes by full 24-sym
// canonicalization — total even for forged non-canonical ids (min(id, mirror)
// alone would mis-normalize those and strand ord/done-bit lookups at -1).
function pairOf(anyClassId) {
  const pairId = canonOf(E.unidx(anyClassId));
  const lowState = E.unidx(pairId);
  const hiId = mirrorOf(lowState);
  const ord = ordinalOf(pairId);
  const pair = {
    pairId,
    a: { id: pairId, state: lowState, ord, depth: T.dist[pairId],
         scramble: E.optimalScramble(lowState, T.dist, false), variants: variantsOf(pairId) },
    b: null, self: pairId === hiId,
  };
  if (!pair.self) {
    const hiState = E.unidx(hiId);
    pair.b = { id: hiId, state: hiState, ord, depth: T.dist[hiId],
               scramble: E.optimalScramble(hiState, T.dist, false), variants: variantsOf(hiId) };
  }
  return pair;
}

/* ---------------- data layer ---------------- */
let DB = null;
let lastSearch = null; // the scramble the visitor just searched, so the position page can show it verbatim

function demoDB() {
  const KEY = 'skewbiks-oo-demo';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { solutions: [], mods: [] }; } catch { return { solutions: [], mods: [] }; } };
  const save = d => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} };
  const subs = new Set();
  const notify = () => subs.forEach(f => f());
  const A = window.OOAccount;                 // auth is shared site-wide via OOAccount
  return {
    mode: 'demo',
    get user() { return A.user; },
    get isMod() { return !!A.user; },          // demo: every signed-in user moderates, to try the flow
    get isAdmin() { return !!A.user; },
    async init() { A.onChange(notify); },      // re-render on sign in/out
    onChange(f) { subs.add(f); },
    signIn() { return A.signIn(); },
    signOut() { return A.signOut(); },
    async stats() {
      const d = load(); const done = new Set();
      for (const s of d.solutions) if (s.status === 'approved') done.add(s.pairId);
      return { done: done.size, total: T.reps.length };
    },
    async doneMap() {
      const d = load(); const bm = new Uint8Array(Math.ceil(T.reps.length / 8));
      for (const s of d.solutions) if (s.status === 'approved') {
        const o = ordinalOf(s.pairId); if (o >= 0) setBit(bm, o);
      }
      return bm;
    },
    async pairSolutions(pairId) {
      const d = load();
      return d.solutions.filter(s => s.pairId === pairId && (s.status === 'approved' || (A.user && s.uid === A.user.uid)));
    },
    async submit(doc) {
      const d = load();
      d.solutions.push({ ...doc, id: 'demo-' + Date.now() + '-' + Math.floor(Math.random()*1e6),
        uid: A.user.uid, status: 'pending', createdAt: Date.now() });
      save(d); notify();
    },
    async pending() { const d = load(); return d.solutions.filter(s => s.status === 'pending'); },
    async review(id, action) {
      const d = load(); const s = d.solutions.find(x => x.id === id);
      if (!s) return;
      if (action === 'approved'
          && d.solutions.filter(x => x.pairId === s.pairId && x.status === 'approved').length >= MAX_SOLUTIONS)
        throw new Error('CAP');
      s.status = action; s.reviewedBy = A.user && A.user.email;
      save(d); notify();
    },
    async mods() { return load().mods; },
    async invite(email) { const d = load(); d.mods.push({ email, addedBy: A.user.email }); save(d); notify(); },
    async revoke(email) { const d = load(); d.mods = d.mods.filter(m => m.email !== email); save(d); notify(); },
  };
}

function liveDB() {
  let fs, F;                                   // firestore handle + module, taken from OOAccount
  let isMod = false, isAdmin = false;          // OO-specific role, derived from the shared auth state
  const subs = new Set(); const notify = () => subs.forEach(f => f());
  const adminEmails = (CFG.adminEmails || []).map(e => e.toLowerCase());
  const A = window.OOAccount;
  // Recompute moderator/admin status whenever the shared session changes.
  async function recomputeRole() {
    const user = A.user;
    // Source of truth for admin is the admins/{uid} collection (what the rules
    // enforce); adminEmails is kept as a bootstrap/display convenience so the
    // owner sees the admin UI before creating their admins doc.
    let adminDoc = false;
    if (user) { try { adminDoc = (await F.getDoc(F.doc(fs, 'admins', user.uid))).exists(); } catch {} }
    isAdmin = !!user && (adminDoc || adminEmails.includes((user.email || '').toLowerCase()));
    isMod = isAdmin;
    if (user && !isMod) {
      try { const m = await F.getDoc(F.doc(fs, 'moderators', user.uid)); isMod = m.exists(); } catch {}
      if (!isMod) { // accept an invite if one exists for this email
        try {
          const inv = await F.getDoc(F.doc(fs, 'moderatorInvites', user.email));
          if (inv.exists()) {
            await F.setDoc(F.doc(fs, 'moderators', user.uid), { email: user.email, via: 'invite' });
            isMod = true;
          }
        } catch {}
      }
    }
  }
  return {
    mode: 'live',
    get user() { return A.user; }, get isMod() { return isMod; }, get isAdmin() { return isAdmin; },
    onChange(f) { subs.add(f); },
    async init() {
      await A.whenReady();                     // OOAccount owns the single Firebase app + auth
      fs = A.fb.fs; F = A.fb.F;
      await recomputeRole();
      A.onChange(async () => { await recomputeRole(); notify(); });
    },
    signIn() { return A.signIn(); },
    signOut() { return A.signOut(); },
    async stats() {
      try { const d = await F.getDoc(F.doc(fs, 'meta', 'stats'));
        return d.exists() ? d.data() : { done: 0, total: T.reps.length };
      } catch { return { done: 0, total: T.reps.length }; }
    },
    async doneMap() {
      try {
        const d = await F.getDoc(F.doc(fs, 'meta', 'doneMap'));
        return decodeBitmap(d.exists() ? d.data().b64 : '');
      } catch { return decodeBitmap(''); }
    },
    async pairSolutions(pairId) {
      const out = [];
      const q1 = F.query(F.collection(fs, 'solutions'),
        F.where('pairId', '==', pairId), F.where('status', '==', 'approved'));
      (await F.getDocs(q1)).forEach(d => out.push({ id: d.id, ...d.data() }));
      if (A.user) {
        const q2 = F.query(F.collection(fs, 'solutions'),
          F.where('pairId', '==', pairId), F.where('uid', '==', A.user.uid), F.where('status', '==', 'pending'));
        (await F.getDocs(q2)).forEach(d => out.push({ id: d.id, ...d.data() }));
      }
      return out;
    },
    async submit(doc) {
      await F.addDoc(F.collection(fs, 'solutions'), {
        ...doc, uid: A.user.uid, status: 'pending', createdAt: F.serverTimestamp() });
      notify();
    },
    async pending() {
      const q = F.query(F.collection(fs, 'solutions'), F.where('status', '==', 'pending'));
      const out = []; (await F.getDocs(q)).forEach(d => out.push({ id: d.id, ...d.data() }));
      return out;
    },
    async review(id, action) {
      if (action === 'rejected') {
        await F.updateDoc(F.doc(fs, 'solutions', id), { status: 'rejected', reviewedBy: A.user.email });
        notify(); return;
      }
      // Enforce the per-scramble cap before approving. Rules can't count sibling
      // docs and Firestore transactions can't run queries, so this query runs
      // BEFORE the transaction — it is best-effort and racy: two moderators
      // approving different pending solutions for the same pair concurrently can
      // both pass it and exceed MAX_SOLUTIONS. Accepted trade-off: worst case is
      // one extra approved solution (visible in the UI, deletable by an admin);
      // the bitmap/counter stay consistent because both transactions serialize
      // on the meta docs. Throw CAP so pageMod can explain the block.
      const preSnap = await F.getDoc(F.doc(fs, 'solutions', id));
      if (!preSnap.exists() || preSnap.data().status !== 'pending') { notify(); return; }
      const approvedQ = F.query(F.collection(fs, 'solutions'),
        F.where('pairId', '==', preSnap.data().pairId), F.where('status', '==', 'approved'));
      if ((await F.getDocs(approvedQ)).size >= MAX_SOLUTIONS) throw new Error('CAP');
      // approval: transaction updates the solution, the done bitmap and the counter
      await F.runTransaction(fs, async tx => {
        const solRef = F.doc(fs, 'solutions', id);
        const sol = await tx.get(solRef);
        if (!sol.exists() || sol.data().status !== 'pending') return;
        const data = sol.data();
        const mapRef = F.doc(fs, 'meta', 'doneMap'), statRef = F.doc(fs, 'meta', 'stats');
        const mapDoc = await tx.get(mapRef), statDoc = await tx.get(statRef);
        const bm = decodeBitmap(mapDoc.exists() ? mapDoc.data().b64 : '');
        // Re-derive the class rep from classId (full 24-sym canon, matching
        // pairOf) rather than trusting the submitter-supplied partnerId/pairId,
        // so a forged value can't flip an unrelated position's done-bit or
        // strand the approval. One class, one ordinal, one bit.
        const o = ordinalOf(canonOf(E.unidx(data.classId)));
        let added = 0;
        if (o >= 0 && !testBit(bm, o)) { setBit(bm, o); added = 1; }
        let b64 = ''; const CH = 8192;
        for (let i = 0; i < bm.length; i += CH) b64 += String.fromCharCode.apply(null, bm.subarray(i, i + CH));
        b64 = btoa(b64);
        tx.update(solRef, { status: 'approved', reviewedBy: A.user.email });
        tx.set(mapRef, { b64 });
        const done = (statDoc.exists() ? statDoc.data().done || 0 : 0) + added;
        tx.set(statRef, { done, total: T.reps.length });
      });
      notify();
    },
    async mods() {
      const out = [];
      try { (await F.getDocs(F.collection(fs, 'moderators'))).forEach(d => out.push({ uid: d.id, ...d.data() }));
        (await F.getDocs(F.collection(fs, 'moderatorInvites'))).forEach(d => out.push({ email: d.id, invite: true, ...d.data() })); } catch {}
      return out;
    },
    async invite(email) { await F.setDoc(F.doc(fs, 'moderatorInvites', email.toLowerCase()), { addedBy: A.user.email }); notify(); },
    async revoke(key) {
      try { await F.deleteDoc(F.doc(fs, 'moderators', key)); } catch {}
      try { await F.deleteDoc(F.doc(fs, 'moderatorInvites', key)); } catch {}
      notify();
    },
  };
}

/* ---------------- router + shell ---------------- */
const app = () => $('#app');
function nav() {
  const route = location.hash || '#/';
  const u = DB.user;
  const sub = [
    { label: 'Solutions', href: '#/', on: route === '#/' || route.startsWith('#/c/') },
    { label: 'Browse by depth', href: '#/browse', on: route.startsWith('#/browse') },
    DB.isMod ? { label: 'Moderation', href: '#/mod', on: route.startsWith('#/mod') } : null,
    { label: 'How it works', href: '#/about', on: route.startsWith('#/about') },
  ].filter(Boolean);
  const notaSwitch = h('div', { class: 'notaswitch', role: 'group', 'aria-label': 'move notation' },
    h('button', { class: 'notabtn' + (NOTA === 'wca' ? ' on' : ''), 'aria-pressed': NOTA === 'wca' ? 'true' : 'false',
      title: 'WCA notation — R U L B turn the fixed corners (official scrambles)', onclick: () => setNota('wca') }, 'WCA'),
    h('button', { class: 'notabtn' + (NOTA === 'ns' ? ' on' : ''), 'aria-pressed': NOTA === 'ns' ? 'true' : 'false',
      title: 'NS notation — top corners F R B L, bottom corners f r b l (Sarah / NS alg sheets)', onclick: () => setNota('ns') }, 'NS'));
  const right = h('div', { class: 'authbox' },
      notaSwitch,
      DB.mode === 'demo' ? h('span', { class: 'demobadge', title: 'No Firebase config yet. Your data stays in this browser.' }, 'demo mode') : null,
      u ? h('span', { class: 'whoami' }, u.name || u.email) : null,
      u ? h('button', { class: 'ghost', onclick: () => DB.signOut() }, 'Sign out')
        : h('button', { class: 'primary', onclick: () => DB.signIn().catch(() => toast('Sign-in didn’t go through. Please try again.')) }, 'Sign in with Google'));
  return new SiteNavbar({ active: 'oo', sub, right }).element();
}
async function renderInner() {
  const route = location.hash || '#/';
  const root = app(); root.innerHTML = '';
  root.appendChild(nav());
  const main = h('main', { class: 'page' }); root.appendChild(main);
  // A failed DB.init() leaves sign-in / submissions / the solved map unavailable;
  // surface it as a persistent banner (re-rendered on every navigation), not a
  // transient toast. demoDB never fails, so this only shows in broken live mode.
  if (DB && DB.failed) main.appendChild(h('div', { class: 'card error', style: 'margin:16px auto;max-width:680px' },
    'We couldn’t connect to the database, so sign-in, submitting, and the solved map aren’t available right now. Try reloading the page.'));
  if (!T.ready) { const b = $('#boot-status'); if (b) main.appendChild(b.cloneNode(true)); return; }
  try {
    if (route.startsWith('#/c/')) await pageClass(main, parseInt(route.slice(4), 10));
    else if (route.startsWith('#/browse')) await pageBrowse(main, route);
    else if (route.startsWith('#/mod')) await pageMod(main);
    else if (route.startsWith('#/about')) pageAbout(main);
    else await pageHome(main);
  } catch (err) {
    console.error(err);
    main.appendChild(h('div', { class: 'card error' }, 'Something went wrong loading this page. Try reloading.'));
  }
}

/* ---------------- home ---------------- */
async function pageHome(main) {
  const raw = await DB.stats();
  // depth-0 (solved state) counts as solved; it's never in the recorded count
  const stats = { total: raw.total, done: raw.done + (T.depthIdx[0] ? T.depthIdx[0].length : 0) };
  const pct = stats.total ? stats.done / stats.total : 0;
  main.appendChild(h('section', { class: 'homeintro' },
    h('h1', null, 'The best human solution to every Skewb position.'),
    h('p', { class: 'lede' },
      'Fold rotations and mirrors together and the Skewb’s 3,149,280 scrambles come down to ' + fmt(T.reps.length) + ' positions — a position and its mirror count as one. ',
      'Paste a scramble to look yours up, or browse by depth and claim one nobody has solved yet.')));
  main.appendChild(h('section', { class: 'progressblock' },
    h('div', { class: 'barwrap', role: 'progressbar', 'aria-valuenow': (pct*100).toFixed(2), 'aria-valuemin': '0', 'aria-valuemax': '100' },
      h('div', { class: 'bar', style: 'width:' + Math.max(pct * 100, pct > 0 ? 0.5 : 0) + '%' })),
    h('p', { class: 'progressline' },
      h('b', null, fmt(stats.done)), ' solved \u00b7 ', h('b', null, fmt(stats.total - stats.done)), ' to go \u00b7 ',
      h('b', { class: 'pct' }, (pct * 100).toFixed(pct > 0 && pct < 0.0001 ? 4 : 2) + '%'), ' complete')));
  const searchBox = h('div', { class: 'searchrow' },
    h('input', { class: 'searchin mono', placeholder: 'Paste a scramble, e.g.  ' + dispAlg("L R L U' B R' U' R' L R B"),
      'aria-label': 'scramble search',
      onkeydown: ev => { if (ev.key === 'Enter') doSearch(ev.target); } }),
    h('button', { class: 'primary', onclick: ev => doSearch(ev.target.parentElement.querySelector('input')) }, 'Find this scramble'));
  function doSearch(input) {
    const txt = input.value.trim();
    if (!txt) return;
    const parsed = E.parseAlg(txt, NOTA);
    if (!parsed) { toast(NOTA === 'ns'
      ? 'We couldn\u2019t read that as NS notation (corners F R B L f r b l, rotations x y z). If it uses R U L B, switch to WCA.'
      : 'We couldn\u2019t read that scramble. Use R U L B with \u2032 or 2 (rotations x y z are fine) \u2014 or switch to NS.'); return; }
    const st = E.applyParsed(parsed, E.solved(), T.syms, T.rotByCorner);
    lastSearch = { ix: E.idx(st), text: txt.replace(/\s+/g, ' ') };
    const target = '#/c/' + lastSearch.ix;
    if (location.hash === target) render(); else location.hash = target;
  }
  main.appendChild(searchBox);
  main.appendChild(h('div', { class: 'homelinks' },
    h('a', { class: 'ghost', href: '#/browse' }, 'Browse by depth'),
    h('button', { class: 'ghost', onclick: async () => {
      const bm = await DB.doneMap();
      for (let tries = 0; tries < 4000; tries++) {
        const o = Math.floor(Math.random() * T.reps.length);
        // isTrivial: depth-0 counts as solved by definition but has no bit set
        if (!isTrivial(o) && !testBit(bm, o)) { location.hash = '#/c/' + T.reps[o]; return; }
      }
      toast('We couldn\u2019t find an unsolved position. Looks like they\u2019re all done!');
    } }, 'Take me to an unsolved position'),
    h('a', { class: 'ghost', href: '#/about' }, 'How it works')));
}

/* ---------------- class / pair page ---------------- */
// Call-to-action inviting a non-moderator to apply for access via the Google Form
// configured in config.js (CFG.moderatorFormUrl). Renders a button when the URL is
// set, otherwise a muted "not open yet" note so the space is there either way.
function requestModBlock() {
  const url = moderatorFormUrl();
  return url
    ? h('button', { class: 'primary', onclick: () => window.open(url, '_blank', 'noopener') }, 'Request moderator access')
    : h('p', { class: 'empty' }, 'Moderator applications aren’t open yet — check back soon.');
}
function sidePanel(side, label, doneSet, exactView) {
  const shownState = exactView && exactView.state ? exactView.state : side.state;
  const isExact = E.idx(shownState) !== side.id;
  // the visitor's own search text is shown verbatim (it's already in their
  // notation); engine-generated scrambles are WCA and convert for display
  const shownScramble = exactView && exactView.scramble
    ? exactView.scramble
    : dispAlg(isExact ? E.optimalScramble(shownState, T.dist, false) : side.scramble);
  const wrap = h('div', { class: 'sidepanel' },
    h('div', { class: 'sidehead' },
      h('span', { class: 'sidelabel' }, label),
      h('span', { class: 'depthchip d' + side.depth }, side.depth + ' moves deep'),
      (side.depth === 0 || (doneSet && doneSet.has(side.id))) ? h('span', { class: 'donechip' }, '\u2713 solved') : null,
      h('span', { class: 'ordinal' }, '#' + fmt(side.ord + 1))),
    (() => {
      const vs = { mode: '2d', M: R.viewMatrix(R.DEFAULT_VIEW.yaw, R.DEFAULT_VIEW.pitch) };
      const netBox = h('div', { class: 'netwrap' });
      const resetView = () => { vs.M = R.viewMatrix(R.DEFAULT_VIEW.yaw, R.DEFAULT_VIEW.pitch); draw(); };
      const draw = () => {
        const is3d = vs.mode === '3d';
        netBox.innerHTML = is3d ? R.iso3dSVG(shownState, 215, vs.M) : R.netSVG(shownState, 330);
        netBox.classList.toggle('grab', is3d);
        // keyboard access: only the 3D view is interactive, so only it is focusable
        if (is3d) { netBox.setAttribute('tabindex', '0'); netBox.setAttribute('aria-label', '3D puzzle view. Arrow keys rotate, Home or Escape resets.'); }
        else { netBox.removeAttribute('tabindex'); netBox.removeAttribute('aria-label'); }
      };
      const setMode = (mode) => {
        vs.mode = mode; const is3d = mode === '3d';
        b3.classList.toggle('on', is3d); b2.classList.toggle('on', !is3d);
        b3.setAttribute('aria-pressed', is3d ? 'true' : 'false'); b2.setAttribute('aria-pressed', is3d ? 'false' : 'true');
        hint.textContent = is3d ? 'Drag or use arrow keys to rotate. Double-click or press Home to reset.' : '';
        draw();
        if (is3d) netBox.focus();
      };
      const b2 = h('button', { class: 'viewbtn on', 'aria-pressed': 'true', onclick: () => setMode('2d') }, '2D');
      const b3 = h('button', { class: 'viewbtn', 'aria-pressed': 'false', onclick: () => setMode('3d') }, '3D');
      const hint = h('span', { class: 'viewhint' });
      let drag = null;
      netBox.addEventListener('pointerdown', ev => { if (vs.mode !== '3d') return; drag = { x: ev.clientX, y: ev.clientY }; try { netBox.setPointerCapture(ev.pointerId); } catch (e) {} });
      netBox.addEventListener('pointermove', ev => {
        if (!drag || vs.mode !== '3d') return;
        vs.M = R.rotateView(vs.M, (ev.clientX - drag.x) * 0.012, (ev.clientY - drag.y) * 0.012);
        drag = { x: ev.clientX, y: ev.clientY }; draw();
      });
      netBox.addEventListener('pointerup', () => { drag = null; });
      netBox.addEventListener('dblclick', () => { if (vs.mode === '3d') resetView(); });
      netBox.addEventListener('keydown', ev => {
        if (vs.mode !== '3d') return;
        const s = 0.18;
        if (ev.key === 'ArrowLeft') vs.M = R.rotateView(vs.M, -s, 0);
        else if (ev.key === 'ArrowRight') vs.M = R.rotateView(vs.M, s, 0);
        else if (ev.key === 'ArrowUp') vs.M = R.rotateView(vs.M, 0, -s);
        else if (ev.key === 'ArrowDown') vs.M = R.rotateView(vs.M, 0, s);
        else if (ev.key === 'Home' || ev.key === 'Escape') { resetView(); ev.preventDefault(); return; }
        else return;
        draw(); ev.preventDefault();
      });
      draw();
      return h('div', null, h('div', { class: 'viewtoggle' }, b2, b3, hint), netBox);
    })(),
    h('div', { class: 'scrline' }, h('span', { class: 'scrlabel' }, 'scramble'), h('code', { class: 'mono scr' }, shownScramble || '(solved)'), shownScramble ? copyBtn(shownScramble) : null));
  // symmetry strip — clicking a view opens it in a popup
  const strip = h('div', { class: 'symstrip' });
  const shownIx = E.idx(shownState);
  side.variants.forEach((v, i) => {
    strip.appendChild(h('button', { class: 'symthumb' + (v.ix === shownIx ? ' on' : ''),
      title: 'rotation ' + (i + 1) + ' of ' + side.variants.length,
      onclick: () => symPopup(v, i, side.variants.length),
      html: R.netSVG(v.state, 104, { cls: 'oonet thumb', thumb: true }) }));
  });
  wrap.append(h('div', { class: 'symhead' }, side.variants.length + (side.variants.length === 1 ? ' unique view' : ' unique views'), h('span', { class: 'hintt' }, '. Click any view to see it up close.')), strip);
  return wrap;
}
function symPopup(v, i, total) {
  const scrLine = h('div', { class: 'scrline' });
  const show = rand => {
    const scr = dispAlg(E.optimalScramble(v.state, T.dist, rand)) || '(solved)';
    scrLine.innerHTML = '';
    scrLine.append(h('span', { class: 'scrlabel' }, 'scramble to this view'),
      h('code', { class: 'mono scr' }, scr), copyBtn(scr));
  };
  show(false);
  const prevFocus = document.activeElement;          // restore focus here on close
  const closeX = h('button', { class: 'modal-x', 'aria-label': 'close', onclick: () => close() }, '\u00d7');
  const box = h('div', { class: 'modal-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'rotation view' },
    closeX,
    h('div', { class: 'symhead' }, 'rotation ' + (i + 1) + ' of ' + total),
    h('div', { class: 'netwrap modal-net', html: R.netSVG(v.state, 280) }),
    scrLine,
    h('button', { class: 'ghost sm', onclick: () => show(true) }, 'show me another scramble'));
  const ov = h('div', { class: 'modal-ov', onclick: ev => { if (ev.target === ov) close(); } }, box);
  // Escape closes; Tab/Shift+Tab is trapped inside the dialog (aria-modal promises it).
  const onKey = ev => {
    if (ev.key === 'Escape') { close(); return; }
    if (ev.key !== 'Tab') return;
    const f = box.querySelectorAll('button, [href], input, textarea, [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { last.focus(); ev.preventDefault(); }
    else if (!ev.shiftKey && document.activeElement === last) { first.focus(); ev.preventDefault(); }
  };
  function close() {
    ov.remove();
    document.removeEventListener('keydown', onKey);
    if (prevFocus && prevFocus.focus) prevFocus.focus();   // return focus to the trigger
  }
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
  closeX.focus();                                          // move focus into the dialog
}
async function pageClass(main, anyId) {
  if (!(anyId >= 0) || anyId >= E.NSLOTS || T.dist[anyId] < 0) { main.appendChild(h('div', { class: 'card error' }, 'That position doesn\u2019t exist. Check the link and try again.')); return; }
  const exact = E.unidx(anyId);
  const cid = canonOf(exact);          // 24-sym class id == pairId
  const pair = pairOf(cid);
  // the URL keeps the exact state that was entered, so the page shows that view — not a rotated
  // stand-in. Which mirror side it belongs to is decided by the rotation-only canon.
  const exactSide = (!pair.self && pair.b && T.rotCanonOf(exact) === pair.b.id) ? 'b' : 'a';
  const entered = (lastSearch && lastSearch.ix === anyId) ? lastSearch.text : null;

  const sols = await DB.pairSolutions(pair.pairId);
  const doneSet = new Set();
  for (const s of sols) if (s.status === 'approved') { doneSet.add(s.classId); doneSet.add(s.partnerId); }

  main.appendChild(h('div', { class: 'crumbs' },
    h('a', { href: '#/browse/' + pair.a.depth }, 'depth ' + pair.a.depth), ' / position #' + fmt(pair.a.ord + 1)));

  const panels = h('section', { class: 'pairrow' + (pair.self ? ' single' : '') },
    sidePanel(pair.a, pair.self ? 'self-mirror position' : 'position', doneSet, exactSide === 'a' ? { state: exact, scramble: entered } : null),
    pair.self ? null : sidePanel(pair.b, 'LR mirror', doneSet, exactSide === 'b' ? { state: exact, scramble: entered } : null));
  main.appendChild(panels);

  /* solutions */
  const solCard = h('section', { class: 'card solcard' }, h('h3', null, 'Solutions'));
  const approved = sols.filter(s => s.status === 'approved');
  const mine = sols.filter(s => s.status === 'pending');
  if (!approved.length) solCard.appendChild(h('p', { class: 'empty' }, 'Nobody has solved this position yet. Yours could be the first. Submit it below.'));
  for (const s of approved) {
    const shown = dispSol(s), mirrored = dispSolMirror(s);
    const enteredLeft = s.classId === pair.a.id;
    solCard.appendChild(h('div', { class: 'solrow' },
      h('div', { class: 'solcell' },
        h('span', { class: 'soltag' }, pair.self ? 'solution' : (enteredLeft ? 'position' : 'mirror')),
        h('code', { class: 'mono sol' }, shown), copyBtn(shown)),
      pair.self ? null : h('div', { class: 'solcell' },
        h('span', { class: 'soltag auto' }, (enteredLeft ? 'mirror' : 'position') + ' \u00b7 mirrored for you'),
        h('code', { class: 'mono sol' }, mirrored), copyBtn(mirrored)),
      h('div', { class: 'solmeta' }, s.moves + ' moves', s.showName && s.name ? ' \u00b7 by ' + s.name : '')));
  }
  for (const s of mine) solCard.appendChild(h('div', { class: 'solrow pending' },
    h('div', { class: 'solcell' }, h('span', { class: 'soltag' }, 'yours \u00b7 awaiting review'), h('code', { class: 'mono sol' }, dispSol(s))),
    h('div', { class: 'solmeta' }, s.moves + ' moves')));
  main.appendChild(solCard);

  /* submit */
  const sub = h('section', { class: 'card subcard' }, h('h3', null, 'Submit a solution'));
  if (pair.a.depth === 0) {
    // the solved position — counted as done by definition, nothing to submit
    sub.appendChild(h('p', { class: 'empty' }, 'This is the solved position — there’s nothing to solve, so it doesn’t take solutions.'));
  } else if (approved.length >= MAX_SOLUTIONS) {
    // Every scramble keeps at most MAX_SOLUTIONS solutions — this one is full.
    sub.appendChild(h('p', { class: 'empty' }, 'This scramble already has ' + MAX_SOLUTIONS + ' solutions — the maximum. Thanks for looking!'));
  } else if (!DB.user) {
    sub.appendChild(h('p', null, 'You can browse everything without an account. Submitting solutions is limited to moderators — sign in with Google to get started.'));
    sub.appendChild(h('button', { class: 'primary', onclick: () => DB.signIn().catch(() => toast('Sign-in didn’t go through. Please try again.')) }, 'Sign in with Google'));
  } else if (!DB.isMod) {
    sub.appendChild(h('p', null, 'Only moderators can submit solutions. If you’d like to help build the collection, you can apply to become one.'));
    sub.appendChild(requestModBlock());
  } else {
    sub.appendChild(h('p', { style: 'color:var(--mut);font-size:13.5px;margin:.1em 0 .9em' },
      approved.length + ' of ' + MAX_SOLUTIONS + ' solutions recorded for this scramble.'));
    const ta = h('textarea', { class: 'mono solin', rows: '2',
      placeholder: NOTA === 'ns'
        ? "e.g.  R' F R F'   (NS notation \u00b7 rotations x y z free \u00b7 doubles 1 move \u00b7 max 15)"
        : "e.g.  y L U' B2 U L'   (WCA notation \u00b7 rotations x y z free \u00b7 doubles 1 move \u00b7 max 15)" });
    const status = h('div', { class: 'verifyline' }, 'Type a solution in ' + (NOTA === 'ns' ? 'NS' : 'WCA') + ' notation. We check it as you go, against every rotation of both mirrors.');
    const nameRow = h('label', { class: 'namerow' },
      h('input', { type: 'checkbox', checked: '' }), ' show my name (', DB.user.name || DB.user.email, ') on this solution');
    const btn = h('button', { class: 'primary', disabled: '' }, 'Submit for review');
    let lastVerify = null;
    const onInput = () => {
      const v = verifySolution(ta.value, pair); lastVerify = v;
      status.className = 'verifyline ' + (v.ok ? 'good' : (ta.value.trim() ? 'bad' : ''));
      status.textContent = v.ok
        ? '\u2713 Solves the ' + (pair.self || v.side === 'a' ? 'position' : 'mirror') + ' in ' + v.moves + ' moves. Ready to submit.'
        : (ta.value.trim() ? v.error : 'Type a solution in ' + (NOTA === 'ns' ? 'NS' : 'WCA') + ' notation. We check it as you go, against every rotation of both mirrors.');
      if (v.ok) btn.removeAttribute('disabled'); else btn.setAttribute('disabled', '');
    };
    ta.addEventListener('input', onInput);
    btn.addEventListener('click', async () => {
      const v = lastVerify; if (!v || !v.ok) return;
      const sideObj = v.side === 'b' && pair.b ? pair.b : pair.a;
      const partner = pair.self ? sideObj : (v.side === 'a' ? (pair.b || pair.a) : pair.a);
      btn.setAttribute('disabled', '');
      try {
        await DB.submit({
          pairId: pair.pairId, classId: sideObj.id, partnerId: partner.id,
          scramble: sideObj.scramble, solution: ta.value.trim().replace(/\s+/g, ' '),
          notation: NOTA, // the notation the solution text is written in
          moves: v.moves, name: DB.user.name || DB.user.email, showName: nameRow.querySelector('input').checked,
        });
        toast('Thanks! A moderator will review it soon.');
        render();
      } catch (err) { toast('Something went wrong submitting that. Please try again.'); btn.removeAttribute('disabled'); }
    });
    sub.append(ta, status, nameRow, btn);
  }
  main.appendChild(sub);
}

/* ---------------- browse ---------------- */
async function pageBrowse(main, route) {
  const m = route.match(/^#\/browse\/?(\d+)?(?:\/p(\d+))?/);
  const depth = m && m[1] !== undefined ? +m[1] : 8;
  const page = m && m[2] ? +m[2] : 0;
  const bm = await DB.doneMap();
  const isDone = o => isTrivial(o) || testBit(bm, o);

  const chips = h('div', { class: 'depthchips' });
  for (let d = 0; d <= 11; d++) {
    const list = T.depthIdx[d];
    let done = 0; for (const o of list) if (isDone(o)) done++;
    chips.appendChild(h('a', { href: '#/browse/' + d, class: 'depthsel d' + d + (d === depth ? ' on' : '') },
      h('b', null, String(d)), h('span', null, done + '/' + fmt(list.length))));
  }
  main.appendChild(h('section', { class: 'browsehead' },
    h('h2', null, 'Every position, sorted by depth'),
    h('p', { class: 'lede sm' }, 'Depth is the fewest moves a position can be solved in. Click any position to see its mirror, its rotations, and the solutions on record.'),
    chips));

  const full = T.depthIdx[depth];
  const solvedN = full.reduce((a, o) => a + (isDone(o) ? 1 : 0), 0);
  main.appendChild(h('div', { class: 'filterrow' },
    [['all', 'All', full.length], ['unsolved', 'Unsolved', full.length - solvedN], ['solved', 'Solved', solvedN]]
      .map(([v, l, n]) => h('button', { class: 'filterbtn' + (browseFilter === v ? ' on' : ''),
        onclick: () => { browseFilter = v; render(); } }, l, h('span', { class: 'fct' }, fmt(n))))));

  const list = browseFilter === 'solved' ? full.filter(isDone)
    : browseFilter === 'unsolved' ? full.filter(o => !isDone(o)) : full;
  const PER = 48, pages = Math.max(1, Math.ceil(list.length / PER));
  const pg = Math.min(page, pages - 1);
  const grid = h('div', { class: 'classgrid' });
  for (let i = pg * PER; i < Math.min(list.length, (pg + 1) * PER); i++) {
    const o = list[i], cid = T.reps[o];
    const st = E.unidx(cid);
    grid.appendChild(h('a', { href: '#/c/' + cid, class: 'classcell' + (isDone(o) ? ' done' : '') },
      h('div', { html: R.netSVG(st, 124, { cls: 'oonet thumb', thumb: true }) }),
      h('div', { class: 'cellmeta' }, '#' + fmt(o + 1), isDone(o) ? h('span', { class: 'tick' }, ' \u2713') : null)));
  }
  main.appendChild(grid);
  const pager = h('div', { class: 'pager' },
    h('a', { href: '#/browse/' + depth + '/p' + Math.max(0, pg - 1), class: 'ghost' + (pg === 0 ? ' off' : '') }, '\u2190 previous'),
    h('span', { class: 'pginfo' }, 'page ' + fmt(pg + 1) + ' of ' + fmt(pages) + ' \u00b7 ' + fmt(list.length) + ' positions at depth ' + depth),
    h('a', { href: '#/browse/' + depth + '/p' + Math.min(pages - 1, pg + 1), class: 'ghost' + (pg >= pages - 1 ? ' off' : '') }, 'next \u2192'),
    h('button', { class: 'ghost', onclick: () => {
      const un = full.filter(o => !isDone(o));
      if (!un.length) { toast('Every position at this depth is already solved. Try another depth.'); return; }
      const o = un[Math.floor(Math.random() * un.length)];
      location.hash = '#/c/' + T.reps[o];
    } }, 'random unsolved at this depth'));
  main.appendChild(pager);
}

/* ---------------- moderation ---------------- */
async function pageMod(main) {
  if (!DB.isMod) { main.appendChild(h('div', { class: 'card error' }, 'This page is for moderators. Sign in with a moderator account to review submissions.')); return; }
  const items = await DB.pending();
  const head = h('h2', null, 'Review queue \u00b7 ' + items.length + ' pending');
  main.appendChild(head);
  if (!items.length) main.appendChild(h('p', { class: 'empty' }, 'Nothing to review right now. The queue refreshes when you reopen this tab.'));
  for (const s of items) {
    // a malformed submission (out-of-range ids from a direct/forged write) would
    // make pairOf -> E.unidx produce garbage; surface it as rejectable, don't render it.
    if (!(validId(s.classId) && validId(s.partnerId) && validId(s.pairId))) {
      main.appendChild(h('section', { class: 'card modrow' },
        h('div', { class: 'modbody' }, h('div', { class: 'verifyline bad' }, '✗ Broken submission (puzzle ids out of range)')),
        h('div', { class: 'modacts' },
          h('button', { class: 'danger', onclick: async () => { await DB.review(s.id, 'rejected'); toast('Rejected.'); render(); } }, 'Reject'))));
      continue;
    }
    const pr = pairOf(s.classId);
    // re-verify in the notation the solution was SUBMITTED in — "R' L R L'"
    // parses in both notations but means different corners in each.
    const v = verifySolution(s.solution, pr, s.notation === 'ns' ? 'ns' : 'wca');
    const row = h('section', { class: 'card modrow' },
      h('div', { class: 'modleft', html: R.netSVG(E.unidx(s.classId), 160, { cls: 'oonet thumb', thumb: true }) }),
      h('div', { class: 'modbody' },
        h('div', { class: 'scrline' }, h('span', { class: 'scrlabel' }, 'scramble'), h('code', { class: 'mono scr' }, s.scramble)),
        h('div', { class: 'scrline' }, h('span', { class: 'scrlabel' }, 'solution'), h('code', { class: 'mono sol' }, s.solution)),
        h('div', { class: 'verifyline ' + (v.ok ? 'good' : 'bad') },
          v.ok ? '\u2713 verified \u00b7 ' + s.moves + ' moves' + (s.notation === 'ns' ? ' \u00b7 NS notation' : '') + ' \u00b7 by ' + (s.name || 'anonymous') + (s.showName ? '' : ' (name hidden)')
               : '\u2717 fails verification now: ' + v.error)),
      h('div', { class: 'modacts' },
        h('button', { class: 'primary', disabled: v.ok ? null : '', onclick: async ev => {
          ev.target.setAttribute('disabled', '');
          try { await DB.review(s.id, 'approved'); toast('Approved. Position marked solved.'); render(); }
          catch (err) {
            toast(err && err.message === 'CAP'
              ? 'This scramble already has ' + MAX_SOLUTIONS + ' solutions (the maximum). Reject this one instead.'
              : 'Something went wrong approving that. Please try again.');
            ev.target.removeAttribute('disabled');
          }
        } }, 'Approve'),
        h('button', { class: 'danger', onclick: async () => { await DB.review(s.id, 'rejected'); toast('Rejected.'); render(); } }, 'Reject'),
        h('a', { class: 'ghost', href: '#/c/' + s.pairId }, 'open position')));
    main.appendChild(row);
  }
  /* moderators \u2014 admin only (managing moderators is restricted to admins) */
  if (DB.isAdmin) {
    const mc = h('section', { class: 'card' }, h('h3', null, 'Moderators'));
    const mods = await DB.mods();
    const tbl = h('div', { class: 'modlist' });
    for (const mEntry of mods) tbl.appendChild(h('div', { class: 'modent' },
      h('span', null, mEntry.email || mEntry.uid, mEntry.invite ? ' \u00b7 invited, not yet signed in' : ''),
      h('button', { class: 'ghost sm', onclick: async () => { await DB.revoke(mEntry.invite ? mEntry.email : mEntry.uid); render(); } }, 'remove')));
    if (!mods.length) tbl.appendChild(h('p', { class: 'empty' }, 'No additional moderators yet.'));
    const inv = h('div', { class: 'inviterow' },
      h('input', { class: 'searchin', placeholder: 'google account email', 'aria-label': 'moderator email' }),
      h('button', { class: 'primary', onclick: async ev => {
        const em = ev.target.parentElement.querySelector('input').value.trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { toast('Enter a valid email.'); return; }
        await DB.invite(em); toast('Invited. They become a moderator the next time they sign in.'); render();
      } }, 'Add moderator'));
    mc.append(tbl, inv);
    main.appendChild(mc);
  }
}

/* ---------------- about ---------------- */
function pageAbout(main) {
  main.appendChild(h('section', { class: 'card prose' },
    h('h2', null, 'How OO solutions work'),
    h('p', null, 'The Skewb has exactly 3,149,280 positions, and every one can be solved in 11 moves or fewer. That part is proven by computer. What a computer can\u2019t tell you is which short solution feels best in your hands. This page collects the community\u2019s pick, one position at a time.'),
    h('h3', null, 'Positions, rotations and mirrors'),
    h('p', null, 'Rotating the whole puzzle doesn\u2019t change the solve, and a position and its left\u2013right mirror are the same solve with mirrored algorithms \u2014 so they count as one. Folding the 12 rotations and the mirror together, those 3,149,280 scrambles come down to ' + fmt(T.reps.length) + ' positions. Every position page shows the position and its mirror side by side, each with up to 12 rotation views. Submit a solution to either one and we generate the mirrored version for you; one approved solution marks the whole position as done.'),
    h('h3', null, 'Notation'),
    h('p', null, 'Everything is written in standard WCA notation by default. The WCA / NS switch in the top bar changes every scramble and solution on the site to NS notation \u2014 the system the Sarah / NS alg sheets use, where each of the eight corners has its own letter.'),
    h('div', { class: 'nottable' },
      nrow('R U L B', 'WCA \u00b7 1 move each', "in the scrambling hold (white top, green left, red right), R, U and L turn the bottom-right, top-back and bottom-left corners; B turns the hidden back corner. R' and R2 both mean the inverse twist, still 1 move."),
      nrow('F R B L \u00b7 f r b l', 'NS \u00b7 1 move each', 'uppercase turns the four top corners, lowercase the four bottom corners \u2014 front, right, back, left. WCA R U L B are NS r B l b; NS F f R L twist corners WCA can\u2019t name without a rotation.'),
      nrow('x y z', 'rotations \u00b7 0 moves', 'rotate the whole puzzle 90\u00b0, like on a cube; combine freely \u00b7 the same in both notations')),
    h('h3', null, 'Submitting and review'),
    h('p', null, 'Submitting solutions is limited to moderators. Solutions can be up to 15 moves and are checked automatically: they have to really solve the scramble, from any rotation, on either mirror. A moderator then reviews each one before it goes live, and we check it again at that point. Each scramble keeps at most ' + MAX_SOLUTIONS + ' solutions, so once two are approved that position is settled.'),
    h('h3', null, 'Becoming a moderator'),
    h('p', null, 'Want to help build the collection? Anyone can apply to become a moderator \u2014 moderators are the ones who submit and review solutions.'),
    requestModBlock(),
    h('h3', null, 'Privacy'),
    h('p', null, 'Anyone can browse without an account. Your name shows up on a solution only if you leave \u201cshow my name\u201d checked.')));
  if (DB.user) main.appendChild(h('section', { class: 'card prose' },
    h('h3', null, 'Your account'),
    h('p', null, 'Signed in as ' + (DB.user.email || DB.user.name) + '.'),
    h('div', { class: 'scrline' }, h('span', { class: 'scrlabel' }, 'user id'),
      h('code', { class: 'mono scr' }, DB.user.uid), copyBtn(DB.user.uid)),
    h('p', null, 'If you run this site, paste this id into the Firestore security rules to become the admin (see SETUP.md).')));
  function nrow(a, b, c) {
    return h('div', { class: 'nrow' }, h('code', { class: 'mono' }, a), h('b', null, b), h('span', null, c));
  }
}

/* ---------------- boot ---------------- */
async function boot() {
  const bootEl = $('#boot-status');
  const label = $('#boot-label'), barEl = $('#boot-bar'), trackEl = $('#boot-track');
  const report = (stage, n, total) => {
    const names = { cache: 'Loading cached tables', bfs: 'Mapping all 3,149,280 positions', classes: 'Condensing symmetries' };
    const pct = Math.round(100 * n / total);
    label.textContent = (names[stage] || stage) + '\u2026';
    barEl.style.width = pct + '%';
    if (trackEl) trackEl.setAttribute('aria-valuenow', pct);   // announce progress to AT
  };
  DB = (window.OOAccount.mode === 'live') ? liveDB() : demoDB();
  DB.onChange(() => render());
  const dbInit = DB.init().catch(e => { DB.failed = (e && e.message) || 'unknown error'; });
  await buildTables(report);
  await dbInit;
  bootEl.classList.add('gone');
  setTimeout(() => bootEl.remove(), 500); // the overlay physically leaves the DOM
  render();
}
async function render() {
  try { await renderInner(); }
  catch (err) {
    console.error(err);
    const root = app(); root.innerHTML = '';
    root.appendChild(h('div', { class: 'card error', style: 'margin:48px auto;max-width:680px' },
      'Something went wrong loading this page. Try reloading.'));
  }
}
installErrorToast();
window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', boot);
window.OOApp = { verifySolution, pairOf, T, get DB() { return DB; }, ordinalOf };
})();
