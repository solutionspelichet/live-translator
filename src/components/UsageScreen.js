import { useEffect, useState } from 'react';
import { Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { env } from '../config/env';
import { PRICE_KEYS } from '../config/settingsModel';
import { fetchQuotas } from '../utils/keyTest';
import { DEFAULT_PRICES, deepgramSeconds, estimateCost, formatCount, formatDuration, formatMoney } from '../utils/usage';
import { palette, themedStyles } from '../theme';

const PRICE_LABELS = {
  deepgramNova2PerMin: 'Deepgram Nova-2 — $ par minute',
  deepgramNova3PerMin: 'Deepgram Nova-3 (arabe) — $ par minute',
  deepgramPrePerMin: 'Deepgram différé (réunions) — $ par minute',
  deeplPerMillionChars: 'DeepL — $ par million de caractères',
  elevenPerThousandChars: 'ElevenLabs — $ par 1 000 caractères',
  openaiLivePerMin: 'OpenAI live — $ par minute d’audio envoyé',
  openaiTranscribePerMin: 'OpenAI live, transcription du texte source — $ par minute',
  geminiInPerMin: 'Gemini live, audio envoyé — $ par minute',
  geminiOutPerMin: 'Gemini live, voix traduite reçue — $ par minute',
};

/**
 * What the three services bill: Deepgram counts the AUDIO STREAMED (even silence, even in hands-free,
 * and twice in hands-free: one recognizer per language), DeepL the characters of the text to translate,
 * ElevenLabs the characters of the voice.
 * @param {object} props.usage      snapshot of UsageTracker: { session, today, monthTotals, total, since }
 * @param {object} props.prices     user overrides of DEFAULT_PRICES
 */
export default function UsageScreen({ visible, usage, prices, onPrices, onReset, onClose }) {
  const [quotas, setQuotas] = useState(null);
  const [draft, setDraft] = useState({});

  useEffect(() => {
    if (!visible) return;
    setQuotas(null);
    setDraft(Object.fromEntries(Object.entries(prices ?? {}).map(([k, v]) => [k, String(v)])));
    fetchQuotas({ deeplKey: env.deeplKey, elevenLabsKey: env.elevenLabsKey }, { elevenLabsBase: env.elevenLabsBaseUrl }).then(setQuotas);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const periods = [
    ['Cette session (depuis l’ouverture de l’app)', usage.session],
    ['Aujourd’hui', usage.today],
    ['Ce mois-ci', usage.monthTotals],
    [`Depuis le ${usage.since}`, usage.total],
  ];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>Consommation</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Text style={styles.link}>Fermer</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {periods.map(([title, u]) => {
            const cost = estimateCost(u, prices);
            return (
              <View key={title} style={styles.card}>
                <Text style={styles.cardTitle}>{title}</Text>
                <Row label="Deepgram (écoute)" value={formatDuration(deepgramSeconds(u))} money={cost.deepgram} />
                <Row label="DeepL (traduction)" value={`${formatCount(u.deeplChars)} car.`} money={cost.deepl} />
                <Row label="ElevenLabs (voix)" value={`${formatCount(u.elevenChars)} car.`} money={cost.eleven} />
                <Row label="OpenAI live (traduction + texte source)" value={formatDuration(u.oaiLiveSec || 0)} money={cost.openaiLive} />
                <Row label="Gemini live (audio envoyé + voix reçue)" value={formatDuration((u.geminiInSec || 0) + (u.geminiOutSec || 0))} money={cost.geminiLive} />
                <Row label="OpenRouter (comptes rendus)" value={`${formatCount(u.orTokens)} jetons`} money={cost.openrouter} />
                <View style={styles.sep} />
                <Row label="Estimation totale" value="" money={cost.total} bold />
              </View>
            );
          })}

          <Text style={styles.section}>Quotas réels (selon vos comptes)</Text>
          <View style={styles.card}>
            <QuotaRow label="DeepL" quota={quotas?.deepl} loading={!quotas} />
            <QuotaRow label="ElevenLabs" quota={quotas?.elevenlabs} loading={!quotas} />
            <Text style={styles.note}>
              Deepgram : consultez le solde dans la console Deepgram. Une clé limitée peut ne pas autoriser la lecture des quotas.
            </Text>
          </View>

          <Text style={styles.section}>Tarifs utilisés pour l’estimation</Text>
          <Text style={styles.note}>
            Indicatifs : lus sur les pages tarifaires publiques, tous n’ont pas pu être confirmés (Nova-2, formules DeepL, crédits ElevenLabs).
            Corrigez-les avec ceux de vos contrats. Seuls les volumes ci-dessus sont exacts.
          </Text>
          {PRICE_KEYS.map((key) => (
            <View key={key}>
              <Text style={styles.label}>{PRICE_LABELS[key]}</Text>
              <TextInput
                style={styles.input}
                value={draft[key] ?? ''}
                placeholder={String(DEFAULT_PRICES[key])}
                placeholderTextColor={palette().placeholder}
                keyboardType="decimal-pad"
                onChangeText={(t) => {
                  const clean = t.replace(',', '.');
                  setDraft((d) => ({ ...d, [key]: clean }));
                  onPrices({ ...Object.fromEntries(Object.entries({ ...draft, [key]: clean }).filter(([, v]) => v !== '')) });
                }}
              />
            </View>
          ))}

          <Text style={styles.note}>
            Mains libres : le son est envoyé à deux reconnaissances (une par langue), donc deux fois plus de minutes Deepgram, et il l’est aussi
            pendant les silences. Pensez à arrêter l’écoute (arrêt automatique après 5 min).
          </Text>
          <Pressable style={styles.reset} onPress={onReset} accessibilityRole="button">
            <Text style={styles.resetText}>Remettre le compteur à zéro</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Row({ label, value, money, bold }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, bold && styles.bold]}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.bold]}>{value}</Text>
      <Text style={[styles.rowMoney, bold && styles.bold]}>{`≈ ${formatMoney(money)}`}</Text>
    </View>
  );
}

function QuotaRow({ label, quota, loading }) {
  let text = 'non disponible';
  if (loading) text = '…';
  else if (quota) text = `${formatCount(quota.used)} / ${formatCount(quota.limit)} car. utilisés (reste ${formatCount(Math.max(0, quota.limit - quota.used))})`;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, { flex: 3, textAlign: 'right' }]}>{text}</Text>
    </View>
  );
}

const styles = themedStyles((c) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: 40 },
  title: { flex: 1, color: c.text, fontSize: 24, fontWeight: '700' },
  link: { color: c.link, fontSize: 16 },
  content: { padding: 16, paddingTop: 0, paddingBottom: 40 },
  card: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 14, marginBottom: 12 },
  cardTitle: { color: c.textSoft, fontSize: 14, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  rowLabel: { color: c.textMuted, fontSize: 14, flex: 2 },
  rowValue: { color: c.text, fontSize: 14, flex: 2, textAlign: 'right' },
  rowMoney: { color: c.success, fontSize: 14, flex: 1.4, textAlign: 'right' },
  bold: { fontWeight: '700' },
  sep: { height: 1, backgroundColor: c.track, marginVertical: 6 },
  section: { color: c.text, fontSize: 18, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  note: { color: c.textMuted, fontSize: 13, marginVertical: 8 },
  label: { color: c.textSoft, fontSize: 14, marginTop: 10, marginBottom: 4 },
  input: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, color: c.text, borderRadius: 10, padding: 12, fontSize: 16 },
  reset: { backgroundColor: c.dangerBg, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 20 },
  resetText: { color: c.danger, fontSize: 16, fontWeight: '600' },
}));
