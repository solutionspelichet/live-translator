import { Fragment, useEffect, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { currentValues, saveKeys, SETUP_FIELDS } from '../config/env';
import { LANGUAGES } from '../config/languages';
import { saveSettings } from '../config/settings';
import {
  MIC_GAIN_CHOICES,
  pickLanguage,
  updateProfile,
  USAGE_CHOICES,
  USAGE_MODES,
  VOICE_VOLUME_CHOICES,
} from '../config/settingsModel';
import audio from '../services/AudioRoutingService';
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
  // `draft` holds the audio part being edited: the usage mode and one profile per mode.
  // `editing` = which mode's settings are shown below (independent from the mode in use).
  const [draft, setDraft] = useState({
    usage: settings.usage,
    editing: settings.usage === 'ear' ? 'ear' : 'handsfree',
    profiles: settings.profiles,
  });
  const [inputs, setInputs] = useState([]);
  const profile = draft.profiles[draft.editing];
  const edit = (patch) => setDraft((d) => updateProfile(d, d.editing, patch));
  const editingMode = USAGE_MODES[draft.editing];

  useEffect(() => {
    audio.listInputs().then(setInputs);
  }, []);
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

        <Text style={styles.section}>Utilisation</Text>
        <View style={styles.chips}>
          {USAGE_CHOICES.map((key) => (
            <Chip
              key={key}
              label={key === 'auto' ? '📡 Automatique' : `${USAGE_MODES[key].icon} ${USAGE_MODES[key].label}`}
              on={draft.usage === key}
              onPress={() => setDraft((d) => ({ ...d, usage: key, editing: key === 'auto' ? d.editing : key }))}
            />
          ))}
        </View>
        <Text style={styles.hint}>
          Automatique : le capteur de proximité détecte le téléphone collé au visage (« à l'oreille ») ou posé / tenu à distance
          (« mains libres »), et applique les réglages du mode correspondant. Le bouton au centre de l'écran change aussi de mode.
        </Text>

        <Text style={styles.label}>Réglages à modifier</Text>
        <View style={styles.chips}>
          {Object.entries(USAGE_MODES).map(([key, mode]) => (
            <Chip
              key={key}
              label={`${mode.icon} ${mode.label}`}
              on={draft.editing === key}
              onPress={() => setDraft((d) => ({ ...d, editing: key }))}
            />
          ))}
        </View>
        <Text style={styles.hint}>
          {editingMode.hint}. Posé à plat, la voix arrive faible et lointaine (forte amplification) ; tenu près de la bouche,
          elle arrive forte (amplification modérée).
        </Text>

        <Text style={styles.label}>{`Micro utilisé — ${editingMode.label}`}</Text>
        <View style={styles.chips}>
          <Chip label="Automatique (micro du téléphone)" on={profile.input == null} onPress={() => edit({ input: null })} />
          {inputs.map((d) => (
            <Chip
              key={d.id}
              label={`${d.name}${/bluetooth|sco|hfp/i.test(`${d.category} ${d.name}`) ? ' ⚠' : ''}`}
              on={profile.input?.id === d.id}
              onPress={() => edit({ input: { id: d.id, name: d.name } })}
            />
          ))}
        </View>
        <Text style={styles.hint}>
          ⚠ Un micro Bluetooth fait passer les écouteurs en mono : la séparation gauche/droite des deux voix est perdue.
        </Text>

        <Text style={styles.label}>{`Sensibilité du micro — ${editingMode.label}`}</Text>
        <View style={styles.chips}>
          {MIC_GAIN_CHOICES.map((g) => (
            <Chip
              key={String(g)}
              label={g === 'auto' ? 'Auto' : `×${g}`}
              on={profile.micGain === g}
              onPress={() => edit({ micGain: g })}
            />
          ))}
        </View>
        <Text style={styles.hint}>
          {draft.editing === 'handsfree'
            ? 'Auto amplifie fortement la voix faible ou lointaine (jusqu\'à ×40) sans amplifier le bruit. Encore trop faible ? Essayez ×16 ou ×32.'
            : 'Auto amplifie modérément (jusqu\'à ×8) : la voix est proche. Si ça sature ou capte trop de bruit, choisissez ×1 ou ×2.'}{' '}
          La barre de volume s'affiche pendant l'enregistrement.
        </Text>

        <Text style={styles.label}>{`Volume de la voix traduite — ${editingMode.label}`}</Text>
        <View style={styles.chips}>
          {VOICE_VOLUME_CHOICES.map((v) => (
            <Chip key={String(v)} label={v === 1 ? 'Normal' : `×${v}`} on={profile.voiceVolume === v} onPress={() => edit({ voiceVolume: v })} />
          ))}
        </View>
        <Text style={styles.hint}>
          Amplifie la voix dans les écouteurs sans la déformer. Pensez aussi à monter le volume « média » du téléphone et des écouteurs.
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
            const saved = await saveSettings({ ...settings, languages, background, usage: draft.usage, profiles: draft.profiles });
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

function Chip({ label, on, onPress }) {
  return (
    <Pressable
      style={[styles.chip, on && styles.chipOn]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
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
