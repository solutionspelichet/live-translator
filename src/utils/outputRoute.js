// Where a translated voice is played (pure → unit-tested).
//  'stereo' (default): everything on the same output, language A in the left ear and B in the right one (a shared headset).
//  'split'           : "me" (language A) in the HEADSET, the other person (language B) on the phone's SPEAKER.

export const OUTPUT_MODES = Object.freeze({
  stereo: { label: 'Casque : A à gauche, B à droite', hint: 'une oreillette chacun, ou les deux langues dans votre casque' },
  split: { label: 'Moi dans le casque · l\'interlocuteur sur le haut-parleur', hint: 'vous entendez sa traduction dans le casque, il entend la vôtre sur le haut-parleur du téléphone' },
});

/**
 * @param {number} pan  -1 = language A (me), +1 = language B (the other person) — what the engines already pass
 * @param {string} mode  'stereo' | 'split'
 * @param {boolean} speakerAvailable  the native speaker stream exists (Android build)
 * @returns {{route: 'headset' | 'speaker', pan: number}}
 */
export function routeFor(pan, mode, speakerAvailable = true) {
  if (mode !== 'split' || !speakerAvailable) return { route: 'headset', pan };
  return pan > 0 ? { route: 'speaker', pan: 0 } : { route: 'headset', pan: 0 };
}
