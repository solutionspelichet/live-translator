import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { Alert, AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import SplitScreen from './src/components/SplitScreen';
import SetupScreen from './src/components/SetupScreen';
import { loadStoredKeys, missingEnv } from './src/config/env';
import { SIDE } from './src/config/languages';
import { loadSettings, saveSettings } from './src/config/settings';
import { DEFAULT_SETTINGS } from './src/config/settingsModel';
import audio from './src/services/AudioRoutingService';
import BackgroundService from './src/services/BackgroundService';
import createEngine from './src/services/createEngine';
import { STATE } from './src/services/TranslationEngine';

export default function App() {
  useKeepAwake();
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  // Bumped after saving so the engine is rebuilt with the new keys.
  const [version, setVersion] = useState(0);
  // Language bound to each side AND each ear (A = left earbud, B = right earbud), auto-send…
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  useEffect(() => {
    Promise.all([loadStoredKeys(), loadSettings().then(setSettings)]).finally(() => setReady(true));
  }, []);

  if (!ready) return <View style={styles.missing} />;
  if (editing || missingEnv().length) {
    return (
      <SetupScreen
        settings={settings}
        onDone={(saved) => {
          setSettings(saved);
          setVersion((v) => v + 1);
          setEditing(false);
        }}
      />
    );
  }
  return (
    <Translator
      key={version}
      settings={settings}
      onSettingsChange={(next) => saveSettings(next).then(setSettings)}
      onOpenSettings={() => setEditing(true)}
    />
  );
}

function Translator({ settings, onSettingsChange, onOpenSettings }) {
  const languages = settings.languages;
  const engine = useMemo(() => {
    const e = createEngine(languages);
    e.autoStop = settings.autoStop;
    return e;
  }, [languages.A, languages.B]); // eslint-disable-line react-hooks/exhaustive-deps
  const [state, setState] = useState(STATE.IDLE);
  const [activeSide, setActiveSide] = useState(null);
  const [level, setLevel] = useState(0);
  const [autoStop, setAutoStop] = useState(settings.autoStop);
  const [diag, setDiag] = useState(null); // null = hidden
  const [texts, setTexts] = useState({ [SIDE.A]: '', [SIDE.B]: '' });

  useEffect(() => {
    // Audio session first, then the background service (must start while the app is visible),
    // then open the mic: the first tap is then instant.
    audio
      .init()
      .then(() => BackgroundService.start())
      .then(() => engine.warmUp())
      .then(() => audio.hasHeadphones())
      .then((ok) => ok || Alert.alert('Écouteurs requis', 'Connectez les écouteurs Bluetooth : sans eux, la voix sortira du haut-parleur sur les deux canaux.'))
      .catch((e) => Alert.alert('Audio', String(e.message ?? e)));

    // Going to the background / turning the screen off must NOT stop anything: the foreground
    // service keeps the mic and the network alive, and a turn in progress keeps translating.
    // On return, make sure the mic is still open (the OS may have reclaimed it).
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') engine.warmUp();
    });

    const off = engine.subscribe((ev) => {
      if (ev.type === 'state') {
        setState(ev.state);
        setActiveSide(ev.side);
        if (ev.state === STATE.STARTING) setTexts({ [SIDE.A]: '', [SIDE.B]: '' });
        // Distinct buzz = "the mic is really live, speak now".
        if (ev.state === STATE.LISTENING) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (ev.state !== STATE.LISTENING) setLevel(0);
      } else if (ev.type === 'level') setLevel(ev.level);
      else if (ev.type === 'interim' || ev.type === 'transcript' || ev.type === 'translation') {
        setTexts((t) => ({ ...t, [ev.side]: ev.text }));
      } else if (ev.type === 'error') Alert.alert('Erreur', String(ev.error?.message ?? ev.error));
    });
    return () => {
      off();
      appState.remove();
      engine.sleep();
      BackgroundService.stop();
      audio.dispose();
    };
  }, [engine]);

  // Diagnostics panel (long-press ⚙︎): lets a tester see whether the mic and STT really work.
  useEffect(() => {
    if (!diag) return undefined;
    const t = setInterval(() => setDiag(engine.diagnostics()), 400);
    return () => clearInterval(t);
  }, [engine, !!diag]);

  return (
    <View style={styles.flex}>
      <StatusBar style="light" />
      <SplitScreen
        languages={languages}
        state={state}
        activeSide={activeSide}
        texts={texts}
        level={level}
        autoStop={autoStop}
        onPress={(side) => engine.toggle(side)}
      />
      <View style={styles.controls} pointerEvents="box-none">
        <Pressable
          style={[styles.chip, autoStop && styles.chipOn]}
          onPress={() => {
            engine.autoStop = !autoStop;
            setAutoStop(!autoStop);
            onSettingsChange({ ...settings, autoStop: !autoStop }); // remembered across launches
          }}
          hitSlop={12}
          accessibilityLabel="Envoi automatique après une pause"
        >
          <Text style={styles.chipText}>{autoStop ? 'Auto ✓' : 'Auto'}</Text>
        </Pressable>
        <Pressable
          style={styles.gear}
          onPress={onOpenSettings}
          onLongPress={() => setDiag((d) => (d ? null : engine.diagnostics()))}
          hitSlop={16}
          accessibilityLabel="Réglages"
        >
          <Text style={styles.gearText}>⚙︎</Text>
        </Pressable>
      </View>
      {diag && (
        <View style={styles.diag} pointerEvents="none">
          <Text style={styles.diagText}>
            {`micro: ${diag.micRunning ? 'ouvert' : 'FERMÉ'} · paquets: ${diag.chunks}`}
            {diag.msSinceChunk != null ? ` · dernier il y a ${diag.msSinceChunk} ms` : ' · aucun paquet reçu'}
            {`\nfréquence: ${diag.sampleRate} Hz · état: ${diag.state} · Deepgram: ${diag.stt ?? '—'}`}
            {diag.micError ? `\nerreur micro: ${diag.micError}` : ''}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  missing: { flex: 1, backgroundColor: '#0B0F1A' },
  controls: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    marginTop: -20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  chip: { height: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: '#000C', justifyContent: 'center' },
  chipOn: { backgroundColor: '#1F8F4E' },
  chipText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  gear: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#000C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  diag: { position: 'absolute', left: 8, right: 8, bottom: 24, backgroundColor: '#000D', borderRadius: 8, padding: 8 },
  diagText: { color: '#7CE0A3', fontFamily: 'Courier', fontSize: 11 },
  gearText: { color: '#fff', fontSize: 20 },
});
