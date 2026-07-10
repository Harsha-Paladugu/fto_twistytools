/* fto.twistytools.com — oracle fixtures extracted from xyzzy's ftosolver.js.
 *
 * Source: cubing.js `src/cubing/vendor/mpl/xyzzy/fto-solver.js` (ftosolver.js
 * v0.5.1, 2021-04-20), by @torchlight / xyzzy — originally MIT licensed
 * (https://gist.github.com/torchlight/9a5c53da09d8e090756a228f4b5f3471).
 * These numeric tables are reproduced here as TEST FIXTURES ONLY: our engine
 * (js/engine.js) derives its own tables from 3D geometry, and test-engine.mjs
 * pins them against these known-good values. Extraction verified 2026-07-10.
 *
 * Facelet scheme (shared by our engine, by construction):
 *   72 facelets, index = 9*face + pos; faces [U, F, BR, BL, L, R, D, B].
 *   pos 0/4/8 = corner stickers toward the face's ±x/±y/±z vertex,
 *   pos 2/5/7 = centre stickers toward the same vertices,
 *   pos 1/3/6 = edge stickers on the x–y / x–z / y–z edges of the face.
 *
 * Permutation convention (xyzzy's): a move perm P is applied by PULL:
 *   newState[i] = oldState[P[i]]  (compose(A,B)[i] = A[B[i]]).
 */

export const FACE_ORDER = ['U', 'F', 'BR', 'BL', 'L', 'R', 'D', 'B'];

function permutation_from_cycles(cycles, n) {
  const perm = [];
  for (let i = 0; i < n; i++) perm[i] = i;
  for (const cycle of cycles)
    for (let i = 0; i < cycle.length; i++)
      perm[cycle[i]] = cycle[(i + 1) % cycle.length];
  return perm;
}
export function compose(A, B) {           // pull-convention composition
  const C = [];
  for (let i = 0; i < B.length; i++) C[i] = A[B[i]];
  return C;
}
const compose3 = (A, B, C) => compose(A, compose(B, C));

/* move_U verbatim (nine 3-cycles, 27 facelets) */
export const move_U = permutation_from_cycles([
  [0, 4, 8], [1, 6, 3], [2, 5, 7],
  [9, 22, 35],
  [45, 67, 44], [47, 68, 43], [46, 69, 39], [50, 70, 38], [49, 71, 36],
], 72);
const move_Ui = compose(move_U, move_U);

/* symmetries verbatim: X = T2, Y = 180° about the +y vertex, Z = U↔L mirror */
export const sym_X = Array(72).fill().map((_, i) => ((i / 18) | 0) * 18 + ((i + 9) % 18));
export const sym_Y = Array(72).fill().map((_, i) => ((i / 36) | 0) * 36 + ((i + 18) % 36));
export const sym_Z = Array(72).fill().map((_, i) => (i + 36) % 72);

/* derived face moves, exactly as ftosolver.js builds them
   ("Z changes sign, so this is really setting up to U' rather than U") */
const move_L = compose3(sym_Z, move_Ui, sym_Z);
const move_F = compose3(sym_X, move_U, sym_X);
const move_R = compose3(sym_X, move_L, sym_X);
const move_BR = compose3(sym_Y, move_U, sym_Y);
const move_BL = compose3(sym_Y, move_F, sym_Y);
const move_B = compose3(sym_Y, move_R, sym_Y);
const move_D = compose3(sym_Y, move_L, sym_Y);

/* face moves keyed by face name, clockwise; prime = perm applied twice */
export const MOVE = { U: move_U, F: move_F, BR: move_BR, BL: move_BL, L: move_L, R: move_R, D: move_D, B: move_B };
export const inv = (p) => compose(p, p);   // order-3 moves: inverse = square

/* the U-axis slice layer, verbatim (direction as ftosolver defines it) */
export const move_Us = permutation_from_cycles([
  [10, 24, 30], [11, 23, 34], [12, 19, 33],
  [42, 48, 64], [41, 52, 65], [37, 51, 66],
], 72);
export const move_Uw = compose(move_U, move_Us);

/* piece facelet tables verbatim (corner rows: alternating A,B,A,B tetrad
   stickers in cyclic order around the vertex; orientation 0/1 = which of the
   two tetrad-A stickers is at row position 0 vs 2) */
export const corner_piece_facelets = [
  [0, 45, 9, 36],   // U-F   (vertex +x)
  [4, 67, 22, 49],  // U-BR  (vertex +y)
  [8, 44, 35, 71],  // U-BL  (vertex +z)
  [13, 58, 31, 40], // F-BL  (vertex -y)
  [17, 53, 26, 62], // F-BR  (vertex -z)
  [18, 63, 27, 54], // BR-BL (vertex -x)
];
export const edge_piece_facelets = [
  [1, 46],  // U-R
  [3, 39],  // U-L
  [6, 69],  // U-B
  [10, 37], // F-L
  [33, 42], // BL-L
  [12, 48], // F-R
  [15, 60], // F-D
  [24, 51], // BR-R
  [19, 64], // BR-B
  [28, 55], // BL-D
  [30, 66], // BL-B
  [21, 57], // BR-D
];
