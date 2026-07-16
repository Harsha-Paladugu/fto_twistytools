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
    // slot -> facelet maps (mask): centre slot 3f+k, corner vertex, edge slot
    const CTRF = new Array(24);
    const CORNF = Array.from({ length: 6 }, () => []);
    const EDGEF = Array.from({ length: 12 }, () => []);
    for (let i = 0; i < 72; i++) {
      const ft = E.FEAT[i];
      if (ft.t === 'x') CTRF[3 * ft.f + (ft.v % 3)] = i;
      else if (ft.t === 'c') CORNF[ft.v].push(i);
      else EDGEF[E.EDGES.findIndex((q) => q[0] === ft.v && q[1] === ft.v2)].push(i);
    }
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
  // exact optimal turn count (or null past F2T_LMAX / on a budget trip)
  function f2tSearchLen(FT, s0, goal) {
    if (f2tGoalOK(s0, goal)) return 0;
    const h0 = f2tH(FT, goal)(s0);
    if (h0 >= 99) return null;
    for (let bound = Math.max(1, h0); bound <= F2T_LMAX; bound++) {
      const r = f2tEnumerate(FT, s0, goal, bound, 1);
      if (r.words.length) return bound;
      if (r.capped) return null;
    }
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
  function f2tMask(env, sM) {
    const keepM = [];
    for (const e of [9, 10, 11]) keepM.push(...env.EDGEF[e]);
    for (const x of [18, 19, 20]) keepM.push(env.CTRF[x]);
    for (const c of [3, 5]) keepM.push(...env.CORNF[sM.cp.indexOf(c)]);
    for (let x = 0; x < 12; x++) if (sM.ctr[x] >= 1 && sM.ctr[x] <= 3) keepM.push(env.CTRF[x]);
    const keep = new Set(keepM.map((i) => env.P[i]));
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
  // in the same sealed 10-native-move TURN metric as F2T (the center steps'
  // alphabet {R, U, Rw, BL} still spells every sealed move as one token from
  // every grip, so that metric IS "how many turns"). The triples' own tables
  // come from the F2T bundle — a center word may break the solved triples
  // mid-way but must END with them re-solved, so both read at every node.
  //
  // The drill starts where a real Bencisco solve stands after the first two
  // triples: the printed scramble is a 16-move canonical sealed walk PLUS a
  // machine-optimal solve of both bottom triples (which also lands the white
  // center exactly home), and mode 'third' appends a machine-optimal
  // second-center solve on top. Goals are placement-neutral, matching the
  // solver's "search picks" semantics: 'second' forms ANY one of the three
  // remaining hexagons, 'third' and 'both' reach any two of them — always
  // with the white center and both triples exactly solved again at the end.

  const C23_LEN = 16;                         // scramble walk length (before the appended solves)
  const C23_TRIES = 40;                       // attempts are cheap to reject, expensive to finish
  const C23_ENUM_CAP = 512;                   // optimal-word harvest cap
  const C23_NODES = 2e7;                      // enumeration node budget per call
  const C23_LMAX = 22;                        // bound guard for the iterative deepening
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
  // never carries full states: a node is ten small indices stepped through
  // CT.rt's Int32 transition tables (corners; the four hexagons' 3-edge
  // placements; the orbit-B L/R color masks, B's mask being the complement
  // via CT.MKB since the sealed group pins the white triangles; the three
  // orbit-A color masks for the triples' source slots). The goal test and
  // every pruning bound are O(1) table reads on those indices, and the
  // emitted words are re-proved on full states by the solutions/verify
  // layer — the search and the proof stay independent.
  //
  // Admissible bounds, all in the sealed turn metric: the triples' corner
  // table and orbit-A marginals (the drill must END with the triples
  // re-solved) enter as a MAX; the hexagon goal is a disjunction over
  // faces ('c1') / pairs ('c2'), so its part is a MIN over candidates,
  // each candidate a MAX of the exact one-hexagon table, the orbit-B
  // mask-pair table and (pairs) the exact 6-edge coupling. Any two hexagon
  // blocks plus D force the whole orbit, so every 'c2' candidate shares
  // the single dB.all bound.
  const NMKc = 220, NE3c = 1320;              // CT codec sizes (mask / 3-edge placement)
  function c23IxOf(CT, s) {
    const pA = new Array(12), pB = new Array(12);
    for (let i = 0; i < 12; i++) { pA[i] = s.ctr[i]; pB[i] = s.ctr[12 + i] - 4; }
    return [
      CT.cornerIndex(s.cp, s.co),
      CT.edgePlaceIndex(s.ep, CT.HEX_EDGES.D),
      CT.edgePlaceIndex(s.ep, CT.HEX_EDGES.L),
      CT.edgePlaceIndex(s.ep, CT.HEX_EDGES.R),
      CT.edgePlaceIndex(s.ep, CT.HEX_EDGES.B),
      CT.maskOfColor(pB, 0), CT.maskOfColor(pB, 1),
      CT.maskOfColor(pA, 1), CT.maskOfColor(pA, 2), CT.maskOfColor(pA, 3),
    ];
  }
  function c23DFS(FT, CT, s0, goal, L, cap, budget) {
    const mE3 = CT.rt.mE3, mMA = CT.rt.mMA, mMB = CT.rt.mMB, mC = CT.rt.mC;
    const dC = FT.dC['3,5'];
    const dAF = CT.dAm.F, dABR = CT.dAm.BR, dABL = CT.dAm.BL;
    const dBL_ = CT.dB.L, dBR_ = CT.dB.R, dBB_ = CT.dB.B, dBall = CT.dB.all;
    const hL_ = CT.dH1.L, hR_ = CT.dH1.R, hB_ = CT.dH1.B;
    const eLR = CT.dE33.LR, eLB = CT.dE33.LB, eRB = CT.dE33.RB;
    const MKB = CT.MKB, MBITS = CT.MBITS, HOME = CT.HOME;
    const pair = goal === 'c2';
    const need = pair ? 2 : 1;
    const moves = FT.BL.SEALED_MOVES;
    const words = [], path = [];
    let nodes = 0, capped = false;
    // slot bits of the triples' source slots: F->5, BR->{6,8}, BL->9
    const goalIx = (c, eD, eL, eR, eB, mL, mR, aF, aBR, aBL) => {
      if (dC[c] !== 0 || eD !== HOME.eD) return false;
      if (!(MBITS[aF] & 32) || (MBITS[aBR] & 320) !== 320 || !(MBITS[aBL] & 512)) return false;
      let n = (eL === HOME.eL && mL === HOME.mL ? 1 : 0) + (eR === HOME.eR && mR === HOME.mR ? 1 : 0);
      if (n < need && eB === HOME.eB && MKB[mL * NMKc + mR] === HOME.mB) n++;
      return n >= need;
    };
    const rec = (c, eD, eL, eR, eB, mL, mR, aF, aBR, aBL, g, lastFace) => {
      if (capped || ++nodes > budget) { capped = true; return; }
      if (g === L) {
        if (goalIx(c, eD, eL, eR, eB, mL, mR, aF, aBR, aBL)) {
          words.push(path.slice());
          if (words.length >= cap) capped = true;
        }
        return;
      }
      const lim = L - g;
      if (dC[c] > lim || dAF[aF] > lim || dABR[aBR] > lim || dABL[aBL] > lim) return;
      const u = mL * NMKc + mR;
      if (pair) {
        if (dBall[u] > lim) return;
        const hL = hL_[eL * NMKc + mL], hR = hR_[eR * NMKc + mR];
        let fits = hL <= lim && hR <= lim && eLR[eL * NE3c + eR] <= lim;
        if (!fits) {
          const hB = hB_[eB * NMKc + MKB[u]];
          fits = (hL <= lim && hB <= lim && eLB[eL * NE3c + eB] <= lim) ||
                 (hR <= lim && hB <= lim && eRB[eR * NE3c + eB] <= lim);
        }
        if (!fits) return;
      } else {
        const fits = (dBL_[u] <= lim && hL_[eL * NMKc + mL] <= lim) ||
                     (dBR_[u] <= lim && hR_[eR * NMKc + mR] <= lim) ||
                     (dBB_[u] <= lim && hB_[eB * NMKc + MKB[u]] <= lim);
        if (!fits) return;
      }
      for (const m of moves) {
        const f = m >> 1;
        if (f === lastFace) continue;
        if (E.OPPF[f] === lastFace && f > lastFace) continue;
        path.push(m);
        rec(mC[c * 16 + m], mE3[eD * 16 + m], mE3[eL * 16 + m], mE3[eR * 16 + m], mE3[eB * 16 + m],
            mMB[mL * 16 + m], mMB[mR * 16 + m], mMA[aF * 16 + m], mMA[aBR * 16 + m], mMA[aBL * 16 + m],
            g + 1, f);
        path.pop();
        if (capped) return;
      }
    };
    if (L > 0) {
      const ix = c23IxOf(CT, s0);
      rec(ix[0], ix[1], ix[2], ix[3], ix[4], ix[5], ix[6], ix[7], ix[8], ix[9], 0, -1);
    }
    return { words, capped };
  }

  // exact-root admissible bound: the DFS components plus the F2T joint
  // orbit-A table (whose per-color marginals the DFS relaxes for speed)
  function c23HVal(FT, CT, s, goal) {
    const ix = c23IxOf(CT, s);
    const c = ix[0], eL = ix[2], eR = ix[3], eB = ix[4], mL = ix[5], mR = ix[6];
    const u = mL * NMKc + mR;
    const mB = CT.MKB[u];
    let h = FT.dC['3,5'][c];
    const bump = (v) => { if (v > h) h = v; };
    bump(FT.dA['5,6,8,9'][FT.encA(s.ctr)]);
    bump(CT.dAm.F[ix[7]]); bump(CT.dAm.BR[ix[8]]); bump(CT.dAm.BL[ix[9]]);
    const hL = CT.dH1.L[eL * NMKc + mL], hR = CT.dH1.R[eR * NMKc + mR];
    const hB = mB === 255 ? 99 : CT.dH1.B[eB * NMKc + mB];
    if (goal === 'c2') {
      bump(CT.dB.all[u]);
      bump(Math.min(
        Math.max(hL, hR, CT.dE33.LR[eL * NE3c + eR]),
        Math.max(hL, hB, CT.dE33.LB[eL * NE3c + eB]),
        Math.max(hR, hB, CT.dE33.RB[eR * NE3c + eB])));
    } else {
      bump(Math.min(Math.max(CT.dB.L[u], hL), Math.max(CT.dB.R[u], hR), Math.max(CT.dB.B[u], hB)));
    }
    return h === 0 && !c23GoalOK(s, goal) ? 1 : h;
  }

  function c23Enumerate(FT, CT, s0, goal, L, cap) {
    return c23DFS(FT, CT, s0, goal, L, cap || C23_ENUM_CAP, C23_NODES);
  }
  // exact optimal turn count (or null past C23_LMAX / on a budget trip)
  function c23SearchLen(FT, CT, s0, goal) {
    if (c23GoalOK(s0, goal)) return 0;
    const h0 = c23HVal(FT, CT, s0, goal);
    if (h0 >= 99) return null;
    for (let bound = Math.max(1, h0); bound <= C23_LMAX; bound++) {
      const r = c23Enumerate(FT, CT, s0, goal, bound, 1);
      if (r.words.length) return bound;
      if (r.capped) return null;
    }
    return null;
  }

  // deterministic hold-token respell for CENTER words: the alphabet adds BL
  // (engine D in place — Rw's driftless state twin), so an engine D turn has
  // two spellings and the bracket-minimal one over the whole word is found by
  // a tiny DP over (position, grip) instead of the triples' greedy walk. An
  // engine L/R/B turn read from the wrong grip costs one relative {X,Y}
  // bracket fused to the U token (the solver's convention). Ties resolve to
  // the first option in BL.TOKS order (Rw before BL), lowest grip first.
  function c23Respell(env, word) {
    const gen = env.BL.gen, n = word.length, INF = 1e9;
    const minB = Array.from({ length: n + 1 }, () => [0, 0, 0]);
    for (let i = n - 1; i >= 0; i--) {
      const m = word[i];
      for (let j = 0; j < 3; j++) {
        let best = INF;
        for (let k = 0; k < 8; k++) if (gen[j][k].m === m) {
          const v = minB[i + 1][gen[j][k].nj];
          if (v < best) best = v;
        }
        for (let t = 0; t < 3; t++) {
          if (t === j) continue;
          for (const k of [2, 3]) if (gen[t][k].m === m) {
            const v = 1 + minB[i + 1][gen[t][k].nj];
            if (v < best) best = v;
          }
        }
        minB[i][j] = best;
      }
    }
    let j0 = 0;
    for (let j = 1; j < 3; j++) if (minB[0][j] < minB[0][j0]) j0 = j;
    if (minB[0][j0] >= INF) return null;
    const out = [];
    let j = j0;
    for (let i = 0; i < n; i++) {
      const m = word[i];
      let done = false;
      for (let k = 0; k < 8 && !done; k++)
        if (gen[j][k].m === m && minB[i + 1][gen[j][k].nj] === minB[i][j]) {
          out.push(env.BL.TOKS[k]); j = gen[j][k].nj; done = true;
        }
      for (let t = 0; t < 3 && !done; t++) {
        if (t === j) continue;
        for (const k of [2, 3])
          if (gen[t][k].m === m && 1 + minB[i + 1][gen[t][k].nj] === minB[i][j]) {
            out.push(env.REGRIP[j][t], env.BL.TOKS[k]); j = gen[t][k].nj; done = true; break;
          }
      }
      if (!done) return null;                  // cannot happen for sealed words
    }
    return { brackets: minB[0][j0], text: out.join(' '), j0, jEnd: j };
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
  function c23Mask(env, sM) {
    const keepM = [];
    for (let e = 0; e < 12; e++) keepM.push(...env.EDGEF[e]);
    for (let x = 12; x < 24; x++) keepM.push(env.CTRF[x]);
    for (let x = 0; x < 12; x++) if (sM.ctr[x] >= 1 && sM.ctr[x] <= 3) keepM.push(env.CTRF[x]);
    for (const c of [3, 5]) keepM.push(...env.CORNF[sM.cp.indexOf(c)]);
    const keep = new Set(keepM.map((i) => env.P[i]));
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

  // all optimal solutions for a drill, solver-style: one {X,Y} entry bracket,
  // then {R, U, Rw, BL} tokens with relative {X,Y} re-grips where the DP
  // needs them; sorted plainest-first, every line re-proved end-to-end on the
  // full drill state before it is emitted. The chip lists the faces (in the
  // scrambling hold) whose hexagons the line leaves formed.
  function c23Solutions(FT, CT, drill, show) {
    const env = f2tEnv(FT);
    const res = c23Enumerate(FT, CT, drill.stateM, drill.goal, drill.optimal);
    const spelled = [];
    let dropped = 0;
    for (const w of res.words) {
      const sp = c23Respell(env, w);
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
      if (!c23GoalOK(sM2, drill.goal)) { dropped++; continue; }
      lines.push({
        text, brackets: sp.brackets,
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
    if (!toks.length || toks.length > C23_LEN + 26) return false;
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

  return { buildModel, nativeMovesOf, mergeMoves, caseSpec, makeDrill, rowAufToken, verifyDrill,
           fcStateOK, makeFcDrill, fcSolutions, fcRespell, verifyFcDrill,
           f2tEnv, f2tGoalOK, f2tTripleOK, f2tSearchLen, f2tEnumerate, f2tRespell,
           makeF2tDrill, f2tSolutions, verifyF2tDrill,
           c23HexOK, c23GoalOK, c23SearchLen, c23Enumerate, c23Respell,
           makeC23Drill, c23Solutions, verifyC23Drill };
}
