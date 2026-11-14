import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, PanResponder, Pressable, SafeAreaView, ScrollView, StyleSheet, View } from 'react-native';
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

/** Segmented control (iOS style): one rounded track, the selected option raised. @param {{id: string, label: string}[]} options */
export function Segmented({ options, value, onChange }) {
  return (
    <View style={styles.segTrack}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable key={o.id} style={[styles.segItem, on && styles.segOn]} onPress={() => onChange(o.id)} accessibilityRole="button" accessibilityState={{ selected: on }}>
            <Text style={[styles.segText, on && styles.segTextOn]} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Continuous horizontal slider (value 0…1), no native module: a track, a filled part and a thumb dragged with the finger. */
export function Slider({ value, onChange, disabled }) {
  const c = palette();
  const width = useRef(1);
  const start = useRef(0);
  const latest = useRef({ onChange, disabled });
  latest.current = { onChange, disabled };
  const set = (x) => latest.current.onChange(Math.min(1, Math.max(0, x / width.current)));
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !latest.current.disabled,
      onMoveShouldSetPanResponder: () => !latest.current.disabled,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        start.current = e.nativeEvent.locationX;
        set(start.current);
      },
      onPanResponderMove: (_, g) => set(start.current + g.dx),
    }),
  ).current;
  const v = Math.min(1, Math.max(0, value));
  return (
    <View style={[styles.sliderHit, disabled && styles.off]} onLayout={(e) => (width.current = Math.max(1, e.nativeEvent.layout.width))} {...pan.panHandlers} accessibilityRole="adjustable">
      <View style={styles.sliderTrack}>
        <View style={[styles.sliderFill, { width: `${v * 100}%` }]} />
      </View>
      <View pointerEvents="none" style={[styles.sliderThumb, { left: `${v * 100}%`, borderColor: c.accent }]} />
    </View>
  );
}

/** Dropdown: a field showing the current choice, a sheet of options. @param {{id: string|null, label: string, hint?: string}[]} options */
export function Select({ value, options, onChange, placeholder }) {
  const c = palette();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value);
  return (
    <>
      <Pressable style={styles.selectField} onPress={() => setOpen(true)} accessibilityRole="button">
        <Text style={styles.selectText} numberOfLines={1}>{current?.label ?? placeholder ?? ''}</Text>
        <Icon name="chevron" size={16} color={c.textMuted} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setOpen(false)}>
          <SafeAreaView style={styles.sheetWrap}>
            <View style={styles.sheet}>
              <ScrollView>
                {options.map((o) => (
                  <Pressable key={String(o.id)} style={styles.sheetRow} onPress={() => { onChange(o.id); setOpen(false); }} accessibilityRole="button">
                    <View style={styles.sheetText}>
                      <Text style={styles.sheetLabel}>{o.label}</Text>
                      {!!o.hint && <Text style={styles.sheetHint}>{o.hint}</Text>}
                    </View>
                    {o.id === value && <Icon name="check" size={18} color={c.accent} stroke={2.2} />}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </SafeAreaView>
        </Pressable>
      </Modal>
    </>
  );
}

/** A long explanation folded behind an (i): the screen stays scannable, the details stay one tap away. */
export function Hint({ children }) {
  const c = palette();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.hintWrap}>
      <Pressable onPress={() => setOpen(!open)} hitSlop={8} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.hintBtn}>
        <Icon name="info" size={16} color={c.textMuted} />
        <Text style={styles.hintToggle}>{open ? 'Masquer' : "Plus d'informations"}</Text>
      </Pressable>
      {open && <Text style={styles.hintText}>{children}</Text>}
    </View>
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
  sliderHit: { height: 40, justifyContent: 'center', marginVertical: 6 },
  sliderTrack: { height: 6, borderRadius: 3, backgroundColor: c.track, overflow: 'hidden' },
  sliderFill: { height: 6, backgroundColor: c.accent },
  sliderThumb: { position: 'absolute', width: 26, height: 26, borderRadius: 13, marginLeft: -13, backgroundColor: c.surface, borderWidth: 2, shadowColor: c.shadow, shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  selectField: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.inset, borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, paddingVertical: 14, paddingHorizontal: 14 },
  selectText: { flex: 1, color: c.text, fontSize: 15.5, fontWeight: '500' },
  sheetBackdrop: { flex: 1, backgroundColor: '#000A', justifyContent: 'flex-end' },
  sheetWrap: { width: '100%' },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, paddingVertical: 8, maxHeight: 460, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 15, paddingHorizontal: 20 },
  sheetText: { flex: 1, gap: 2 },
  sheetLabel: { color: c.text, fontSize: 16, fontWeight: '500' },
  sheetHint: { color: c.textMuted, fontSize: 13 },
  hintWrap: { marginVertical: 8, gap: 8 },
  hintBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  hintToggle: { color: c.textMuted, fontSize: 13, fontWeight: '500' },
  hintText: { color: c.textMuted, fontSize: 14, lineHeight: 21 },
  segTrack: { flexDirection: 'row', backgroundColor: c.inset, borderRadius: RADIUS.pill, padding: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
  segItem: { flex: 1, height: 34, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  segOn: { backgroundColor: c.accent },
  segText: { color: c.textMuted, fontSize: 13.5, fontWeight: '600', letterSpacing: -0.1 },
  segTextOn: { color: c.onAccent },
  pill: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: RADIUS.pill, backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
  pillOn: { backgroundColor: c.accentSoft, borderColor: c.accent },
  pillText: { color: c.textSoft, fontSize: 14, fontWeight: '500' },
  pillTextOn: { color: c.accent, fontWeight: '600' },
}));
