/* FTO trainer substrate — no React, no DOM. (M4)
 *
 * Everything here runs on the shared engine (window.OOEngine, passed in as E).
 * Unlike the Skewb parent there is NO distance table: the FTO state space
 * (~3.1e22) has no full-state BFS, so drill scrambles are SETUP scrambles —
 * the case's algorithm inverted at the resolved-native-move level, plus a
 * random AUF (a U-layer pre-turn, the way the case appears mid-solve).
 *
 * Why native-move inversion: the engine's invertAlg is textual and refuses
 * bracket rotations (and is wrong across a fresh hold for any rotation-
 * containing alg), but walkParsed re-resolves every letter through the hold
 * model and emits absolute native move indices — reversing and inverting THAT
 * list is the exact inverse of the alg's state effect, and it comes out as
 * plain face letters: executable from the scrambling hold, no brackets or
 * rotations for the user to interpret.
 *
 * The component (fto-trainer.jsx) owns UI and persistence; this module owns
 * the math: the case model over data/fto_algs.json (fetched at runtime — the
 * JSON is the single authority), per-case drill specs, and setup scrambles.
 *
 * Plain .mjs so Node tests (tools/test-trainer.mjs) can import it with the
 * documented window-stub engine recipe; esbuild bundles it natively.
 */

export const SEP = '\u001f';                 // id separator (case names are free-form)
export const AUF = ['', 'U', "U'"];          // token appended to the setup for auf = 0/1/2
export const AUF_UNDO = ['', "U'", 'U'];     // what the solver does first to undo it

export function createCore(E) {
  const U_CW = 2 * E.FIDX.U;                 // native move indices of the AUF turn
  const U_CCW = U_CW + 1;
  const AUF_MOVE = [-1, U_CW, U_CCW];
  const AUF_UNDO_MOVE = [-1, U_CCW, U_CW];

  // ---------- case model ----------
  // JSON shape (data/fto_algs.json): subsets = { KEY: { name, notation (hold
  // dialect, 'cif' default), groups: [names], auf?: false, cases: [{ name,
  // group, recognition, moves, moves_note, algs: [{ alg, notation? }] }] } }.
  // buildModel is pure JSON shaping (no engine calls); all state derivation is
  // lazy per case via caseSpec(), so trainer boot stays instant.
  function buildModel(json) {
    const subsets = [];
    for (const key of Object.keys(json.subsets || {})) {
      const src = json.subsets[key];
      if (!src.cases || !src.cases.length) continue;
      const dialect = src.notation === 'eif' ? 'eif' : 'cif';
      const auf = src.auf !== false;         // AUF randomization off for future non-last-layer sets
      const cases = src.cases.map((c) => ({ ...c, subset: key, uid: key + SEP + c.name, dialect, auf }));
      let groups;
      if (src.groups && src.groups.length) {
        groups = src.groups.map((g) => ({ value: g, label: g, cases: cases.filter((c) => c.group === g) }));
        const claimed = new Set(groups.flatMap((g) => g.cases.map((c) => c.uid)));
        const stray = cases.filter((c) => !claimed.has(c.uid));
        if (stray.length) groups.push({ value: SEP + 'other', label: 'Other', cases: stray });
      } else {
        groups = [{ value: '', label: 'All', cases }];
      }
      subsets.push({ key, name: src.name || key, dialect, cases, groups });
    }
    return { subsets };
  }

  // ---------- alg flattening ----------
  // Resolved native moves of an alg (dialect-aware). Brackets, o/T rotations,
  // wides and slices all flatten to absolute face turns; the state effect of
  // the returned list equals the alg's (rotations are frame-only). Returns
  // null if the alg doesn't parse, has no moves, or hits an impossible bracket.
  function nativeMovesOf(algStr, dialect) {
    const p = E.parseAlg(algStr);
    if (!p || !p.some((t) => t.kind === 'move')) return null;
    const out = [];
    try { E.walkParsed(p, (m) => out.push(m), dialect); } catch (e) { return null; }
    return out;
  }

  // merge/cancel adjacent same-face moves (every face turn has order 3)
  function mergeMoves(mis) {
    const out = [];
    for (let mi of mis) {
      while (mi >= 0 && out.length && (out[out.length - 1] >> 1) === (mi >> 1)) {
        const a = out.pop();
        const sum = ((a & 1 ? 2 : 1) + (mi & 1 ? 2 : 1)) % 3;
        mi = sum === 0 ? -1 : (mi & ~1) | (sum === 2 ? 1 : 0);
      }
      if (mi >= 0) out.push(mi);
    }
    return out;
  }

  // ---------- per-case drill spec (memoized) ----------
  // rows: every authored alg with its dialect, resolved native moves, and the
  // exact state it solves (caseStateOf self-checks the alg against it).
  // anchor = the first usable alg; it defines the case's drill state.
  // rows[i].k = the AUF offset from the anchor this alg is authored at
  // (its state == anchor state then U^k), or -1 for an off-orbit variant.
  function caseSpec(c) {
    let out = specCache.get(c.uid);
    if (out) return out;
    const rows = [];
    for (const a of c.algs || []) {
      const dialect = a.notation === 'eif' ? 'eif' : a.notation === 'cif' ? 'cif' : c.dialect;
      const natives = nativeMovesOf(a.alg, dialect);
      const state = natives ? E.caseStateOf(a.alg, dialect) : null;
      rows.push({ a, dialect, natives, state, key: state ? E.stateKey(state) : null, k: -1 });
    }
    const anchor = rows.find((r) => r.state) || null;
    out = { rows, ok: !!anchor, anchor, aufKeys: null };
    if (anchor) {
      out.aufKeys = [
        E.stateKey(anchor.state),
        E.stateKey(E.move(anchor.state, U_CW)),
        E.stateKey(E.move(anchor.state, U_CCW)),
      ];
      for (const r of rows) if (r.key) r.k = out.aufKeys.indexOf(r.key);
    }
    specCache.set(c.uid, out);
    return out;
  }
  const specCache = new Map();

  // ---------- setup scrambles ----------
  // Drill problem: scramble = inverse of the anchor alg's resolved native
  // moves (merged) plus a random AUF; state = what the scramble produces from
  // solved (= the anchor's case state, then the AUF turn). The solve is
  // AUF_UNDO[auf], then the alg. rng is injectable for tests.
  function makeDrill(c, rng) {
    const rnd = rng || Math.random;
    const spec = caseSpec(c);
    if (!spec.ok) return null;
    const inv = mergeMoves(spec.anchor.natives.slice().reverse().map((m) => m ^ 1));
    const auf = c.auf === false ? 0 : Math.floor(rnd() * 3) % 3;
    const seq = auf ? mergeMoves(inv.concat(AUF_MOVE[auf])) : inv;
    const state = auf ? E.move(spec.anchor.state, AUF_MOVE[auf]) : E.copy(spec.anchor.state);
    return {
      kind: 'drill', c, uid: c.uid, subset: c.subset,
      scramble: seq.map((m) => E.MOVES[m]).join(' '),
      state, auf, aufUndo: AUF_UNDO[auf],
    };
  }

  // reveal chip for an alg row on a drill: the U pre-turn that takes the shown
  // state to the state this alg is authored at ('' when none, null off-orbit)
  function rowAufToken(row, drill) {
    if (row.k < 0) return null;
    return AUF[(row.k - drill.auf + 3) % 3];
  }

  // machine check (also pinned in tools/test-trainer.mjs): the scramble
  // reproduces the shown state from solved, and undoing the AUF then running
  // the anchor alg (in its dialect) solves it.
  function verifyDrill(d) {
    const p = E.parseAlg(d.scramble);
    if (!p) return false;
    let st = E.applyParsed(p, E.solved());
    if (!E.eq(st, d.state)) return false;
    if (d.auf) st = E.move(st, AUF_UNDO_MOVE[d.auf]);
    const spec = caseSpec(d.c);
    const pa = E.parseAlg(spec.anchor.a.alg);
    try { return E.eq(E.applyParsed(pa, st, spec.anchor.dialect), E.solved()); }
    catch (e) { return false; }
  }

  // ---------- first-center step drill (Bencisco step trainers, v1) ----------
  // FC is the table bundle from window.OOTables.buildFirstCenter(E): the
  // white-hexagon coordinate (290,400), exact distance tables under two
  // metrics (dist16 = face turns, dist24 = face + slice turns at unit cost),
  // the 12 goal formations, and the 24 unit generators. The drill starts
  // from a solved puzzle and only the white center is drilled (the diagram
  // masks to its pieces), so the scramble's one job is to displace the
  // white center: a SHORT walk — 10 canonical native moves (engine
  // suppression rules), rejection-sampled on the white-center distance when
  // an exact difficulty is requested. 10 stays above God's number 7, so a
  // scramble never reads as the inverse of an optimal solution, and the
  // short walk lands shallow depths far MORE often than the old 30-move
  // full scramble did (measured: rarest exact level ~1.5e-3 at length 10
  // vs ~2.5e-4 at 30). Reveal enumerates ALL optimal solutions
  // (canonicalized: commuting same-axis runs in fixed layer order) and
  // respells them token by token through the engine's own hold walk, so
  // slice-containing texts mean exactly what the engine (and the sheets'
  // dialect) say they mean.

  const FC_LEN = 10;                          // short walk: the step assumes a solved puzzle
  const FC_TRIES = 60000;                     // exact-N rejection cap (rarest level ~1.5e-3)
  const FC_ENUM_CAP = 512;                    // DFS harvest cap (display slices from it)

  const fcEdgeImg = (M, e) => {
    const a = E.vertImg(M, E.EDGES[e][0]), b = E.vertImg(M, E.EDGES[e][1]);
    const lo = Math.min(a, b), hi = Math.max(a, b);
    return E.EDGES.findIndex((q) => q[0] === lo && q[1] === hi);
  };

  // Table-independent goal predicate: the white triangles fill one tetrad-A
  // face block AND U's edges sit as the restriction of a tetrad-preserving
  // proper rotation with M(U) = that face. This is the definition the tables
  // were built FROM, evaluated on a full state — verifyFcDrill uses it so a
  // broken BFS table cannot vouch for itself.
  function fcStateOK(FC, s) {
    const pos = [];
    for (let i = 0; i < 12; i++) if (s.ctr[i] === 0) pos.push(i);
    if (pos.length !== 3) return false;
    const X = (pos[0] / 3) | 0;
    if (pos[0] !== 3 * X || pos[1] !== 3 * X + 1 || pos[2] !== 3 * X + 2) return false;
    const at = FC.U_EDGES.map((q) => s.ep.indexOf(q));
    return FC.T12.some((M) => E.faceImg(M, 0) === X &&
      FC.U_EDGES.every((q, i) => at[i] === fcEdgeImg(M, q)));
  }

  const fcDist = (FC, metric) => (metric === 'native' ? FC.dist16 : FC.dist24);
  const fcGn = (FC, metric) => (metric === 'native' ? FC.gn16 : FC.gn24);

  // slot -> facelet maps shared by the step-trainer masks (centre slot 3f+k,
  // corner vertex, edge slot), derived once from the engine's features
  let _slotF = null;
  function slotFacelets() {
    if (_slotF) return _slotF;
    const CTRF = new Array(24);
    const CORNF = Array.from({ length: 6 }, () => []);
    const EDGEF = Array.from({ length: 12 }, () => []);
    for (let i = 0; i < 72; i++) {
      const ft = E.FEAT[i];
      if (ft.t === 'x') CTRF[3 * ft.f + (ft.v % 3)] = i;
      else if (ft.t === 'c') CORNF[ft.v].push(i);
      else EDGEF[E.EDGES.findIndex((q) => q[0] === ft.v && q[1] === ft.v2)].push(i);
    }
    _slotF = { CTRF, CORNF, EDGEF };
    return _slotF;
  }

  // diagram mask: neutral-fill everything except the step's pieces — the
  // three white-sticker edges and the three white triangles, wherever they
  // sit. Those 9 facelets determine the coordinate exactly: the edges' side
  // stickers tell the three pieces apart, and the white triangles are
  // identical, which is all the mask index reads.
  function fcMask(FC, s) {
    const { CTRF, EDGEF } = slotFacelets();
    const keep = new Set();
    for (let x = 0; x < 12; x++) if (s.ctr[x] === 0) keep.add(CTRF[x]);
    for (let e = 0; e < 12; e++)
      if (FC.U_EDGES.includes(s.ep[e])) for (const i of EDGEF[e]) keep.add(i);
    const mask = [];
    for (let i = 0; i < 72; i++) if (!keep.has(i)) mask.push(i);
    return mask;
  }

  // scramble + drill: target = 0 for "any" (rerolls the already-solved case),
  // 1..gn for an exact optimal length. Returns null only on rejection-cap
  // exhaustion (practically: a stuck injected rng).
  function makeFcDrill(FC, opts, rng) {
    const rnd = rng || Math.random;
    const metric = opts && opts.metric === 'native' ? 'native' : 'token';
    const dist = fcDist(FC, metric);
    let target = (opts && Number.isInteger(opts.target)) ? opts.target : 0;
    if (target < 0 || target > fcGn(FC, metric)) target = 0;
    const start = FC.coordOf(E.solved());
    for (let att = 0; att < FC_TRIES; att++) {
      const seq = [];
      let c = start, last = -1, prev = -1, guard = 0;
      while (seq.length < FC_LEN) {
        if (++guard > 400) break;          // a stuck rng must exhaust attempts, not hang
        const f = (rnd() * 8) | 0;
        if (f === last) continue;
        if (last >= 0 && E.OPPF[f] === last && f === prev) continue;   // no R BL R
        const m = 2 * f + ((rnd() * 2) | 0);
        seq.push(m); c = FC.stepNative(c, m); prev = last; last = f;
      }
      if (seq.length < FC_LEN) continue;
      if (target ? dist[c] !== target : dist[c] === 0) continue;
      let state = E.solved();
      for (const m of seq) state = E.move(state, m);
      return {
        kind: 'fc', metric, target, coord: c, optimal: dist[c],
        scramble: seq.map((m) => E.MOVES[m]).join(' '), state,
        mask: fcMask(FC, state),
      };
    }
    return null;
  }

  // respell a fixed-frame generator sequence as engine-exact tokens: after a
  // slice the engine rotates the reading hold, so each step picks the ONE
  // token that makes walkParsed of the whole text emit exactly the intended
  // native moves (a slice's two opposite-layer natives commute — either
  // emission order is the same effect).
  function fcRespell(FC, genSeq) {
    let text = '';
    let prefix = [];
    for (const gi of genSeq) {
      const gm = FC.GENS[gi].moves;
      let found = null;
      for (const tok of FC_TOKENS) {
        const trial = (text ? text + ' ' : '') + tok;
        const got = [];
        try { E.walkParsed(E.parseAlg(trial), (m) => got.push(m)); } catch (e) { continue; }
        if (got.length !== prefix.length + gm.length) continue;
        if (!prefix.every((m, i) => got[i] === m)) continue;
        const ch = got.slice(prefix.length);
        const ok = gm.length === 1 ? ch[0] === gm[0]
          : (ch[0] === gm[0] && ch[1] === gm[1]) || (ch[0] === gm[1] && ch[1] === gm[0]);
        if (!ok) continue;
        found = { trial, got };
        break;
      }
      if (!found) return null;
      text = found.trial;
      prefix = found.got;
    }
    return { text, natives: prefix };
  }
  const FC_TOKENS = (() => {
    const out = [];
    for (const f of E.FACES) out.push(f, f + "'");
    for (const f of ['U', 'F', 'R', 'L']) out.push(f + 's', f + "s'");
    return out;
  })();

  // canonical optimal-word enumeration at a coordinate: exact count (memoized
  // DP over strictly-descending moves, commuting same-axis runs in fixed layer
  // order) plus up to `cap` harvested generator sequences. Shared by the fc
  // reveal and the span DP (which REJECTS its scramble when total > cap — the
  // phased target is only ever computed from a complete harvest).
  function fcEnumOpt(FC, coord, metric, cap) {
    const dist = fcDist(FC, metric);
    const nGens = metric === 'native' ? 16 : FC.GENS.length;
    const memo = new Map();
    const count = (c, axis, rank) => {
      if (dist[c] === 0) return 1;
      const key = (c * 5 + axis + 1) * 3 + rank;
      const hit = memo.get(key);
      if (hit !== undefined) return hit;
      let n = 0;
      for (let gi = 0; gi < nGens; gi++) {
        const g = FC.GENS[gi];
        if (g.axis === axis && g.rank <= rank) continue;
        const t = FC.stepGen(c, gi);
        if (dist[t] === dist[c] - 1) n += count(t, g.axis, g.rank);
      }
      memo.set(key, n);
      return n;
    };
    const total = dist[coord] === 0 ? 0 : count(coord, -1, 0);
    const seqs = [];
    const rec = (c, axis, rank, path) => {
      if (seqs.length >= cap) return;
      if (dist[c] === 0) { seqs.push(path.slice()); return; }
      for (let gi = 0; gi < nGens; gi++) {
        const g = FC.GENS[gi];
        if (g.axis === axis && g.rank <= rank) continue;
        const t = FC.stepGen(c, gi);
        if (dist[t] !== dist[c] - 1) continue;
        path.push(gi);
        rec(t, g.axis, g.rank, path);
        path.pop();
        if (seqs.length >= cap) return;
      }
    };
    if (dist[coord] > 0) rec(coord, -1, 0, []);
    return { total, seqs };
  }

  // all optimal solutions for a drill: exact canonical count + up to `show`
  // display lines, each respelled, landing-tagged (hold-aware: where the
  // hexagon physically ends given the solution's slices) and re-proved on
  // the full state before it is emitted.
  function fcSolutions(FC, drill, show) {
    const { total, seqs: raw } = fcEnumOpt(FC, drill.coord, drill.metric, FC_ENUM_CAP);
    // order by (fewest slices, generator-token text) BEFORE the expensive
    // respell, then respell/prove only until `show` lines survive — the rest
    // of the harvest never needed spelling out
    const scored = raw.map((seq) => ({
      seq,
      sliceCount: seq.reduce((n, gi) => n + (FC.GENS[gi].rank === 1 ? 1 : 0), 0),
      key: seq.map((gi) => FC.GENS[gi].tok).join(' '),
    }));
    scored.sort((a, b) => a.sliceCount - b.sliceCount || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const lines = [];
    let dropped = 0;
    for (const s of scored) {
      if (lines.length >= (show || 10)) break;
      const sp = fcRespell(FC, s.seq);
      if (!sp) { dropped++; continue; }
      const parsed = E.parseAlg(sp.text);
      const st2 = E.applyParsed(parsed, drill.state);
      // never emit an unproved line: token count + independent state predicate
      if (E.countMoves(parsed) !== drill.optimal || !fcStateOK(FC, st2)) { dropped++; continue; }
      let c2 = drill.coord;
      for (const gi of s.seq) c2 = FC.stepGen(c2, gi);
      const face = FC.landingFace(c2);
      const hold = E.walkParsed(parsed, () => {});
      const p = hold.indexOf(face);
      lines.push({
        text: sp.text, sliceCount: s.sliceCount,
        landing: p >= 0 ? E.FACES[p] : E.FACES[face],
      });
    }
    return { total, dropped, capped: raw.length >= FC_ENUM_CAP, lines };
  }

  // full re-proof of a drill from scratch (tests + UI spot checks): plain-
  // letter scramble reproduces the state, the coordinate and optimal match
  // the tables, and the state is genuinely unsolved (never a null drill).
  function verifyFcDrill(FC, d) {
    if (!d || d.kind !== 'fc') return false;
    const toks = d.scramble.split(/\s+/).filter(Boolean);
    if (toks.length !== FC_LEN || !toks.every((t) => /^(BR|BL|[UFRLDB])'?$/.test(t))) return false;
    const p = E.parseAlg(d.scramble);
    if (!p) return false;
    let st = E.solved();
    E.walkParsed(p, (m) => { st = E.move(st, m); });
    if (!E.eq(st, d.state)) return false;
    if (FC.coordOf(st) !== d.coord) return false;
    const dist = fcDist(FC, d.metric);
    if (dist[d.coord] !== d.optimal || d.optimal < 1) return false;
    if (d.target && d.optimal !== d.target) return false;
    return fcStateOK(FC, st) === false;
  }

  // ---------------- first-two-triples step drill (Bencisco step trainers, v2) ----------------
  // FT is the bundle from window.OOTables.buildF2T/loadOrBuildF2T(E): the
  // Bencisco hold (makeBLHold) plus corner/orbit-A distance-to-goal tables in
  // the sealed group's 10-native-move TURN metric — with free re-grips every
  // sealed move is one hold token from every grip, so that metric IS "how
  // many turns", the only optimal a move-count drill may claim (the solver's
  // re-grip reading penalty would overestimate it).
  //
  // The drill: a SHORT scramble (16 canonical moves over the 10 physical
  // moves that seal the white-on-top hexagon — the method-frame sealed group
  // conjugated back through the primary white anchor), rejection-sampled so
  // the white center ends exactly home and the drilled triples end unsolved;
  // 'second' mode then appends an optimal solve of one bottom triple so it
  // starts pre-solved. The user re-orients into the Bencisco hold and solves
  // with R / U / Rw; the reveal enumerates ALL optimal sealed words, respells
  // each as one continuous solver-style line (one {X,Y} entry bracket, then
  // triple tokens with relative {X,Y} re-grips where the grip walk needs
  // them), and re-proves every line end-to-end from the drill state.

  const F2T_LEN = 16;                         // scramble walk length (vs 30 for full scrambles)
  const F2T_TRIES = 4000;                     // rejection cap (white-home alone is ~1/3)
  const F2T_ENUM_CAP = 512;                   // optimal-word harvest cap
  const F2T_NODES = 3e6;                      // enumeration node budget per call
  const F2T_LMAX = 16;                        // no F2T state needs more turns (asserted by search)
  const F2T_SLOTS = { 3: [6, 9], 5: [5, 8] }; // method corner -> its orbit-A slots (solver pin)
  const F2T_CORNER_NAME = { 3: 'back', 5: 'right' };  // solver stepLabel naming

  function conjState(M, s) {                  // physical rotation of the arrangement
    const F = E.toFacelets(s), P = E.rotFaceletPerm(M), F2 = new Array(72);
    for (let i = 0; i < 72; i++) F2[i] = E.faceImg(M, F[P[i]]);
    return E.fromFacelets(F2);
  }

  // method-frame step predicates (the solver's hexOK('D') / tripleOK)
  const f2tHexOK = (s) => s.ep[9] === 9 && s.ep[10] === 10 && s.ep[11] === 11 &&
    s.ctr[18] === 6 && s.ctr[19] === 6 && s.ctr[20] === 6;
  function f2tTripleOK(s, c) {
    if (s.cp[c] !== c || s.co[c] !== 0) return false;
    for (const x of F2T_SLOTS[c]) if (s.ctr[x] !== ((x / 3) | 0)) return false;
    return true;
  }
  // goals: '3' / '5' (one specific triple), 'either' (mode first), 'pair'
  // (modes second + both). Every goal keeps the first center exactly home.
  function f2tGoalOK(s, goal) {
    if (!f2tHexOK(s)) return false;
    if (goal === '3' || goal === '5') return f2tTripleOK(s, +goal);
    if (goal === 'either') return f2tTripleOK(s, 3) || f2tTripleOK(s, 5);
    return f2tTripleOK(s, 3) && f2tTripleOK(s, 5);
  }

  // shared environment, derived once from the engine and asserted (anchor,
  // physical alphabet, entry/re-grip spells, slot -> facelet maps)
  let _f2tEnv = null;
  function f2tEnv(FT) {
    if (_f2tEnv) return _f2tEnv;
    const BL = FT.BL, FIDX = E.FIDX, FACES = E.FACES;
    const holdOf = (t) => E.walkParsed(E.parseAlg(t), () => {});
    const spellOfHold = (h) => '{' + FACES[h[0]] + ',' + FACES[h[1]] + '}';
    // primary white anchor: the first ROT24 rotation mapping white (engine U)
    // onto the method's D region — the solver's primary spin
    const M = E.ROT24.find((R) => E.faceImg(R, FIDX.U) === FIDX.D);
    const Minv = E.mInv(M);
    const anchorHold = [0, 1, 2, 3, 4, 5, 6, 7].map((p) => E.faceImg(Minv, p));
    const anchorSpell = spellOfHold(anchorHold);
    if (!['{D,L}', '{D,R}', '{D,B}'].includes(anchorSpell) ||
        holdOf(anchorSpell).join() !== anchorHold.join())
      throw new Error('f2t: anchor spell ' + anchorSpell);
    // entry brackets: identity hold (the scramble is plain letters) into
    // anchor∘grip j, spelled as ONE {X,Y} token and re-proved by the walk
    const ENTRY = BL.SPELLS.map((gs) => {
      const h = holdOf(anchorSpell + ' ' + gs);
      const spell = spellOfHold(h);
      if (holdOf(spell).join() !== h.join()) throw new Error('f2t: entry spell ' + spell);
      return spell;
    });
    // mid-word re-grips: the solver's relative-bracket construction
    const REGRIP = BL.holds.map((hj, j) => BL.holds.map((ht, t) => t === j ? ''
      : '{' + FACES[hj.indexOf(ht[0])] + ',' + FACES[hj.indexOf(ht[1])] + '}'));
    for (let j = 0; j < 3; j++) for (let t = 0; t < 3; t++) {
      if (t === j) continue;
      if (holdOf(BL.SPELLS[j] + ' ' + REGRIP[j][t]).join() !== BL.holds[t].join())
        throw new Error('f2t: re-grip bracket ' + REGRIP[j][t]);
    }
    // physical sealed alphabet: the sealed moves conjugated back into the
    // scrambling hold (proper rotations preserve cw), pinned on a probe
    const PHYS = BL.SEALED_MOVES.map((m) => 2 * E.faceImg(Minv, m >> 1) + (m & 1));
    const physFaces = [...new Set(PHYS.map((m) => m >> 1))].sort((a, b) => a - b);
    if (physFaces.join() !== [FIDX.U, FIDX.F, FIDX.BR, FIDX.BL, FIDX.D].sort((a, b) => a - b).join())
      throw new Error('f2t: physical sealed set ' + physFaces);
    let probe = E.solved();
    for (const m of [0, 5, 12, 9, 3, 14]) probe = E.move(probe, m);
    for (let k = 0; k < PHYS.length; k++)
      if (!E.eq(conjState(M, E.move(probe, PHYS[k])), E.move(conjState(M, probe), BL.SEALED_MOVES[k])))
        throw new Error('f2t: sealed conjugation mismatch at ' + k);
    // token spelling tables: per grip, engine move -> triple token (R/U/Rw
    // only — the triple alphabet), and engine face -> the grip whose plain U
    // reads it (the composite's target grip)
    const TOKOF = [0, 1, 2].map((j) => {
      const map = {};
      for (let k = 0; k < 6; k++) map[BL.gen[j][k].m] = k;
      return map;
    });
    const gripOfFace = {};
    for (let j = 0; j < 3; j++) gripOfFace[BL.gen[j][2].m >> 1] = j;
    // slot -> facelet maps (mask): shared with the first-center mask
    const { CTRF, CORNF, EDGEF } = slotFacelets();
    const U_EDGE_SLOTS = E.EDGES.map((q, i) => (q[2] === FIDX.U ? i : -1)).filter((i) => i >= 0);
    const P = E.rotFaceletPerm(M);            // method facelet i lives at physical facelet P[i]
    _f2tEnv = { BL, M, Minv, anchorSpell, ENTRY, REGRIP, PHYS, TOKOF, gripOfFace,
                CTRF, CORNF, EDGEF, U_EDGE_SLOTS, P };
    return _f2tEnv;
  }

  const f2tWhiteHome = (env, s) =>
    env.U_EDGE_SLOTS.every((e) => s.ep[e] === e) &&
    s.ctr[0] === 0 && s.ctr[1] === 0 && s.ctr[2] === 0;

  // admissible turn-metric heuristic: max of the marginal tables (min over
  // the two corners for the 'either' goal) and the ≥1 realign bound when the
  // first center is spun. 99 = sealed-unreachable (prunes instantly).
  function f2tH(FT, goal) {
    const dC = FT.dC, dA = FT.dA;
    const one = (cKey, aKey) => (s) => {
      const a = dC[cKey][FT.cornerIndex(s.cp, s.co)], b = dA[aKey][FT.encA(s.ctr)];
      return a > b ? a : b;
    };
    const h3 = one('3', '6,9'), h5 = one('5', '5,8'), hp = one('3,5', '5,6,8,9');
    const base = goal === '3' ? h3 : goal === '5' ? h5
      : goal === 'either' ? (s) => Math.min(h3(s), h5(s)) : hp;
    return (s) => {
      const h = base(s);
      return h === 0 && s.ep[9] !== 9 ? 1 : h;
    };
  }

  // canonical sealed-word DFS: harvest words of length exactly L reaching
  // the goal (same successor rules as the solver's native DFS). cap = 1 is
  // the find-first probe f2tSearchLen iterates with.
  const F2T_STACK = [];
  function f2tStack(d) {
    while (F2T_STACK.length <= d)
      F2T_STACK.push({ cp: new Array(6), co: new Array(6), ep: new Array(12), ctr: new Array(24) });
    return F2T_STACK[d];
  }
  function f2tMoveInto(m, s, o) {
    const t = E.moveTables[m];
    for (let v = 0; v < 6; v++) { o.cp[v] = s.cp[t.cperm[v]]; o.co[v] = s.co[t.cperm[v]] ^ t.cflip[v]; }
    for (let e = 0; e < 12; e++) o.ep[e] = s.ep[t.eperm[e]];
    for (let x = 0; x < 24; x++) o.ctr[x] = s.ctr[t.xperm[x]];
  }
  // shared canonical sealed-word DFS (the solver's successor rules): harvest
  // words of length exactly L whose end state satisfies goalOK. hOver(s, lim)
  // answers "is the admissible bound > lim" — the early-exit form lets the
  // centers drill skip most of its table reads at interior nodes.
  function sealedDFS(moves, goalOK, hOver, s0, L, cap, budget) {
    const words = [];
    const path = [];
    let nodes = 0, capped = false;
    const rec = (s, g, lastFace) => {
      if (capped || ++nodes > budget) { capped = true; return; }
      if (g === L) {
        if (goalOK(s)) {
          words.push(path.slice());
          if (words.length >= cap) capped = true;
        }
        return;
      }
      if (hOver(s, L - g)) return;
      const t = f2tStack(g);
      for (const m of moves) {
        const f = m >> 1;
        if (f === lastFace) continue;
        if (E.OPPF[f] === lastFace && f > lastFace) continue;
        f2tMoveInto(m, s, t);
        path.push(m);
        rec(t, g + 1, f);
        path.pop();
        if (capped) return;
      }
    };
    if (L > 0) rec(s0, 0, -1);
    return { words, capped };
  }
  function f2tEnumerate(FT, s0, goal, L, cap) {
    const h = f2tH(FT, goal);
    return sealedDFS(FT.BL.SEALED_MOVES, (s) => f2tGoalOK(s, goal), (s, lim) => h(s) > lim,
      s0, L, cap || F2T_ENUM_CAP, F2T_NODES);
  }
  // exact optimal turn count (or null past F2T_LMAX / on a budget trip).
  // maxBound (optional): the caller only cares about results < maxBound (the
  // span DP's branch-and-bound) — null then means "provably not better".
  // flags.tripped marks the null UNCERTIFIABLE (budget trip, or the search
  // exhausted its range without covering what the caller asked about): the
  // span DP must reject the drill rather than trust it.
  function f2tSearchLen(FT, s0, goal, maxBound, flags) {
    if (f2tGoalOK(s0, goal)) return 0;
    const h0 = f2tH(FT, goal)(s0);
    if (h0 >= 99) return null;
    const top = maxBound == null ? F2T_LMAX : Math.min(F2T_LMAX, maxBound - 1);
    for (let bound = Math.max(1, h0); bound <= top; bound++) {
      const r = f2tEnumerate(FT, s0, goal, bound, 1);
      if (r.words.length) return bound;
      if (r.capped) { if (flags) flags.tripped = true; return null; }
    }
    if (flags && (maxBound == null || maxBound - 1 > F2T_LMAX)) flags.tripped = true;
    return null;
  }

  // deterministic hold-token respell of a sealed engine word: engine U/D
  // turns are the grip-independent R / Rw tokens (Rw drifts the grip,
  // walkParsed semantics); an engine L/R/B turn is the plain U of its grip,
  // with a relative {X,Y} re-grip bracket fused in front when the walk sits
  // elsewhere. The entry bracket covers the start grip, so all three are
  // tried and the fewest-bracket spelling wins (the solver's display taste).
  function f2tRespell(env, word) {
    let best = null;
    for (let j0 = 0; j0 < 3; j0++) {
      let j = j0, brackets = 0;
      const out = [];
      for (const m of word) {
        let k = env.TOKOF[j][m];
        if (k === undefined) {
          const t = env.gripOfFace[m >> 1];
          if (t === undefined) return null;
          out.push(env.REGRIP[j][t]);
          brackets++;
          j = t;
          k = env.TOKOF[j][m];
          if (k === undefined) return null;
        }
        out.push(env.BL.TOKS[k]);
        j = env.BL.gen[j][k].nj;
      }
      if (!best || brackets < best.brackets)
        best = { brackets, text: out.join(' '), j0, jEnd: j };
    }
    return best;
  }

  // diagram mask: neutral-fill everything except the drill's pieces — the
  // white hexagon (home by construction), the two bottom-triple corners
  // wherever they sit, and every candidate source triangle (the orbit-A
  // F/BR/BL colors: within a color the 3 triangles are identical, so ALL of
  // them are legitimate sources — the sheets' two-usable-triangles freedom).
  function f2tKeepM(env, sM) {
    const keepM = [];
    for (const e of [9, 10, 11]) keepM.push(...env.EDGEF[e]);
    for (const x of [18, 19, 20]) keepM.push(env.CTRF[x]);
    for (const c of [3, 5]) keepM.push(...env.CORNF[sM.cp.indexOf(c)]);
    for (let x = 0; x < 12; x++) if (sM.ctr[x] >= 1 && sM.ctr[x] <= 3) keepM.push(env.CTRF[x]);
    return keepM;
  }
  function f2tMask(env, sM) {
    const keep = new Set(f2tKeepM(env, sM).map((i) => env.P[i]));
    const mask = [];
    for (let i = 0; i < 72; i++) if (!keep.has(i)) mask.push(i);
    return mask;
  }

  // scramble + drill. mode: 'first' (solve either bottom triple), 'second'
  // (one pre-solved, solve the other), 'both'. Returns null only on
  // rejection-cap exhaustion (practically: a stuck injected rng).
  function makeF2tDrill(FT, opts, rng) {
    const rnd = rng || Math.random;
    const env = f2tEnv(FT);
    const mode = opts && (opts.mode === 'first' || opts.mode === 'second') ? opts.mode : 'both';
    const goal = mode === 'first' ? 'either' : 'pair';
    for (let att = 0; att < F2T_TRIES; att++) {
      let seq = [];
      let last = -1, guard = 0;
      while (seq.length < F2T_LEN) {
        if (++guard > 600) break;               // a stuck rng must exhaust attempts, not hang
        const m = env.PHYS[(rnd() * 10) | 0];
        const f = m >> 1;
        if (f === last) continue;
        if (E.OPPF[f] === last && f > last) continue;
        seq.push(m); last = f;
      }
      if (seq.length < F2T_LEN) continue;
      let st = E.solved();
      for (const m of seq) st = E.move(st, m);
      if (!f2tWhiteHome(env, st)) continue;     // the walk may only SPIN the white center
      let sM = conjState(env.M, st);
      if (f2tTripleOK(sM, 3) || f2tTripleOK(sM, 5)) continue;
      let presolved = 0;
      if (mode === 'second') {
        const c = rnd() < 0.5 ? 3 : 5;
        const L1 = f2tSearchLen(FT, sM, String(c));
        if (L1 == null || L1 < 1) continue;
        const w = f2tEnumerate(FT, sM, String(c), L1, 1).words[0];
        if (!w) continue;
        seq = mergeMoves(seq.concat(w.map((m) => 2 * E.faceImg(env.Minv, m >> 1) + (m & 1))));
        st = E.solved();
        for (const m of seq) st = E.move(st, m);
        sM = conjState(env.M, st);
        if (!f2tWhiteHome(env, st) || !f2tTripleOK(sM, c) || f2tTripleOK(sM, c === 3 ? 5 : 3)) continue;
        presolved = c;
      }
      const optimal = f2tSearchLen(FT, sM, goal);
      if (optimal == null || optimal < 1) continue;
      return {
        kind: 'f2t', mode, goal, presolved,
        scramble: seq.map((m) => E.MOVES[m]).join(' '),
        state: st, stateM: sM, optimal,
        mask: f2tMask(env, sM),
      };
    }
    return null;
  }

  // all optimal solutions for a drill, solver-style: each line is ONE
  // continuous engine text ({X,Y} entry bracket + triple tokens + relative
  // re-grip brackets), sorted plainest-first, and re-proved end-to-end on
  // the full drill state before it is emitted.
  function f2tSolutions(FT, drill, show) {
    const env = f2tEnv(FT);
    const res = f2tEnumerate(FT, drill.stateM, drill.goal, drill.optimal);
    const spelled = [];
    let dropped = 0;
    for (const w of res.words) {
      const sp = f2tRespell(env, w);
      if (sp) spelled.push(sp); else dropped++;
    }
    spelled.sort((a, b) => a.brackets - b.brackets || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
    const lines = [];
    for (const sp of spelled) {
      if (lines.length >= (show || 10)) break;
      const text = env.ENTRY[sp.j0] + ' ' + sp.text;
      const parsed = E.parseAlg(text);
      if (!parsed || E.countMoves(parsed) !== drill.optimal) { dropped++; continue; }
      const sM2 = conjState(env.M, E.applyParsed(parsed, drill.state));
      if (!f2tGoalOK(sM2, drill.goal)) { dropped++; continue; }
      lines.push({
        text, brackets: sp.brackets,
        corner: drill.goal !== 'either' ? null
          : f2tTripleOK(sM2, 3) && f2tTripleOK(sM2, 5) ? 'both'
          : f2tTripleOK(sM2, 3) ? F2T_CORNER_NAME[3] : F2T_CORNER_NAME[5],
      });
    }
    return { total: res.words.length, capped: res.capped, dropped, lines };
  }

  // full re-proof of a drill from scratch (tests + UI spot checks)
  function verifyF2tDrill(FT, d) {
    if (!d || d.kind !== 'f2t') return false;
    const env = f2tEnv(FT);
    const toks = d.scramble.split(/\s+/).filter(Boolean);
    if (!toks.length || toks.length > F2T_LEN + 12) return false;
    if (!toks.every((x) => /^(U|F|BR|BL|D)'?$/.test(x))) return false;
    for (let i = 1; i < toks.length; i++)
      if (toks[i].replace("'", '') === toks[i - 1].replace("'", '')) return false;
    const p = E.parseAlg(d.scramble);
    if (!p) return false;
    let st = E.solved();
    E.walkParsed(p, (m) => { st = E.move(st, m); });
    if (!E.eq(st, d.state) || !f2tWhiteHome(env, st)) return false;
    const sM = conjState(env.M, st);
    if (!E.eq(sM, d.stateM)) return false;
    if (d.mode === 'second') {
      if (!f2tTripleOK(sM, d.presolved) || f2tTripleOK(sM, d.presolved === 3 ? 5 : 3)) return false;
    } else if (d.presolved !== 0 || f2tTripleOK(sM, 3) || f2tTripleOK(sM, 5)) return false;
    if (f2tGoalOK(sM, d.goal)) return false;    // never a solved drill
    return f2tSearchLen(FT, sM, d.goal) === d.optimal;
  }

  // ---------------- second/third-center step drill (Bencisco step trainers, v3) ----------------
  // CT is the bundle from window.OOTables.buildC23/loadOrBuildC23(E): the
  // one-hexagon exact / hexagon-pair edge / orbit-B pattern distance tables
  // in the RESTRICTED triple-preserving metric (user spec 2026-07-16: the
  // solved triples must never be taken out of place, and no mid-solve
  // rotations — Rw does the re-gripping). The alphabet is exactly
  // {R, U, Rw}: R = engine U, U = the working {L,R,B} face the current
  // grip reads (Rw's drift tracks the block position, so from the one
  // aligned entry grip the U token can never hit a triple), Rw = engine D
  // with drift. A restricted word CANNOT disturb the triples or the white
  // center relative to them — the block sits at D^b(home) for b = the net
  // drift — so the F2T triple tables are gone from this search entirely;
  // the goal needs b = 0 (white exactly home) plus the formed hexagons.
  //
  // The drill starts where a real Bencisco solve stands after the first two
  // triples: the printed scramble is a 16-move canonical sealed walk PLUS a
  // machine-optimal solve of both bottom triples (which also lands the white
  // center exactly home), and mode 'third' appends a machine-optimal
  // second-center solve on top (searched in this same restricted metric).
  // Goals are placement-neutral, matching the solver's "search picks"
  // semantics: 'second' forms ANY one of the three remaining hexagons,
  // 'third' and 'both' reach any two of them — always with the white center
  // and both triples exactly solved again at the end (which the restricted
  // system guarantees at b = 0 by construction).

  const C23_LEN = 16;                         // scramble walk length (before the appended solves)
  const C23_TRIES = 40;                       // attempts are cheap to reject, expensive to finish
  const C23_ENUM_CAP = 512;                   // optimal-word harvest cap
  const C23_NODES = 2e7;                      // enumeration node budget per call
  const C23_LMAX = 26;                        // bound guard for the iterative deepening
  const C23_FACES = ['L', 'R', 'B'];          // the method-frame candidate hexagons
  const C23_EDGES = {};                       // face -> its 3 edge slots (derived like the solver)
  for (const f of C23_FACES) {
    const fi = E.FIDX[f];
    C23_EDGES[f] = E.EDGES.map((e, i) => (e[2] === fi || e[3] === fi) ? i : -1).filter((i) => i >= 0);
    if (C23_EDGES[f].length !== 3) throw new Error('c23: hexagon edge set ' + f);
  }

  function c23HexOK(s, f) {
    const fi = E.FIDX[f];
    for (const e of C23_EDGES[f]) if (s.ep[e] !== e) return false;
    for (let k = 0; k < 3; k++) if (s.ctr[3 * fi + k] !== fi) return false;
    return true;
  }
  const c23CountHex = (s) => C23_FACES.reduce((n, f) => n + (c23HexOK(s, f) ? 1 : 0), 0);
  // goals: 'c1' (any one hexagon formed) / 'c2' (any two). Every goal keeps
  // the first center exactly home and both bottom triples re-solved.
  function c23GoalOK(s, goal) {
    if (!f2tHexOK(s) || !f2tTripleOK(s, 3) || !f2tTripleOK(s, 5)) return false;
    return c23CountHex(s) >= (goal === 'c2' ? 2 : 1);
  }

  // The center searches run 10+ turns deep, so unlike the F2T DFS this one
  // never carries full states: a node is five small indices plus the drift
  // counter b, stepped through CT.rt's Int32 transition tables (the three
  // candidate hexagons' 3-edge placements; the orbit-B L/R color masks,
  // B's mask being the complement via CT.MKB since the restricted group
  // pins the white triangles). The block never appears in the node at all:
  // restricted words keep it at D^b(home) by construction (init-asserted in
  // tables.js), so "white + triples re-solved" is exactly b === 0. The goal
  // test and every pruning bound are O(1) table reads on those indices, and
  // the emitted words are re-proved on full states — including a per-prefix
  // block-intactness walk — by the solutions/verify layer, so the search
  // and the proof stay independent.
  //
  // Admissible bounds, all in the restricted metric and all resolved at the
  // node's own b: the hexagon goal is a disjunction over faces ('c1') /
  // pairs ('c2'), so its part is a MIN over candidates, each candidate a
  // MAX of the exact one-hexagon table, the orbit-B mask-pair table and
  // (pairs) the exact 6-edge coupling. Any two hexagon blocks plus D force
  // the whole orbit, so every 'c2' candidate shares the single dB.all bound.
  const NMKc = 220, NE3c = 1320;              // CT codec sizes (mask / 3-edge placement)
  function c23IxOf(CT, s) {
    const pB = new Array(12);
    for (let i = 0; i < 12; i++) pB[i] = s.ctr[12 + i] - 4;
    return [
      CT.edgePlaceIndex(s.ep, CT.HEX_EDGES.L),
      CT.edgePlaceIndex(s.ep, CT.HEX_EDGES.R),
      CT.edgePlaceIndex(s.ep, CT.HEX_EDGES.B),
      CT.maskOfColor(pB, 0), CT.maskOfColor(pB, 1),
    ];
  }
  function c23DFS(FT, CT, s0, goal, L, cap, budget) {
    const mE3 = CT.rt.mE3, mMB = CT.rt.mMB;
    const dBL_ = CT.dB.L, dBR_ = CT.dB.R, dBB_ = CT.dB.B, dBall = CT.dB.all;
    const hL_ = CT.dH1.L, hR_ = CT.dH1.R, hB_ = CT.dH1.B;
    const eLR = CT.dE33.LR, eLB = CT.dE33.LB, eRB = CT.dE33.RB;
    const MKB = CT.MKB, HOME = CT.HOME, MOVES = CT.RES.MOVES;
    const pair = goal === 'c2';
    const need = pair ? 2 : 1;
    const words = [], path = [];
    let nodes = 0, capped = false;
    const goalIx = (eL, eR, eB, mL, mR, b) => {
      if (b !== 0) return false;              // white home + triples ⇔ zero net drift
      let n = (eL === HOME.eL && mL === HOME.mL ? 1 : 0) + (eR === HOME.eR && mR === HOME.mR ? 1 : 0);
      if (n < need && eB === HOME.eB && MKB[mL * NMKc + mR] === HOME.mB) n++;
      return n >= need;
    };
    const rec = (eL, eR, eB, mL, mR, b, g, lastFace) => {
      if (capped || ++nodes > budget) { capped = true; return; }
      if (g === L) {
        if (goalIx(eL, eR, eB, mL, mR, b)) {
          words.push(path.slice());
          if (words.length >= cap) capped = true;
        }
        return;
      }
      const lim = L - g;
      const u = mL * NMKc + mR;
      const u3 = u * 3 + b;
      if (pair) {
        if (dBall[u3] > lim) return;
        const hL = hL_[(eL * NMKc + mL) * 3 + b], hR = hR_[(eR * NMKc + mR) * 3 + b];
        let fits = hL <= lim && hR <= lim && eLR[(eL * NE3c + eR) * 3 + b] <= lim;
        if (!fits) {
          const hB = hB_[(eB * NMKc + MKB[u]) * 3 + b];
          fits = (hL <= lim && hB <= lim && eLB[(eL * NE3c + eB) * 3 + b] <= lim) ||
                 (hR <= lim && hB <= lim && eRB[(eR * NE3c + eB) * 3 + b] <= lim);
        }
        if (!fits) return;
      } else {
        const fits = (dBL_[u3] <= lim && hL_[(eL * NMKc + mL) * 3 + b] <= lim) ||
                     (dBR_[u3] <= lim && hR_[(eR * NMKc + mR) * 3 + b] <= lim) ||
                     (dBB_[u3] <= lim && hB_[(eB * NMKc + MKB[u]) * 3 + b] <= lim);
        if (!fits) return;
      }
      const row = MOVES[b];
      for (let k = 0; k < 6; k++) {
        const m = row[k][0], f = m >> 1;
        if (f === lastFace) continue;
        if (E.OPPF[f] === lastFace && f > lastFace) continue;
        path.push(m);
        rec(mE3[eL * 16 + m], mE3[eR * 16 + m], mE3[eB * 16 + m],
            mMB[mL * 16 + m], mMB[mR * 16 + m],
            (b + row[k][1]) % 3, g + 1, f);
        path.pop();
        if (capped) return;
      }
    };
    if (L > 0) {
      const ix = c23IxOf(CT, s0);
      rec(ix[0], ix[1], ix[2], ix[3], ix[4], 0, 0, -1);
    }
    return { words, capped };
  }

  // exact-root admissible bound over the same tables (the root is always a
  // drill state: block home, b = 0)
  function c23HVal(FT, CT, s, goal) {
    const [eL, eR, eB, mL, mR] = c23IxOf(CT, s);
    const u = mL * NMKc + mR;
    const mB = CT.MKB[u];
    let h = 0;
    const bump = (v) => { if (v > h) h = v; };
    const hL = CT.dH1.L[(eL * NMKc + mL) * 3], hR = CT.dH1.R[(eR * NMKc + mR) * 3];
    const hB = mB === 255 ? 99 : CT.dH1.B[(eB * NMKc + mB) * 3];
    if (goal === 'c2') {
      bump(CT.dB.all[u * 3]);
      bump(Math.min(
        Math.max(hL, hR, CT.dE33.LR[(eL * NE3c + eR) * 3]),
        Math.max(hL, hB, CT.dE33.LB[(eL * NE3c + eB) * 3]),
        Math.max(hR, hB, CT.dE33.RB[(eR * NE3c + eB) * 3])));
    } else {
      bump(Math.min(Math.max(CT.dB.L[u * 3], hL), Math.max(CT.dB.R[u * 3], hR), Math.max(CT.dB.B[u * 3], hB)));
    }
    return h === 0 && !c23GoalOK(s, goal) ? 1 : h;
  }

  function c23Enumerate(FT, CT, s0, goal, L, cap) {
    return c23DFS(FT, CT, s0, goal, L, cap || C23_ENUM_CAP, C23_NODES);
  }
  // exact optimal turn count (or null past C23_LMAX / on a budget trip).
  // maxBound / flags: the f2tSearchLen contract (span DP branch-and-bound).
  function c23SearchLen(FT, CT, s0, goal, maxBound, flags) {
    if (c23GoalOK(s0, goal)) return 0;
    const h0 = c23HVal(FT, CT, s0, goal);
    if (h0 >= 99) return null;
    const top = maxBound == null ? C23_LMAX : Math.min(C23_LMAX, maxBound - 1);
    for (let bound = Math.max(1, h0); bound <= top; bound++) {
      const r = c23Enumerate(FT, CT, s0, goal, bound, 1);
      if (r.words.length) return bound;
      if (r.capped) { if (flags) flags.tripped = true; return null; }
    }
    if (flags && (maxBound == null || maxBound - 1 > C23_LMAX)) flags.tripped = true;
    return null;
  }

  // deterministic token spelling for restricted CENTER words: engine U turns
  // are R, engine D turns are Rw (drifting b), and the working-face turn at
  // the current b is the plain U — nothing else can occur in a restricted
  // word, so the spelling is a 1:1 walk with no DP, no brackets and no BL.
  function c23Spell(CT, word) {
    const D2 = 2 * E.FIDX.D;
    const out = [];
    let b = 0, wides = 0;
    for (const m of word) {
      if (m === 0) out.push('R');
      else if (m === 1) out.push("R'");
      else if (m === D2) { out.push('Rw'); wides++; b = (b + 1) % 3; }
      else if (m === D2 + 1) { out.push("Rw'"); wides++; b = (b + 2) % 3; }
      else if (m >> 1 === CT.RES.XF[b]) out.push((m & 1) ? "U'" : 'U');
      else return null;                        // cannot happen for restricted words
    }
    if (b !== 0) return null;                  // goal words always net-align
    return { wides, text: out.join(' ') };
  }

  // per-prefix block proof for a displayed line: the text's fired moves must
  // BE the word (the entry bracket fires nothing), and after every single
  // move the method-frame block must sit exactly at D^b(home) — the user's
  // "triples never leave their place" contract, checked on full states.
  const c23BlockOK = (CT, s, b) => {
    const S = CT.RES.SLOTS[b], R = CT.RES.REF[b];
    for (let i = 0; i < S.e.length; i++) if (s.ep[S.e[i]] !== R.ep[i]) return false;
    for (let i = 0; i < S.c.length; i++) if (s.cp[S.c[i]] !== R.cp[i] || s.co[S.c[i]] !== R.co[i]) return false;
    for (let i = 0; i < S.x.length; i++) if (s.ctr[S.x[i]] !== R.ctr[i]) return false;
    return true;
  };
  function c23LineWalkOK(env, CT, drill, text, word) {
    const parsed = E.parseAlg(text);
    if (!parsed) return false;
    const fired = [];
    E.walkParsed(parsed, (m) => fired.push(m));
    if (fired.length !== word.length) return false;
    for (let i = 0; i < word.length; i++)      // physical fired moves ↔ method word
      if (2 * E.faceImg(env.M, fired[i] >> 1) + (fired[i] & 1) !== word[i]) return false;
    const D2 = 2 * E.FIDX.D;
    let sM = drill.stateM, b = 0;
    for (const m of word) {
      sM = E.move(sM, m);
      b = (b + (m === D2 ? 1 : m === D2 + 1 ? 2 : 0)) % 3;
      if (!c23BlockOK(CT, sM, b)) return false;
    }
    return b === 0;
  }

  // the method-frame face's letter in the SCRAMBLING hold (what the diagram
  // and the printed scramble live in) — chips and hints name faces there
  const c23PhysFace = (env, f) => E.FACES[E.faceImg(env.Minv, E.FIDX[f])];

  // diagram mask: neutral-fill everything except the step's pieces — every
  // edge (the white hexagon's three are home; the three candidate hexagons
  // partition the other nine), every orbit-B triangle (the white centres are
  // home, the other nine are the candidates' identical-triangle sources),
  // both solved bottom triples (corners + the orbit-A source triangles, the
  // F2T rule — a center word moves them and must put them back).
  function c23KeepM(env, sM) {
    const keepM = [];
    for (let e = 0; e < 12; e++) keepM.push(...env.EDGEF[e]);
    for (let x = 12; x < 24; x++) keepM.push(env.CTRF[x]);
    for (let x = 0; x < 12; x++) if (sM.ctr[x] >= 1 && sM.ctr[x] <= 3) keepM.push(env.CTRF[x]);
    for (const c of [3, 5]) keepM.push(...env.CORNF[sM.cp.indexOf(c)]);
    return keepM;
  }
  function c23Mask(env, sM) {
    const keep = new Set(c23KeepM(env, sM).map((i) => env.P[i]));
    const mask = [];
    for (let i = 0; i < 72; i++) if (!keep.has(i)) mask.push(i);
    return mask;
  }

  // scramble + drill. mode: 'second' (form any one of the three remaining
  // hexagons), 'third' (one pre-solved by an appended machine-optimal word,
  // reach two), 'both' (reach two from none). Returns null only on
  // rejection-cap exhaustion (practically: a stuck injected rng).
  function makeC23Drill(FT, CT, opts, rng) {
    const rnd = rng || Math.random;
    const env = f2tEnv(FT);
    const mode = opts && (opts.mode === 'third' || opts.mode === 'both') ? opts.mode : 'second';
    const goal = mode === 'second' ? 'c1' : 'c2';
    const toPhys = (m) => 2 * E.faceImg(env.Minv, m >> 1) + (m & 1);
    const refold = (seq) => {
      let st = E.solved();
      for (const m of seq) st = E.move(st, m);
      return st;
    };
    for (let att = 0; att < C23_TRIES; att++) {
      // 16 canonical sealed physical moves (the F2T walk). No white-home
      // rejection: the appended triples solve re-aligns any white spin.
      let seq = [];
      let last = -1, guard = 0;
      while (seq.length < C23_LEN) {
        if (++guard > 600) break;               // a stuck rng must exhaust attempts, not hang
        const m = env.PHYS[(rnd() * 10) | 0];
        const f = m >> 1;
        if (f === last) continue;
        if (E.OPPF[f] === last && f > last) continue;
        seq.push(m); last = f;
      }
      if (seq.length < C23_LEN) continue;
      let st = refold(seq);
      let sM = conjState(env.M, st);
      // append a machine-optimal solve of both bottom triples: the drill
      // starts exactly where a real solve enters the second-center step
      if (!f2tGoalOK(sM, 'pair')) {
        const Lp = f2tSearchLen(FT, sM, 'pair');
        if (Lp == null || Lp < 1) continue;
        const w = f2tEnumerate(FT, sM, 'pair', Lp, 1).words[0];
        if (!w) continue;
        seq = mergeMoves(seq.concat(w.map(toPhys)));
        st = refold(seq);
        sM = conjState(env.M, st);
        if (!f2tGoalOK(sM, 'pair')) continue;
      }
      let presolved = null;
      let solvedNow = C23_FACES.filter((f) => c23HexOK(sM, f));
      if (mode === 'third') {
        if (solvedNow.length === 0) {
          const L1 = c23SearchLen(FT, CT, sM, 'c1');
          if (L1 == null || L1 < 1) continue;
          const w = c23Enumerate(FT, CT, sM, 'c1', L1, 1).words[0];
          if (!w) continue;
          seq = mergeMoves(seq.concat(w.map(toPhys)));
          st = refold(seq);
          sM = conjState(env.M, st);
          if (!f2tGoalOK(sM, 'pair')) continue;
          solvedNow = C23_FACES.filter((f) => c23HexOK(sM, f));
        }
        if (solvedNow.length !== 1) continue;
        presolved = solvedNow[0];
      } else if (solvedNow.length) continue;    // second/both start with none formed
      const optimal = c23SearchLen(FT, CT, sM, goal);
      if (optimal == null || optimal < 1) continue;
      return {
        kind: 'c23', mode, goal, presolved,
        presolvedFace: presolved ? c23PhysFace(env, presolved) : null,
        scramble: seq.map((m) => E.MOVES[m]).join(' '),
        state: st, stateM: sM, optimal,
        mask: c23Mask(env, sM),
      };
    }
    return null;
  }

  // all optimal solutions for a drill, solver-style: the ONE fixed {X,Y}
  // entry bracket (the aligned grip), then plain {R, U, Rw} tokens — no BL,
  // no mid-solve rotations; sorted fewest-wides-first, every line re-proved
  // end-to-end on the full drill state before it is emitted, INCLUDING the
  // per-prefix proof that the solved triples never leave their place. The
  // chip lists the faces (in the scrambling hold) whose hexagons the line
  // leaves formed.
  function c23Solutions(FT, CT, drill, show) {
    const env = f2tEnv(FT);
    const res = c23Enumerate(FT, CT, drill.stateM, drill.goal, drill.optimal);
    const spelled = [];
    let dropped = 0;
    for (const w of res.words) {
      const sp = c23Spell(CT, w);
      if (sp) spelled.push({ ...sp, word: w }); else dropped++;
    }
    spelled.sort((a, b) => a.wides - b.wides || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
    const entry = env.ENTRY[CT.RES.j0];
    const lines = [];
    for (const sp of spelled) {
      if (lines.length >= (show || 10)) break;
      const text = entry + ' ' + sp.text;
      const parsed = E.parseAlg(text);
      if (!parsed || E.countMoves(parsed) !== drill.optimal) { dropped++; continue; }
      const sM2 = conjState(env.M, E.applyParsed(parsed, drill.state));
      if (!c23GoalOK(sM2, drill.goal)) { dropped++; continue; }
      if (!c23LineWalkOK(env, CT, drill, text, sp.word)) { dropped++; continue; }
      lines.push({
        text, wides: sp.wides,
        centers: C23_FACES.filter((f) => c23HexOK(sM2, f)).map((f) => c23PhysFace(env, f)),
      });
    }
    return { total: res.words.length, capped: res.capped, dropped, lines };
  }

  // full re-proof of a drill from scratch (tests + UI spot checks)
  function verifyC23Drill(FT, CT, d) {
    if (!d || d.kind !== 'c23') return false;
    const env = f2tEnv(FT);
    const toks = d.scramble.split(/\s+/).filter(Boolean);
    if (!toks.length || toks.length > C23_LEN + 32) return false;
    if (!toks.every((x) => /^(U|F|BR|BL|D)'?$/.test(x))) return false;
    for (let i = 1; i < toks.length; i++)
      if (toks[i].replace("'", '') === toks[i - 1].replace("'", '')) return false;
    const p = E.parseAlg(d.scramble);
    if (!p) return false;
    let st = E.solved();
    E.walkParsed(p, (m) => { st = E.move(st, m); });
    if (!E.eq(st, d.state) || !f2tWhiteHome(env, st)) return false;
    const sM = conjState(env.M, st);
    if (!E.eq(sM, d.stateM)) return false;
    if (!f2tGoalOK(sM, 'pair')) return false;   // white center + both triples solved at start
    const solvedNow = C23_FACES.filter((f) => c23HexOK(sM, f));
    if (d.mode === 'third') {
      if (solvedNow.length !== 1 || solvedNow[0] !== d.presolved) return false;
      if (d.presolvedFace !== c23PhysFace(env, d.presolved)) return false;
    } else if (d.presolved !== null || solvedNow.length !== 0) return false;
    if (c23GoalOK(sM, d.goal)) return false;    // never a solved drill
    return c23SearchLen(FT, CT, sM, d.goal) === d.optimal;
  }

  // ---------------- LBT / L3T finish drills (step trainers v5) ----------------
  // The last two Bencisco steps are SHEET-ALGORITHM steps: no move-search
  // tables, the target is the fewest turns over the machine-proven sheet
  // executions (countMoves of the exact printed text — S/H macros count as
  // their four physical turns, a wide as one, rotations as zero). Everything
  // is derived at build time from the fetched alg JSON (buildFinish):
  //
  //   L3T stage space = the closure of {U, S, H} from solved = 4320 states
  //   (the coset; 1440 of them edges-home, the rest AUF-displaced — real LBT
  //   landings include those). Solutions come from TWO sheet systems and the
  //   drill shows BOTH (user spec):
  //     1L3T      exact-state match over the 1L3T + TCP entries, with
  //               {ε,U,U'} pre/trailing AUFs and the three U-axis re-grips
  //               ({U,BR}/{U,BL} brackets) — covers 3237 of the 4317
  //               non-trivial coset states (machine-measured; the sheet has
  //               no case for the rest even re-gripped).
  //     1LP→TCP   pair formation then the TCP finish: [optional re-grip]
  //               [optional AUF] + a 1LP line whose case APPEARANCE matches
  //               the view (the sheet's yellow/blue language — the flip-
  //               sequence theorem guarantees the landing is formed), then
  //               at most two TCP algorithms (the sheet's own "or 2-look")
  //               with their own re-grips/AUFs and a final AUF. The TCP
  //               2-look closure covers ALL 216 formed states (measured,
  //               worst finish 15 turns); the 1LP sheet's 11 cases cover 6
  //               of the 12 appearance orbits, so the full chain exists for
  //               2967 coset states.
  //   The L3T drill space = states BOTH systems solve (2013; the drill
  //   samples the coset uniformly and rejects the rest — never shows a
  //   panel it cannot prove). Target = the minimum over every proven line
  //   of either system.
  //
  //   The LBT drill space = the before-LBT states the LBT sheet solves:
  //   everything outside the slot-4 + last-layer region solved, edges home,
  //   at least one sheet entry (120 algs, the 21 setup-undo closings
  //   appended, {ε,U,U'} pre-AUFs — the solver's index construction) whose
  //   effect lands the state inside the L3T coset. Sampling is EXACTLY
  //   uniform over that space: draw (entry, coset state), apply the inverse
  //   entry effect, then accept with probability 1/k where k = the state's
  //   applicable-entry count (the constructive distribution weights a state
  //   by k, so 1/k-thinning is the textbook uniformizer). States whose LBT
  //   slot is already solved are pure-L3T states and are excluded, as are
  //   the trapped-source dead-ends the sheet cannot solve (they simply
  //   cannot be constructed by an inverse entry — the solver's re-anchor
  //   rescue is the real-solve answer to those).
  //
  //   Scrambles are SETUP scrambles (the M4 convention): the drill state's
  //   {U,S,H} BFS word (plus, for LBT, the inverse of an applicable entry's
  //   resolved native moves), flattened to plain face letters and merged.
  //
  //   Chain texts are spliced hold-AWARE: 1L3T/TCP algs carry their own
  //   internal {X,Y} brackets, so a junction inserts the relative bracket
  //   into the next segment's assumed start hold, and a final AUF is
  //   respelled through the hold the text actually leaves (a literal U
  //   token after a bracket-carrying alg would turn the wrong face — found
  //   by machine proof, not by eye). EVERY displayed line is re-proved
  //   end-to-end from the drill state before it is shown, and the drill is
  //   rejected at generation time if no proven line realizes its target.

  const FIN_LBT_TRIES = 6000;      // (entry, coset) draws incl. the 1/k thinning
  const FIN_L3T_TRIES = 400;       // coset draws (both-systems acceptance ~46%)
  const FIN_SHOW_CAP = 6;          // proven lines materialized per system
  const FIN_CANON_WINDOW = 6;      // floor-sum margin the spliced-floor minimum is searched in
                                   // (measured: cross-seam merges never beat it — 0 divergence
                                   // from an unwindowed search over 700 sampled states at W=6,
                                   // 74 divergences at W=4; pinned in test-trainer)

  const finRelSpell = (h1, h2) => (h1.join() === h2.join() ? ''
    : '{' + E.FACES[h1.indexOf(h2[0])] + ',' + E.FACES[h1.indexOf(h2[1])] + '}');
  const FIN_ID_HOLD = [0, 1, 2, 3, 4, 5, 6, 7];
  const finHoldOf = (t) => (t ? E.walkParsed(E.parseAlg(t), () => {}) : FIN_ID_HOLD);

  // ---------- canonical (physical) counting ----------
  // A displayed target must be UNBEATABLE by any execution of the shown
  // lines, so finish counts are the AXIS-RUN FLOOR (finPhysMoves), not a
  // token count: the fired natives group into maximal consecutive SAME-AXIS
  // runs (opposite-face layer turns commute; rotations fire nothing and
  // never block), and a run's net twists (a, b) on its two faces cost 0
  // (both zero), 1 (one face only — a plain, double or wide turn — or
  // a + b ≡ 0 mod 3 — a slice), else 2. Every cost is realizable as engine
  // tokens plus free {X,Y} re-grips (any face turn is one token from any
  // hold; the slice is one token after a free re-grip), so the floor is the
  // fewest turns a solver can execute the printed line in: it merges our
  // AUF decorations with the algs' own [U'] marks and edge turns, an AUF
  // into a leading Uw/Us setup, and Rw R' / BL R' pairs into one slice —
  // the adversarial review (2026-07-17) proved that plain-pair merging
  // alone left ~16% of targets beatable through exactly those slice
  // merges, with the sheets' own texts as the beating executions.
  //
  // finCanonText remains as DISPLAY cleanup only: adjacent plain
  // same-fired-face turns (our decorations against the algs' edge turns)
  // fold textually, the rewrite effect-proved; when nothing folds the
  // VERBATIM text is kept, sheet parens and (U) markers intact.
  function finTokenNatives(text) {
    const src = E.preprocessAlg(text).split(' ').filter(Boolean);
    const out = [];
    let prev = 0;
    for (let k = 1; k <= src.length; k++) {
      const p = E.parseAlg(src.slice(0, k).join(' '));
      if (!p) return null;
      const got = [];
      try { E.walkParsed(p, (m) => got.push(m)); } catch (e) { return null; }
      out.push({ tok: src[k - 1], natives: got.slice(prev) });
      prev = got.length;
    }
    return out;
  }
  const finTablesEq = (a, b) =>
    a.cperm.join() === b.cperm.join() && a.cflip.join() === b.cflip.join() &&
    a.eperm.join() === b.eperm.join() && a.xperm.join() === b.xperm.join();
  // the axis-run floor (see the section comment): the fewest physical turns
  // that execute this text's fired effect in order, merging within each
  // maximal same-axis native run. Null on unparseable input.
  function finPhysMoves(text) {
    const p = E.parseAlg(text);
    if (!p) return null;
    const nat = [];
    try { E.walkParsed(p, (m) => nat.push(m)); } catch (e) { return null; }
    let total = 0, i = 0;
    while (i < nat.length) {
      const f0 = nat[i] >> 1;
      const axis = Math.min(f0, E.OPPF[f0]);
      let a = 0, b = 0;
      while (i < nat.length) {
        const f = nat[i] >> 1;
        if (Math.min(f, E.OPPF[f]) !== axis) break;
        const amt = (nat[i] & 1) ? 2 : 1;
        if (f === axis) a = (a + amt) % 3; else b = (b + amt) % 3;
        i++;
      }
      total += a && b ? ((a + b) % 3 === 0 ? 1 : 2) : (a || b ? 1 : 0);
    }
    return total;
  }
  // display-only fold; returns null when NOTHING folded (keep the verbatim
  // text) or when the effect-proof of a rewrite fails
  function finCanonText(text) {
    const tn = finTokenNatives(text);
    if (!tn) return null;
    const out = [];      // {kind:'t'|'o', tok} | {kind:'p', face, amt, letter, tok, merged}
    let changed = false;
    for (const t of tn) {
      if (t.natives.length === 0) { out.push({ kind: 't', tok: t.tok }); continue; }
      // plain = a bare single-layer face turn (decorations stripped; no w/s
      // suffix, no doubling) — the ONLY tokens folded at the TEXT level
      const bare = t.tok.replace(/[()[\]]/g, '');
      const lm = /^(BR|BL|[UFRLDB])'?$/.exec(bare);
      if (t.natives.length !== 1 || !lm) { out.push({ kind: 'o', tok: t.tok }); continue; }
      const m = t.natives[0];
      const item = { kind: 'p', face: m >> 1, amt: (m & 1) ? 2 : 1, letter: lm[1], tok: t.tok, merged: false };
      let j = out.length - 1;                    // nearest turn (transparents pass)
      while (j >= 0 && out[j].kind === 't') j--;
      if (j >= 0 && out[j].kind === 'p' && out[j].face === item.face) {
        const amt = (out[j].amt + item.amt) % 3;
        if (amt === 0) out.splice(j, 1);         // both turns gone; brackets stay put
        else { out[j].amt = amt; out[j].merged = true; }
        changed = true;
        continue;
      }
      out.push(item);
    }
    if (!changed) return null;                   // verbatim text stays verbatim
    const toks = out.map((it) =>
      it.kind === 'p' ? (it.merged ? it.letter + (it.amt === 2 ? "'" : '') : it.tok) : it.tok);
    const text2 = toks.join(' ').trim();
    if (!text2) return { text: '' };
    const p = E.parseAlg(text2);
    if (!p) return null;
    try {
      if (!finTablesEq(E.effectTable(p, 'cif'), E.effectTable(E.parseAlg(text), 'cif'))) return null;
    } catch (e) { return null; }
    return { text: text2 };
  }
  // fold-or-keep, with the axis-run floor as the count either way (folding
  // preserves the fired effect, so the floor is identical on both texts)
  function finCanonOrKeep(text) {
    const c = finCanonText(text);
    const out = c ? c.text : text;
    if (!out) return { text: '', moves: 0 };
    const moves = finPhysMoves(out);
    return moves == null ? { text: '', moves: 0 } : { text: out, moves };
  }

  let _finCache = null;
  function buildFinish(json) {
    if (_finCache && _finCache.json === json) return _finCache.FIN;
    const subsets = (json && json.subsets) || {};
    const SOLVED_KEY = E.stateKey(E.solved());
    // the three U-axis grips (identity + the two spins), walk-proved spells
    const uSpins = E.ROT24.filter((M) => E.faceImg(M, E.FIDX.U) === E.FIDX.U && E.faceImg(M, E.FIDX.F) !== E.FIDX.F);
    const GRIPS = [{ M: null, spell: '', hold: FIN_ID_HOLD }];
    for (const M of uSpins) {
      const Minv = E.mInv(M);
      const hold = [0, 1, 2, 3, 4, 5, 6, 7].map((p) => E.faceImg(Minv, p));
      const spell = '{' + E.FACES[hold[0]] + ',' + E.FACES[hold[1]] + '}';
      if (finHoldOf(spell).join() !== hold.join()) throw new Error('fin: grip spell ' + spell);
      GRIPS.push({ M, spell, hold });
    }
    if (GRIPS.length !== 3) throw new Error('fin: grip census ' + GRIPS.length);
    // the L3T coset: closure of {U,S,H}, with BFS parents for scramble words
    const genTexts = ['U', "U'", 'S', "S'", 'H', "H'"];
    const gens = genTexts.map((t) => ({
      T: E.effectTable(E.parseAlg(t), 'cif'),
      natives: nativeMovesOf(t, 'cif'),
    }));
    const coset = new Map([[SOLVED_KEY, { s: E.solved(), parent: null, gen: -1 }]]);
    let fr = [SOLVED_KEY];
    while (fr.length) {
      const nx = [];
      for (const k of fr) {
        const s = coset.get(k).s;
        for (let gi = 0; gi < gens.length; gi++) {
          const t2 = E.applyTable(gens[gi].T, s), k2 = E.stateKey(t2);
          if (!coset.has(k2)) { coset.set(k2, { s: t2, parent: k, gen: gi }); nx.push(k2); }
        }
      }
      fr = nx;
    }
    if (coset.size !== 4320) throw new Error('fin: coset ' + coset.size);
    const cosetKeys = [...coset.keys()];
    const U_CWf = 2 * E.FIDX.U;
    const trivial = new Set([SOLVED_KEY,
      E.stateKey(E.move(E.solved(), U_CWf)), E.stateKey(E.move(E.solved(), U_CWf + 1))]);
    const cosetWord = (key) => {              // native scramble word from solved
      const out = [];
      for (let n = coset.get(key); n && n.gen >= 0; n = coset.get(n.parent))
        out.unshift(...gens[n.gen].natives);
      return out;
    };
    // the 1LP sheet-image language and the structurally-formed predicate
    // (the flip-sequence theorem's terms, pinned in test-engine §16)
    const BLUE = new Set([E.FIDX.F, E.FIDX.BR, E.FIDX.BL]);
    const appearance = (s) => {
      const FL = E.toFacelets(s);
      let out = '';
      for (let i = 0; i < 72; i++) {
        const ft = E.FEAT[i], c = FL[i];
        out += ft.t === 'e' ? '.' : c === E.FIDX.U ? 'Y' : ft.t === 'c' ? 'b' : BLUE.has(c) ? 'b' : '.';
      }
      return out;
    };
    const olpFormed = (s) => {
      const US = [0, 1, 2], FLK = [3, 7, 11];
      for (let j = 0; j < 3; j++) {
        if (s.cp[j] > 2) return false;
        const uY = s.ctr[US[j]] === E.FIDX.U, fY = s.ctr[FLK[j]] === E.FIDX.U;
        if (s.co[j] ? !(!uY && fY) : !(uY && !fY)) return false;
      }
      return true;
    };
    // L3T exact index (1L3T + TCP, grips x pre x trailing AUFs) — every
    // entry stored at its CANONICAL text/count (finCanonText), best-first
    const l3t = new Map();
    for (const subKey of ['1L3T', 'TCP']) {
      const sub = subsets[subKey];
      if (!sub || !sub.cases) continue;
      const dialect = sub.notation === 'eif' ? 'eif' : 'cif';
      for (const c of sub.cases) for (const a of c.algs || []) {
        for (const g of GRIPS) for (const pre of AUF) for (const trail of AUF) {
          const body = [pre, a.alg, trail].filter(Boolean).join(' ');
          const text0 = [g.spell, body].filter(Boolean).join(' ');
          const cs = E.caseStateOf(text0, dialect);
          if (!cs) continue;
          const key = E.stateKey(cs);
          if (key === SOLVED_KEY) continue;
          const canon = finCanonOrKeep(text0);
          if (!canon.text) continue;             // a fully-cancelling decoration: no-op
          let list = l3t.get(key);
          if (!list) l3t.set(key, list = []);
          if (list.some((e) => e.text === canon.text)) continue;
          list.push({ text: canon.text, moves: canon.moves,
                      prio: (pre ? 1 : 0) + (trail ? 1 : 0) + (g.spell ? 1 : 0) + (subKey === 'TCP' ? 0.5 : 0),
                      caseName: c.name, subset: subKey });
        }
      }
    }
    for (const list of l3t.values())
      list.sort((x, y) => x.moves - y.moves || x.prio - y.prio || (x.text < y.text ? -1 : 1));
    // TCP combos (each stored at its own canonical body/count) + the finish
    // maps: pre1 lists every ≤1-combo finish per state (preimages of
    // solved±AUF under the combos); finishCands adds the 2-look closure —
    // all candidates within the canonical-search window, not just the best,
    // because a cross-seam merge can reorder near-equals.
    const tcpCombos = [];
    {
      const sub = subsets.TCP;
      const dialect = sub && sub.notation === 'eif' ? 'eif' : 'cif';
      const seenTcp = new Set();
      for (const c of (sub && sub.cases) || []) for (const a of c.algs || []) {
        for (const g of GRIPS) for (const pre of AUF) for (const trail of AUF) {
          const body = [pre, a.alg, trail].filter(Boolean).join(' ');
          const text0 = [g.spell, body].filter(Boolean).join(' ');
          const p0 = E.parseAlg(text0);
          if (!p0) continue;
          const canon = finCanonOrKeep(text0);
          if (!canon.text || seenTcp.has(canon.text)) continue;
          seenTcp.add(canon.text);
          // splice by body: the canonical text minus its leading grip spell
          // (the fold never crosses the leading bracket — nothing precedes it)
          const toks = canon.text.split(' ');
          const hasSpell = g.spell && toks[0] === g.spell;
          const body2 = hasSpell ? toks.slice(1).join(' ') : canon.text;
          tcpCombos.push({ body: body2, gripHold: hasSpell ? g.hold : FIN_ID_HOLD,
                           T: E.effectTable(p0, dialect), moves: canon.moves, caseName: c.name });
        }
      }
    }
    const aufFix = new Map([[SOLVED_KEY, { moves: 0, fix: '' }],
      [E.stateKey(E.move(E.solved(), U_CWf)), { moves: 1, fix: "U'" }],
      [E.stateKey(E.move(E.solved(), U_CWf + 1)), { moves: 1, fix: 'U' }]]);
    const pre1 = new Map();                     // key -> [{moves, combo, fix}] sorted
    for (const cb of tcpCombos) {
      const Tinv = E.invertTable(cb.T);
      for (const [k, fx] of aufFix) {
        const pre = E.applyTable(Tinv, E.keyToState(k));
        const pk = E.stateKey(pre);
        if (pk === SOLVED_KEY) continue;
        let list = pre1.get(pk);
        if (!list) pre1.set(pk, list = []);
        list.push({ moves: cb.moves + fx.moves, combo: cb, fix: fx.fix });
      }
    }
    for (const list of pre1.values()) list.sort((a, b) => a.moves - b.moves);
    // "pairs formed, possibly after an AUF/re-grip" — the entry condition of
    // the TCP finish grammar. The 2-look scan must NOT fire from a state
    // that is never formed in any view (adversarial review 2026-07-17: an
    // ungated first TCP alg there is just an arbitrary alg application,
    // outside the documented 1LP→TCP system and mislabeled 'pairs formed').
    // aufFix and pre1 keys are formed-modulo-view by construction, so only
    // the 2-look entry needs the gate.
    const formedish = (s) => {
      for (let gi = 0; gi < 3; gi++) {
        const base = gi === 0 ? s : conjState(GRIPS[gi].M, s);
        if (olpFormed(base) || olpFormed(E.move(base, U_CWf)) ||
            olpFormed(E.move(base, U_CWf + 1))) return true;
      }
      return false;
    };
    // every TCP finish (≤ 2 algs + final AUF) within `window` of the best,
    // as segment lists sorted by their per-segment floor totals
    const finishCands = (s, k, window) => {
      const W = window == null ? FIN_CANON_WINDOW : window;
      const out = [];
      const fx = aufFix.get(k);
      if (fx) out.push({ moves: fx.moves, segs: fx.fix ? [{ fix: fx.fix }] : [], looks: 0 });
      for (const c1 of pre1.get(k) || [])
        out.push({ moves: c1.moves, looks: 1,
                   segs: [{ combo: c1.combo }, ...(c1.fix ? [{ fix: c1.fix }] : [])] });
      let best = out.length ? out.reduce((m, o) => Math.min(m, o.moves), Infinity) : Infinity;
      if (formedish(s)) {
        for (const cb of tcpCombos) {
          if (cb.moves + 1 > best + W) continue;                // tails cost ≥ 1
          const mid = E.applyTable(cb.T, s);
          const mk = E.stateKey(mid);
          if (mk === k) continue;
          for (const tl of pre1.get(mk) || []) {
            const total = cb.moves + tl.moves;
            if (total > best + W) break;                        // tails are sorted
            out.push({ moves: total, looks: 2,
                       segs: [{ combo: cb }, { combo: tl.combo }, ...(tl.fix ? [{ fix: tl.fix }] : [])] });
            if (total < best) best = total;
          }
        }
      }
      out.sort((a, b) => a.moves - b.moves);
      return out;
    };
    // 1LP combos, keyed by their case's appearance (matching a view to an
    // appearance is the sheet's own recognition contract)
    const olpByApp = new Map();
    {
      const sub = subsets['1LP'];
      const dialect = sub && sub.notation === 'eif' ? 'eif' : 'cif';
      for (const c of (sub && sub.cases) || []) for (const a of c.algs || []) {
        const cs = E.caseStateOf(a.alg, dialect);
        if (!cs) continue;
        const app = appearance(cs);
        for (let gi = 0; gi < 3; gi++) for (let ai = 0; ai < 3; ai++) {
          const body = [AUF[ai], a.alg].filter(Boolean).join(' ');
          const text0 = [GRIPS[gi].spell, body].filter(Boolean).join(' ');
          const p = E.parseAlg(text0);
          if (!p) continue;
          const canon = finCanonOrKeep(text0);
          if (!canon.text) continue;
          const toks = canon.text.split(' ');
          const hasSpell = GRIPS[gi].spell && toks[0] === GRIPS[gi].spell;
          let list = olpByApp.get(app);
          if (!list) olpByApp.set(app, list = []);
          list.push({ gi, ai, body: hasSpell ? toks.slice(1).join(' ') : canon.text,
                      gripHold: hasSpell ? GRIPS[gi].hold : FIN_ID_HOLD,
                      T: E.effectTable(p, dialect), moves: canon.moves, caseName: c.name });
        }
      }
    }
    // LBT entries (the solver's finish-index construction: setup-undo
    // closings appended, {ε,U,U'} pre-AUFs), verbatim-first
    const lbt = [];
    {
      const sub = subsets.LBT;
      const dialect = sub && sub.notation === 'eif' ? 'eif' : 'cif';
      const undoTok = (note) => { const m = /append (\S+) \(machine-verified\)/.exec(note || ''); return m ? m[1] : null; };
      for (const c of (sub && sub.cases) || []) for (const a of c.algs || []) {
        const closing = undoTok(a.note);
        const base = closing ? a.alg + ' ' + closing : a.alg;
        for (const pre of AUF) {
          const text0 = [pre, base].filter(Boolean).join(' ');
          const cs = E.caseStateOf(text0, dialect);
          if (!cs) continue;
          if (E.stateKey(cs) === SOLVED_KEY) continue;
          const canon = finCanonOrKeep(text0);
          if (!canon.text || lbt.some((e) => e.text === canon.text)) continue;
          const T = E.effectTable(E.parseAlg(text0), dialect);
          lbt.push({ text: canon.text, T, Tinv: E.invertTable(T), moves: canon.moves,
                     caseName: c.name, closing: !!closing, pre: !!pre,
                     srcSlot: cs.cp.indexOf(4), srcFlip: cs.co[cs.cp.indexOf(4)] });
        }
      }
      lbt.sort((x, y) => (x.pre ? 1 : 0) - (y.pre ? 1 : 0) || x.moves - y.moves || (x.text < y.text ? -1 : 1));
      if (!lbt.length) throw new Error('fin: no LBT entries');
    }
    const FIN = { GRIPS, coset, cosetKeys, cosetWord, trivial, appearance, olpFormed, formedish,
                  l3t, tcpCombos, aufFix, pre1, finishCands, olpByApp, lbt, SOLVED_KEY };
    _finCache = { json, FIN };
    return FIN;
  }
  // splice chain segments into ONE continuous engine text: each segment's
  // junction bracket is spelled RELATIVE to the hold the previous tokens
  // actually leave (the 2026-07-14 contract), and a final AUF is respelled
  // through that hold (engine U may no longer sit at the U position after a
  // bracket-carrying alg). Callers prove the result before showing it.
  function finSplice(segs) {
    let text = '';
    for (const sg of segs) {
      if (sg.fix !== undefined) {
        if (!sg.fix) continue;
        const h = finHoldOf(text);
        const tok = E.FACES[h.indexOf(E.FIDX.U)] + (sg.fix.endsWith("'") ? "'" : '');
        text = [text, tok].filter(Boolean).join(' ');
        continue;
      }
      const body = sg.body !== undefined ? sg.body : sg.combo.body;
      const gh = sg.gripHold !== undefined ? sg.gripHold : sg.combo.gripHold;
      const br = finRelSpell(finHoldOf(text), gh);
      text = [text, br, body].filter(Boolean).join(' ');
    }
    return text;
  }

  // ---------- L3T: targets and proven lines ----------
  // Chain candidates at a state: the grammar [re-grip][AUF] (1LP line |
  // pairs formed) + TCP finish (≤ 2 algs + final AUF). Candidates are
  // enumerated completely as segment lists with their literal sums, then
  // MATERIALIZED in ascending literal order — spliced, canonicalized and
  // proven — until no candidate inside the canonical-search window can beat
  // the best canonical count found (cross-seam merges can save turns, so
  // the literal order alone must not pick the winner).
  function l3tChainLines(FIN, s, k, window) {
    const W = window == null ? FIN_CANON_WINDOW : window;
    const cands = [];
    for (const f of FIN.finishCands(s, k, window))
      cands.push({ moves: f.moves, segs: f.segs,
                   label: 'pairs formed' + (f.looks === 2 ? ' · 2-look TCP' : ''), looks: f.looks });
    for (let gi = 0; gi < 3; gi++) {
      const base = gi === 0 ? s : conjState(FIN.GRIPS[gi].M, s);
      for (let ai = 0; ai < 3; ai++) {
        const v = ai === 0 ? base : E.move(base, ai === 1 ? 2 * E.FIDX.U : 2 * E.FIDX.U + 1);
        if (FIN.olpFormed(v)) continue;         // the direct finish covers formed views
        const combos = FIN.olpByApp.get(FIN.appearance(v));
        if (!combos) continue;
        for (const cb of combos) {
          if (cb.gi !== gi || cb.ai !== ai) continue;
          const land = E.applyTable(cb.T, s);
          if (!FIN.olpFormed(land)) continue;   // the flip theorem says formed; drop anomalies
          for (const f of FIN.finishCands(land, E.stateKey(land), window))
            cands.push({ moves: cb.moves + f.moves,
                         segs: [{ body: cb.body, gripHold: cb.gripHold }, ...f.segs],
                         label: cb.caseName + ' + TCP' + (f.looks === 2 ? ' (2-look)' : ''), looks: f.looks });
        }
      }
    }
    cands.sort((a, b) => a.moves - b.moves);
    const lines = [];
    const seen = new Set();
    let bestCanon = Infinity;
    for (const c of cands) {
      // cross-seam merges only ever lower a floor, never past the window
      // (pinned in test-trainer: the windowed minima equal the unwindowed)
      if (c.moves > bestCanon + W) break;
      const canon = finCanonOrKeep(finSplice(c.segs));
      if (!canon.text || seen.has(canon.text)) continue;
      seen.add(canon.text);
      const p = E.parseAlg(canon.text);
      if (!p || finPhysMoves(canon.text) !== canon.moves) continue;
      let ok = false;
      try { ok = E.eq(E.applyParsed(p, E.copy(s), 'cif'), E.solved()); } catch (e) { ok = false; }
      if (!ok) continue;
      lines.push({ text: canon.text, moves: canon.moves, tokens: E.countMoves(p), label: c.label });
      if (canon.moves < bestCanon) bestCanon = canon.moves;
    }
    lines.sort((a, b) => a.moves - b.moves || (a.text < b.text ? -1 : 1));
    return lines;
  }
  // proven lines for both systems at a coset state; each line re-proved by
  // applyParsed from the state to EXACTLY solved with the exact turn count
  function l3tLines(FIN, s, k, show) {
    const cap = show || FIN_SHOW_CAP;
    const sys1 = [];
    for (const en of FIN.l3t.get(k) || []) {
      if (sys1.length >= cap) break;
      const p = E.parseAlg(en.text);
      if (!p || finPhysMoves(en.text) !== en.moves) continue;
      let ok = false;
      try { ok = E.eq(E.applyParsed(p, E.copy(s), 'cif'), E.solved()); } catch (e) { ok = false; }
      if (!ok) continue;
      sys1.push({ text: en.text, moves: en.moves, tokens: E.countMoves(p),
                  label: en.caseName + (en.subset === 'TCP' ? ' (TCP)' : '') });
    }
    const sys2 = l3tChainLines(FIN, s, k).slice(0, cap);
    return { sys1, sys2 };
  }
  // the L3T step metric: fewest turns over the proven lines of EITHER system
  // (null when neither system solves the state — the caller rejects)
  function l3tOptOf(FIN, s, k) {
    if (k === FIN.SOLVED_KEY) return 0;
    const { sys1, sys2 } = l3tLines(FIN, s, k, 1);
    const a = sys1.length ? sys1[0].moves : Infinity;
    const b = sys2.length ? sys2[0].moves : Infinity;
    return isFinite(Math.min(a, b)) ? Math.min(a, b) : null;
  }

  // ---------- masks ----------
  // The L3T region: the top three triples (corners 0,1,2 + centre slots
  // U(0,1,2)/F(3)/BR(7)/BL(11)) plus the three U edges — an AUF-displaced
  // state shows them cycled, which the recognition needs. The LBT mask adds
  // the slot: corner 4 + centre slots F(4)/BL(10). At these stages the
  // region's pieces sit inside the region's slots, so slot facelets ARE the
  // piece facelets.
  function finKeep(withSlot) {
    const { CTRF, CORNF, EDGEF } = slotFacelets();
    const keep = [];
    for (const c of withSlot ? [0, 1, 2, 4] : [0, 1, 2]) keep.push(...CORNF[c]);
    for (const x of withSlot ? [0, 1, 2, 3, 4, 7, 10, 11] : [0, 1, 2, 3, 7, 11]) keep.push(CTRF[x]);
    for (let e = 0; e < 12; e++)
      if (E.EDGES[e][2] === E.FIDX.U || E.EDGES[e][3] === E.FIDX.U) keep.push(...EDGEF[e]);
    return keep;
  }
  function finMask(withSlot) {
    const keep = new Set(finKeep(withSlot));
    const mask = [];
    for (let i = 0; i < 72; i++) if (!keep.has(i)) mask.push(i);
    return mask;
  }

  // ---------- LBT: applicability, drill, lines ----------
  // before-LBT: everything outside slot 4 + the last-layer region solved,
  // edges home (the state a real solve holds after the last center)
  function beforeLbtOK(s) {
    for (let e = 0; e < 12; e++) if (s.ep[e] !== e) return false;
    for (let x = 12; x < 24; x++) if (s.ctr[x] !== 4 + (((x - 12) / 3) | 0)) return false;
    if (s.cp[3] !== 3 || s.co[3] !== 0 || s.cp[5] !== 5 || s.co[5] !== 0) return false;
    for (const x of [5, 6, 8, 9]) if (s.ctr[x] !== ((x / 3) | 0)) return false;
    return true;
  }
  const lbtSlotSolved = (s) => s.cp[4] === 4 && s.co[4] === 0 && s.ctr[4] === 1 && s.ctr[10] === 3;
  // entries whose effect lands the state inside the L3T coset (the step's
  // postcondition — the correctness test the solver uses), best-first
  function lbtApplicable(FIN, s) {
    const p4 = s.cp.indexOf(4), f4 = s.co[p4];
    const out = [];
    for (const en of FIN.lbt) {
      if (en.srcSlot !== p4 || en.srcFlip !== f4) continue;
      const post = E.applyTable(en.T, s);
      const pk = E.stateKey(post);
      if (pk !== FIN.SOLVED_KEY && !FIN.coset.has(pk)) continue;
      out.push({ en, postKey: pk });
    }
    return out;
  }
  function lbtScramble(FIN, en, tKey) {
    const inv = nativeMovesOf(en.text, 'cif');
    if (!inv) return null;
    return mergeMoves(FIN.cosetWord(tKey).concat(inv.slice().reverse().map((m) => m ^ 1)));
  }
  function makeLbtDrill(FIN, rng) {
    const rnd = rng || Math.random;
    for (let att = 0; att < FIN_LBT_TRIES; att++) {
      const en = FIN.lbt[(rnd() * FIN.lbt.length) | 0];
      const tKey = FIN.cosetKeys[(rnd() * FIN.cosetKeys.length) | 0];
      const s = E.applyTable(en.Tinv, FIN.coset.get(tKey).s);
      if (!beforeLbtOK(s) || lbtSlotSolved(s)) continue;
      const hits = lbtApplicable(FIN, s);
      if (!hits.length) continue;               // cannot happen for a constructed state
      if (rnd() >= 1 / hits.length) continue;   // exact uniformization over the space
      const seq = lbtScramble(FIN, en, tKey);
      if (!seq) continue;
      let st = E.solved();
      for (const m of seq) st = E.move(st, m);
      if (!E.eq(st, s)) continue;               // construction proof, never trusted blind
      const optimal = Math.min(...hits.map((h) => h.en.moves));
      return {
        kind: 'lbt', optimal,
        scramble: seq.map((m) => E.MOVES[m]).join(' '),
        state: st, mask: finMask(true),
      };
    }
    return null;
  }
  // all applicable sheet lines, fewest-turns-first (verbatim before AUF'd at
  // equal length), each re-proved from the state (the landing must sit
  // inside the L3T coset — or be solved outright)
  function lbtSolutions(FIN, drill, show) {
    const hits = lbtApplicable(FIN, drill.state)
      .sort((a, b) => a.en.moves - b.en.moves || (a.en.pre ? 1 : 0) - (b.en.pre ? 1 : 0) ||
                      (a.en.text < b.en.text ? -1 : 1));
    const lines = [];
    let dropped = 0;
    for (const h of hits) {
      if (lines.length >= (show || FIN_SHOW_CAP)) break;
      const p = E.parseAlg(h.en.text);
      let post = null;
      try { post = E.applyParsed(p, E.copy(drill.state), 'cif'); } catch (e) { post = null; }
      if (!post || finPhysMoves(h.en.text) !== h.en.moves || E.stateKey(post) !== h.postKey) { dropped++; continue; }
      lines.push({ text: h.en.text, moves: h.en.moves, tokens: E.countMoves(p), label: h.en.caseName,
                   closing: h.en.closing, pre: h.en.pre, solvesAll: h.postKey === FIN.SOLVED_KEY });
    }
    return { total: hits.length, dropped, lines };
  }
  function verifyLbtDrill(FIN, d) {
    if (!d || d.kind !== 'lbt') return false;
    const toks = d.scramble.split(/\s+/).filter(Boolean);
    if (!toks.length || !toks.every((t) => /^(BR|BL|[UFRLDB])'?$/.test(t))) return false;
    for (let i = 1; i < toks.length; i++)
      if (toks[i].replace("'", '') === toks[i - 1].replace("'", '')) return false;
    const p = E.parseAlg(d.scramble);
    if (!p) return false;
    let st = E.solved();
    E.walkParsed(p, (m) => { st = E.move(st, m); });
    if (!E.eq(st, d.state)) return false;
    if (!beforeLbtOK(st) || lbtSlotSolved(st)) return false;
    const hits = lbtApplicable(FIN, st);
    if (!hits.length || Math.min(...hits.map((h) => h.en.moves)) !== d.optimal) return false;
    if (d.optimal < 1) return false;
    return finMask(true).join() === (d.mask || []).join();
  }

  // ---------- L3T drill ----------
  function makeL3tDrill(FIN, rng) {
    const rnd = rng || Math.random;
    for (let att = 0; att < FIN_L3T_TRIES; att++) {
      const key = FIN.cosetKeys[(rnd() * FIN.cosetKeys.length) | 0];
      if (FIN.trivial.has(key)) continue;
      const s = FIN.coset.get(key).s;
      const { sys1, sys2 } = l3tLines(FIN, s, key, FIN_SHOW_CAP);
      if (!sys1.length || !sys2.length) continue;   // drill space = both systems proven
      const optimal = Math.min(sys1[0].moves, sys2[0].moves);
      const seq = mergeMoves(FIN.cosetWord(key));
      let st = E.solved();
      for (const m of seq) st = E.move(st, m);
      if (!E.eq(st, s)) continue;
      return {
        kind: 'l3t', optimal,
        parts: { l3t: sys1[0].moves, chain: sys2[0].moves },
        scramble: seq.map((m) => E.MOVES[m]).join(' '),
        state: st, mask: finMask(false),
      };
    }
    return null;
  }
  function l3tSolutions(FIN, drill, show) {
    const k = E.stateKey(drill.state);
    const { sys1, sys2 } = l3tLines(FIN, drill.state, k, show || FIN_SHOW_CAP);
    return { sys1, sys2 };
  }
  function verifyL3tDrill(FIN, d) {
    if (!d || d.kind !== 'l3t') return false;
    const toks = d.scramble.split(/\s+/).filter(Boolean);
    if (!toks.length || !toks.every((t) => /^(BR|BL|[UFRLDB])'?$/.test(t))) return false;
    for (let i = 1; i < toks.length; i++)
      if (toks[i].replace("'", '') === toks[i - 1].replace("'", '')) return false;
    const p = E.parseAlg(d.scramble);
    if (!p) return false;
    let st = E.solved();
    E.walkParsed(p, (m) => { st = E.move(st, m); });
    if (!E.eq(st, d.state)) return false;
    const key = E.stateKey(st);
    if (!FIN.coset.has(key) || FIN.trivial.has(key)) return false;
    const { sys1, sys2 } = l3tLines(FIN, st, key, FIN_SHOW_CAP);
    if (!sys1.length || !sys2.length) return false;
    if (Math.min(sys1[0].moves, sys2[0].moves) !== d.optimal || d.optimal < 1) return false;
    if (!d.parts || d.parts.l3t !== sys1[0].moves || d.parts.chain !== sys2[0].moves) return false;
    return finMask(false).join() === (d.mask || []).join();
  }

  // ---------- the lbt+l3t span (phased, like the v4 spans) ----------
  // T = opt_lbt(s) + min over lbt-optimal landings e of opt_l3t(e): the LBT
  // phase's optimal-endstate set is the complete finite list of optimal
  // sheet landings; the L3T phase reads the exact step metric at each. A
  // scramble whose optimal landings none of the sheet systems can continue
  // is rejected (exact or resampled, never approximated).
  function finSpanDP(FIN, s) {
    const hits = lbtApplicable(FIN, s);
    if (!hits.length) return null;
    const L1 = Math.min(...hits.map((h) => h.en.moves));
    const ends = new Map();                    // postKey -> optimal entries landing there
    for (const h of hits) {
      if (h.en.moves !== L1) continue;
      let list = ends.get(h.postKey);
      if (!list) ends.set(h.postKey, list = []);
      list.push(h);
    }
    let bestV = Infinity;
    for (const [pk] of ends) {
      const v = pk === FIN.SOLVED_KEY ? 0 : l3tOptOf(FIN, FIN.coset.get(pk).s, pk);
      if (v != null && v < bestV) bestV = v;
    }
    if (!isFinite(bestV)) return null;
    return { optimal: L1 + bestV, breakdown: [L1, bestV], L1, ends };
  }
  function makeFinSpanDrill(FIN, plan, rng) {
    const rnd = rng || Math.random;
    for (let att = 0; att < FIN_LBT_TRIES; att++) {
      const en = FIN.lbt[(rnd() * FIN.lbt.length) | 0];
      const tKey = FIN.cosetKeys[(rnd() * FIN.cosetKeys.length) | 0];
      const s = E.applyTable(en.Tinv, FIN.coset.get(tKey).s);
      if (!beforeLbtOK(s) || lbtSlotSolved(s)) continue;
      const hits = lbtApplicable(FIN, s);
      if (!hits.length) continue;
      if (rnd() >= 1 / hits.length) continue;
      const dp = finSpanDP(FIN, s);
      if (!dp || dp.optimal < 1) continue;
      const seq = lbtScramble(FIN, en, tKey);
      if (!seq) continue;
      let st = E.solved();
      for (const m of seq) st = E.move(st, m);
      if (!E.eq(st, s)) continue;
      const drill = {
        kind: 'span', steps: plan.ids.slice(), spanKey: plan.key, start: 'lbt',
        metric: null, presolved: 0,
        scramble: seq.map((m) => E.MOVES[m]).join(' '),
        state: st, optimal: dp.optimal, breakdown: dp.breakdown,
        mask: finMask(true),
      };
      // a target is only ever shown with a proven line realizing it
      if (!finSpanSolutions(FIN, drill, 1).lines.length) continue;
      return drill;
    }
    return null;
  }
  // continuous lines for a finished lbt+l3t span: the LBT sheet text, then
  // the L3T line spliced hold-aware; the LBT/L3T boundary state is re-proved
  // to sit inside the L3T coset and the whole text to solve the puzzle.
  function finSpanSolutions(FIN, drill, show) {
    const cap = show || FIN_SHOW_CAP;
    const dp = finSpanDP(FIN, drill.state);
    if (!dp || dp.optimal !== drill.optimal) return { total: 0, dropped: 1, capped: false, lines: [] };
    const lines = [];
    const seen = new Set();
    let dropped = 0;
    let capped = false;                        // the listing MAY be incomplete
    outer: for (const [pk, hs] of dp.ends) {
      const v = drill.optimal - dp.L1;
      let tails;
      if (pk === FIN.SOLVED_KEY) {
        if (v !== 0) continue;
        tails = [{ text: '', moves: 0, label: 'solves everything' }];
      } else {
        const end = FIN.coset.get(pk).s;
        const { sys1, sys2 } = l3tLines(FIN, end, pk, cap);
        if (sys1.length >= cap || sys2.length >= cap) capped = true;   // more tails may exist
        tails = [...sys1, ...sys2].filter((l) => l.moves === v);
        if (!tails.length) continue;
      }
      for (const h of hs) for (const tail of tails) {
        if (lines.length >= cap) { capped = true; break outer; }
        // the phased split is priced per segment: the LBT text at its floor,
        // the tail at its own — the seam is deliberately NOT merged
        if (h.en.moves !== dp.L1 || finPhysMoves(h.en.text) !== dp.L1) { dropped++; continue; }
        const text = tail.text
          ? [h.en.text, finRelSpell(finHoldOf(h.en.text), finHoldOf('')), tail.text]
              .filter(Boolean).join(' ')
          : h.en.text;
        if (seen.has(text)) continue;
        seen.add(text);
        const p = E.parseAlg(text);
        if (!p) { dropped++; continue; }
        // boundary proof: after the LBT segment's fired moves the state must
        // sit inside the L3T coset; the full text must solve exactly
        const fired = [];
        try { E.walkParsed(p, (m) => fired.push(m)); } catch (e) { dropped++; continue; }
        const nLbt = (nativeMovesOf(h.en.text, 'cif') || []).length;
        let mid = drill.state;
        for (let i = 0; i < nLbt; i++) mid = E.move(mid, fired[i]);
        const mk = E.stateKey(mid);
        if (mk !== pk) { dropped++; continue; }
        let st2 = mid;
        for (let i = nLbt; i < fired.length; i++) st2 = E.move(st2, fired[i]);
        if (!E.eq(st2, E.solved())) { dropped++; continue; }
        lines.push({ text, split: [dp.L1, tail.moves], tokens: E.countMoves(p),
                     label: h.en.caseName + (tail.label !== 'solves everything' ? ' → ' + tail.label : ' (solves everything)') });
      }
    }
    return { total: lines.length, dropped, capped, lines };
  }
  function verifyFinSpanDrill(FIN, d) {
    if (!d || d.kind !== 'span' || d.start !== 'lbt') return false;
    const plan = spanPlan(d.steps);
    if (!plan.ok || plan.kind !== 'span' || plan.key !== d.spanKey || plan.start !== 'lbt') return false;
    if (d.metric !== null || d.presolved !== 0) return false;
    const toks = d.scramble.split(/\s+/).filter(Boolean);
    if (!toks.length || !toks.every((t) => /^(BR|BL|[UFRLDB])'?$/.test(t))) return false;
    for (let i = 1; i < toks.length; i++)
      if (toks[i].replace("'", '') === toks[i - 1].replace("'", '')) return false;
    const p = E.parseAlg(d.scramble);
    if (!p) return false;
    let st = E.solved();
    E.walkParsed(p, (m) => { st = E.move(st, m); });
    if (!E.eq(st, d.state)) return false;
    if (!beforeLbtOK(st) || lbtSlotSolved(st)) return false;
    const dp = finSpanDP(FIN, st);
    if (!dp || dp.optimal !== d.optimal || d.optimal < 1) return false;
    if (dp.breakdown.join() !== (d.breakdown || []).join()) return false;
    return finMask(true).join() === (d.mask || []).join();
  }

  // ---------------- Bencisco step-span drills (step trainers v4) ----------------
  // One drill spanning several CONSECUTIVE Bencisco steps (user spec
  // 2026-07-16: first center + first triple, + first two triples, and any
  // valid multi-step selection). Step chain and regimes:
  //
  //     fc | t1 t2 | sc c3            (LBT / L3T append to SPAN_STEPS later)
  //     fc | triples | centers        regime = a human execution contract
  //
  // Each regime has its own TRUE turn metric (fc: the free 16-native metric
  // with the token/native counting toggle; triples: the sealed 10-move turn
  // metric with free re-grips; centers: the restricted triple-preserving
  // {R,U,Rw} metric). NO cross-regime fused metric exists — the contracts
  // differ — so a multi-regime span's target is PHASED:
  //
  //   T(s, [p, ...rest]) = opt_p(s) + min over e in OptEnd_p(s) of T(e, rest)
  //
  // each phase solved to its true fused optimum IN ITS OWN CONTRACT from its
  // entry state, the total minimized over every optimal-endstate chain (the
  // lookahead freedom a step-disciplined human genuinely has: WHICH optimal
  // solution of one phase to carry into the next). Steps sharing a regime
  // stay FUSED inside one phase (the existing 'both' semantics). The target
  // is exact and unbeatable by any solve that executes each phase optimally:
  // every enumeration behind it is COMPLETE or the scramble is rejected and
  // resampled (caps below) — never approximated.
  //
  // fc landings: the fc goal is placement-neutral (12 formations), and the
  // downstream machinery is method-frame. A formed state re-enters the
  // method frame in two machine steps, both derived and asserted at init:
  //   REBASE   recolor color c -> faceImg(Q, c), Q = the state's formation
  //            rotation (the state re-expressed against the Q-rotated solved
  //            target; recoloring commutes with slot-permutation moves, so
  //            goals and distances are preserved) — after it the landing
  //            hexagon is exactly home at its face X, position/color aligned;
  //   VIEW     conjugation by any of the 3 anchors mapping X onto method D
  //            (the white-axis spins; X = U gives the solver's {D,L}/{D,R}/
  //            {D,B} anchors — 12 anchors over the 4 landing faces).
  // Every formed state gets exactly 3 method views; the triples phase takes
  // the best of them — physically, the solver picks the grip.
  //
  // fc-led spans reach at most t2: an exact fc->centers phased target needs
  // the complete triples-optimal endstate expansion of EVERY fc view (about
  // a hundred enumerations per scramble at reveal cost each) — measured in
  // the tens of seconds. Rejected as a drill, not approximated; lift this
  // only with a genuinely fused table.

  const SPAN_STEPS = ['fc', 't1', 't2', 'sc', 'c3', 'lbt', 'l3t'];
  const SPAN_REGIME = { fc: 'fc', t1: 'tri', t2: 'tri', sc: 'ctr', c3: 'ctr', lbt: 'lbt', l3t: 'l3t' };
  const SPAN_LEN_FC = 30;          // fc-led spans scramble like a full solve
  const SPAN_TRIES = 4000;         // walk-level rejections are cheap
  const SPAN_DP_TRIES = 25;        // DP-level rejections are not
  const SPAN_FC_CAP = 512;         // fc optimal-word harvest (reject if total exceeds)
  const SPAN_TRI_CAP = 512;        // interior-phase word harvest (reject if capped)
  const SPAN_ENTRY_CAP = 4096;     // method-state frontier bound (reject beyond)
  const SPAN_CHAIN_CAP = 24;       // reveal: candidate chains materialized

  // spanPlan(steps): validate a selection and derive its drill routing.
  // Valid = a nonempty CONTIGUOUS run of SPAN_STEPS (the user's rule: fc+t1+t2
  // works, fc+t2 does not). Single-regime runs route to the existing drills
  // (kind fc / f2t / c23 with their sub-modes); multi-regime runs get the
  // phased span drill. fc-led spans past t2 report reason 'fcreach'.
  function spanPlan(steps) {
    const idx = [...new Set(steps || [])].map((t) => SPAN_STEPS.indexOf(t)).sort((a, b) => a - b);
    if (!idx.length || idx[0] < 0 || idx.length !== (steps || []).length)
      return { ok: false, reason: 'empty' };
    for (let k = 1; k < idx.length; k++)
      if (idx[k] !== idx[0] + k) return { ok: false, reason: 'gap' };
    const ids = idx.map((i) => SPAN_STEPS[i]);
    const key = ids.join('+');
    const has = (t) => ids.includes(t);
    // the last-center EDGES step sits between the third center and LBT (the
    // retired fourth-center residue, always 1 or 3 turns) — a span cannot
    // cross that boundary, so the finish steps pair only with each other
    if ((has('lbt') || has('l3t')) && (has('sc') || has('c3'))) return { ok: false, reason: 'c4gap' };
    if (has('fc') && (has('sc') || has('c3'))) return { ok: false, reason: 'fcreach' };
    if (ids.every((t) => SPAN_REGIME[t] === SPAN_REGIME[ids[0]])) {
      if (ids[0] === 'fc') return { ok: true, key, ids, kind: 'fc' };
      if (ids[0] === 'lbt') return { ok: true, key, ids, kind: 'lbt' };
      if (ids[0] === 'l3t') return { ok: true, key, ids, kind: 'l3t' };
      if (SPAN_REGIME[ids[0]] === 'tri')
        return { ok: true, key, ids, kind: 'f2t', mode: !has('t1') ? 'second' : has('t2') ? 'both' : 'first' };
      return { ok: true, key, ids, kind: 'c23', mode: !has('sc') ? 'third' : has('c3') ? 'both' : 'second' };
    }
    const phases = [];
    if (has('fc')) phases.push({ kind: 'fc' });
    if (has('t1') || has('t2'))
      phases.push({ kind: 'tri', goal: has('t1') && !has('t2') ? 'either' : 'pair' });
    if (has('sc') || has('c3'))
      phases.push({ kind: 'ctr', goal: has('sc') && !has('c3') ? 'c1' : 'c2' });
    if (has('lbt')) phases.push({ kind: 'lbt' });
    if (has('l3t')) phases.push({ kind: 'l3t' });
    return { ok: true, key, ids, kind: 'span', phases, start: ids[0] };
  }

  // ---------- landing views (rebase + anchor conjugation) ----------
  function recolorState(s, cmap) {             // color c -> cmap[c], positions fixed
    const F = E.toFacelets(s), F2 = new Array(72);
    for (let i = 0; i < 72; i++) F2[i] = cmap[F[i]];
    return E.fromFacelets(F2);
  }
  function hexHomeAt(s, X) {                   // face X's hexagon exactly home
    for (let k = 0; k < 3; k++) if (s.ctr[3 * X + k] !== X) return false;
    for (let e = 0; e < 12; e++) {
      const q = E.EDGES[e];
      if ((q[2] === X || q[3] === X) && s.ep[e] !== e) return false;
    }
    return true;
  }

  // span environment: the 12 landing anchors with walk-proved {X,Y} spells
  // and per-grip entry holds, plus the 12 rebase color maps — every piece
  // derived from the engine and asserted at first use (a bad geometry change
  // throws at load, not per drill). Needs both the FT and FC bundles.
  let _spanEnv = null;
  function spanEnv(FT, FC) {
    if (_spanEnv) return _spanEnv;
    const env = f2tEnv(FT);
    const holdOf = (t) => E.walkParsed(E.parseAlg(t), () => {});
    const spellOfHold = (h) => '{' + E.FACES[h[0]] + ',' + E.FACES[h[1]] + '}';
    const ANCH = [[], [], [], []];             // anchors by landing face X (tetrad A)
    for (const A of E.ROT24) {
      for (let X = 0; X < 4; X++) {
        if (E.faceImg(A, X) !== E.FIDX.D) continue;
        const Ainv = E.mInv(A);
        const hold = [0, 1, 2, 3, 4, 5, 6, 7].map((p) => E.faceImg(Ainv, p));
        const spell = spellOfHold(hold);
        if (holdOf(spell).join() !== hold.join()) throw new Error('span: anchor spell ' + spell);
        const entry = FT.BL.SPELLS.map((gs) => {
          const h = holdOf(spell + ' ' + gs);
          const sp2 = spellOfHold(h);
          if (holdOf(sp2).join() !== h.join()) throw new Error('span: entry spell ' + sp2);
          return { spell: sp2, hold: h };
        });
        ANCH[X].push({ M: A, X, spell, hold, entry, P: E.rotFaceletPerm(A) });
      }
    }
    if (ANCH.some((a) => a.length !== 3)) throw new Error('span: anchor census');
    // rebase maps, pinned per formation on the rotated solved states: the
    // uniform Q-rotated solved must carry formation coordinate FC.goals[qi],
    // rebase back to the exact solved state, and read solved in all 3 views.
    const goalIx = new Map(FC.goals.map((g, i) => [g, i]));
    const RB = FC.T12.map((Q, qi) => {
      const cmap = Array.from({ length: 8 }, (_, f) => E.faceImg(Q, f));
      const inv = new Array(8);
      for (let f = 0; f < 8; f++) inv[cmap[f]] = f;
      const F = new Array(72);
      for (let f = 0; f < 8; f++) for (let k = 0; k < 9; k++) F[9 * f + k] = inv[f];
      const rot = E.fromFacelets(F);           // the Q-rotated solved state
      if (FC.coordOf(rot) !== FC.goals[qi]) throw new Error('span: rebase pairing at ' + qi);
      const X = FC.landingFace(FC.goals[qi]);
      const back = recolorState(rot, cmap);
      if (!hexHomeAt(back, X) || E.stateKey(back) !== E.stateKey(E.solved()))
        throw new Error('span: rebase round-trip at ' + qi);
      for (const a of ANCH[X])
        if (!f2tHexOK(conjState(a.M, back))) throw new Error('span: rebase view at ' + qi);
      return { Q, cmap, X };
    });
    // views of a formed full state: exactly 3, or null on any anomaly
    function viewsOf(e) {
      const qi = goalIx.get(FC.coordOf(e));
      if (qi === undefined) return null;
      const rb = RB[qi];
      let eR;
      try { eR = recolorState(e, rb.cmap); } catch (err) { return null; }
      if (!hexHomeAt(eR, rb.X)) return null;
      const out = [];
      for (const a of ANCH[rb.X]) {
        const sM = conjState(a.M, eR);
        if (!f2tHexOK(sM)) return null;
        out.push({ a, qi, sM });
      }
      return out;
    }
    const primary = ANCH[E.FIDX.U].find((a) => a.M === env.M);
    if (!primary) throw new Error('span: primary anchor missing');
    _spanEnv = { env, ANCH, RB, primary, viewsOf, recolorState, spellOfHold, holdOf };
    return _spanEnv;
  }

  // ---------- the phased DP ----------
  // Returns { optimal, breakdown, entries? } or null = reject this scramble
  // (an enumeration cap tripped, a search was uncertifiable, or no finite
  // chain exists — resample rather than approximate). retain keeps the
  // provenance the reveal reconstructs chains from.
  function spanDP(FC, FT, CT, plan, s0, metric, retain) {
    const env = f2tEnv(FT);
    let entries;
    let pi = 0;
    if (plan.phases[0].kind === 'fc') {
      const sp = spanEnv(FT, FC);
      const coord = FC.coordOf(s0);
      const opt = fcDist(FC, metric)[coord];
      if (opt < 1) return null;
      const { total, seqs } = fcEnumOpt(FC, coord, metric, SPAN_FC_CAP);
      if (total > seqs.length) return null;
      const map = new Map(), seen = new Set();
      for (const seq of seqs) {
        let e = s0;
        for (const gi of seq) for (const m of FC.GENS[gi].moves) e = E.move(e, m);
        const ke = E.stateKey(e);
        if (seen.has(ke)) continue;
        seen.add(ke);
        const views = sp.viewsOf(e);
        if (!views) return null;
        for (const v of views) {
          const k = E.stateKey(v.sM);
          const prev = map.get(k);
          if (!prev) map.set(k, { sM: v.sM, cost: opt, split: [opt], prov: retain ? [{ seq, view: v }] : null });
          else if (retain && prev.prov.length < 6) prev.prov.push({ seq, view: v });
        }
      }
      if (map.size > SPAN_ENTRY_CAP) return null;
      entries = [...map.values()];
      pi = 1;
    } else {
      entries = [{ sM: conjState(env.M, s0), cost: 0, split: [], prov: retain ? [] : null }];
    }
    for (; pi < plan.phases.length; pi++) {
      const ph = plan.phases[pi];
      const last = pi === plan.phases.length - 1;
      if (last) {
        // branch-and-bound: entries sorted by admissible lower bound; the
        // sort key IS the bound, so the first entry whose bound cannot beat
        // the best ends the loop (everything after is at least as far).
        const hOf = ph.kind === 'tri'
          ? (() => { const h = f2tH(FT, ph.goal); return (sM) => h(sM); })()
          : (sM) => c23HVal(FT, CT, sM, ph.goal);
        const scored = entries.map((en) => ({ en, lb: en.cost + hOf(en.sM) }));
        scored.sort((a, b) => a.lb - b.lb);
        let best = Infinity, bestEn = null, bestV = 0;
        for (const { en, lb } of scored) {
          if (lb >= best) break;
          const flags = {};
          const v = ph.kind === 'tri'
            ? f2tSearchLen(FT, en.sM, ph.goal, best - en.cost, flags)
            : c23SearchLen(FT, CT, en.sM, ph.goal, best - en.cost, flags);
          if (flags.tripped) return null;
          if (v == null || en.cost + v >= best) continue;
          best = en.cost + v; bestEn = en; bestV = v;
        }
        if (!isFinite(best)) return null;
        return { optimal: best, breakdown: bestEn.split.concat([bestV]),
                 entries: retain ? entries : null, lastGoal: ph.goal, lastKind: ph.kind };
      }
      // interior phase: every entry expands through its COMPLETE optimal-word
      // set (per-entry optimality — a longer word never enters a chain)
      const next = new Map();
      for (const en of entries) {
        const flags = {};
        const v = ph.kind === 'tri'
          ? f2tSearchLen(FT, en.sM, ph.goal, null, flags)
          : c23SearchLen(FT, CT, en.sM, ph.goal, null, flags);
        if (v == null) return null;
        const push = (sM2, word) => {
          const k = E.stateKey(sM2);
          const cost2 = en.cost + v;
          const prev = next.get(k);
          if (!prev || cost2 < prev.cost)
            next.set(k, { sM: sM2, cost: cost2, split: en.split.concat([v]),
                          prov: retain ? [{ from: en, word }] : null });
          else if (retain && cost2 === prev.cost && prev.prov.length < 6) prev.prov.push({ from: en, word });
        };
        if (v === 0) { push(en.sM, []); continue; }
        const res = ph.kind === 'tri'
          ? f2tEnumerate(FT, en.sM, ph.goal, v, SPAN_TRI_CAP)
          : c23Enumerate(FT, CT, en.sM, ph.goal, v, SPAN_TRI_CAP);
        if (res.capped) return null;
        for (const w of res.words) {
          let s2 = en.sM;
          for (const m of w) s2 = E.move(s2, m);
          push(s2, w);
        }
        if (next.size > SPAN_ENTRY_CAP) return null;
      }
      entries = [...next.values()];
    }
    return null;                               // unreachable: plans have >= 2 phases
  }

  // ---------- span drill ----------
  const spanRefold = (seq) => {
    let st = E.solved();
    for (const m of seq) st = E.move(st, m);
    return st;
  };

  // diagram mask. fc-led spans: the white pieces plus the union over ALL 36
  // landing views (12 formations x 3 spins) of the triples rule's pieces —
  // before a landing is chosen, exactly the pieces SOME landing's triples
  // step can constrain. tri-led spans: the union of the triples and centers
  // rules on the primary view. Any rebase anomaly falls back to an empty
  // mask (show everything) — a mask may be generous, never hide a relevant
  // facelet.
  function spanMask(FC, FT, plan, st) {
    const env = f2tEnv(FT);
    const keep = new Set();
    if (plan.start === 'fc') {
      const sp = spanEnv(FT, FC);
      const { CTRF, EDGEF } = slotFacelets();
      for (let x = 0; x < 12; x++) if (st.ctr[x] === 0) keep.add(CTRF[x]);
      for (let e = 0; e < 12; e++)
        if (FC.U_EDGES.includes(st.ep[e])) for (const i of EDGEF[e]) keep.add(i);
      // per-view TRIPLE pieces only (corners 3,5 + candidate source
      // triangles, wherever they sit): the f2t rule's white-hexagon part is
      // slot-based (white is home in f2t drills) and the white PIECES are
      // already kept above, wherever the scramble put them.
      for (const rb of sp.RB) {
        let sR;
        try { sR = recolorState(st, rb.cmap); } catch (err) { return []; }
        for (const a of sp.ANCH[rb.X]) {
          const sM = conjState(a.M, sR);
          for (const c of [3, 5]) for (const i of env.CORNF[sM.cp.indexOf(c)]) keep.add(a.P[i]);
          for (let x = 0; x < 12; x++)
            if (sM.ctr[x] >= 1 && sM.ctr[x] <= 3) keep.add(a.P[env.CTRF[x]]);
        }
      }
    } else {
      const sM = conjState(env.M, st);
      const keepM = f2tKeepM(env, sM);
      if (plan.phases.some((p) => p.kind === 'ctr')) keepM.push(...c23KeepM(env, sM));
      for (const i of keepM) keep.add(env.P[i]);
    }
    const mask = [];
    for (let i = 0; i < 72; i++) if (!keep.has(i)) mask.push(i);
    return mask;
  }

  // scramble + drill for a multi-regime span. fc-led spans scramble with a
  // 30-move canonical native walk (the community full-solve length: from the
  // fc step on, the WHOLE puzzle state matters) rejected until the white
  // center is displaced; tri-led spans reuse the F2T sealed-walk machinery
  // (white exactly home, drilled triples unsolved, one triple pre-solved by
  // an appended machine-optimal word when the span starts at t2). The DP
  // must certify an exact phased target or the scramble is resampled.
  function makeSpanDrill(FC, FT, CT, plan, opts, rng, FIN) {
    if (plan.start === 'lbt') return makeFinSpanDrill(FIN, plan, rng);
    const rnd = rng || Math.random;
    const env = f2tEnv(FT);
    const metric = opts && opts.metric === 'native' ? 'native' : 'token';
    let dpTries = 0;
    for (let att = 0; att < SPAN_TRIES && dpTries < SPAN_DP_TRIES; att++) {
      let seq = [], st, presolved = 0;
      if (plan.start === 'fc') {
        let last = -1, prev = -1, guard = 0;
        while (seq.length < SPAN_LEN_FC) {
          if (++guard > 1600) break;           // a stuck rng must exhaust attempts, not hang
          const f = (rnd() * 8) | 0;
          if (f === last) continue;
          if (last >= 0 && E.OPPF[f] === last && f === prev) continue;   // no R BL R
          seq.push(2 * f + ((rnd() * 2) | 0)); prev = last; last = f;
        }
        if (seq.length < SPAN_LEN_FC) continue;
        st = spanRefold(seq);
        if (fcDist(FC, metric)[FC.coordOf(st)] < 1) continue;
      } else {
        let last = -1, guard = 0;
        while (seq.length < F2T_LEN) {
          if (++guard > 600) break;
          const m = env.PHYS[(rnd() * 10) | 0];
          const f = m >> 1;
          if (f === last) continue;
          if (E.OPPF[f] === last && f > last) continue;
          seq.push(m); last = f;
        }
        if (seq.length < F2T_LEN) continue;
        st = spanRefold(seq);
        if (!f2tWhiteHome(env, st)) continue;
        let sM = conjState(env.M, st);
        if (f2tTripleOK(sM, 3) || f2tTripleOK(sM, 5)) continue;
        if (plan.start === 't2') {
          const c = rnd() < 0.5 ? 3 : 5;
          const L1 = f2tSearchLen(FT, sM, String(c));
          if (L1 == null || L1 < 1) continue;
          const w = f2tEnumerate(FT, sM, String(c), L1, 1).words[0];
          if (!w) continue;
          seq = mergeMoves(seq.concat(w.map((m) => 2 * E.faceImg(env.Minv, m >> 1) + (m & 1))));
          st = spanRefold(seq);
          sM = conjState(env.M, st);
          if (!f2tWhiteHome(env, st) || !f2tTripleOK(sM, c) || f2tTripleOK(sM, c === 3 ? 5 : 3)) continue;
          presolved = c;
        }
      }
      dpTries++;
      const dp = spanDP(FC, FT, CT, plan, st, metric, false);
      if (!dp || dp.optimal < 1) continue;
      return {
        kind: 'span', steps: plan.ids.slice(), spanKey: plan.key, start: plan.start,
        metric: plan.start === 'fc' ? metric : null, presolved,
        scramble: seq.map((m) => E.MOVES[m]).join(' '),
        state: st, optimal: dp.optimal, breakdown: dp.breakdown,
        mask: spanMask(FC, FT, plan, st),
      };
    }
    return null;
  }

  // ---------- span reveal (continuous lines) ----------
  // Every span plan today has exactly TWO phases (fc-led spans stop at the
  // triples; tri-led spans run triples then centers), so a chain is one
  // provenance item + one last-phase word. Chains are re-enumerated from the
  // retained DP frontier: an entry contributes iff its exact last-phase
  // distance closes the gap to the drill optimal.
  // capped = the listing may be incomplete (an uncertifiable search, a word
  // or provenance cap, or the chain cap) — the reveal header then shows the
  // count as "N+", never a truncated count presented as exact.
  function spanChains(FC, FT, CT, plan, drill, dp) {
    const chains = [];
    let capped = false;
    for (const en of dp.entries) {
      if (en.cost > drill.optimal) continue;
      const need = drill.optimal - en.cost;
      const flags = {};
      const v = dp.lastKind === 'tri'
        ? f2tSearchLen(FT, en.sM, dp.lastGoal, need + 1, flags)
        : c23SearchLen(FT, CT, en.sM, dp.lastGoal, need + 1, flags);
      if (flags.tripped) capped = true;
      if (v !== need) continue;
      let words = [[]];
      if (need > 0) {
        const res = dp.lastKind === 'tri'
          ? f2tEnumerate(FT, en.sM, dp.lastGoal, need, 12)
          : c23Enumerate(FT, CT, en.sM, dp.lastGoal, need, 12);
        words = res.words;
        if (res.capped || words.length >= 12) capped = true;
      }
      if (en.prov.length >= 6) capped = true;    // the provenance cap may have bound
      for (const w of words) {
        for (const pv of en.prov) {
          chains.push(pv.seq
            ? { fcSeq: pv.seq, view: pv.view, triWord: w, ctrWord: null }
            : { fcSeq: null, view: null, triWord: pv.word, ctrWord: w });
          if (chains.length >= SPAN_CHAIN_CAP) return { chains, capped: true };
        }
      }
    }
    return { chains, capped };
  }

  // one continuous engine text for a chain, junction re-grips spelled as
  // relative {X,Y} brackets against the hold the previous tokens actually
  // leave (the 2026-07-14 physical-loop contract), and the whole line proved
  // before it is returned: exact fired-move plan, phase-boundary predicates
  // through the line's own landing view, per-prefix block intactness for the
  // center segment, and the total/segment counts. Returns null on ANY miss.
  function spanBuildLine(FC, FT, CT, plan, drill, ch) {
    const env = f2tEnv(FT);
    const sp = spanEnv(FT, FC);
    const holdOf = sp.holdOf;
    const ID_HOLD = [0, 1, 2, 3, 4, 5, 6, 7];
    const relSpell = (h1, h2) => (h1.join() === h2.join() ? ''
      : '{' + E.FACES[h1.indexOf(h2[0])] + ',' + E.FACES[h1.indexOf(h2[1])] + '}');
    const anchor = ch.view ? ch.view.a : sp.primary;
    const Ainv = E.mInv(anchor.M);
    const mapPhys = (w) => 2 * E.faceImg(Ainv, w >> 1) + (w & 1);
    let text = '';
    const firedPlan = [];
    let holdAfterFc = null;
    if (ch.fcSeq) {
      const spd = fcRespell(FC, ch.fcSeq);
      if (!spd) return null;
      text = spd.text;
      firedPlan.push(...spd.natives);
      holdAfterFc = holdOf(text);
    }
    if (ch.triWord.length) {
      const r = f2tRespell(env, ch.triWord);
      if (!r) return null;
      const target = anchor.entry[r.j0].hold;
      const cur = text ? holdOf(text) : ID_HOLD;
      const br = relSpell(cur, target);
      const prefix = [text, br].filter(Boolean).join(' ');
      if (br && holdOf(prefix).join() !== target.join()) return null;
      text = [prefix, r.text].filter(Boolean).join(' ');
      firedPlan.push(...ch.triWord.map(mapPhys));
    }
    if (ch.ctrWord && ch.ctrWord.length) {
      const spc = c23Spell(CT, ch.ctrWord);
      if (!spc) return null;
      const target = anchor.entry[CT.RES.j0].hold;
      const br = relSpell(holdOf(text), target);
      const prefix = text + (br ? ' ' + br : '');
      if (br && holdOf(prefix).join() !== target.join()) return null;
      text = prefix + ' ' + spc.text;
      firedPlan.push(...ch.ctrWord.map(mapPhys));
    }
    // ---- proof ----
    const parsed = E.parseAlg(text);
    if (!parsed) return null;
    const split = [];
    if (ch.fcSeq) split.push(ch.fcSeq.length);
    split.push(ch.triWord.length);
    if (ch.ctrWord) split.push(ch.ctrWord.length);
    if (E.countMoves(parsed) !== drill.optimal) return null;
    if (split.reduce((a, b) => a + b, 0) !== drill.optimal) return null;
    const fired = [];
    try { E.walkParsed(parsed, (m) => fired.push(m)); } catch (e) { return null; }
    if (fired.length !== firedPlan.length || fired.some((m, i) => m !== firedPlan[i])) return null;
    const nFc = ch.fcSeq ? ch.fcSeq.reduce((n, gi) => n + FC.GENS[gi].moves.length, 0) : 0;
    let st = drill.state;
    for (let i = 0; i < nFc; i++) st = E.move(st, fired[i]);
    let sM, landing = null;
    if (ch.fcSeq) {
      if (!fcStateOK(FC, st)) return null;
      const views = sp.viewsOf(st);
      if (!views) return null;
      const view = views.find((v) => v.a === ch.view.a);
      if (!view) return null;
      sM = view.sM;
      const X = sp.RB[view.qi].X;
      const p = holdAfterFc.indexOf(X);
      landing = E.FACES[p >= 0 ? p : X];
    } else {
      sM = conjState(env.M, drill.state);
    }
    const triGoal = plan.phases[ch.fcSeq ? 1 : 0].goal;
    for (const m of ch.triWord) sM = E.move(sM, m);
    if (!f2tGoalOK(sM, triGoal)) return null;
    let corner = null;
    if (triGoal === 'either')
      corner = f2tTripleOK(sM, 3) && f2tTripleOK(sM, 5) ? 'both'
        : f2tTripleOK(sM, 3) ? F2T_CORNER_NAME[3] : F2T_CORNER_NAME[5];
    let centers = null;
    if (ch.ctrWord) {
      const D2 = 2 * E.FIDX.D;
      let b = 0;
      for (const m of ch.ctrWord) {
        sM = E.move(sM, m);
        b = (b + (m === D2 ? 1 : m === D2 + 1 ? 2 : 0)) % 3;
        if (!c23BlockOK(CT, sM, b)) return null;
      }
      if (b !== 0) return null;
      if (!c23GoalOK(sM, plan.phases[1].goal)) return null;
      centers = C23_FACES.filter((f) => c23HexOK(sM, f)).map((f) => c23PhysFace(env, f));
    }
    return { text, split, landing, corner, centers,
             brackets: (text.match(/\{/g) || []).length };
  }

  // all step-optimal lines for a finished span drill: chains re-derived from
  // a retained DP run, each materialized as ONE continuous engine text and
  // fully re-proved (spanBuildLine) before display; plainest-first.
  function spanSolutions(FC, FT, CT, drill, show, FIN) {
    const plan = spanPlan(drill.steps);
    if (!plan.ok || plan.kind !== 'span') return { total: 0, dropped: 1, capped: false, lines: [] };
    if (plan.start === 'lbt') return finSpanSolutions(FIN, drill, show);
    const dp = spanDP(FC, FT, CT, plan, drill.state, drill.metric || 'token', true);
    if (!dp || dp.optimal !== drill.optimal) return { total: 0, dropped: 1, capped: false, lines: [] };
    const { chains, capped } = spanChains(FC, FT, CT, plan, drill, dp);
    const built = [];
    const seenText = new Set();
    let dropped = 0;
    for (const ch of chains) {
      const line = spanBuildLine(FC, FT, CT, plan, drill, ch);
      if (!line) { dropped++; continue; }
      // one physical solution can certify under two landing views (white-axis
      // spins) — identical texts are the same solve, shown once
      if (seenText.has(line.text)) continue;
      seenText.add(line.text);
      built.push(line);
    }
    built.sort((a, b) => a.brackets - b.brackets || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
    return { total: built.length, dropped, capped, lines: built.slice(0, show || 10) };
  }

  // full re-proof of a span drill from scratch (tests + UI spot checks): the
  // scramble text has the span's shape and reproduces the state, the start
  // conditions hold for the span's first step, and an independent DP run
  // reproduces the exact target, breakdown and mask.
  function verifySpanDrill(FC, FT, CT, d, FIN) {
    if (!d || d.kind !== 'span') return false;
    if (d.start === 'lbt') return verifyFinSpanDrill(FIN, d);
    const plan = spanPlan(d.steps);
    if (!plan.ok || plan.kind !== 'span' || plan.key !== d.spanKey) return false;
    const toks = d.scramble.split(/\s+/).filter(Boolean);
    if (plan.start === 'fc') {
      if (toks.length !== SPAN_LEN_FC || !toks.every((t) => /^(BR|BL|[UFRLDB])'?$/.test(t))) return false;
    } else {
      if (!toks.length || toks.length > F2T_LEN + 12) return false;
      if (!toks.every((x) => /^(U|F|BR|BL|D)'?$/.test(x))) return false;
    }
    for (let i = 1; i < toks.length; i++)
      if (toks[i].replace("'", '') === toks[i - 1].replace("'", '')) return false;
    const p = E.parseAlg(d.scramble);
    if (!p) return false;
    let st = E.solved();
    E.walkParsed(p, (m) => { st = E.move(st, m); });
    if (!E.eq(st, d.state)) return false;
    const env = f2tEnv(FT);
    const metric = d.metric === 'native' ? 'native' : 'token';
    if (plan.start === 'fc') {
      if (d.metric !== 'token' && d.metric !== 'native') return false;
      if (fcDist(FC, metric)[FC.coordOf(st)] < 1) return false;
    } else {
      if (d.metric !== null) return false;
      if (!f2tWhiteHome(env, st)) return false;
      const sM = conjState(env.M, st);
      if (plan.start === 't2') {
        if (d.presolved !== 3 && d.presolved !== 5) return false;
        if (!f2tTripleOK(sM, d.presolved) || f2tTripleOK(sM, d.presolved === 3 ? 5 : 3)) return false;
      } else if (d.presolved !== 0 || f2tTripleOK(sM, 3) || f2tTripleOK(sM, 5)) return false;
    }
    const dp = spanDP(FC, FT, CT, plan, st, metric, false);
    if (!dp || dp.optimal !== d.optimal || d.optimal < 1) return false;
    if (dp.breakdown.join() !== (d.breakdown || []).join()) return false;
    return spanMask(FC, FT, plan, st).join() === (d.mask || []).join();
  }

  return { buildModel, nativeMovesOf, mergeMoves, caseSpec, makeDrill, rowAufToken, verifyDrill,
           fcStateOK, makeFcDrill, fcEnumOpt, fcSolutions, fcRespell, verifyFcDrill,
           f2tEnv, f2tGoalOK, f2tTripleOK, f2tSearchLen, f2tEnumerate, f2tRespell,
           makeF2tDrill, f2tSolutions, verifyF2tDrill,
           c23HexOK, c23GoalOK, c23SearchLen, c23Enumerate, c23Spell,
           c23BlockOK, c23LineWalkOK, makeC23Drill, c23Solutions, verifyC23Drill,
           SPAN_STEPS, spanPlan, spanEnv, spanDP, makeSpanDrill, spanSolutions, verifySpanDrill,
           buildFinish, beforeLbtOK, lbtApplicable, makeLbtDrill, lbtSolutions, verifyLbtDrill,
           makeL3tDrill, l3tSolutions, verifyL3tDrill, l3tLines, l3tOptOf, finSpanDP,
           finCanonText, finCanonOrKeep, finPhysMoves, l3tChainLines };
}
