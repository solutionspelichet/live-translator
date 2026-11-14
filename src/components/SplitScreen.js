import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { getLanguage, SIDE } from '../config/languages';
import { Plain as RNText, Text } from '../i18n/Text';
import { t } from '../i18n';
import { STATE } from '../services/TranslationEngine';
import { cardShadow, palette, themedStyles } from '../theme';
import Icon from './Icon';

const zoneColors = (c) => ({
  [SIDE.A]: { idle: c.zoneA, active: c.zoneAActive },
  [SIDE.B]: { idle: c.zoneB, active: c.zoneBActive },
});
const WHITE = '#FFFFFF'; // text on a live (coloured) zone, in both themes

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
 * @param {'face'|'side'} [props.layout]   'face': two people facing each other (A upside down); 'side': one reader, both zones upright
 * @param {import('react').ReactNode} [props.middle]   controls placed BETWEEN the two zones (in the layout, never over them)
 */
export default function SplitScreen({ languages, state, activeSide, texts, level, autoStop, handsFree, onPress, middle, layout = 'face' }) {
  const shared = { languages, state, activeSide, texts, level, autoStop, handsFree, onPress };
  return (
    <View style={styles.root}>
      <Zone side={SIDE.A} flipped={layout === 'face'} {...shared} />
      {middle}
      <Zone side={SIDE.B} {...shared} />
    </View>
  );
}

function Zone({ side, flipped, languages, state, activeSide, texts, level, autoStop, handsFree, onPress }) {
  const lang = getLanguage(languages[side]);
  const c = palette();
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
        { backgroundColor: live ? zoneColors(c)[side].active : zoneColors(c)[side].idle },
        starting && styles.starting,
        recording && !mine && styles.dimmed,
        flipped && styles.flipped,
      ]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress(side);
      }}
      accessibilityRole="button"
      accessibilityLabel={t('Parler en {lang}', { lang: lang.label })}
    >
      <View style={styles.langPill}>
        <RNText style={styles.flag}>{lang.flag}</RNText>
        <Text style={[styles.label, live && { color: WHITE }]}>{lang.label}</Text>
      </View>
      <RNText style={[styles.text, live && { color: WHITE }]} numberOfLines={4}>
        {texts[side] || ' '}
      </RNText>
      <View style={[styles.orb, live && styles.orbLive]}>
        <Icon name={live ? 'wave' : 'mic'} size={26} color={live ? WHITE : c.accent} stroke={2} />
      </View>
      <View style={styles.meterRow}>
        {live && <RecDot />}
        <View style={styles.meterTrack}>
          <View style={[styles.meterFill, { width: `${Math.round((live ? level : 0) * 100)}%`, backgroundColor: live ? WHITE : c.accent }]} />
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

const styles = themedStyles((c) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg, padding: 12, paddingTop: 8, gap: 10 },
  zone: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, overflow: 'hidden', borderRadius: 32, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, ...cardShadow(c) },
  flipped: { transform: [{ rotate: '180deg' }] },
  starting: { borderWidth: 2, borderColor: c.warnStrong },
  dimmed: { opacity: 0.5 },
  langPill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.overlay, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 },
  flag: { fontSize: 20 },
  label: { color: c.zoneText, fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  text: { color: c.zoneTextSoft, fontSize: 22, lineHeight: 30, fontWeight: '500', letterSpacing: -0.4, textAlign: 'center', marginVertical: 10, minHeight: 60 },
  orb: { width: 52, height: 52, borderRadius: 26, backgroundColor: c.overlay, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  orbLive: { backgroundColor: '#FFFFFF33' },
  meterRow: { flexDirection: 'row', alignItems: 'center', height: 14, width: '60%', marginBottom: 10 },
  meterTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: c.track, overflow: 'hidden' },
  meterFill: { height: 4, borderRadius: 2 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.rec, marginRight: 10 },
  status: { color: c.zoneStatus, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', textAlign: 'center', fontWeight: '500' },
  statusLive: { color: WHITE, fontWeight: '600' },
}));
