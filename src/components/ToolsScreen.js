import { useState } from 'react';
import { Alert, Pressable, SafeAreaView, ScrollView, Share, StyleSheet, View } from 'react-native';

import { getLanguage } from '../config/languages';
import { env } from '../config/env';
import { Plain, Text, TextInput } from '../i18n/Text';
import { getLocale, t } from '../i18n';
import { ask } from '../services/LlmService';
import { describeError } from '../utils/http';
import { buildToolMessages, TONES, TOOL_IDS, TOOLS } from '../utils/tools';
import { palette, themedStyles } from '../theme';
import Icon from './Icon';
import { Card, IconBadge, LargeTitle, Pill, PrimaryButton } from './ui';

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

  const c = palette();
  if (!env.openRouterKey) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.content}>
          <LargeTitle title="Outils IA" />
          <Card style={styles.empty}>
            <IconBadge name="sparkles" size={52} />
            <Text style={styles.note}>Ces outils utilisent un modèle de langage : saisissez votre clé OpenRouter dans les réglages (c’est la même que pour les comptes rendus de réunion).</Text>
            <PrimaryButton label="Ouvrir les réglages" onPress={onOpenSettings} />
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  if (!tool) {
    return (
      <SafeAreaView style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <LargeTitle title="Outils IA" subtitle="Écrire, comprendre, se faire comprendre" />
          <View style={styles.grid}>
            {TOOL_IDS.map((key) => (
              <Pressable key={key} style={({ pressed }) => [styles.tile, pressed && styles.pressed]} onPress={() => open(key)} accessibilityRole="button">
                <IconBadge name={TOOLS[key].icon} size={44} />
                <Text style={styles.tileTitle}>{TOOLS[key].title}</Text>
                <Text style={styles.tileHint} numberOfLines={2}>{TOOLS[key].hint}</Text>
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
        <Pressable onPress={() => setId(null)} hitSlop={12} accessibilityRole="button" style={styles.back}>
          <Icon name="back" size={20} color={c.accent} />
          <Text style={styles.backText}>Outils IA</Text>
        </Pressable>
        <View style={styles.head}>
          <IconBadge name={tool.icon} size={52} />
          <View style={styles.headText}>
            <Text style={styles.toolTitle}>{tool.title}</Text>
            <Text style={styles.tileHint}>{tool.hint}</Text>
          </View>
        </View>
        <Text style={styles.label}>Langue du texte</Text>
        <View style={styles.chips}>
          {langs.map((l) => (
            <Pill key={l.k} label={`${l.flag}  ${l.label}`} on={side === l.k} onPress={() => setSide(l.k)} />
          ))}
        </View>
        {tool.tones && (
          <>
            <Text style={styles.label}>Ton</Text>
            <View style={styles.chips}>
              {Object.entries(TONES).map(([key, v]) => (
                <Pill key={key} label={t(v.label)} on={tone === key} onPress={() => setTone(key)} />
              ))}
            </View>
          </>
        )}
        <Card>
          <TextInput style={styles.input} value={text} onChangeText={setText} placeholder={tool.placeholder} placeholderTextColor={c.placeholder} multiline textAlignVertical="top" />
        </Card>
        <PrimaryButton label="Lancer" icon="sparkles" onPress={run} disabled={!text.trim()} busy={busy} />
        {!!answer && (
          <Card style={styles.answer}>
            <Plain style={styles.answerText} selectable>{answer}</Plain>
            <Pressable onPress={() => Share.share({ message: answer }).catch(() => {})} hitSlop={10} accessibilityRole="button" style={styles.share}>
              <Icon name="share" size={16} color={c.accent} />
              <Text style={styles.shareText}>Partager / copier</Text>
            </Pressable>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles((c) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  content: { padding: 20, paddingTop: 44, gap: 16 },
  empty: { alignItems: 'flex-start', gap: 16 },
  note: { color: c.textSoft, fontSize: 15, lineHeight: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '48%', flexGrow: 1, backgroundColor: c.surface, borderRadius: 20, padding: 16, gap: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  tileTitle: { color: c.text, fontSize: 16, fontWeight: '600', letterSpacing: -0.2, marginTop: 4 },
  tileHint: { color: c.textMuted, fontSize: 13, lineHeight: 18 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  backText: { color: c.accent, fontSize: 16, fontWeight: '500' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  headText: { flex: 1, gap: 2 },
  toolTitle: { color: c.text, fontSize: 24, fontWeight: '700', letterSpacing: -0.5 },
  label: { color: c.textSoft, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { color: c.text, fontSize: 17, lineHeight: 25, minHeight: 130, padding: 0 },
  answer: { gap: 14 },
  answerText: { color: c.text, fontSize: 17, lineHeight: 26 },
  share: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shareText: { color: c.accent, fontSize: 14, fontWeight: '500' },
}));
