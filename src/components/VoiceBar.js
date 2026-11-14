import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Plain, Text } from '../i18n/Text';
import { formatLatency, serviceName, statusTone } from '../utils/voiceUi';
import { palette, themedStyles } from '../theme';
import Icon from './Icon';

/** Telemetry bar of the voice screen: live status pill (service + state dot) and the delay of the last sentence, in monospace. */
export function TelemetryBar({ strategy, state, latencyMs, right }) {
  const c = palette();
  const tone = statusTone(state);
  const dot = tone === 'live' ? c.successStrong : tone === 'busy' ? c.warnStrong : c.textFaint;
  return (
    <View style={styles.bar}>
      <View style={styles.pill}>
        <View style={[styles.dot, { backgroundColor: dot }]} />
        <Plain style={styles.pillText}>{serviceName(strategy)}</Plain>
      </View>
      <View style={styles.latency} accessibilityLabel="Délai de la dernière phrase">
        <Icon name="bolt" size={14} color={c.accent} stroke={2} />
        <Plain style={styles.mono}>{formatLatency(latencyMs)}</Plain>
      </View>
      <View style={styles.right}>{right}</View>
    </View>
  );
}

/** Central microphone of the hands-free mode: a soft pulse (native-driven, only while listening) so the screen never animates for nothing. */
export function ListenHub({ live, busy, onPress }) {
  const c = palette();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!live) {
      pulse.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [live, pulse]);
  const ring = { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }] };
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Démarrer ou arrêter l'écoute mains libres" style={styles.hubWrap} hitSlop={8}>
      {live && <Animated.View style={[styles.ring, { backgroundColor: c.accent }, ring]} />}
      <View style={[styles.hub, live && styles.hubLive, busy && !live && styles.hubBusy]}>
        <Icon name={live ? 'wave' : 'mic'} size={28} color={c.onAccent} stroke={2} />
      </View>
    </Pressable>
  );
}

/** One microphone button per language (manual / auto modes): it starts listening in that language, a second tap stops. */
export function SideHub({ flag, live, busy, onPress, label }) {
  const c = palette();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!live) {
      pulse.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [live, pulse]);
  const ring = { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] }) }] };
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} style={styles.sideWrap}>
      {live && <Animated.View style={[styles.sideRing, { backgroundColor: c.accent }, ring]} />}
      <View style={[styles.side, live && styles.sideLive, busy && !live && styles.hubBusy]}>
        <Icon name={live ? 'wave' : 'mic'} size={22} color={c.onAccent} stroke={2} />
        <Plain style={styles.sideFlag}>{flag}</Plain>
      </View>
    </Pressable>
  );
}

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = themedStyles((c) => StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: Platform.select({ web: 'max(34px, calc(env(safe-area-inset-top) + 6px))', default: 34 }), paddingBottom: 2 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surface, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { color: c.text, fontSize: 11.5, fontWeight: '600', letterSpacing: 0.8, fontFamily: MONO },
  latency: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  mono: { color: c.textSoft, fontSize: 12.5, fontFamily: MONO },
  right: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  hubWrap: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 56, height: 56, borderRadius: 28 },
  hub: { width: 52, height: 52, borderRadius: 26, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', shadowColor: c.accent, shadowOpacity: 0.55, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  hubLive: { backgroundColor: c.accentAlt },
  hubBusy: { opacity: 0.7 },
  sideWrap: { width: 70, height: 56, alignItems: 'center', justifyContent: 'center' },
  sideRing: { position: 'absolute', width: 70, height: 50, borderRadius: 25 },
  side: { width: 70, height: 50, borderRadius: 25, backgroundColor: c.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, shadowColor: c.accent, shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
  sideLive: { backgroundColor: c.accentAlt },
  sideFlag: { fontSize: 18 },
}));
