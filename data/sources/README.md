# Method-sheet sources

Verbatim JSON transcriptions of community Skewb method sheets — the source of
truth for the imported subsets of `data/skewb_algs.json`. Do not hand-edit the
generated subsets in `skewb_algs.json`; edit these files (or the sheets they
come from) and re-run the importer:

```
node tools/import-method-sheets.mjs   # regenerates the TCLL / EG2 / NS subsets
npm run build                         # recompile sheet + trainer, restamp
```

| file | method | source |
|---|---|---|
| `tcll.json` | TCLL | "Full TCLL - Max Parris" |
| `eg2.json` | EG2 | EG2.xlsx |
| `ns.json` | NS | Full NS + Alts Sheet (2026_ns_sheet.xlsx) |

## Notation (important)

Algorithms are written in **NS ("Rubik'skewb") notation** for the move letters
(engine `parseAlg(str, 'ns')` — top corners `F R B L`, bottom corners
`f r b l`), but the sheets' **whole-cube rotation letters differ from the
WCA/cubing.js convention** the engine uses:

    sheet x = engine z'      sheet y = engine y'      sheet z = engine x

This was machine-derived (2026-07-06) by exhaustive search over all 48 axis
relabelings against two independent truth sets (NS L4C/L5C cases must be
corners-solved; TCLL `nsCase` cross-references must match the NS sheet's
states up to whole-cube rotation) and confirmed by within-case consistency
over all ~3,200 algs (EG2 439/439 consistent, TCLL 1669/1680, NS 637/659 —
vs ~55–80 % under the identity reading). See the header of
`tools/import-method-sheets.mjs` for the full derivation notes.

Two further sheet conventions the importer handles:

- **Cases are orientation-free.** Alternate algs for one case solve it from
  arbitrary holds (any whole-cube rotation, not just the site's four
  y-presentations). Each alg ships keyed to the exact state it solves; algs
  outside their case's plurality rotation-class are flagged `"suspect": true`
  (near-certain sheet typos, ~1 % of algs).
- **Slash alternatives** (`r'/r2`) are equal-state notation variants
  (`X2 == X'` on order-3 twists); the importer verifies this and keeps the
  first. The original string is preserved verbatim per-alg in the `ns` field.
