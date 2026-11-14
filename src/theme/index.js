// Colour themes (pure → unit-tested with `node --test`). Two palettes with the SAME tokens; the screens ask for a token
// (`c.surface`, `c.text`…) instead of writing a hex colour, so a theme change recolours everything.
//
// `themedStyles(make)` returns an object that behaves like a StyleSheet but follows the active theme: every property read
// resolves to the styles built for the current theme (built once per theme). The app re-mounts its screens when the theme
// changes (see App.js), so nothing has to subscribe.

export const PALETTES = Object.freeze({
  // « Midnight »: near-black with a cool undertone, one electric indigo accent, hairline borders.
  dark: Object.freeze({
    scheme: 'dark',
    bg: '#0A0B10', // screen background
    surface: '#14161F', // cards, chips, inputs
    inset: '#0E1017', // field or chip sitting inside a card
    panel: '#11131B', // live transcript panel
    border: '#262A38',
    text: '#F7F8FC',
    textBody: '#E6E8F2', // long reading text
    textSoft: '#C5C9DA', // labels
    textMuted: '#8E94AB', // hints
    textFaint: '#7A8096', // small meta
    placeholder: '#565C73',
    accent: '#4C5DF5',
    accentAlt: '#8B5CF6', // second stop of the accent gradient
    accentSoft: '#1B2040', // tinted background (icon chips, selected rows)
    onAccent: '#FFFFFF',
    chipOn: '#4C5DF5', // a selected chip
    link: '#8E9BFF',
    danger: '#FF8A80',
    dangerBg: '#3A1B1B',
    dangerStrong: '#C0392B',
    success: '#7CE0A3',
    successBg: '#1F4E3A',
    successStrong: '#1F8F4E',
    warn: '#FFC46B',
    warnStrong: '#FFB020',
    track: '#FFFFFF22',
    rec: '#FF3B30',
    overlay: '#0A0B10D9', // controls floating over the two zones
    overlayStrong: '#0A0B10F2',
    glass: '#14161FE6', // bars and floating panels
    glassBorder: '#FFFFFF1F',
    shadow: '#000000',
    splitBg: '#05060A',
    zoneA: '#14182A',
    zoneAActive: '#4C5DF5',
    zoneB: '#1E1530',
    zoneBActive: '#9B4DF0',
    zoneText: '#FFFFFF',
    zoneTextSoft: '#E6E8F2',
    zoneStatus: '#9AA0B8',
  }),
  // « Daylight »: Apple-like grouped background (#F5F5F7), white cards, the same indigo accent.
  light: Object.freeze({
    scheme: 'light',
    bg: '#F5F5F7',
    surface: '#FFFFFF',
    inset: '#F0F1F5',
    panel: '#EEF0F6',
    border: '#E3E5EC',
    text: '#14151A',
    textBody: '#23252E',
    textSoft: '#3C3F4C',
    textMuted: '#5F6475',
    textFaint: '#6B7083',
    placeholder: '#A0A5B5',
    accent: '#4C5DF5',
    accentAlt: '#8B5CF6',
    accentSoft: '#E8EBFF',
    onAccent: '#FFFFFF',
    chipOn: '#DDE2FF',
    link: '#3547E0',
    danger: '#B42318',
    dangerBg: '#FDE3E0',
    dangerStrong: '#C0392B',
    success: '#18794E',
    successBg: '#D5F0E0',
    successStrong: '#1F8F4E',
    warn: '#9A5B00',
    warnStrong: '#E09600',
    track: '#14151A1F',
    rec: '#E5301F',
    overlay: '#FFFFFFE0',
    overlayStrong: '#FFFFFFF2',
    glass: '#FFFFFFE6',
    glassBorder: '#0000001A',
    shadow: '#1B2145',
    splitBg: '#DCDFEA',
    zoneA: '#E4E8FF',
    zoneAActive: '#4C5DF5',
    zoneB: '#F0E6FF',
    zoneBActive: '#9B4DF0',
    zoneText: '#14151A',
    zoneTextSoft: '#23252E',
    zoneStatus: '#5F6475',
  }),
});

/** Shape and rhythm shared by every screen (the same numbers everywhere is what makes an interface feel designed). */
export const RADIUS = Object.freeze({ sm: 10, md: 14, lg: 20, xl: 28, pill: 999 });
export const SPACE = Object.freeze({ xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 });

/** Soft card shadow (Android `elevation` + iOS shadow), tinted by the theme. */
export const cardShadow = (c) => ({ shadowColor: c.shadow, shadowOpacity: c.scheme === 'dark' ? 0.5 : 0.1, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: c.scheme === 'dark' ? 0 : 3 });

export const THEME_CHOICES = Object.freeze({
  system: { label: 'Auto', hint: 'suit le téléphone' },
  light: { label: 'Clair', hint: '' },
  dark: { label: 'Sombre', hint: '' },
});

/** The theme to show: the user's choice, or — for « system » — the phone's (anything but "light" counts as dark). */
export function resolveTheme(choice, systemScheme) {
  if (choice === 'light' || choice === 'dark') return choice;
  return systemScheme === 'light' ? 'light' : 'dark';
}

let active = 'dark';

export function setTheme(name) {
  active = PALETTES[name] ? name : 'dark';
}

export const themeName = () => active;
export const palette = () => PALETTES[active];

/** Like StyleSheet.create(make(colors)), for the active theme; the result of `make` is cached per theme. */
export function themedStyles(make) {
  const cache = {};
  const current = () => (cache[active] ??= make(PALETTES[active]));
  return new Proxy({}, { get: (_, key) => current()[key] });
}
