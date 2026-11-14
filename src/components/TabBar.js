import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../i18n/Text';
import { palette, themedStyles } from '../theme';
import Icon from './Icon';

export const TABS = Object.freeze([
  { id: 'voice', icon: 'mic', label: 'Voix' },
  { id: 'text', icon: 'text', label: 'Texte' },
  { id: 'tools', icon: 'sparkles', label: 'Outils' },
  { id: 'meetings', icon: 'notes', label: 'Réunions' },
  { id: 'settings', icon: 'sliders', label: 'Réglages' },
]);

const THEME_ICON = { system: 'auto', light: 'sun', dark: 'moon' };

/** Bottom navigation (icon above a small label, the active tab in the accent colour) + a button that cycles the theme. */
export default function TabBar({ tab, onTab, theme, onTheme }) {
  const c = palette();
  return (
    <View style={styles.bar}>
      {TABS.map((item) => {
        const on = tab === item.id;
        return (
          <Pressable key={item.id} style={styles.item} onPress={() => onTab(item.id)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
            <View style={[styles.pill, on && styles.pillOn]}>
              <Icon name={item.icon} size={22} color={on ? c.accent : c.textMuted} stroke={on ? 2 : 1.7} />
            </View>
            <Text style={[styles.label, on && styles.labelOn]}>{item.label}</Text>
          </Pressable>
        );
      })}
      <Pressable style={styles.item} onPress={onTheme} accessibilityRole="button" accessibilityLabel="Thème clair ou sombre">
        <View style={styles.pill}>
          <Icon name={THEME_ICON[theme] ?? 'auto'} size={22} color={c.textMuted} stroke={1.7} />
        </View>
        <Text style={styles.label}>{theme === 'light' ? 'Clair' : theme === 'dark' ? 'Sombre' : 'Auto'}</Text>
      </Pressable>
    </View>
  );
}

const styles = themedStyles((c) => StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: c.glass, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, paddingTop: 8, paddingBottom: 16, paddingHorizontal: 6 },
  item: { flex: 1, alignItems: 'center', gap: 3 },
  pill: { width: 52, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: c.accentSoft },
  label: { fontSize: 10.5, color: c.textMuted, fontWeight: '500', letterSpacing: 0.1 },
  labelOn: { color: c.accent, fontWeight: '600' },
}));
