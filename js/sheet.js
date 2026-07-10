/* Skewbiks.com — shared case-name sheet + case naming.
 *
 * Single source of the case names compiled from data/skewb_algs.json. Loaded
 * as a classic script (window.OOSheet) by the solver, and importable in builds.
 * The naming math is the engine's keying, so a state names the same on every
 * page.
 *
 *   OOSheet.SHEET                 raw sheet data:
 *     ALG:   renderKey -> [[alg, caseName], ...]   renderKey = engine stateKey (full state)
 *     NAME:  renderKey -> caseName
 *     CNAME: canonKey  -> caseName                 canonKey = engine realCanonKey (y² fold)
 *     PRES:  canonKey  -> [[renderKey, caseName], ...]
 *   OOSheet.nameForState(state)   -> case name string, or null
 *     state: { ctr:[6], fx:[4], fp:[4], fo:[4] }  (engine state)
 *
 * GENERATED DATA — the SHEET line below is written by tools/compile-sheet.mjs
 * (npm run build:sheet); edit data/skewb_algs.json, not this file.
 */
(function () {
  'use strict';

  const SHEET = {"ALG":{},"CNAME":{},"NAME":{},"PRES":{}};

  // Keying / canonicalization lives in js/engine.js (window.OOEngine) — the
  // single source of truth. Referenced lazily so engine load order never bites.
  function nameForState(state) {
    const E = window.OOEngine;
    return SHEET.NAME[E.stateKey(state)] || SHEET.CNAME[E.realCanonKey(state)] || null;
  }
  const api = { SHEET, nameForState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.OOSheet = api;
})();
