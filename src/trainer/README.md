# Trainer source

Editable source for the Skewbiks.com trainer — **the source of truth for the
deployed trainer**. It builds to `js/trainer.js`, which `trainer.html` serves in
production. Edit here, rebuild, commit the regenerated `js/trainer.js`.

## Files
- `skewb-trainer.jsx` — the trainer React component (UI + persistence): four
  modes — Algorithm drill/recap, Full solve (timer + optimal-line/first-layer
  analysis), Recognition (Full view: reveal + self-grade with per-case accuracy;
  Center-cases view: first layer + a chosen 3-center combo shown, optional 2
  random corners, multiple-choice over the sheet's center-case names +
  Don't know, auto-graded per-center-case accuracy), One-look (self-graded
  case prediction in inspection: Random — scrambles whose nearest layer is
  exactly N moves away, reveal lists the optimal layer lines; My solution —
  enter a fixed layer solution and get scrambles it solves the bottom layer
  on, reveal shows the exact post-layer state — rendered layer-down via
  netSVG's `pinned` option — + best-effort case name).
- `skewb-core.mjs` — the substrate, no React/DOM: case model over
  `data/skewb_algs.json` (fetched at runtime — NOT bundled), presentation
  geometry (`prependAUF` direction synthesis), masked scrambles, the
  first-layer predicate + goal-distance BFS, analysis, one-look sampling
  (FL-distance fibers, D-layer states, fixed-solution preimages). Unit-tested
  from Node (`npm run test:trainer`), which is why it is a plain `.mjs` module.
- `index.jsx` — entry point: mounts `<SkewbTrainer/>` at `#root`, provides a
  localStorage fallback for `window.storage`.

## Workflow
```
npm install            # once
npm run build:trainer  # -> js/trainer.js
npm run watch:trainer  # rebuild on change
npm run test:trainer   # substrate tests (builds two full-space BFS tables — slow-ish)
```
Then serve the site over HTTP (e.g. `npx serve`) and open
http://localhost:3000/trainer.html — the trainer `fetch`es `data/skewb_algs.json`,
so `file://` won't work. Signed out, progress is in localStorage; to test
without touching real progress, use a private window. Commit the regenerated
`js/trainer.js` with your source change.

## Integration contract (must stay true for a drop-in build)
- Mounts at `#root` (React 18 `createRoot`).
- Reads/writes its whole state via `window.storage` (async `get`/`set`) under
  the single key `skewb-trainer-v1`; unknown/legacy blobs are ignored, never
  migrated. The host page bridges `window.storage` to the shared account
  (`window.OOAccount`, cloud doc field `'trainer'`), falling back to
  localStorage when signed out.
- The host page must load `js/engine.js` → `js/render.js` → `js/tables.js`
  before the bundle: diagrams render through `window.OORender` and the
  scramble distance table comes from `window.OOTables.loadOrBuildDist`
  (IndexedDB `skewbiks-oo`/`oo-dist-v1`, shared with the census — first-ever
  build ~18 s, instant thereafter). The first-layer table (Full solve analysis
  + One-look) is built lazily on first use and cached under `trainer-fldist-v1`.
- Styling comes from `css/site.css` + `css/trainer.css` (the same files the
  live page loads); the component carries no inline `<style>`. New
  trainer-only classes live in `css/trainer.css`.

## Status
`trainer.html` serves the build of this source (`js/trainer.js`, loaded with a
content-hash `?v=` that `npm run stamp` maintains). The Pyraminx-era
`l5e-trainer.jsx` was deleted in M6 (git history retains it).
