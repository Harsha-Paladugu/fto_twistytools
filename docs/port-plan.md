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
  `skewb_twistytools`.
- **Site name + domain DECIDED (user, 2026-07-10): the umbrella brand is
  TwistyTools.com and this site is `fto.twistytools.com`.** The pyraminx and
  skewb sites will become subdomains of twistytools.com later (out of scope for
  this repo). CNAME/robots/sitemap point at fto.twistytools.com as of M0;
  hosting go-live (GitHub Pages enable + DNS for the subdomain) stays an M7
  step. Also user-confirmed 2026-07-10: algorithm sheets come later (M3 stays
  blocked as planned), and the site NOTATION is Ben Streeter's "FTO Notes"
  system (the user supplied the doc; rules quoted in ground-truth §Notation —
  the M1 user checkpoint is resolved, only the Twizzle direction-encoding pin
  remains as an M1 engineering gate).
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

- [x] **M0 — Bootstrap (identity fork)** (2026-07-10). Repo cloned with full
  Skewbiks history, remotes set (origin fto_twistytools / upstream
  skewb_twistytools), CLAUDE.md fork-status stamped, plan + ground-truth docs
  committed (`3a7a95b`). Identity pass landed: fto.twistytools.com across
  titles/OG/canonical/wordmarks (navbar + home hero), package.json
  `fto-twistytools`, build.mjs banner, CNAME/robots/sitemap on the decided
  domain, home toolcards + factline rewritten for FTO (state-space count +
  WCA-2027 line), config.js to demo mode (`firebase: null`). Census DELETED:
  oo.html, js/oo.js, css/oo.css, the index.html hash-redirect + OO toolcard,
  the navbar OO tab, solver.js's "open this position" census link,
  test/firestore.rules.test.mjs + the `test:rules` script; firestore.rules
  shrunk to the dormant per-user `users/{uid}` rule; SETUP.md + README
  rewritten (census walkthrough retrievable from git history). js/tables.js's
  census class-table half stays as documented dead code until the M5 rewrite.
  algs/trainer/solver pages carry a "FTO port in progress, inherited Skewb
  tool below" banner and their milestone number. Exit gate met: `npm install
  && npm run build` fully green including the check step, `check:fresh` green,
  pages serve locally with FTO identity.
- [x] **M1 — Engine** (2026-07-10). FTO `js/engine.js` landed, geometry-derived
  (sign-vector faces, cut planes at 1/3, clockwise = right-hand −θ about the
  outward axis), facelet scheme IDENTICAL to xyzzy's ftosolver.js by
  construction. All 16 face-move tables pinned byte-exactly against the
  oracle fixtures (`tools/fixtures/xyzzy-fto.mjs`, extracted with
  attribution); T² ≡ oracle X, mirror ≡ oracle Z, slice/wide desugar pinned
  (Us = Uo∘U′∘D, Uw = Uo∘D); Streeter parser incl. smart-quote
  normalization; frame-only rotations; invertible slot-table effect layer
  (`effectTable`/`invertTable`/`applyTable`) so `caseStateOf` works for
  rotation-containing algs despite identical centre triplets;
  `randomScramble` (random-move, 30, suppression rules). `npm run
  test:engine`: **37 tests green** (oracle pins, sub-space BFS 11,520 +
  369,600, published count, parity/orbit invariants, keying edge cases,
  parallel-path equivalence). A 4-lens adversarial review (independent
  physical simulator, exhaustive sign algebra, chirality counterfactuals,
  from-scratch float re-derivation of all 20 perms) REFUTED every attack on
  the math; its confirmed findings (algSolvesKey malformed-key throw, test
  gaps, doc staleness) are fixed. **DEVIATION from the planned known-red
  window: M1 also shipped the empty seed `data/fto_algs.json` + repointed
  compile-sheet, so the WHOLE build incl. check/check:fresh is GREEN at M1**
  (data/skewb_algs.json + data/sources deleted; M3 populates the seed).
  Deleted as planned: tools/lib/bfs-dist.mjs, tools/verify-space.mjs, the
  test:space script; test-trainer/test-solver/solver-lab stay known-red until
  M4/M5. M1 residue for M2: the single-T 90° direction rests on the geometric
  derivation + the doc's "clockwise" reading (T²/faces are oracle-pinned) —
  close it with the M2 visual pin of a published scramble picture.
  ORIGINAL SPEC (retained): behind the same `window.OOEngine`
  surface. State model (piece arrays for 6 corners with flip / 12 edges, no
  orientation / 24 centers in two never-mixing orbits of 12 with identical
  triplets — ground-truth §State space), native move set = 8 face turns
  (U, F, R, L, D, B, BR, BL ± direction; every generator has order 3 — no
  half-turns exist), whole-puzzle rotations, with slice and wide
  moves handled at PARSE level — the three layers on an axis compose to the
  whole-puzzle rotation, so Xs = Xo ∘ X′ ∘ OPP(X) and Xw = Xo ∘ OPP(X) (the
  opposite face's letter is unprimed — its own clockwise is already the
  reversed sense about the shared axis; machine-verified, see ground-truth
  §Notation): face-turn-plus-rotation sugar, not new generators. Alg parse/notation/normalize (community notation per ground-truth
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
  owning milestones rewrite them. Build health: superseded by the empty-seed
  mechanism recorded in the landed summary above — check/check:fresh are
  GREEN from M1 on, not known-red.
  Exit gate: `npm run test:engine` green with FTO oracles (move tables pinned
  against cubing.js's FTO def — `src/cubing/puzzles/implementations/fto/` —
  and a published scramble picture; test vectors recorded in ground-truth
  §Test vectors); **rotation-letter directions pinned against Twizzle BEFORE
  any alg data is authored** (the Skewb x/y/z-inversion lesson); every
  dropped/added contract member documented in ground-truth.
- [x] **M2 — Renderer** (2026-07-10). `js/render.js` rebuilt on the FTO facelet
  model: the community-standard two vertex-centered diamond views (front
  U/L/R/F, back B/BR/BL/D — what csTimer and cubing.js draw) from EXACT
  barycentric facelet triangles projected orthographically, plus a rotatable
  3D octahedron view; configurable palette (DianSheng default, LanLan
  variant, per-call override), mask support for future partial diagrams,
  accepts states or raw 72-color facelet arrays. Contract: { netSVG,
  iso3dSVG, viewMatrix, rotateView, DEFAULT_VIEW, PALETTES }. NEW
  `npm run test:render` (7 tests: polygon counts, solved layout quadrants,
  chirality-pinning exact centroids, palettes, mask, color conservation).
  **The exit gate was exceeded:** beyond side-by-side headless-Edge
  screenshots vs cubing.js twisty-player 2D (solved, 4 single moves, a
  12-move scramble, T, Rv — all agree), M2 added a SECOND machine oracle:
  cubing.js's runtime-generated KPuzzle def dumped as a fixture
  (`tools/fixtures/cubingjs-fto-kpuzzle.json`) and pinned in test-engine
  (slot correspondence derived from face signatures; all 16 moves, T/T2 —
  **closing the M1 single-T direction residue machine-exactly** —, Uv/Rv/Lv ≡
  our o-rotations, SiGN 2U ≡ Us, their lowercase wides ≡ our w tokens,
  orientation-reference solves, probe patterns). test:engine now 45 tests.
- [ ] **M3 — Sheet pipeline + Algorithms page.** BLOCKED ON USER INPUT: the
  algorithm sheets. Port `tools/compile-sheet.mjs` + `tools/import-method-sheets.mjs`
  (new ADAPTERS per source format — the Skewb importer's provenance/suspect/
  firstMove machinery carries over), re-key through engine helpers, empty
  carry-forward baselines (`prior-sheet.json` = `{}`, `broken-algs.json` = `[]`),
  populate the existing empty-seed `data/fto_algs.json` (created at M1) as the
  single authoring source fetched at runtime by algs.html/trainer/solver (the
  established pattern; the pages' fetch paths still reference the deleted
  Skewb file until this milestone repoints them). Algorithms page keeps the
  editor chassis; taxonomy/nav blocks data-driven from the user's subsets.
  Also decided here: the case-symmetry fold (M1 shipped realCanonKey =
  identity fold; widening re-keys the sheet). Exit gate: `npm run build` +
  `check:fresh` fully green with REAL data, every imported alg
  machine-verified to solve its case, algs.html verified in headless Edge.
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
  specs them. Carry-item from the M2 review: the inherited trainer's mask sets
  are SKEWB facelet indices (0..29) — every mask must be reauthored for the
  FTO's 0..71 indexing when the trainer is rewritten. Any mode needing "N moves from a solved step" uses the M5 pruning
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

- Hosting go-live: enable GitHub Pages on this repo + create the
  fto.twistytools.com DNS record (M7; name + domain themselves are decided).
- ~~Internal rotation/slice spelling~~ **DECIDED (user, 2026-07-10): Ben
  Streeter's "FTO Notes" notation site-wide** — bare letter = CW 120°, `'` =
  CCW, no doubles; `w` wide; `s` slice (spelled with U/R/F/L only); `o` face
  rotations; `T` 90° front-vertex rotation (ground-truth §Notation quotes the
  rules). M1 still owes the direction-encoding pin against Twizzle before any
  test vectors or alg text are recorded.
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
