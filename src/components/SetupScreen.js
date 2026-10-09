import { Fragment, useEffect, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { currentValues, env, requiredFields, saveKeys, SETUP_FIELDS } from '../config/env';
import { getLanguage, LANGUAGES, LIVE_OUTPUT_LANGUAGES } from '../config/languages';
import { saveSettings } from '../config/settings';
import { MIC_GAIN_CHOICES, MIC_SOURCES, pickLanguage, rememberPair, SPEEDS, STRATEGIES, VOICE_VOLUME_CHOICES } from '../config/settingsModel';
import audio from '../services/AudioRoutingService';
import Power from '../../modules/dualcast-power';
import { describeError } from '../utils/http';
import { listVoices, testGeminiKey, testKeys, testLanguages, testOpenAiKey } from '../utils/keyTest';

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
  const [voiceVolume, setVoiceVolume] = useState(settings.voiceVolume);
  const [input, setInput] = useState(settings.input);
  const [micSource, setMicSource] = useState(settings.micSource);
  const [micAgc, setMicAgc] = useState(settings.micAgc);
  const [inputs, setInputs] = useState([]);
  const [strategy, setStrategy] = useState(settings.strategy);
  const live = strategy !== 'classic'; // one live-translation service (OpenAI or Gemini) instead of the Deepgram → DeepL → ElevenLabs chain
  const liveKeyField = strategy === 'gemini' ? 'EXPO_PUBLIC_GEMINI_API_KEY' : 'EXPO_PUBLIC_OPENAI_API_KEY';
  const [streamVoice, setStreamVoice] = useState(settings.streamVoice);
  const [speed, setSpeed] = useState(settings.speed);
  const [voiceBySpeaker, setVoiceBySpeaker] = useState(settings.voiceBySpeaker);
  const [muteWhilePlaying, setMuteWhilePlaying] = useState(settings.muteWhilePlaying);
  const [report, setReport] = useState(null); // result of « Tester mes clés »
  const [testing, setTesting] = useState(false);
  const [voices, setVoices] = useState(null); // voices of the ElevenLabs account
  const [voiceError, setVoiceError] = useState('');

  useEffect(() => {
    audio.listInputs().then(setInputs);
  }, []);
  const [saving, setSaving] = useState(false);
  const complete = requiredFields(strategy).every((name) => values[name]?.trim());

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Configuration</Text>
        <Text style={styles.hint}>
          Collez vos clés API. Elles restent dans le stockage sécurisé de ce téléphone, jamais dans le code.
        </Text>
        <Text style={styles.section}>Stratégie de traduction</Text>
        <View style={styles.chips}>
          {Object.entries(STRATEGIES).map(([key, st]) => (
            <Chip
              key={key}
              label={st.label}
              on={strategy === key}
              onPress={() => st.available !== false && setStrategy(key)}
            />
          ))}
        </View>
        <Text style={styles.hint}>
          {STRATEGIES[strategy].hint}.
          {strategy === 'gemini'
            ? ' Gemini traduit directement la parole en parole (modèle gemini-3.5-live-translate-preview, environ 0,005 $ par minute d\'audio envoyé et 0,03 $ par minute de voix traduite, un niveau gratuit existe ; deux sessions en mains libres). Il reste muet quand on parle déjà la langue cible. Vos voix ElevenLabs, DeepL et Deepgram ne servent pas dans ce mode. Fonction nouvelle, en préversion chez Google : renvoyez-moi le journal si quelque chose cloche.'
            : ''}
          {strategy === 'openai'
            ? ` OpenAI traduit directement la parole en parole (modèle gpt-realtime-translate, environ 0,034 $ par minute d'audio envoyé, deux fois plus en mains libres). Langues parlées possibles : ${LIVE_OUTPUT_LANGUAGES.map((c) => getLanguage(c).label).join(', ')}. Vos voix ElevenLabs, DeepL et Deepgram ne servent pas dans ce mode. Fonction nouvelle : renvoyez-moi le journal si quelque chose cloche.`
            : ''}
        </Text>

        {strategy === 'openai' && [languages.A, languages.B].some((c) => !LIVE_OUTPUT_LANGUAGES.includes(c)) && (
          <Text style={styles.bad}>
            {`⚠ ${[languages.A, languages.B].filter((c) => !LIVE_OUTPUT_LANGUAGES.includes(c)).map((c) => getLanguage(c).label).join(' et ')} : cette langue ne peut pas être parlée par OpenAI live. Choisissez-en une autre ci-dessous, ou repassez en « Classique ».`}
          </Text>
        )}

        <Text style={styles.section}>Langues</Text>
        <View style={styles.chips}>
          <Chip label="⇄ Inverser A et B" on={false} onPress={() => setLanguages((l) => ({ A: l.B, B: l.A }))} />
          {settings.recentPairs
            .filter((p) => !(p.A === languages.A && p.B === languages.B))
            .map((p) => (
              <Chip key={`${p.A}-${p.B}`} label={`${getLanguage(p.A).flag} ↔ ${getLanguage(p.B).flag}  ${getLanguage(p.A).label} / ${getLanguage(p.B).label}`} on={false} onPress={() => setLanguages({ A: p.A, B: p.B })} />
            ))}
        </View>
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

        <Text style={styles.section}>Micro et voix</Text>
        <Text style={styles.label}>Source du micro</Text>
        <View style={styles.chips}>
          {Object.entries(MIC_SOURCES).map(([key, src]) => (
            <Chip key={key} label={src.label} on={micSource === key} onPress={() => setMicSource(key)} />
          ))}
        </View>
        <Text style={styles.hint}>
          {MIC_SOURCES[micSource].hint}. Sur Android, chaque source passe par un chemin audio différent : le niveau peut varier
          beaucoup d'un téléphone à l'autre. Essayez-les et regardez la barre de volume pendant l'enregistrement : gardez celle
          qui monte le plus.
        </Text>
        <Chip
          label={micAgc ? '✓ Gain automatique du téléphone' : 'Gain automatique du téléphone : non'}
          on={micAgc}
          onPress={() => setMicAgc((v) => !v)}
        />
        <Text style={styles.hint}>
          Utilise l'amplification intégrée du téléphone quand il en a une. Si le son est irrégulier ou « pompe », désactivez-la.
        </Text>

        <Text style={styles.label}>Micro utilisé</Text>
        <View style={styles.chips}>
          <Chip label="Automatique (micro du téléphone)" on={input == null} onPress={() => setInput(null)} />
          {inputs.map((d) => (
            <Chip
              key={d.id}
              label={`${d.name}${/bluetooth|sco|hfp/i.test(`${d.category} ${d.name}`) ? ' ⚠' : ''}`}
              on={input?.id === d.id}
              onPress={() => setInput({ id: d.id, name: d.name })}
            />
          ))}
        </View>
        <Text style={styles.hint}>
          ⚠ Un micro Bluetooth fait passer les écouteurs en mono : la séparation gauche/droite des deux voix est perdue.
        </Text>

        <Text style={styles.label}>Sensibilité du micro</Text>
        <View style={styles.chips}>
          {MIC_GAIN_CHOICES.map((g) => (
            <Chip
              key={String(g)}
              label={g === 'auto' ? 'Auto' : `×${g}`}
              on={micGain === g}
              onPress={() => setMicGain(g)}
            />
          ))}
        </View>
        <Text style={styles.hint}>
          Auto amplifie fortement la voix faible ou lointaine (jusqu'à ×60) sans amplifier le bruit. Évitez les gains fixes élevés (×16, ×32) : ils font saturer la voix dès qu'elle monte, ce qui fait rater des mots.
          La barre de volume s'affiche pendant l'enregistrement.
        </Text>

        <Text style={styles.label}>Volume de la voix traduite</Text>
        <View style={styles.chips}>
          {VOICE_VOLUME_CHOICES.map((v) => (
            <Chip key={String(v)} label={v === 1 ? 'Normal' : `×${v}`} on={voiceVolume === v} onPress={() => setVoiceVolume(v)} />
          ))}
        </View>
        <Text style={styles.hint}>
          Amplifie la voix dans les écouteurs sans la déformer. Pensez aussi à monter le volume « média » du téléphone et des écouteurs.
        </Text>

        {!live && (<>
        <Text style={styles.label}>Réactivité de la traduction</Text>
        <View style={styles.chips}>
          {Object.entries(SPEEDS).map(([key, v]) => (
            <Chip key={key} label={v.label} on={speed === key} onPress={() => setSpeed(key)} />
          ))}
        </View>
        <Text style={styles.hint}>
          « Rapide » lance la traduction après une pause plus courte et coupe les phrases plus tôt : la voix arrive plus vite, avec des
          morceaux de phrase plus courts (traduction un peu moins fluide). « Normale » attend des phrases plus naturelles.
        </Text>
        </>)}

        <Text style={styles.label}>Mains libres : écho</Text>
        <Chip
          label={muteWwp(muteWhilePlaying)}
          on={muteWhilePlaying}
          onPress={() => setMuteWhilePlaying((v) => !v)}
        />
        <Text style={styles.hint}>
          Coupe l'écoute pendant que la voix traduite est lue (et une demi-seconde après) : plus aucun risque que l'app se réécoute. En
          contrepartie, ce que l'on dit pendant la lecture n'est pas traduit. À activer si des phrases fantômes reviennent.
        </Text>

        {!live && (<>
        <Text style={styles.label}>Voix en flux (expérimental)</Text>
        <Chip
          label={streamVoice ? '✓ Commencer à parler avant la fin de la synthèse' : 'Voix en flux : non'}
          on={streamVoice}
          onPress={() => setStreamVoice((v) => !v)}
        />
        <Text style={styles.hint}>
          La traduction démarre dans les écouteurs dès les premiers mots synthétisés au lieu d'attendre la phrase entière : le délai
          baisse, surtout sur les longues phrases. Si la voix saute ou se coupe, désactivez-la (le mode classique reprend aussi tout seul
          si le flux ne marche pas).
        </Text>
        </>)}

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
        {SETUP_FIELDS.filter((f) => (live ? f.name === liveKeyField : !['EXPO_PUBLIC_OPENAI_API_KEY', 'EXPO_PUBLIC_GEMINI_API_KEY'].includes(f.name))).map((f) => (
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
              placeholder={f.name === 'EXPO_PUBLIC_OPENAI_API_KEY' ? 'sk-… (obligatoire pour OpenAI live)' : f.name === 'EXPO_PUBLIC_GEMINI_API_KEY' ? 'AIza… (obligatoire pour Gemini live)' : f.optional ? 'sk-or-… (laisser vide si inutilisé)' : f.secret ? '••••••••' : 'ex. 21m00Tcm4TlvDq8ikWAM'}
            />
          </Fragment>
        ))}
        {!live && (<>
        <Text style={styles.label}>À qui appartient la voix ?</Text>
        <Chip
          label={voiceBySpeaker ? '✓ Voix liée à la personne qui parle' : 'Voix liée à la langue entendue (par défaut)'}
          on={voiceBySpeaker}
          onPress={() => setVoiceBySpeaker((v) => !v)}
        />
        <Text style={styles.hint}>
          Par défaut, la voix A sert à parler la langue A et la voix B la langue B. Activez cette option pour que la voix A soit celle de la
          personne côté A — par exemple votre propre voix, créée dans ElevenLabs — qui « dit » alors ses traductions dans la langue de l'autre.
        </Text>

        <Text style={styles.label}>Choisir les voix</Text>
        <Pressable
          style={[styles.chip, { alignSelf: 'flex-start' }]}
          onPress={async () => {
            setVoiceError('');
            try {
              setVoices(await listVoices(values.EXPO_PUBLIC_ELEVENLABS_API_KEY?.trim(), { elevenLabsBase: env.elevenLabsBaseUrl }));
            } catch (e) {
              setVoices(null);
              setVoiceError(describeError(e));
            }
          }}
          accessibilityRole="button"
        >
          <Text style={styles.chipText}>🎙 Charger mes voix ElevenLabs</Text>
        </Pressable>
        {!!voiceError && <Text style={styles.bad}>{voiceError}</Text>}
        {voices && (
          <>
            {[
              ['EXPO_PUBLIC_ELEVENLABS_VOICE_A', 'Voix pour la langue A (écouteur gauche)'],
              ['EXPO_PUBLIC_ELEVENLABS_VOICE_B', 'Voix pour la langue B (écouteur droit)'],
            ].map(([field, title]) => (
              <Fragment key={field}>
                <Text style={styles.label}>{title}</Text>
                <View style={styles.chips}>
                  {voices.slice(0, 40).map((v) => (
                    <Chip
                      key={v.id}
                      label={v.hint ? `${v.name} · ${v.hint}` : v.name}
                      on={values[field]?.trim() === v.id}
                      onPress={() => setValues((cur) => ({ ...cur, [field]: v.id }))}
                    />
                  ))}
                </View>
              </Fragment>
            ))}
            <Text style={styles.hint}>
              Une voix différente pour chaque langue permet de savoir tout de suite qui « parle » dans les écouteurs.
            </Text>
          </>
        )}

        </>)}

        <Pressable
          style={[styles.chip, { alignSelf: 'flex-start', marginTop: 20 }, testing && styles.disabled]}
          disabled={testing}
          onPress={async () => {
            setTesting(true);
            setReport(null);
            const v = (name) => values[name]?.trim();
            if (strategy === 'gemini') {
              setReport({ gemini: await testGeminiKey(v('EXPO_PUBLIC_GEMINI_API_KEY'), { base: env.geminiBaseUrl }), voices: [] });
              setTesting(false);
              return;
            }
            if (live) {
              setReport({ openai: await testOpenAiKey(v('EXPO_PUBLIC_OPENAI_API_KEY'), { base: env.openaiBaseUrl }), voices: [] });
              setTesting(false);
              return;
            }
            const chosen = [languages.A, languages.B].map((code) => ({ label: getLanguage(code).label, ...getLanguage(code) }));
            const [keysReport, languagesReport] = await Promise.all([
              testKeys(
                {
                  deepgram: v('EXPO_PUBLIC_DEEPGRAM_API_KEY'),
                  deepl: v('EXPO_PUBLIC_DEEPL_API_KEY'),
                  elevenlabs: v('EXPO_PUBLIC_ELEVENLABS_API_KEY'),
                  voices: [v('EXPO_PUBLIC_ELEVENLABS_VOICE_A'), v('EXPO_PUBLIC_ELEVENLABS_VOICE_B')],
                },
                { elevenLabsBase: env.elevenLabsBaseUrl },
              ),
              testLanguages({ deepgramKey: v('EXPO_PUBLIC_DEEPGRAM_API_KEY'), deeplKey: v('EXPO_PUBLIC_DEEPL_API_KEY'), languages: chosen }),
            ]);
            setReport({ ...keysReport, languages: languagesReport });
            setTesting(false);
          }}
          accessibilityRole="button"
        >
          <Text style={styles.chipText}>{testing ? 'Test en cours…' : '✔︎ Tester mes clés'}</Text>
        </Pressable>
        {report &&
          [
            ['OpenAI', report.openai],
            ['Gemini', report.gemini],
            ['Deepgram', report.deepgram],
            ['DeepL', report.deepl],
            ['ElevenLabs', report.elevenlabs],
            ['Voix A', report.voices?.[0]],
            ['Voix B', report.voices?.[1]],
          ]
            .filter(([, r]) => r)
            .map(([name, r]) => (
              <Text key={name} style={r.ok ? styles.good : styles.bad}>
                {`${r.ok ? '✓' : '✗'} ${name} : ${r.message}`}
              </Text>
            ))}
        {report?.languages?.map((l) => (
          <Text key={l.label} style={l.deepgram.ok && l.deepl.ok ? styles.good : styles.bad}>
            {`${l.deepgram.ok && l.deepl.ok ? '✓' : '✗'} ${l.label} — Deepgram : ${l.deepgram.message} · DeepL : ${l.deepl.message}`}
          </Text>
        ))}

        <Pressable
          style={[styles.button, !complete && styles.disabled]}
          disabled={!complete || saving}
          onPress={async () => {
            setSaving(true);
            await saveKeys(values);
            const saved = await saveSettings({ ...settings, strategy, languages, background, micGain, voiceVolume, input, micSource, micAgc, streamVoice, speed, muteWhilePlaying, voiceBySpeaker, recentPairs: rememberPair(settings.recentPairs, languages) });
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

const muteWwp = (on) => (on ? '✓ Couper le micro pendant la voix traduite' : 'Couper le micro pendant la voix traduite : non');

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
  good: { color: '#7CE0A3', fontSize: 15, marginTop: 8 },
  bad: { color: '#FF8A80', fontSize: 15, marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
