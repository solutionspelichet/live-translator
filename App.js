import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { Alert, AppState, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import HistoryScreen from './src/components/HistoryScreen';
import MeetingsScreen from './src/components/MeetingsScreen';
import UsageScreen from './src/components/UsageScreen';
import SplitScreen from './src/components/SplitScreen';
import SetupScreen from './src/components/SetupScreen';
import { loadStoredKeys, missingEnv } from './src/config/env';
import { SIDE } from './src/config/languages';
import { loadSettings, saveSettings } from './src/config/settings';
import { DEFAULT_SETTINGS, engineOptions } from './src/config/settingsModel';
import Power from './modules/dualcast-power';
import audio from './src/services/AudioRoutingService';
import BackgroundService from './src/services/BackgroundService';
import BackgroundTimers from './src/services/BackgroundTimers';
import EventLog from './src/services/EventLog';
import HistoryStore from './src/services/HistoryStore';
import TranslationMeetingService from './src/services/TranslationMeetingService';
import UsageTracker from './src/services/UsageTracker';
import createEngine from './src/services/createEngine';
import { AUTO, STATE } from './src/services/TranslationEngine';
import { formatClock } from './src/utils/diarize';
import { nextHistoryId, parseHistory } from './src/utils/history';
import { describeError } from './src/utils/http';
import MicIdleController from './src/utils/micIdle';
import { deepgramSeconds } from './src/utils/usage';

export default function App() {
  useKeepAwake();
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [meetings, setMeetings] = useState(false); // meeting recorder: the translator (and its microphone) is closed meanwhile
  // Bumped after saving so the engine is rebuilt with the new keys.
  const [version, setVersion] = useState(0);
  // Language bound to each side AND each ear (A = left earbud, B = right earbud), auto-send…
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  useEffect(() => {
    Promise.all([loadStoredKeys(), loadSettings().then(setSettings), UsageTracker.load(), EventLog.load()]).finally(() => setReady(true));
  }, []);

  if (!ready) return <View style={styles.missing} />;
  if (editing || missingEnv(settings.strategy).length) {
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
  if (meetings) {
    return (
      <MeetingsScreen
        settings={settings}
        onSettingsChange={(next) => saveSettings(next).then(setSettings)}
        onClose={() => setMeetings(false)}
      />
    );
  }
  return (
    <Translator
      key={version}
      settings={settings}
      onSettingsChange={(next) => saveSettings(next).then(setSettings)}
      onOpenSettings={() => setEditing(true)}
      onOpenMeetings={() => setMeetings(true)}
    />
  );
}

/** Resolves when the app is in the foreground (at once if it already is; after 4 s at most, whatever happens). */
function whenForeground() {
  if (AppState.currentState === 'active') return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      sub.remove();
      BackgroundTimers.clearTimeout(timer);
      resolve();
    };
    const sub = AppState.addEventListener('change', (next) => next === 'active' && finish());
    const timer = BackgroundTimers.setTimeout(finish, 4000);
  });
}

function Translator({ settings, onSettingsChange, onOpenSettings, onOpenMeetings }) {
  const languages = settings.languages;
  const engine = useMemo(() => {
    const e = createEngine(languages, engineOptions(settings), settings.strategy);
    e.autoStop = settings.autoStop;
    e.mic.setGain(settings.micGain);
    e.mic.configure({ source: settings.micSource, input: settings.input, agc: settings.micAgc });
    audio.setVoiceVolume(settings.voiceVolume);
    return e;
  }, [languages.A, languages.B, settings.strategy]); // eslint-disable-line react-hooks/exhaustive-deps
  const [state, setState] = useState(STATE.IDLE);
  const [activeSide, setActiveSide] = useState(null);
  const [level, setLevel] = useState(0);
  const [autoStop, setAutoStop] = useState(settings.autoStop);
  const [diag, setDiag] = useState(null); // null = hidden
  const [texts, setTexts] = useState({ [SIDE.A]: '', [SIDE.B]: '' });
  const [handsFree, setHandsFree] = useState(settings.handsFree);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  const [usage, setUsage] = useState(UsageTracker.snapshot());
  const [recording, setRecording] = useState(TranslationMeetingService.snapshot()); // the conversation being recorded as a meeting
  const [, setTick] = useState(0);
  const historyId = useRef(0);
  const historyLoaded = useRef(false);

  useEffect(() => {
    // Nothing to translate for a while: release the microphone (see micIdle.js). The next tap, or coming back to the app, reopens it.
    const micIdle = new MicIdleController({ engine, timers: BackgroundTimers, appState: AppState.currentState, onNote: (text) => EventLog.add(text) });

    // Audio session first, then open the mic (the first tap is then instant), then the optional
    // background service (must start while the app is visible).
    audio
      .init()
      .then(() => audio.selectInput(settings.input))
      .then(whenForeground) // a recorder started while the app is still 'background' (launch flicker) can be silenced by Android
      .then(() => engine.warmUp())
      .then(() => micIdle.verifySoon()) // the recorder just started: make sure it delivers sound, not zeros
      .then(() => {
        // Optional and non-blocking: must never get in the way of the microphone.
        if (settings.background) BackgroundService.start();
      })
      .then(() => audio.hasHeadphones())
      .then((ok) => ok || Alert.alert('Écouteurs requis', 'Connectez les écouteurs Bluetooth : sans eux, la voix sortira du haut-parleur sur les deux canaux.'))
      .catch((e) => Alert.alert('Audio', String(e.message ?? e)));

    // Going to the background / turning the screen off must NOT stop anything: the foreground
    // service keeps the mic and the network alive, and a turn in progress keeps translating.
    // On return, make sure the mic is still open (the OS may have reclaimed it).
    const appState = AppState.addEventListener('change', (next) => {
      const d = engine.diagnostics();
      EventLog.add(`app: ${next} (micro ${d.micRunning ? 'ouvert' : 'fermé'}, ${d.chunks} paquets, dernier il y a ${d.msSinceChunk ?? '—'} ms)`);
      micIdle.onAppState(next); // back in the foreground: open the mic again
    });

    const off = engine.subscribe((ev) => {
      if (ev.type === 'state') {
        EventLog.add(`état: ${ev.state}`);
        micIdle.onState(ev.state);
        setState(ev.state);
        setActiveSide(ev.side);
        if (ev.state === STATE.STARTING) setTexts({ [SIDE.A]: '', [SIDE.B]: '' });
        // Distinct buzz = "the mic is really live, speak now".
        if (ev.state === STATE.LISTENING) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (ev.state !== STATE.LISTENING) setLevel(0);
      } else if (ev.type === 'level') setLevel(ev.level);
      else if (ev.type === 'interim' || ev.type === 'transcript' || ev.type === 'translation') {
        setTexts((t) => ({ ...t, [ev.side]: ev.text }));
      } else if (ev.type === 'segment') {
        TranslationMeetingService.add(ev);
        setHistory((h) =>
          [...h, { id: ++historyId.current, from: ev.from, to: ev.to, fromLang: ev.fromLang, toLang: ev.toLang, source: ev.source, translated: ev.translated, at: ev.at }].slice(-300),
        );
      } else if (ev.type === 'usage') {
        UsageTracker.add(ev.delta);
      } else if (ev.type === 'timing') {
        EventLog.add(
          `délai: reco ${ev.sttMs ?? '?'} ms · DeepL ${ev.translateMs} ms · voix ${ev.ttsMs ?? '?'} ms · prêt en ${ev.readyMs ?? '?'} ms${ev.streamed ? ' (flux)' : ''}${ev.sttMs != null && ev.readyMs != null ? ` ⇒ ≈ ${ev.sttMs + ev.readyMs} ms après le dernier mot` : ''}`,
        );
      } else if (ev.type === 'idle-stop') {
        EventLog.add(`mains libres arrêté : aucun mot depuis ${ev.minutes} min`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        Alert.alert('Mains libres arrêté', `Aucune parole détectée depuis ${ev.minutes} minutes : l'écoute s'est arrêtée pour économiser la batterie et la transcription. Touchez l'écran pour reprendre.`);
      } else if (ev.type === 'note') {
        EventLog.add(ev.text);
      } else if (ev.type === 'error') {
        EventLog.add(`ERREUR: ${String(ev.error?.message ?? ev.error)}`);
        Alert.alert('Erreur', describeError(ev.error));
      }
    });
    return () => {
      off();
      appState.remove();
      micIdle.dispose();
      engine.sleep();
      if (settings.background) BackgroundService.stop();
      audio.dispose();
    };
  }, [engine]);

  // Microphone / voice settings apply instantly when edited: gain and volume now, and a new
  // microphone (the recorder restarts) when the choice changed.
  const firstRun = useRef(true);
  const inputKey = settings.input?.id ?? 'builtin';
  useEffect(() => {
    engine.mic.setGain(settings.micGain);
    audio.setVoiceVolume(settings.voiceVolume);
  }, [engine, settings.micGain, settings.voiceVolume]);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false; // the initial selection is done in the startup chain
      return;
    }
    // New microphone / audio source / gain control: restart the capture with the new settings.
    const changed = engine.mic.configure({ source: settings.micSource, input: settings.input, agc: settings.micAgc });
    audio
      .selectInput(settings.input)
      .then(() => changed && engine.mic.running && engine.mic.restart()) // a released mic simply opens with the new settings at the next tap
      .catch(() => {});
  }, [engine, inputKey, settings.micSource, settings.micAgc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Heartbeat in the journal (every minute): if the app is frozen or killed while the screen is off, the gap shows.
  useEffect(() => {
    const t = BackgroundTimers.setInterval(() => {
      const d = engine.diagnostics();
      EventLog.add(
        `♥ ${AppState.currentState} · état ${d.state} · micro ${d.micRunning ? 'ouvert' : d.state === STATE.IDLE ? 'coupé (veille)' : 'FERMÉ'} (${d.chunks} paquets, dernier il y a ${d.msSinceChunk ?? '—'} ms) · ${d.sttLabel ?? 'Deepgram'} ${d.stt ?? '—'} · veille ${BackgroundService.lockHeld ? 'verrou' : 'SANS verrou'} · batterie ${Power.isIgnoringBatteryOptimizations() ? 'sans limite' : 'LIMITÉE'}`,
      );
    }, 60000);
    return () => BackgroundTimers.clearInterval(t);
  }, [engine]);

  // Meeting recorded while translating: state of the chip + a clock that ticks.
  useEffect(() => TranslationMeetingService.subscribe(setRecording), []);
  useEffect(() => {
    if (!recording.active) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [recording.active]);
  const toggleMeeting = async () => {
    if (!TranslationMeetingService.active) {
      TranslationMeetingService.start();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      return;
    }
    const record = await TranslationMeetingService.stop();
    if (!record || record.empty) {
      Alert.alert('Réunion vide', "Aucune phrase n'a été traduite pendant l'enregistrement : rien n'a été gardé.");
      return;
    }
    Alert.alert(
      'Conversation enregistrée',
      `${record.segments.length} passages gardés. Ouvrez 📝 Réunions pour la relire et rédiger le compte rendu.`,
      [{ text: 'Plus tard' }, { text: 'Ouvrir 📝', onPress: onOpenMeetings }],
    );
  };

  // Billing counter: live numbers on the 📊 chip and in its screen.
  useEffect(() => UsageTracker.subscribe(setUsage), []);
  useEffect(() => () => {
    UsageTracker.save(); // don't lose the last seconds when the screen is left
  }, []);

  // History: restored at start, saved a moment after each change.
  useEffect(() => {
    HistoryStore.load().then((items) => {
      historyId.current = nextHistoryId(items);
      historyLoaded.current = true;
      setHistory((current) => parseHistory([...items, ...current]));
    });
  }, []);
  useEffect(() => {
    if (!historyLoaded.current) return undefined;
    const t = setTimeout(() => HistoryStore.save(history), 1500);
    return () => clearTimeout(t);
  }, [history]);

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
        handsFree={handsFree}
        onPress={(side) => engine.toggle(handsFree ? AUTO : side)}
      />
      <View style={styles.controls} pointerEvents="box-none">
        <Pressable
          style={[styles.chip, handsFree && styles.chipOn]}
          onPress={() => {
            engine.cancel(); // never switch mode in the middle of a turn
            setHandsFree(!handsFree);
            onSettingsChange({ ...settings, handsFree: !handsFree });
          }}
          hitSlop={12}
          accessibilityLabel="Mains libres : détection automatique de la langue"
        >
          <Text style={styles.chipText}>{handsFree ? 'Mains libres ✓' : 'Mains libres'}</Text>
        </Pressable>
        <Pressable
          style={[styles.chip, autoStop && styles.chipOn, handsFree && styles.chipDim]}
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
          style={[styles.chip, recording.active && styles.chipRec]}
          onPress={toggleMeeting}
          hitSlop={12}
          accessibilityLabel="Enregistrer la conversation traduite comme réunion"
        >
          <Text style={styles.chipText}>
            {recording.active ? `⏺ ${formatClock(TranslationMeetingService.current?.elapsedSec ?? 0)} · ${recording.passages}` : '⏺ Réunion'}
          </Text>
        </Pressable>
        <Pressable style={styles.chip} onPress={() => setShowUsage(true)} hitSlop={12} accessibilityLabel="Consommation facturée">
          <Text style={styles.chipText}>{`📊 ${Math.round(deepgramSeconds(usage.today) / 60)} min`}</Text>
        </Pressable>
        <Pressable style={styles.gear} onPress={onOpenMeetings} hitSlop={12} accessibilityLabel="Réunions : enregistrer et résumer">
          <Text style={styles.gearText}>📝</Text>
        </Pressable>
        <Pressable style={styles.gear} onPress={() => setShowHistory(true)} hitSlop={12} accessibilityLabel="Historique">
          <Text style={styles.gearText}>🕘</Text>
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
      <UsageScreen
        visible={showUsage}
        usage={usage}
        prices={settings.prices}
        onPrices={(prices) => onSettingsChange({ ...settings, prices })}
        onReset={() => UsageTracker.reset()}
        onClose={() => setShowUsage(false)}
      />
      <HistoryScreen
        visible={showHistory}
        items={history}
        languages={languages}
        onClear={() => {
          setHistory([]);
          HistoryStore.clear();
        }}
        onClose={() => setShowHistory(false)}
      />
      {diag && (
        <View style={styles.diag} pointerEvents="box-none">
          <Pressable
            style={styles.diagShare}
            onPress={() => Share.share({ title: 'Journal DualCast', message: EventLog.all().join('\n') }).catch(() => {})}
            hitSlop={10}
            accessibilityRole="button"
          >
            <Text style={styles.diagShareText}>Partager le journal complet</Text>
          </Pressable>
          <Text style={styles.diagText}>
            {`micro: ${diag.micRunning ? 'ouvert' : 'FERMÉ'} · paquets: ${diag.chunks}`}
            {diag.msSinceChunk != null ? ` · dernier il y a ${diag.msSinceChunk} ms` : ' · aucun paquet reçu'}
            {`\nfréquence: ${diag.sampleRate} Hz · état: ${diag.state} · Deepgram: ${diag.stt ?? '—'}`}
            {`\narrière-plan: ${settings.background ? BackgroundService.status : 'désactivé'}`}
            {`\ncapture: ${diag.backend}`}
            {`\nmicro choisi: ${settings.input?.name ?? 'téléphone (auto)'}`}
            {`\nveille: verrou ${BackgroundService.lockHeld ? 'oui' : 'NON'} · batterie sans limite: ${Power.isIgnoringBatteryOptimizations() ? 'oui' : 'NON'} · gain micro: ×${Number(diag.gain).toFixed(1)}`}
            {diag.micError ? `\nerreur micro: ${diag.micError}` : ''}
            {`\n— journal —\n${EventLog.last(10).join('\n') || '(vide)'}`}
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
    left: 8,
    right: 8,
    top: '50%',
    marginTop: -20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  chip: { height: 38, paddingHorizontal: 12, borderRadius: 19, backgroundColor: '#000C', justifyContent: 'center' },
  chipOn: { backgroundColor: '#1F8F4E' },
  chipDim: { opacity: 0.4 },
  chipRec: { backgroundColor: '#C0392B' },
  chipText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  gear: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#000C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  diag: { position: 'absolute', left: 8, right: 8, bottom: 24, backgroundColor: '#000D', borderRadius: 8, padding: 8 },
  diagText: { color: '#7CE0A3', fontFamily: 'Courier', fontSize: 11 },
  diagShare: { alignSelf: 'flex-end', backgroundColor: '#2F6FED', borderRadius: 12, paddingVertical: 6, paddingHorizontal: 12, marginBottom: 6 },
  diagShareText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  gearText: { color: '#fff', fontSize: 20 },
});
