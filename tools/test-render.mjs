/* fto.twistytools.com — renderer unit tests (M2).
 *
 * The renderer is pure projection over the engine's facelet model, so the
 * tests pin: polygon counts, solved-state color layout (front U/L/R/F, back
 * B/BR/BL/D — the csTimer/cubing.js two-diamond convention), exact projected
 * centroids for chirality-sensitive facelets (a mirrored drawing would flip
 * their x), palettes, masking, and input forms. The STATE semantics behind
 * the pictures are pinned in test-engine.mjs (xyzzy + cubing.js def oracles).
 *
 * Run: node tools/test-render.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = {};
const require = createRequire(import.meta.url);
require(path.join(ROOT, 'js', 'engine.js'));
require(path.join(ROOT, 'js', 'render.js'));
const E = globalThis.window.OOEngine;
const R = globalThis.window.OORender;

let pass = 0, fail = 0;
function t(name, fn){
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (err) { fail++; console.log('FAIL  ' + name + '\n      ' + (err && err.message)); }
}
function assert(cond, msg){ if (!cond) throw new Error(msg || 'assertion failed'); }

function polysOf(svg){
  return [...svg.matchAll(/<polygon points="([^"]+)" fill="([^"]+)"\/>/g)].map(m => {
    const pts = m[1].split(' ').map(s => s.split(',').map(Number));
    const cx = pts.reduce((a,p)=>a+p[0],0)/pts.length, cy = pts.reduce((a,p)=>a+p[1],0)/pts.length;
    return { cx, cy, fill: m[2] };
  });
}
// polygon emit order: front faces U,F,L,R then back BR,BL,D,B — each 9 facelets
const FRONT_FACES = [0,1,4,5], BACK_FACES = [2,3,6,7];
function faceletOfPoly(i){
  const face = i < 36 ? FRONT_FACES[(i/9)|0] : BACK_FACES[((i-36)/9)|0];
  return 9*face + (i%9);
}
const PAL = R.PALETTES.diansheng;

t('net: 72 polygons, one per facelet, deterministic, accepts state or array', () => {
  const a = R.netSVG(E.solved(), 300), b = R.netSVG(E.solvedFacelets(), 300);
  assert(a === b, 'state vs facelet-array input');
  assert(polysOf(a).length === 72, 'polygon count');
  assert(R.netSVG(E.solved(), 300) === a, 'deterministic');
});
t('net solved layout: front U top / L left / R right / F bottom, back B/BR/BL/D', () => {
  const polys = polysOf(R.netSVG(E.solved(), 300));
  for (let i = 0; i < 72; i++){
    const fl = faceletOfPoly(i), face = (fl/9)|0, p = polys[i];
    assert(p.fill === PAL[face], 'poly ' + i + ' color');
    const front = i < 36, x = front ? p.cx : p.cx - 1.75;
    const quad = Math.abs(p.cy) >= Math.abs(x) ? (p.cy < 0 ? 'top' : 'bottom') : (x < 0 ? 'left' : 'right');
    const want = front
      ? { 0:'top', 1:'bottom', 4:'left', 5:'right' }[face]
      : { 7:'top', 6:'bottom', 2:'left', 3:'right' }[face];
    assert(quad === want, `facelet ${fl} in ${quad}, want ${want}`);
  }
});
t('net chirality: exact projected centroids for +y corner stickers', () => {
  const polys = polysOf(R.netSVG(E.solved(), 300));
  const find = fl => polys[fl < 54 && FRONT_FACES.includes((fl/9)|0)
    ? FRONT_FACES.indexOf((fl/9)|0)*9 + fl%9
    : 36 + BACK_FACES.indexOf((fl/9)|0)*9 + fl%9];
  const S2 = Math.SQRT2;
  const near = (a,b) => Math.abs(a-b) < 0.02;
  const p49 = find(49);   // R face, corner toward +y: (1/9, 7/9, -1/9)
  assert(near(p49.cx, 8/(9*S2)) && near(p49.cy, -6/(9*S2)), 'facelet 49 at ' + p49.cx + ',' + p49.cy);
  const p4 = find(4);     // U face, corner toward +y: (1/9, 7/9, 1/9)
  assert(near(p4.cx, 6/(9*S2)) && near(p4.cy, -8/(9*S2)), 'facelet 4 at ' + p4.cx + ',' + p4.cy);
  const p67 = find(67);   // B face, corner toward +y: (-1/9, 7/9, 1/9) — back view
  assert(near(p67.cx - 1.75, -6/(9*S2)) && near(p67.cy, -8/(9*S2)), 'facelet 67 at ' + p67.cx + ',' + p67.cy);
});
t('palettes: lanlan swaps the F/R placements; custom map override wins', () => {
  const dd = polysOf(R.netSVG(E.solved(), 300));
  const ll = polysOf(R.netSVG(E.solved(), 300, { colors: 'lanlan' }));
  assert(dd[9].fill === PAL[1] && ll[9].fill === R.PALETTES.lanlan[1], 'F facelet colors');
  assert(R.PALETTES.lanlan[1] === PAL[5] && R.PALETTES.lanlan[5] === PAL[1], 'lanlan = F/R swap');
  const custom = R.netSVG(E.solved(), 300, { colors: { U: '#123456' } });
  assert(custom.includes('#123456'), 'custom override');
});
t('mask: listed facelets render the neutral fill', () => {
  const svg = R.netSVG(E.solved(), 300, { mask: [0, 40, 70] });
  const polys = polysOf(svg);
  const masked = polys.filter(p => p.fill === '#252c39').length;
  assert(masked === 3, 'masked count: ' + masked);
});
t('3D view: 36 polygons (4 visible faces), rotatable matrix input', () => {
  const iso = R.iso3dSVG(E.solved(), 300, R.DEFAULT_VIEW.yaw, R.DEFAULT_VIEW.pitch);
  assert(polysOf(iso).length === 36, 'iso polygon count');
  const M = R.rotateView(R.viewMatrix(0.2, 0.1), 0.3, -0.2);
  assert(polysOf(R.iso3dSVG(E.solved(), 300, M)).length === 36, 'matrix input');
});
t('scrambled state renders every face color exactly 9 times (color conservation)', () => {
  const st = E.applyParsed(E.parseAlg(E.randomScramble(30, (() => { let s=42; return () => ((s = (Math.imul(s,1664525)+1013904223)>>>0)/4294967296); })())), E.solved());
  const per = {};
  for (const p of polysOf(R.netSVG(st, 300))) per[p.fill] = (per[p.fill]||0)+1;
  for (const c of PAL) assert(per[c] === 9, 'color ' + c + ': ' + per[c]);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
