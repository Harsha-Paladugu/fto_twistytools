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
| Masked scrambles from dist fibers | Setup-based scrambles: inverse of the case state + randomized pre-moves (trainer); full-solve scrambles are ~30 random face moves. Random-state stays deferred even after M5: the method solver's ~55-move inverses are not scramble-grade (community standard ≤ 39 via xyzzy's phases, whose ~97 MB tables exceed the shipped-table budget) — revisit with the trainer full-solve mode |
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
- [~] **M3 — Sheet pipeline + Algorithms page. PHASE 4 LANDED (2026-07-13):
  the 1LP set (one-look pair formation, 11 cases / 29 sequences) is LIVE**,
  imported from the user-supplied `1LP_Rotationless_V3.pdf` by
  `tools/import-1lp.mjs` over the committed verbatim transcription
  `data/sources/1lp-rotationless-v3.json` (the PDF's case images are not
  reproduced — case identity is machine-derived and cross-pinned against
  zwegner's page instead; **author attribution pending from the user**).
  Engine dialect grew `[Uo]`/`[Uo']` bracket rotation marks (executed as
  the state-neutral rotation; leading = the solution respelled for a
  Uo-rotated view, trailing = ending-orientation annotation; `(U)` paren
  AUFs already parsed). First subset whose algs do not end step-solved as
  their contract — a 1LP line converts its case into the TCP stage; the
  machine contract is the **flip-sequence theorem** (ground-truth
  §Methods): the L3T coset = closure of {U,S,H} = 4320 states, the image
  language partitions it into 80 appearance classes of 54, structurally
  formed = 4 appearances / 216 states with all 18 TCP states in one of
  them, and every line maps its ENTIRE appearance class into the formed
  family. 5 grip-respelled line pairs pinned state-identical ('ⓘ grip'
  chips on algs.html); the "11 possible permutations" comment pinned (H on
  zwegner group 1 → the TCP finish set, exactly 11); one exact zwegner
  primary collision (1LP 7 = 4a.O.6, the expected compile MISFILED
  advisory). The Parity column ships as sheet prose (machine-unmappable to
  zwegner E/O — tested, documented). Gates: test:engine **73** green
  (§16), test:trainer 27 green over the grown JSON (1LP drills included),
  test:solver 19 green (the solver ignores non-finish subsets by design),
  headless-Edge E2E 16 checks / 0 console errors, build + check:fresh
  green. PHASE 3 (2026-07-13):
  the Algorithmic LBT set (last bottom triple, 95 cases / 120 algs)
  LIVE, imported from zwegner's page by `tools/import-lbt.mjs` over the
  committed snapshot `data/sources/lbt-zwegner.html` (curated algs only —
  the page's hidden "gen" dumps stay behind). Plain Streeter dialect
  (Uo/Uw/Us), zero parser work needed. First NON-last-layer set: subset
  `auf: false` (a U pre-turn would change the case; the trainer's opt-out is
  now exercised on real data), locality region = the 1L3T region PLUS the
  bottom-left triple slot {corner 4, F(4), BL(10)} — a Bencisco-order
  cross-sheet pin (after LBT, exactly the L3T region remains). **21 algs are
  printed with a leading Uw/Us setup left unrestored — as printed they end
  one wide/slice turn short of solved; each carries a machine-verified
  closing-token note** (the closing token is always the textual inverse of
  the alg's first wide/slice token), surfaced as a '⚠ setup undo' chip on
  algs.html and in the trainer reveal. Page structure machine-checked by the
  importer and pinned in test-engine §15: 24 groups of 4 across 6 sections,
  corner-in-slot ⇔ section 1 (front-top slots {0,2} otherwise), per-case
  corner agreement across algs (centre sources may differ — the page's
  "two of each color's triangles" freedom, live in cases 56/84), section-1
  quads = base/mirror/flipped/flipped-mirror, the page's "same alg notated
  differently" pairs (cases 7/8) state-identical, 95 distinct primaries,
  case 21 = the solved state (no alg, omitted). test:engine 67 green,
  test:trainer 27 green, headless-Edge E2E 19 checks / 0 console errors.
  PHASE 2 (2026-07-13):
  the 1L3T set (one-look last 3 triples, 178 cases / 251 algs) LIVE,
  imported from zwegner's page (algs by Aedan Bryant; 6c = the TCP set, from
  Edd Dibley's document) by the new adapter `tools/import-1l3t.mjs` over the
  committed snapshot `data/sources/1l3t-zwegner.html`. The engine gained that
  page's dialect: S/H sledge-hedge macros (S'/H' inverses; hold-relative,
  dialect-aware) and `[U]`/`[U']` pre-AUF marks (executed as the move; `[R]`
  stays unparseable — csTimer spells rotations that way), plus a strict
  mirrorAlg (no silent passthrough). Everything machine-verified and pinned
  (test:engine 63): every alg parses and solves an L3T-local state (region
  pinned slot-exactly); per-case classification 221 on-orbit / 15 final-AUF-
  short / 15 working-slot variants, each non-clean alg carrying a JSON note
  (surfaced as hover tags on algs.html and in the trainer reveal);
  **cross-sheet oracle: all 18 TCP alg states appear exactly among the 6c
  algs** — two independently transcribed sources agreeing state-for-state
  (TCP 11/12, our known post-AUF pair, land as the noted variants of
  6c.O.6/6c.O.8). Two source algs are transcription ERRATA (they don't solve
  last-layer states — 6b.E.5's only alg, so that case is omitted, and
  4b.O.4's fourth) — excluded, self-checked by the importer, pinned in tests,
  noted in the JSON. Case 1.E.1 is the solved state (no alg). Headless-Edge
  E2E over algs.html + trainer.html with both subsets: 15 checks, 0 console
  errors. PHASE 1 (2026-07-10): the TCP last-layer set LIVE on algs.html. The user supplied the
  community "FTO Notation" doc (Sonja Black) + the TCP sheet (New Notation,
  Diansheng/DaYan). Engine grew the notation extensions they need — a
  48-hold frame model (24 CIF + 24 EIF holds), `{X,Y}` bracket rotations
  (adjacency decides the resulting hold; the doc's five worked examples
  reproduce), an `eif` dialect for EIF-authored sheets, `X2` ergonomic
  doubles, lowercase wides — all machine-verified (test:engine 55). TCP:
  18 cases authored in `data/fto_algs.json` (verbatim texts incl. brackets),
  every alg machine-verified to solve its case; the case space was DECODED
  (three U-face triples + the filled slot; 2-Flip ⇔ filled slot solved; the
  sheet's "EIF" header is wrong — the algs are CIF-held, matching the
  notation doc's TCP description) and pinned as tests. compile-sheet/
  check-sheet carry a per-alg dialect. `js/algs.js` REWRITTEN (data-driven,
  read-only: subset tabs, group pills, search, case diagrams via
  caseStateOf + netSVG, verbatim algs with move counts, sources; the Skewb
  admin editor is DEFERRED — edit the JSON + rebuild; git history has the
  editor if wanted). algs.html un-parked; headless-Edge E2E green (18
  cards/diagrams, filters, search, 0 errors). REMAINING for M3: further
  subsets as the user supplies sheets (the importer-adapter pattern),
  revisit the case-symmetry fold with more data, decide whether the in-page
  editor returns. ORIGINAL SPEC (retained): Port `tools/compile-sheet.mjs` +
  `tools/import-method-sheets.mjs`
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
- [x] **M4 — Trainer (case-drill v1)** (2026-07-13). trainer.html is LIVE.
  `src/trainer/` REWRITTEN: `fto-core.mjs` (substrate; no React) +
  `fto-trainer.jsx` (component); the inherited `skewb-core.mjs`/
  `skewb-trainer.jsx` are DELETED, and with them every dist-table dependency —
  the trainer no longer loads `js/tables.js` at all (`OOTables.loadOrBuildDist`
  would full-state-BFS and crash on FTO; tables.js is now dead code on every
  page until the M5 rewrite). Scrambles are SETUP scrambles as planned, with
  one design refinement: **inverting at the resolved-native-move level** —
  `walkParsed` flattens the case alg (brackets, o/T rotations, wides, dialect
  hold model included) to absolute face moves; reversed + inverted + merged
  (same-face cancel) + a random AUF (U-layer pre-turn, the way a last-layer
  case appears mid-solve; subsets can opt out with `auf: false`). The engine's
  textual `invertAlg` is NOT used (undefined for brackets, wrong across a
  fresh hold for rotation algs). Scrambles therefore come out as plain face
  letters, executable from the scrambling hold. Reveal shows a per-alg AUF
  chip (`rowAufToken`) + the verbatim alg text. Chassis shipped: drill +
  recap, rAF timer with tap guard, pool setup (subsets/groups/case browser/
  known marks/scope), per-case + per-subset stats with diagram grid, session
  pills, storage under the NEW key `fto-trainer-v1` (strict shape validation;
  the trainer.html cloud/localStorage bridge unchanged). The Skewb mask
  reauthoring carry-item DISSOLVED: v1 ships no masked diagrams (the M2
  renderer's mask hook stays for future modes). Exit gate met:
  `npm run test:trainer` 26 tests green (model, walkParsed-exact flattening,
  merge/cancel effect-preservation, every case × every AUF re-proved to
  solve, EIF-dialect plumbing, broken-data degradation) and a headless-Edge
  CDP E2E (19 checks: boot, scramble sanity through the page engine, 72-
  polygon diagram, timer keyboard flow, reveal, known-marking, recap
  progression, case browser, `fto-trainer-v1` persistence, 0 console
  errors). REMAINING (user input): further modes — full-solve timer/analysis,
  recognition variants, one-look — scoped when the user specs them; any mode
  needing "N moves from a solved step" uses the M5 pruning tables, so
  trainer-analysis features sequence AFTER M5. Random-state scrambles for
  full-solve stay deferred (see the M5 entry: the method solver's inverses
  are not scramble-grade; vendor or port xyzzy's phases when the mode is
  specced).
- [x] **M5 — Solver (2026-07-13). solver.html is LIVE: full step-by-step
  Bencisco solves** (the USER's method decision this session), every line
  machine-proved end-to-end. **The sizing task came in far under the
  checkpoint thresholds** — xyzzy's actual tables (extracted from the
  vendored source): phase 1 three tiny tables ≤ 20 KB; phase 2 ONE 33.9 MB
  in-RAM Int8 table (2,520 × 13,440); phase 3 ONE 63.5 MB table
  (44,100 × 1,440, weighted BFS to depth 25) — ~100 MB RAM built on demand,
  proof the browser tolerates far more than we need. OUR tables
  (`js/tables.js`, rewritten; `loadOrBuildDist`/`loadOrBuildClassTables`
  deleted): per-step pattern databases over independent coordinates —
  centre-orbit multiset patterns (369,600; 8 B-orbit + 3 A-orbit goal sets),
  corners (11,520 × 3 goal sets), 3-edge placements (1,320 × 4), 6-edge
  hexagon-PAIR placements (665,280 × 6 — the strong bound for the later
  center steps), and one-hexagon EXACT tables (edge-placement × color-mask,
  290,400 × 4) — **≈ 7.6 MB persisted in IndexedDB ('fto-tables'/
  'fto-pdb-v2'), first build ≈ 4-10 s, cached visits instant.** No shipped
  binaries, no repo bloat. Decomposition (machine-derived from engine
  geometry + the M3 sheet pins, asserted at core init): a Bencisco "center"
  is a HEXAGON (one face's 3 edges + 3 centre triangles; cubinghistory.com)
  — four of them on tetrad B {D,L,R,B}, partitioning the 12 edges exactly;
  the six triples carry the 6 corners + the 12 tetrad-A triangles. Steps:
  FC = D hexagon → T1/T2 = bottom triples (corners 3,5; either order) →
  SC/C3/C4 = the L/R/B hexagons (search picks the order) → LBT → L3T.
  Steps 1-4 = per-step IDA* over the 16 native moves, h = max of PDBs with
  early-exit thresholding; **weighted IDA* (w = 1.4-1.8) on the center
  steps** — the third center runs 10+ moves deep where exact search
  explodes (measured: w=1.6-1.8 is ~30× faster at ≤ +1 move; w ≥ 2.5 is
  worse on BOTH axes); per-step node budgets + one higher-w rescue retry;
  beam over step junctions (K tunable). Finishes = the sheets' algs
  VERBATIM with two different matching semantics (a real M5 discovery):
  **L3T = exact stateKey lookup** (last step; 1L3T + TCP entries, {ε,U,U'}
  pre/trailing AUF variants as insurance), but **LBT = matching by EFFECT,
  not state** — the sheet's 95 cases pin only the LBT-relevant features and
  the rest of the top layer is a don't-care, so exact keys nearly always
  miss (measured); each LBT entry carries its precomputed effect table and
  applies iff applyTable(effect, junction) lands in the L3T index — one
  test that is both the correctness proof and the guarantee the next stage
  succeeds. The 21 setup-undo LBT texts are indexed/displayed with their
  machine-verified closing token appended. Color neutrality = whole-puzzle
  pre-rotation (conjugation; spelled in Streeter rotation tokens, pinned at
  init against the engine's 48-hold frame walk): orient 'auto' ladder =
  fixed hold (~24/25 scrambles) → vertical spins → trimmed full-24 sweep
  (the rare LBT source dead-ends — both source triangles trapped on side
  slots — get rescued by re-anchoring the method). Measured over the 200-scramble gate scan: **200/200 solved, 0 verify
  failures; totals min 43 / median 55 / p90 61 / max 66 (avg 55.7, better
  than the ~70 human average); median 4.3 s, p90 7 s, max 22 s; ladder use
  186 fixed / 14 vertical / 0 full.** Exit gates met: `npm run test:solver` 19 tests
  green (codecs, admissibility/Lipschitz pins, step regions vs sheet data,
  orientation machinery, tampered-line rejection, full pipelines with
  independent replay); `tools/solver-lab.mjs --scan 200` = GATE PASS (numbers above); headless-Edge E2E 17 checks / 0 console errors (boot,
  IndexedDB cache, solve flow, diagrams, cached reboot < 1 s). solver.html
  un-parked (banner removed), home card updated. DEVIATIONS/deferrals:
  movecount-only metrics (as planned); **random-state trainer scrambles
  DEFERRED** — our method solver's ~55-move inverses are not scramble-grade
  (community standard ≤ 39 via xyzzy's 3 phases, whose 97 MB tables exceed
  the shipped-table budget); revisit when the user specs trainer full-solve
  mode (options: vendor cubing.js's scrambler, or port xyzzy's phases with
  a user checkpoint). USER validation still welcome: execute a printed
  solve or two on hardware (the Skewb junction-pinning protocol) — every
  line is engine-proved, but a physical spot-check closes the loop.
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
- ~~Pruning tables: build-in-browser vs ship precomputed binaries~~
  **RESOLVED (M5, 2026-07-13): build-in-browser** — ≈ 7.6 MB IndexedDB-cached,
  first build seconds; both checkpoint thresholds cleared with wide margin,
  so no user decision was needed.
- Algorithm sheet sources + formats (M3 stays open for more sheets) — the
  case-key symmetry fold still revisits with more data.
- **1LP sheet author attribution** (M3 phase 4 shipped with "attribution
  pending" on algs.html — the PDF names no author; the user should supply
  the credit line). ~~The method lineup
  the solver targets~~ **DECIDED (user, 2026-07-13): the solver follows the
  Bencisco method** (matching the supplied LBT/1L3T sheets); further methods
  would be new step decompositions over the same machinery.
- Trainer tool lineup beyond case drill (M4 shipped drill + recap from the M3
  data; full-solve/recognition/one-look modes await the user's spec, and the
  analysis-flavored ones want M5's tables first).
- Notation presentation: the 8 face letters are settled, but rotation spelling
  (`Ro` vs `Rv` vs `[R]`), slice spelling (`Rs` vs `2U` vs lowercase), and
  lowercase-means-wide-or-slice are NOT community-settled (ground-truth
  §Notation). The engine picks one canonical internal spelling at M1; the
  displayed dialect follows the user's sheets at M3; the WCA/NS-switch pattern
  from Skewbiks is the template if two dialects must coexist.
- Firebase: whether M6 happens at all before launch.
