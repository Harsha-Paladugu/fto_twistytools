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
 * Tables built here (Int8 distances, BFS from every goal state over all 16
 * native moves — the move set is closed under inverse, so BFS-from-goals is
 * distance-to-goal):
 *   B[faces]  8 goal sets 'D','DL','DR','DB','DLR','DLB','DRB','DLRB' —
 *             patterns whose slots on those faces show the face's own color.
 *   A[slots]  '6,9' / '5,8' (single bottom-triple pairs, corner 3 / corner 5
 *             first) and '5,6,8,9' (both F2T pairs).
 *   C[set]    corner goal sets '3', '5', '3,5' over the full 11,520.
 *   E3[face]  D/L/R/B hexagon edge triples over 1,320 placements.
 *   E6[pair]  hexagon-pair 6-edge placements over 665,280 — strong lower
 *             bounds for the third/fourth center steps, where keeping two
 *             solved hexagons while building another is the whole cost.
 *   H1[face]  one-hexagon EXACT tables (3-edge placement x face-color mask,
 *             1,320 x 220 = 290,400) — couple a hexagon's edges and centres.
 * Total ≈ 7.6 MB, cached in IndexedDB ('fto-tables' / 'fto-pdb-v2'); first
 * build ≈ 10-20 s (transient move tables, freed afterwards) — inside the
 * ~10 MB / ~30 s budget, so no user checkpoint (docs/port-plan.md M5).
 */
(function () {
  const module = { exports: {} };
  const DB_NAME = 'fto-tables', STORE = 't';
  const KEY_PDB = 'fto-pdb-v2';

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
  // break-and-restore interaction entirely).
  function buildH1(E, face, edges) {
    const fi = { D: 6, L: 4, R: 5, B: 7 }[face];
    const ie = invEdgePerms(E);
    const xp = E.moveTables.map(t => {     // orbit-B slot pull perm
      const p = new Array(12);
      for (let i = 0; i < 12; i++) p[i] = t.xperm[12 + i] - 12;
      return p;
    });
    // precompute mask transitions (220 x 16) and edge3 transitions (1320 x 16)
    const mNext = new Int32Array(NMASK * 16);
    {
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
    }
    const eNext = new Int32Array(NE3 * 16);
    {
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
    // combined BFS over e3 x mask
    const home = Array.from({ length: 12 }, (_, i) => i);
    const goalE = edgePlaceIndex(home, edges);
    const k0 = 3 * (fi - 4);               // orbit-B block of the face
    const goalM = maskIndex(k0, k0 + 1, k0 + 2);
    const dist = new Int8Array(NH1).fill(-1);
    let frontier = [goalE * NMASK + goalM];
    dist[frontier[0]] = 0;
    let d = 0;
    while (frontier.length) {
      const nf = [];
      for (const s of frontier) {
        const e = (s / NMASK) | 0, mk = s % NMASK;
        for (let m = 0; m < 16; m++) {
          const t = eNext[e * 16 + m] * NMASK + mNext[mk * 16 + m];
          if (dist[t] < 0) { dist[t] = d + 1; nf.push(t); }
        }
      }
      d++;
      frontier = nf;
    }
    return dist;
  }
  function h1Index(ep, ctr, face, edges) { // solver-side index into H1[face]
    const fi = { D: 6, L: 4, R: 5, B: 7 }[face];
    let a = -1, b = -1, c = -1;
    for (let i = 0; i < 12; i++) if (ctr[12 + i] === fi) { if (a < 0) a = i; else if (b < 0) b = i; else c = i; }
    return edgePlaceIndex(ep, edges) * NMASK + maskIndex(a, b, c);
  }

  // ---------------- the PDB bundle ----------------
  // B goal sets: hexagon faces solved so far (D always first); slots within
  // orbit B are 3*(faceIndexInOrbit)+k with orbit order [L,R,D,B] = ctr slots
  // 12..23, so face L -> orbit slots 0..2, R -> 3..5, D -> 6..8, B -> 9..11
  // and colors L=0 R=1 D=2 B=3 (engine colors 4..7 minus 4).
  const B_SETS = ['D', 'DL', 'DR', 'DB', 'DLR', 'DLB', 'DRB', 'DLRB'];
  const B_FACE_SLOT = { L: 0, R: 1, D: 2, B: 3 };   // orbit-B face -> block
  // A-orbit goal slots per bottom triple: corner 3 -> {BR(6), BL(9)},
  // corner 5 -> {F(5), BR(8)}; F2T = both. Slot colors are the slot's face.
  const A_SETS = { '6,9': [[6, 2], [9, 3]], '5,8': [[5, 1], [8, 2]], '5,6,8,9': [[5, 1], [6, 2], [8, 2], [9, 3]] };
  const C_SETS = { '3': [3], '5': [5], '3,5': [3, 5] };
  const HEX_EDGES = { D: [9, 10, 11], L: [1, 2, 8], R: [0, 3, 6], B: [4, 5, 7] };
  // hexagon-pair 6-edge sets (tracked pieces ascending — codec piece order)
  const E6_PAIRS = {};
  {
    const fs = Object.keys(HEX_EDGES);
    for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++)
      E6_PAIRS[fs[i] + fs[j]] = HEX_EDGES[fs[i]].concat(HEX_EDGES[fs[j]]).sort((a, b) => a - b);
  }
  const NTBL = B_SETS.length + Object.keys(A_SETS).length + Object.keys(C_SETS).length
    + 2 * Object.keys(HEX_EDGES).length + Object.keys(E6_PAIRS).length;

  function bFaceWants(faces) {
    const wants = [];
    for (const f of faces) {
      const b = B_FACE_SLOT[f];
      for (let k = 0; k < 3; k++) wants.push([3 * b + k, b]);
    }
    return wants;
  }

  async function buildPDBs(E, report, tick) {
    const rep = (stage, n, tot) => { if (report) report(stage, n, tot); };
    const yieldNow = tick || null;
    const out = { B: {}, A: {}, C: {}, E3: {}, E6: {}, H1: {} };

    rep('mtab', 0, 4);
    const mB = await buildOrbitMtable(E, 'B', yieldNow ? async (n, t) => { rep('mtab', n / t, 4); await yieldNow(); } : null);
    let done = 0;
    for (const faces of B_SETS) {
      out.B[faces] = bfsTable(NPAT, mB, orbitGoals('B', bFaceWants(faces.split(''))));
      rep('bfs', ++done, NTBL);
      if (yieldNow) await yieldNow();
    }
    rep('mtab', 2, 4);
    const mA = await buildOrbitMtable(E, 'A', yieldNow ? async (n, t) => { rep('mtab', 2 + n / t, 4); await yieldNow(); } : null);
    for (const key of Object.keys(A_SETS)) {
      out.A[key] = bfsTable(NPAT, mA, orbitGoals('A', A_SETS[key]));
      rep('bfs', ++done, NTBL);
      if (yieldNow) await yieldNow();
    }
    const mC = buildCornerMtable(E);
    for (const key of Object.keys(C_SETS)) {
      out.C[key] = bfsTable(NCORNER, mC, cornerGoals(C_SETS[key]));
      rep('bfs', ++done, NTBL);
    }
    const mE3 = await buildEdgeMtable(E, 3, yieldNow);
    const home = Array.from({ length: 12 }, (_, i) => i);
    for (const f of Object.keys(HEX_EDGES)) {
      // goal: the face's 3 edges in their home slots (one placement index)
      out.E3[f] = bfsTable(NE3, mE3, [edgePlaceIndex(home, HEX_EDGES[f])]);
      rep('bfs', ++done, NTBL);
      if (yieldNow) await yieldNow();
    }
    rep('mtab', 3, 4);
    const mE6 = await buildEdgeMtable(E, 6, yieldNow ? async () => { rep('mtab', 3.5, 4); await yieldNow(); } : null);
    for (const key of Object.keys(E6_PAIRS)) {
      // goal: both hexagons' 6 edges home (one placement index)
      out.E6[key] = bfsTable(NE6, mE6, [edgePlaceIndex(home, E6_PAIRS[key])]);
      rep('bfs', ++done, NTBL);
      if (yieldNow) await yieldNow();
    }
    for (const f of Object.keys(HEX_EDGES)) {
      out.H1[f] = buildH1(E, f, HEX_EDGES[f]);
      rep('bfs', ++done, NTBL);
      if (yieldNow) await yieldNow();
    }
    return out;
  }

  // browser entry: cache the Int8 tables in IndexedDB, rebuild on miss
  async function loadOrBuildPDBs(E, report, tick) {
    const cached = await idbGet(KEY_PDB);
    if (cached && cached.v === KEY_PDB && cached.B && cached.A && cached.C && cached.E3 && cached.E6 && cached.H1) {
      try {
        const out = { B: {}, A: {}, C: {}, E3: {}, E6: {}, H1: {} };
        for (const k of B_SETS) out.B[k] = new Int8Array(cached.B[k]);
        for (const k of Object.keys(A_SETS)) out.A[k] = new Int8Array(cached.A[k]);
        for (const k of Object.keys(C_SETS)) out.C[k] = new Int8Array(cached.C[k]);
        for (const k of Object.keys(HEX_EDGES)) out.E3[k] = new Int8Array(cached.E3[k]);
        for (const k of Object.keys(E6_PAIRS)) out.E6[k] = new Int8Array(cached.E6[k]);
        for (const k of Object.keys(HEX_EDGES)) out.H1[k] = new Int8Array(cached.H1[k]);
        if (Object.values(out.B).every(t => t.length === NPAT) &&
            Object.values(out.A).every(t => t.length === NPAT) &&
            Object.values(out.C).every(t => t.length === NCORNER) &&
            Object.values(out.E3).every(t => t.length === NE3) &&
            Object.values(out.E6).every(t => t.length === NE6) &&
            Object.values(out.H1).every(t => t.length === NH1)) {
          if (report) report('cache', 1, 1);
          return out;
        }
      } catch (e) { /* fall through to rebuild */ }
    }
    const out = await buildPDBs(E, report, tick);
    const payload = { v: KEY_PDB, B: {}, A: {}, C: {}, E3: {}, E6: {}, H1: {} };
    for (const k of Object.keys(out.B)) payload.B[k] = out.B[k].buffer;
    for (const k of Object.keys(out.A)) payload.A[k] = out.A[k].buffer;
    for (const k of Object.keys(out.C)) payload.C[k] = out.C[k].buffer;
    for (const k of Object.keys(out.E3)) payload.E3[k] = out.E3[k].buffer;
    for (const k of Object.keys(out.E6)) payload.E6[k] = out.E6[k].buffer;
    for (const k of Object.keys(out.H1)) payload.H1[k] = out.H1[k].buffer;
    idbPut(KEY_PDB, payload);
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

  module.exports = {
    idbGet, idbPut, idbDel, KEY_PDB,
    NPAT, NCORNER, NE3, NE6, NMASK, NH1, B_SETS, A_SETS, C_SETS, HEX_EDGES, E6_PAIRS,
    maskIndex, maskOfColor, h1Index,
    encPattern, decPattern, encA, encB,
    permRank, evenPermUnrank, cornerIndex, cornerUnpack,
    edgePlaceIndex, edgePlaceUnrank,
    buildPDBs, loadOrBuildPDBs, buildFirstCenter,
  };
  window.OOTables = module.exports;
})();
