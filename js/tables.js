/* Skewbiks.com — shared BFS table cache (window.OOTables).
 *
 * The OO census (js/oo.js) and the method solver (js/solver.js) both need the
 * BFS distance table over the full no-tips state space; the census also needs the
 * canonical-class tables (reps + depths). These used to be duplicated in both
 * files AND cached under one IndexedDB key ('oo-tables-v1') with two different
 * value shapes ({dist} vs {dist,reps,depths}). This module is the single owner of
 * that cache, with SEPARATE keys per shape so they can't collide:
 *
 *   oo-dist-v1     -> { dist }                  (built by either page, reused by both)
 *   oo-classes-v2  -> { reps, depths }          (census only; 24-sym fold, 131,391 classes)
 *
 * Loaded as a classic browser script before js/oo.js / js/solver.js. The engine
 * (window.OOEngine) is passed in, so this file has no load-order dep on it beyond
 * being called after the engine exists.
 *
 * report(stage, n, total): optional progress callback; stage is 'cache' | 'bfs' |
 *   'classes'. tick: optional async yield (so the boot UI can paint).
 */
(function () {
  const module = { exports: {} };
  const DB_NAME = 'skewbiks-oo', STORE = 't';
  const KEY_DIST = 'oo-dist-v1';        // { dist: ArrayBuffer }
  // v2: classes fold all 24 symmetries (12 rotations + 12 mirrors) -> 131,391
  // classes; v1 folded rotations only (262,674) and is deleted on sight.
  const KEY_CLASSES = 'oo-classes-v2';  // { reps: ArrayBuffer, depths: ArrayBuffer }
  const KEY_CLASSES_V1 = 'oo-classes-v1';
  const REACHABLE = 3149280;            // progress denominator (reachable states)

  function openDB() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(key) {
    if (!('indexedDB' in window)) return null;
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
    if (!('indexedDB' in window)) return;
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
    if (!('indexedDB' in window)) return;
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

  // BFS over the full state space -> Int8Array distance table. Cached under KEY_DIST.
  async function loadOrBuildDist(E, report, tick) {
    const cached = await idbGet(KEY_DIST);
    if (cached && cached.dist) { if (report) report('cache', 1, 1); return new Int8Array(cached.dist); }
    const dist = new Int8Array(E.NSLOTS).fill(-1);
    let frontier = new Uint32Array([E.idx(E.solved())]);
    dist[frontier[0]] = 0;
    let d = 0, seen = 1;
    while (frontier.length) {
      const next = [];
      for (let fi = 0; fi < frontier.length; fi++) {
        const s = E.unidx(frontier[fi]);
        for (let m = 0; m < E.MOVES.length; m++) {
          const t2 = E.copy(s); E.applyMoveIdx(t2, m);
          const ix = E.idx(t2);
          if (dist[ix] === -1) { dist[ix] = d + 1; next.push(ix); }
        }
        if ((fi & 8191) === 8191) { if (report) report('bfs', seen + next.length, REACHABLE); if (tick) await tick(); }
      }
      d++; seen += next.length;
      frontier = Uint32Array.from(next);
      if (report) report('bfs', seen, REACHABLE);
      if (tick) await tick();
    }
    idbPut(KEY_DIST, { dist: dist.buffer });
    return dist;
  }

  // Canonical-class enumeration (requires dist) -> { reps:Uint32Array, depths:Uint8Array }.
  // Classes fold the full 24-element symmetry group (12 rotations + 12 mirror
  // images), so a position and its mirror are ONE class: 131,391 classes
  // (oracle: tools/verify-space.mjs). Cached under KEY_CLASSES.
  async function loadOrBuildClassTables(E, dist, report, tick) {
    idbDel(KEY_CLASSES_V1); // reclaim the stale rotation-only table (~1.3 MB)
    const cached = await idbGet(KEY_CLASSES);
    if (cached && cached.reps && cached.depths) {
      if (report) report('cache', 1, 1);
      return { reps: new Uint32Array(cached.reps), depths: new Uint8Array(cached.depths) };
    }
    // Ascending orbit sweep: the first unvisited reachable index is its
    // 24-orbit's minimum, i.e. the class rep. Identical reps/depths to
    // canonicalizing every state (verified in Node against makeFullCanon),
    // at ~1/24 the symmetry applications: 131,391 reps x 24 instead of
    // 3,149,280 states x 24.
    const syms = E.buildSyms().all;
    const visited = new Uint8Array(E.NSLOTS);
    const reps = [], depths = [];
    for (let i = 0; i < E.NSLOTS; i++) {
      if ((i & 65535) === 65535) { if (report) report('classes', i, E.NSLOTS); if (tick) await tick(); }
      if (dist[i] < 0 || visited[i]) continue;
      const s = E.unidx(i);
      for (const sym of syms) visited[E.idx(sym.apply(s))] = 1;
      reps.push(i); depths.push(dist[i]);
    }
    const repsArr = Uint32Array.from(reps), depthsArr = Uint8Array.from(depths);
    if (report) report('classes', E.NSLOTS, E.NSLOTS);
    idbPut(KEY_CLASSES, { reps: repsArr.buffer, depths: depthsArr.buffer });
    return { reps: repsArr, depths: depthsArr };
  }

  module.exports = { idbGet, idbPut, idbDel, loadOrBuildDist, loadOrBuildClassTables, KEY_DIST, KEY_CLASSES };
  window.OOTables = module.exports;
})();
