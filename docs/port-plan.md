# Skewbiks.com port plan and status

The approved milestone plan for porting the pyraminx-oo codebase to the Skewb, with live
status. Companion doc: `skewb-ground-truth.md` (machine-verified domain facts + sources).
User-facing decisions already made: fork (not monorepo); v1 = Home + OO census + Algorithms
+ Trainer + Method solver; trainer = three tools (case/alg drill, full-solve timer +
analysis, case recognition) as modes of one bundle; solver method lineup decided at M7;
new Firebase project; domain skewbiks.com (GitHub Pages, CNAME).

## Status

- [x] **M0 — Bootstrap** (`84416fd`): identity fork (titles/OG/wordmark/CNAME/robots/
  sitemap/package.json), demo-mode config, LF-normalized tree, `upstream` remote.
- [x] **M1 — Engine** (`b303ad9`): Skewb `js/engine.js` behind the identical
  `window.OOEngine` surface. State `{ctr[6], fx[4], fp[4], fo[4]}`; native moves = axis
  tetrad {UBR, UFL, DFR, DBL}; written WCA `B` (free corner DBR) + `x/y/z` resolve through
  applyParsed's frame machinery; `nativeToWCA` converts solver output; case keying folds
  the y² view only (90° y swaps tetrads — NOT a state symmetry; the 4 presentations pair at
  data level via the sheet `direction` field). Dense index NSLOTS = 360×12×2187 = 9,447,840.
  Dropped from the contract: `applyMoveK`, `rotateFrame`, `openOfEkey`, `barOfEkey`, `XO`.
  Added: facelet model (`toFacelets`/`fromFacelets`/`WCA_FACELET_MOVES`), `enumFreeSlots`
  spec-object signature, `CLASS` (free-perm A4/V4 classes). `tools/test-engine.mjs` 32/32;
  `npm run test:space` matches OEIS A079745 + class oracles.
- [x] **M2/M3 — Census slice** (`4f3d057`): `js/render.js` rebuilt on the facelet model
  (net = front/back orthographic corner views; 3D cube; same 5-member contract);
  `js/tables.js` parameterized (IndexedDB `skewbiks-oo`); `js/oo.js`/`oo.html` Skewb copy.
  Verified: in-browser first build ~18 s; census shows 262,674 positions (= oracle);
  mirror pairs, 12 unique views, verified scrambles, instant cached reload.
- [ ] **M4 — Firebase.** Create project + web app + Firestore (Firebase MCP can do this);
  creds into `js/config.js`; rules bound `3732480 → 9447840` (firestore.rules :67,:69,:71),
  keep `moves <= 15` (:56); update `test/firestore.rules.test.mjs` fixtures; deploy rules.
  USER steps: enable the Google sign-in provider (console-only), sign in on oo.html, read
  uid from the About tab (uids are project-scoped — the pyraminx uid does not carry), then
  create `admins/{uid}` (MCP write bypasses rules, same as console). Gate: `npm run
  test:rules`; live submit → moderate → done-bitmap round-trip.
- [ ] **M5 — Sheet pipeline + Algorithms page + alg data v0.** USER authors
  `data/skewb_algs.json` (same schema; subsets proposal: Sarah-Intermediate/Sarah-Advanced/
  NS/FL — user confirms; `direction` = Front/Right/Back/Left y-presentations; `setup` =
  `[y]`-family). Re-key `tools/compile-sheet.mjs`/`check-sheet.mjs` through engine helpers
  only (renderKey = `stateKey`, canon = `realCanonKey` y²-fold, `prependAUF` mod-4 string
  fold); delete the L4E-merge/TL4E-split Pyraminx special cases; `data/prior-sheet.json`
  starts `{}`, `broken-algs.json` `[]`; GENERATE `data/classmap.json` from subset membership
  (stop hand-maintaining it). algs.js: keep editor machinery, replace taxonomy (SECTIONS,
  side labels, `aufAmount`→`yAmount`). Gate: `npm run build` fully green again (check-sheet
  validates every alg), grep-gate `%\s*3` only in engine internals, export round-trip.
- [ ] **M6 — Trainer.** Fork `src/trainer/l5e-trainer.jsx` → `skewb-trainer.jsx` (new
  build.mjs entry). Keep the chassis (timer, storage bridge under new key
  `skewb-trainer-v1` with legacy migrations deleted, session/recap, stats, case-picker);
  rewrite the substrate against engine coords (drop the private BFS coordinate copy —
  use `E.idx/unidx`; pools via `enumFreeSlots`; scrambles via masked BFS / `optimalScramble`).
  Three modes: drill, full-solve timer + post-solve analysis (optimal line + movecount
  stage splits via first-layer detection), case recognition (timed multiple choice at a
  random y² presentation). Gate: `build:trainer` green; each mode loops in the browser.
- [ ] **M7 — Solver.** New `METHOD_DEFS`/`METHOD_PRIORITY` in solver-core (proposal to
  confirm with user: `fl` first layer cap 7, `flm1` FL−1 cap 5, `psfl` pseudo-FL; targets
  from `enumFreeSlots` pools; frames go 12→24? NO — frames stay the engine's `makeFrames`;
  buildRotations enumerates the 12 rotation frames as before). Rebuild `ergoScore` for
  Skewb grips: keep frame machinery/alternation/min-per-state; replace thumb-dial state
  with `(frameIdx, lastHand, sameAxisRun)`; add rotation-conjugate renders (write `B` as
  `y'+R`-family). solver.js deltas: VLABEL, reconstruction wording, `SLIDER_KEYS →
  ['uCost','bCost','sameHand','altBonus','rotCost']`, delete `migrateWeights`. Solver ships
  before alg data (`caseNameOf` degrades to null). Gate: `tools/solver-lab.mjs` re-fixtured;
  every emitted solution machine-checked; sliders persist via OOAccount.
- [ ] **M8 — Launch polish.** Home copy/cards final, Skewb logo + og image + touch icon
  (headless-Edge render recipe), robots/sitemap already point at skewbiks.com, SETUP/README
  final, pre-announce checklist (deployed-rules diff, Firebase authorized domains incl.
  skewbiks.com, OG cards).

## Recorded numbers (from M1 verification — use these, don't recompute by hand)

3,149,280 reachable states; depth histogram = OEIS A079745 (max 11, 90 antipodes);
262,674 rotation classes; 131,391 mirror pairs; NSLOTS/rules bound 9,447,840;
per-depth class counts 1/2/4/24/144/854/4,943/26,272/102,155/121,404/6,852/19.
