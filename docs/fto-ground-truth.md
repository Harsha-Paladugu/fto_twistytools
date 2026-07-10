# FTO ground truth

Domain facts for the Face-Turning Octahedron, compiled 2026-07-10 from a multi-agent
web-research pass (sources at the bottom). **Verification tiers used below:**
✅ = multi-source + independently recomputed this session; 🔶 = sourced, single
source or not independently checked; 🔬 = derived geometrically this session,
pending M1 machine verification against cubing.js/ftosim. Anything an engine test
later contradicts, fix HERE first, then the code. This doc replaces
`skewb-ground-truth.md`'s role for the FTO fork (that file describes the inherited
Skewb engine and stays until M1 deletes the code it documents).

## Geometry and pieces

- Regular octahedron; all **8 triangular faces turn in 120° steps** about their
  face axis; 4 axes = 4 opposite-face pairs; every generator has order 3 — there
  is **no half-turn** move. ✅ [Jaap, SSwiki]
- **NOT deep-cut.** Cuts sit at 1/3 depth (Twizzle generator `o f 0.333333333333`);
  each axis has 3 equal-thickness layers (face / middle slice / opposite face).
  The deep-cut relative is the Skewb Diamond. Opposite-face turns do NOT compose
  to a whole-puzzle rotation — the middle slice stays put; face + slice +
  opposite-face = whole rotation about that axis. ✅ [Jaap, SSwiki, Twizzle]
- **42 pieces, 72 stickers, no fixed pieces:**
  - **6 corners** (vertex pieces), 4 stickers each, exactly **2 reachable
    orientations** (180° flip; 90° twists unreachable). Corner sub-puzzle ≅
    Pyraminx edges: even permutations only (A₆), even number of flips only →
    11,520 corner states. ✅ [Jaap, SSwiki]
  - **12 edges**, 2 stickers each, **no orientation** ("always oriented"); even
    permutations only → 12!/2 = 239,500,800. Edge sub-puzzle ≅ Dino Cube. ✅ [Jaap]
  - **24 centers** ("triangles"), 1 sticker each, 3 per face, in **two orbits of
    12 that never mix**; within an orbit each color's 3 pieces are identical →
    12!/(3!)⁴ = 369,600 distinguishable arrangements per orbit. ✅ [Jaap, SSwiki]
- **Face bipartition invariant** (root cause of all orbit facts): 2-color the
  faces so adjacent faces differ; no move mixes the classes. The two classes are
  interleaved tetrahedra of 4 faces; opposite faces are in DIFFERENT classes...
  🔶 correction: sources state centers split by tetrad and a 4-color FTO
  (opposite faces same color) solves identically — the class assignment of
  specific faces under the standard hold is recorded under §Notation as 🔬.
  Practical consequences: a color's 3 centers can only ever occupy its own
  tetrad's 12 slots; corner 90° twists impossible; edges can't flip. ✅ [Jaap]
- **One face turn moves 15 pieces / 27 stickers**: 3 corners (one 3-cycle),
  the face's 3 edges (one 3-cycle), and 9 centers in three 3-cycles — the
  face's own 3 plus **2 from each edge-adjacent face** (center stickers sit
  near face VERTICES, not mid-edge; the two centers with coordinate-sum 5/9
  clear the 1/3 cut, the third at −1/9 does not). Every move is five disjoint
  3-cycles = an even permutation on every piece type. ✅ machine-verified twice
  2026-07-10: (a) independent coordinate model (unit octahedron, cut planes at
  1/3, actual 120° rotation applied — layer closed under rotation, cycle
  structure [3]/[3]/[3,3,3] on all 8 faces; a rival 12-piece derivation
  REFUTED); (b) cubing.js's vendored solver `move_U` = nine 3-cycles over 72
  facelets = 12 corner + 6 edge + 9 center stickers, all other moves
  symmetry-conjugates. M1 must still reproduce this as an engine test.
- The middle slice of an axis holds 6 edges + 6 centers + 0 corners (12
  pieces; layer 15 + slice 12 + opposite layer 15 = 42 ✓). ✅ (same
  coordinate-model verification)

## State space

- **Total: 6! · 2³ · 11! · (12!)² / (3!)⁸ = 31,408,133,379,194,880,000,000
  ≈ 3.14 × 10²².** ✅ [Jaap derivation; Wikipedia same formula + integer;
  SSwiki quotes the integer; recomputed exactly this session]
- Structure of the count: naive 6!·2⁶·12!·(12!)² divided by 2 (even corner
  flips) × 2 (even corner perms) × 2 (even edge perms) × (3!)⁸ (identical
  center triplets) × 12 (puzzle orientation — no fixed piece; only the **12
  tetrahedral rotations** preserve the piece-type orbits, the other 12
  octahedral rotations swap the two face tetrads). ✅ [Jaap]
- Useful sub-spaces for pruning tables (M5): corners 11,520; edges 12!/2 =
  239,500,800; each center orbit 369,600; corner+one-orbit ≈ 4.26 × 10⁹ (too
  big raw — use sub-slices); 6-of-12 edge placements 12!/6! = 665,280. The
  cubing.js vendored solver (xyzzy, ftosolver.js v0.5.1) uses a 3-phase
  decomposition with phase spaces exactly **2,555,520 / 193,536,000 /
  63,504,000** (source comments quote the reduction formulas), BFS pruning
  tables + IDA*; source-supported length bounds: phase 1 IDA capped at depth
  15, phase 2 ≤ 15 and phase 3 ≤ 25 worst-case, fast combined phase-2+3
  search accepts ≤ 24 (no "typical total length" is claimed in the source).
  ✅ [fto-solver.js fetched + quoted 2026-07-10]
- Super-FTO (all 24 centers distinguishable): 13,188,400,838,457,446,891,520,000,000.
  🔶 [SSwiki; integer relation to the standard count verified: × 648²]
- **God's number: unpublished/unknown.** No global-optimal claims anywhere in
  UI copy. ✅ (absence checked across wiki/forum/GitHub)

## Notation (community standard — Gottlieb system as popularized by Streeter)

- **Hold = CIF ("corner in front")**: a vertex points at the viewer; four faces
  read as above/below/left/right of it. ✅ [Ben's doc, cubingcontests rules]
- **8 face letters: U, F, R, L (front four) + D, B, BR, BL (back four)**
  (Gottlieb's system — the qqTimer/csTimer scramble letters). In the CIF hold:
  U = upper-front, F = LOWER-front (below the front vertex — **U and F are NOT
  edge-adjacent**, they meet only at the front vertex), L/R flank the vertex;
  on the back: B adjacent to U (upper-back), D adjacent to F (bottom/back-
  bottom), BR behind R, BL behind L. Bare letter = 120° clockwise looking at
  the face; `'` = counterclockwise; no double moves (U2 ≡ U').
  ✅ [Ben's doc, mzrg megadoc, cubingcontests, cubing.js move set]
- **Opposite pairs: U–D, F–B, R–BL, L–BR.** ✅ [mzrg megadoc verbatim: "U
  across from D, F across from B, R across from BL, and L across from BR";
  independently confirmed from fto-solver.js's corner tables — opposite faces
  never share a vertex, and exactly these pairs never co-occur]. Note for M1:
  cubing.js's KPuzzle def is GENERATED AT RUNTIME by PuzzleGeometry from the
  descriptor `o f 0.333333333333333` — there is no static kpuzzle.json; the
  statically readable oracle is the vendored solver's move/piece tables
  (`move_U`, `corner_piece_facelets`, `edge_piece_facelets`,
  `centreA/B_piece_facelets` in fto-solver.js).
- **SITE NOTATION DECIDED (user, 2026-07-10): Ben Streeter's "FTO Notes"**
  (the Bencisco doc the user supplied — the same speedy.cubing.net/fto
  document this file already cites). The rules, quoted from the doc:
  - Hold: "a corner/vertex directly facing forward and the four adjacent
    corners point diagonally outwards" (CIF).
  - "a letter by itself is a clockwise rotation, while a dash tacked on
    indicates an anti-clockwise rotation"; "Double turns will never be used
    since they are redundant with a three-fold symmetry."
  - Wide: "A w suffix indicates a wide/double layer turn as usual; for
    example Rw indicates turning the two layers parallel to the R face
    clockwise."
  - Slice: "given an s suffix. For example, Rs indicates a turn of the slice
    layer parallel to the R face in the clockwise direction relative to that
    face." AND: "Slice moves are only ever used in conjunction with U, R, F,
    and L (but Rs is often the only one of these which is used during
    solving)" — so each axis's slice normalizes to the front-four letter
    (never Ds/Bs/BRs/BLs).
  - Rotations: "denoted with an o suffix. For example, Ro indicates a 120
    degree rotation about the R face clockwise and Do' indicates a 120 degree
    rotation about the D face anti-clockwise."
  - `T` ("tip"): "acts on the front facing vertex... T by itself is a 90
    degree clockwise rotation, while T' is 90 degrees anti-clockwise. T2 is
    not often used since it is redundant" (the doc's wording; T2 is a valid
    distinct rotation, just rare — M1 should still implement it).
  This is the engine's canonical INTERNAL spelling and the display dialect.
  Other community spellings (below) are parse-level aliases at most. M1 must
  still pin the DIRECTION encodings against a physical oracle (Twizzle) —
  the doc defines directions in prose, and mis-encoding direction is exactly
  the Skewb x/y/z scar. Note the doc's color scheme is Ben's personal
  additive-mixing one (white/yellow, red/cyan, green/magenta, blue/gray) —
  the notation decision does NOT change the renderer's DianSheng default.
- Community variant landscape (context for importing OTHER people's algs;
  treat every alg source's convention as per-source ✅ [community FTO
  Notation guide, Nautilus notation page, forum]):
  - Wide (two layers): `w` suffix (`Rw`) — broadly agreed. Twizzle-style usage
    also writes lowercase letters as wides, BUT older usage (Jaap, tutorials)
    uses lowercase for the MIDDLE SLICE — a live ambiguity; never ingest
    lowercase moves without knowing the source's dialect.
  - Slice: `s` suffix (`Rs`, Ben/guide) vs `2U` prefix-number (Twizzle) vs
    lowercase (Jaap) vs M/N/E/S letters (Nautilus, direction still debated).
  - Whole-puzzle rotations: `o` suffix (`Ro`, Ben's doc + zwegner's sheets) vs
    `v` suffix (`Rv`, cubing.js/Twizzle + current forum usage) vs bracketed
    `[R]` (csTimer's parser) vs `{U,F}` re-orientation pairs (Nautilus).
  - `T` = 90° whole-puzzle rotation about the FRONT VERTEX axis (`T2` valid);
    implemented in both cubing.js and csTimer. ✅
  A minority "EIF" (edge-in-front) hold exists (Jaap's solution, SEE's
  notation, Raúl Low's diagram generator); everything mainstream — methods,
  cubing.js, csTimer, cubingcontests — is CIF. Practical note: alg authors
  avoid D moves (awkward on hardware); scrambles use all 8 letters. ✅
- Engine consequence: native generators = 16 (8 faces × 2 directions); slices
  and wides resolve at parse level. Desugaring (all three layers of an axis
  turned together = the whole-puzzle rotation about it): **slice =
  axis-rotation ∘ own-face′ ∘ opposite-face′** (both flanking layers
  un-turned; mind that the opposite face's letter direction is reversed
  w.r.t. the shared axis) and **wide = axis-rotation ∘ opposite-face′**.
  (NOT "own-face′ ∘ rotation" — that composite drags the far layer along and
  is actually the far side's wide move.) Rotations enter the frame machinery
  like Skewb x/y/z did. The canonical INTERNAL spelling and display dialect
  are DECIDED (user, 2026-07-10): the Streeter system above; other spellings
  are parse-level aliases if a data source needs them (M3 importer concern).
  What M1 still owes: **pin the direction ENCODINGS against a physical
  oracle (Twizzle) before any test vector or alg text is recorded** (the
  Skewb engine's x/y/z turned out inverted vs WCA and it cost a rework).
- Scramble standard: random-state via cubing.js `randomScrambleForEvent("fto")`
  (event id `fto`; filtering not yet implemented upstream); community norm
  before random-state was 25–30 random face moves. Comp rule: scramble with
  **white on U, green on F** (lightest/darkest fallback). ✅ [cubing.js docs,
  cubingcontests rules, csTimer issue #156]

## Methods (the M3 sheet / M5 solver landscape)

The USER supplies the actual sheets; this section is context, not authority.

- **Bencisco** (Ben Streeter; dev from 2018, guide 2019, named 2024) — the
  dominant method ("every ranked solver bronze or higher"). Steps: First
  Center → First Two Triples (triple = corner + 2 centers) → Second Center →
  Last Two Centers → Last Bottom Triple → Last Three Triples (L3T). ~70 moves
  avg; beginner form needs ~4 algs (Hedge `R B' R' B`, Sledge `R' L R L'`,
  two corner 3-cycles); advanced 1-look L3T ≈ **179 algs**. ✅ [SSwiki, Ben's
  doc, forum]
- **Nautilus** (Straughan/Highducheck/Trang, 2024) — First Block → Centers →
  Triple → Last Layer; the main challenger. 🔶
- **Vertigo** (Hudgens & Streeter) — corners-first; shares the L3T algset. 🔶
- **CFL** (Straughan) — Centers → F2L-like → Last Layer. 🔶
- **L4T Redux** (Trang) — reduction to a Pyraminx-like finish; L4E algset. 🔶
- Also: Julian, Cage (commutator/FMC-ish), LBL beginner, Jaap's 3-phase
  (edges ≅ Dino Cube → corners ≅ Pyraminx edges → centers by commutators). 🔶
- Glossary for sheet/trainer work: Center (hexagon = 3 edges + 3 centers
  around a face... verify exact meaning per sheet), Triple, F2T, L2C, LBT,
  L3T, L4T, L4E, Hedge/Sledge, OPF. csTimer ships trainer scramble subsets
  `ftol3t`, `ftol4t`, corners-only, edges-only, centers-only — precedent for
  trainer masked-scramble modes. 🔶 [csTimer source]
- Names that do NOT exist (searched exhaustively; don't cite): "Sraffles",
  "LBP", "Nutella method", "Torbjørn's FTO solver".

## Existing software (oracles + prior art)

- **cubing.js**: first-class FTO — puzzle def at
  `src/cubing/puzzles/implementations/fto/`, vendored random-state solver at
  `src/cubing/vendor/mpl/xyzzy/fto-solver.js` (xyzzy = torchlight; 3-phase
  IDA* + BFS pruning tables), `<twisty-player puzzle="fto">` 3D + 2D views,
  scrambles at `scramble.cubing.net/?event=fto`. **This is the M1 move-table
  oracle and the M5 prior art.** ✅ [cubing.js repo]
- **ftosim** (torchlight) — SVG FTO simulator; second visual oracle. 🔶
- **fto-image-generator** (crystalcuber; cubing.js-based, CIF, two-fan
  diagrams; deployed fto-image-gen.netlify.app) — prior art for M2 case
  diagrams and possibly a direct import for sheet imagery. 🔶
- **zwegner's LBT alg sheet** (zwegner.github.io/cubing/fto/lbt-algs.html) —
  live FTO algset page with inline-SVG case diagrams, `o`-suffix rotations,
  Uw wides; prior art for the Algorithms page AND a candidate data source. 🔶
- Community hubs: the "FTO Notation" standardization guide (Scribd copy),
  Nautilus notation page (sites.google.com/view/nautilusfto/notation), Ben's
  speedy.cubing.net/fto/, the FTO Discord, mzrg.com scrambler megadoc. 🔶
- Others: hydropyrum (exact-arithmetic sim), twisty-polyhedra (generic n-layer
  octahedra + commutator solver), csTimer `scramble_fto.js`, pyTwistyScrambler
  (Python wrapper), GelatinBrain/pCubes (legacy). 🔶
- **fto.wiki is DEAD** (NXDOMAIN 2026-07-10) — don't reference it; Grokipedia's
  FTO page contains factual errors (3-sticker corners, "deep-cut") — never
  cite it. ✅ (both checked directly this session)

## Competitive context (site copy material)

- **FTO becomes an official WCA event 2027-01-02** (announced 2026-06-24;
  Ao5 format; replaces Clock; first new event since Skewb in 2014). Launch
  timing for this site should ride that wave. 🔶 [WCA announcement]
- Records as of 2026-07: single 11.89, average 14.21 — both Aedan Bryant
  (cubingcontests, the de-facto pre-WCA record keeper). 🔶
- People who matter for content/credits: Ben Streeter (method, community),
  Michael Gottlieb (notation), James Straughan/Athefre (Nautilus/CFL, cubing
  history), xyzzy/torchlight (solver). 🔶
- Hardware: 1980s patents by Rubik, Hewlett, and Karl Rohrbach (cubing.js
  credits "Karl Rohrbach, David Pitcher, 1983"); the modern design is David
  Pitcher's (~2001–2003, abandoned patent → public domain); LanLan sole mass
  producer for a decade; magnetic era from 2024 (DianSheng first, then
  DaYan — the 2026 competitive standard —, QiYi, ShengShou). 🔶

## Rendering and color scheme (M2 inputs)

- **The 2D standard is two vertex-centered "diamond" views side by side**:
  front view = U (top) / L (left) / R (right) / F (bottom), back view =
  B (top) / BR (left) / BL (right) / D (bottom), each face drawn as 9 small
  triangles; the back view is the 180° flip about the vertical axis (so R|BR
  and L|BL sit adjacent across the two views). BOTH csTimer and cubing.js
  render exactly this; no community source uses a strip/star octahedron net.
  ✅ [csTimer PR #179 image + current poly3dlib renderNet; cubing.js
  fto.kpuzzle.svg.ts]. This is happily the same shape as the Skewb port's
  front/back two-view net. Alg sheets additionally use partial case diagrams
  (zwegner's LBT sheet: inline SVG, irrelevant stickers dark; "left face in
  front for recognition") and crystalcuber's CIF fan generator. 🔶
- **No single hardware color standard — two schemes, red/green placement
  swapped.** DianSheng (2024+, now dominant; cubing.js AND current csTimer
  default): U white, F green, R red, L purple, B blue, BR gray, D yellow,
  BL orange — opposite pairs white↔yellow, green↔blue, red↔orange,
  purple↔gray ("like the standard 3x3 scheme with purple and grey added").
  LanLan (classic): F red, R green instead → pairs white↔yellow, red↔blue,
  green↔orange, purple↔gray. csTimer hexes for DianSheng order U L F R B BR
  D BL: #fff #808 #0d0 #f00 #00f #bbb #ff0 #fa0. ✅ [forum p.5 quote, csTimer
  kernel.js, cubing.js colors.ts]. Scrambling hold: white U, green F. Ship a
  **configurable palette**, DianSheng default; note pre-July-2024 tutorials
  and previews assume LanLan colors. ✅/🔶
- Remember: opposite faces are in different center orbits, so a 4-color FTO
  (opposite faces same color) is solvable identically — a possible simplified
  diagram mode, not a default. ✅ [SSwiki]

## Test vectors (fill at M1)

- [ ] Pin each native move's piece cycles against fto-solver.js's move tables
      (`move_U` + symmetry conjugates — the static form of cubing.js's FTO;
      the KPuzzle def itself is runtime-generated). `move_U` facelet cycles,
      0-indexed over 72: [0,4,8],[1,6,3],[2,5,7],[9,22,35],[45,67,44],
      [47,68,43],[46,69,39],[50,70,38],[49,71,36].
- [ ] Pin one published scramble + resulting facelet picture (source: a
      cubingcontests/csTimer preview or ftosim screenshot).
- [ ] Derive and pin the state-space count from the engine's own orbit/parity
      verifiers (must reproduce 31,408,133,379,194,880,000,000 symbolically).
- [ ] Pin rotation-letter directions (o/T) against Twizzle before ANY alg data
      is authored (Skewb x/y/z lesson).
- [ ] Record the per-turn 15-piece/27-sticker breakdown as an engine test.

## Sources

Primary: Jaap's Puzzle Page (jaapsch.net/puzzles/octaface.htm); Speedsolving
wiki "Face Turning Octahedron"; Wikipedia "Face Turning Octahedron"; Ben
Streeter's FTO Notes (speedy.cubing.net/fto/); cubingcontests.com/rules;
cubing.js repo + docs (github.com/cubing/cubing.js, js.cubing.net); csTimer
repo (github.com/cs0x7f/cstimer); cubinghistory.com/FTO; WCA announcement
worldcubeassociation.org/posts/changes-to-the-wca-s-list-of-official-events-june-2026;
cubingcontests.com/rankings/fto; torchlight/ftosim;
crystalcuber/fto-image-generator; speedsolving forum threads (FTO discussion,
All FTO methods, Nautilus announcement). Full per-claim URL list in the
2026-07-10 research transcript (session artifact).
