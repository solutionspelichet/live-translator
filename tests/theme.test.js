import assert from 'node:assert/strict';
import test from 'node:test';

import { PALETTES, palette, resolveTheme, setTheme, themeName, themedStyles } from '../src/theme/index.js';

test('both palettes define exactly the same tokens, as valid colours', () => {
  assert.deepEqual(Object.keys(PALETTES.light).sort(), Object.keys(PALETTES.dark).sort());
  for (const [name, p] of Object.entries(PALETTES)) {
    for (const [token, value] of Object.entries(p)) {
      if (token === 'scheme') continue;
      assert.match(value, /^#[0-9A-Fa-f]{3,8}$/, `${name}.${token} = ${value}`);
    }
  }
});

// WCAG relative luminance / contrast ratio: the text must stay readable on its background in both themes.
const lum = (hex) => {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('text is readable on its backgrounds in both themes (contrast ≥ 4.5, hints ≥ 3.5)', () => {
  for (const [name, p] of Object.entries(PALETTES)) {
    for (const bg of ['bg', 'surface', 'inset', 'panel']) {
      for (const fg of ['text', 'textBody', 'textSoft', 'link', 'danger', 'success', 'warn']) {
        assert.ok(contrast(p[fg], p[bg]) >= 4.5, `${name}: ${fg} on ${bg} = ${contrast(p[fg], p[bg]).toFixed(2)}`);
      }
      for (const fg of ['textMuted', 'textFaint']) {
        assert.ok(contrast(p[fg], p[bg]) >= 3.5, `${name}: ${fg} on ${bg} = ${contrast(p[fg], p[bg]).toFixed(2)}`);
      }
    }
    assert.ok(contrast(p.onAccent, p.accent) >= 4, `${name}: text on the accent button`);
    assert.ok(contrast(p.text, p.chipOn) >= 4.5, `${name}: text on a selected chip`);
    assert.ok(contrast(p.danger, p.dangerBg) >= 4.5, `${name}: text on the danger background`);
    assert.ok(contrast(p.text, p.successBg) >= 4.5, `${name}: text on the success background`);
    assert.ok(contrast(p.zoneText, p.zoneA) >= 4.5 && contrast(p.zoneText, p.zoneB) >= 4.5, `${name}: text on idle zones`);
    assert.ok(contrast('#FFFFFF', p.zoneAActive) >= 4 && contrast('#FFFFFF', p.zoneBActive) >= 3, `${name}: white on live zones`);
  }
});

test('resolveTheme: an explicit choice wins, « system » follows the phone, unknown falls back to dark', () => {
  assert.equal(resolveTheme('light', 'dark'), 'light');
  assert.equal(resolveTheme('dark', 'light'), 'dark');
  assert.equal(resolveTheme('system', 'light'), 'light');
  assert.equal(resolveTheme('system', 'dark'), 'dark');
  assert.equal(resolveTheme('system', null), 'dark');
  assert.equal(resolveTheme(undefined, 'light'), 'light');
});

test('themedStyles follows the active theme and builds once per theme', () => {
  let built = 0;
  const styles = themedStyles((c) => {
    built++;
    return { box: { backgroundColor: c.bg } };
  });
  setTheme('dark');
  assert.equal(styles.box.backgroundColor, PALETTES.dark.bg);
  assert.equal(styles.box.backgroundColor, PALETTES.dark.bg);
  assert.equal(built, 1);
  setTheme('light');
  assert.equal(styles.box.backgroundColor, PALETTES.light.bg);
  assert.equal(themeName(), 'light');
  assert.equal(palette().scheme, 'light');
  setTheme('dark');
  assert.equal(styles.box.backgroundColor, PALETTES.dark.bg);
  assert.equal(built, 2, 'dark was cached');
  setTheme('nonsense');
  assert.equal(themeName(), 'dark');
});
