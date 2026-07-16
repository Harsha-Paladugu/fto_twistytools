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

   Step 1 is IDA* over the 16 native moves in the pre-rotation hold, and
   the pre-rotation ALWAYS maps the WHITE material onto the method's D
   region (user spec 2026-07-14): the solve builds the white center first,
   every time. Steps 2-4 run in the BENCISCO HOLD (user decisions
   2026-07-13/14): the finished white center is held on the BL face.
   The TRIPLE steps (t1/t2) emit R / U / Rw tokens (user refinement
   2026-07-14: "I want the triples to be solved with R U Rw moves") and
   may re-grip for FREE mid-word — a rotation about the R-BL axis, fused
   to the U turn that needs it and printed as one {X,Y} bracket ({F,BR}
   or {BR,U}); the canonicalization bans every Rw<->BL adjacency, so a
   re-grip can never be spelled as a redundant token pair like Rw BL'
   (user report 2026-07-14: rotate instead). The CENTER steps (sc/c3/c4)
   run the RESTRICTED triple-preserving system (user spec 2026-07-16,
   the Centers trainer's contract applied to the solver): once the
   triples are in, nothing may ever take them out of place and no
   mid-solve rotations happen — the center alphabet is exactly
   {R, U, Rw} from the ONE aligned grip (PDB.C23.RES.j0). The theorem
   (machine-derived and init-asserted in tables.js makeRestricted,
   re-asserted against this hold table below): the solved block (white
   hexagon + both triples) is fixed by engine U± and by exactly one
   working {L,R,B}± face per block position, engine D± moves it rigidly
   to D^b(home), and Rw's grip drift tracks b exactly — so from the
   aligned grip the plain U token is ALWAYS the safe working face, while
   BL or a mid-word re-grip would misalign grip and block (the very next
   U would rip a triple). Every alphabet stays inside the sealed move
   group, so steps 2-4 physically cannot break the first center. Each
   hold step is IDA* with the grip tracked (a wide R drifts the hold
   about the R-BL axis, walkParsed semantics); the TRIPLE steps try all
   three R-axis grips as free re-grips at step start, the CENTER steps
   start only from the aligned grip — and since every center goal puts
   the white center exactly home, the net drift of a center word is 0:
   the grip returns to the aligned one at every center junction, so the
   center stage never re-grips between its steps either. The search
   anchors grips at the recognition hold ({L,R} / {R,B} / {B,L},
   js/tables.js makeBLHold), but the DISPLAYED segment carries a RELATIVE
   re-grip: the one {X,Y} bracket, read at the hold the previous tokens
   actually leave (wide drift included), that lands the segment's grip —
   or nothing when the human is already holding it right (respellLine;
   physical-loop finding, user 2026-07-14). Heuristics are max()-combined
   pattern databases: the triple steps read the r* families, measured in
   the sealed group's own 10-native-move metric — EXACTLY the token
   metric once re-grips are free (each of engine {U,D,L,R,B}± is one
   token from every grip); the center steps read the C23 bundle's EXACT
   (cell x drift) tables in their own restricted metric (the same tables
   the Centers trainer targets with, so the solver's center segments are
   per-step OPTIMAL within the restricted move set); 99 =
   restricted-unsolvable, an instant fail. After step 4 the human rotates
   back to the sheet hold: steps 5-6 finish with the sheets' algs verbatim
   under TWO different matching semantics (see the finish index below):
   L3T by exact state key, LBT by EFFECT — caseStateOf is the single
   source of truth either way, so annotation subtleties (setup-undo
   closings, AUF-short texts, working-slot variants) resolve themselves.
   A beam of the best partial lines is kept across step junctions so early
   greed does not hide a better total (K tunable).

   There is NO color neutrality (user spec 2026-07-14: white first, every
   time). The whole-puzzle pre-rotation freedom is exactly the 3 spins
   about the white axis — the rotations mapping engine U to engine D,
   spelled {D,L} / {D,R} / {D,B} — which re-anchor WHICH triples/centers
   the method meets when (the LBT dead-end rescue). conj_g is physical
   rotation of the sticker arrangement (test-engine's conjState); the
   displayed line starts with that rotation spelled as a single {X,Y}
   bracket, and the engine's 48-hold frame walk reads every later letter
   through it — the init self-check pins that this reading equals the
   conjugation algebra. The whole printed line is ONE CONTINUOUS engine
   text: junction re-grips (including the ones compensating wide-move hold
   drift) are printed explicitly as relative {X,Y} brackets, and verifyLine
   re-proves the exact flat text end-to-end by applyParsed from the original
   scramble state (the M5 exit gate) — what you read is what you turn.

   Movecount-only metrics (family precedent); rotations are free. No global
   optimality is claimed anywhere (FTO God's number is unknown). */

/* ---------- method registry (module-level: no engine dependency) ---------- */
const METHOD_NAME = 'Bencisco';
// caps for t1..c4 are in Bencisco-hold tokens (each turn counts 1; the
// triples' re-grips are free rotations); the triple-preserving center
// system runs deeper than free search did — the (cell x drift) coordinate
// eccentricities reach 16-18 (C23 bundle pins, tools/test-trainer.mjs) and
// an adversarial measurement over 20k+ exact per-face c3 searches found
// real junctions needing EXACTLY 20 (never more). The center caps carry
// +4 headroom over that observed worst: with w = 1 the bound loop stops
// at the first solution depth, so a generous cap costs nothing until a
// step is genuinely deep — exactly when it must not silently die.
const STEP_DEFS = {
  fc:  { name: 'First center',      cap: 12 },
  t1:  { name: 'First triple',      cap: 15 },
  t2:  { name: 'Second triple',     cap: 16 },
  sc:  { name: 'Second center',     cap: 21 },
  c3:  { name: 'Third center',      cap: 24 },
  c4:  { name: 'Last center',       cap: 24 },
  lbt: { name: 'Last bottom triple' },
  l3t: { name: 'Last 3 triples' },
};
const STEP_ORDER = ['fc', 't1', 't2', 'sc', 'c3', 'c4', 'lbt', 'l3t'];
const DEFAULTS = {
  beam: 4, maxSolsPerStep: 3, slack: 0, budget: 1.6e7, stepBudget: 6e5, orient: 'auto',
  // per-step weighted-IDA* factors: 1 = exact. The center steps went back
  // to exact with the 2026-07-16 restricted metric: its (cell x drift)
  // tables are so tight the old deep-center blowup vanished (the sealed
  // 1.4/1.8 weights and their ~30x-at-+1-move trade are retired with it;
  // the higher-weight rescue retry in searchStep still backstops
  // pathological instances).
  weights: { fc: 1, t1: 1, t2: 1, sc: 1, c3: 1, c4: 1 },
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
  // First center on BL. Two modes over the same grip machinery: the TRIPLE
  // steps use {R, U, Rw} (user spec 2026-07-14: "solve the triples with
  // R U Rw") and may re-grip for free mid-word, fused to the U turn that
  // needs it (the search's composite codes below); the CENTER steps use
  // the RESTRICTED triple-preserving {R, U, Rw} system (user spec
  // 2026-07-16) — no BL, no composites, started ONLY from the aligned
  // grip, so the solved triples can never leave their place mid-word. The
  // grip/generator table comes from tables.js (same source the PDBs were
  // BFS'd with) and is re-proved here against the engine's own reading:
  // tracked token-by-token application must equal applyParsed of the
  // displayed "spell + word" text for every grip — else the search would
  // emit unexecutable lines.
  const BL = T.makeBLHold(E);
  const TRIPLE_TOKS = [0, 1, 2, 3, 4, 5];         // R R' U U' Rw Rw'
  // mode.regripCost: a composite's SEARCH cost (its displayed movecount is
  // always 1 — the fused U turn; rotations are free in the metric). The
  // extra unit is a reading penalty: plain spellings win unless a re-grip
  // saves a real move, which keeps the words mostly rotation-free (the
  // measured rate is ~0.7 mid-word re-grips per triple; raising the cost
  // to 3 halves the rate but was measured to cost ~2.5 moves per solve
  // through the junction cascade — a bad trade).
  // NOTE pure {R,U,Rw} cannot re-grip at all (net grip drift and net
  // engine-D power are locked together through Rw), so the composites must
  // stay AVAILABLE in triple mode for full reachability. In center mode
  // that same lock is the POINT: drift tracks the block position, keeping
  // the plain U token triple-safe forever (mode.restricted disables the
  // composites and pins the start grip).
  const MODES = {
    center: { toks: TRIPLE_TOKS, restricted: true },
    triple: { toks: TRIPLE_TOKS, bl: false, regripCost: 2 },
  };
  // mid-word re-grips: the single {X,Y} bracket, read at grip j's hold,
  // that lands grip t — the same relative-bracket convention respellLine
  // applies at segment junctions. ({F,BR} spins forward, {BR,U} backward —
  // the same letters at every grip; pinned in tools/test-solver.mjs.)
  const REGRIP = BL.holds.map((hj, j) => BL.holds.map((ht, t) => t === j ? ''
    : '{' + FACES[hj.indexOf(ht[0])] + ',' + FACES[hj.indexOf(ht[1])] + '}'));
  // path codes: 0..7 index BL.TOKS; 100 + 2t + d is "re-grip to grip t,
  // then U (d=0) / U' (d=1)" — the free rotation fused to the hold-U turn
  // that needs it. pathToText renders a code word started at grip j0 into
  // the exact token stream a human reads; pathStep is the tracked
  // application the init check below proves equal to the engine's own
  // reading of that text.
  function pathToText(j0, moves) {
    let j = j0;
    const out = [];
    for (const k of moves) {
      if (k >= 100) {
        const t = (k - 100) >> 1;
        out.push(REGRIP[j][t], BL.TOKS[2 + ((k - 100) & 1)]);
        j = t;
      } else {
        out.push(BL.TOKS[k]);
        j = BL.gen[j][k].nj;
      }
    }
    return { text: out.join(' '), jEnd: j };
  }
  const pathStep = (j, k) => k >= 100
    ? { m: BL.gen[(k - 100) >> 1][2 + ((k - 100) & 1)].m, nj: (k - 100) >> 1 }
    : BL.gen[j][k];
  (() => {
    for (let j = 0; j < 3; j++) for (let t = 0; t < 3; t++) {
      if (t === j) continue;
      const end = E.walkParsed(E.parseAlg(BL.SPELLS[j] + ' ' + REGRIP[j][t]), () => {});
      if (end.join(',') !== BL.holds[t].join(','))
        throw new Error('re-grip bracket does not land its grip: ' + REGRIP[j][t]);
    }
    let x = 20260713;
    const rnd = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x80000000; };
    for (let trial = 0; trial < 60; trial++) {
      const j0 = trial % 3;
      let probe = E.solved();
      for (let i = 0; i < 10; i++) probe = E.move(probe, (rnd() * 16) | 0);
      let s = E.copy(probe), j = j0;
      const word = [];
      for (let n = 1 + ((rnd() * 6) | 0); n > 0; n--) {
        let k;
        if (rnd() < 0.25) {                    // a re-grip fused to a U turn
          let t = (rnd() * 3) | 0; if (t === j) t = (t + 1) % 3;
          k = 100 + 2 * t + ((rnd() * 2) | 0);
        } else k = (rnd() * 8) | 0;
        const g = pathStep(j, k);
        s = E.move(s, g.m); j = g.nj;
        word.push(k);
      }
      const pt = pathToText(j0, word);
      if (pt.jEnd !== j) throw new Error('pathToText grip walk diverged');
      const text = BL.SPELLS[j0] + ' ' + pt.text;
      if (!E.eq(s, E.applyParsed(E.parseAlg(text), probe)))
        throw new Error('Bencisco-hold reading mismatch at grip ' + j0 + ': ' + text);
    }
  })();
  // the restricted center machinery (user spec 2026-07-16): the center
  // steps read the trainer's C23 bundle — assert it is present and that
  // its aligned-grip/working-face theorem matches THIS hold table (the
  // coupling the restricted search relies on: from grip j0+b the plain U
  // token reads the one face that cannot touch the triples when the block
  // sits at D^b(home))
  if (!PDB.C23 || !PDB.C23.RES || !PDB.C23.dH1 || !PDB.C23.dE33 || !PDB.C23.dB)
    throw new Error('solver-core: PDB.C23 (restricted center tables) missing');
  const C23 = PDB.C23;
  const C23_J0 = C23.RES.j0;
  const C23_B = [0, 1, 2].map(j => (j - C23_J0 + 3) % 3);  // grip -> block drift
  for (let b = 0; b < 3; b++) {
    const j = (C23_J0 + b) % 3;
    if (BL.gen[j][2].m !== 2 * C23.RES.XF[b])
      throw new Error('solver-core: grip ' + j + ' does not read the working face at drift ' + b);
  }

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
  // fc reads the full 16-move-metric H1.D. The TRIPLE stages read the r*
  // families, measured in the sealed group's own 10-native-move metric —
  // with free re-grips that IS the token metric (each of engine
  // {U,D,L,R,B}± costs one token from every grip), so the bounds are
  // exact-for-the-metric and admissible in every grip. The CENTER stages
  // read the C23 bundle: EXACT distances over (cell x drift) in the
  // restricted {R,U,Rw} metric, resolved at the node's own drift — the
  // white center is exactly home iff the drift is 0, and the triples are
  // pinned by the move system itself, so no corner / orbit-A / D-hexagon
  // reads remain in center mode. The 99 sentinel marks coordinates the
  // move group cannot solve at all, which fails the step instantly
  // instead of burning its node budget.
  const fh1 = s => PDB.H1.D[T.h1Index(s.ep, s.ctr, 'D', HEX_EDGES.D)];
  function stageH(stage, line) {
    switch (stage.id) {
      case 'fc': return s => fh1(s);
      case 't1': {
        const o = stage.opt;
        return (s, lim) => {
          let h = PDB.rC[o.cKey][T.cornerIndex(s.cp, s.co)];
          if (h > lim) return h;
          const d = PDB.rA[o.aKey][T.encA(s.ctr)]; return d > h ? d : h;
        };
      }
      case 't2':
        return (s, lim) => {
          let h = PDB.rC['3,5'][T.cornerIndex(s.cp, s.co)];
          if (h > lim) return h;
          const d = PDB.rA['5,6,8,9'][T.encA(s.ctr)]; return d > h ? d : h;
        };
      default: {
        // center stages (restricted metric): the non-D hexagons required so
        // far plus the one being solved — the D hexagon and the triples are
        // carried by the drift dimension b, not by any table. The heavy
        // lifters are the one-hexagon EXACT (cell x drift) tables and the
        // hexagon-PAIR 6-edge couplings; the orbit-B mask-pair table covers
        // the triangle side (two blocks + D force the third, so every
        // multi-face triangle goal collapses to dB.all).
        const faces = line.hexes.concat([stage.opt.face]).filter(f => f !== 'D');
        const dbT = faces.length === 1 ? C23.dB[faces[0]] : C23.dB.all;
        const pairs = [];
        for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
          const key = ['L', 'R', 'B'].filter(f => f === faces[i] || f === faces[j]).join('');
          pairs.push({ t: C23.dE33[key], a: HEX_EDGES[key[0]], b: HEX_EDGES[key[1]] });
        }
        const pB = new Array(12);               // scratch orbit-B color view
        return (s, lim, j) => {
          const b = C23_B[j];
          for (let i = 0; i < 12; i++) pB[i] = s.ctr[12 + i] - 4;
          let h = dbT[(T.maskOfColor(pB, 0) * 220 + T.maskOfColor(pB, 1)) * 3 + b];
          if (h > lim) return h;
          let d;
          for (const f of faces) {
            d = C23.dH1[f][T.h1Index(s.ep, s.ctr, f, HEX_EDGES[f]) * 3 + b];
            if (d > h) h = d;
            if (h > lim) return h;
          }
          for (const q of pairs) {
            d = q.t[(T.edgePlaceIndex(s.ep, q.a) * 1320 + T.edgePlaceIndex(s.ep, q.b)) * 3 + b];
            if (d > h) h = d;
            if (h > lim) return h;
          }
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
  // fc searches the 16 native moves; t1..c4 search their mode's hold
  // tokens plus free re-grip composites, with the grip tracked. Canonical
  // successor rules: native — never the same face twice in a row, opposite
  // faces commute so only the smaller-index face may come first when
  // adjacent; hold codes — see dfsBL. weight > 1 makes the pruning
  // inadmissible (weighted IDA*): solutions are then near-optimal, found
  // exponentially faster — the later center steps run 10+ moves deep where
  // exact search is intractable, and the port plan promises optimal OR
  // near-optimal per step. Found solutions are always goal-checked.
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
  // the Bencisco-hold DFS: nodes are (state, grip); path records the codes
  // pathToText renders (plain tokens and re-grip-fused U composites); only
  // the wide tokens and re-grips change grip. lastTok carries the previous
  // code for the canonical successor rules:
  //   - R-axis runs hold at most one R±, then one D-layer token (Rw±):
  //     rank strictly ascends, and D-doubles respell as the single inverse
  //     token (face turns have order 3).
  //   - a plain U never follows a U-axis code (same grip = same engine
  //     face); a composite's U is at a NEW grip, so it may.
  //   - composites never start a word (the step-start grip loop covers
  //     every grip) and never exist at all in restricted center mode — a
  //     mid-word rotation there would misalign grip and block, so the very
  //     next U token would rip a triple.
  // The heuristic h receives the node's GRIP: the restricted center tables
  // are (cell x drift)-resolved and the drift is grip minus aligned grip.
  function dfsBL(s, j, g, bound, lastTok, goal, h, w, path, sols, maxSols, mode) {
    if (++work.nodes > work.limit) {
      work.stopped = true;
      if (work.nodes > work.budget) work.truncated = true;
      return;
    }
    const lim = (bound - g) / w;
    const hh = h(s, lim, j);
    if (hh > lim + 1e-9) return;
    if (hh === 0 && goal(s)) { sols.push({ moves: path.slice(), st: E.copy(s) }); return; }
    if (g >= bound) return;
    const t = stackNode(g);
    for (const k of mode.toks) {
      if (lastTok >= 100) {
        if (BL.AXIS[k] === 1) continue;                  // U after a composite's U
      } else if (lastTok >= 0 && BL.AXIS[k] === BL.AXIS[lastTok]) {
        if (BL.AXIS[k] === 1) continue;                  // U never follows U
        if (BL.RANK[k] <= BL.RANK[lastTok]) continue;    // R-axis runs ascend
      }
      const gen = BL.gen[j][k];
      moveInto(gen.m, s, t);
      path.push(k);
      dfsBL(t, gen.nj, g + 1, bound, k, goal, h, w, path, sols, maxSols, mode);
      path.pop();
      if (work.stopped || sols.length >= maxSols) return;
    }
    // free re-grips (triple mode only) carry mode.regripCost in the SEARCH
    // (the fused U turn plus a reading penalty for the rotation): plain
    // spellings win unless a re-grip saves that many real moves, and the
    // displayed movecount still counts the composite as its one turn
    // (rotations are free)
    if (!mode.restricted && g + mode.regripCost <= bound && lastTok !== -1) {
      for (let tg = 0; tg < 3; tg++) {
        if (tg === j) continue;
        for (let d = 0; d < 2; d++) {
          const gen = BL.gen[tg][2 + d];
          moveInto(gen.m, s, t);
          path.push(100 + 2 * tg + d);
          dfsBL(t, tg, g + mode.regripCost, bound, 100 + 2 * tg + d, goal, h, w, path, sols, maxSols, mode);
          path.pop();
          if (work.stopped || sols.length >= maxSols) return;
        }
      }
    }
  }
  // stepBudget bounds THIS call's nodes: a pathological instance fails fast
  // (killing one line-option) instead of starving the whole solve. On a
  // budget stop with nothing found, one retry at a higher weight rescues
  // most hard instances (heavier pruning finds a slightly longer answer).
  // holdMode ('center' | 'triple' | falsy for the native DFS) picks the
  // token alphabet; triple mode runs the hold DFS from all three grips per
  // bound (re-grips about the R-BL axis are free between steps), while the
  // restricted center mode starts ONLY from the aligned grip (any other
  // start would put the working-face U token on a triple). Each solution
  // records its grip.
  function searchStep(start, goal, h, cap, maxSols, slack, weight, stepBudget, holdMode) {
    const mode = holdMode ? MODES[holdMode === true ? 'center' : holdMode] : null;
    if (holdMode && !mode) throw new Error('unknown hold mode ' + holdMode);
    const grips = mode && mode.restricted ? [C23_J0] : [0, 1, 2];
    if (goal(start)) return [{ moves: [], st: E.copy(start), j0: grips[0] }];
    const attempt = (w, budget) => {
      // with w > 1 a length-L solution may only survive the weighted pruning
      // at bounds up to ~w*L, so the bound iterates past the length cap
      work.limit = Math.min(work.budget, work.nodes + budget);
      work.stopped = false;
      const boundCap = Math.ceil(cap * w);
      const sols = [];
      const run = bound => {
        if (!mode) { dfs(start, 0, bound, -1, goal, h, w, [], sols, maxSols); return; }
        for (const j0 of grips) {
          if (work.stopped || sols.length >= maxSols) break;
          const before = sols.length;
          dfsBL(start, j0, 0, bound, -1, goal, h, w, [], sols, maxSols, mode);
          for (let i = before; i < sols.length; i++) sols[i].j0 = j0;
        }
      };
      let bound = Math.max(1, h(start, Infinity, grips[0]));
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
      // among equal-length words prefer the fewest mid-word re-grips: the
      // rotations are free in the metric, but the human reads every bracket
      // (user refinement 2026-07-14 — triples especially should be plain
      // R / U / Rw whenever an equal-length spelling exists)
      if (mode) {
        const regrips = x => { let n = 0; for (const k of x.moves) if (k >= 100) n++; return n; };
        out.sort((a, b) => a.moves.length - b.moves.length || regrips(a) - regrips(b));
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
  // WHITE FIRST, EVERY TIME (user spec 2026-07-14): the only admissible
  // pre-rotations are the 3 that map the white (engine U) material onto the
  // method's D region — the spins about the white axis, spelled {D,L} /
  // {D,R} / {D,B}. Their freedom is which triples/centers the method meets
  // when (the LBT dead-end rescue). The old names keep their ladder roles:
  // fixed = the primary anchor, vertical = all 3 spins, full = all 3 again
  // (the auto ladder passes wider search options on that last rung).
  const WHITE_ORIENTS = ORIENTS.map((o, i) => (E.faceImg(o.M, FIDX.U) === FIDX.D ? i : -1)).filter(i => i >= 0);
  if (WHITE_ORIENTS.length !== 3) throw new Error('white-first anchors: expected 3, got ' + WHITE_ORIENTS.length);
  const ORIENT_SETS = {
    fixed: () => WHITE_ORIENTS.slice(0, 1),
    vertical: () => WHITE_ORIENTS.slice(),
    full: () => WHITE_ORIENTS.slice(),
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
    if (stage.id === 'fc') return STEP_DEFS.fc.name + ' (white)';
    if (stage.id === 't1' || stage.id === 't2')
      return STEP_DEFS[stage.id].name + ' (corner ' + (stage.opt.corner === 3 ? 'back' : 'right') + ')';
    return STEP_DEFS[stage.id].name + ' (' + stage.opt.face + ')';
  };

  // search(state, opts) -> { byLength, best, truncated, work, failures, orientUsed }
  // opts: { orient:'auto'|'fixed'|'vertical'|'full'|[rotIdx], beam, caps:{id:int},
  //         slack, budget, stepBudget, weights, maxSolsPerStep }
  // 'auto' (default) is a ladder over the 3 white anchors: the primary
  // anchor solves the vast majority of scrambles; the rare LBT source
  // dead-ends (both source triangles trapped on side slots no sheet alg
  // reaches — measured) are retried with the other two spins, then all 3
  // again with a wider search (the white-first replacement for the old
  // 24-orientation sweep: the first center's color is never given up).
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
      if (res.best == null) res = carry(search(scr, { ...opts, orient: 'full',
        beam: Math.max(opts.beam || DEFAULTS.beam, 6), maxSolsPerStep: 5, slack: 1 }), res);
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
                stageId === 'fc' ? null                              // native letters
                  : (stageId === 't1' || stageId === 't2') ? 'triple' : 'center');
              memo.set(mk, sols);
            }
            if (!sols.length) { failures.step++; continue; }
            for (const sol of sols) {
              // fc emits native letters in the pre-rotation hold; t1..c4 emit
              // Bencisco-hold tokens (either kind may carry mid-word re-grip
              // brackets) with the grip's rotation spell as `pre`
              const seg = !sol.moves.length ? null : stageId === 'fc'
                ? { id: stage.id, kind: 'search', label: stepLabel(stage),
                    text: sol.moves.map(m => E.MOVES[m]).join(' '), moves: sol.moves.length }
                : { id: stage.id, kind: 'search', label: stepLabel(stage),
                    text: pathToText(sol.j0, sol.moves).text, moves: sol.moves.length,
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
      respellLine(item);                        // relative junction re-grips (clones segs)
      const lineKey = item.rotSpell + '|' + item.segs.map(s => (s.pre ? s.pre + '~' : '') + s.text).join('|');
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

  /* ---------- continuous respell: the printed line is ONE engine text ---------- */
  // The search anchors each hold segment at the recognition hold (both the
  // line's rotation and the grip spell BL.SPELLS[j0] read from identity),
  // but a human executes the printed tokens IN ORDER, carrying every
  // re-orientation forward — including the hold drift of wide moves
  // (walkParsed semantics, the sheets' own convention). Physical-loop
  // finding (user, 2026-07-14): identity-anchored spells made the printed
  // junctions wrong under that continuous execution. So before a line is
  // emitted, each segment's `pre` is respelled RELATIVE to the hold the
  // previous tokens actually leave: the one {X,Y} bracket, read at that
  // hold, that lands the segment's intended absolute hold — or no token at
  // all when the human is already holding it right. lineText(item) is then
  // a single continuous engine-valid text and verifyLine proves exactly
  // that text: what you read is what you turn.
  const holdOfText = t => t ? E.walkParsed(E.parseAlg(t), () => {}) : [0, 1, 2, 3, 4, 5, 6, 7];
  function respellLine(item) {
    let acc = item.rotSpell || '';
    item.segs = item.segs.map(seg => {
      const intended = holdOfText(((item.rotSpell || '') + ' ' + (seg.pre || '')).trim());
      const current = holdOfText(acc);
      const out = { ...seg };
      delete out.pre;
      if (current.join(',') !== intended.join(',')) {
        const x = current.indexOf(intended[0]), y = current.indexOf(intended[1]);
        out.pre = '{' + FACES[x] + ',' + FACES[y] + '}';
      }
      acc = (acc + ' ' + (out.pre ? out.pre + ' ' : '') + seg.text).trim();
      return out;
    });
  }

  /* ---------- the per-line proof (every displayed line, end to end) ---------- */
  // Executes the DISPLAYED text through the engine from the original
  // scramble state as ONE CONTINUOUS reading — the exact token stream a
  // human follows, respelled junction re-grips included — and the final
  // state must be EXACTLY solved. Any false here means a bug upstream.
  function verifyLine(scr, item) {
    try {
      // all live sheet subsets are CIF; a future EIF subset would need its
      // own continuous-reading pin before it may join the sweep
      if (item.segs.some(sg => (sg.dialect || 'cif') !== 'cif')) return false;
      const parsed = E.parseAlg(lineText(item));
      if (!parsed) return false;
      return E.eq(E.applyParsed(parsed, E.copy(scr)), SOLVED);
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
    TRIPLE_TOKS, REGRIP, pathToText, WHITE_ORIENTS,
    hexOK, tripleOK, lbtOK,
    searchStep, stageH, stageGoal, resetWork, work,
    finishIndex, lbtCandidates, conjState, ORIENTS, ORIENT_SETS,
    search, verifyLine, lineText,
  };
}
if (typeof module !== 'undefined') module.exports = { makeSolverCore, METHOD_NAME, STEP_DEFS, STEP_ORDER, DEFAULTS };
window.OOSolverCore=module.exports;})();
