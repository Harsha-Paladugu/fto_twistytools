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
  // the 12 goal formations, and the 24 unit generators. The drill: a plain
  // 30-random-move scramble (the community full-scramble style, engine
  // suppression rules), rejection-sampled on the white-center distance when
  // an exact difficulty is requested; reveal enumerates ALL optimal solutions
  // (canonicalized: commuting same-axis runs in fixed layer order) and
  // respells them token by token through the engine's own hold walk, so
  // slice-containing texts mean exactly what the engine (and the sheets'
  // dialect) say they mean.

  const FC_LEN = 30;                          // community-standard scramble length
  const FC_TRIES = 60000;                     // exact-N rejection cap (rarest level ~2.5e-4)
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

  // all optimal solutions for a drill: exact canonical count (memoized DP over
  // strictly-descending moves) + up to `show` display lines, each respelled,
  // landing-tagged (hold-aware: where the hexagon physically ends given the
  // solution's slices) and re-proved on the full state before it is emitted.
  function fcSolutions(FC, drill, show) {
    const dist = fcDist(FC, drill.metric);
    const nGens = drill.metric === 'native' ? 16 : FC.GENS.length;
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
    const total = drill.optimal === 0 ? 0 : count(drill.coord, -1, 0);
    const raw = [];
    const rec = (c, axis, rank, path) => {
      if (raw.length >= FC_ENUM_CAP) return;
      if (dist[c] === 0) { raw.push(path.slice()); return; }
      for (let gi = 0; gi < nGens; gi++) {
        const g = FC.GENS[gi];
        if (g.axis === axis && g.rank <= rank) continue;
        const t = FC.stepGen(c, gi);
        if (dist[t] !== dist[c] - 1) continue;
        path.push(gi);
        rec(t, g.axis, g.rank, path);
        path.pop();
        if (raw.length >= FC_ENUM_CAP) return;
      }
    };
    if (drill.optimal > 0) rec(drill.coord, -1, 0, []);
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

  return { buildModel, nativeMovesOf, mergeMoves, caseSpec, makeDrill, rowAufToken, verifyDrill,
           fcStateOK, makeFcDrill, fcSolutions, fcRespell, verifyFcDrill };
}
