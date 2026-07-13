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

  return { buildModel, nativeMovesOf, mergeMoves, caseSpec, makeDrill, rowAufToken, verifyDrill };
}
