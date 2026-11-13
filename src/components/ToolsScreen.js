import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SafeAreaView, ScrollView, Share, StyleSheet, View } from 'react-native';

import { getLanguage } from '../config/languages';
import { env } from '../config/env';
import { Text, TextInput } from '../i18n/Text';
import { getLocale, t } from '../i18n';
import { ask } from '../services/LlmService';
import { describeError } from '../utils/http';
import { buildToolMessages, TONES, TOOL_IDS, TOOLS } from '../utils/tools';
import { themedStyles } from '../theme';

const UI_NAME = { fr: 'French', en: 'English', zh: 'Chinese' };

/** AI writing and help tools: a grid of cards, each opening a small form (text in, answer out). Needs the OpenRouter key. */
export default function ToolsScreen({ settings, onOpenSettings }) {
  const [id, setId] = useState(null);
  const [text, setText] = useState('');
  const [side, setSide] = useState('A'); // the language the text / the answer is in
  const [tone, setTone] = useState('neutral');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const tool = id ? TOOLS[id] : null;

  const open = (next) => {
    setId(next);
    setText('');
    setAnswer('');
    setTone(next === 'email' ? 'formal' : 'neutral');
  };

  const run = async () => {
    const lang = getLanguage(settings.languages[side]);
    const other = getLanguage(settings.languages[side === 'A' ? 'B' : 'A']);
    const messages = buildToolMessages(id, text, { lang: lang.label, other: other.label, ui: UI_NAME[getLocale()] ?? 'French' }, tone);
    if (!messages || busy) return;
    setBusy(true);
    try {
      setAnswer(await ask(messages, { model: settings.minutesModel }));
    } catch (error) {
      Alert.alert(t('Outil indisponible'), describeError(error));
    }
    setBusy(false);
  };

  if (!env.openRouterKey) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.content}>
          <Text style={styles.title}>Outils IA</Text>
          <Text style={styles.note}>Ces outils utilisent un modèle de langage : saisissez votre clé OpenRouter dans les réglages (c’est la même que pour les comptes rendus de réunion).</Text>
          <Pressable style={styles.go} onPress={onOpenSettings} accessibilityRole="button">
            <Text style={styles.goText}>Ouvrir les réglages</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!tool) {
    return (
      <SafeAreaView style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Outils IA</Text>
          <View style={styles.grid}>
            {TOOL_IDS.map((key) => (
              <Pressable key={key} style={styles.card} onPress={() => open(key)} accessibilityRole="button">
                <Text style={styles.icon}>{TOOLS[key].icon}</Text>
                <Text style={styles.cardTitle}>{TOOLS[key].title}</Text>
                <Text style={styles.cardHint}>{TOOLS[key].hint}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const langs = ['A', 'B'].map((k) => ({ k, ...getLanguage(settings.languages[k]) }));
  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => setId(null)} hitSlop={12} accessibilityRole="button">
          <Text style={styles.link}>‹ Outils IA</Text>
        </Pressable>
        <Text style={styles.title}>{`${tool.icon} ${tool.title}`}</Text>
        <Text style={styles.cardHint}>{tool.hint}</Text>
        <Text style={styles.label}>Langue du texte</Text>
        <View style={styles.chips}>
          {langs.map((l) => (
            <Pressable key={l.k} style={[styles.chip, side === l.k && styles.chipOn]} onPress={() => setSide(l.k)} accessibilityRole="button">
              <Text style={[styles.chipText, side === l.k && styles.chipTextOn]}>{`${l.flag} ${l.label}`}</Text>
            </Pressable>
          ))}
        </View>
        {tool.tones && (
          <>
            <Text style={styles.label}>Ton</Text>
            <View style={styles.chips}>
              {Object.entries(TONES).map(([key, v]) => (
                <Pressable key={key} style={[styles.chip, tone === key && styles.chipOn]} onPress={() => setTone(key)} accessibilityRole="button">
                  <Text style={[styles.chipText, tone === key && styles.chipTextOn]}>{v.label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
        <TextInput style={styles.input} value={text} onChangeText={setText} placeholder={tool.placeholder} placeholderTextColor={styles.placeholder.color} multiline textAlignVertical="top" />
        <Pressable style={[styles.go, (!text.trim() || busy) && styles.off]} onPress={run} disabled={!text.trim() || busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color={styles.goText.color} /> : <Text style={styles.goText}>Lancer</Text>}
        </Pressable>
        {!!answer && (
          <View style={styles.answer}>
            <Text style={styles.answerText} selectable>{answer}</Text>
            <Pressable onPress={() => Share.share({ message: answer }).catch(() => {})} hitSlop={10} accessibilityRole="button">
              <Text style={styles.link}>Partager / copier</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles((c) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  content: { padding: 16, paddingTop: 44, gap: 12 },
  title: { color: c.text, fontSize: 24, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: { width: '47.5%', backgroundColor: c.surface, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: c.border, gap: 4 },
  icon: { fontSize: 28 },
  cardTitle: { color: c.text, fontSize: 16, fontWeight: '700' },
  cardHint: { color: c.textMuted, fontSize: 13 },
  label: { color: c.textSoft, fontSize: 14, fontWeight: '600', marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: c.surface, borderRadius: 18, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: c.border },
  chipOn: { backgroundColor: c.chipOn, borderColor: c.accent },
  chipText: { color: c.textSoft, fontSize: 14 },
  chipTextOn: { color: c.text, fontWeight: '700' },
  input: { backgroundColor: c.surface, borderRadius: 16, padding: 14, color: c.text, fontSize: 17, minHeight: 130, borderWidth: 1, borderColor: c.border },
  placeholder: { color: c.placeholder },
  go: { backgroundColor: c.accent, borderRadius: 28, paddingVertical: 16, alignItems: 'center' },
  goText: { color: c.onAccent, fontSize: 18, fontWeight: '700' },
  off: { opacity: 0.45 },
  answer: { backgroundColor: c.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: c.border, gap: 10 },
  answerText: { color: c.text, fontSize: 17, lineHeight: 24 },
  link: { color: c.link, fontSize: 15 },
  note: { color: c.textMuted, fontSize: 15 },
}));
