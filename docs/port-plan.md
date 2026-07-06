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
  spec-object signature, `CLASS` (free-perm A4/V4 classes). `tools/test-engine.mjs` 32/32
  (44 after the M3 notation/display additions);
  `npm run test:space` matches OEIS A079745 + class oracles.
- [x] **M2/M3 — Census slice** (`4f3d057`): `js/render.js` rebuilt on the facelet model
  (net = front/back orthographic corner views; 3D cube; same 5-member contract);
  `js/tables.js` parameterized (IndexedDB `skewbiks-oo`); `js/oo.js`/`oo.html` Skewb copy.
  Verified: in-browser first build ~18 s; census shows 262,674 positions (= oracle);
  mirror pairs, 12 unique views, verified scrambles, instant cached reload.
  - **2026-07-03 update (user request):** census classes now fold the FULL 24-element
    group (`E.makeFullCanon`, cache key `oo-classes-v2`) → **131,391 positions**; a
    position + its mirror are one class/ordinal/done-bit (pairId == classId of the rep;
    old `#/c/<id>` links still resolve). Notation: WCA everywhere by default + a
    **WCA / NS switch** in the nav (`localStorage skewbiks-notation`; engine gained
    `parseAlg(str,'ns')`, `wcaToNS`/`nsToWCA`/`convertAlg`, NS-aware `mirrorAlg` —
    mapping in skewb-ground-truth.md §NS). Solutions store the notation they were typed
    in (`notation: 'wca'|'ns'` doc field; rules + fixtures updated). Net/3D re-anchored
    to the WCA scrambling hold (front = U/F/L, UFL toward viewer; back = D/B/R) so
    scrambles match the in-hand view and mirror pairs render as visual reflections.
  - **2026-07-03 fix 2 (user report: "B looked like an F move"):** two frame bugs —
    `applyParsed`/`nativeToWCA` advanced the B-frame in the WRONG DIRECTION (every move
    after a written B acted on the wrong corner; self-consistent in-engine, wrong vs a
    real cube), and diagrams rendered raw pinned facelets (UFL corner appeared to twist).
    Fixed: frame steps `amt % 3`, and all rendering now goes through `E.toFixedFacelets`
    (WCA-hold presentation; white/red/green corner always reads solved). Display now
    matches the TNoodle fixed-frame vectors + KPW 2015 scramble exactly (4 new tests;
    see ground-truth §"Two frame rules"). Census dist/class tables unaffected (native
    moves only). Old demo-mode solutions verified under the inverted frame may fail
    re-verification — expected.
  - **2026-07-03 Phase-0 cleanup (post-review, commit after `12c5483`):** full OO
    code review found no structural problems; landed fixes: home "random unsolved"
    no longer lands on the solved position (skips depth-0); `pairOf` + the approval
    transaction re-derive the class rep by FULL 24-sym canonicalization (a forged
    non-canonical `classId` could previously verify+approve but never set the
    done-bit); class-table build switched to an ascending orbit sweep — first
    unvisited reachable index is the rep — 1.0s vs 22.6s in Node, reps/depths
    verified byte-identical, cache key unchanged; bitmap bit-twiddling extracted to
    `testBit`/`setBit`; dead exports pruned (engine `mirrorToken`/`parsedToNative`/
    `NS_CORNER`, render `STICKERS`); `render.js` now uses the same shadowed-module
    IIFE as engine.js/tables.js (the old `typeof module` branch silently skipped
    `window.OORender` under the documented Node window-stub recipe).
- [~] **M4 — Firebase** (2026-07-03, agent side done — USER console steps remain).
  Project **`skewbiks`** + web app created via MCP; creds in `js/config.js` (demo mode
  off); `.firebaserc` pins the project; rules deployed (verified byte-identical via
  `firebase_get_security_rules`). Rules tests: 25/25 green against the emulator
  (`npm i --no-save @firebase/rules-unit-testing firebase`, then
  `npx -y firebase-tools@13 emulators:exec --only firestore "node test/firestore.rules.test.mjs"`
  — firebase-tools 14+ needs Java 21, machine has 17; recipe in the test header), incl.
  2 new delete tests. Review carry-items landed: (a) solutions delete stays admin-only
  (it's the cap-race recovery path) + new admin **Recompute solved bitmap** action
  (`liveDB.recompute()`: rebuilds meta/doneMap + meta/stats from approved docs' classId
  — state indexes, enumeration-independent — so it doubles as the KEY_CLASSES migration
  tool); (b) persistence formats FROZEN in skewb-ground-truth.md §"OO census persistence
  formats"; (c) pageMod scramble/solution now display through the WCA/NS switch
  (verification still runs on stored text + notation).
  **Firestore DB creation is console-only on Spark** (API/CLI CreateDatabase requires
  billing — confirmed against Firebase docs), so it's a USER step.
  **DEFERRED 2026-07-05 (user decision): the console steps wait; M5 proceeds first.**
  Until they're done, oo.html's backend is intentionally dead — census shows 0 solved
  and sign-in fails. That is NOT a bug; do not debug or revert `js/config.js` to demo
  mode. Checklist when resuming (details in SETUP.md §1–4): ① create the (default) DB
  in the console (nam5, production mode); ② REDEPLOY the rules — the create wizard
  overwrites them (`firebase deploy --only firestore:rules` or Firebase MCP); ③ enable
  the Google sign-in provider; ④ sign in on oo.html, read the uid from the About tab,
  create `admins/{uid}` (console/MCP write bypasses rules); ⑤ run the remaining gate:
  live submit → moderate → done-bitmap round-trip (+ try the admin "Recompute solved
  bitmap" button once).
- [x] **M5 — Sheet pipeline + Algorithms page + alg data v0** (2026-07-06). Pipeline
  re-keyed through engine helpers only: renderKey = full-state `stateKey`, canon =
  `realCanonKey` y²-fold; PRES entries are `[renderKey, name]`; DEFERRED namespace +
  every L4E-merge/TL4E-split special case deleted; `data/prior-sheet.json` = `{}` and
  `broken-algs.json` = `[]` (both mechanisms kept, empty); the compiler now also
  GENERATES `data/classmap.json` (canon → lowercased subset id, first subset wins,
  conflicts reported). Engine: `preprocessAlg` strips `[setup]` brackets (y-family
  setups are real rotation tokens on a Skewb); 2 new tests → 46/46. **Direction
  convention pinned operationally** (there is NO state-level 90° y symmetry — pure
  facelet/conjugation relations between presentations don't exist, verified): 
  `prependAUF(p, frontAlg)` = alg for p = 0 Front / 1 Right / 2 Back / 3 Left ("case
  on the Right → y → run the Front alg"); machine-verified: `caseStateOf` of a
  y²-prefixed alg == the y²-sym image (so Front/Back share one canon, Right/Left the
  other — a case is ≤ 2 canons; engine test added). algs.js kept the editor chassis,
  replaced the taxonomy: data-driven SECTIONS (one tab per JSON subset, authored
  order, lands on first non-empty), case cards group algs by the EXACT presentation
  state each solves (no per-row realignment needed) with direction labels computed
  from the case anchor, sidebar = case anchors, WCA/NS toolbar switch (shared
  `skewbiks-notation` pref; NS input converted and stored as WCA), draft key
  `skewbiks-algsheet-draft`, export = `skewb_algs.json` (deep-clone + deltas, no
  remapping). **Alg data v0 is a MACHINE-GENERATED seed** (BFS-optimal algs;
  generator in the session scratchpad): subsets FL / Sarah-Intermediate /
  Sarah-Advanced / NS (the proposal — still awaiting user confirmation), with
  Sarah-Intermediate seeded: 18 cases / 135 algs = both LL-corner-twist cases
  (centers solved; 8 states → 2 y-orbits) + all 16 last-layer center-perm cases
  (corners AND the D center solved — the post-FL center space, even perms of the
  5 remaining centers; 59 states → 16 y-orbits, exhaustive over that pool).
  Case names are descriptive
  placeholders ("Two corners twisted", "Centers 3-cycle F→L→B") — USER authoring
  replaces/extends via the page editor or the JSON. Gates: `npm run build` fully
  green (check-sheet: 135 algs, 0 NOSOLVE, structure clean), `check:fresh` green,
  `%\s*3` absent from all M5 surfaces, algs.html verified in headless Edge (NOTE:
  virtual-time starves on this page — no CPU pin; use playwright-core with
  channel msedge for real waits), engine tests 46/46.
  - **Same-day post-review fixes (multi-agent review, 11 confirmed findings):**
    compiler — identity algs (empty string, "R R'") now FAIL the build instead of
    minting a bogus solved-state case, and no output is written on ANY failed
    check (the unparseable-skip and coverage-gap failures previously fired after
    the write); check-sheet — PRES↔ALG/CNAME structural checks are now
    bidirectional plus a solved-key guard; engine — preprocessAlg strips brackets
    only around pure-ROTATION groups (commutator notation "[R, U]" is rejected,
    not silently misread as "R U"), and nsToWCA now routes through preprocessAlg
    (the NS-mode adder accepts bracketed setups it displays); algs.js — exportJSON
    publishes the admin's saved row order and recomputes meta.counts, and the
    localStorage draft self-heals against the published baseline on load (no
    duplicate rows after export → commit → redeploy); check-fresh now also covers
    data/classmap.json; README data-flow + the seed's center section labels
    corrected ("Last layer centers"). Engine tests 48/48.
  - **Alg data v1 — real method sheets imported (2026-07-06).** USER supplied the
    advanced-method sheets as JSON (TCLL "Full TCLL - Max Parris", EG2.xlsx, NS
    2026_ns_sheet.xlsx); committed verbatim under `data/sources/` and imported by the
    new re-runnable `tools/import-method-sheets.mjs` (NS→WCA conversion, state-verified;
    duplicate-name merge; per-alg provenance `ns`/`rating`/`firstMove`). The
    machine-generated Sarah-Intermediate v0 seed cases were REMOVED (subset shells kept;
    Sarah's sheets to come — extend the importer's ADAPTERS). Result: subsets NS 135 /
    EG2 136 / TCLL 1078 cases = **1,349 cases / 3,114 algs**, compile + check-sheet +
    check:fresh green, engine tests 48/48, algs.html verified in headless Edge
    (playwright-core, channel msedge — plain --screenshot still virtual-time-starves).
    **Notation finding (machine-derived, dual-oracle verified — see importer header +
    data/sources/README.md): the sheets' rotation letters are NOT WCA — sheet x/y/z =
    engine z'/y'/x** (move letters are standard fc2 NS). Only mid-alg rotations
    distinguish the conventions (leading rotations conjugate the case), which is why
    959 mid-rot algs scattered under the identity reading. Sheet cases are
    orientation-free (alternates solve from arbitrary holds → one authored case may
    span several canons; each alg keys to the exact state it solves). ~1% of algs
    flagged `"suspect": true` (off their case's plurality rotation class = sheet
    typos; suspects sort last so they never anchor a case card); 2 identity algs
    dropped (NS 137a, sheet-rated "poor"). Same-day follow-up (USER request): the
    Algorithms page gained a data-driven second-level nav — the importer emits each
    case's structured sheet fields (corner/sign/id/center/caseId/centerPattern) plus a
    per-subset `nav` block ({group, filter, sort}); algs.js renders group pills
    (NS/EG2: Pi/Peanut/…; TCLL: TCLL+/TCLL−) + a per-group dropdown (center pattern /
    center case / corner set) and sorts cases by ID (natural sort for NS caseIds,
    U-FL-FR-BR-BL order for EG2/TCLL). Search deliberately spans the whole subset,
    ignoring group/filter. Subsets without `nav` (FL, Sarah-*) keep the flat view.
    Second follow-up (USER): case cards now show a **first-move table** — all 8
    possible first moves (r r' R R' B B' b b', the sheets' convention) with each
    group's algs filed under the first move they make FROM THE ANGLE THE DIAGRAM
    SHOWS (so a solver can pick the alg that cancels their last first-layer move),
    and the alg text is the **authored sheet notation verbatim, rotations included**
    (the `ns` field, shown in BOTH toggle modes — WCA's 4 letters can't express the
    free-corner moves, so no rotation-preserving WCA form exists; the rotationless
    conversion stays for keying + the WCA input mode; algs.html defaults to NS). The
    first-move keys render as a fixed-width highlighted chip column (accent; empty =
    dim dashed chip), rotation tokens inside alg text are tinted blue — two distinct
    highlights by design. Per-alg `firstMove` is computed at import — the WCA
    conversion's first token IS the physical first move in the diagram frame; the
    sheets' letter convention for it is the fixed map {WCA R→B, U→b, L→r, B→R}
    (validated 1320 agree / 42 differ vs the sheets' own columns; disagreements are
    kept per-alg as `firstMoveSheet`, mostly the suspect algs). Rating chips
    (best/poor) shown; best sorts first within a first-move row.
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

## Remaining plan + review carry-items (2026-07-03 — read before starting M5)

Standing goals for the rest of the port: (1) main is always committed and green at
its own milestone's bar; (2) each milestone deletes its own Pyraminx leftovers
rather than deferring to a big-bang cleanup; (3) data formats that hold live user
data (done-bitmap, solution docs) are frozen and documented before M4 goes live;
(4) first boot stays fast enough to not need an apology in the boot hint.

Items the 2026-07-03 OO code review adds to the milestones above:

- **M4:** carry-items (a)/(b)/(c) all landed (see the M4 status entry above);
  the USER console steps + live round-trip gate are deferred until after M5
  starts — follow the numbered checklist in the M4 entry when resuming them.
- **M5:** LANDED (see the status entry) — the dead algs.js destructuring of dropped
  contract members (`applyMoveK`/`openOfEkey`/`barOfEkey`) is gone and
  `npm run build`/`check:fresh` are green. Standing rule now in effect: run
  `check:fresh` before every commit.
- **M6:** as specced. Decide whether the trainer imports `R.COLORS` (kept exported
  for exactly this) or inlines its own palette — un-export if unused.
- **M7:** as specced. Engine exports `composeSym`/`FACE_ID`/`faceCompose`/
  `optimalSolution` exist for Pyraminx-era solver-core + tests only — if the M7
  rewrite doesn't use them, un-export.
- **M8:** as specced.

Known-acceptable, deliberately NOT fixed (don't re-litigate without new evidence):
the BFS builder exists twice on purpose (js/tables.js browser + tools/lib/
bfs-dist.mjs Node — documented in the latter's header; if you optimize one, do
both); the BFS allocates a fresh state per move probe (~25M short-lived objects on
first boot — a scratch-state `applyMoveIdx` variant is the fix if boot time ever
matters again); `enumFreeSlots` recomputes `twistDigits` in its inner loops
(trivial cost); pageBrowse re-fetches doneMap per navigation (candidate for a
session cache); render.js re-declares FACES/FIDX/FNORM locally; the moderator
approval cap check is best-effort/racy by design (documented at the call site).

## Recorded numbers (from M1 verification — use these, don't recompute by hand)

3,149,280 reachable states; depth histogram = OEIS A079745 (max 11, 90 antipodes);
262,674 rotation classes; **131,391 census positions (24-sym fold — what oo.html counts)**,
of which 108 are self-mirror; NSLOTS/rules bound 9,447,840;
per-depth ROTATION-class counts 1/2/4/24/144/854/4,943/26,272/102,155/121,404/6,852/19
(the census's per-depth counts are the 24-fold ones shown on the Browse tab).
