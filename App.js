import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { Alert, AppState, Platform, Pressable, ScrollView, Share, StyleSheet, useColorScheme, View } from 'react-native';

import HistoryScreen from './src/components/HistoryScreen';
import MeetingsScreen from './src/components/MeetingsScreen';
import UsageScreen from './src/components/UsageScreen';
import SplitScreen from './src/components/SplitScreen';
import SetupScreen from './src/components/SetupScreen';
import TabBar from './src/components/TabBar';
import TextScreen from './src/components/TextScreen';
import ToolsScreen from './src/components/ToolsScreen';
import { loadStoredKeys, missingEnv } from './src/config/env';
import { getLanguage, SIDE } from './src/config/languages';
import { loadSettings, saveSettings } from './src/config/settings';
import { DEFAULT_SETTINGS, engineOptions } from './src/config/settingsModel';
import Power from './modules/dualcast-power';
import audio from './src/services/AudioRoutingService';
import BackgroundService from './src/services/BackgroundService';
import BackgroundTimers from './src/services/BackgroundTimers';
import { shareTextFile } from './src/services/DocumentExport';
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
import { useFonts } from 'expo-font';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import Icon from './src/components/Icon';
import { Segmented } from './src/components/ui';
import { ListenHub, SideHub, TelemetryBar } from './src/components/VoiceBar';
import { flagsFor, modeOf, VOICE_MODES } from './src/utils/voiceUi';
import AlertHost from './src/web/AlertHost';
import { cardShadow, palette, resolveTheme, setTheme, themedStyles } from './src/theme';
import { setFontsReady } from './src/theme/fonts';
import LanguageFlags from './src/i18n/LanguageFlags';
import { Text } from './src/i18n/Text';
import { defaultLocale, setLocale, t } from './src/i18n';

export default function App() {
  useKeepAwake();
  const [ready, setReady] = useState(false);
  const [fontsLoaded, fontsError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  setFontsReady(fontsLoaded);
  const [tab, setTab] = useState('voice'); // bottom navigation: voice (translator) | text | tools | meetings | settings
  // Bumped after saving so the engine is rebuilt with the new keys.
  const [version, setVersion] = useState(0);
  // Language bound to each side AND each ear (A = left earbud, B = right earbud), auto-send…
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  // Light / dark: the choice (or the phone's setting), previewed live from the settings screen. The screens read the active theme
  // when they render, so changing it just re-renders the tree (no remount: the settings form keeps what was typed).
  const systemScheme = useColorScheme();
  const [previewTheme, setPreviewTheme] = useState(null);
  const [previewLang, setPreviewLang] = useState(null); // the flags of the settings screen: the interface changes at once, saved with the rest
  setTheme(resolveTheme(previewTheme ?? settings.theme, systemScheme));
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    document.documentElement.style.backgroundColor = palette().bg; // the page itself (behind the app, around the safe areas)
    document.body.style.backgroundColor = palette().bg;
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', palette().bg);
  }
  setLocale(previewLang ?? settings.uiLang ?? defaultLocale()); // the interface language (flags), read by every screen when it renders

  useEffect(() => {
    Promise.all([loadStoredKeys(), loadSettings().then(setSettings), UsageTracker.load(), EventLog.load()]).finally(() => setReady(true));
  }, []);

  if (!ready || !(fontsLoaded || fontsError)) return <View style={styles.missing} />;
  const bar = <StatusBar style={palette().scheme === 'dark' ? 'light' : 'dark'} />;
  const save = (next) => {
    EventLog.add(`réglages enregistrés : service ${next.strategy} · sortie ${next.outputMode}`);
    return saveSettings(next).then(setSettings);
  };
  const setup = (
    <SetupScreen
      settings={settings}
      onPreviewTheme={setPreviewTheme}
      onPreviewLang={setPreviewLang}
      onDone={(saved) => {
        setPreviewTheme(null);
        setPreviewLang(null);
        setSettings(saved);
        setVersion((v) => v + 1);
        setTab('voice');
      }}
    />
  );
  // Keys missing (first start): the settings form alone, no navigation.
  if (missingEnv(settings.strategy, { doubaoPreset: settings.doubaoVoiceKind !== 'clone' }).length) {
    return (
      <View style={[styles.flex, { backgroundColor: palette().bg }]}>
        {bar}
        {setup}
        {Platform.OS === 'web' && <AlertHost />}
      </View>
    );
  }
  const cycleTheme = () => {
    const order = ['system', 'light', 'dark'];
    save({ ...settings, theme: order[(Math.max(0, order.indexOf(settings.theme)) + 1) % order.length] });
  };
  let body;
  if (tab === 'settings') body = setup;
  else if (tab === 'meetings') body = <MeetingsScreen settings={settings} onSettingsChange={save} onClose={() => setTab('voice')} />;
  else if (tab === 'text') body = <TextScreen settings={settings} />;
  else if (tab === 'tools') body = <ToolsScreen settings={settings} onOpenSettings={() => setTab('settings')} />;
  else body = <Translator key={version} settings={settings} onSettingsChange={save} onOpenSettings={() => setTab('settings')} onOpenMeetings={() => setTab('meetings')} />;
  return (
    <View style={[styles.flex, { backgroundColor: palette().bg }]}>
      {bar}
      <View style={styles.flex}>{body}</View>
      <TabBar tab={tab} onTab={setTab} theme={settings.theme} onTheme={cycleTheme} />
      {Platform.OS === 'web' && <AlertHost />}
    </View>
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
    audio.setVoiceSpeed(settings.voiceSpeed);
    audio.setOutputMode(settings.outputMode);
    return e;
  }, [languages.A, languages.B, settings.strategy]); // eslint-disable-line react-hooks/exhaustive-deps
  const [state, setState] = useState(STATE.IDLE);
  const [activeSide, setActiveSide] = useState(null);
  const [level, setLevel] = useState(0);
  const [autoStop, setAutoStop] = useState(settings.autoStop);
  const [diag, setDiag] = useState(null); // null = hidden
  const [texts, setTexts] = useState({ [SIDE.A]: '', [SIDE.B]: '' });
  const [handsFree, setHandsFree] = useState(settings.handsFree);
  const [latency, setLatency] = useState(null); // delay of the last translated sentence (ms), shown in the telemetry bar
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  const [usage, setUsage] = useState(UsageTracker.snapshot());
  const [recording, setRecording] = useState(TranslationMeetingService.snapshot()); // the conversation being recorded as a meeting
  const [, setTick] = useState(0);
  const historyId = useRef(0);
  const sessionStart = useRef(Date.now()); // the zones show this session's conversation, not the one stored from an earlier launch
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
      .then(() => (Platform.OS === 'web' ? null : engine.warmUp())) // a browser opens the microphone at the first tap (gesture + permission)
      .then(() => (Platform.OS === 'web' ? null : micIdle.verifySoon())) // the recorder just started: make sure it delivers sound, not zeros
      .then(() => {
        // Optional and non-blocking: must never get in the way of the microphone.
        if (settings.background) BackgroundService.start();
      })
      .then(() => audio.hasHeadphones())
      .then((ok) => ok || Alert.alert(t('Écouteurs requis'), t('Connectez les écouteurs Bluetooth : sans eux, la voix sortira du haut-parleur sur les deux canaux.')))
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
        if (ev.delayMs > 0) setLatency(ev.delayMs);
        TranslationMeetingService.add(ev);
        setHistory((h) =>
          [...h, { id: ++historyId.current, from: ev.from, to: ev.to, fromLang: ev.fromLang, toLang: ev.toLang, source: ev.source, translated: ev.translated, at: ev.at, service: ev.service, delayMs: ev.delayMs }].slice(-300),
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
        Alert.alert(t('Mains libres arrêté'), t("Aucune parole détectée depuis {minutes} minutes : l'écoute s'est arrêtée pour économiser la batterie et la transcription. Touchez l'écran pour reprendre.", { minutes: ev.minutes }));
      } else if (ev.type === 'warning') {
        EventLog.add(`AVERTISSEMENT: ${ev.text}`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        Alert.alert(t('Attention'), t(ev.text));
      } else if (ev.type === 'mic-stuck') {
        // Android keeps the microphone muted while the app is in the background: renew the foreground service + wake locks and buzz,
        // the screen being off the user has no other way to know.
        BackgroundService.start().catch(() => {});
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      } else if (ev.type === 'note') {
        EventLog.add(ev.text);
      } else if (ev.type === 'error') {
        EventLog.add(`ERREUR: ${String(ev.error?.message ?? ev.error)}`);
        Alert.alert(t('Erreur'), describeError(ev.error));
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
    audio.setVoiceSpeed(settings.voiceSpeed);
    audio.setOutputMode(settings.outputMode);
  }, [engine, settings.micGain, settings.voiceVolume, settings.voiceSpeed, settings.outputMode]);
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
        `♥ ${AppState.currentState} · état ${d.state} · micro ${d.micRunning ? 'ouvert' : d.state === STATE.IDLE ? 'coupé (veille)' : 'FERMÉ'} (${d.chunks} paquets, dernier il y a ${d.msSinceChunk ?? '—'} ms, gain ×${Number(d.gain ?? 1).toFixed(1)}) · ${d.sttLabel ?? 'Deepgram'} ${d.stt ?? '—'} · veille ${BackgroundService.lockHeld ? 'verrou' : 'SANS verrou'} · batterie ${Power.isIgnoringBatteryOptimizations() ? 'sans limite' : 'LIMITÉE'}`,
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
      Alert.alert(t('Réunion vide'), t("Aucune phrase n'a été traduite pendant l'enregistrement : rien n'a été gardé."));
      return;
    }
    Alert.alert(
      t('Conversation enregistrée'),
      t('{n} passages gardés. Ouvrez 📝 Réunions pour la relire et rédiger le compte rendu.', { n: record.segments.length }),
      [{ text: t('Plus tard') }, { text: t('Ouvrir 📝'), onPress: onOpenMeetings }],
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

  const mode = modeOf({ handsFree, autoStop });
  const changeMode = (next) => {
    engine.cancel(); // never switch mode in the middle of a turn
    const flags = flagsFor(next);
    if (flags.autoStop !== undefined) {
      engine.autoStop = flags.autoStop;
      setAutoStop(flags.autoStop);
    }
    setHandsFree(flags.handsFree);
    onSettingsChange({ ...settings, ...flags }); // remembered across launches
  };
  const layout = settings.voiceLayout ?? 'face';
  const c = palette();
  const listening = state === STATE.LISTENING || state === STATE.STARTING;

  const sideLive = (side) => state === STATE.LISTENING && (activeSide === side || activeSide === 'auto');
  const sideBusy = (side) => state === STATE.STARTING && (activeSide === side || activeSide === 'auto');
  const dock = (
    <View style={styles.dock}>
      {/* Top of the strip: the microphone button(s) that start and stop listening (the zones only scroll) */}
      <View style={styles.hubRow}>
        {handsFree ? (
          <ListenHub live={state === STATE.LISTENING} busy={state === STATE.STARTING} onPress={() => { audio.unlock(); engine.toggle(AUTO); }} />
        ) : (
          [SIDE.A, SIDE.B].map((side) => (
            <SideHub
              key={side}
              flag={getLanguage(languages[side]).flag}
              live={sideLive(side)}
              busy={sideBusy(side)}
              onPress={() => { audio.unlock(); engine.toggle(side); }}
              label={t('Parler en {lang}', { lang: getLanguage(languages[side]).label })}
            />
          ))
        )}
      </View>
      <Segmented options={VOICE_MODES.map((m) => ({ ...m, label: t(m.label) }))} value={mode} onChange={changeMode} />
      <View style={styles.dockRow}>
        <Pressable
          style={[styles.dockBtn, recording.active && styles.dockRec]}
          onPress={toggleMeeting}
          hitSlop={8}
          accessibilityLabel={t('Enregistrer la conversation traduite comme réunion')}
        >
          <Icon name="record" size={14} color={recording.active ? c.onAccent : c.rec} />
          {recording.active && <Text style={[styles.dockText, styles.dockTextOn]}>{`${formatClock(TranslationMeetingService.current?.elapsedSec ?? 0)} · ${recording.passages}`}</Text>}
        </Pressable>
        <Pressable
          style={styles.dockBtn}
          onPress={() => {
            engine.cancel();
            onSettingsChange({ ...settings, voiceLayout: layout === 'face' ? 'side' : 'face' });
          }}
          hitSlop={8}
          accessibilityLabel={layout === 'face' ? t('Disposition : face à face (touchez pour passer en côte à côte)') : t('Disposition : côte à côte (touchez pour passer en face à face)')}
        >
          <Icon name="rotate" size={18} color={c.text} />
        </Pressable>
        <Pressable style={styles.dockBtn} onPress={() => setShowUsage(true)} hitSlop={8} accessibilityLabel={t('Consommation facturée')}>
          <Icon name="chart" size={17} color={c.text} />
          <Text style={styles.dockText}>{`${Math.round(deepgramSeconds(usage.today) / 60)}`}</Text>
        </Pressable>
        <Pressable style={styles.dockBtn} onPress={() => setShowHistory(true)} hitSlop={8} accessibilityLabel={t('Historique')}>
          <Icon name="clock" size={18} color={c.text} />
        </Pressable>
        <Pressable
          style={styles.dockBtn}
          onPress={onOpenSettings}
          onLongPress={() => {
            try {
              setDiag((d) => (d ? null : engine.diagnostics()));
            } catch (error) {
              EventLog.add(`panneau de diagnostic : ${error?.message ?? error}`);
            }
          }}
          delayLongPress={400}
          hitSlop={12}
          accessibilityLabel={t('Réglages')}
        >
          <Icon name="sliders" size={18} color={c.text} />
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: c.bg }]}>
      <StatusBar style={c.scheme === 'dark' ? 'light' : 'dark'} />
      <TelemetryBar
        strategy={settings.strategy}
        state={state}
        latencyMs={latency}
        right={<LanguageFlags size={30} value={settings.uiLang ?? defaultLocale()} onChange={(uiLang) => onSettingsChange({ ...settings, uiLang })} style={{ gap: 6 }} />}
      />
      <SplitScreen
        languages={languages}
        state={state}
        activeSide={activeSide}
        texts={texts}
        level={level}
        autoStop={autoStop}
        handsFree={handsFree}
        layout={layout}
        history={history}
        since={sessionStart.current}
        middle={dock}
      />
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
          <View style={styles.diagBar}>
            <Pressable style={styles.diagClose} onPress={() => setDiag(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('Fermer le journal')}>
              <Text style={styles.diagCloseText}>✕ Fermer</Text>
            </Pressable>
          <Pressable
            style={styles.diagShare}
            onPress={async () => {
              const all = EventLog.all().join('\n');
              const day = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
              try {
                await shareTextFile(`journal-dualcast-${day}`, 'Journal DualCast', all); // a file: a long journal does not fit in a message
              } catch {
                Share.share({ title: 'Journal DualCast', message: EventLog.all().slice(-600).join('\n') }).catch(() => {});
              }
            }}
            hitSlop={10}
            accessibilityRole="button"
          >
            <Text style={styles.diagShareText}>Partager le journal complet</Text>
          </Pressable>
          </View>
          <ScrollView style={styles.diagScroll} nestedScrollEnabled>
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
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = themedStyles((c) => StyleSheet.create({
  flex: { flex: 1 },
  missing: { flex: 1, backgroundColor: c.bg },
  // Between the two zones, in the layout (never over them): mode selector + action row
  dock: { gap: 8, paddingHorizontal: 2 },
  hubRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 14, minHeight: 56 },
  dockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 44 },
  dockBtn: { minWidth: 40, height: 40, borderRadius: 20, paddingHorizontal: 11, backgroundColor: c.glass, borderWidth: StyleSheet.hairlineWidth, borderColor: c.glassBorder, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, ...cardShadow(c) },
  dockRec: { backgroundColor: c.dangerStrong, borderColor: c.dangerStrong },
  dockText: { color: c.text, fontSize: 12.5, fontWeight: '600', fontFamily: 'monospace' },
  dockTextOn: { color: c.onAccent },
  diag: { position: 'absolute', left: 8, right: 8, bottom: 24, maxHeight: '42%', backgroundColor: c.overlayStrong, borderRadius: 8, padding: 8 },
  diagText: { color: c.success, fontFamily: 'Courier', fontSize: 11 },
  // The panel stays under the controls (it used to cover the gear that opens it: no way to close it) and has its own close button.
  diagBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  diagClose: { backgroundColor: c.overlayStrong, borderColor: c.accent, borderWidth: 1, borderRadius: 12, paddingVertical: 6, paddingHorizontal: 12 },
  diagCloseText: { color: c.success, fontSize: 12, fontWeight: '700' },
  diagScroll: { maxHeight: 220 },
  diagShare: { alignSelf: 'flex-end', backgroundColor: c.accent, borderRadius: 12, paddingVertical: 6, paddingHorizontal: 12 },
  diagShareText: { color: c.onAccent, fontSize: 12, fontWeight: '700' },
}));
