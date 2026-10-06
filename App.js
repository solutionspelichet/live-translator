import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { Alert, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import SplitScreen from './src/components/SplitScreen';
import { missingEnv } from './src/config/env';
import { SIDE } from './src/config/languages';
import audio from './src/services/AudioRoutingService';
import createEngine from './src/services/createEngine';
import { STATE } from './src/services/TranslationEngine';

// Language bound to each side of the phone AND each ear: A = left earbud, B = right earbud.
const LANGUAGES = { [SIDE.A]: 'fr', [SIDE.B]: 'en' };

export default function App() {
  useKeepAwake();
  const missing = missingEnv();
  if (missing.length) return <MissingEnv names={missing} />;
  return <Translator />;
}

function Translator() {
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
    </View>
  );
}

function MissingEnv({ names }) {
  return (
    <SafeAreaView style={styles.missing}>
      <Text style={styles.title}>Clés API manquantes</Text>
      <Text style={styles.body}>Copiez .env.example vers .env, renseignez :</Text>
      {names.map((n) => (
        <Text key={n} style={styles.code}>{n}</Text>
      ))}
      <Text style={styles.body}>puis relancez : npx expo start -c</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  missing: { flex: 1, backgroundColor: '#0B0F1A', padding: 24, justifyContent: 'center' },
  title: { color: '#fff', fontSize: 24, fontWeight: '700', marginBottom: 12 },
  body: { color: '#9AA6C4', fontSize: 16, marginVertical: 8 },
  code: { color: '#7CE0A3', fontFamily: 'Courier', fontSize: 14 },
});
