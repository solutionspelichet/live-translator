import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import SplitScreen from './src/components/SplitScreen';
import SetupScreen from './src/components/SetupScreen';
import { loadStoredKeys, missingEnv } from './src/config/env';
import { SIDE } from './src/config/languages';
import audio from './src/services/AudioRoutingService';
import createEngine from './src/services/createEngine';
import { STATE } from './src/services/TranslationEngine';

// Language bound to each side of the phone AND each ear: A = left earbud, B = right earbud.
const LANGUAGES = { [SIDE.A]: 'fr', [SIDE.B]: 'en' };

export default function App() {
  useKeepAwake();
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  // Bumped after saving so the engine is rebuilt with the new keys.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    loadStoredKeys().finally(() => setReady(true));
  }, []);

  if (!ready) return <View style={styles.missing} />;
  if (editing || missingEnv().length) {
    return (
      <SetupScreen
        onDone={() => {
          setVersion((v) => v + 1);
          setEditing(false);
        }}
      />
    );
  }
  return <Translator key={version} onOpenSettings={() => setEditing(true)} />;
}

function Translator({ onOpenSettings }) {
  const engine = useMemo(() => createEngine(LANGUAGES), []);
  const [state, setState] = useState(STATE.IDLE);
  const [activeSide, setActiveSide] = useState(null);
  const [texts, setTexts] = useState({ [SIDE.A]: '', [SIDE.B]: '' });

  useEffect(() => {
    audio
      .init()
      .then(() => audio.hasHeadphones())
      .then((ok) => ok || Alert.alert('Écouteurs requis', 'Connectez les écouteurs Bluetooth : sans eux, la voix sortira du haut-parleur sur les deux canaux.'))
      .catch((e) => Alert.alert('Audio', String(e.message ?? e)));

    const off = engine.subscribe((ev) => {
      if (ev.type === 'state') setState(ev.state);
      else if (ev.type === 'interim' || ev.type === 'transcript' || ev.type === 'translation') {
        setTexts((t) => ({ ...t, [ev.side]: ev.text }));
      } else if (ev.type === 'error') Alert.alert('Erreur', String(ev.error?.message ?? ev.error));
    });
    return () => {
      off();
      engine.cancel();
      audio.dispose();
    };
  }, [engine]);

  return (
    <View style={styles.flex}>
      <StatusBar style="light" />
      <SplitScreen
        languages={LANGUAGES}
        state={state}
        activeSide={activeSide}
        texts={texts}
        onPressIn={(side) => {
          setActiveSide(side);
          setTexts({ [SIDE.A]: '', [SIDE.B]: '' });
          engine.startTurn(side);
        }}
        onPressOut={() => engine.endTurn()}
      />
      <Pressable style={styles.gear} onPress={onOpenSettings} hitSlop={16} accessibilityLabel="Réglages">
        <Text style={styles.gearText}>⚙︎</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  missing: { flex: 1, backgroundColor: '#0B0F1A' },
  gear: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    marginTop: -20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#000C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearText: { color: '#fff', fontSize: 20 },
});
