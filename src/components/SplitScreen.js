import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { getLanguage, SIDE } from '../config/languages';
import { STATE } from '../services/TranslationEngine';

const COLORS = {
  [SIDE.A]: { idle: '#16233B', active: '#2F6FED' },
  [SIDE.B]: { idle: '#2A1B3D', active: '#C24CF6' },
};

/**
 * Two big tap zones. Tap a zone to start recording in *its* language (the zone IS the
 * source language, so no auto-detection and no cross-talk errors); tap again — on either
 * zone — to stop and send. No need to keep a finger down.
 *
 * Layout: the phone lies flat between two people facing each other, so zone A (top) is
 * rotated 180° to be readable by the person sitting across from the one at zone B.
 *
 * @param {{A: string, B: string}} props.languages   language code per side
 * @param {string} props.state                       engine STATE
 * @param {SIDE|null} props.activeSide               side whose turn is in progress
 * @param {{A: string, B: string}} props.texts       latest text shown in each zone
 * @param {number} props.level                       live microphone level 0..1
 * @param {boolean} props.autoStop                   a pause in speech sends automatically
 * @param {boolean} props.handsFree                  language detected automatically; a tap anywhere starts/stops
 * @param {(side) => void} props.onPress
 */
export default function SplitScreen({ languages, state, activeSide, texts, level, autoStop, handsFree, onPress }) {
  const shared = { languages, state, activeSide, texts, level, autoStop, handsFree, onPress };
  return (
    <View style={styles.root}>
      <Zone side={SIDE.A} flipped {...shared} />
      <View style={styles.divider} />
      <Zone side={SIDE.B} {...shared} />
    </View>
  );
}

function Zone({ side, flipped, languages, state, activeSide, texts, level, autoStop, handsFree, onPress }) {
  const lang = getLanguage(languages[side]);
  const mine = activeSide === side || activeSide === 'auto'; // hands-free: both halves are "live"
  const recording = state === STATE.STARTING || state === STATE.LISTENING;
  const live = mine && state === STATE.LISTENING;
  const starting = mine && state === STATE.STARTING;

  let status = handsFree ? 'Touchez pour démarrer' : 'Touchez pour parler';
  if (recording && !mine) status = 'Touchez pour terminer';
  else if (starting) status = 'Préparation…';
  else if (live && handsFree) status = 'Mains libres — parlez, la langue est détectée. Touchez pour arrêter';
  else if (live) status = autoStop ? 'Parlez — une pause envoie la traduction' : 'Parlez maintenant — touchez pour terminer';
  else if (mine && state === STATE.PROCESSING) status = 'Traduction…';
  else if (mine && state === STATE.SPEAKING) status = 'Lecture…';

  return (
    <Pressable
      style={[
        styles.zone,
        { backgroundColor: live ? COLORS[side].active : COLORS[side].idle },
        starting && styles.starting,
        recording && !mine && styles.dimmed,
        flipped && styles.flipped,
      ]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress(side);
      }}
      accessibilityRole="button"
      accessibilityLabel={`Parler en ${lang.label}`}
    >
      <Text style={styles.flag}>{lang.flag}</Text>
      <Text style={styles.label}>{lang.label}</Text>
      <Text style={styles.text} numberOfLines={6}>
        {texts[side] || ' '}
      </Text>
      <View style={styles.meterRow}>
        {live && <RecDot />}
        <View style={styles.meterTrack}>
          <View style={[styles.meterFill, { width: `${Math.round((live ? level : 0) * 100)}%` }]} />
        </View>
      </View>
      <Text style={[styles.status, live && styles.statusLive]}>{status}</Text>
    </Pressable>
  );
}

/** Blinking red dot: the unmistakable "you are being recorded now" signal. */
function RecDot() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.25, duration: 500, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[styles.dot, { opacity }]} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  zone: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  flipped: { transform: [{ rotate: '180deg' }] },
  starting: { borderWidth: 4, borderColor: '#FFB020' },
  dimmed: { opacity: 0.55 },
  divider: { height: 2, backgroundColor: '#000' },
  flag: { fontSize: 44 },
  label: { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 4 },
  text: { color: '#E8ECF8', fontSize: 20, textAlign: 'center', marginVertical: 16, minHeight: 60 },
  meterRow: { flexDirection: 'row', alignItems: 'center', height: 14, width: '70%', marginBottom: 12 },
  meterTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#FFFFFF22', overflow: 'hidden' },
  meterFill: { height: 6, backgroundColor: '#fff' },
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#FF3B30', marginRight: 10 },
  status: { color: '#9AA6C4', fontSize: 14, letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center' },
  statusLive: { color: '#fff', fontWeight: '700' },
});
