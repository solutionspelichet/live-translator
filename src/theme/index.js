// Colour themes (pure → unit-tested with `node --test`). Two palettes with the SAME tokens; the screens ask for a token
// (`c.surface`, `c.text`…) instead of writing a hex colour, so a theme change recolours everything.
//
// `themedStyles(make)` returns an object that behaves like a StyleSheet but follows the active theme: every property read
// resolves to the styles built for the current theme (built once per theme). The app re-mounts its screens when the theme
// changes (see App.js), so nothing has to subscribe.

export const PALETTES = Object.freeze({
  dark: Object.freeze({
    scheme: 'dark',
    bg: '#0B0F1A', // screen background
    surface: '#16233B', // cards, chips, inputs
    inset: '#0B0F1A', // field or chip sitting inside a card
    panel: '#101A2E', // live transcript panel
    border: '#22304A',
    text: '#FFFFFF',
    textBody: '#E8ECF8', // long reading text
    textSoft: '#C9D2EA', // labels
    textMuted: '#9AA6C4', // hints
    textFaint: '#7C89AA', // small meta
    placeholder: '#55607F',
    accent: '#2F6FED',
    onAccent: '#FFFFFF',
    chipOn: '#2F6FED', // a selected chip
    link: '#6FA0FF',
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
    overlay: '#000C', // controls floating over the two zones
    overlayStrong: '#000D',
    splitBg: '#000000',
    zoneA: '#16233B',
    zoneAActive: '#2F6FED',
    zoneB: '#2A1B3D',
    zoneBActive: '#C24CF6',
    zoneText: '#FFFFFF',
    zoneTextSoft: '#E8ECF8',
    zoneStatus: '#9AA6C4',
  }),
  light: Object.freeze({
    scheme: 'light',
    bg: '#F3F5FA',
    surface: '#FFFFFF',
    inset: '#EDF1F9',
    panel: '#E9EEF8',
    border: '#D5DCEA',
    text: '#101828',
    textBody: '#1D2939',
    textSoft: '#344054',
    textMuted: '#5B6577',
    textFaint: '#6F7A8F',
    placeholder: '#98A2B3',
    accent: '#2F6FED',
    onAccent: '#FFFFFF',
    chipOn: '#D6E4FF',
    link: '#1F5FD6',
    danger: '#B42318',
    dangerBg: '#FDE3E0',
    dangerStrong: '#C0392B',
    success: '#18794E',
    successBg: '#D5F0E0',
    successStrong: '#1F8F4E',
    warn: '#9A5B00',
    warnStrong: '#E09600',
    track: '#10182822',
    rec: '#E5301F',
    overlay: '#000C',
    overlayStrong: '#000D',
    splitBg: '#C9D3E8',
    zoneA: '#DCE7FF',
    zoneAActive: '#2F6FED',
    zoneB: '#F0E1FB',
    zoneBActive: '#C24CF6',
    zoneText: '#101828',
    zoneTextSoft: '#1D2939',
    zoneStatus: '#5B6577',
  }),
});

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
