import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SafeAreaView, ScrollView, Share, StyleSheet, View } from 'react-native';

import { env } from '../config/env';
import { getLanguage, LANGUAGES } from '../config/languages';
import MeetingStore from '../services/MeetingStore';
import { transcribeRecording } from '../services/meetings/PrerecordedTranscriber';
import { chat, listModels } from '../services/minutes/OpenRouterClient';
import { exportMinutes } from '../services/DocumentExport';
import UsageTracker from '../services/UsageTracker';
import { formatClock, formatTranscript, speakerName, speakersOf, talkShare } from '../utils/diarize';
import { describeError } from '../utils/http';
import { MULTI } from '../utils/meeting';
import { generateMinutes, pickDefaultModel, suggestModels, TEMPLATE_IDS, TEMPLATES } from '../utils/minutes';
import { formatDuration } from '../utils/usage';
import { wavMegabytes } from '../utils/wav';
import { cardShadow, palette, themedStyles } from '../theme';
import Icon from './Icon';
import MinutesBlocks from './MinutesBlocks';
import { Plain as RNText, Text, TextInput } from '../i18n/Text';
import { dateLocale, t } from '../i18n';

const languageLabel = (code) => (code === MULTI ? t('Plusieurs langues') : getLanguage(code).label);

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
  const translated = meeting.source === 'translator'; // made while translating: no audio, each line has its translation
  const transcriptText = (timestamps = true, withTranslation = false) => formatTranscript(meeting.segments, names, { timestamps, withTranslation });
  const dateText = new Date(meeting.createdAt).toLocaleString(dateLocale());

  const refine = () => {
    if (!meeting.audioUri) return Alert.alert(t('Pas d’audio'), t('L’enregistrement audio de cette réunion est introuvable.'));
    const mb = Math.round(wavMegabytes(meeting.durationSec));
    Alert.alert(
      t('Transcription précise'),
      t('L’enregistrement (≈ {mb} Mo) va être envoyé à Deepgram pour une transcription plus fiable, avec une meilleure séparation des intervenants. Utilisez de préférence le Wi-Fi. Les noms d’intervenants déjà saisis seront à resaisir.', { mb }),
      [
        { text: t('Annuler'), style: 'cancel' },
        {
          text: t('Envoyer'),
          onPress: async () => {
            setBusy(t('Envoi et transcription…'));
            setProgress(0);
            try {
              const r = await transcribeRecording(meeting.audioUri, { language: meeting.language, onProgress: setProgress });
              UsageTracker.add({ dgPreSec: meeting.durationSec });
              await update({ ...meeting, segments: r.segments, speakers: {}, source: 'precise' });
            } catch (error) {
              Alert.alert(t('Transcription impossible'), describeError(error));
            }
            setBusy(null);
            setProgress(null);
          },
        },
      ],
    );
  };

  const writeMinutes = async () => {
    if (!meeting.segments.length) return Alert.alert(t('Transcription vide'), t('Il n’y a aucun texte à résumer.'));
    if (!chosenModel) return Alert.alert(t('Modèle'), t('Choisissez un modèle (liste ou identifiant OpenRouter).'));
    setBusy(t('Rédaction du compte rendu…'));
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
      if (result.truncated) Alert.alert(t('Compte rendu peut-être incomplet'), t('Le modèle a atteint sa limite de longueur même après plusieurs reprises. Choisissez un modèle qui écrit plus long ou ajoutez la consigne « sois plus concis ».'));
    } catch (error) {
      Alert.alert(t('Compte rendu impossible'), describeError(error));
    }
    setBusy(null);
  };

  const exportNote = async (kind, n) => {
    setBusy(kind === 'pdf' ? t('Création du PDF…') : t('Création du document Word…'));
    try {
      const lang = n.language ? languageLabel(n.language) : '';
      await exportMinutes(kind, {
        title: meeting.title || 'Compte rendu',
        meta: `${dateText} · ${formatDuration(meeting.durationSec)}${lang ? ` · ${lang}` : ''} · ${TEMPLATES[n.template]?.label ?? n.template}`,
        text: n.text,
      });
    } catch (error) {
      Alert.alert(t('Export impossible'), describeError(error));
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
    Alert.alert(t('Supprimer cette réunion ?'), t('La transcription, les comptes rendus et l’enregistrement audio seront effacés du téléphone.'), [
      { text: t('Annuler'), style: 'cancel' },
      { text: t('Supprimer'), style: 'destructive', onPress: async () => { await MeetingStore.remove(meeting.id); onDeleted(); } },
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
          placeholderTextColor={palette().placeholder}
        />
        <Text style={styles.meta}>
          {`${dateText} · ${formatDuration(meeting.durationSec)} · ${languageLabel(meeting.language)} · ${translated ? t('enregistrée pendant la traduction') : `${t('transcription')} ${meeting.source === 'precise' ? t('précise ✓') : t('en direct (provisoire)')}`}`}
        </Text>
        {!!meeting.liveError && <Text style={styles.warn}>{t('Transcription en direct indisponible : {err}. Lancez la transcription précise.', { err: meeting.liveError })}</Text>}

        {!!busy && (
          <View style={styles.busy}>
            <ActivityIndicator color={palette().text} />
            <Text style={styles.busyText}>{progress != null ? `${busy} ${Math.round(progress * 100)} %` : busy}</Text>
          </View>
        )}

        <View style={styles.actions}>
          <Btn label="📝 Compte rendu" onPress={() => setShowMinutesForm((v) => !v)} disabled={!!busy} primary />
          {!translated && <Btn label="🎯 Transcription précise" onPress={refine} disabled={!!busy} />}
          <Btn label="Partager le texte" onPress={() => Share.share({ title: meeting.title, message: `${meeting.title}\n${dateText}\n\n${transcriptText(true, translated)}` }).catch(() => {})} disabled={!meeting.segments.length} />
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
              placeholder={template === 'libre' ? t('Décrivez ce que vous voulez obtenir') : t('ex. insister sur le budget ; noms des clients en gras')}
              placeholderTextColor={palette().placeholder}
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
              placeholder={chosenModel ? t('par défaut : {model}', { model: chosenModel }) : 'ex. anthropic/claude-sonnet-4.5'}
              placeholderTextColor={palette().placeholder}
            />
            <Text style={styles.hint}>
              Le texte de la transcription est envoyé à OpenRouter puis au fournisseur du modèle choisi. Le coût réel est affiché dans 📊.
            </Text>
            <Btn label={busy ? t('Rédaction en cours…') : t('Générer')} onPress={writeMinutes} disabled={!!busy || !hasKey} primary />
          </View>
        )}

        {meeting.minutes.map((n, idx) => (
          <View key={n.id} style={styles.noteWrap}>
            <View style={styles.noteHead}>
              <View style={styles.noteHeadText}>
                <Text style={styles.cardTitle}>{`${t('Compte rendu')} — ${n.language ? languageLabel(n.language) : ''} · ${t(TEMPLATES[n.template]?.label ?? n.template)}`}</Text>
                <Text style={styles.metaSmall}>{`${new Date(n.createdAt).toLocaleString(dateLocale())} · ${n.model}${idx === 0 ? ` · ${t('exporté par la barre du bas')}` : ''}`}</Text>
              </View>
              <Pressable
                onPress={() =>
                  Alert.alert(t('Supprimer ce compte rendu ?'), t('Seul ce compte rendu est effacé, pas la transcription.'), [
                    { text: t('Annuler'), style: 'cancel' },
                    { text: t('Supprimer'), style: 'destructive', onPress: () => update({ ...meeting, minutes: meeting.minutes.filter((m) => m.id !== n.id) }) },
                  ])
                }
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={t('Supprimer ce compte rendu ?')}
                style={styles.noteDelete}
              >
                <Icon name="trash" size={17} color={palette().textFaint} />
              </Pressable>
            </View>
            <MinutesBlocks text={n.text} />
          </View>
        ))}

        {speakersOf(meeting.segments).length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Intervenants</Text>
            <Text style={styles.hint}>Donnez-leur un nom : il apparaîtra dans la transcription et dans les comptes rendus.</Text>
            {speakersOf(meeting.segments).map((id) => {
              const share = shares.find((s) => s.speaker === id)?.share ?? 0;
              return (
                <View key={id} style={styles.speakerBlock}>
                  <View style={styles.speakerRow}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      defaultValue={names[id] ?? ''}
                      placeholder={speakerName({}, id)}
                      placeholderTextColor={palette().placeholder}
                      onEndEditing={(e) => rename(id, e.nativeEvent.text)}
                    />
                    <RNText style={styles.speakerShare}>{`${Math.round(share * 100)} %`}</RNText>
                  </View>
                  <View style={styles.shareTrack}>
                    <View style={[styles.shareFill, { width: `${Math.max(2, Math.round(share * 100))}%` }]} />
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <Text style={styles.section}>Transcription</Text>
        {meeting.segments.length === 0 && <Text style={styles.hint}>{translated ? t('Aucun texte.') : t('Aucun texte. Lancez la transcription précise pour transcrire l’enregistrement.')}</Text>}
        {meeting.segments.map((s, i) => (
          <View key={i} style={styles.segment}>
            <Text style={styles.segHead}>{`${formatClock(s.start)} · ${speakerName(names, s.speaker)}`}</Text>
            <RNText style={styles.segText} selectable>
              {s.text}
            </RNText>
            {!!s.translated && (
              <Text style={styles.segTrans} selectable>
                {`→ ${s.translated}`}
              </Text>
            )}
          </View>
        ))}
      </ScrollView>
      {/* Sticky action bar: what to do with the latest minutes (or the transcript). Deleting is elsewhere, on purpose. */}
      <View style={styles.bar}>
        {meeting.minutes[0] ? (
          <>
            <BarBtn icon="share" label="Partager" onPress={() => Share.share({ title: meeting.title, message: meeting.minutes[0].text }).catch(() => {})} />
            <BarBtn icon="notes" label="PDF" onPress={() => exportNote('pdf', meeting.minutes[0])} disabled={!!busy} />
            <BarBtn icon="notes" label="Word" onPress={() => exportNote('docx', meeting.minutes[0])} disabled={!!busy} />
          </>
        ) : (
          <>
            <BarBtn icon="share" label="Partager le texte" onPress={() => Share.share({ title: meeting.title, message: `${meeting.title}\n${dateText}\n\n${transcriptText(true, translated)}` }).catch(() => {})} disabled={!meeting.segments.length} />
            <BarBtn icon="sparkles" label="Compte rendu" onPress={() => setShowMinutesForm(true)} disabled={!!busy} primary />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function BarBtn({ icon, label, onPress, disabled, primary }) {
  const c = palette();
  return (
    <Pressable style={[styles.barBtn, primary && styles.barBtnPrimary, disabled && styles.off]} onPress={onPress} disabled={disabled} accessibilityRole="button">
      <Icon name={icon} size={17} color={primary ? c.onAccent : c.text} />
      <Text style={[styles.barText, primary && styles.barTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Btn({ label, onPress, disabled, primary, danger }) {
  return (
    <Pressable style={[styles.btn, primary && styles.btnPrimary, danger && styles.btnDanger, disabled && styles.off]} onPress={onPress} disabled={disabled} accessibilityRole="button">
      <Text style={[styles.btnText, primary && styles.btnTextOnAccent]}>{label}</Text>
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

const styles = themedStyles((c) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, paddingTop: 40 },
  link: { color: c.link, fontSize: 16 },
  danger: { color: c.danger, fontSize: 16 },
  content: { padding: 16, paddingTop: 0, paddingBottom: 60 },
  title: { color: c.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.6, paddingVertical: 4 },
  meta: { color: c.textMuted, fontSize: 13, marginBottom: 8 },
  metaSmall: { color: c.textFaint, fontSize: 12, marginBottom: 8 },
  warn: { color: c.warn, fontSize: 14, marginVertical: 8 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 14, marginVertical: 8 },
  busyText: { color: c.text, fontSize: 15 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 10 },
  btn: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14 },
  btnPrimary: { backgroundColor: c.accent },
  btnDanger: { backgroundColor: c.dangerBg },
  btnTextOnAccent: { color: c.onAccent },
  btnText: { color: c.text, fontSize: 15, fontWeight: '600' },
  off: { opacity: 0.4 },
  card: { backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, borderRadius: 18, padding: 16, marginBottom: 12, ...cardShadow(c) },
  noteWrap: { marginBottom: 16, gap: 10 },
  noteHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  noteHeadText: { flex: 1 },
  noteDelete: { padding: 6 },
  speakerBlock: { marginTop: 10, gap: 6 },
  shareTrack: { height: 4, borderRadius: 2, backgroundColor: c.track, overflow: 'hidden' },
  shareFill: { height: 4, borderRadius: 2, backgroundColor: c.accent },
  bar: { flexDirection: 'row', gap: 10, padding: 12, paddingBottom: 18, backgroundColor: c.glass, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  barBtn: { flex: 1, height: 46, borderRadius: 23, backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  barBtnPrimary: { backgroundColor: c.accent, borderColor: c.accent },
  barText: { color: c.text, fontSize: 14.5, fontWeight: '600' },
  barTextOn: { color: c.onAccent },
  cardTitle: { color: c.text, fontSize: 16, fontWeight: '700', marginBottom: 6 },
  label: { color: c.textSoft, fontSize: 14, marginTop: 12, marginBottom: 6 },
  hint: { color: c.textMuted, fontSize: 13, marginVertical: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: c.bg, borderRadius: 18, paddingVertical: 8, paddingHorizontal: 12 },
  chipOn: { backgroundColor: c.chipOn, borderColor: c.accent },
  chipText: { color: c.text, fontSize: 14 },
  input: { backgroundColor: c.bg, color: c.text, borderRadius: 10, padding: 12, fontSize: 15, marginTop: 6 },
  minutes: { color: c.textBody, fontSize: 15, lineHeight: 22 },
  speakerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  speakerShare: { color: c.textSoft, minWidth: 44, textAlign: 'right', fontSize: 13, fontFamily: 'monospace' },
  section: { color: c.text, fontSize: 18, fontWeight: '700', marginTop: 12, marginBottom: 8 },
  segment: { marginBottom: 10 },
  segHead: { color: c.link, fontSize: 12, fontWeight: '600' },
  segText: { color: c.textBody, fontSize: 15, lineHeight: 21 },
  segTrans: { color: c.textMuted, fontSize: 14, lineHeight: 20, fontStyle: 'italic' },
}));
