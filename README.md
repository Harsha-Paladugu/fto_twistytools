# fto.twistytools.com

A static site for solving and learning the **Face-Turning Octahedron (FTO)**,
the third site in the TwistyTools family after
[pyraminx.net](https://pyraminx.net) and [skewbiks.com](https://skewbiks.com).
Forked with full history from the Skewb site (kept as the `upstream` remote so
shared-layer fixes stay cherry-pickable). Four pages share one engine and one
set of UI layers; the only build step compiles the algorithm data and bundles
the trainer.

> **Port status: M3 phase 1 — the Algorithms page is live** with the TCP
> last-layer set (18 cases, every alg machine-verified). Underneath:
> `js/engine.js` is the FTO engine — geometry-derived, pinned against BOTH
> xyzzy's ftosolver.js tables and cubing.js's runtime KPuzzle def, speaking
> the full community notation ({X,Y} bracket rotations, CIF/EIF hold
> dialects, doubles, wides; 55 tests) — and `js/render.js` draws the
> community-standard two-diamond views (7 tests, verified side-by-side
> against cubing.js). The trainer/solver pages are still parked until
> M4/M5; their banners say so. The plan with live status is
> [docs/port-plan.md](docs/port-plan.md); FTO domain facts (piece model, state
> space, notation, methods, sources) are
> [docs/fto-ground-truth.md](docs/fto-ground-truth.md). The Skewb parent's OO
> census does not exist here: the FTO's ~3.1 × 10²² positions rule the concept
> out, and the census code was deleted at M0 (git history retains it).

| Page | File | What it is |
| --- | --- | --- |
| Home | `index.html` | landing page |
| Solver | `solver.html` + `js/solver.js`, `js/solver-core.js` | step-by-step method solver (FTO version at M5) |
| Trainer | `trainer.html` + `js/trainer.js` | case trainer (drills, timer, recap), bundled from `src/trainer/` (FTO version at M4) |
| Algorithms | `algs.html` + `js/algs.js` | LIVE: browse/search the FTO sheet (TCP last layer), diagrams + machine-verified algs; editing = JSON + rebuild |

## Shared layers (`js/`)

- **`engine.js`** (`window.OOEngine`) — the FTO engine (M1): state model,
  the 16 face moves and 24 whole-puzzle rotations derived from 3D geometry,
  Streeter-notation alg parsing, the facelet model (identical scheme to
  xyzzy's ftosolver.js and pinned against it in tests), and the single source
  of the keying + alg→case helpers (`stateKey`, `realCanonKey`,
  `caseStateOf`, `algSolvesKey`, `normAlg`, …). No global optimal solver —
  per-step search arrives at M5.
- **`render.js`** (`window.OORender`) — SVG puzzle diagrams (M2): the two
  vertex-centered diamond views (front U/L/R/F, back B/BR/BL/D) + a rotatable
  3D view, exact facelet-triangle projection, configurable palette
  (DianSheng default), mask support.
- **`account.js`** (`window.OOAccount`) — Firebase Auth + per-user cloud data,
  with a localStorage demo fallback when no Firebase is configured (the
  current state: `config.js` has `firebase: null`; see [SETUP.md](SETUP.md)).
- **`navbar.js`** (`window.SiteNavbar`) — the shared top navigation.
- **`tables.js`** (`window.OOTables`) — IndexedDB-cached BFS distance tables.
  Skewb-only machinery: replaced by the pattern-database layer at M5.
- **`config.js`** (`window.OO_CONFIG`) — site config (currently demo mode).

## Data flow & source of truth

```
data/fto_algs.json             ← authored authority (empty M1 seed; populated by the M3 sheet import)
        │  npm run build:sheet  (tools/compile-sheet.mjs)
        ▼
js/sheet.js + data/classmap.json   (generated build-gate artifacts; no page consumes them at runtime)

algs.html fetches the algs JSON at runtime (live since M3 phase 1);
trainer.html and solver.html follow at M4/M5 (their inherited code still
references the deleted Skewb file until then).
```

- **`js/sheet.js`, `data/classmap.json` and `js/trainer.js` are generated — do
  not hand-edit them.** They are committed so the site works on the host
  without a build.
- Internal names (`OOEngine`, `OO_CONFIG`, `oo-*` cache keys) are deliberately
  NOT renamed, to keep `upstream` cherry-picks clean.

## Build & deploy

```
npm install
npm run build       # build:sheet + bundle trainer + stamp asset hashes + check
npm run check       # verify the compiled sheet against the engine (also: npm test)
npm run check:fresh # assert the committed generated files + HTML stamps are fresh
npm run test:engine # engine unit tests
npm run watch:trainer   # esbuild watch (note: does NOT recompile the sheet)
```

Deploy is just the static files (no server). Cache-busting is automatic: every
local `js/`/`css/`/`img` asset is loaded with a content-hash `?v=` query that
`npm run stamp` (part of `npm run build`) rewrites from the file's bytes — there
is no manual version to bump. To preview locally, serve over HTTP (e.g.
`npx serve`), not `file://`.

## Tooling

- **`tools/compile-sheet.mjs`** — compiles the algs JSON into `js/sheet.js` +
  `data/classmap.json`; self-checks every emitted alg and refuses to write on
  failure.
- **`tools/check-sheet.mjs`** — verifier of the shipped `js/sheet.js`
  (`npm run check`, wired into `npm run build`).
- **`tools/import-method-sheets.mjs`** — re-runnable importer of authored
  method sheets from `data/sources/` (gains FTO adapters at M3).
- **`tools/stamp-assets.mjs`** / **`tools/check-fresh.mjs`** — cache stamping
  and freshness gate.
- **`tools/test-engine.mjs`** — the FTO engine suite (37 tests), pinned
  against **`tools/fixtures/xyzzy-fto.mjs`** (oracle tables from xyzzy's
  ftosolver.js, MIT, reproduced with attribution as test fixtures).
  **`tools/test-trainer.mjs`**, **`tools/test-solver.mjs`**,
  **`tools/solver-lab.mjs`** — Skewb suites, known-red until M4/M5.
- **`build.mjs`** — esbuild config for the React trainer.

### Module strategy (why no `"type": "module"`)

The browser scripts in `js/` are classic scripts that attach to `window`
(`OOEngine`, `OOSheet`, …) and are **also** `require()`-d as CommonJS by the
build tools. The tools themselves are ESM and use the `.mjs` extension. Adding
`"type": "module"` would make Node treat the `js/*.js` files as ESM and break
those `require()` calls, so it is intentionally omitted.
