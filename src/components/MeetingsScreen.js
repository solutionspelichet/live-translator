import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { LANGUAGES } from '../config/languages';
import MeetingStore from '../services/MeetingStore';
import MeetingRecorder from '../services/meetings/MeetingRecorder';
import UsageTracker from '../services/UsageTracker';
import { formatClock, speakerName } from '../utils/diarize';
import { describeError } from '../utils/http';
import { defaultTitle, MULTI } from '../utils/meeting';
import { formatDuration } from '../utils/usage';
import { wavMegabytes } from '../utils/wav';
import MeetingDetail from './MeetingDetail';

const langName = (code) => (code === MULTI ? 'Plusieurs langues' : LANGUAGES[code]?.label ?? code);

/**
 * Meetings: list of recordings, a form to start a new one (title, language, consent reminder), the live recording
 * view, and the detail of a saved meeting (see MeetingDetail).
 */
export default function MeetingsScreen({ settings, onSettingsChange, onClose }) {
  const [view, setView] = useState('list'); // list | new | record | detail
  const [meetings, setMeetings] = useState([]);
  const [current, setCurrent] = useState(null);

  const refresh = useCallback(() => MeetingStore.list().then(setMeetings), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const open = async (id) => {
    const meeting = await MeetingStore.load(id);
    if (!meeting) return Alert.alert('Réunion introuvable', 'Cette réunion ne peut plus être lue.');
    setCurrent(meeting);
    setView('detail');
  };

  if (view === 'detail' && current) {
    return (
      <MeetingDetail
        key={current.id}
        meeting={current}
        settings={settings}
        onSettingsChange={onSettingsChange}
        onBack={() => {
          refresh();
          setView('list');
        }}
        onDeleted={() => {
          refresh();
          setView('list');
        }}
      />
    );
  }
  if (view === 'new') {
    return (
      <NewMeeting
        settings={settings}
        onCancel={() => setView('list')}
        onStarted={(recorder) => {
          setCurrent(recorder);
          setView('record');
        }}
      />
    );
  }
  if (view === 'record' && current) {
    return (
      <Recording
        recorder={current}
        onSaved={async (meeting) => {
          await MeetingStore.save(meeting);
          refresh();
          setCurrent(meeting);
          setView('detail');
        }}
        onDiscarded={() => {
          refresh();
          setView('list');
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Réunions</Text>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
          <Text style={styles.link}>Fermer</Text>
        </Pressable>
      </View>
      <Pressable style={styles.start} onPress={() => setView('new')} accessibilityRole="button">
        <Text style={styles.startText}>● Nouvelle réunion (sans traduction)</Text>
      </Pressable>
      <Text style={styles.tip}>
        Pour transcrire la réunion PENDANT la traduction, touchez « ⏺ Réunion » sur l'écran principal : chaque phrase traduite est gardée ici,
        avec qui a parlé et sa traduction.
      </Text>
      <FlatList
        data={meetings}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Aucune réunion. Enregistrez-en une : transcription par intervenant, puis compte rendu rédigé dans la langue de votre choix.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.item} onPress={() => open(item.id)} accessibilityRole="button">
            <Text style={styles.itemTitle}>{item.title}</Text>
            <Text style={styles.itemMeta}>
              {`${new Date(item.createdAt).toLocaleString('fr-FR')} · ${formatDuration(item.durationSec)} · ${item.source === 'translator' ? 'traduction' : langName(item.language)}${item.hasMinutes ? ' · compte rendu ✓' : ''}`}
            </Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

function NewMeeting({ settings, onCancel, onStarted }) {
  const [title, setTitle] = useState(defaultTitle());
  const [language, setLanguage] = useState(MULTI);
  const [consent, setConsent] = useState(false);
  const [starting, setStarting] = useState(false);

  const start = async () => {
    setStarting(true);
    const recorder = new MeetingRecorder({
      language,
      title: title.trim() || defaultTitle(),
      settings,
      onUpdate: () => {},
      onUsage: (delta) => UsageTracker.add(delta),
    });
    try {
      await recorder.start();
      onStarted(recorder);
    } catch (error) {
      await recorder.discard();
      setStarting(false);
      Alert.alert('Enregistrement impossible', describeError(error));
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Nouvelle réunion</Text>
        <Pressable onPress={onCancel} hitSlop={12} accessibilityRole="button">
          <Text style={styles.link}>Annuler</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Titre</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholderTextColor="#55607F" />
        <Text style={styles.label}>Langue parlée</Text>
        <View style={styles.chips}>
          <Chip label="🌐 Plusieurs langues" on={language === MULTI} onPress={() => setLanguage(MULTI)} />
          {Object.entries(LANGUAGES).map(([code, l]) => (
            <Chip key={code} label={`${l.flag} ${l.label}`} on={language === code} onPress={() => setLanguage(code)} />
          ))}
        </View>
        <Text style={styles.hint}>
          « Plusieurs langues » suit les changements de langue pendant la réunion (anglais, espagnol, français, allemand, hindi, russe, portugais,
          japonais, italien, néerlandais). Pour une seule langue, choisissez-la : c'est plus précis.
        </Text>
        <Pressable style={[styles.consent, consent && styles.consentOn]} onPress={() => setConsent((c) => !c)} accessibilityRole="checkbox" accessibilityState={{ checked: consent }}>
          <Text style={styles.consentText}>{consent ? '☑' : '☐'}  J'ai prévenu les participants que la réunion est enregistrée et transcrite.</Text>
        </Pressable>
        <Text style={styles.hint}>
          L'audio est gardé sur ce téléphone. Le son est envoyé à Deepgram pour la transcription, et le texte à OpenRouter si vous demandez un
          compte rendu. Posez le téléphone au centre de la table, micro dégagé. L'écran peut s'éteindre : l'enregistrement continue.
        </Text>
        <Pressable style={[styles.start, (!consent || starting) && styles.off]} disabled={!consent || starting} onPress={start} accessibilityRole="button">
          <Text style={styles.startText}>{starting ? 'Démarrage…' : '● Démarrer l’enregistrement'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Recording({ recorder, onSaved, onDiscarded }) {
  const [state, setState] = useState(recorder.state());
  const [saving, setSaving] = useState(false);
  const scroll = useRef(null);

  useEffect(() => {
    recorder.onUpdate = setState;
    const t = setInterval(() => setState(recorder.state()), 1000); // keeps the clock running through silences
    return () => {
      clearInterval(t);
      recorder.onUpdate = null;
    };
  }, [recorder]);

  const stop = async () => {
    setSaving(true);
    try {
      onSaved(await recorder.stop());
    } catch (error) {
      setSaving(false);
      Alert.alert('Erreur', describeError(error));
    }
  };

  const cancel = () =>
    Alert.alert('Abandonner cet enregistrement ?', 'Tout ce qui a été enregistré sera effacé.', [
      { text: 'Continuer', style: 'cancel' },
      { text: 'Abandonner', style: 'destructive', onPress: async () => { await recorder.discard(); onDiscarded(); } },
    ]);

  const recent = state.segments.slice(-14);
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {recorder.title}
        </Text>
        <Pressable onPress={cancel} hitSlop={12} accessibilityRole="button" disabled={saving}>
          <Text style={styles.danger}>Abandonner</Text>
        </Pressable>
      </View>
      <View style={styles.rec}>
        <View style={styles.dot} />
        <Text style={styles.clock}>{formatClock(state.elapsedSec)}</Text>
        <View style={styles.meterTrack}>
          <View style={[styles.meterFill, { width: `${Math.round(state.level * 100)}%` }]} />
        </View>
      </View>
      <Text style={styles.meta}>
        {`≈ ${Math.round(wavMegabytes(state.elapsedSec))} Mo · transcription en direct : ${state.liveError ? 'indisponible' : state.liveStatus}`}
      </Text>
      {!!state.liveError && <Text style={styles.warn}>{`${state.liveError} — l'enregistrement continue ; transcrivez-le ensuite avec « Transcription précise ».`}</Text>}
      {!!state.writeError && <Text style={styles.warn}>{`Écriture de l'audio impossible : ${state.writeError}. Libérez de l'espace.`}</Text>}
      <ScrollView ref={scroll} style={styles.live} contentContainerStyle={{ padding: 16 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
        {recent.map((s, i) => (
          <View key={i} style={{ marginBottom: 10 }}>
            <Text style={styles.segHead}>{`${formatClock(s.start)} · ${speakerName({}, s.speaker)}`}</Text>
            <Text style={styles.segText}>{s.text}</Text>
          </View>
        ))}
        {!!state.interim && <Text style={[styles.segText, styles.interim]}>{state.interim}</Text>}
        {!recent.length && !state.interim && <Text style={styles.hint}>Parlez : le texte apparaît ici (provisoire, les intervenants sont affinés à la fin).</Text>}
      </ScrollView>
      <Pressable style={[styles.stop, saving && styles.off]} onPress={stop} disabled={saving} accessibilityRole="button">
        <Text style={styles.startText}>{saving ? 'Enregistrement du fichier…' : '■ Terminer et enregistrer'}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

function Chip({ label, on, onPress }) {
  return (
    <Pressable style={[styles.chip, on && styles.chipOn]} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0F1A' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, paddingTop: 40 },
  title: { flex: 1, color: '#fff', fontSize: 24, fontWeight: '700' },
  link: { color: '#6FA0FF', fontSize: 16 },
  danger: { color: '#FF8A80', fontSize: 16 },
  start: { backgroundColor: '#2F6FED', borderRadius: 14, padding: 16, alignItems: 'center', marginHorizontal: 16, marginVertical: 8 },
  stop: { backgroundColor: '#C0392B', borderRadius: 14, padding: 18, alignItems: 'center', margin: 16 },
  startText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  off: { opacity: 0.4 },
  list: { padding: 16 },
  empty: { color: '#9AA6C4', fontSize: 15, margin: 16 },
  tip: { color: '#9AA6C4', fontSize: 13, marginHorizontal: 20, marginBottom: 4 },
  item: { backgroundColor: '#16233B', borderRadius: 12, padding: 14, marginBottom: 10 },
  itemTitle: { color: '#fff', fontSize: 17, fontWeight: '600' },
  itemMeta: { color: '#9AA6C4', fontSize: 13, marginTop: 4 },
  form: { padding: 16, paddingBottom: 60 },
  label: { color: '#C9D2EA', fontSize: 14, marginTop: 16, marginBottom: 6 },
  input: { backgroundColor: '#16233B', color: '#fff', borderRadius: 10, padding: 14, fontSize: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: '#16233B', borderRadius: 18, paddingVertical: 9, paddingHorizontal: 13 },
  chipOn: { backgroundColor: '#2F6FED' },
  chipText: { color: '#fff', fontSize: 14 },
  hint: { color: '#9AA6C4', fontSize: 13, marginVertical: 10 },
  consent: { backgroundColor: '#16233B', borderRadius: 12, padding: 14, marginTop: 14 },
  consentOn: { backgroundColor: '#1F4E3A' },
  consentText: { color: '#fff', fontSize: 15 },
  rec: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20 },
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#FF3B30' },
  clock: { color: '#fff', fontSize: 34, fontWeight: '700', fontVariant: ['tabular-nums'] },
  meterTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF22', overflow: 'hidden' },
  meterFill: { height: 8, backgroundColor: '#7CE0A3' },
  meta: { color: '#9AA6C4', fontSize: 13, paddingHorizontal: 20, marginTop: 6 },
  warn: { color: '#FFC46B', fontSize: 14, paddingHorizontal: 20, marginTop: 6 },
  live: { flex: 1, backgroundColor: '#101A2E', marginTop: 10 },
  segHead: { color: '#6FA0FF', fontSize: 12, fontWeight: '600' },
  segText: { color: '#E8ECF8', fontSize: 16, lineHeight: 22 },
  interim: { color: '#9AA6C4', fontStyle: 'italic' },
});
