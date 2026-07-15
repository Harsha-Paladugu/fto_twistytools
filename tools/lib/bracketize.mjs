/* Respell whole-puzzle rotation tokens into the site's {X,Y} re-orientation
 * bracket system (user decision 2026-07-14): every displayed rotation names
 * the two faces that move to the U and F positions — the community notation
 * doc's bracket form, already native to the engine parser and to the TCP and
 * 1L3T sheet texts. o/T spellings remain parse-level input aliases.
 *
 * The map covers the o/T rotation spellings that appear in imported sheets.
 * From any CIF hold the equivalences are the notation doc's own bracket table
 * (Uo = {U,BR}, Uo' = {U,BL}, T = {L,R}, ...), and bracketize() re-proves
 * every conversion anyway: the converted text must fire the exact same native
 * move sequence AND land the exact same final hold as the original, else it
 * throws. A rotation-shaped token outside the map also throws — extend the
 * map deliberately, never let one slip through unconverted.
 */
export const ROT_BRACKETS = {
  Uo: '{U,BR}', "Uo'": '{U,BL}',
  '[Uo]': '{U,BR}', "[Uo']": '{U,BL}',
  T: '{L,R}', "T'": '{R,L}', T2: '{F,U}',
};
const ROT_SHAPED = /^(?:\[?(?:BR|BL|[UFRLDB])o'?\]?|T2?'?)$/;

export function bracketize(E, text, dialect) {
  const out = String(text).trim().split(/\s+/).map((t) => {
    if (ROT_BRACKETS[t]) return ROT_BRACKETS[t];
    if (ROT_SHAPED.test(t)) throw new Error('bracketize: unmapped rotation token "' + t + '" in: ' + text);
    return t;
  }).join(' ');
  const trace = (s) => {
    const fired = [];
    const hold = E.walkParsed(E.parseAlg(s), (m) => fired.push(m), dialect);
    return fired.join(',') + '|' + hold.join(',');
  };
  if (trace(text) !== trace(out)) throw new Error('bracketize: conversion not move-for-move identical: ' + text + ' -> ' + out);
  return out;
}
