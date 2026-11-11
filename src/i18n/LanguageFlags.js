import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '../theme';
import { UI_LANGUAGES } from './index.js';

/** Three flags: a tap chooses the language of the interface (🇫🇷 Français · 🇬🇧 English · 🇨🇳 中文). */
export default function LanguageFlags({ value, onChange, style }) {
  const c = palette();
  return (
    <View style={[styles.row, style]}>
      {UI_LANGUAGES.map((l) => {
        const on = l.code === value;
        return (
          <Pressable
            key={l.code}
            onPress={() => onChange(l.code)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={l.label}
            accessibilityState={{ selected: on }}
            style={[styles.flag, { backgroundColor: c.overlay, borderColor: on ? c.accent : 'transparent', opacity: on ? 1 : 0.7 }]}
          >
            <Text style={styles.emoji}>{l.flag}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, width: '100%' },
  flag: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  emoji: { fontSize: 24 },
});
