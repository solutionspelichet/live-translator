import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { getLanguage, SIDE } from '../config/languages';
import { Plain as RNText, Text } from '../i18n/Text';
import { t } from '../i18n';
import { STATE } from '../services/TranslationEngine';
import { isAtEnd, withLive, zoneLog } from '../utils/zoneLog';
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
export default function SplitScreen({ languages, state, activeSide, texts, level, autoStop, handsFree, onPress, middle, layout = 'face', history = [], since = 0 }) {
  const shared = { languages, state, activeSide, texts, level, autoStop, handsFree, onPress, history, since };
  return (
    <View style={styles.root}>
      <Zone side={SIDE.A} flipped={layout === 'face'} {...shared} />
      {middle}
      <Zone side={SIDE.B} {...shared} />
    </View>
  );
}

function Zone({ side, flipped, languages, state, activeSide, texts, level, autoStop, handsFree, onPress, history, since }) {
  const lang = getLanguage(languages[side]);
  const c = palette();
  const mine = activeSide === side || activeSide === 'auto'; // hands-free: both halves are "live"
  const recording = state === STATE.STARTING || state === STATE.LISTENING;
  const live = mine && state === STATE.LISTENING;
  const starting = mine && state === STATE.STARTING;

  // The text of the zone scrolls: the whole session is there, the finger goes back to what was said before. At the end the view follows
  // the new text; once the reader has scrolled up it stays where it is (« Direct » brings it back).
  const log = useMemo(() => withLive(zoneLog(history, side, since), texts[side]), [history, side, since, texts[side]]); // eslint-disable-line react-hooks/exhaustive-deps
  const scroller = useRef(null);
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);
  const sizes = useRef({ viewHeight: 0, contentHeight: 0 });
  const updateFollowing = (value) => {
    followingRef.current = value;
    setFollowing(value);
  };

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
      <View style={styles.logWrap}>
        <ScrollView
          ref={scroller}
          style={styles.log}
          contentContainerStyle={styles.logContent}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={64}
          onLayout={(e) => (sizes.current.viewHeight = e.nativeEvent.layout.height)}
          onContentSizeChange={(_, h) => {
            sizes.current.contentHeight = h;
            if (followingRef.current) scroller.current?.scrollToEnd({ animated: true });
          }}
          onScroll={(e) => {
            const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
            const atEnd = isAtEnd({ offsetY: contentOffset.y, viewHeight: layoutMeasurement.height, contentHeight: contentSize.height });
            if (atEnd !== followingRef.current) updateFollowing(atEnd);
          }}
        >
          {log.length === 0 && <RNText style={styles.text}>{' '}</RNText>}
          {log.map((entry, i) => {
            const last = i === log.length - 1;
            return (
              <RNText
                key={entry.id}
                style={[styles.entry, entry.kind === 'said' && styles.entrySaid, entry.kind === 'heard' && styles.entryHeard, last && styles.entryLast, live && { color: WHITE }]}
                selectable
              >
                {entry.text}
              </RNText>
            );
          })}
        </ScrollView>
        {!following && (
          <Pressable
            style={styles.live}
            onPress={() => {
              updateFollowing(true);
              scroller.current?.scrollToEnd({ animated: true });
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('Revenir au direct')}
          >
            <View style={styles.liveArrow}>
              <Icon name="chevron" size={14} color={palette().onAccent} stroke={2.4} />
            </View>
            <Text style={styles.liveText}>Direct</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.meterRow}>
        <Icon name={live ? 'wave' : 'mic'} size={16} color={live ? WHITE : c.accent} stroke={2} />
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
  zone: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12, overflow: 'hidden', borderRadius: 32, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, ...cardShadow(c) },
  flipped: { transform: [{ rotate: '180deg' }] },
  starting: { borderWidth: 2, borderColor: c.warnStrong },
  dimmed: { opacity: 0.5 },
  langPill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.overlay, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 },
  flag: { fontSize: 20 },
  label: { color: c.zoneText, fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  logWrap: { flex: 1, alignSelf: 'stretch', marginVertical: 6 },
  log: { flex: 1 },
  logContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: 6, gap: 8 },
  entry: { color: c.zoneTextSoft, fontSize: 17, lineHeight: 24, textAlign: 'center', opacity: 0.55 },
  entrySaid: { fontStyle: 'italic' },
  entryHeard: { fontWeight: '600', opacity: 0.75 },
  entryLast: { fontSize: 22, lineHeight: 30, fontWeight: '500', letterSpacing: -0.4, opacity: 1, fontStyle: 'normal' },
  live: { position: 'absolute', right: 4, bottom: 4, flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: c.accent, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, ...cardShadow(c) },
  liveArrow: { transform: [{ rotate: '90deg' }] },
  liveText: { color: c.onAccent, fontSize: 12, fontWeight: '600' },
  text: { color: c.zoneTextSoft, fontSize: 22, lineHeight: 30, fontWeight: '500', letterSpacing: -0.4, textAlign: 'center', marginVertical: 10, minHeight: 60 },
  meterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 18, width: '70%', marginBottom: 6 },
  meterTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: c.track, overflow: 'hidden' },
  meterFill: { height: 4, borderRadius: 2 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: c.rec },
  status: { color: c.zoneStatus, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', textAlign: 'center', fontWeight: '500' },
  statusLive: { color: WHITE, fontWeight: '600' },
}));
