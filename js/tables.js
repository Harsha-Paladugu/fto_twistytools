/* fto.twistytools.com — solver pruning tables (window.OOTables). M5.
 *
 * The Skewb-era full-state BFS (loadOrBuildDist / loadOrBuildClassTables) is
 * gone — the FTO state space (~3.1e22) has no dense index. What the method
 * solver needs instead is a family of small per-step pattern databases (PDBs):
 * exact distance-to-goal tables over independent piece coordinates, combined
 * at search time with max() (each is admissible alone, so the max is too).
 *
 * Coordinates (codecs are exported — solver-core computes indices per node,
 * tests pin them):
 *   - centre-orbit pattern: the 12 slots of one tetrad hold 4 colors x 3
 *     identical triangles -> multiset rank, 12!/(3!)^4 = 369,600 states.
 *     Orbit A = slots 0..11 (faces U,F,BR,BL), orbit B = slots 12..23
 *     (faces L,R,D,B). Orbits never mix (engine ground truth).
 *   - corners: even perm of 6 (360) x flips of the first 5 (32) = 11,520
 *     (flip 6 is forced: flips sum even). Even-perm rank per xyzzy's
 *     ftosolver.js (permutation rank >> 1).
 *   - edge placement: positions of k specific edge pieces among 12 slots,
 *     12·11·…·(13-k); the solver uses k=3 (one hexagon's edges, 1,320).
 *
 * MOVE GROUPS. The first-center step searches the 16 native moves, but every
 * later search step (triples, remaining centers) runs in the BENCISCO HOLD:
 * the white first center held on the BL face. makeBLHold(E) derives that
 * machinery from the engine's own hold walk: the 3 CIF grips with
 * first-center-at-BL / working-face-at-R (spelled {L,R} / {R,B} / {B,L} —
 * the site's {X,Y} re-orientation brackets; hold-U reads engine L / R / B),
 * and the 8-token generator table (token -> native move + next grip; Rw =
 * engine D plus a grip drift, BL = engine D in place). The step alphabets:
 * triples (t1/t2) use {R, U, Rw} and may re-grip for free mid-word, fused
 * to the U turn that needs it and printed as one {X,Y} bracket ({F,BR} /
 * {BR,U} — never as a redundant token pair like Rw BL'); the CENTER steps
 * (sc/c3/c4) use the RESTRICTED triple-preserving {R, U, Rw} system from
 * the one aligned grip (user spec 2026-07-16, same contract as the Centers
 * trainer: the solved triples never leave their place, no rotations, no
 * BL) — their tables are the C23 bundle below, not these PDBs. Both step
 * kinds stay inside the sealed group, which SEALS the first center —
 * engine D's edge and centre slots are invariant (only Rw/BL spin them).
 *
 * The triple-step search metric: hold tokens cost 1; a mid-word re-grip
 * composite (the free rotation fused to the U turn that needs it) costs 2 —
 * the extra unit keeps plain spellings preferred, so re-grips only appear
 * where they save a real move. The r* families are (coordinate x grip) BFS
 * in that exact metric, collapsed to min-over-grips (admissible whatever
 * grip the search is in; see bfsTableR). The sealed group's native face
 * effects are {U, D, L, R, B}± — SEALED_MOVES below, derived from the hold
 * walk and asserted.
 *
 * Tables built here (Int8 distances, BFS from every goal state; the move set
 * is closed under inverse and the composite reversal is handled inside
 * bfsTableR, so BFS-from-goals is distance-to-goal). Entries the restricted
 * group cannot connect to the goal hold the sentinel 99 — a junction
 * reading 99 is restricted-unsolvable and fails fast:
 *   rA[slots]  orbit-A goals '6,9' / '5,8' (one bottom triple each — t1's
 *              read) and '5,6,8,9' (both; t2's read).
 *   rC[set]    corner goals '3' / '5' / '3,5' over the full 11,520.
 *   H1.D       the first-center table, full 16-move metric (fc's heuristic).
 *   E3[face]   full-metric hexagon edge triples (data-quality gauge; the
 *              search itself no longer reads them).
 * (The old center-step families rB / rE6 / rH1 were RETIRED 2026-07-16 with
 * the restricted center metric — the center steps read the C23 bundle's
 * (cell x drift) tables instead, ~8 MB of dead weight dropped.)
 * Total ≈ 1.4 MB, cached in IndexedDB ('fto-tables' / 'fto-pdb-v6'); first
 * build ≈ 1-2 s — far inside the ~10 MB / ~30 s budget, so no user
 * checkpoint (docs/port-plan.md M5).
 */
(function () {
  const module = { exports: {} };
  const DB_NAME = 'fto-tables', STORE = 't';
  const KEY_PDB = 'fto-pdb-v6';
  const UNREACHED = 99;   // restricted-group sentinel: cannot reach the goal

  // ---------------- IndexedDB (best-effort cache) ----------------
  function openDB() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(key) {
    if (typeof indexedDB === 'undefined') return null;
    try {
      const db = await openDB();
      const v = await new Promise((res, rej) => {
        const tx = db.transaction(STORE).objectStore(STORE).get(key);
        tx.onsuccess = () => res(tx.result); tx.onerror = () => rej(tx.error);
      });
      db.close();
      return v || null;
    } catch (e) { return null; }
  }
  async function idbPut(key, payload) {
    if (typeof indexedDB === 'undefined') return;
    try {
      const db = await openDB();
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(payload, key);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
      db.close();
    } catch (e) { /* cache is best-effort */ }
  }
  async function idbDel(key) {
    if (typeof indexedDB === 'undefined') return;
    try {
      const db = await openDB();
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
      db.close();
    } catch (e) { /* cache is best-effort */ }
  }

  // ---------------- centre-orbit pattern codec ----------------
  // A pattern is 12 slots each holding a color 0..3 (three of each). Rank =
  // lexicographic multiset rank; M[counts] = multinomial of the remaining
  // counts, memoized on a base-4 packed key (counts are 0..3 each).
  const NPAT = 369600;
  const MULTI = (() => {
    const fact = [1, 1, 2, 6];
    const out = new Float64Array(256);
    for (let k = 0; k < 256; k++) {
      const c = [k & 3, (k >> 2) & 3, (k >> 4) & 3, (k >> 6) & 3];
      const n = c[0] + c[1] + c[2] + c[3];
      let f = 1; for (let i = 2; i <= n; i++) f *= i;
      out[k] = f / (fact[c[0]] * fact[c[1]] * fact[c[2]] * fact[c[3]]);
    }
    return out;
  })();
  const CKEY = (c) => c[0] + (c[1] << 2) + (c[2] << 4) + (c[3] << 6);
  function encPattern(pat) {              // pat: 12 colors 0..3 -> 0..369,599
    const c = [3, 3, 3, 3];
    let rank = 0;
    for (let i = 0; i < 12; i++) {
      const v = pat[i];
      for (let d = 0; d < v; d++) {
        if (!c[d]) continue;
        c[d]--; rank += MULTI[CKEY(c)]; c[d]++;
      }
      c[v]--;
    }
    return rank;
  }
  function decPattern(rank, out) {        // inverse of encPattern
    const c = [3, 3, 3, 3];
    out = out || new Array(12);
    for (let i = 0; i < 12; i++) {
      for (let v = 0; v < 4; v++) {
        if (!c[v]) continue;
        c[v]--;
        const m = MULTI[CKEY(c)];
        if (rank < m) { out[i] = v; break; }
        rank -= m; c[v]++;
      }
    }
    return out;
  }
  // orbit views over a state's 24-slot ctr array: colors remapped to 0..3
  // (A slots 0..11 hold face colors 0..3 already; B slots 12..23 hold 4..7)
  function encA(ctr) {
    const p = ENC_SCRATCH;
    for (let i = 0; i < 12; i++) p[i] = ctr[i];
    return encPattern(p);
  }
  function encB(ctr) {
    const p = ENC_SCRATCH;
    for (let i = 0; i < 12; i++) p[i] = ctr[12 + i] - 4;
    return encPattern(p);
  }
  const ENC_SCRATCH = new Array(12);

  // ---------------- corner codec (xyzzy-style even-perm rank) ----------------
  // permutation_to_index / index_to_evenpermutation follow xyzzy's
  // ftosolver.js (see tools/fixtures/xyzzy-fto.mjs for attribution).
  function permRank(perm) {               // Lehmer rank over n!
    const p = perm.slice();
    const n = p.length;
    let f = 1; for (let i = 2; i < n; i++) f *= i;
    let ind = 0, m = n;
    while (m > 1) {
      m--;
      const e = p[0];
      ind += e * f;
      for (let i = 0; i < m; i++) { const x = p[i + 1]; p[i] = x - (x > e ? 1 : 0); }
      f /= m > 1 ? m : 1;
    }
    return ind;
  }
  function evenPermUnrank(ind, n) {       // inverse of (rank >> 1) for even perms
    const perm = new Array(n);
    let f = 1; for (let i = 2; i <= n - 1; i++) f *= i;
    f /= 2;                                // (n-1)!/2
    let parity = 0;
    for (let i = 0; i < n - 1; i++) {
      perm[i] = (ind / f) | 0;
      ind %= f;
      f /= n - 1 - i;
    }
    perm[n - 1] = 0;
    for (let i = n - 2; i >= 0; i--) {
      for (let j = i + 1; j < n; j++) {
        if (perm[j] >= perm[i]) perm[j]++;
        else parity ^= 1;
      }
    }
    if (parity === 1) { const t = perm[n - 2]; perm[n - 2] = perm[n - 1]; perm[n - 1] = t; }
    return perm;
  }
  const NCORNER = 11520;                   // 360 even perms x 32 flip vectors
  function cornerIndex(cp, co) {
    let flips = 0;
    for (let i = 0; i < 5; i++) flips |= co[i] << i;
    return (permRank(cp) >> 1) * 32 + flips;
  }
  function cornerUnpack(ix) {
    const cp = evenPermUnrank(ix >> 5, 6);
    const co = new Array(6);
    let sum = 0;
    for (let i = 0; i < 5; i++) { co[i] = (ix >> i) & 1; sum ^= co[i]; }
    co[5] = sum;                           // flips sum even
    return { cp, co };
  }

  // ---------------- edge placement codec ----------------
  // positions of k specific pieces (ascending piece order) among 12 slots
  function edgePlaceIndex(ep, pieces) {    // ep: slot -> piece
    const pos = [];
    for (const q of pieces) { for (let s = 0; s < 12; s++) if (ep[s] === q) { pos.push(s); break; } }
    let ix = 0, base = 12;
    for (let i = 0; i < pos.length; i++) {
      let r = pos[i];
      for (let j = 0; j < i; j++) if (pos[j] < pos[i]) r--;
      ix = ix * base + r; base--;
    }
    return ix;
  }
  function edgePlaceUnrank(ix, k) {        // -> positions array (piece order)
    const digits = new Array(k);
    for (let i = k - 1, base = 12 - k + 1; i >= 0; i--, base++) { digits[i] = ix % base; ix = (ix / base) | 0; }
    const free = Array.from({ length: 12 }, (_, i) => i);
    const pos = new Array(k);
    for (let i = 0; i < k; i++) { pos[i] = free[digits[i]]; free.splice(digits[i], 1); }
    return pos;
  }
  const NE3 = 12 * 11 * 10;
  const NE6 = 12 * 11 * 10 * 9 * 8 * 7;    // 665,280

  // ---------------- 3-of-12 combination codec (identical triangles) ----------
  // rank of the sorted position triple p0<p1<p2 among C(12,3) = 220
  const CH = (n, k) => { let c = 1; for (let i = 0; i < k; i++) c = c * (n - i) / (i + 1); return c | 0; };
  function maskIndex(p0, p1, p2) { return CH(p0, 1) + CH(p1, 2) + CH(p2, 3); }
  function maskOfColor(orbitPat, color) {  // positions of a color in a 12-slot view
    let a = -1, b = -1, c = -1;
    for (let i = 0; i < 12; i++) if (orbitPat[i] === color) { if (a < 0) a = i; else if (b < 0) b = i; else c = i; }
    return maskIndex(a, b, c);
  }
  const NMASK = 220;
  const NH1 = NE3 * NMASK;                 // 290,400: one-hexagon exact space

  // ---------------- the Bencisco hold (first center on BL) ----------------
  // Everything here is DERIVED from the engine's own hold walk and asserted;
  // a geometry change throws at load. The three grips are the CIF holds with
  // the first-center face (engine D) at position BL and engine U at position
  // R (R and BL are opposite faces); they differ by the R-axis spin, which is
  // exactly what a wide R drifts (walkParsed's holdAfterRot). Grip order is
  // pinned so grip 0 ('{L,R}', the old T grip) is canonical: hold-U reads
  // engine L / R / B at grips 0 / 1 / 2. Spells are the site's {X,Y}
  // re-orientation brackets (user decision 2026-07-14) — one token per grip.
  const BL_SPELLS = ['{L,R}', '{R,B}', '{B,L}'];
  // the 8-token hold alphabet {R, U, Rw, BL}. Same-axis canonicalization for
  // the search: R/Rw/BL share the R-BL axis and their ENGINE effects are
  // grip-independent (R = engine U, Rw and BL = engine D — the two differ
  // only by Rw's grip drift), so a commuting run needs at most one R± and
  // one D-layer token: rank 0 for R, rank 1 for BOTH Rw and BL, runs forced
  // strictly ascending. That bans every Rw<->BL adjacency — in particular
  // the redundant re-grip pair Rw BL' (user report 2026-07-14), whose job
  // the search's free re-grip composites now do as one {X,Y} bracket.
  const BL_TOKS = ['R', "R'", 'U', "U'", 'Rw', "Rw'", 'BL', "BL'"];
  const BL_AXIS = [0, 0, 1, 1, 0, 0, 0, 0];
  const BL_RANK = [0, 0, -1, -1, 1, 1, 1, 1];
  function makeBLHold(E) {
    const holdOf = spell => E.walkParsed(E.parseAlg(spell), () => {});
    const holds = BL_SPELLS.map(holdOf);
    const keyOf = h => h.join(',');
    const idx = new Map(holds.map((h, i) => [keyOf(h), i]));
    const gen = holds.map((h, j) => {
      if (h[E.FIDX.BL] !== E.FIDX.D || h[E.FIDX.R] !== E.FIDX.U)
        throw new Error('BL hold ' + j + ' misplaced: ' + h);
      return BL_TOKS.map(tok => {
        const fired = [];
        const end = E.walkParsed(E.parseAlg(BL_SPELLS[j] + ' ' + tok), m => fired.push(m));
        if (fired.length !== 1) throw new Error('BL token ' + tok + ' fired ' + fired.length + ' moves');
        const nj = idx.get(keyOf(end));
        if (nj === undefined) throw new Error('BL token ' + tok + ' leaves the hold family');
        return { m: fired[0], nj };
      });
    });
    // pin the load-bearing facts: R reads engine U, BL reads engine D,
    // hold-U reads engine L/R/B by grip, and only the wide changes grip
    const wantU = [E.FIDX.L, E.FIDX.R, E.FIDX.B];
    for (let j = 0; j < 3; j++) {
      if (gen[j][0].m !== 2 * E.FIDX.U || gen[j][6].m !== 2 * E.FIDX.D)
        throw new Error('BL hold reading mismatch at grip ' + j);
      if (gen[j][2].m !== 2 * wantU[j]) throw new Error('BL hold-U mismatch at grip ' + j);
      for (let k = 0; k < BL_TOKS.length; k++)
        if ((gen[j][k].nj !== j) !== (k === 4 || k === 5)) throw new Error('BL grip drift mismatch');
    }
    // the sealed group's native move set: with free re-grips every token is
    // one of these from every grip, and every one of these is one token —
    // the r* BFS metric below IS the hold search's own metric
    const SEALED_MOVES = [...new Set(gen.flatMap(row => row.map(g => g.m)))].sort((a, b) => a - b);
    const sealedFaces = [...new Set(SEALED_MOVES.map(m => m >> 1))].sort((a, b) => a - b);
    const wantFaces = [E.FIDX.U, E.FIDX.L, E.FIDX.R, E.FIDX.D, E.FIDX.B].sort((a, b) => a - b);
    if (SEALED_MOVES.length !== 10 || sealedFaces.join() !== wantFaces.join())
      throw new Error('sealed move set mismatch: ' + SEALED_MOVES);
    return { SPELLS: BL_SPELLS, TOKS: BL_TOKS, AXIS: BL_AXIS, RANK: BL_RANK, holds, gen, SEALED_MOVES };
  }

  // ---------------- builders ----------------
  // BFS over an explicit transition table: 16 moves, Int8 distances, multi-
  // source (dist 0 for every goal). Unreached stays -1 (cannot happen for the
  // sets used here, but the search treats -1 as +inf defensively).
  function bfsTable(n, next, goals) {
    const dist = new Int8Array(n).fill(-1);
    let frontier = [];
    for (const g of goals) if (dist[g] < 0) { dist[g] = 0; frontier.push(g); }
    let d = 0;
    while (frontier.length) {
      const nf = [];
      for (const s of frontier) {
        const row = s * 16;
        for (let m = 0; m < 16; m++) {
          const t = next[row + m];
          if (dist[t] < 0) { dist[t] = d + 1; nf.push(t); }
        }
      }
      d++;
      frontier = nf;
    }
    return dist;
  }
  // BFS under the sealed Bencisco-hold move system: nodes are (coordinate,
  // grip), the 8 tokens cost 1, and a re-grip composite (free rotation
  // fused to the U turn that needs it — the search's only mid-word
  // re-grip) costs 2. That is EXACTLY the metric js/solver-core.js
  // searches in, so the collapsed min-over-grips values are admissible in
  // every grip and as tight as a grip-free table can be. Composite edges
  // are walked BACKWARD (turn the current grip's U face, then land at
  // either other grip): the token set is inverse-closed but "re-grip then
  // turn" reverses to "turn then re-grip", and with all-grip goals plus
  // the min-over-grips collapse the two systems' distances coincide.
  // Costs are 1 and 2, so the frontier runs as distance buckets with the
  // unit-cost pass first. Coordinates the restricted group cannot connect
  // to the goal get the UNREACHED sentinel — reading one at a junction
  // means "this step is impossible from here", which prunes instantly.
  function bfsTableR(n, next, goals, bl) {
    const dist = new Int8Array(n * 3).fill(-1);
    const buckets = [[]];
    for (const g of goals) for (let j = 0; j < 3; j++) { dist[g * 3 + j] = 0; buckets[0].push(g * 3 + j); }
    for (let d = 0; d < buckets.length; d++) {
      const cur = buckets[d];
      if (!cur || !cur.length) continue;
      for (const s of cur) {                   // unit-cost token edges first
        const c = (s / 3) | 0, j = s % 3, row = c * 16;
        for (let k = 0; k < 8; k++) {
          const g = bl.gen[j][k];
          const t = next[row + g.m] * 3 + g.nj;
          if (dist[t] < 0) { dist[t] = d + 1; (buckets[d + 1] || (buckets[d + 1] = [])).push(t); }
        }
      }
      for (const s of cur) {                   // cost-2 re-grip composites
        const c = (s / 3) | 0, j = s % 3, row = c * 16;
        for (let dd = 0; dd < 2; dd++) {
          const c2 = next[row + bl.gen[j][2 + dd].m];
          for (let tg = 0; tg < 3; tg++) {
            if (tg === j) continue;
            const t = c2 * 3 + tg;
            if (dist[t] < 0) { dist[t] = d + 2; (buckets[d + 2] || (buckets[d + 2] = [])).push(t); }
          }
        }
      }
    }
    const out = new Int8Array(n).fill(UNREACHED);
    for (let c = 0; c < n; c++) {
      let best = UNREACHED;
      for (let j = 0; j < 3; j++) { const v = dist[c * 3 + j]; if (v >= 0 && v < best) best = v; }
      out[c] = best;
    }
    return out;
  }

  // transient orbit move table: next[ix*16+m] over 369,600 patterns
  async function buildOrbitMtable(E, orbit, tick) {
    const TBL = E.moveTables;
    const off = orbit === 'A' ? 0 : 12;
    // per-move pull perm restricted to the orbit's 12 slots
    const perms = TBL.map(t => {
      const p = new Array(12);
      for (let i = 0; i < 12; i++) p[i] = t.xperm[off + i] - off;
      return p;
    });
    const next = new Int32Array(NPAT * 16);
    const pat = new Array(12), img = new Array(12);
    for (let ix = 0; ix < NPAT; ix++) {
      decPattern(ix, pat);
      for (let m = 0; m < 16; m++) {
        const p = perms[m];
        for (let i = 0; i < 12; i++) img[i] = pat[p[i]];
        next[ix * 16 + m] = encPattern(img);
      }
      if (tick && (ix & 32767) === 32767) await tick(ix, NPAT);
    }
    return next;
  }

  function buildCornerMtable(E) {
    const TBL = E.moveTables;
    const next = new Int32Array(NCORNER * 16);
    const cp2 = new Array(6), co2 = new Array(6);
    for (let ix = 0; ix < NCORNER; ix++) {
      const { cp, co } = cornerUnpack(ix);
      for (let m = 0; m < 16; m++) {
        const t = TBL[m];
        for (let v = 0; v < 6; v++) { cp2[v] = cp[t.cperm[v]]; co2[v] = co[t.cperm[v]] ^ t.cflip[v]; }
        next[ix * 16 + m] = cornerIndex(cp2, co2);
      }
    }
    return next;
  }

  function invEdgePerms(E) {
    // Positions move by the inverse of the pull perm: the piece at slot s
    // lands at ie[m][s] with eperm[ie[m][s]] === s.
    return E.moveTables.map(t => {
      const inv = new Array(12);
      for (let s = 0; s < 12; s++) inv[t.eperm[s]] = s;
      return inv;
    });
  }
  async function buildEdgeMtable(E, k, tick) {
    // Placement transitions depend on positions only, never on which pieces
    // are tracked — one k-piece table serves every tracked set (goals differ).
    const ie = invEdgePerms(E);
    const N = k === 3 ? NE3 : NE6;
    const next = new Int32Array(N * 16);
    const np = new Array(k);
    for (let ix = 0; ix < N; ix++) {
      const pos = edgePlaceUnrank(ix, k);
      for (let m = 0; m < 16; m++) {
        const q = ie[m];
        for (let i = 0; i < k; i++) np[i] = q[pos[i]];
        let v = 0, base = 12;
        for (let i = 0; i < k; i++) {
          let r = np[i];
          for (let j = 0; j < i; j++) if (np[j] < np[i]) r--;
          v = v * base + r; base--;
        }
        next[ix * 16 + m] = v;
      }
      if (tick && (ix & 65535) === 65535) await tick();
    }
    return next;
  }

  // goal enumerations
  function orbitGoals(orbit, wantSlots) {
    // wantSlots: array of [slotWithinOrbit, color 0..3]; free slots arbitrary
    const goals = [];
    const pat = new Array(12);
    const scan = (ix) => {
      decPattern(ix, pat);
      for (const [s, c] of wantSlots) if (pat[s] !== c) return;
      goals.push(ix);
    };
    for (let ix = 0; ix < NPAT; ix++) scan(ix);
    return goals;
  }
  function cornerGoals(slots) {            // corners in `slots` home and unflipped
    const goals = [];
    for (let ix = 0; ix < NCORNER; ix++) {
      const { cp, co } = cornerUnpack(ix);
      let ok = true;
      for (const v of slots) if (cp[v] !== v || co[v] !== 0) { ok = false; break; }
      if (ok) goals.push(ix);
    }
    return goals;
  }

  // one-hexagon EXACT tables: (face's 3 edges placement) x (face color mask
  // over its orbit) -> 290,400. This couples edges and centres of a single
  // hexagon, which the independent families cannot (their max() misses the
  // break-and-restore interaction entirely). The e3-x-mask transitions are
  // face-independent (only the goal cell differs), so they are materialized
  // once (transient ~19 MB Int32) and every H1 BFS — the first-center full-
  // metric one and the four restricted ones — walks the same table.
  function h1Next(E, mE3) {
    const xp = E.moveTables.map(t => {     // orbit-B slot pull perm
      const p = new Array(12);
      for (let i = 0; i < 12; i++) p[i] = t.xperm[12 + i] - 12;
      return p;
    });
    const mNext = new Int32Array(NMASK * 16);
    const pat = new Array(12);
    for (let p0 = 0; p0 < 12; p0++) for (let p1 = p0 + 1; p1 < 12; p1++) for (let p2 = p1 + 1; p2 < 12; p2++) {
      pat.fill(0); pat[p0] = 1; pat[p1] = 1; pat[p2] = 1;
      const ix = maskIndex(p0, p1, p2);
      for (let m = 0; m < 16; m++) {
        const q = xp[m];
        let a = -1, b = -1, c = -1;
        for (let i = 0; i < 12; i++) if (pat[q[i]]) { if (a < 0) a = i; else if (b < 0) b = i; else c = i; }
        mNext[ix * 16 + m] = maskIndex(a, b, c);
      }
    }
    const next = new Int32Array(NH1 * 16);
    for (let e = 0; e < NE3; e++)
      for (let mk = 0; mk < NMASK; mk++)
        for (let m = 0; m < 16; m++)
          next[(e * NMASK + mk) * 16 + m] = mE3[e * 16 + m] * NMASK + mNext[mk * 16 + m];
    return next;
  }
  function h1GoalIx(face, edges) {
    const fi = { D: 6, L: 4, R: 5, B: 7 }[face];
    const home = Array.from({ length: 12 }, (_, i) => i);
    const k0 = 3 * (fi - 4);               // orbit-B block of the face
    return edgePlaceIndex(home, edges) * NMASK + maskIndex(k0, k0 + 1, k0 + 2);
  }
  function h1Index(ep, ctr, face, edges) { // solver-side index into H1[face]
    const fi = { D: 6, L: 4, R: 5, B: 7 }[face];
    let a = -1, b = -1, c = -1;
    for (let i = 0; i < 12; i++) if (ctr[12 + i] === fi) { if (a < 0) a = i; else if (b < 0) b = i; else c = i; }
    return edgePlaceIndex(ep, edges) * NMASK + maskIndex(a, b, c);
  }

  // ---------------- the PDB bundle ----------------
  // A-orbit goal slots per bottom triple: corner 3 -> {BR(6), BL(9)},
  // corner 5 -> {F(5), BR(8)}; F2T = both. Slot colors are the slot's face.
  // The single-triple keys are t1's reads; the combined keys serve t2.
  // All are sealed-group tables now that the triple steps run inside the
  // group again (user spec 2026-07-14: R U Rw). The center-step families
  // (rB / rE6 / rH1) were retired 2026-07-16 — the restricted center steps
  // read the C23 bundle instead.
  const A_SETS = { '6,9': [[6, 2], [9, 3]], '5,8': [[5, 1], [8, 2]], '5,6,8,9': [[5, 1], [6, 2], [8, 2], [9, 3]] };
  const C_SETS = { '3': [3], '5': [5], '3,5': [3, 5] };
  const HEX_EDGES = { D: [9, 10, 11], L: [1, 2, 8], R: [0, 3, 6], B: [4, 5, 7] };
  const NTBL = Object.keys(A_SETS).length + Object.keys(C_SETS).length
    + Object.keys(HEX_EDGES).length + 1;

  async function buildPDBs(E, report, tick) {
    const rep = (stage, n, tot) => { if (report) report(stage, n, tot); };
    const yieldNow = tick || null;
    const RM = makeBLHold(E);
    const out = { rA: {}, rC: {}, E3: {}, H1: {} };

    rep('mtab', 0, 2);
    const mA = await buildOrbitMtable(E, 'A', yieldNow ? async (n, t) => { rep('mtab', n / t, 2); await yieldNow(); } : null);
    let done = 0;
    for (const key of Object.keys(A_SETS)) {
      out.rA[key] = bfsTableR(NPAT, mA, orbitGoals('A', A_SETS[key]), RM);
      rep('bfs', ++done, NTBL);
      if (yieldNow) await yieldNow();
    }
    const mC = buildCornerMtable(E);
    for (const key of Object.keys(C_SETS)) {
      out.rC[key] = bfsTableR(NCORNER, mC, cornerGoals(C_SETS[key]), RM);
      rep('bfs', ++done, NTBL);
    }
    rep('mtab', 1, 2);
    const mE3 = await buildEdgeMtable(E, 3, yieldNow);
    const home = Array.from({ length: 12 }, (_, i) => i);
    for (const f of Object.keys(HEX_EDGES)) {
      // goal: the face's 3 edges in their home slots (one placement index)
      out.E3[f] = bfsTable(NE3, mE3, [edgePlaceIndex(home, HEX_EDGES[f])]);
      rep('bfs', ++done, NTBL);
      if (yieldNow) await yieldNow();
    }
    const hN = h1Next(E, mE3);
    out.H1.D = bfsTable(NH1, hN, [h1GoalIx('D', HEX_EDGES.D)]);
    rep('bfs', ++done, NTBL);
    if (yieldNow) await yieldNow();
    return out;
  }

  // browser entry: cache the Int8 tables in IndexedDB, rebuild on miss
  const PDB_FAMS = [
    ['rA', Object.keys(A_SETS), NPAT], ['rC', Object.keys(C_SETS), NCORNER],
    ['E3', Object.keys(HEX_EDGES), NE3], ['H1', ['D'], NH1],
  ];
  async function loadOrBuildPDBs(E, report, tick) {
    const cached = await idbGet(KEY_PDB);
    if (cached && cached.v === KEY_PDB && PDB_FAMS.every(([fam]) => cached[fam])) {
      try {
        const out = {};
        let ok = true;
        for (const [fam, keys, n] of PDB_FAMS) {
          out[fam] = {};
          for (const k of keys) {
            out[fam][k] = new Int8Array(cached[fam][k]);
            if (out[fam][k].length !== n) ok = false;
          }
        }
        if (ok) {
          if (report) report('cache', 1, 1);
          return out;
        }
      } catch (e) { /* fall through to rebuild */ }
    }
    const out = await buildPDBs(E, report, tick);
    const payload = { v: KEY_PDB };
    for (const [fam] of PDB_FAMS) {
      payload[fam] = {};
      for (const k of Object.keys(out[fam])) payload[fam][k] = out[fam][k].buffer;
    }
    idbPut(KEY_PDB, payload);
    // retired PDB caches (v5 was ~10 MB; earlier keys shipped 2026-07-13/14)
    for (const old of ['fto-pdb-v2', 'fto-pdb-v3', 'fto-pdb-v4', 'fto-pdb-v5']) idbDel(old);
    return out;
  }

  // ---------------- first-center trainer table (post-M5 step trainers) ----------------
  // The Bencisco FIRST CENTER as a standalone drill goal: the WHITE hexagon
  // (U's 3 edge pieces + the 3 white centre triangles) formed on ANY tetrad-A
  // face, edges in a rotation-valid order. Unlike the solver's fixed-frame
  // H1['D'] this goal is placement-neutral: a first center is correct iff the
  // white-piece arrangement is the restriction of some tetrad-preserving
  // PROPER rotation image of solved — 12 formations (3 per candidate face).
  // The other 3 all-white edge orders per face are the IMPROPER (mirror)
  // restrictions: visually complete hexagons that no finished solve can
  // contain (false solves) — and they sit at exactly God's number in both
  // metrics (pinned in tools/test-trainer.mjs, derivation 2026-07-13).
  //
  // Coordinate: (ordered placement of U's 3 edges, 1,320) x (white-triangle
  // mask over orbit A, 220) = 290,400 — the H1 shape on the white family.
  // Two unit-cost metrics, both exact BFS (multi-source over the 12 goals):
  //   dist16  16 native face moves;                     God's number 7
  //   dist24  + the 8 slice turns at unit cost (the     God's number 6
  //           sheets' countMoves convention: Xs is one move)
  // Built on demand in < 1 s (no IndexedDB cache needed) by the trainer page.
  function buildFirstCenter(E) {
    // U's edge slots/pieces and the tetrad-A face blocks
    const U_EDGES = E.EDGES.map((e, i) => (e[2] === 0 ? i : -1)).filter(i => i >= 0);
    if (U_EDGES.length !== 3) throw new Error('fc: U edge set ' + U_EDGES);
    const edgeImg = (M, e) => {
      const a = E.vertImg(M, E.EDGES[e][0]), b = E.vertImg(M, E.EDGES[e][1]);
      const lo = Math.min(a, b), hi = Math.max(a, b);
      return E.EDGES.findIndex(q => q[0] === lo && q[1] === hi);
    };
    const placeIx = (pos) => {               // placement index from positions (piece order)
      const ep = new Array(12).fill(-1);
      for (let i = 0; i < 3; i++) ep[pos[i]] = U_EDGES[i];
      return edgePlaceIndex(ep, U_EDGES);
    };
    // goals: proper tetrad-preserving rotations; mirrors: the improper images
    const T12 = E.ROT24.filter(M => E.faceImg(M, 0) < 4);
    if (T12.length !== 12) throw new Error('fc: T12 size ' + T12.length);
    const coordFor = (M) => {
      const X = E.faceImg(M, 0);
      return placeIx(U_EDGES.map(q => edgeImg(M, q))) * NMASK + maskIndex(3 * X, 3 * X + 1, 3 * X + 2);
    };
    const goals = [...new Set(T12.map(coordFor))];
    const mirrors = [...new Set(E.ROT24.map(R => E.mul(E.MIRROR, R))
      .filter(M => E.faceImg(M, 0) < 4).map(coordFor))];
    if (goals.length !== 12 || mirrors.length !== 12) throw new Error('fc: goal/mirror count');
    const goalSet = new Set(goals);
    if (mirrors.some(c => goalSet.has(c))) throw new Error('fc: mirror overlaps goals');

    // transitions: 3-edge placements (positions move by the inverse pull perm)
    // and the white mask over orbit-A slots
    const eNext = new Int32Array(NE3 * 16);
    {
      const ie = E.moveTables.map(t => {
        const inv = new Array(12);
        for (let s = 0; s < 12; s++) inv[t.eperm[s]] = s;
        return inv;
      });
      const np = new Array(3);
      for (let ix = 0; ix < NE3; ix++) {
        const pos = edgePlaceUnrank(ix, 3);
        for (let m = 0; m < 16; m++) {
          const q = ie[m];
          for (let i = 0; i < 3; i++) np[i] = q[pos[i]];
          let v = 0, base = 12;
          for (let i = 0; i < 3; i++) {
            let r = np[i];
            for (let j = 0; j < i; j++) if (np[j] < np[i]) r--;
            v = v * base + r; base--;
          }
          eNext[ix * 16 + m] = v;
        }
      }
    }
    const mNext = new Int32Array(NMASK * 16);
    {
      const xpA = E.moveTables.map(t => {
        const p = new Array(12);
        for (let i = 0; i < 12; i++) {
          if (t.xperm[i] >= 12) throw new Error('fc: orbit A not closed');
          p[i] = t.xperm[i];
        }
        return p;
      });
      const pat = new Array(12);
      for (let p0 = 0; p0 < 12; p0++) for (let p1 = p0 + 1; p1 < 12; p1++) for (let p2 = p1 + 1; p2 < 12; p2++) {
        pat.fill(0); pat[p0] = 1; pat[p1] = 1; pat[p2] = 1;
        const ix = maskIndex(p0, p1, p2);
        for (let m = 0; m < 16; m++) {
          const q = xpA[m];
          let a = -1, b = -1, c = -1;
          for (let i = 0; i < 12; i++) if (pat[q[i]]) { if (a < 0) a = i; else if (b < 0) b = i; else c = i; }
          mNext[ix * 16 + m] = maskIndex(a, b, c);
        }
      }
    }
    const stepNative = (c, m) => eNext[((c / NMASK) | 0) * 16 + m] * NMASK + mNext[(c % NMASK) * 16 + m];

    // generators: 16 native (axis rank 0 = tetrad-A face, 2 = tetrad-B face)
    // + 8 slices (rank 1; Xs cw = X' then OPP(X), the engine's pinned desugar).
    // axis = the pair's tetrad-A face; ranks canonicalize commuting same-axis
    // runs during solution enumeration (all three layers of an axis commute).
    const GENS = [];
    for (let m = 0; m < 16; m++) {
      const f = m >> 1;
      GENS.push({ tok: E.MOVES[m], moves: [m], axis: f < 4 ? f : E.OPPF[f], rank: f < 4 ? 0 : 2 });
    }
    for (const f of ['U', 'F', 'R', 'L']) {
      const fi = E.FIDX[f], op = E.OPPF[fi], axis = fi < 4 ? fi : op;
      GENS.push({ tok: f + 's', moves: [2 * fi + 1, 2 * op], axis, rank: 1 });
      GENS.push({ tok: f + "s'", moves: [2 * fi, 2 * op + 1], axis, rank: 1 });
    }
    const stepGen = (c, gi) => { for (const m of GENS[gi].moves) c = stepNative(c, m); return c; };

    // goal closure under the landing face's own turns (structural self-check)
    for (const c of goals) {
      const X = decMaskFace(c % NMASK);
      for (const d of [0, 1]) if (!goalSet.has(stepNative(c, 2 * X + d))) throw new Error('fc: goal not closed');
    }
    function decMaskFace(mk) {              // which face block a 3-slot mask fills (or -1)
      for (let X = 0; X < 4; X++) if (mk === maskIndex(3 * X, 3 * X + 1, 3 * X + 2)) return X;
      return -1;
    }

    // multi-source BFS, both metrics
    const bfsFc = (nGens) => {
      const dist = new Int8Array(NH1).fill(-1);
      let frontier = [];
      for (const g of goals) { dist[g] = 0; frontier.push(g); }
      const hist = [frontier.length];
      let d = 0;
      while (frontier.length) {
        const nf = [];
        for (const c of frontier) {
          for (let gi = 0; gi < nGens; gi++) {
            const t = stepGen(c, gi);
            if (dist[t] < 0) { dist[t] = d + 1; nf.push(t); }
          }
        }
        d++;
        if (nf.length) hist.push(nf.length);
        frontier = nf;
      }
      if (hist.reduce((x, y) => x + y, 0) !== NH1) throw new Error('fc: unreachable coordinates');
      return { dist, hist };
    };
    const b16 = bfsFc(16), b24 = bfsFc(GENS.length);

    const coordOf = (s) => edgePlaceIndex(s.ep, U_EDGES) * NMASK + maskOfColor(s.ctr, 0);
    return {
      N: NH1, U_EDGES, GENS, goals, goalSet, mirrors, T12,
      dist16: b16.dist, dist24: b24.dist,
      gn16: b16.hist.length - 1, gn24: b24.hist.length - 1,
      hist16: b16.hist, hist24: b24.hist,
      coordOf, stepNative, stepGen, landingFace: (c) => decMaskFace(c % NMASK),
    };
  }

  // ---------------- first-two-triples trainer tables (step trainers v2) ----------------
  // The F2T drill's target is the TRUE turn count: re-grips are free
  // rotations, and with free re-grips every sealed native move
  // ({U, L, R, D, B}± in the method frame) is exactly ONE hold token from
  // every grip — so the fair, unbeatable optimal is plain BFS distance over
  // those 10 moves. That is NOT the solver's search metric: its +1 reading
  // penalty on re-grip composites can prefer a plainer word one turn longer,
  // and a table in that metric would overestimate here (inadmissible). These
  // are the same goal sets as the solver's rA/rC families, rebuilt in the
  // 10-move turn metric; UNREACHED marks sealed-unreachable coordinates
  // (cannot occur for drill states, which sealed walks generate).
  function bfsTableSealed(n, next, goals, moves) {
    const dist = new Int8Array(n).fill(-1);
    let frontier = [];
    for (const g of goals) if (dist[g] < 0) { dist[g] = 0; frontier.push(g); }
    let d = 0;
    while (frontier.length) {
      const nf = [];
      for (const s of frontier) {
        const row = s * 16;
        for (const m of moves) {
          const t = next[row + m];
          if (dist[t] < 0) { dist[t] = d + 1; nf.push(t); }
        }
      }
      d++;
      frontier = nf;
    }
    for (let i = 0; i < n; i++) if (dist[i] < 0) dist[i] = UNREACHED;
    return dist;
  }

  const KEY_F2T = 'fto-f2t-v1';
  const F2T_FAMS = [['dA', Object.keys(A_SETS), NPAT], ['dC', Object.keys(C_SETS), NCORNER]];
  // the bundle carries the codecs the drill layer indexes with (the
  // buildFirstCenter convention: consumers get one self-sufficient object)
  const f2tShape = (bl) => ({ BL: bl, dA: {}, dC: {}, encA, cornerIndex });
  async function buildF2T(E, tick) {
    const bl = makeBLHold(E);
    const out = f2tShape(bl);
    const mA = await buildOrbitMtable(E, 'A', tick || null);
    for (const key of Object.keys(A_SETS))
      out.dA[key] = bfsTableSealed(NPAT, mA, orbitGoals('A', A_SETS[key]), bl.SEALED_MOVES);
    const mC = buildCornerMtable(E);
    for (const key of Object.keys(C_SETS))
      out.dC[key] = bfsTableSealed(NCORNER, mC, cornerGoals(C_SETS[key]), bl.SEALED_MOVES);
    return out;
  }
  async function loadOrBuildF2T(E, tick) {
    const cached = await idbGet(KEY_F2T);
    if (cached && cached.v === KEY_F2T) {
      try {
        const out = f2tShape(makeBLHold(E));
        let ok = true;
        for (const [fam, keys, n] of F2T_FAMS) {
          for (const k of keys) {
            out[fam][k] = new Int8Array(cached[fam][k]);
            if (out[fam][k].length !== n) ok = false;
          }
        }
        if (ok) return out;
      } catch (e) { /* fall through to rebuild */ }
    }
    const out = await buildF2T(E, tick);
    const payload = { v: KEY_F2T };
    for (const [fam, keys] of F2T_FAMS) {
      payload[fam] = {};
      for (const k of keys) payload[fam][k] = out[fam][k].buffer;
    }
    idbPut(KEY_F2T, payload);
    return out;
  }

  // ---------------- second/third-center trainer tables (step trainers v3) ----------------
  // The Centers drill (second/third Bencisco centers) measures its target in
  // the RESTRICTED triple-preserving metric (user spec 2026-07-16: once the
  // triples are in, nothing may ever take them out of place, and no mid-solve
  // rotations — Rw does the re-gripping). Machine-derived and init-asserted
  // by makeRestricted below:
  //   - the solved block (white hexagon + both bottom triples: corner slots
  //     {3,5}, edge slots {9,10,11}, ctr slots {5,6,8,9} + {18,19,20}) is
  //     fixed by engine U± and by exactly ONE of {L,R,B}± per block position
  //     (the WORKING face); engine D± moves the whole block RIGIDLY, so
  //     block(b) = D^b(home) for b = the net engine-D power applied.
  //   - the hold spells these as {R, U, Rw}: R = engine U, U = the grip's
  //     plain U — and Rw's grip drift tracks the block position EXACTLY, so
  //     from the one aligned entry grip the U token is always the working
  //     face. BL (engine D in place, no drift) breaks that alignment — the
  //     next U token would hit a triple — and BL commutes with every token
  //     still legal after it, so optimal restricted words never need it:
  //     the center alphabet is exactly {R, U, Rw}, no brackets, no BL.
  //   - a restricted word therefore NEVER moves the triples (or the white
  //     center relative to them); the white center is exactly home iff the
  //     net drift b is 0. Search nodes are (coordinate, b) and every goal
  //     lives at b = 0. All 42,336 sealed-reachable one-hexagon cells stay
  //     reachable at every b (machine-checked) — no drill becomes
  //     unsolvable, only the optimal grows (one-hexagon ecc 12 -> 16).
  // What the bundle carries (distances over (cell, b), Int8, sentinel 99):
  //   dH1[f]    f in L/R/B — one-hexagon EXACT distances over the H1
  //             coordinate x b (3-edge placement x color mask x 3, 871,200)
  //   dE33[fg]  hexagon-pair edges over (e3 x e3 x 3) — the exact 6-edge
  //             coupling keyed by the two carried e3 indices and b
  //   dB[f|all] orbit-B triangle distances over (mask pair x 3): one face's
  //             block solved / the whole orbit solved (two hexagon blocks +
  //             D force the third, so every pair goal collapses to 'all')
  //   RES       the restricted system: entry grip j0, working face XF[b],
  //             move rows MOVES[b] ([native move, b-shift] pairs), block
  //             slot images SLOTS[b], reference features REF[b]
  //   rt        Int32 transition tables the drill DFS steps indices with
  //             (mE3 3-edge placements, mMB orbit-B masks)
  //   MKB/MBITS mask-pair -> complement-mask / mask -> 12-bit occupancy
  //   HOME      goal cells for every carried index
  // The triples' own tables (dC/dA/dAm) are GONE from this drill: restricted
  // words cannot disturb the triples, so there is nothing to prune or
  // re-check below the b counter. dH1 + dE33 persist (~18 MB); everything
  // else rebuilds in well under a second. (v1 was the sealed 10-move metric
  // with {R,U,Rw,BL} + free re-grip brackets — retired 2026-07-16.)
  const KEY_C23 = 'fto-c23-v2';
  const C23_H1 = ['L', 'R', 'B'];
  const C23_E33 = ['LR', 'LB', 'RB'];
  const NE33 = NE3 * NE3;
  const NMK2 = NMASK * NMASK;
  const C23_FAMS = [['dH1', C23_H1, NH1 * 3], ['dE33', C23_E33, NE33 * 3]];
  const MBITS = (() => {                    // mask index -> 12-bit slot occupancy
    const bits = new Int32Array(NMASK);
    for (let a = 0; a < 12; a++) for (let b = a + 1; b < 12; b++) for (let c = b + 1; c < 12; c++)
      bits[maskIndex(a, b, c)] = (1 << a) | (1 << b) | (1 << c);
    return bits;
  })();

  function maskMtable(E, orbit) {           // per-color mask transitions (one orbit)
    const off = orbit === 'A' ? 0 : 12;
    const xp = E.moveTables.map(t => {
      const p = new Array(12);
      for (let i = 0; i < 12; i++) p[i] = t.xperm[off + i] - off;
      return p;
    });
    const next = new Int32Array(NMASK * 16);
    const pat = new Array(12);
    for (let p0 = 0; p0 < 12; p0++) for (let p1 = p0 + 1; p1 < 12; p1++) for (let p2 = p1 + 1; p2 < 12; p2++) {
      pat.fill(0); pat[p0] = 1; pat[p1] = 1; pat[p2] = 1;
      const ix = maskIndex(p0, p1, p2);
      for (let m = 0; m < 16; m++) {
        const q = xp[m];
        let a = -1, b = -1, c = -1;
        for (let i = 0; i < 12; i++) if (pat[q[i]]) { if (a < 0) a = i; else if (b < 0) b = i; else c = i; }
        next[ix * 16 + m] = maskIndex(a, b, c);
      }
    }
    return next;
  }

  // The restricted (triple-preserving) move system, derived from the
  // engine's own tables and ASSERTED — a bad engine change throws at load,
  // not per drill. See the section comment above for the derivation.
  function makeRestricted(E, bl) {
    const FIDX = E.FIDX;
    const wantU = [FIDX.L, FIDX.R, FIDX.B];      // grip j's plain U (makeBLHold pin)
    const inv = (p) => { const q = new Array(p.length); for (let i = 0; i < p.length; i++) q[p[i]] = i; return q; };
    const dT = E.moveTables[2 * FIDX.D];
    const cI = inv(dT.cperm), eI = inv(dT.eperm), xI = inv(dT.xperm);
    // block slot images per position b (positions move by the inverse pull perm)
    const SLOTS = [];
    {
      let c = [3, 5], e = [9, 10, 11], x = [5, 6, 8, 9, 18, 19, 20];
      for (let b = 0; b < 3; b++) {
        SLOTS.push({ c, e, x });
        c = c.map((v) => cI[v]); e = e.map((v) => eI[v]); x = x.map((v) => xI[v]);
      }
    }
    const fixesBlock = (m, S) => {
      const t = E.moveTables[m];
      return S.c.every((v) => t.cperm[v] === v && t.cflip[v] === 0) &&
             S.e.every((v) => t.eperm[v] === v) && S.x.every((v) => t.xperm[v] === v);
    };
    const XF = SLOTS.map((S, b) => {
      if (!fixesBlock(2 * FIDX.U, S) || !fixesBlock(2 * FIDX.U + 1, S))
        throw new Error('c23: engine U does not fix block(' + b + ')');
      const fs = wantU.filter((f) => fixesBlock(2 * f, S) && fixesBlock(2 * f + 1, S));
      if (fs.length !== 1) throw new Error('c23: working face at b=' + b + ': ' + fs);
      return fs[0];
    });
    const j0 = wantU.indexOf(XF[0]);
    for (let b = 0; b < 3; b++) {
      // alignment: the grip Rw-drift reaches at position b reads the working face
      if (XF[b] !== wantU[(j0 + b) % 3]) throw new Error('c23: grip/block misalignment at b=' + b);
      const j = (j0 + b) % 3, rw = bl.gen[j][4], rwp = bl.gen[j][5];
      if (rw.m !== 2 * FIDX.D || rw.nj !== (j + 1) % 3 ||
          rwp.m !== 2 * FIDX.D + 1 || rwp.nj !== (j + 2) % 3)
        throw new Error('c23: Rw drift direction mismatch at grip ' + j);
    }
    // move rows per position: [native move, b-shift]; D cw advances b by 1
    const MOVES = XF.map((xf) => [
      [2 * FIDX.U, 0], [2 * FIDX.U + 1, 0], [2 * xf, 0], [2 * xf + 1, 0],
      [2 * FIDX.D, 1], [2 * FIDX.D + 1, 2],
    ]);
    // block reference features per position (D^b of solved, block slots only)
    const REF = [];
    {
      let s = E.solved();
      for (let b = 0; b < 3; b++) {
        const S = SLOTS[b];
        REF.push({
          ep: S.e.map((v) => s.ep[v]),
          cp: S.c.map((v) => s.cp[v]), co: S.c.map((v) => s.co[v]),
          ctr: S.x.map((v) => s.ctr[v]),
        });
        s = E.move(s, 2 * FIDX.D);
      }
    }
    return { j0, XF, MOVES, SLOTS, REF };
  }

  // BFS over (cell, b) in the restricted metric: step(cell, m) -> cell', the
  // move rows come from RES.MOVES[b] (closed under inverse with mirrored
  // b-shifts, so BFS from the goals is distance-to-goal). Goals live at b=0.
  function bfsTableRes(n, step, goals, MOVES) {
    const dist = new Int8Array(n * 3).fill(-1);
    let frontier = [];
    for (const g of goals) if (dist[g * 3] < 0) { dist[g * 3] = 0; frontier.push(g * 3); }
    let d = 0;
    while (frontier.length) {
      const nf = [];
      for (const u of frontier) {
        const cell = (u / 3) | 0, b = u % 3, row = MOVES[b];
        for (let k = 0; k < 6; k++) {
          const v = step(cell, row[k][0]) * 3 + (b + row[k][1]) % 3;
          if (dist[v] < 0) { dist[v] = d + 1; nf.push(v); }
        }
      }
      d++;
      frontier = nf;
    }
    for (let i = 0; i < n * 3; i++) if (dist[i] < 0) dist[i] = UNREACHED;
    return dist;
  }

  // runtime part of the bundle: hold, restricted system, transitions, tiny
  // tables, goal cells
  async function c23Runtime(E) {
    const bl = makeBLHold(E);
    const RES = makeRestricted(E, bl);
    const mE3 = await buildEdgeMtable(E, 3, null);
    const mMB = maskMtable(E, 'B');
    // mask-pair complement: (L-mask, R-mask) -> B-mask, given the D block
    // {6,7,8} sealed-fixed; 255 marks pairs no sealed state realizes
    const B2M = new Int32Array(4096).fill(-1);
    for (let ix = 0; ix < NMASK; ix++) B2M[MBITS[ix]] = ix;
    const D_BITS = (1 << 6) | (1 << 7) | (1 << 8);
    const MKB = new Uint8Array(NMK2).fill(255);
    for (let l = 0; l < NMASK; l++) {
      const bL = MBITS[l];
      if (bL & D_BITS) continue;
      for (let r = 0; r < NMASK; r++) {
        const bR = MBITS[r];
        if ((bR & D_BITS) || (bL & bR)) continue;
        MKB[l * NMASK + r] = B2M[0xfff & ~(bL | bR | D_BITS)];
      }
    }
    const home = Array.from({ length: 12 }, (_, i) => i);
    const HOME = {
      eL: edgePlaceIndex(home, HEX_EDGES.L),
      eR: edgePlaceIndex(home, HEX_EDGES.R), eB: edgePlaceIndex(home, HEX_EDGES.B),
      mL: maskIndex(0, 1, 2), mR: maskIndex(3, 4, 5), mB: maskIndex(9, 10, 11),
    };
    // orbit-B mask-pair tables: step both masks through mMB
    const stepMK2 = (u, m) => mMB[((u / NMASK) | 0) * 16 + m] * NMASK + mMB[(u % NMASK) * 16 + m];
    const dB = {};
    const mkGoals = (want) => {
      const goals = [];
      for (let u = 0; u < NMK2; u++) if (want((u / NMASK) | 0, u % NMASK)) goals.push(u);
      return goals;
    };
    dB.L = bfsTableRes(NMK2, stepMK2, mkGoals((l) => l === HOME.mL), RES.MOVES);
    dB.R = bfsTableRes(NMK2, stepMK2, mkGoals((l, r) => r === HOME.mR), RES.MOVES);
    dB.B = bfsTableRes(NMK2, stepMK2, mkGoals((l, r) => MKB[l * NMASK + r] === HOME.mB), RES.MOVES);
    dB.all = bfsTableRes(NMK2, stepMK2, [HOME.mL * NMASK + HOME.mR], RES.MOVES);
    return { BL: bl, RES, rt: { mE3, mMB }, MKB, MBITS, HOME, dB,
             HEX_EDGES, edgePlaceIndex, maskOfColor };
  }

  async function buildC23(E, tick) {
    const out = await c23Runtime(E);
    const RES = out.RES;
    // hexagon-pair 6-edge coupling over (e3 x e3 x b)
    const mE3 = out.rt.mE3;
    const stepE33 = (u, m) => mE3[((u / NE3) | 0) * 16 + m] * NE3 + mE3[(u % NE3) * 16 + m];
    out.dE33 = {};
    const eHome = { L: out.HOME.eL, R: out.HOME.eR, B: out.HOME.eB };
    for (const fg of C23_E33) {
      out.dE33[fg] = bfsTableRes(NE33, stepE33, [eHome[fg[0]] * NE3 + eHome[fg[1]]], RES.MOVES);
      if (tick) await tick();
    }
    // one-hexagon exact tables (edges x mask coupling x b)
    const hN = h1Next(E, mE3);
    out.dH1 = {};
    for (const f of C23_H1) {
      out.dH1[f] = bfsTableRes(NH1, (c, m) => hN[c * 16 + m], [h1GoalIx(f, HEX_EDGES[f])], RES.MOVES);
      if (tick) await tick();
    }
    return out;
  }
  async function loadOrBuildC23(E, tick) {
    const cached = await idbGet(KEY_C23);
    if (cached && cached.v === KEY_C23) {
      try {
        const out = await c23Runtime(E);
        let ok = true;
        for (const [fam, keys, n] of C23_FAMS) {
          out[fam] = {};
          for (const k of keys) {
            out[fam][k] = new Int8Array(cached[fam][k]);
            if (out[fam][k].length !== n) ok = false;
          }
        }
        if (ok) return out;
      } catch (e) { /* fall through to rebuild */ }
    }
    const out = await buildC23(E, tick);
    const payload = { v: KEY_C23 };
    for (const [fam, keys] of C23_FAMS) {
      payload[fam] = {};
      for (const k of keys) payload[fam][k] = out[fam][k].buffer;
    }
    idbPut(KEY_C23, payload);
    idbDel('fto-c23-v1');                       // the retired sealed-metric cache
    return out;
  }

  module.exports = {
    idbGet, idbPut, idbDel, KEY_PDB, UNREACHED,
    NPAT, NCORNER, NE3, NE6, NMASK, NH1, A_SETS, C_SETS, HEX_EDGES,
    maskIndex, maskOfColor, h1Index,
    encPattern, decPattern, encA, encB,
    permRank, evenPermUnrank, cornerIndex, cornerUnpack,
    edgePlaceIndex, edgePlaceUnrank,
    makeBLHold, buildPDBs, loadOrBuildPDBs, buildFirstCenter,
    KEY_F2T, buildF2T, loadOrBuildF2T,
    KEY_C23, buildC23, loadOrBuildC23,
  };
  window.OOTables = module.exports;
})();
