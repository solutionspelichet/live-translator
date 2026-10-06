import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getLanguage, SIDE } from '../config/languages';
import { STATE } from '../services/TranslationEngine';

const COLORS = {
  [SIDE.A]: { idle: '#16233B', active: '#2F6FED' },
  [SIDE.B]: { idle: '#2A1B3D', active: '#C24CF6' },
};

const STATUS_LABEL = {
  [STATE.IDLE]: 'Maintenir pour parler',
  [STATE.LISTENING]: 'Je vous écoute…',
  [STATE.PROCESSING]: 'Traduction…',
  [STATE.SPEAKING]: 'Lecture…',
};

/**
 * Two big push-to-talk zones. The zone you hold *is* the source language, so there is
 * no auto-detection and no cross-talk errors between the two speakers.
 *
 * Layout: the phone lies flat between two people facing each other, so zone A (top) is
 * rotated 180° to be readable by the person sitting across from the one at zone B.
 *
 * @param {{A: string, B: string}} props.languages   language code per side
 * @param {string} props.state                       engine STATE
 * @param {SIDE|null} props.activeSide               side currently being heard
 * @param {{A: string, B: string}} props.texts       latest text shown in each zone
 * @param {(side) => void} props.onPressIn
 * @param {() => void} props.onPressOut
 */
export default function SplitScreen({ languages, state, activeSide, texts, onPressIn, onPressOut }) {
  return (
    <View style={styles.root}>
      <Zone side={SIDE.A} flipped {...{ languages, state, activeSide, texts, onPressIn, onPressOut }} />
      <View style={styles.divider} />
      <Zone side={SIDE.B} {...{ languages, state, activeSide, texts, onPressIn, onPressOut }} />
    </View>
  );
}

function Zone({ side, flipped, languages, state, activeSide, texts, onPressIn, onPressOut }) {
  const lang = getLanguage(languages[side]);
  const isHeld = state === STATE.LISTENING && activeSide === side;
  // While one person holds their zone, the other can't steal the mic.
  const locked = state === STATE.LISTENING && activeSide !== side;
  const status = isHeld || activeSide === side ? STATUS_LABEL[state] : STATUS_LABEL[STATE.IDLE];

  return (
    <Pressable
      style={[
        styles.zone,
        { backgroundColor: isHeld ? COLORS[side].active : COLORS[side].idle },
        locked && styles.locked,
        flipped && styles.flipped,
      ]}
      disabled={locked}
      onPressIn={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        onPressIn(side);
      }}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityLabel={`Parler en ${lang.label}`}
    >
      <Text style={styles.flag}>{lang.flag}</Text>
      <Text style={styles.label}>{lang.label}</Text>
      <Text style={styles.text} numberOfLines={6}>
        {texts[side] || ' '}
      </Text>
      <Text style={styles.status}>{status}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  zone: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  flipped: { transform: [{ rotate: '180deg' }] },
  locked: { opacity: 0.35 },
  divider: { height: 2, backgroundColor: '#000' },
  flag: { fontSize: 44 },
  label: { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 4 },
  text: { color: '#E8ECF8', fontSize: 20, textAlign: 'center', marginVertical: 16, minHeight: 60 },
  status: { color: '#9AA6C4', fontSize: 14, letterSpacing: 1, textTransform: 'uppercase' },
});
