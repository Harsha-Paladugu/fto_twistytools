/* fto.twistytools.com — Bencisco method solver core (no DOM; testable in node). M5. */
(function(){const module={exports:{}};
/* Step-by-step FTO solver following the Bencisco method (the user's decision,
   2026-07-13), the dominant FTO method (Ben Streeter; ground-truth §Methods).
   A Bencisco "center" is a HEXAGON: one face's 3 edges + 3 centre triangles —
   there are four of them, on the tetrad-B faces {D, L, R, B}, and together
   they hold all 12 edges (the four faces of one tetrad partition the edge
   set; machine-derived from engine geometry and asserted at init). The six
   "triples" (corner + its two flanking tetrad-A triangles) carry the 6
   corners and the 12 tetrad-A triangles. Engine-coordinate step regions
   (derived at init from E.EDGES / face-vertex incidence, pinned in
   tools/test-solver.mjs against the M3 sheet data):

     1  First center   D hexagon: edges {9,10,11} + D slots (color 6)
     2  First 2 triples corners 3,5 + A slots {6,9} and {5,8} (either order)
     3  Second center  one of the L/R/B hexagons (search picks)
     4  Last 2 centers the remaining two hexagons (search picks the order)
     5  Last bottom triple  corner 4 + slots F(4)/BL(10)  — LBT sheet algs
     6  Last 3 triples  the U layer                       — 1L3T/TCP sheet algs

   Step 1 is IDA* over the 16 native moves in the pre-rotation hold. Steps
   2-4 run in the BENCISCO HOLD (the user's method decision, 2026-07-13):
   the finished first center is held on the BL face and the search emits
   ONLY the ergonomic tokens R / U / Rw / BL — BL turns being the "align
   the white layer" moves (in this hold they are the only way the first
   center can even move: the restricted group seals its slots, so steps
   2-4 can never break step 1). Each of those steps is IDA* over the 8
   hold tokens with the grip tracked (a wide R drifts the hold about the
   R-BL axis, walkParsed semantics); the three R-axis grips are tried as
   free re-grips at each step start, and the displayed segment carries its
   grip's rotation spell ({L,R} / {R,B} / {B,L} from js/tables.js
   makeBLHold — the site's {X,Y} re-orientation brackets, user decision
   2026-07-14).
   Heuristics are max()-combined pattern databases measured in the SAME
   move group (the r* families; min-over-grips, so admissible whatever
   grip the node is in). After step 4 the human rotates back to the sheet
   hold: steps 5-6 finish with the sheets' algs verbatim under TWO
   different matching semantics (see the finish index below): L3T by
   exact state key, LBT by EFFECT — caseStateOf is the single source of
   truth either way, so annotation subtleties (setup-undo closings,
   AUF-short texts, working-slot variants) resolve themselves. A beam of
   the best partial lines is kept across step junctions so early greed
   does not hide a better total (K tunable).

   Color neutrality = whole-puzzle pre-rotation: solving "with a different
   first center" is solving conj_g(scramble) with the fixed-region method.
   conj_g is physical rotation of the sticker arrangement (test-engine's
   conjState); the displayed line starts with that rotation spelled as a
   single {X,Y} bracket, and the engine's 48-hold frame walk reads every later
   letter through it — the init self-check pins that this reading equals the
   conjugation algebra, and every displayed line is re-proved end-to-end by
   applyParsed from the original scramble state (verifyLine; the M5 exit
   gate). Between segments the solver assumes the standard re-grip (each alg
   is read from the recognition hold, i.e. the leading rotation again), which
   verifyLine models by re-prefixing the rotation tokens per segment.

   Movecount-only metrics (family precedent); rotations are free. No global
   optimality is claimed anywhere (FTO God's number is unknown). */

/* ---------- method registry (module-level: no engine dependency) ---------- */
const METHOD_NAME = 'Bencisco';
// caps for t1..c4 are in Bencisco-hold tokens (R/U/Rw/BL each count 1); the
// restricted move group runs deeper than free search did — the coordinate
// eccentricities alone reach 16-17 on the late centers (tables.js r* pins)
const STEP_DEFS = {
  fc:  { name: 'First center',      cap: 12 },
  t1:  { name: 'First triple',      cap: 15 },
  t2:  { name: 'Second triple',     cap: 16 },
  sc:  { name: 'Second center',     cap: 18 },
  c3:  { name: 'Third center',      cap: 20 },
  c4:  { name: 'Last center',       cap: 20 },
  lbt: { name: 'Last bottom triple' },
  l3t: { name: 'Last 3 triples' },
};
const STEP_ORDER = ['fc', 't1', 't2', 'sc', 'c3', 'c4', 'lbt', 'l3t'];
const DEFAULTS = {
  beam: 4, maxSolsPerStep: 3, slack: 0, budget: 1.6e7, stepBudget: 6e5, orient: 'auto',
  // per-step weighted-IDA* factors: 1 = exact; the late center steps run
  // 10+ moves deep, where exact search is intractable. Measured on the hard
  // third-center instances: moderate weights are ~30x faster than exact at
  // <= +1 move, while w>=2.5 is WORSE on both axes (over-pruning re-expands).
  weights: { fc: 1, t1: 1, t2: 1, sc: 1.4, c3: 1.8, c4: 1.8 },
};

function makeSolverCore(E, T, PDB, algData) {
  const FACES = E.FACES, OPPF = E.OPPF, FIDX = E.FIDX;
  const SOLVED = E.solved();
  const SOLVED_KEY = E.stateKey(SOLVED);

  /* ---------- geometry (derived, then asserted) ---------- */
  // hexagon faces and their edge slots come from js/tables.js (same source
  // the PDBs were built from); re-derive from E.EDGES here and assert equal.
  const HEX_FACES = ['D', 'L', 'R', 'B'];
  const HEX_EDGES = {};
  for (const f of HEX_FACES) {
    HEX_EDGES[f] = E.EDGES.map((e, i) => (e[2] === FIDX[f] || e[3] === FIDX[f]) ? i : -1).filter(i => i >= 0);
    if (HEX_EDGES[f].join() !== T.HEX_EDGES[f].join()) throw new Error('hexagon edge set mismatch: ' + f);
  }
  // bottom triples: corner slot -> its two tetrad-A centre slots. Slot 3f+k
  // sits at the vertex reached from face f along axis k with the face's sign.
  const TRIPLE_SLOTS = { 3: [6, 9], 4: [4, 10], 5: [5, 8] };
  for (const c of [3, 4, 5]) {
    const slots = [];
    for (let f = 0; f < 8; f++) {
      if (E.TETRAD[f] !== 0) continue;
      for (let k = 0; k < 3; k++) {
        const v = [0, 1, 2].map(i => i === k ? E.FSIGN[f][k] : 0);
        const vi = E.VAX.findIndex(a => a[0] === v[0] && a[1] === v[1] && a[2] === v[2]);
        if (vi === c) slots.push(3 * f + k);
      }
    }
    if (slots.sort((a, b) => a - b).join() !== TRIPLE_SLOTS[c].join())
      throw new Error('triple slot mismatch at corner ' + c + ': ' + slots);
  }
  const T1_OPTS = [{ corner: 3, aKey: '6,9', cKey: '3' }, { corner: 5, aKey: '5,8', cKey: '5' }];

  /* ---------- the Bencisco hold (steps t1..c4) ---------- */
  // First center on BL, tokens {R, U, Rw, BL} only. The grip/generator table
  // comes from tables.js (same source the r* PDBs were BFS'd with) and is
  // re-proved here against the engine's own reading: tracked token-by-token
  // application must equal applyParsed of the displayed "spell + word" text
  // for every grip — else the search would emit unexecutable lines.
  const BL = T.makeBLHold(E);
  (() => {
    let x = 20260713;
    const rnd = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x80000000; };
    for (let trial = 0; trial < 60; trial++) {
      const j0 = trial % 3;
      let probe = E.solved();
      for (let i = 0; i < 10; i++) probe = E.move(probe, (rnd() * 16) | 0);
      const word = Array.from({ length: 1 + ((rnd() * 6) | 0) }, () => (rnd() * 8) | 0);
      let s = E.copy(probe), j = j0;
      for (const k of word) { const g = BL.gen[j][k]; s = E.move(s, g.m); j = g.nj; }
      const text = BL.SPELLS[j0] + ' ' + word.map(k => BL.TOKS[k]).join(' ');
      if (!E.eq(s, E.applyParsed(E.parseAlg(text), probe)))
        throw new Error('Bencisco-hold reading mismatch at grip ' + j0 + ': ' + text);
    }
  })();

  /* ---------- goal predicates on states ---------- */
  function hexOK(s, f) {
    for (const e of HEX_EDGES[f]) if (s.ep[e] !== e) return false;
    const fi = FIDX[f];
    for (let k = 0; k < 3; k++) if (s.ctr[3 * fi + k] !== fi) return false;
    return true;
  }
  function tripleOK(s, c) {
    if (s.cp[c] !== c || s.co[c] !== 0) return false;
    for (const x of TRIPLE_SLOTS[c]) if (s.ctr[x] !== ((x / 3) | 0)) return false;
    return true;
  }
  const lbtOK = s => tripleOK(s, 4);

  /* ---------- per-stage heuristics (max of admissible PDBs) ---------- */
  // h(s, lim) contract: exact max when it is <= lim; any value > lim may be
  // returned early once ANY component exceeds lim (the DFS only needs to
  // know whether g + w*h clears the bound — early exit skips the expensive
  // 6-edge pair lookups on most pruned nodes). h === 0 stays exact.
  //
  // fc reads the full 16-move-metric H1.D; every other stage reads the r*
  // families, measured in the Bencisco-hold move group itself (min over the
  // three grips, so a lower bound whatever grip the node is in; the 99
  // sentinel marks coordinates the restricted group cannot solve at all,
  // which fails the step instantly instead of burning its node budget).
  const rh1 = (s, f) => PDB.rH1[f][T.h1Index(s.ep, s.ctr, f, HEX_EDGES[f])];
  const bKeyOf = faces => HEX_FACES.filter(f => faces.includes(f)).join('');
  function stageH(stage, line) {
    switch (stage.id) {
      case 'fc': return s => PDB.H1.D[T.h1Index(s.ep, s.ctr, 'D', HEX_EDGES.D)];
      case 't1': {
        const o = stage.opt;
        return (s, lim) => {
          let h = PDB.rC[o.cKey][T.cornerIndex(s.cp, s.co)];
          if (h > lim) return h;
          const d = PDB.rA[o.aKey][T.encA(s.ctr)]; if (d > h) h = d;
          if (h > lim) return h;
          const e = rh1(s, 'D'); return e > h ? e : h;
        };
      }
      case 't2':
        return (s, lim) => {
          let h = PDB.rC['3,5'][T.cornerIndex(s.cp, s.co)];
          if (h > lim) return h;
          const d = PDB.rA['5,6,8,9'][T.encA(s.ctr)]; if (d > h) h = d;
          if (h > lim) return h;
          const e = rh1(s, 'D'); return e > h ? e : h;
        };
      default: {
        // center stages: hexes done so far + the one being solved. The heavy
        // lifters are the one-hexagon EXACT tables and the hexagon-PAIR
        // 6-edge tables — keeping solved hexagons while building another is
        // the real cost, and only combined coordinates see any of it.
        const faces = line.hexes.concat([stage.opt.face]);
        const bt = PDB.rB[bKeyOf(faces)];
        const pairs = [];
        for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
          const key = HEX_FACES.filter(f => f === faces[i] || f === faces[j]).join('');
          pairs.push({ t: PDB.rE6[key], p: T.E6_PAIRS[key] });
        }
        return (s, lim) => {
          let h = PDB.rC['3,5'][T.cornerIndex(s.cp, s.co)];
          if (h > lim) return h;
          let d = PDB.rA['5,6,8,9'][T.encA(s.ctr)]; if (d > h) h = d;
          if (h > lim) return h;
          d = bt[T.encB(s.ctr)]; if (d > h) h = d;
          if (h > lim) return h;
          for (const f of faces) { d = rh1(s, f); if (d > h) h = d; if (h > lim) return h; }
          for (const q of pairs) { d = q.t[T.edgePlaceIndex(s.ep, q.p)]; if (d > h) h = d; if (h > lim) return h; }
          return h;
        };
      }
    }
  }
  function stageGoal(stage, line) {
    switch (stage.id) {
      case 'fc': return s => hexOK(s, 'D');
      case 't1': return s => hexOK(s, 'D') && tripleOK(s, stage.opt.corner);
      case 't2': return s => hexOK(s, 'D') && tripleOK(s, 3) && tripleOK(s, 5);
      default: {
        const faces = line.hexes.concat([stage.opt.face]);
        return s => tripleOK(s, 3) && tripleOK(s, 5) && faces.every(f => hexOK(s, f));
      }
    }
  }

  /* ---------- (weighted) IDA* ---------- */
  // fc searches the 16 native moves; t1..c4 search the 8 Bencisco-hold
  // tokens with the grip tracked. Canonical successor rules: native — never
  // the same face twice in a row, opposite faces commute so only the
  // smaller-index face may come first when adjacent; hold tokens — R, Rw
  // and BL share the R-BL axis and commute pairwise (same-axis layers), so
  // a same-axis run is forced strictly ascending in the order R < Rw < BL,
  // and U never follows U. weight > 1 makes the pruning inadmissible
  // (weighted IDA*): solutions are then near-optimal, found exponentially
  // faster — the later center steps run 10+ moves deep where exact search
  // is intractable, and the port plan promises optimal OR near-optimal per
  // step. Found solutions are always goal-checked.
  const work = { nodes: 0, budget: DEFAULTS.budget, limit: Infinity, stopped: false, truncated: false };
  // preallocated per-depth node buffers: the DFS writes each child into its
  // depth's buffer instead of allocating — no GC pressure in the hot loop
  // (single-threaded, non-reentrant; sols copy what they keep)
  const TBLM = E.moveTables;
  const STACK = [];
  function stackNode(d) {
    while (STACK.length <= d)
      STACK.push({ cp: new Array(6), co: new Array(6), ep: new Array(12), ctr: new Array(24) });
    return STACK[d];
  }
  function moveInto(m, s, o) {
    const t = TBLM[m];
    for (let v = 0; v < 6; v++) { o.cp[v] = s.cp[t.cperm[v]]; o.co[v] = s.co[t.cperm[v]] ^ t.cflip[v]; }
    for (let e = 0; e < 12; e++) o.ep[e] = s.ep[t.eperm[e]];
    for (let x = 0; x < 24; x++) o.ctr[x] = s.ctr[t.xperm[x]];
  }
  function dfs(s, g, bound, lastFace, goal, h, w, path, sols, maxSols) {
    if (++work.nodes > work.limit) {
      work.stopped = true;
      if (work.nodes > work.budget) work.truncated = true;
      return;
    }
    const lim = (bound - g) / w;
    const hh = h(s, lim);
    if (hh > lim + 1e-9) return;
    // goal check at ANY depth: with w > 1 a solution shorter than the bound
    // is only reachable at a higher bound, so a g === bound gate would walk
    // straight past solved states and never record them
    if (hh === 0 && goal(s)) { sols.push({ moves: path.slice(), st: E.copy(s) }); return; }
    if (g === bound) return;
    const t = stackNode(g);
    for (let f = 0; f < 8; f++) {
      if (f === lastFace) continue;
      if (OPPF[f] === lastFace && f > lastFace) continue;
      for (let d = 0; d < 2; d++) {
        const m = 2 * f + d;
        moveInto(m, s, t);
        path.push(m);
        dfs(t, g + 1, bound, f, goal, h, w, path, sols, maxSols);
        path.pop();
        if (work.stopped || sols.length >= maxSols) return;
      }
    }
  }
  // the Bencisco-hold DFS: nodes are (state, grip); path records token
  // indices into BL.TOKS. Only the wide tokens change grip. lastAxis 0 with
  // lastRank r = inside an R-axis run (next same-axis token needs rank > r);
  // lastAxis 1 = just turned U (U may not repeat).
  function dfsBL(s, j, g, bound, lastAxis, lastRank, goal, h, w, path, sols, maxSols) {
    if (++work.nodes > work.limit) {
      work.stopped = true;
      if (work.nodes > work.budget) work.truncated = true;
      return;
    }
    const lim = (bound - g) / w;
    const hh = h(s, lim);
    if (hh > lim + 1e-9) return;
    if (hh === 0 && goal(s)) { sols.push({ moves: path.slice(), st: E.copy(s) }); return; }
    if (g === bound) return;
    const t = stackNode(g);
    for (let k = 0; k < 8; k++) {
      const ax = BL.AXIS[k];
      if (ax === lastAxis && (ax === 1 || BL.RANK[k] <= lastRank)) continue;
      const gen = BL.gen[j][k];
      moveInto(gen.m, s, t);
      path.push(k);
      dfsBL(t, gen.nj, g + 1, bound, ax, BL.RANK[k], goal, h, w, path, sols, maxSols);
      path.pop();
      if (work.stopped || sols.length >= maxSols) return;
    }
  }
  // stepBudget bounds THIS call's nodes: a pathological instance fails fast
  // (killing one line-option) instead of starving the whole solve. On a
  // budget stop with nothing found, one retry at a higher weight rescues
  // most hard instances (heavier pruning finds a slightly longer answer).
  // blMode runs the hold DFS from all three grips per bound (re-grips about
  // the R-BL axis are free between steps); each solution records its grip.
  function searchStep(start, goal, h, cap, maxSols, slack, weight, stepBudget, blMode) {
    if (goal(start)) return [{ moves: [], st: E.copy(start), j0: 0 }];
    const attempt = (w, budget) => {
      // with w > 1 a length-L solution may only survive the weighted pruning
      // at bounds up to ~w*L, so the bound iterates past the length cap
      work.limit = Math.min(work.budget, work.nodes + budget);
      work.stopped = false;
      const boundCap = Math.ceil(cap * w);
      const sols = [];
      const run = bound => {
        if (!blMode) { dfs(start, 0, bound, -1, goal, h, w, [], sols, maxSols); return; }
        for (let j0 = 0; j0 < 3 && !work.stopped && sols.length < maxSols; j0++) {
          const before = sols.length;
          dfsBL(start, j0, 0, bound, -1, -1, goal, h, w, [], sols, maxSols);
          for (let i = before; i < sols.length; i++) sols[i].j0 = j0;
        }
      };
      let bound = Math.max(1, h(start, Infinity));
      for (; bound <= boundCap && !sols.length && !work.stopped; bound++) run(bound);
      if (slack > 0 && sols.length && sols.length < maxSols && bound <= boundCap && !work.stopped)
        run(bound);                            // one extra depth
      // dedupe repeat finds: a U-less token word reads identically at every
      // grip (grip 0, the shortest spell, wins), and the slack depth re-finds
      // the shorter solutions on its way down
      const seen = new Set();
      const out = [];
      for (const x of sols) {
        if (x.moves.length > cap) continue;
        const k = x.moves.join(',') + '|' + E.stateKey(x.st);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(x);
      }
      return out;
    };
    const w = weight || 1;
    const budget = stepBudget || Infinity;
    let sols = attempt(w, budget);
    if (!sols.length && work.stopped && !work.truncated)
      sols = attempt(w + 0.6, 2 * budget);     // rescue: prune much harder
    return sols;
  }

  /* ---------- the sheet-alg finish index (LBT, then L3T incl. TCP) ---------- */
  // Two different matching semantics, both machine-derived from the M3 data:
  //
  // L3T (last step, NOTHING else unsolved): exact stateKey -> [entry] lookup.
  // caseStateOf(text) is the one state a text exactly solves, so an exact hit
  // guarantees applyParsed(text, junction) === solved. {ε,U,U'} pre- and
  // trailing AUF variants are indexed as insurance (prio>0, only used when
  // no verbatim text matches).
  //
  // LBT (a mid-solve step): matching by EFFECT, not by state. The sheet's 95
  // cases pin only the LBT-relevant features (the corner-4 piece and the two
  // source triangles); the rest of the top layer is a DON'T-CARE, and a real
  // junction's top arrangement almost never coincides with an alg's one
  // exact case state — key matching would miss nearly always (measured). So
  // each LBT entry carries its precomputed effect table; at the junction an
  // entry applies iff applyTable(effect, junction) lands in the L3T index
  // (or on solved) — that one test IS both the correctness proof and the
  // guarantee that the next stage succeeds. A cheap prefilter (where the
  // entry expects the corner-4 piece) skips most of the ~360 candidates.
  //
  // LBT texts: the 21 noted setup-undo algs are indexed and DISPLAYED with
  // their machine-verified closing token appended (as printed they end one
  // wide/slice turn short of solved — a solver may not emit non-solving
  // lines). {ε,U,U'} pre-AUFs bring back-top corners into the sheet's view
  // (the flank displacement flows into the 1L3T odd cases — the sheet's own
  // design).
  const AUFS = ['', 'U', "U'"];
  let _finish = null;
  function finishIndex() {
    if (_finish) return _finish;
    _finish = { lbt: [], l3t: new Map() };
    const subsets = (algData && algData.subsets) || {};
    const undoTok = note => { const m = /append (\S+) \(machine-verified\)/.exec(note || ''); return m ? m[1] : null; };
    for (const [subKey, sub] of Object.entries(subsets)) {
      const step = subKey === 'LBT' ? 'lbt' : (subKey === '1L3T' || subKey === 'TCP') ? 'l3t' : null;
      if (!step || !sub.cases) continue;
      const dialect = sub.notation || 'cif';
      for (const c of sub.cases) for (const a of c.algs || []) {
        const closing = step === 'lbt' ? undoTok(a.note) : null;
        const base = closing ? a.alg + ' ' + closing : a.alg;
        const trails = step === 'l3t' ? AUFS : [''];
        for (const pre of AUFS) for (const trail of trails) {
          const text = [pre, base, trail].filter(Boolean).join(' ');
          const cs = E.caseStateOf(text, dialect);
          if (!cs) continue;                     // unparseable variant: skip
          const key = E.stateKey(cs);
          if (key === SOLVED_KEY) continue;      // never index a no-op
          const entry = {
            step, text, dialect, moves: E.countMoves(E.parseAlg(text)),
            subset: subKey, caseName: c.name,
            note: [closing && 'setup undo appended', pre && 'pre-AUF', trail && 'final AUF appended',
                   a.note && !closing ? a.note : null].filter(Boolean).join('; ') || null,
            prio: (pre ? 1 : 0) + (trail ? 1 : 0) + (subKey === 'TCP' ? 0.5 : 0),
          };
          if (step === 'l3t') {
            let list = _finish.l3t.get(key);
            if (!list) { list = []; _finish.l3t.set(key, list); }
            list.push(entry);
          } else {
            entry.table = E.effectTable(E.parseAlg(text), dialect);
            entry.srcSlot = cs.cp.indexOf(4);    // where the text expects the LBT piece
            entry.srcFlip = cs.co[entry.srcSlot];
            _finish.lbt.push(entry);
          }
        }
      }
    }
    for (const list of _finish.l3t.values())
      list.sort((x, y) => x.prio - y.prio || x.moves - y.moves || (x.text < y.text ? -1 : 1));
    _finish.lbt.sort((x, y) => x.prio - y.prio || x.moves - y.moves || (x.text < y.text ? -1 : 1));
    return _finish;
  }
  // LBT candidates for a junction: entries whose effect lands in the L3T
  // case space (or on solved), best-first, deduped by landing state
  function lbtCandidates(fin, st) {
    const p4 = st.cp.indexOf(4), f4 = st.co[p4];
    const out = [];
    const landed = new Set();
    for (const en of fin.lbt) {
      if (en.srcSlot !== p4 || en.srcFlip !== f4) continue;
      const post = E.applyTable(en.table, st);
      const key = E.stateKey(post);
      if (key !== SOLVED_KEY && !fin.l3t.has(key)) continue;
      if (landed.has(key)) continue;
      landed.add(key);
      out.push({ en, post, postKey: key });
      if (out.length >= 3) break;                // entries are best-first
    }
    return out;
  }

  /* ---------- orientations: conjugation + {X,Y} bracket spelling ---------- */
  function conjState(M, s) {                    // physical rotation of the arrangement
    const F = E.toFacelets(s), P = E.rotFaceletPerm(M), F2 = new Array(72);
    for (let i = 0; i < 72; i++) F2[i] = E.faceImg(M, F[P[i]]);
    return E.fromFacelets(F2);
  }
  // spell every CIF hold as one {X,Y} re-orientation bracket (the site's
  // rotation convention, user decision 2026-07-14): from the identity hold
  // the bracket's letters ARE the faces the hold puts at U and F, so the
  // spell is direct — one token per re-orientation, identity spells empty.
  // Each spell is re-proved through the engine's own hold walk.
  const SPELL_BY_HOLD = (() => {
    const seen = new Map();                     // hold key -> spell
    const holdOf = spell => E.walkParsed(E.parseAlg(spell), () => {});
    for (const M of E.ROT24) {
      const hold = [0, 1, 2, 3, 4, 5, 6, 7].map(p => E.faceImg(E.mInv(M), p));
      const spell = (hold[0] === FIDX.U && hold[1] === FIDX.F)
        ? '' : '{' + FACES[hold[0]] + ',' + FACES[hold[1]] + '}';
      if (spell && holdOf(spell).join(',') !== hold.join(','))
        throw new Error('bracket spell does not reproduce its hold: ' + spell);
      seen.set(hold.join(','), spell);
    }
    if (seen.size !== 24) throw new Error('rotation spelling: expected 24 holds, got ' + seen.size);
    return seen;
  })();
  // ORIENTS[i] = { M, spell } such that executing `spell` then reading plain
  // face letters equals conjugating the state by M first (pinned below).
  const ORIENTS = E.ROT24.map(M => {
    const hold = [0, 1, 2, 3, 4, 5, 6, 7].map(p => E.faceImg(E.mInv(M), p));
    const spell = SPELL_BY_HOLD.get(hold.join(','));
    if (spell === undefined) throw new Error('no spelling for rotation hold ' + hold);
    return { M, spell };
  });
  // init self-check: the engine's frame-walk reading of "spell + letters"
  // must equal the conjugation algebra, for every orientation (else the
  // sweep would emit unexecutable lines — fail loudly at load, not per line).
  (() => {
    let probe = E.solved();
    for (const m of [0, 5, 12, 9, 3, 14]) probe = E.move(probe, m);
    const seq = [2 * FIDX.U, 2 * FIDX.F + 1, 2 * FIDX.BR];
    const letters = seq.map(m => E.MOVES[m]).join(' ');
    for (const o of ORIENTS) {
      let a = conjState(o.M, probe);
      for (const m of seq) a = E.move(a, m);
      const b = conjState(E.mInv(o.M), a);      // back to the un-rotated frame
      const c = E.applyParsed(E.parseAlg((o.spell + ' ' + letters).trim()), probe);
      if (!E.eq(b, c)) throw new Error('orientation reading mismatch for spell "' + o.spell + '"');
    }
  })();
  const ORIENT_SETS = {
    fixed: () => [ORIENTS.findIndex(o => o.spell === '')],
    vertical: () => ORIENTS.map((o, i) => (E.faceImg(o.M, FIDX.U) === FIDX.U ? i : -1)).filter(i => i >= 0),
    full: () => ORIENTS.map((_, i) => i),
  };

  /* ---------- the pipeline ---------- */
  function centerOptions(line) {
    return HEX_FACES.filter(f => f !== 'D' && !line.hexes.includes(f)).map(face => ({ face }));
  }
  function stagesFor(line, stageId) {
    switch (stageId) {
      case 'fc': return [{ id: 'fc', opt: {} }];
      case 't1': return T1_OPTS.map(opt => ({ id: 't1', opt }));
      case 't2': return [{ id: 't2', opt: T1_OPTS.find(o => o.corner !== line.t1corner) }];
      case 'sc': case 'c3': case 'c4':
        return centerOptions(line).map(opt => ({ id: stageId, opt }));
      default: throw new Error('unknown stage ' + stageId);
    }
  }
  const stepLabel = (stage) => {
    if (stage.id === 'fc') return STEP_DEFS.fc.name + ' (D)';
    if (stage.id === 't1' || stage.id === 't2')
      return STEP_DEFS[stage.id].name + ' (corner ' + (stage.opt.corner === 3 ? 'back' : 'right') + ')';
    return STEP_DEFS[stage.id].name + ' (' + stage.opt.face + ')';
  };

  // search(state, opts) -> { byLength, best, truncated, work, failures, orientUsed }
  // opts: { orient:'auto'|'fixed'|'vertical'|'full'|[rotIdx], beam, caps:{id:int},
  //         slack, budget, stepBudget, weights, maxSolsPerStep }
  // 'auto' (default) is a ladder: the fixed frame solves ~24/25 scrambles in
  // a few seconds; the rare LBT source dead-ends (both source triangles
  // trapped on side slots no sheet alg reaches — measured) are retried with
  // the vertical pre-rotations, then a trimmed full 24-orientation sweep.
  function search(scr, opts) {
    opts = opts || {};
    const orientOpt = opts.orient || DEFAULTS.orient;
    if (orientOpt === 'auto') {
      const carry = (into, from) => {
        into.failures.lbt += from.failures.lbt; into.failures.l3t += from.failures.l3t;
        into.failures.step += from.failures.step; into.verifyFailures += from.verifyFailures;
        return into;
      };
      let res = search(scr, { ...opts, orient: 'fixed' });
      if (res.best == null) res = carry(search(scr, { ...opts, orient: 'vertical' }), res);
      if (res.best == null) res = carry(search(scr, { ...opts, orient: 'full', beam: 2, maxSolsPerStep: 2 }), res);
      return res;
    }
    const caps = {};
    for (const id of ['fc', 't1', 't2', 'sc', 'c3', 'c4'])
      caps[id] = Number.isFinite(opts.caps && opts.caps[id]) ? opts.caps[id] : STEP_DEFS[id].cap;
    const beam = opts.beam || DEFAULTS.beam;
    const maxSols = opts.maxSolsPerStep || DEFAULTS.maxSolsPerStep;
    const slack = Number.isFinite(opts.slack) ? opts.slack : DEFAULTS.slack;
    const weights = Object.assign({}, DEFAULTS.weights, opts.weights || {});
    const stepBudget = opts.stepBudget || DEFAULTS.stepBudget;
    const orientIdxs = Array.isArray(opts.orient)
      ? opts.orient : ORIENT_SETS[opts.orient || DEFAULTS.orient]();
    // the node budget is per orientation — a sweep multiplies the work
    work.nodes = 0; work.budget = (opts.budget || DEFAULTS.budget) * orientIdxs.length;
    work.limit = Infinity; work.stopped = false; work.truncated = false;
    const failures = { lbt: 0, l3t: 0, step: 0 };
    const fin = finishIndex();
    const done = [];

    for (const oi of orientIdxs) {
      const o = ORIENTS[oi];
      let frontier = [{
        st: o.spell ? conjState(o.M, scr) : E.copy(scr),
        segs: [], moves: 0, hexes: ['D'], t1corner: 0, rotIdx: oi,
      }];
      const memo = new Map();                    // stage+opt+state -> step solutions
      for (const stageId of ['fc', 't1', 't2', 'sc', 'c3', 'c4']) {
        // the LAST center decides the LBT junction: enumerate more (and one
        // move longer) alternatives there — distinct landings are what give
        // the sheet-corridor its hit probability, and c4 searches are cheap
        const stageSols = stageId === 'c4' ? Math.max(maxSols, 8) : maxSols;
        const stageSlack = stageId === 'c4' ? Math.max(slack, 1) : slack;
        const next = [];
        for (const line of frontier) {
          for (const stage of stagesFor(line, stageId)) {
            const mk = stageId + '|' + JSON.stringify(stage.opt) + '|' + line.hexes.join('') + '|' + E.stateKey(line.st);
            let sols = memo.get(mk);
            if (!sols) {
              sols = searchStep(line.st, stageGoal(stage, line), stageH(stage, line),
                caps[stageId], stageSols, stageSlack, weights[stageId], stepBudget,
                stageId !== 'fc');           // t1..c4 run in the Bencisco hold
              memo.set(mk, sols);
            }
            if (!sols.length) { failures.step++; continue; }
            for (const sol of sols) {
              // fc emits native letters in the pre-rotation hold; t1..c4 emit
              // Bencisco-hold tokens with the grip's rotation spell as `pre`
              const seg = !sol.moves.length ? null : stageId === 'fc'
                ? { id: stage.id, kind: 'search', label: stepLabel(stage),
                    text: sol.moves.map(m => E.MOVES[m]).join(' '), moves: sol.moves.length }
                : { id: stage.id, kind: 'search', label: stepLabel(stage),
                    text: sol.moves.map(k => BL.TOKS[k]).join(' '), moves: sol.moves.length,
                    pre: BL.SPELLS[sol.j0] };
              next.push({
                st: sol.st,
                segs: seg ? line.segs.concat([seg]) : line.segs.slice(),
                moves: line.moves + sol.moves.length,
                hexes: (stageId === 'sc' || stageId === 'c3' || stageId === 'c4')
                  ? line.hexes.concat([stage.opt.face]) : line.hexes,
                t1corner: stageId === 't1' ? stage.opt.corner : line.t1corner,
                rotIdx: line.rotIdx,
              });
            }
          }
        }
        // trim: dedupe same-state same-length lines, keep the best K — but
        // after c4 keep every distinct landing (finishes are cheap lookups,
        // and junction diversity is what beats LBT source dead-ends)
        const keep = stageId === 'c4' ? beam * 6 : beam;
        next.sort((a, b) => a.moves - b.moves);
        const seen = new Set();
        frontier = [];
        for (const l of next) {
          const k = E.stateKey(l.st) + '|' + l.moves;
          if (seen.has(k)) continue;
          seen.add(k);
          frontier.push(l);
          if (frontier.length >= keep) break;
        }
        if (!frontier.length) break;
      }

      // finishes: LBT by effect-matching, then L3T by exact lookup
      for (const line of frontier) {
        let cands = [line];
        // LBT
        const next = [];
        for (const l of cands) {
          const key = E.stateKey(l.st);
          if (key === SOLVED_KEY || lbtOK(l.st)) { next.push(l); continue; }
          const hits = lbtCandidates(fin, l.st);
          if (!hits.length) { failures.lbt++; continue; }
          for (const hit of hits.slice(0, 2))
            next.push({ ...l, st: hit.post, moves: l.moves + hit.en.moves,
              segs: l.segs.concat([segOfEntry(hit.en)]) });
        }
        cands = next;
        // L3T
        for (const l of cands) {
          const key = E.stateKey(l.st);
          if (key === SOLVED_KEY) { done.push(l); continue; }
          const entries = fin.l3t.get(key);
          if (!entries) { failures.l3t++; continue; }
          for (const en of entries.slice(0, 2)) {
            const st2 = E.applyParsed(E.parseAlg(en.text), l.st, en.dialect);
            if (E.stateKey(st2) !== SOLVED_KEY) continue;   // cannot happen (indexed by caseStateOf)
            done.push({ ...l, st: st2, moves: l.moves + en.moves,
              segs: l.segs.concat([segOfEntry(en)]) });
          }
        }
      }
    }

    // verify + bucket by total movecount
    const byLength = {};
    let verifyFailures = 0;
    const seenLine = new Set();
    for (const l of done) {
      const item = {
        total: l.moves, rotIdx: l.rotIdx, rotSpell: ORIENTS[l.rotIdx].spell,
        segs: l.segs, ok: false,
      };
      const lineKey = item.rotSpell + '|' + l.segs.map(s => (s.pre ? s.pre + '~' : '') + s.text).join('|');
      if (seenLine.has(lineKey)) continue;
      seenLine.add(lineKey);
      item.ok = verifyLine(scr, item);
      if (!item.ok) {
        // never emit an unproved line; debug surfaces what was dropped
        if (opts.debug) console.log('[solver debug] verify fail: '
          + JSON.stringify(item.segs.map(s => ({ id: s.id, pre: s.pre, text: s.text }))));
        verifyFailures++; continue;
      }
      (byLength[item.total] = byLength[item.total] || []).push(item);
    }
    for (const L of Object.keys(byLength))
      byLength[L].sort((a, b) => (a.rotSpell ? 1 : 0) - (b.rotSpell ? 1 : 0)
        || a.segs.length - b.segs.length
        || (lineText(a) < lineText(b) ? -1 : 1));
    const lens = Object.keys(byLength).map(Number).sort((a, b) => a - b);
    return { byLength, best: lens.length ? lens[0] : null,
             truncated: work.truncated, work: work.nodes, failures, verifyFailures,
             orientUsed: Array.isArray(orientOpt) ? 'custom' : orientOpt };
  }
  function segOfEntry(en) {
    return { id: en.step, kind: 'alg', label: STEP_DEFS[en.step].name, dialect: en.dialect,
             text: en.text, moves: en.moves, subset: en.subset, caseName: en.caseName, note: en.note };
  }
  const lineText = it => [it.rotSpell, ...it.segs.map(s => (s.pre ? s.pre + ' ' : '') + s.text)]
    .filter(Boolean).join(' ');

  /* ---------- the per-line proof (every displayed line, end to end) ---------- */
  // Executes the DISPLAYED text through the engine from the original
  // scramble state: the leading rotation — plus the segment's own hold spell
  // for the Bencisco-hold steps — is re-prefixed per segment (the human
  // re-grips to the recognition hold between algorithms — rotations have no
  // state effect, they only set the reading frame), and the final state must
  // be EXACTLY solved. Any false here means a bug upstream.
  function verifyLine(scr, item) {
    try {
      let st = E.copy(scr);
      for (const seg of item.segs) {
        const parsed = E.parseAlg(((item.rotSpell ? item.rotSpell + ' ' : '')
          + (seg.pre ? seg.pre + ' ' : '') + seg.text).trim());
        if (!parsed) return false;
        // seg dialects are all cif today; a future EIF sheet would need its
        // own rotation-prefix reading pinned before it may join the sweep
        st = E.applyParsed(parsed, st, seg.dialect || 'cif');
      }
      return E.eq(st, SOLVED);
    } catch (e) { return false; }
  }

  // standalone searchStep callers (tests, lab) manage the budget themselves
  function resetWork(budget) {
    work.nodes = 0; work.limit = Infinity; work.stopped = false; work.truncated = false;
    if (budget) work.budget = budget;
  }

  return {
    METHOD_NAME, STEP_DEFS, STEP_ORDER, DEFAULTS, BL,
    HEX_FACES, HEX_EDGES, TRIPLE_SLOTS,
    hexOK, tripleOK, lbtOK,
    searchStep, stageH, stageGoal, resetWork, work,
    finishIndex, lbtCandidates, conjState, ORIENTS, ORIENT_SETS,
    search, verifyLine, lineText,
  };
}
if (typeof module !== 'undefined') module.exports = { makeSolverCore, METHOD_NAME, STEP_DEFS, STEP_ORDER, DEFAULTS };
window.OOSolverCore=module.exports;})();
