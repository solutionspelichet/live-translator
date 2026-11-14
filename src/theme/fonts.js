// Typeface (pure → unit-tested). The app uses Inter, the face of most AI start-ups and the closest open one to Apple's San Francisco.
// On Android a custom font is one file per weight, so the weight asked by a style (`fontWeight: '700'`) is turned into the right family.

export const FONT_FILES = Object.freeze({
  Inter_400Regular: '400',
  Inter_500Medium: '500',
  Inter_600SemiBold: '600',
  Inter_700Bold: '700',
});

const BY_WEIGHT = Object.freeze({ 100: 'Inter_400Regular', 200: 'Inter_400Regular', 300: 'Inter_400Regular', 400: 'Inter_400Regular', 500: 'Inter_500Medium', 600: 'Inter_600SemiBold', 700: 'Inter_700Bold', 800: 'Inter_700Bold', 900: 'Inter_700Bold' });

let ready = false;
export const setFontsReady = (value) => {
  ready = Boolean(value);
};
export const fontsReady = () => ready;

/** The family for a `fontWeight` ('400'…'900', 'normal', 'bold', a number), or null while the fonts are not loaded. */
export function familyFor(weight) {
  if (!ready) return null;
  const w = weight === 'bold' ? 700 : weight === 'normal' || weight == null ? 400 : Number(weight);
  return BY_WEIGHT[Math.min(900, Math.max(100, Math.round(w / 100) * 100))] ?? BY_WEIGHT[400];
}
