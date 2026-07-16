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
  Other community spellings (below) are parse-level aliases at most.
  **Direction encodings are MACHINE-PINNED (M1+M2)** against both xyzzy's
  tables and cubing.js's runtime KPuzzle def; cross-dialect equivalences for
  the M3 importer, all machine-verified: Streeter `Xo` ≡ cubing.js `Xv`
  (same direction), Streeter `T` ≡ cubing.js `T`, Streeter `Xw` ≡ cubing.js
  lowercase `x`, Streeter `Xs` ≡ SiGN `2X`. Note the doc's color scheme is Ben's personal
  additive-mixing one (white/yellow, red/cyan, green/magenta, blue/gray) —
  the notation decision does NOT change the renderer's DianSheng default.
- **ENGINE NOTATION EXTENSIONS (M3, machine-verified)** — added for the
  community "FTO Notation" doc (Sonja Black) and the TCP sheet:
  - **`{X,Y}` bracket rotations**: face at position X → the U position, face
    at position Y → the F position. The (X,Y) faces' adjacency determines the
    resulting hold: vertex-adjacent → CIF, edge-adjacent → EIF, otherwise
    impossible (throws; `caseStateOf`/`algSolvesKey` return null/false). All
    five worked examples in the notation doc reproduce exactly.
  - **EIF dialect**: `applyParsed`/`effectTable`/`caseStateOf`/`algSolvesKey`
    take a dialect ('cif' default, 'eif'). EIF base hold: positions
    [U,F,BR,BL,L,R,D,B] hold faces [U,L,R,B,BL,F,D,BR] (derived from the
    notation doc's paired illustrations; opposite-consistent; pinned by the
    TCP structure tests). The engine models all 48 holds (24 CIF + 24 EIF);
    o-rotations from EIF holds preserve the hold type (position-conjugation
    formula π = ε⁻¹∘ρ_{ε(X)}∘ε — the doc's bracket table is the CIF special
    case).
  - **`X2` ergonomic doubles** (≡ X′, count as ONE move — sheet convention)
    and **lowercase wides** (`r` ≡ `Rw`; normAlg canonicalizes to w-suffix).
  - **Doc erratum found**: the notation doc says wide "u is equivalent to a
    D' turn plus a 120 rotation" — machine-pinned identity is u = Uo ∘ D
    (opposite face UNPRIMED; no rotation makes the D′ version true).
- **ROTATION DISPLAY DECIDED (user, 2026-07-14): the `{X,Y}` re-orientation
  bracket system, site-wide.** Every rotation the site DISPLAYS or STORES —
  sheet texts in `data/fto_algs.json`, the solver's conjugation pre-rotations
  and Bencisco grip spells, any future surface — is written as a single
  `{X,Y}` bracket (face at position X → the U position, face at position Y →
  the F position; all 48 holds are reachable, so every re-orientation is
  exactly one token). The `o`/`T` spellings remain PARSE-LEVEL INPUT ALIASES:
  the engine's internal letters, parser and normAlg are unchanged, and
  `[Uo]`-mark/`T` parsing is kept for source fidelity — the conversion is a
  display/data convention, not an engine change. CIF equivalences in live use
  (the notation doc's own bracket table, machine-verified): Uo = {U,BR},
  Uo' = {U,BL}, T = {L,R}; the solver grips T / Uo T / Uo' T = {L,R} /
  {R,B} / {B,L}. Data conversion: `tools/lib/bracketize.mjs` rewrites
  importer texts and re-proves each rewrite move-for-move (same fired native
  sequence AND same final hold, else it throws; rotation-shaped tokens
  outside its map also throw). 56 texts across LBT/1LP converted (TCP and
  1L3T were already bracket-native); an independent old-vs-new sweep
  verified all 418 shipped algs move-for-move; solver spells come from the
  direct bracket construction in solver-core's SPELL_BY_HOLD (identity
  spells empty) and tables.js BL_SPELLS, both init-asserted through the
  engine's own hold walk.
- **zwegner 1L3T dialect (M3 phase 2, machine-verified 2026-07-13)** — the
  engine parses natively: `S` = sledge `R' L R L'`, `H` = hedge `R B' R' B`,
  `S'`/`H'` their exact textual inverses (macros expand at parse level, so
  they are hold-relative and dialect-aware); `[U]`/`[U']` = pre-AUF marks,
  executed as the plain move. **`[R]`-style tokens stay unparseable on
  purpose: csTimer spells whole-puzzle ROTATIONS with square brackets — never
  feed csTimer-dialect texts through the engine parser.** Sheet facts, all
  machine-pinned (test-engine §14): 179 cases (1.E.1 = solved), all alg
  states L3T-local; ~30 algs are noted specials — 15 end one final AUF short
  as printed, 15 are "working-slot variants" (they solve the case with the
  unsolved below-layer triangles parked on a different face — same corners/
  edges up to a vertical re-grip, centre diffs confined to the top face + the
  tetrad-A parking slots {F+x, BR+x, BR+y, BL+z}); TWO source algs are
  transcription errors that do not solve last-layer states (6b.E.5's only
  alg; 4b.O.4's fourth) — excluded from our data, exclusion self-checked.
  Cross-sheet oracle: all 18 TCP alg states appear EXACTLY among the 6c algs;
  TCP 11/12 appear as the working-slot variants of 6c.O.6/6c.O.8.
- **zwegner LBT sheet (M3 phase 3, machine-verified 2026-07-13)** — plain
  Streeter dialect (Uo rotations, Uw/BLw/BRw wides, Us slices; no S/H macros,
  no [U] marks — zero parser work; since 2026-07-14 the page's Uo/Uo' tokens
  ship respelled as {U,BR}/{U,BL} brackets, see the rotation-display bullet). LBT = Bencisco's Last Bottom
  Triple: the bottom-left slot between the F and BL faces = corner slot 4 +
  centre slots F(4)/BL(10) in engine numbering. **LBT-locality = the 1L3T
  region ∪ that slot** (after LBT exactly the last-layer region remains — the
  Bencisco solve order as a cross-sheet pin; test-engine §15). Sheet facts,
  machine-pinned: 96 page cases in 24 groups of 4 across 6 sections (case 21
  = the solved state, no alg, omitted from our data), 120 curated algs (the
  page's hidden "raw dump of all generated algs" is deliberately NOT
  imported); corner-in-slot ⇔ section 1, on-top corners only ever sit on the
  front-top slots {0,2}; all algs of a case agree on the corner, but may
  consume DIFFERENT source triangles (the page's "there are two of each
  color's triangles that can be used" — cases 56/84 genuinely differ on slot
  color-status across their algs, so per-alg exact states are the only
  authority below the corner level). **21 algs are printed with a leading
  Uw/Us setup whose restore the page leaves implicit — as printed they end
  exactly one wide/slice turn short of solved (a rotation conjugation can NOT
  absorb it: the residue is a real bottom-vs-rest misalignment); the closing
  token is always the textual inverse of the alg's first wide/slice token**,
  noted per alg in the JSON ('⚠ setup undo' on algs.html). Cases 7/8 each
  print two spellings the page calls "the same, just notated differently" —
  pinned state-identical. First `auf: false` trainer subset (a U pre-turn
  would change the case). Credits: zwegner (generation + curation), 360cubed
  (keyhole cases 1/2/5/6), Ben Streeter (trapped-triangles cases 33/34/37/38
  + the traditional flipping-alg cases).
- **1LP sheet dialect (M3 phase 4, machine-verified 2026-07-13)** — the
  user-supplied "One Look Pair Formation (1LP) Cases and Solutions" PDF
  (V3; verbatim transcription committed as
  `data/sources/1lp-rotationless-v3.json`; author attribution pending from
  the user). Dialect: S/H sledge-hedge macros exactly as the 1L3T dialect
  (the PDF defines them identically: right hedge R B' R' B, right sledge
  R' L R L'), `(U)`/`(U')` paren AUF marks (parens already strip at parse —
  executed as the plain move), and **`[Uo]`/`[Uo']` bracket rotation marks,
  executed as the state-neutral Uo rotation** (since 2026-07-14 the marks
  ship respelled as {U,BR}/{U,BL} brackets — see the rotation-display
  bullet; the leading/trailing semantics below carry over verbatim): a
  LEADING mark gives the
  solution for a Uo-rotated view of the same case (5 of the 14 such lines
  are pinned state-IDENTICAL to another line of their case — the same
  physical solution re-spelled from the rotated grip; Uo-conjugation maps
  the hedge family into the sledge family), a TRAILING mark annotates the
  ending orientation (a rotation never changes the state, so it executes as
  a no-op). csTimer-style `[R]`/`[Ro]` remain unparseable on purpose.
- **1LP / pair-formation structure (M3 phase 4, machine-verified)**: the
  L3T coset (everything below the last layer solved) is EXACTLY the closure
  of {U, S, H} from solved = **4320 states** (bare sledge and hedge are
  L3T-local effects; no hidden coupling — corners 12 × edges 3 × centre
  arrangements 120). The sheet-image language (yellow = U-colored sticker,
  blue = bottom-triangle/non-U corner sticker) partitions the coset into
  **80 appearance classes of exactly 54**; the structurally-FORMED family
  (each top position an upright pair — U triangle up, bottom triangle in the
  flank — or a flipped pair — the reverse; colors ignored, which is what the
  sheet's "neutral pair formation" means) is exactly **4 appearances = 216
  states**, and **all 18 TCP case states share ONE appearance** (one upright
  + two flipped pairs — the TCP set's canonical position; solved is the
  all-upright appearance). Every 1LP sequence is machine-verified to map its
  ENTIRE 54-state appearance class into the formed family (appearance
  transport is facelet-functorial, so pair formation is guaranteed from
  anything that looks like the case); the color crossings the "neutral"
  convention allows are exactly why the finish needs the full 18-case TCP
  set (or 2-look), as the sheet's intro says. Cross-sheet pins: zwegner's
  1L3T page enumerates 537 = 179×3 of the 4320 (its cases are keyed at a
  canonical grip; its 12 OLP groups fold-match the 12 appearance orbits
  under AUF-turn + Uo-re-grip exactly); the TCP finish set (TCP ∪ solved
  ±AUF, 57 keys) has exactly 51 zwegner-labeled members (the 16-exact TCP
  oracle + solved); the PDF's "this OLP has only 11 possible permutations"
  is pinned — H sends exactly 11 zwegner group-1 states into the TCP finish
  set; exactly one 1LP line state coincides with a zwegner primary (1LP 7 =
  4a.O.6). The sheet's Parity column (Stays/Flips) does NOT map onto
  zwegner's E/O labels under any state-level reading tested — it ships as
  the author's own prose, marked unverified. All pinned in test-engine §16.
- **TCP sheet findings (machine-verified 2026-07-10)**: the TCP sheet's
  header claims EIF notation, but all 18 algs execute from the **CIF hold**
  (the community notation doc's TCP description is the accurate one). The
  TCP case space = the U face's three TRIPLES (corner + its two flanking
  tetrad-A triangles) + the filled slot F(+x): 2-Flip group ⇔ filled slot
  solved; "2-Flip" = two triples flipped in place (corner flip + its
  triangle pair swapped — coupled by geometry); Odd group states compose
  with the starting AUF (a U-layer turn) for cases 7-10, whose texts INCLUDE
  the AUF — but cases 11/12 are authored POST-AUF (their texts solve
  even-shaped states; the sheet's "each alg includes the starting AUF" note
  does not hold for them — machine-verified, annotated per-case in the
  JSON). Pinned in test-engine §12. Also: `T` from an EIF hold is defined as
  the literal bracket {L,R} and lands in a CIF hold (a 90° front-vertex turn
  is physically meaningless from EIF — no front vertex); any T token in a
  future EIF-dialect sheet deserves review.
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
  and wides resolve at parse level. Desugaring — MACHINE-VERIFIED against the
  xyzzy oracle (test-engine.mjs), with every letter meaning clockwise viewed
  from its OWN face's outside: **Xs = Xo ∘ X′ ∘ OPP(X)** and
  **Xw = Xo ∘ OPP(X)** (equivalently Xo = X ∘ Xs ∘ OPP(X)′). The opposite
  face's factor is UNPRIMED: clockwise-from-its-own-side is already the
  reversed sense about the shared axis, which is exactly what cancels the
  rotation's drag on that layer. Concretely: Us = Uo ∘ U′ ∘ D and
  Uw = Uo ∘ D, pinned facelet-exactly against ftosolver.js's move_Us/move_Uw. Rotations enter the frame machinery
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
- **Bencisco structure, machine-verified (M5, 2026-07-13)**: a Bencisco
  "center" is a HEXAGON — one face's **3 edges + 3 centre triangles**
  ("grouped such that they form an inscribed hexagon on one face"; four of
  them total) 🔶→✅ [cubinghistory.com/FTO/Methods/Bencisco; piece accounting
  closes exactly and is asserted at solver-core init]. The four hexagon
  faces are ONE tetrad — in engine coordinates tetrad B {D, L, R, B} — and
  they PARTITION the 12 edges (D {9,10,11}, L {1,2,8}, R {0,3,6},
  B {4,5,7}); the six triples carry the 6 corners + the other tetrad's 12
  triangles (each corner pairs with its two flanking tetrad-A slots:
  0↔{U(0),F(3)}, 1↔{U(1),BR(7)}, 2↔{U(2),BL(11)}, 3↔{BR(6),BL(9)},
  4↔{F(4),BL(10)} = the LBT sheet's pin, 5↔{F(5),BR(8)}). Solve order in
  engine coordinates: D hexagon → corners 3,5 triples (F2T) → L/R/B
  hexagons (SC + L2C) → LBT (corner 4) → L3T (the U layer). All pinned in
  tools/test-solver.mjs against the M3 sheet data.
- **Bencisco execution hold (M5 rework 2026-07-13, revised 2026-07-14,
  refined 2026-07-15, centers restricted 2026-07-16, machine-verified)**:
  the solve builds the **WHITE center first, every time** (USER spec
  2026-07-14 — no color neutrality), then HOLDS IT ON THE BL FACE. The
  step move sets (USER specs 2026-07-14 + the 2026-07-15 refinement "I
  want the triples to be solved with R U Rw moves" + the 2026-07-16
  restriction, applied to the solver at the user's direction after the
  Centers trainer): the **triple steps (t1/t2) use {R, U, Rw}** and may
  re-grip mid-word for free, the rotation fused to the U turn that needs
  it and printed as one {X,Y} bracket ({F,BR} spinning forward / {BR,U}
  backward — the same letters at every grip); the **center steps
  (sc/c3/c4) use the RESTRICTED triple-preserving {R, U, Rw} system from
  the ONE aligned grip** — no BL, no mid-word rotations, and the solved
  triples NEVER leave their place (the trainer's theorem: Rw's drift
  tracks the block position, so the aligned grip's plain U token is
  always the safe working face; each center goal puts the white center
  exactly home, so the net drift is 0 at every center junction and the
  grip returns to the aligned one — the center stage never re-grips
  between its steps either; per-line prefix walks re-prove the contract
  in test-solver). A triple re-grip is NEVER spelled as a token pair:
  `Rw BL'` (engine D then D′ — no state change, pure re-grip) is banned
  outright by the search canonicalization (USER report 2026-07-15: "it
  would be better to just rotate by doing a {F, BR}"). In the triple
  search metric a composite costs 2 (its turn + a reading penalty;
  displayed movecount counts only the turn), so plain spellings win
  unless the rotation saves a real move — measured ~0.7 mid-word
  re-grips per triple. The old insert-with-{B,U} triple shape
  (2026-07-14) is RETIRED, and with it the hold's B tokens; the center
  steps' BL token and re-grip composites retired 2026-07-16 with the
  restricted metric (their sealed-metric PDB families rB/rE6/rH1 deleted
  — the center heuristics read the C23 bundle's (cell × drift) tables,
  and the center steps went back to EXACT search, w = 1). Facts, all
  derived from the engine's hold walk (`js/tables.js makeBLHold`) and
  pinned in tools/test-solver.mjs:
  - White-first = whole-puzzle pre-rotation: exactly **3 rotations map the
    white (engine U) material onto the method's D region** — the spins
    about the white axis, spelled `{D,L}` / `{D,R}` / `{D,B}`. They are the
    ONLY admissible pre-rotations (the old fixed → vertical → full-24
    ladder collapsed onto them; the last auto rung re-runs all three with a
    wider beam instead of surrendering the color). Every emitted line is
    additionally cross-pinned against the trainer's placement-neutral
    first-center goal set: after the printed pre-rotation plus the fc
    segment, the white hexagon is formed.
  - Exactly **3 CIF grips** place the first-center face (engine D) at
    position BL with engine U at position R (R and BL are opposite):
    spelled `{L,R}`, `{R,B}`, `{B,L}` (the pre-2026-07-14 o/T spellings
    were `T`, `Uo T`, `Uo' T`); hold-U reads engine L / R / B
    respectively. Rw reads engine D PLUS a grip drift about the R-BL axis
    (walkParsed's wide re-hold); BL reads engine D in place — the two share
    a state effect and differ only by the frame rotation, which is why the
    pair `Rw BL'` is a pure re-grip and why runs never need both letters.
    All R-axis tokens read the same engine faces at every grip ({U, D});
    only the hold-U face varies by grip — so a mid-word re-grip is exactly
    "choose which of engine L/R/B the next U turn hits", and canonical
    words carry re-grips only immediately before U turns. A pure {R,U,Rw}
    word CANNOT re-grip at all: its net grip drift and its net engine-D
    power are locked together through Rw, so the triple steps' composites
    are load-bearing for reachability, not just ergonomics.
  - **Continuous-line display (physical-loop finding, user 2026-07-14)**:
    the original display anchored every segment's grip spell at the
    recognition hold, a hidden "reset between segments" convention that a
    human executing the printed tokens in order never applies — and the
    wide moves' hold drift makes the reset unknowable by memory; a one-pass
    replay of the flat text failed on 25/25 sampled lines. Displayed lines
    are now ONE continuous engine text: every junction re-grip — grip
    changes AND wide-drift compensation — is an explicit {X,Y} bracket
    spelled RELATIVE to the hold the previous tokens actually leave (or
    omitted when the human is already holding it right), and verifyLine
    proves the exact flat text end-to-end from the scramble state
    (solver-core respellLine; pinned in tools/test-solver.mjs). Within a
    segment the wide-drift reading itself is the sheets' own convention and
    stays (see the wide/slice pins above).
  - The hold group **SEALS the first center**: engine D's 3 edge slots and
    3 centre slots are invariant under the sealed group's reachable face
    effects {U, D, L, R, B} (each D edge's other face is F/BR/BL — all
    outside the group — and D's centre slots sit only in the D/F/BR/BL
    layers), so a solved first center can only SPIN (BL/Rw), realigns in
    ≤ 1 move, and can never be broken by ANY hold step — since 2026-07-15
    the triple steps live inside the group too (their 2026-07-14 B-turn
    insertions, which passed through the sealed region, are retired).
  - Inside the post-first-center invariant space every later-step
    coordinate is fully reachable; r* eccentricities in the search's own
    metric (tokens 1 / re-grip composites 2, min over grips —
    js/tables.js bfsTableR walks the composite edges backward as
    "turn-then-re-grip", which coincides under the all-grip goals + grip
    collapse): remaining-center patterns ≤ 11, one-hexagon-exact ≤ 16,
    hexagon-pair 6-edge placements ≤ 17, triple-centre pairs ≤ 8 (single
    triples ≤ 5), corners ≤ 6 (singles ≤ 3). Coordinates OUTSIDE the
    invariant space are permanently unreachable (a single BR turn from
    solved already strands first-center triangles) — the r* PDBs mark
    them with a 99 sentinel, which fails an impossible junction
    instantly. Every hold step (triples AND centers) reads the r*
    families now; the 2026-07-14 free-16-metric fA/fC detour is deleted.
    Table Lipschitz constants along sealed moves are 1 for engine U/D
    turns but 2 for engine L/R/B (a composite from the wrong grip) —
    pinned in tools/test-solver.mjs.
  - Measured (200-scramble gate scan, 2026-07-15, post R-U-Rw triple +
    re-grip-composite rework): 200/200 solved, 0 verify failures, 0
    truncated; totals min 45 / median 60 / p90 65 / max 71 (avg 59.3 —
    2.3 moves BETTER than the insert-with-B design's 61.6: the cost-2
    re-grips buy real moves where they appear); median 443 ms / p90
    2.8 s / max 8.8 s (the exact-metric r* tables prune the triples hard
    again); anchor ladder 183 primary / 16 spins / 1 wide retry.
- **LBT case-space semantics (M5 discovery, machine-measured)**: the LBT
  sheet's 95 cases pin only the LBT-RELEVANT features (the corner-4 piece +
  the two source triangles); the rest of the top layer is a DON'T-CARE, so
  matching a junction by exact state key nearly always misses — an LBT alg
  applies at a junction iff its EFFECT lands the state in the L3T case
  space. The 1L3T sheet, being the LAST step, does match by exact state.
  Post-L2C states can also strand both of a color's source triangles on
  side parking slots that no sheet alg (even AUF'd) reaches — a real
  dead-end for the fixed hold, resolved by re-anchoring the method via a
  whole-puzzle pre-rotation (~1 in 25 random scrambles; the solver's
  'auto' orientation ladder).
- **First-center step space (trainer derivation, machine-verified 2026-07-13,
  independently re-verified by a second BFS with a different encoding)**: a
  correctly-solved Bencisco FIRST CENTER — the white hexagon (U's 3 edge
  pieces + the 3 white centre triangles) formed on ANY tetrad-A face — is
  exactly one of **12 formations**: 3 per candidate face, the restrictions of
  the 12 tetrad-preserving proper rotations of solved. Edge orientation is
  forced (an edge shows its tetrad-A color on the slot's tetrad-A face at
  EVERY slot), so the other 3 all-white edge orders per face — the improper
  (mirror) restrictions — display a visually complete hexagon that can never
  survive a full solve: **false solves**. Over the 290,400-state coordinate
  (1,320 placements of U's edges × 220 white-triangle masks; all reachable):
  **God's number = 7 face turns** (depth histogram 12 / 72 / 648 / 5,868 /
  39,780 / 139,368 / 102,900 / 1,752) and **= 6 when slice turns count as one
  move** (12 / 72 / 936 / 11,412 / 82,548 / 172,248 / 23,172); the 12 mirror
  false-solves sit at EXACTLY God's number in both metrics. Fixed-frame
  exact-home variant (the solver's H1 shape): eccentricity 9. Supporting
  pins for the trainer's displayed solutions: face-axis rotations generate
  exactly the 12 tetrad-preserving CIF holds (A4), and from each of them
  every fixed-frame face move or slice is spellable by exactly one token, so
  the hold-aware respelling never gets stuck and never costs extra moves; a
  single wide token's state effect is exactly one native move (16/16 — wides
  can never beat the token metric); the hold-rotation-after-wide/slice
  reading is pinned NON-circularly by the LBT sheet's case 7 "same alg
  notated differently" twin (the wide spelling only reproduces its plain
  twin's letters under it). All pinned in tools/test-trainer.mjs.
- **First-two-triples step space (trainer derivation, machine-verified
  2026-07-15)**: the F2T drill's optimal is measured in the sealed group's
  **10-native-move TURN metric** ({U, L, R, D, B}± in the method frame).
  Re-grips are free rotations and every sealed move is exactly one hold
  token from every grip, so this metric IS "how many R/U/Rw turns" — the
  fair, unbeatable target for a move-count drill. The solver's search
  metric (re-grip composites cost 2 — a READING penalty) can exceed it, so
  the r* PDBs are inadmissible for the trainer and it carries its own
  tables (js/tables.js `buildF2T`; goal sets = the solver's rA/rC
  families). Turn-metric eccentricities: single-triple centre pairs ≤ 4,
  both-triples centres ≤ 6, single corners ≤ 3, corner pair ≤ 4; the whole
  restricted space is sealed-reachable (no sentinels). Scrambles use the
  PHYSICAL sealed alphabet — the sealed group conjugated back through the
  primary `{D,L}` white anchor = **{U, F, BR, BL, D}±**, the 10 moves that
  preserve the white-on-top hexagon (they can only spin it; scrambles are
  rejection-sampled to land it exactly home, so the drill starts at the
  triples step with the white center literally solved). Entry into the
  execution hold from the scrambling hold is one {X,Y} bracket per grip:
  **{F,BL} / {BL,BR} / {BR,F}** (walk-proved). Displayed lines respell the
  optimal sealed words deterministically: engine U/D turns → R / Rw (Rw
  carrying walkParsed's grip drift), engine L/R/B → the plain U of the
  grip that reads them, mid-word re-grips → relative {X,Y} brackets; the
  fewest-bracket spelling among the 3 start grips is shown and every line
  is re-proved end-to-end from the drill state. A useful spelled-out
  consequence, pinned in tests: with free re-grips a pure-token search and
  a sealed-native-move search coincide, which is why the trainer can
  enumerate optimal solutions as canonical ENGINE words (grip-independent,
  well-defined counts) and respell afterwards. All pinned in
  tools/test-trainer.mjs.
- **Second/third-center step space (trainer derivation, machine-verified
  2026-07-15; RESTRICTED triple-preserving metric 2026-07-16)**: the
  Centers drill (Bencisco second/third centers) measures its target in the
  RESTRICTED metric — words that can NEVER take the solved triples out of
  place, with no mid-solve rotations (user spec 2026-07-16). The center
  alphabet is exactly **{R, U, Rw}** from ONE fixed {F,BL} entry bracket.
  The theorem behind it (derived from the engine's own tables,
  init-asserted in tables.js makeRestricted, fuzz-pinned in tests): the
  solved BLOCK — white hexagon + both bottom triples: corner slots {3,5},
  edge slots {9,10,11}, ctr slots {5,6,8,9} + {18,19,20} — is fixed by
  engine U± (the hold's R token) and, per block position b, by exactly ONE
  of {L,R,B}± (the working face); engine D± (the Rw token) moves the block
  RIGIDLY: block(b) = D^b(home), b = net signed D power. Rw's grip drift
  tracks b exactly — the working face at position b is wantU[(j0+b) mod 3]
  — so from the single aligned entry grip (j0 = 0, entry {F,BL}, working
  faces L/R/B by drift) the plain U token is ALWAYS the safe face: a
  {R,U,Rw} word physically cannot disturb the triples or the white center
  relative to them, at ANY prefix. BL (engine D in place, NO drift) breaks
  the alignment — the very next U token would rip a triple — and since
  engine U and D both commute with D, a BL commutes past every token still
  legal after it: mid-word BL pairs cancel and a trailing BL is Rw's
  driftless twin, so optimal restricted words never contain BL at all.
  White exactly home ⇔ b ≡ 0 (only D turns touch its edges), and the
  triples' re-solve is the same condition — so the search node is
  (coordinates, b) with every goal at b = 0, and the triples' own
  coordinates (corners, orbit-A masks, the D-edge placement) drop out of
  the search entirely. Goals stay placement-neutral ('second' = ANY one of
  the L/R/B hexagons formed, 'third'/'both' = any two, always block-home
  at the end). Restricted-metric tables over (cell × 3 drifts): one-hexagon
  exact ecc 16/17/17 (L/R/B; was 12 sealed), pair edges 17/17/18, orbit-B
  mask-pair singles 8 / 'all' 12; EVERY sealed-reachable cell remains
  reachable at every drift (127,008 = 42,336×3 one-hexagon nodes, 181,440
  = 60,480×3 pair placements, 5,040 = 1,680×3 valid mask pairs) — the
  restriction never strands a drill. The index-carrying DFS steps six
  small indices (3 e3 placements, 2 orbit-B masks, b) and the
  (cell,b)-exact tables prune so hard the old multi-second tails vanished:
  measured over 50 drills/mode — optimals 'second' 1-11 (median 8),
  'third' 3-16 (median 9), 'both' 2-20 (median 14); generation median
  1-3 ms, p90 ≤ 100 ms, max ~0.6 s; reveal enumeration ≤ 5 ms. Reveal
  lines are pure token strings (fixed {F,BL} entry + R/U/Rw), and every
  displayed line passes BOTH the end-to-end applyParsed proof and a
  per-prefix block-intactness walk (block = D^b(home) after every single
  move — the "triples never leave their place" contract, machine-checked
  per line). The solver's center steps (sc/c3/c4) adopted this same
  restricted system later the same day at the user's direction (see the
  Bencisco execution hold entry) — trainer and solver now share the
  metric AND the tables (the C23 bundle, one IndexedDB cache serving both
  pages). All pinned in tools/test-trainer.mjs. A fourth-center corollary,
  machine-measured before the user retired that mode as redundant
  (2026-07-16; implementation in git history at 7c105c1): with the white
  center, both triples and two hexagons formed, the last hexagon's
  triangles are FORCED — any two orbit-B blocks plus D determine the
  third — leaving an edges-only even 3-perm (identity or one of two
  3-cycles) whose optimal is always 1 or 3 turns (80/80 sample). That is
  WHY the centers stage needs no drill beyond the third center.
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
  Uw wides; IMPORTED at M3 phase 3 (2026-07-13, `tools/import-lbt.mjs`,
  snapshot `data/sources/lbt-zwegner.html`) — see §Notation for the
  machine-verified sheet facts. ✅
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
  **Our js/render.js implements exactly this convention (M2)** — verified
  side-by-side against cubing.js twisty-player 2D in headless Edge, and the
  layout/chirality are pinned by tests (test-render: quadrant map + exact
  projected centroids). Masking hook (`opts.mask`) ships for M3/M4 partial
  diagrams.
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

## Test vectors (M1 status — `npm run test:engine`, 34 tests)

- [x] Every native move's facelet table pinned EXACTLY against ftosolver.js
      (`move_U` cycles + the X/Y/Z symmetry derivations, reproduced in
      `tools/fixtures/xyzzy-fto.mjs` with attribution; our engine derives its
      tables from 3D geometry and matches byte-for-byte, both directions).
      `move_U` facelet cycles, 0-indexed over 72: [0,4,8],[1,6,3],[2,5,7],
      [9,22,35],[45,67,44],[47,68,43],[46,69,39],[50,70,38],[49,71,36].
      Convention: perms are PULL (new[i] = old[P[i]]); xyzzy's U is clockwise
      = right-hand −120° about the outward face axis (content at the +x corner
      of U moves to the +z corner).
- [x] Rotation directions: T² ≡ oracle X symmetry; mirror ≡ oracle Z; 180°
      vertex rotation ≡ oracle Y; T(U)=R, T(R)=F (CW about the front vertex,
      matching the doc's "clockwise" under the CIF hold); o-rotations share
      the oracle-pinned face-turn convention. Slice/wide desugar identities
      pinned facelet-exactly (Us = Uo∘U′∘D, Uw = Uo∘D).
- [x] State-space count reproduced symbolically (BigInt) =
      31,408,133,379,194,880,000,000; corner sub-space BFS = 11,520; centre
      orbit BFS = 369,600; parity/flip/orbit/triplet invariants over random
      move sequences.
- [x] Per-turn structure as engine tests: 15 pieces / 27 facelets, five
      disjoint 3-cycles; slice = 12 pieces / 18 facelets.
- [x] CLOSED at M2, two ways: (a) side-by-side headless-Edge screenshots of
      our netSVG vs cubing.js twisty-player 2D (solved, U, R′, BL, D, a
      12-move scramble, T, Rv) all agree; (b) cubing.js's runtime-generated
      KPuzzle def dumped to `tools/fixtures/cubingjs-fto-kpuzzle.json` and
      pinned in test-engine §11 — slot correspondence derived from face
      signatures alone, then all 16 face moves, T/T2 (the single-T direction
      residue is CLOSED: **cubing.js T ≡ our clockwise T**), Uv/Rv/Lv ≡ our
      Uo/Ro/Lo (same direction), SiGN `2U` ≡ our Us, their lowercase wides
      (`r`,`u`) ≡ our `Rw`,`Uw`, Z4/Z2 orientation-reference solves, and
      piece-exact probe patterns. Renderer chirality is pinned by exact
      projected centroids in test-render (a mirrored drawing flips them).

## OOEngine contract delta (M1 — vs the inherited Skewb engine)

DROPPED (consumers stay known-red until their milestones rewrite them):
`idx`/`unidx`/`NSLOTS` (no dense full-space indexing at 3.1 × 10²²),
`optimalSolution`/`optimalScramble` (per-step search returns at M5),
`buildSyms`/`makeCanon`/`makeMirrorCanon`/`makeFullCanon`, `enumFreeSlots`,
`prependAUF`, `inverseState` (identical centre triplets make color-level state
inversion ill-defined — use `invertTable`), `wcaToNS`/`nsToWCA`/`convertAlg`
(one notation now), `nativeToWCA`, and the Skewb geometry tables.

ADDED: the facelet layer (`toFacelets`/`fromFacelets`/`solvedFacelets`/
`applyFaceletPerm`/`moveFaceletPerm`/`sliceFaceletPerm`/`rotFaceletPerm`/
`FEAT`), state-level `moveTables`, the invertible alg-effect layer
(`effectTable`/`invertTable`/`applyTable`/`idTable` — backs `caseStateOf` for
rotation-containing algs), rotation machinery (`ROT24`, `MID`/`ROT_T`/
`MIRROR`, `mul`/`mInv`/`mApply`, `tokenRotMat`, `faceImg`/`vertImg`),
`mirrorAlg` (U↔L/F↔R/BR↔D/BL↔B reflection), `randomScramble(len, rng)`
(random-move; seedable), `stateSpaceCount()` (BigInt), and geometry exports
(`FSIGN`/`OPPF`/`TETRAD`/`VAX`/`EDGES`/`CYC`). `realCanonKey` = identity fold
at M1 (fold decision deferred to M3 — widening re-keys the compiled sheet).

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
