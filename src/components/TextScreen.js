import { useState } from 'react';
import { Alert, Pressable, SafeAreaView, ScrollView, Share, StyleSheet, View } from 'react-native';

import { getLanguage } from '../config/languages';
import { env } from '../config/env';
import { Plain, Text, TextInput } from '../i18n/Text';
import { t } from '../i18n';
import DeepLClient from '../services/translate/DeepLClient';
import UsageTracker from '../services/UsageTracker';
import { ask } from '../services/LlmService';
import { describeError } from '../utils/http';
import { translationMessages } from '../utils/tools';
import { palette, themedStyles } from '../theme';
import Icon from './Icon';
import { Card, LargeTitle, PrimaryButton } from './ui';

/** Text translation between the two languages of the app (DeepL when its key is set, else a language model). */
export default function TextScreen({ settings }) {
  const c = palette();
  const [reversed, setReversed] = useState(false);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const fromKey = reversed ? settings.languages.B : settings.languages.A;
  const toKey = reversed ? settings.languages.A : settings.languages.B;
  const from = getLanguage(fromKey);
  const to = getLanguage(toKey);

  const translate = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      if (env.deeplKey) {
        setOutput(await new DeepLClient().translate(text, fromKey, toKey));
        UsageTracker.add({ deeplChars: text.length });
      } else {
        setOutput(await ask(translationMessages(text, from.label, to.label), { maxTokens: 3000 }));
      }
    } catch (error) {
      Alert.alert(t('Traduction impossible'), describeError(error));
    }
    setBusy(false);
  };

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <LargeTitle title="Texte" subtitle={env.deeplKey ? 'Traduit par DeepL' : 'Traduit par un modèle de langage'} />

        <View style={styles.pair}>
          <View style={styles.langBox}>
            <Plain style={styles.flag}>{from.flag}</Plain>
            <Plain style={styles.langName} numberOfLines={1}>{from.label}</Plain>
          </View>
          <Pressable
            style={styles.swap}
            onPress={() => {
              setReversed(!reversed);
              if (output) {
                setInput(output);
                setOutput('');
              }
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('Inverser les langues')}
          >
            <Icon name="swap" size={20} color={c.accent} />
          </Pressable>
          <View style={styles.langBox}>
            <Plain style={styles.flag}>{to.flag}</Plain>
            <Plain style={styles.langName} numberOfLines={1}>{to.label}</Plain>
          </View>
        </View>

        <Card>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Saisir le texte"
            placeholderTextColor={c.placeholder}
            multiline
            textAlignVertical="top"
          />
          <View style={styles.row}>
            <Pressable onPress={() => { setInput(''); setOutput(''); }} hitSlop={10} accessibilityRole="button" style={styles.ghost}>
              <Icon name="close" size={14} color={c.textMuted} />
              <Text style={styles.ghostText}>Effacer</Text>
            </Pressable>
            <Plain style={styles.count}>{`${input.length}`}</Plain>
          </View>
        </Card>

        <PrimaryButton label="Traduire" icon="sparkles" onPress={translate} disabled={!input.trim()} busy={busy} />

        {!!output && (
          <Card style={styles.result}>
            <View style={styles.resultHead}>
              <Plain style={styles.flag}>{to.flag}</Plain>
              <Plain style={styles.outLang}>{to.label}</Plain>
            </View>
            <Plain style={styles.output} selectable>{output}</Plain>
            <Pressable onPress={() => Share.share({ message: output }).catch(() => {})} hitSlop={10} accessibilityRole="button" style={styles.ghost}>
              <Icon name="share" size={16} color={c.accent} />
              <Text style={[styles.ghostText, { color: c.accent }]}>Partager / copier</Text>
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
  pair: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  langBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surface, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
  flag: { fontSize: 22 },
  langName: { flex: 1, color: c.text, fontSize: 15, fontWeight: '600' },
  swap: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  input: { color: c.text, fontSize: 20, lineHeight: 28, minHeight: 150, padding: 0 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ghostText: { color: c.textMuted, fontSize: 14, fontWeight: '500' },
  count: { color: c.textFaint, fontSize: 12 },
  result: { gap: 12 },
  resultHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  outLang: { color: c.textMuted, fontSize: 13, fontWeight: '500' },
  output: { color: c.text, fontSize: 22, lineHeight: 31, fontWeight: '600', letterSpacing: -0.3 },
}));
