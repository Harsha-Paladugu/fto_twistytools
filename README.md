# fto.twistytools.com

A static site for solving and learning the **Face-Turning Octahedron (FTO)**,
the third site in the TwistyTools family after
[pyraminx.net](https://pyraminx.net) and [skewbiks.com](https://skewbiks.com).
Forked with full history from the Skewb site (kept as the `upstream` remote so
shared-layer fixes stay cherry-pickable). Four pages share one engine and one
set of UI layers; the only build step compiles the algorithm data and bundles
the trainer.

> **Port status: M0 (identity) only.** The site identity is FTO, but the
> engine/renderer/data underneath are still the Skewb originals — they are
> replaced milestone by milestone (M1 engine → M2 renderer → M3 sheet/algs →
> M4 trainer → M5 solver). Until then the tool pages function as a
> clearly-labelled Skewb clone. The plan with live status is
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
| Algorithms | `algs.html` + `js/algs.js` | browse/search every subset & case; admin add/remove with auto-validation (FTO version at M3) |

## Shared layers (`js/`)

- **`engine.js`** (`window.OOEngine`) — currently the Skewb engine: state
  model, moves, alg parsing, symmetry/canonicalization, optimal solving, and
  the single source of the keying + alg→case helpers (`stateKey`,
  `realCanonKey`, `caseStateOf`, `algSolvesKey`, `normAlg`, …). The FTO engine
  lands at M1 behind the same `window.OOEngine` surface (minus the
  full-state-space members — see the plan).
- **`render.js`** (`window.OORender`) — SVG puzzle diagrams.
- **`account.js`** (`window.OOAccount`) — Firebase Auth + per-user cloud data,
  with a localStorage demo fallback when no Firebase is configured (the
  current state: `config.js` has `firebase: null`; see [SETUP.md](SETUP.md)).
- **`navbar.js`** (`window.SiteNavbar`) — the shared top navigation.
- **`tables.js`** (`window.OOTables`) — IndexedDB-cached BFS distance tables.
  Skewb-only machinery: replaced by the pattern-database layer at M5.
- **`config.js`** (`window.OO_CONFIG`) — site config (currently demo mode).

## Data flow & source of truth

```
data/skewb_algs.json           ← authored authority (Skewb data until M3 replaces it with fto_algs.json)
        │  npm run build:sheet  (tools/compile-sheet.mjs)
        ▼
js/sheet.js + data/classmap.json   (generated build-gate artifacts; no page consumes them at runtime)

algs.html, trainer.html, solver.html fetch the algs JSON directly at runtime.
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
- **`tools/test-engine.mjs`**, **`tools/test-trainer.mjs`**,
  **`tools/test-solver.mjs`**, **`tools/solver-lab.mjs`** — test runners
  (Skewb oracles until their milestones rewrite them).
- **`build.mjs`** — esbuild config for the React trainer.

### Module strategy (why no `"type": "module"`)

The browser scripts in `js/` are classic scripts that attach to `window`
(`OOEngine`, `OOSheet`, …) and are **also** `require()`-d as CommonJS by the
build tools. The tools themselves are ESM and use the `.mjs` extension. Adding
`"type": "module"` would make Node treat the `js/*.js` files as ESM and break
those `require()` calls, so it is intentionally omitted.
