# FTO port plan and status

The milestone plan for porting the Skewbiks codebase to the Face-Turning Octahedron
(FTO), with live status. Companion doc: `fto-ground-truth.md` (FTO domain facts +
sources; unverified until M1 machine-verifies them). This is the second fork in the
family: pyraminx-oo → Skewbiks (`upstream` remote) → this repo. The Skewb-era plan
this file replaces lives in git history and in the Skewbiks repo.

User-facing decisions already made (2026-07-10 session):

- **Fork, not fresh start** — full-history fork of Skewbiks; `upstream` cherry-picks
  stay possible; internal names (`OOEngine`, `OO_CONFIG`, `oo-*`) are NOT renamed.
- **v1 scope = Home + Algorithms + Trainer + Method solver.** The USER supplies the
  algorithm sheets and the trainer tool specs later; milestones below say exactly
  what is blocked on those inputs and what proceeds without them.
- **The OO census is DROPPED for FTO.** The census concept (exhaustively enumerate
  and browse every position) requires a full-state BFS; the FTO state space is
  ~3.1 × 10²² — sixteen orders of magnitude past the largest space this codebase
  family has fully enumerated (Skewb, 3.1M). Census surfaces (oo.html, js/oo.js,
  the census parts of firestore.rules) are deleted at M0; git history retains
  them.
- **Solver = step-by-step human-method solver** ("best human optimal solution"):
  optimal or near-optimal solutions PER METHOD STEP via IDA* + pattern databases,
  finishing with the user's sheet algorithms — the Skewb M7 architecture, but
  multi-step and pruning-table-driven instead of full-BFS-driven.
- Repo: `github.com/Harsha-Paladugu/fto_twistytools` (origin), upstream =
  `skewb_twistytools`. Domain/hosting: **user decision pending** (sister sites use
  GitHub Pages + CNAME).
- **Firebase: deferred** (demo-mode localStorage from day one; see M6). Without the
  census, Firebase only buys account-synced trainer/solver prefs.

## What is structurally different from the Skewb port (read first)

Every prior milestone assumed a fully enumerable state space (Pyraminx 933k,
Skewb 3.1M states): one BFS distance table backed the census, optimal solver,
masked scrambles, and uniform random states. **None of that transfers.** The FTO
equivalents are:

| Skewb mechanism | FTO replacement |
|---|---|
| Full-state BFS dist table (`tables.js`) | Per-step pattern databases (corners, per-orbit centers, edge slices) — same IndexedDB cache layer, new table shapes |
| `optimalSolution` (global optimal) | Per-step IDA* with PDB lower bounds; no global-optimal claim anywhere in UI copy |
| Masked scrambles from dist fibers | Setup-based scrambles: inverse of the case state + randomized pre-moves (trainer); full-solve scrambles start as ~30 random face moves, upgrade to random-state once the M5 step solver exists (the community standard IS random-state via cubing.js's vendored xyzzy solver — prior art we can match or reuse) |
| Uniform random reachable state | Random-move scramble (documented as such) until M5's random-state upgrade |
| Census (oo.html) | deleted |

The engine SURFACE convention survives (`window.OOEngine`, keying helpers,
facelet model, alg parse/normalize, importer/compiler pipeline, stamp/check:fresh
discipline, the runtime-fetched `data/*.json` pattern) — that is what makes the
fork worth it. But NOT the whole member list: `idx`/`unidx`/`NSLOTS` (dense
full-space indexing) cannot exist for FTO and leave the contract at M1, taking
their consumers with them milestone by milestone (see M1/M4/M5).

## Status

- [ ] **M0 — Bootstrap (identity fork).** Repo cloned + remotes set + CLAUDE.md
  fork-status stamped + this plan and the ground-truth doc committed (done
  2026-07-10). Remaining: identity pass (titles/OG/wordmark/package.json name/
  build.mjs banner — PARTIALLY BLOCKED on the site-name decision, placeholder
  acceptable if the user says so; CNAME + robots + sitemap parked until the
  domain decision), config.js to demo-mode (no Firebase creds), **delete census
  surfaces** (oo.html, js/oo.js, the index.html census hash-redirect
  `location.replace('oo.html'…)` AND the OO toolcard, census sections of
  firestore.rules/SETUP.md, nav entry, test/firestore.rules.test.mjs census
  cases — park or delete the `test:rules` script until M6; note js/tables.js's
  census class-table half is dead code from M0 on and is deleted with the M5
  tables.js rewrite), README rewrite, LF-normalization verified
  (`core.autocrlf=false` pinned).
  Exit gate: `npm install && npm run build` FULLY green including the check
  step (nothing engine-side changes at M0 — the sheet is still Skewb data over
  the Skewb engine); site serves locally, Home renders with FTO identity,
  algs/trainer/solver pages visibly parked ("coming at M3/M4/M5"), git history
  clean.
- [ ] **M1 — Engine.** FTO `js/engine.js` behind the same `window.OOEngine`
  surface. State model (piece arrays for 6 corners with flip / 12 edges, no
  orientation / 24 centers in two never-mixing orbits of 12 with identical
  triplets — ground-truth §State space), native move set = 8 face turns
  (U, F, R, L, D, B, BR, BL ± direction; every generator has order 3 — no
  half-turns exist), whole-puzzle rotations, with slice and wide
  moves handled at PARSE level — the three layers on an axis compose to the
  whole-puzzle rotation, so slice = rotation ∘ own-face′ ∘ opposite-face′ and
  wide = rotation ∘ opposite-face′: two-face-turns-plus-rotation sugar, not
  new generators. Alg parse/notation/normalize (community notation per ground-truth
  §Notation), facelet model (72 facelets) as the renderer/tools substrate,
  keying helpers (`stateKey`, `caseStateOf`, `algSolvesKey`, `normAlg`; the
  case-symmetry fold is a design task — only the order-12 tetrahedral rotation
  subgroup preserves the piece-type orbits (the other 12 octahedral rotations
  swap the two face tetrads), so folds are subgroups of that 12 — decide WITH
  the M3 data in hand and key conservatively until then), random-move scramble
  generator, and **parity/orbit verifiers** in
  place of verify-space: piece-count, permutation-parity and orientation-sum
  invariants asserted over random move sequences, plus the state-space count
  derived symbolically and matched against the published figure. Inherited
  full-state machinery is deleted HERE: `tools/lib/bfs-dist.mjs` and
  `tools/verify-space.mjs` go away, the package.json `test:space` script is
  repointed at the new orbit/parity verifier (or folded into test:engine),
  and `idx`/`unidx`/`NSLOTS` leave the OOEngine contract — their consumers
  (js/tables.js, js/solver.js, the trainer jsx/core, tools/test-trainer.mjs,
  tools/test-solver.mjs, tools/solver-lab.mjs) stay known-red until their
  owning milestones rewrite them. From M1 until M3's sheet lands, `npm run
  check`/`check:fresh` are known-red (the accepted Skewb-port breakage
  pattern); `build:trainer` + `stamp` must stay green.
  Exit gate: `npm run test:engine` green with FTO oracles (move tables pinned
  against cubing.js's FTO def — `src/cubing/puzzles/implementations/fto/` —
  and a published scramble picture; test vectors recorded in ground-truth
  §Test vectors); **rotation-letter directions pinned against Twizzle BEFORE
  any alg data is authored** (the Skewb x/y/z-inversion lesson); every
  dropped/added contract member documented in ground-truth.
- [ ] **M2 — Renderer.** `js/render.js` rebuilt on the FTO facelet model: the
  community-standard 2D view is two vertex-centered diamond views, front
  (U/L/R/F) + back (B/BR/BL/D) — the same front/back two-view shape as the
  Skewb port's net, and what csTimer and cubing.js both draw (ground-truth
  §Rendering); partial case diagrams for the alg sheet come later with M3
  masking needs. Color scheme: no single hardware standard exists — ship a
  configurable palette, DianSheng-era default (cubing.js/csTimer defaults
  match it), white-U/green-F scrambling hold. Same small exported contract.
  Exit gate: solved + known-scramble diagrams visually verified against an
  external simulator (headless-Edge screenshot recipe from the Skewbiks
  memory); renderer consumes only the facelet model.
- [ ] **M3 — Sheet pipeline + Algorithms page.** BLOCKED ON USER INPUT: the
  algorithm sheets. Port `tools/compile-sheet.mjs` + `tools/import-method-sheets.mjs`
  (new ADAPTERS per source format — the Skewb importer's provenance/suspect/
  firstMove machinery carries over), re-key through engine helpers, empty
  carry-forward baselines (`prior-sheet.json` = `{}`, `broken-algs.json` = `[]`),
  `data/fto_algs.json` as the single authoring source fetched at runtime by
  algs.html/trainer/solver (the established pattern). Algorithms page keeps the
  editor chassis; taxonomy/nav blocks data-driven from the user's subsets.
  Exit gate: `npm run build` + `check:fresh` fully green (check step included,
  first time since fork), every imported alg machine-verified to solve its case,
  algs.html verified in headless Edge.
- [ ] **M4 — Trainer.** BLOCKED ON USER INPUT: which training tools. The chassis
  ports (rAF timer, storage blob under a NEW key `fto-trainer-v1`, session
  pills, per-case stats, recap queue, runtime JSON fetch) — but NOT as-is: the
  inherited dist-table wiring (`OOTables.loadOrBuildDist` at trainer boot and
  the skewb-core BFS goal tables) would attempt a full-state BFS and crash on
  FTO, so it is stripped/guarded at M4 — case-drill uses setup scrambles only,
  no distance table. Case-drill mode is
  buildable from the M3 data alone (setup-scramble = randomized inverse of the
  case state + masking decisions per the user's spec); further modes (full-solve
  timer/analysis, recognition variants, one-look) are scoped when the user
  specs them. Any mode needing "N moves from a solved step" uses the M5 pruning
  tables, so sequence trainer-analysis features AFTER M5 if they're wanted.
  Exit gate: `npm run test:trainer` green over the new substrate; headless-Edge
  E2E drives every shipped mode.
- [ ] **M5 — Solver.** The headline feature: step-by-step best-human solution.
  Prior art exists and de-risks this: cubing.js vendors xyzzy's random-state
  FTO solver (3-phase IDA* + BFS pruning tables, phase spaces exactly
  2,555,520 / 193,536,000 / 63,504,000; ≤ 39 moves when its fast combined
  phase-2+3 search succeeds, per-phase worst-case caps 15/15/25) — proof
  that per-step FTO search is browser-feasible, and a correctness oracle for
  ours. **First task: SIZE the pruning tables before committing to the search
  design** — extract the actual xyzzy table shapes/sizes from the vendored
  source, list our per-step PDB candidates with bytes and build-seconds each;
  user checkpoint if any shipped table exceeds ~10 MB or first build exceeds
  the ~30 s budget (options: sub-coordinate PDBs, Web Worker build with
  progress UI, precomputed download — GitHub Pages caps files at 100 MB and
  this is a full-history fork, so repo bloat is a real cost).
  `js/tables.js` is rewritten here: delete `loadOrBuildDist`/
  `loadOrBuildClassTables` (full-state BFS, dead since M0/M4), add the PDB
  load/build layer under new cache keys, update js/solver.js's table
  bootstrap. `js/solver-core.js` rewritten: METHOD_DEFS = the
  steps of the user's actual method(s) (machine-derived from the M3 sheets
  where possible, as the Skewb fl/tcll/eg2 defs were); per-step search = IDA*
  over the step's subspace with pattern-database lower bounds;
  this also unlocks random-state scrambles for the trainer (upgrade the M4
  random-move interim). Finishes = the user's sheet algs
  verbatim (the Skewbiks physical-facelet-model lessons — hold/rotation logic,
  leading-rotation folding, per-line machine proof — apply wholesale and the
  code ports with the engine swapped under it). Movecount-only metrics first
  (the Skewb precedent; fingertrick metrics deferred until the user consults
  solvers). Multi-step beam: keep top-K lines per step junction so early greed
  doesn't hide the best total (K user-tunable, like the Skewb buckets).
  Exit gate: `npm run test:solver` green — every displayed line re-proved by
  facelet check end-to-end; `tools/solver-lab.mjs` scan over ≥200 scrambles with
  0 verify failures and a pinned latency budget; solutions match hand-solves on
  fixture scrambles executed by the USER (the Skewb port's junction-pinning
  protocol).
- [ ] **M6 — Accounts/Firebase (OPTIONAL — user decision).** Demo mode suffices
  until launch. If wanted: new Firebase project, auth + per-user prefs/stats
  sync only (no census collections; firestore.rules shrinks accordingly), rules
  emulator tests green. USER console steps: project billing tier, Google
  sign-in provider, admin bootstrap.
- [ ] **M7 — Launch polish.** Domain decision + CNAME/robots/sitemap, logo + OG
  image + touch icon (headless-Edge render recipe), Home copy final, About/
  credits (Streeter/Gottlieb/Straughan/xyzzy attribution where their work is
  referenced), pre-announce checklist. Plain voice, no em dashes in site copy
  (standing user preference from pyraminx.net). **Timing hook: FTO becomes an
  official WCA event 2027-01-02** (announced 2026-06-24) — launching before
  that date rides the interest wave; the trainer/solver should speak WCA-comp
  vocabulary (white-U/green-F scrambles, Ao5). Logo swap gotcha: `?v=` stamps
  embedded in CSS `url()` (css/site.css) are NOT rewritten by `npm run stamp` —
  bump those by hand.

## Standing goals (carried from the Skewb port — still in force)

1. main is always committed and green at its own milestone's bar;
2. each milestone deletes its own inherited leftovers rather than deferring to a
   big-bang cleanup;
3. data formats that hold live user data are frozen and documented before
   anything goes live on them;
4. first boot stays fast enough to not need an apology in the boot hint —
   for FTO this specifically bounds pruning-table first-build time (M5);
5. `npm run check:fresh` before every commit once M3 lands.

## Open user decisions (tracked here, decide when reached)

- **Site name/wordmark — needed at M0** for the identity pass (a placeholder
  is acceptable if the user says so; retitle at M7 with the domain).
- Domain name + hosting go-live (M0 parks CNAME/robots/sitemap; M7 needs it).
- **Internal rotation/slice spelling — confirm with the user at M1**, before
  any test vectors or alg text are recorded in it (rotation `o` vs `v` vs
  `[X]`, slice `s` vs `2U` vs lowercase; ground-truth §Notation).
- Pruning tables: build-in-browser vs ship precomputed binaries (M5's sizing
  task produces the numbers; checkpoint if >10 MB shipped or >30 s first
  build).
- Algorithm sheet sources + formats (M3 blocker) — and with them the method
  lineup the solver targets (M5) and the case-key symmetry fold (M1 finalizes
  conservatively, revisit at M3).
- Trainer tool lineup (M4 blocker).
- Notation presentation: the 8 face letters are settled, but rotation spelling
  (`Ro` vs `Rv` vs `[R]`), slice spelling (`Rs` vs `2U` vs lowercase), and
  lowercase-means-wide-or-slice are NOT community-settled (ground-truth
  §Notation). The engine picks one canonical internal spelling at M1; the
  displayed dialect follows the user's sheets at M3; the WCA/NS-switch pattern
  from Skewbiks is the template if two dialects must coexist.
- Firebase: whether M6 happens at all before launch.
