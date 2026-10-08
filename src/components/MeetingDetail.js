import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SafeAreaView, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { env } from '../config/env';
import { getLanguage, LANGUAGES } from '../config/languages';
import MeetingStore from '../services/MeetingStore';
import { transcribeRecording } from '../services/meetings/PrerecordedTranscriber';
import { chat, listModels } from '../services/minutes/OpenRouterClient';
import UsageTracker from '../services/UsageTracker';
import { formatClock, formatTranscript, speakerName, speakersOf, talkShare } from '../utils/diarize';
import { describeError } from '../utils/http';
import { MULTI } from '../utils/meeting';
import { generateMinutes, pickDefaultModel, suggestModels, TEMPLATE_IDS, TEMPLATES } from '../utils/minutes';
import { formatDuration } from '../utils/usage';
import { wavMegabytes } from '../utils/wav';

const languageLabel = (code) => (code === MULTI ? 'Plusieurs langues' : getLanguage(code).label);

/**
 * One saved meeting: transcript by speaker (rename the speakers), more accurate second pass, minutes written by a
 * model through OpenRouter in the language chosen here, and sharing.
 */
export default function MeetingDetail({ meeting: initial, settings, onSettingsChange, onBack, onDeleted }) {
  const [meeting, setMeeting] = useState(initial);
  const [busy, setBusy] = useState(null); // text of the running job
  const [progress, setProgress] = useState(null);
  const [models, setModels] = useState([]);
  const [showMinutesForm, setShowMinutesForm] = useState(false);
  const [language, setLanguage] = useState(settings.minutesLanguage);
  const [template, setTemplate] = useState(settings.minutesTemplate);
  const [model, setModel] = useState(settings.minutesModel);
  const [extra, setExtra] = useState('');
  const hasKey = Boolean(env.openRouterKey);

  const update = async (next) => {
    setMeeting(next);
    await MeetingStore.save(next).catch(() => {});
  };

  useEffect(() => {
    if (hasKey) listModels().then(setModels).catch(() => {});
  }, [hasKey]);
  const suggestions = useMemo(() => suggestModels(models), [models]);
  const chosenModel = model || pickDefaultModel(models) || '';

  const names = meeting.speakers;
  const shares = useMemo(() => talkShare(meeting.segments), [meeting.segments]);
  const transcriptText = (timestamps = true) => formatTranscript(meeting.segments, names, { timestamps });
  const dateText = new Date(meeting.createdAt).toLocaleString('fr-FR');

  const refine = () => {
    if (!meeting.audioUri) return Alert.alert('Pas d’audio', 'L’enregistrement audio de cette réunion est introuvable.');
    const mb = Math.round(wavMegabytes(meeting.durationSec));
    Alert.alert(
      'Transcription précise',
      `L’enregistrement (≈ ${mb} Mo) va être envoyé à Deepgram pour une transcription plus fiable, avec une meilleure séparation des intervenants. Utilisez de préférence le Wi-Fi. Les noms d’intervenants déjà saisis seront à resaisir.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Envoyer',
          onPress: async () => {
            setBusy('Envoi et transcription…');
            setProgress(0);
            try {
              const r = await transcribeRecording(meeting.audioUri, { language: meeting.language, onProgress: setProgress });
              UsageTracker.add({ dgPreSec: meeting.durationSec });
              await update({ ...meeting, segments: r.segments, speakers: {}, source: 'precise' });
            } catch (error) {
              Alert.alert('Transcription impossible', describeError(error));
            }
            setBusy(null);
            setProgress(null);
          },
        },
      ],
    );
  };

  const writeMinutes = async () => {
    if (!meeting.segments.length) return Alert.alert('Transcription vide', 'Il n’y a aucun texte à résumer.');
    if (!chosenModel) return Alert.alert('Modèle', 'Choisissez un modèle (liste ou identifiant OpenRouter).');
    setBusy('Rédaction du compte rendu…');
    try {
      const lang = getLanguage(language);
      const result = await generateMinutes({
        chat,
        model: chosenModel,
        transcript: transcriptText(true),
        language: `${lang.label} (${language})`,
        templateId: template,
        title: meeting.title,
        dateText,
        durationText: formatDuration(meeting.durationSec),
        extra,
        onProgress: setBusy,
      });
      UsageTracker.add({ orTokens: result.usage.promptTokens + result.usage.completionTokens, orCostUsd: result.usage.cost });
      const note = { id: `n${Date.now().toString(36)}`, createdAt: Date.now(), language, template, model: chosenModel, text: result.text };
      await update({ ...meeting, minutes: [note, ...meeting.minutes] });
      onSettingsChange({ ...settings, minutesLanguage: language, minutesTemplate: template, minutesModel: model });
      setShowMinutesForm(false);
    } catch (error) {
      Alert.alert('Compte rendu impossible', describeError(error));
    }
    setBusy(null);
  };

  const rename = (id, name) => {
    const speakers = { ...names };
    if (name.trim()) speakers[id] = name.trim();
    else delete speakers[id];
    update({ ...meeting, speakers });
  };

  const confirmDelete = () =>
    Alert.alert('Supprimer cette réunion ?', 'La transcription, les comptes rendus et l’enregistrement audio seront effacés du téléphone.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => { await MeetingStore.remove(meeting.id); onDeleted(); } },
    ]);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button">
          <Text style={styles.link}>‹ Réunions</Text>
        </Pressable>
        <Pressable onPress={confirmDelete} hitSlop={12} accessibilityRole="button">
          <Text style={styles.danger}>Supprimer</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.title}
          value={meeting.title}
          onChangeText={(t) => setMeeting({ ...meeting, title: t })}
          onEndEditing={() => update(meeting)}
          placeholderTextColor="#55607F"
        />
        <Text style={styles.meta}>
          {`${dateText} · ${formatDuration(meeting.durationSec)} · ${languageLabel(meeting.language)} · transcription ${meeting.source === 'precise' ? 'précise ✓' : 'en direct (provisoire)'}`}
        </Text>
        {!!meeting.liveError && <Text style={styles.warn}>{`Transcription en direct indisponible : ${meeting.liveError}. Lancez la transcription précise.`}</Text>}

        {!!busy && (
          <View style={styles.busy}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.busyText}>{progress != null ? `${busy} ${Math.round(progress * 100)} %` : busy}</Text>
          </View>
        )}

        <View style={styles.actions}>
          <Btn label="📝 Compte rendu" onPress={() => setShowMinutesForm((v) => !v)} disabled={!!busy} primary />
          <Btn label="🎯 Transcription précise" onPress={refine} disabled={!!busy} />
          <Btn label="Partager le texte" onPress={() => Share.share({ title: meeting.title, message: `${meeting.title}\n${dateText}\n\n${transcriptText(true)}` }).catch(() => {})} disabled={!meeting.segments.length} />
        </View>

        {showMinutesForm && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Rédiger le compte rendu</Text>
            {!hasKey && <Text style={styles.warn}>Ajoutez votre clé OpenRouter dans ⚙︎ → Clés API pour activer cette fonction.</Text>}
            <Text style={styles.label}>Langue du compte rendu</Text>
            <View style={styles.chips}>
              {Object.entries(LANGUAGES).map(([code, l]) => (
                <Chip key={code} label={`${l.flag} ${l.label}`} on={language === code} onPress={() => setLanguage(code)} />
              ))}
            </View>
            <Text style={styles.label}>Type de compte rendu</Text>
            <View style={styles.chips}>
              {TEMPLATE_IDS.map((id) => (
                <Chip key={id} label={TEMPLATES[id].label} on={template === id} onPress={() => setTemplate(id)} />
              ))}
            </View>
            <Text style={styles.label}>Consignes supplémentaires (facultatif)</Text>
            <TextInput
              style={styles.input}
              value={extra}
              onChangeText={setExtra}
              multiline
              placeholder={template === 'libre' ? 'Décrivez ce que vous voulez obtenir' : 'ex. insister sur le budget ; noms des clients en gras'}
              placeholderTextColor="#55607F"
            />
            <Text style={styles.label}>Modèle OpenRouter</Text>
            <View style={styles.chips}>
              {suggestions.map((m) => (
                <Chip key={m.id} label={m.label} on={chosenModel === m.id} onPress={() => setModel(m.id)} />
              ))}
            </View>
            <TextInput
              style={styles.input}
              value={model}
              onChangeText={setModel}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={chosenModel ? `par défaut : ${chosenModel}` : 'ex. anthropic/claude-sonnet-4.5'}
              placeholderTextColor="#55607F"
            />
            <Text style={styles.hint}>
              Le texte de la transcription est envoyé à OpenRouter puis au fournisseur du modèle choisi. Le coût réel est affiché dans 📊.
            </Text>
            <Btn label={busy ? 'Rédaction en cours…' : 'Générer'} onPress={writeMinutes} disabled={!!busy || !hasKey} primary />
          </View>
        )}

        {meeting.minutes.map((n) => (
          <View key={n.id} style={styles.card}>
            <Text style={styles.cardTitle}>{`Compte rendu — ${n.language ? languageLabel(n.language) : ''} · ${TEMPLATES[n.template]?.label ?? n.template}`}</Text>
            <Text style={styles.metaSmall}>{`${new Date(n.createdAt).toLocaleString('fr-FR')} · ${n.model}`}</Text>
            <Text style={styles.minutes} selectable>
              {n.text}
            </Text>
            <View style={styles.actions}>
              <Btn label="Partager" onPress={() => Share.share({ title: meeting.title, message: n.text }).catch(() => {})} />
              <Btn
                label="Supprimer"
                danger
                onPress={() => update({ ...meeting, minutes: meeting.minutes.filter((m) => m.id !== n.id) })}
              />
            </View>
          </View>
        ))}

        {speakersOf(meeting.segments).length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Intervenants</Text>
            <Text style={styles.hint}>Donnez-leur un nom : il apparaîtra dans la transcription et dans les comptes rendus.</Text>
            {speakersOf(meeting.segments).map((id) => (
              <View key={id} style={styles.speakerRow}>
                <Text style={styles.speakerShare}>{`${Math.round((shares.find((s) => s.speaker === id)?.share ?? 0) * 100)} %`}</Text>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  defaultValue={names[id] ?? ''}
                  placeholder={speakerName({}, id)}
                  placeholderTextColor="#55607F"
                  onEndEditing={(e) => rename(id, e.nativeEvent.text)}
                />
              </View>
            ))}
          </View>
        )}

        <Text style={styles.section}>Transcription</Text>
        {meeting.segments.length === 0 && <Text style={styles.hint}>Aucun texte. Lancez la transcription précise pour transcrire l’enregistrement.</Text>}
        {meeting.segments.map((s, i) => (
          <View key={i} style={styles.segment}>
            <Text style={styles.segHead}>{`${formatClock(s.start)} · ${speakerName(names, s.speaker)}`}</Text>
            <Text style={styles.segText} selectable>
              {s.text}
            </Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function Btn({ label, onPress, disabled, primary, danger }) {
  return (
    <Pressable style={[styles.btn, primary && styles.btnPrimary, danger && styles.btnDanger, disabled && styles.off]} onPress={onPress} disabled={disabled} accessibilityRole="button">
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
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
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, paddingTop: 40 },
  link: { color: '#6FA0FF', fontSize: 16 },
  danger: { color: '#FF8A80', fontSize: 16 },
  content: { padding: 16, paddingTop: 0, paddingBottom: 60 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', paddingVertical: 4 },
  meta: { color: '#9AA6C4', fontSize: 13, marginBottom: 8 },
  metaSmall: { color: '#7C89AA', fontSize: 12, marginBottom: 8 },
  warn: { color: '#FFC46B', fontSize: 14, marginVertical: 8 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#16233B', borderRadius: 12, padding: 14, marginVertical: 8 },
  busyText: { color: '#fff', fontSize: 15 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 10 },
  btn: { backgroundColor: '#16233B', borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14 },
  btnPrimary: { backgroundColor: '#2F6FED' },
  btnDanger: { backgroundColor: '#3A1B1B' },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  off: { opacity: 0.4 },
  card: { backgroundColor: '#16233B', borderRadius: 12, padding: 14, marginBottom: 12 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 6 },
  label: { color: '#C9D2EA', fontSize: 14, marginTop: 12, marginBottom: 6 },
  hint: { color: '#9AA6C4', fontSize: 13, marginVertical: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: '#0B0F1A', borderRadius: 18, paddingVertical: 8, paddingHorizontal: 12 },
  chipOn: { backgroundColor: '#2F6FED' },
  chipText: { color: '#fff', fontSize: 14 },
  input: { backgroundColor: '#0B0F1A', color: '#fff', borderRadius: 10, padding: 12, fontSize: 15, marginTop: 6 },
  minutes: { color: '#E8ECF8', fontSize: 15, lineHeight: 22 },
  speakerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  speakerShare: { color: '#9AA6C4', width: 44, fontSize: 13 },
  section: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 12, marginBottom: 8 },
  segment: { marginBottom: 10 },
  segHead: { color: '#6FA0FF', fontSize: 12, fontWeight: '600' },
  segText: { color: '#E8ECF8', fontSize: 15, lineHeight: 21 },
});
