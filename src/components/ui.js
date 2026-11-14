import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Text } from '../i18n/Text';
import { cardShadow, palette, RADIUS, themedStyles } from '../theme';
import Icon from './Icon';

/** Large screen title (Apple-style) with an optional subtitle. */
export function LargeTitle({ title, subtitle }) {
  return (
    <View style={styles.titleWrap}>
      <Text style={styles.title}>{title}</Text>
      {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

/** White (light) / raised (dark) card with a soft shadow. */
export function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Round tinted chip holding an icon (tool tiles, list rows). */
export function IconBadge({ name, size = 44, tint }) {
  const c = palette();
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size * 0.34, backgroundColor: c.accentSoft }]}>
      <Icon name={name} size={Math.round(size * 0.5)} color={tint ?? c.accent} />
    </View>
  );
}

/** Primary action: indigo → violet gradient, pill shaped. */
export function PrimaryButton({ label, onPress, disabled, busy, icon }) {
  const c = palette();
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} accessibilityRole="button" style={({ pressed }) => [styles.primary, (disabled || busy) && styles.off, pressed && styles.pressed]}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={c.accent} />
            <Stop offset="1" stopColor={c.accentAlt} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#g)" />
      </Svg>
      {busy ? (
        <ActivityIndicator color={c.onAccent} />
      ) : (
        <View style={styles.primaryRow}>
          {!!icon && <Icon name={icon} size={20} color={c.onAccent} />}
          <Text style={styles.primaryText}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** Selectable pill (language, tone). */
export function Pill({ label, on, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[styles.pill, on && styles.pillOn]}>
      <Text style={[styles.pillText, on && styles.pillTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = themedStyles((c) => StyleSheet.create({
  titleWrap: { paddingTop: 8, paddingBottom: 4, gap: 2 },
  title: { color: c.text, fontSize: 34, fontWeight: '700', letterSpacing: -0.8 },
  subtitle: { color: c.textMuted, fontSize: 15 },
  card: { backgroundColor: c.surface, borderRadius: RADIUS.lg, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, ...cardShadow(c) },
  badge: { alignItems: 'center', justifyContent: 'center' },
  primary: { height: 54, borderRadius: RADIUS.pill, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  primaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  primaryText: { color: c.onAccent, fontSize: 17, fontWeight: '600', letterSpacing: -0.2 },
  off: { opacity: 0.45 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  pill: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: RADIUS.pill, backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
  pillOn: { backgroundColor: c.accentSoft, borderColor: c.accent },
  pillText: { color: c.textSoft, fontSize: 14, fontWeight: '500' },
  pillTextOn: { color: c.accent, fontWeight: '600' },
}));
