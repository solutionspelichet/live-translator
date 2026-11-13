import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../i18n/Text';
import { themedStyles } from '../theme';

export const TABS = Object.freeze([
  { id: 'voice', icon: '🎙', label: 'Voix' },
  { id: 'text', icon: '✏️', label: 'Texte' },
  { id: 'tools', icon: '✨', label: 'Outils' },
  { id: 'meetings', icon: '📝', label: 'Réunions' },
  { id: 'settings', icon: '⚙︎', label: 'Réglages' },
]);

const THEME_ICON = { system: '🌓', light: '☀️', dark: '🌙' };

/** Bottom navigation + a button that cycles the theme (Auto → Clair → Sombre). */
export default function TabBar({ tab, onTab, theme, onTheme }) {
  return (
    <View style={styles.bar}>
      {TABS.map((item) => (
        <Pressable key={item.id} style={styles.item} onPress={() => onTab(item.id)} accessibilityRole="tab" accessibilityState={{ selected: tab === item.id }}>
          <Text style={[styles.icon, tab !== item.id && styles.dim]}>{item.icon}</Text>
          <Text style={[styles.label, tab === item.id && styles.labelOn]}>{item.label}</Text>
        </Pressable>
      ))}
      <Pressable style={styles.item} onPress={onTheme} accessibilityRole="button" accessibilityLabel="Thème clair ou sombre">
        <Text style={styles.icon}>{THEME_ICON[theme] ?? THEME_ICON.system}</Text>
        <Text style={styles.label}>{theme === 'light' ? 'Clair' : theme === 'dark' ? 'Sombre' : 'Auto'}</Text>
      </Pressable>
    </View>
  );
}

const styles = themedStyles((c) => StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 6, paddingBottom: 14 },
  item: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 2 },
  icon: { fontSize: 20, color: c.text },
  dim: { opacity: 0.55 },
  label: { fontSize: 11, color: c.textMuted },
  labelOn: { color: c.accent, fontWeight: '700' },
}));
