import { Fragment, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { currentValues, saveKeys, SETUP_FIELDS } from '../config/env';
import { LANGUAGES } from '../config/languages';
import { saveSettings } from '../config/settings';
import { MIC_GAIN_CHOICES, pickLanguage } from '../config/settingsModel';
import Power from '../../modules/dualcast-power';

/**
 * First-launch / settings form. API keys and preferences (languages, auto-send) are stored in
 * the device's secure storage.
 * @param {{languages: {A: string, B: string}, autoStop: boolean}} props.settings
 * @param {(settings) => void} props.onDone  called with the saved settings
 */
export default function SetupScreen({ settings, onDone }) {
  const [values, setValues] = useState(currentValues());
  const [languages, setLanguages] = useState(settings.languages);
  const [background, setBackground] = useState(settings.background);
  const [micGain, setMicGain] = useState(settings.micGain);
  const [saving, setSaving] = useState(false);
  const complete = SETUP_FIELDS.every((f) => values[f.name]?.trim());

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Configuration</Text>
        <Text style={styles.hint}>
          Collez vos clés API. Elles restent dans le stockage sécurisé de ce téléphone, jamais dans le code.
        </Text>
        <Text style={styles.section}>Langues</Text>
        <LanguagePicker
          title="Langue A — écouteur gauche"
          selected={languages.A}
          onSelect={(code) => setLanguages((l) => pickLanguage(l, 'A', code))}
        />
        <LanguagePicker
          title="Langue B — écouteur droit"
          selected={languages.B}
          onSelect={(code) => setLanguages((l) => pickLanguage(l, 'B', code))}
        />

        <Text style={styles.section}>Sensibilité du micro</Text>
        <View style={styles.chips}>
          {MIC_GAIN_CHOICES.map((g) => (
            <Pressable
              key={String(g)}
              style={[styles.chip, micGain === g && styles.chipOn]}
              onPress={() => setMicGain(g)}
              accessibilityRole="button"
              accessibilityState={{ selected: micGain === g }}
            >
              <Text style={styles.chipText}>{g === 'auto' ? 'Auto' : `×${g}`}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>
          Auto amplifie la voix lointaine ou faible sans amplifier le bruit. Si la voix est mal captée, essayez ×4 ou ×8.
          La barre de volume s'affiche pendant l'enregistrement.
        </Text>

        <Text style={styles.section}>Arrière-plan</Text>
        <Pressable
          style={[styles.chip, background && styles.chipOn, { alignSelf: 'flex-start', marginTop: 8 }]}
          onPress={() => setBackground((b) => !b)}
          accessibilityRole="switch"
          accessibilityState={{ checked: background }}
        >
          <Text style={styles.chipText}>
            {background ? '✓ Rester actif écran éteint' : 'Rester actif écran éteint : non'}
          </Text>
        </Pressable>
        <Text style={styles.hint}>
          Affiche une notification permanente. Si la traduction ne fonctionne plus, essayez de le désactiver.
        </Text>
        {Power.available && (
          <>
            <Pressable
              style={[styles.chip, { alignSelf: 'flex-start' }]}
              onPress={() => Power.requestIgnoreBatteryOptimizations()}
              accessibilityRole="button"
            >
              <Text style={styles.chipText}>🔋 Autoriser sans limite de batterie</Text>
            </Pressable>
            <Text style={styles.hint}>
              Recommandé pour que la traduction continue écran éteint : Android limite sinon les apps en veille.
            </Text>
          </>
        )}

        <Text style={styles.section}>Clés API</Text>
        {SETUP_FIELDS.map((f) => (
          <Fragment key={f.name}>
            <Text style={styles.label}>{f.label}</Text>
            <TextInput
              style={styles.input}
              value={values[f.name] ?? ''}
              onChangeText={(t) => setValues((v) => ({ ...v, [f.name]: t }))}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={f.secret}
              placeholderTextColor="#55607F"
              placeholder={f.secret ? '••••••••' : 'ex. 21m00Tcm4TlvDq8ikWAM'}
            />
          </Fragment>
        ))}
        <Pressable
          style={[styles.button, !complete && styles.disabled]}
          disabled={!complete || saving}
          onPress={async () => {
            setSaving(true);
            await saveKeys(values);
            const saved = await saveSettings({ ...settings, languages, background, micGain });
            setSaving(false);
            onDone(saved);
          }}
        >
          <Text style={styles.buttonText}>Enregistrer</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function LanguagePicker({ title, selected, onSelect }) {
  return (
    <>
      <Text style={styles.label}>{title}</Text>
      <View style={styles.chips}>
        {Object.entries(LANGUAGES).map(([code, lang]) => (
          <Pressable
            key={code}
            style={[styles.chip, selected === code && styles.chipOn]}
            onPress={() => onSelect(code)}
            accessibilityRole="button"
            accessibilityState={{ selected: selected === code }}
          >
            <Text style={styles.chipText}>{`${lang.flag} ${lang.label}`}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  section: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 24 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: '#16233B', borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14 },
  chipOn: { backgroundColor: '#2F6FED' },
  chipText: { color: '#fff', fontSize: 15 },
  root: { flex: 1, backgroundColor: '#0B0F1A' },
  content: { padding: 24, paddingTop: 48 },
  title: { color: '#fff', fontSize: 26, fontWeight: '700' },
  hint: { color: '#9AA6C4', fontSize: 15, marginVertical: 12 },
  label: { color: '#C9D2EA', fontSize: 14, marginTop: 16, marginBottom: 6 },
  input: { backgroundColor: '#16233B', color: '#fff', borderRadius: 10, padding: 14, fontSize: 16 },
  button: { backgroundColor: '#2F6FED', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 28 },
  disabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
