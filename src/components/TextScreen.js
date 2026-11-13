import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SafeAreaView, ScrollView, Share, StyleSheet, View } from 'react-native';

import { getLanguage } from '../config/languages';
import { env } from '../config/env';
import { Text, TextInput } from '../i18n/Text';
import { t } from '../i18n';
import DeepLClient from '../services/translate/DeepLClient';
import UsageTracker from '../services/UsageTracker';
import { ask } from '../services/LlmService';
import { describeError } from '../utils/http';
import { translationMessages } from '../utils/tools';
import { themedStyles } from '../theme';

/** Text translation between the two languages of the app (DeepL when its key is set, else a language model). */
export default function TextScreen({ settings }) {
  const [reversed, setReversed] = useState(false);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const from = getLanguage(reversed ? settings.languages.B : settings.languages.A);
  const to = getLanguage(reversed ? settings.languages.A : settings.languages.B);
  const fromKey = reversed ? settings.languages.B : settings.languages.A;
  const toKey = reversed ? settings.languages.A : settings.languages.B;

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
        <Text style={styles.title}>Traducteur texte</Text>
        <View style={styles.pair}>
          <Text style={styles.lang}>{`${from.flag} ${from.label}`}</Text>
          <Pressable
            onPress={() => {
              setReversed(!reversed);
              if (output) {
                setInput(output);
                setOutput('');
              }
            }}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('Inverser les langues')}
          >
            <Text style={styles.swap}>⇄</Text>
          </Pressable>
          <Text style={styles.lang}>{`${to.flag} ${to.label}`}</Text>
        </View>
        <View style={styles.card}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Saisir le texte"
            placeholderTextColor={styles.placeholder.color}
            multiline
            textAlignVertical="top"
          />
          <View style={styles.row}>
            <Pressable onPress={() => { setInput(''); setOutput(''); }} hitSlop={10} accessibilityRole="button">
              <Text style={styles.link}>Effacer</Text>
            </Pressable>
            <Text style={styles.count}>{`${input.length}`}</Text>
          </View>
        </View>
        <Pressable style={[styles.go, (!input.trim() || busy) && styles.off]} onPress={translate} disabled={!input.trim() || busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color={styles.goText.color} /> : <Text style={styles.goText}>Traduire</Text>}
        </Pressable>
        {!!output && (
          <View style={styles.card}>
            <Text style={styles.outLang}>{`${to.flag} ${to.label}`}</Text>
            <Text style={styles.output} selectable>{output}</Text>
            <View style={styles.row}>
              <Pressable onPress={() => Share.share({ message: output }).catch(() => {})} hitSlop={10} accessibilityRole="button">
                <Text style={styles.link}>Partager / copier</Text>
              </Pressable>
            </View>
          </View>
        )}
        <Text style={styles.note}>{env.deeplKey ? 'Traduit par DeepL.' : 'Traduit par un modèle de langage (clé OpenRouter) : ajoutez une clé DeepL dans les réglages pour une traduction plus rapide.'}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles((c) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  content: { padding: 16, paddingTop: 44, gap: 12 },
  title: { color: c.text, fontSize: 24, fontWeight: '700', textAlign: 'center' },
  pair: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.surface, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 18, borderWidth: 1, borderColor: c.border },
  lang: { color: c.text, fontSize: 17, fontWeight: '600' },
  swap: { color: c.accent, fontSize: 26, fontWeight: '700' },
  card: { backgroundColor: c.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: c.border },
  input: { color: c.text, fontSize: 20, minHeight: 150, padding: 0 },
  placeholder: { color: c.placeholder },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  link: { color: c.link, fontSize: 15 },
  count: { color: c.textFaint, fontSize: 12 },
  go: { backgroundColor: c.accent, borderRadius: 28, paddingVertical: 16, alignItems: 'center' },
  goText: { color: c.onAccent, fontSize: 18, fontWeight: '700' },
  off: { opacity: 0.45 },
  outLang: { color: c.textMuted, fontSize: 13, marginBottom: 6 },
  output: { color: c.text, fontSize: 22, fontWeight: '600' },
  note: { color: c.textFaint, fontSize: 12, textAlign: 'center' },
}));
