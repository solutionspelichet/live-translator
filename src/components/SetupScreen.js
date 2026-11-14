import { Fragment, useEffect, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, View } from 'react-native';

import { currentValues, env, requiredFields, saveKeys, SETUP_FIELDS } from '../config/env';
import { getLanguage, LANGUAGES, LIVE_OUTPUT_LANGUAGES } from '../config/languages';
import { saveSettings } from '../config/settings';
import { MIC_SOURCES, pickLanguage, rememberPair, SPEEDS, STRATEGIES, VOICE_VOLUME_CHOICES } from '../config/settingsModel';
import audio from '../services/AudioRoutingService';
import Power from '../../modules/dualcast-power';
import { doubaoCode, doubaoPairProblem } from '../utils/doubao';
import { defaultDoubaoVoice, doubaoVoicesFor } from '../utils/doubaoVoices';
import { OUTPUT_MODES } from '../utils/outputRoute';
import { listVoiceCandidates, mistralVoiceLanguage } from '../utils/mistral';
import { checkMistral } from '../utils/mistralCheck';
import { describeError, fetchWithRetry } from '../utils/http';
import VoiceCloneCard from './VoiceCloneCard';
import { listVoices, testGeminiKey, testKeys, testLanguages, testOpenAiKey } from '../utils/keyTest';
import { cardShadow, palette, THEME_CHOICES, themedStyles } from '../theme';
import { Text, TextInput } from '../i18n/Text';
import { formatGain, gainToValue, valueToGain } from '../utils/gainSlider';
import Icon from './Icon';
import { Hint, Select, Slider } from './ui';
import { defaultLocale, t } from '../i18n';
import LanguageFlags from '../i18n/LanguageFlags';

/**
 * First-launch / settings form. API keys and preferences (languages, auto-send) are stored in
 * the device's secure storage.
 * @param {{languages: {A: string, B: string}, autoStop: boolean}} props.settings
 * @param {(settings) => void} props.onDone  called with the saved settings
 */
export default function SetupScreen({ settings, onDone, onPreviewTheme, onPreviewLang }) {
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
  const [theme, setThemeChoice] = useState(settings.theme);
  const [doubaoVoiceKind, setDoubaoVoiceKind] = useState(settings.doubaoVoiceKind);
  const [doubaoVoices, setDoubaoVoices] = useState(settings.doubaoVoices ?? {});
  const [mistralVoices, setMistralVoices] = useState(settings.mistralVoices ?? {});
  const [mistralVoiceList, setMistralVoiceList] = useState({}); // language → voices of the Mistral account
  const [uiLang, setUiLang] = useState(settings.uiLang ?? defaultLocale());
  const live = strategy !== 'classic'; // one live-translation service (OpenAI or Gemini) instead of the Deepgram → DeepL → ElevenLabs chain
  const LIVE_FIELDS = { openai: ['EXPO_PUBLIC_OPENAI_API_KEY'], gemini: ['EXPO_PUBLIC_GEMINI_API_KEY'], mistral: ['EXPO_PUBLIC_MISTRAL_API_KEY'], doubao: ['EXPO_PUBLIC_BYTEPLUS_API_KEY', 'EXPO_PUBLIC_DOUBAO_SPEAKER_ID'] };
  const OTHER_LIVE_FIELDS = Object.values(LIVE_FIELDS).flat();
  const [streamVoice, setStreamVoice] = useState(settings.streamVoice);
  const [speed, setSpeed] = useState(settings.speed);
  const [voiceBySpeaker, setVoiceBySpeaker] = useState(settings.voiceBySpeaker);
  const [muteWhilePlaying, setMuteWhilePlaying] = useState(settings.muteWhilePlaying);
  const [outputMode, setOutputMode] = useState(settings.outputMode);
  const [elevenVoiceForAll, setElevenVoiceForAll] = useState(settings.elevenVoiceForAll);
  const [mistralQuality, setMistralQuality] = useState(settings.mistralQuality);
  const [lowBandwidth, setLowBandwidth] = useState(settings.lowBandwidth);
  const [mistralTranslator, setMistralTranslator] = useState(settings.mistralTranslator);
  const [mistralGlossary, setMistralGlossary] = useState(settings.mistralGlossary);
  const [mistralAutoContext, setMistralAutoContext] = useState(settings.mistralAutoContext);
  const [report, setReport] = useState(null); // result of « Tester mes clés »
  const [testing, setTesting] = useState(false);
  const [voices, setVoices] = useState(null); // voices of the ElevenLabs account
  const [voiceError, setVoiceError] = useState('');

  useEffect(() => {
    audio.listInputs().then(setInputs);
  }, []);
  // The voice lists load by themselves once the key is there (the dropdowns are then ready): ElevenLabs, and Mistral per language spoken.
  const elevenKey = values.EXPO_PUBLIC_ELEVENLABS_API_KEY?.trim();
  useEffect(() => {
    if (!elevenKey || elevenKey.length < 20 || voices) return;
    listVoices(elevenKey, { elevenLabsBase: env.elevenLabsBaseUrl }).then(setVoices).catch(() => {});
  }, [elevenKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const mistralKey = values.EXPO_PUBLIC_MISTRAL_API_KEY?.trim();
  useEffect(() => {
    if (strategy !== 'mistral' || !mistralKey || mistralKey.length < 20) return;
    const get = (path) => fetchWithRetry('Mistral', () => fetch(`${env.mistralBaseUrl}${path}`, { headers: { Authorization: `Bearer ${mistralKey}` } }), { retries: 1 }).then((r) => r.json());
    for (const code of new Set([languages.A, languages.B].map((c) => mistralVoiceLanguage(c)).filter(Boolean))) {
      if (mistralVoiceList[code]) continue;
      listVoiceCandidates(get, code).then((list) => setMistralVoiceList((cur) => ({ ...cur, [code]: list }))).catch(() => {});
    }
  }, [strategy, mistralKey, languages.A, languages.B]); // eslint-disable-line react-hooks/exhaustive-deps
  const [saving, setSaving] = useState(false);
  const complete = requiredFields(strategy, { doubaoPreset: doubaoVoiceKind !== 'clone' }).every((name) => values[name]?.trim());
  // Open: what you change most (translation); the keys when something is missing. The rest unfolds on demand.
  const [openSection, setOpenSection] = useState({ translation: true, keys: !requiredFields(settings.strategy).every((name) => currentValues()[name]?.trim()) });
  const toggle = (key) => setOpenSection((o) => ({ ...o, [key]: !o[key] }));

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Réglages</Text>
        <LanguageFlags
          value={uiLang}
          onChange={(code) => {
            setUiLang(code);
            onPreviewLang?.(code); // the whole interface changes at once; saved with the rest
          }}
          style={styles.flags}
        />

        <View style={styles.summary}>
          <SummaryLine label="Mode" value={STRATEGIES[strategy].label} />
          <SummaryLine label="Langues" value={`${getLanguage(languages.A).flag} ${getLanguage(languages.A).label}  ↔  ${getLanguage(languages.B).flag} ${getLanguage(languages.B).label}`} />
          <SummaryLine label="Clés API" value={complete ? '✓ complètes' : '⚠ à renseigner pour ce mode'} good={complete} bad={!complete} />
          <SummaryLine label="Apparence" value={THEME_CHOICES[theme].label} />
        </View>

        <Section title="Traduction" subtitle={`${t(STRATEGIES[strategy].label)} · ${getLanguage(languages.A).flag} ↔ ${getLanguage(languages.B).flag}`} open={!!openSection.translation} onToggle={() => toggle('translation')}>
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
        <Hint>
          {STRATEGIES[strategy].hint}.
          {strategy === 'mistral'
            ? ' Mistral enchaîne la transcription en direct (Voxtral), la traduction (Mistral Small, qui reconnaît aussi la langue de chaque phrase) et la voix (Voxtral). Une seule clé, hébergé en Europe, environ 0,01 $ par minute de parole entendue plus 0,016 $ pour 1 000 caractères de voix. La voix existe en anglais, français, espagnol, allemand, néerlandais, portugais, italien, hindi et arabe ; pour toute autre langue (chinois, japonais…) la traduction s\'affiche sans voix, sauf si vous avez une clé ElevenLabs et deux voix dans ces réglages : elles prennent alors le relais. Un peu plus lent que les services de parole à parole (comptez 2 secondes après la fin d\'une phrase). Fonction nouvelle : renvoyez-moi le journal si quelque chose cloche.'
          : strategy === 'doubao'
            ? ' Doubao (BytePlus Seed LiveInterpret 2.0) traduit directement la parole en parole avec une voix clonée que vous avez enrôlée dans la console BytePlus (identifiant « speaker_id »). Une des deux langues doit être le chinois ou l\'anglais ; seuls chinois ↔ français et chinois → anglais sont éprouvés. Chaque session entend une seule langue : en mains libres, deux sessions tournent (une par sens). Prix non publié : renseignez-le dans l\'écran Consommation. Fonction nouvelle : renvoyez-moi le journal si quelque chose cloche.'
          : strategy === 'gemini'
            ? ' Gemini traduit directement la parole en parole (modèle gemini-3.5-live-translate-preview, environ 0,005 $ par minute d\'audio envoyé et 0,03 $ par minute de voix traduite, un niveau gratuit existe ; deux sessions en mains libres). Il est censé rester muet quand on parle déjà la langue cible ; un filtre coupe les répétitions qui restent. Vos voix ElevenLabs, DeepL et Deepgram ne servent pas dans ce mode. Fonction nouvelle, en préversion chez Google : renvoyez-moi le journal si quelque chose cloche.'
            : ''}
          {strategy === 'openai'
            ? ` ${t("OpenAI traduit directement la parole en parole (modèle gpt-realtime-translate, environ 0,034 $ par minute d'audio envoyé, deux fois plus en mains libres). Langues parlées possibles : {list}. Vos voix ElevenLabs, DeepL et Deepgram ne servent pas dans ce mode. Fonction nouvelle : renvoyez-moi le journal si quelque chose cloche.", { list: LIVE_OUTPUT_LANGUAGES.map((c) => getLanguage(c).label).join(', ') })}`
            : ''}
        </Hint>

        {strategy === 'openai' && [languages.A, languages.B].some((c) => !LIVE_OUTPUT_LANGUAGES.includes(c)) && (
          <Text style={styles.bad}>
            {`⚠ ${t('{langs} : cette langue ne peut pas être parlée par OpenAI live. Choisissez-en une autre ci-dessous, ou repassez en « Classique ».', { langs: [languages.A, languages.B].filter((c) => !LIVE_OUTPUT_LANGUAGES.includes(c)).map((c) => getLanguage(c).label).join(` ${t('et')} `) })}`}
          </Text>
        )}
        {strategy === 'mistral' && [languages.A, languages.B].some((c) => !mistralVoiceLanguage(c)) && (
          <Hint>
            {`ℹ︎ ${t("{langs} : pas de voix Mistral dans cette langue, la traduction s'affichera sans être lue.", { langs: [languages.A, languages.B].filter((c) => !mistralVoiceLanguage(c)).map((c) => getLanguage(c).label).join(` ${t('et')} `) })}`}
          </Hint>
        )}
        {strategy === 'doubao' && (() => {
          const [a, b] = [doubaoCode(languages.A), doubaoCode(languages.B)];
          const problem = !a || !b ? t("{lang} n'est pas prise en charge par Doubao", { lang: getLanguage(!a ? languages.A : languages.B).label }) : doubaoPairProblem(a, b);
          return problem ? <Text style={styles.bad}>{`⚠ ${t(problem)}. ${t("Choisissez d'autres langues ci-dessous, ou changez de stratégie.")}`}</Text> : null;
        })()}
        {strategy === 'doubao' && (
          <>
            <Text style={styles.label}>Voix de Doubao</Text>
            <View style={styles.chips}>
              <Chip label="Ma voix clonée (identifiant speaker_id)" on={doubaoVoiceKind === 'clone'} onPress={() => setDoubaoVoiceKind('clone')} />
              <Chip label="Voix prédéfinie de la liste (expérimental)" on={doubaoVoiceKind === 'preset'} onPress={() => setDoubaoVoiceKind('preset')} />
              <Chip label="Clonage automatique de la voix de chaque locuteur (expérimental)" on={doubaoVoiceKind === 'auto'} onPress={() => setDoubaoVoiceKind('auto')} />
            </View>
            {doubaoVoiceKind === 'preset' && [...new Set([languages.A, languages.B].map((c) => doubaoCode(c)).filter(Boolean))].map((base) => {
              const list = doubaoVoicesFor(base);
              const chosen = doubaoVoices[base] ?? defaultDoubaoVoice(base);
              const owner = [languages.A, languages.B].find((c) => doubaoCode(c) === base);
              return (
                <View key={base}>
                  <Text style={styles.hint}>{`${getLanguage(owner).flag} ${getLanguage(owner).label}`}</Text>
                  {list.length === 0 ? (
                    <Text style={styles.hint}>{t('Pas de voix prédéfinie pour {lang}', { lang: getLanguage(owner).label })}</Text>
                  ) : (
                    <Select
                      value={chosen}
                      onChange={(id) => setDoubaoVoices((cur) => ({ ...cur, [base]: id }))}
                      options={list.map((v) => ({ id: v.id, label: `${v.name} ${v.gender === 'F' ? '♀' : '♂'}` }))}
                    />
                  )}
                </View>
              );
            })}
            {doubaoVoiceKind === 'auto' && (
              <Hint>
                Le modèle imite lui-même la voix de la personne qui parle, sans identifiant ni enregistrement préalable (la documentation de BytePlus le décrit pour l'interprétation parole à parole). La requête exacte n'est pas documentée : l'application n'envoie simplement aucune voix. Si Doubao répond « group model … not found », ce choix n'est pas accepté : prenez une voix prédéfinie.
              </Hint>
            )}
            <Hint>
              Expérimental : la documentation de BytePlus ne dit pas si l'interprétation simultanée accepte les voix prédéfinies de sa liste. Si Doubao refuse la session, le journal le dit : repassez alors sur « Ma voix clonée ». La voix choisie est celle qui PARLE chaque langue.
            </Hint>
          </>
        )}
        {strategy === 'mistral' && (() => {
          const langs = [...new Set([languages.A, languages.B].map((c) => mistralVoiceLanguage(c)).filter(Boolean))];
          if (!langs.length) return null;
          return (
            <>
              <Text style={styles.label}>Voix de Mistral</Text>
              {langs.map((code) => {
                const owner = [languages.A, languages.B].find((c) => mistralVoiceLanguage(c) === code);
                const list = mistralVoiceList[code] ?? [];
                return (
                  <View key={code} style={styles.voiceRow}>
                    <Text style={styles.hint}>{`${getLanguage(owner).flag} ${getLanguage(owner).label}`}</Text>
                    <Select
                      value={mistralVoices[code] ?? null}
                      onChange={(id) => setMistralVoices((cur) => {
                        const next = { ...cur };
                        if (id) next[code] = id;
                        else delete next[code];
                        return next;
                      })}
                      options={[
                        { id: null, label: t("Automatique (voix neutre choisie par l'application)") },
                        ...(mistralVoices[code] && !list.some((v) => v.id === mistralVoices[code]) ? [{ id: mistralVoices[code], label: t('Voix enregistrée') }] : []),
                        ...list.map((v) => ({ id: v.id, label: v.name ?? v.id })),
                      ]}
                    />
                  </View>
                );
              })}
              <Hint>La liste vient de votre compte Mistral et se charge toute seule quand la clé est saisie. « Automatique » prend la voix neutre la mieux classée ; une voix choisie ici passe en premier, et si Mistral la refuse l'application essaie les autres.</Hint>
            </>
          );
        })()}
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
        </Section>

        <Section title="Clés API" subtitle={complete ? '✓ complètes' : '⚠ à renseigner'} open={!!openSection.keys} onToggle={() => toggle('keys')}>
        {SETUP_FIELDS.filter((f) => (live ? LIVE_FIELDS[strategy].includes(f.name) : !OTHER_LIVE_FIELDS.includes(f.name))).map((f) => (
          <Fragment key={f.name}>
            <Text style={styles.label}>{f.label}</Text>
            <TextInput
              style={styles.input}
              value={values[f.name] ?? ''}
              onChangeText={(t) => setValues((v) => ({ ...v, [f.name]: t }))}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={f.secret}
              placeholderTextColor={palette().placeholder}
              placeholder={f.name === 'EXPO_PUBLIC_OPENAI_API_KEY' ? 'sk-… (obligatoire pour OpenAI live)' : f.name === 'EXPO_PUBLIC_GEMINI_API_KEY' ? 'AIza… (obligatoire pour Gemini live)' : f.name === 'EXPO_PUBLIC_MISTRAL_API_KEY' ? 'clé Mistral (console.mistral.ai)' : f.name === 'EXPO_PUBLIC_BYTEPLUS_API_KEY' ? 'clé Seed Speech (pas une clé ModelArk)' : f.name === 'EXPO_PUBLIC_DOUBAO_SPEAKER_ID' ? 'ex. S_xxxxxxxx (voix enrôlée dans la console)' : f.optional ? 'sk-or-… (laisser vide si inutilisé)' : f.secret ? '••••••••' : 'ex. 21m00Tcm4TlvDq8ikWAM'}
            />
          </Fragment>
        ))}
        <Pressable
          style={[styles.chip, { alignSelf: 'flex-start', marginTop: 20 }, testing && styles.disabled]}
          disabled={testing}
          onPress={async () => {
            setTesting(true);
            setReport(null);
            const v = (name) => values[name]?.trim();
            if (strategy === 'mistral') {
              setReport({ steps: await checkMistral({ apiKey: v('EXPO_PUBLIC_MISTRAL_API_KEY'), baseUrl: env.mistralBaseUrl, wsUrl: env.mistralSttWsUrl }), voices: [] });
              setTesting(false);
              return;
            }
            if (strategy === 'doubao') {
              setReport({ doubao: { ok: !!(v('EXPO_PUBLIC_BYTEPLUS_API_KEY') && v('EXPO_PUBLIC_DOUBAO_SPEAKER_ID')), message: 'la clé ne peut se vérifier qu\'en ouvrant une session : lancez une traduction courte (chinois ↔ français ou anglais)' }, voices: [] });
              setTesting(false);
              return;
            }
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
            ['Mistral', report.mistral],
            ['Doubao', report.doubao],
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
        {report?.steps?.map((s) => (
          <Text key={s.name} style={s.ok ? styles.good : styles.bad}>
            {`${s.ok ? '✓' : '✗'} ${s.name} : ${s.message}`}
          </Text>
        ))}
        {report?.languages?.map((l) => (
          <Text key={l.label} style={l.deepgram.ok && l.deepl.ok ? styles.good : styles.bad}>
            {`${l.deepgram.ok && l.deepl.ok ? '✓' : '✗'} ${l.label} — Deepgram : ${l.deepgram.message} · DeepL : ${l.deepl.message}`}
          </Text>
        ))}
        </Section>

        <Section title="Micro" subtitle={`${t(MIC_SOURCES[micSource].label)} · ${t('sensibilité {g}', { g: micGain === 'auto' ? t('auto') : formatGain(micGain) })}`} open={!!openSection.mic} onToggle={() => toggle('mic')}>
        <Text style={styles.label}>Source du micro</Text>
        <View style={styles.chips}>
          {Object.entries(MIC_SOURCES).map(([key, src]) => (
            <Chip key={key} label={src.label} on={micSource === key} onPress={() => setMicSource(key)} />
          ))}
        </View>
        <Hint>
          {MIC_SOURCES[micSource].hint}. Sur Android, chaque source passe par un chemin audio différent : le niveau peut varier
          beaucoup d'un téléphone à l'autre. Essayez-les et regardez la barre de volume pendant l'enregistrement : gardez celle
          qui monte le plus.
        </Hint>
        <Chip
          label={micAgc ? '✓ Gain automatique du téléphone' : 'Gain automatique du téléphone : non'}
          on={micAgc}
          onPress={() => setMicAgc((v) => !v)}
        />
        <Hint>
          Utilise l'amplification intégrée du téléphone quand il en a une. Si le son est irrégulier ou « pompe », désactivez-la.
        </Hint>

        <Text style={styles.label}>Micro utilisé</Text>
        <Select
          value={input?.id ?? null}
          onChange={(id) => setInput(id == null ? null : { id, name: inputs.find((d) => d.id === id)?.name ?? '' })}
          options={[
            { id: null, label: t('Automatique (micro du téléphone)') },
            ...inputs.map((d) => ({ id: d.id, label: d.name, hint: /bluetooth|sco|hfp/i.test(`${d.category} ${d.name}`) ? t('Bluetooth : les écouteurs passent en mono') : undefined })),
          ]}
        />
        <Text style={styles.hint}>
          ⚠ Un micro Bluetooth fait passer les écouteurs en mono : la séparation gauche/droite des deux voix est perdue.
        </Text>

        <View style={styles.gainHead}>
          <Text style={styles.labelInline}>Sensibilité du micro</Text>
          <Text style={styles.gainValue}>{formatGain(micGain)}</Text>
        </View>
        <Slider value={micGain === 'auto' ? gainToValue(4) : gainToValue(micGain)} disabled={micGain === 'auto'} onChange={(v) => setMicGain(valueToGain(v))} />
        <Chip label={micGain === 'auto' ? '✓ Automatique' : 'Automatique : non (gain fixe)'} on={micGain === 'auto'} onPress={() => setMicGain((g) => (g === 'auto' ? 4 : 'auto'))} />
        <Hint>
          Auto amplifie fortement la voix faible ou lointaine (jusqu'à ×60) sans amplifier le bruit. Évitez les gains fixes élevés (×16, ×32) : ils font saturer la voix dès qu'elle monte, ce qui fait rater des mots.
          La barre de volume s'affiche pendant l'enregistrement.
        </Hint>
        <Text style={styles.label}>Où entendre chaque langue</Text>
        <View style={styles.chips}>
          {Object.entries(OUTPUT_MODES).map(([key, m]) => (
            <Chip key={key} label={m.label} on={outputMode === key} onPress={() => setOutputMode(key)} />
          ))}
        </View>
        <Hint>
          {OUTPUT_MODES[outputMode].hint}.
          {outputMode === 'split'
            ? ' Langue A = vous (casque), langue B = la personne en face (haut-parleur). Posez le téléphone entre vous deux et gardez le micro du téléphone. Le haut-parleur reparle dans le micro : avec OpenAI, Gemini et Doubao le micro est coupé pendant sa lecture ; avec Mistral et le mode Classique le texte déjà lu est reconnu et ignoré. Sans casque, les deux voix sortent sur le haut-parleur.'
            : ''}
        </Hint>

        {strategy === 'mistral' && (
          <>
            <Text style={styles.label}>Qui traduit dans Mistral live</Text>
            <View style={styles.chips}>
              <Chip label="Auto (Mistral, DeepL s'il refuse)" on={mistralTranslator === 'auto'} onPress={() => setMistralTranslator('auto')} />
              <Chip label="Toujours DeepL" on={mistralTranslator === 'deepl'} onPress={() => setMistralTranslator('deepl')} />
              <Chip label="Toujours Mistral" on={mistralTranslator === 'mistral'} onPress={() => setMistralTranslator('mistral')} />
            </View>
            <Hint>
              La reconnaissance et la voix restent celles de Mistral. Pour la traduction, DeepL (votre clé DeepL, saisie pour le mode Classique) évite les limites des modèles de Mistral : il reconnaît lui-même la langue de chaque phrase. « Auto » essaie d'abord Mistral et prend DeepL quand Mistral refuse (limite, modèle absent de votre abonnement). « Toujours DeepL » est le plus fiable si votre compte Mistral est limité.
            </Hint>
            <Text style={styles.label}>Qualité de la traduction (Mistral live)</Text>
            <View style={styles.chips}>
              <Chip label="Meilleure (modèle moyen d'abord)" on={mistralQuality === 'best'} onPress={() => setMistralQuality('best')} />
              <Chip label="Plus rapide" on={mistralQuality === 'fast'} onPress={() => setMistralQuality('fast')} />
            </View>
            <Hint>
              « Meilleure » demande d'abord le modèle moyen de Mistral (plus juste en chinois, avec les noms et les longues phrases) et passe automatiquement aux petits si votre compte est limité. « Plus rapide » part du petit modèle : si le retard vous gêne, choisissez-le.
            </Hint>
            <Text style={styles.label}>Contexte de la conversation</Text>
            <Chip label={mistralAutoContext ? 'Détecté automatiquement (sujet, noms, termes)' : 'Détection automatique désactivée'} on={mistralAutoContext} onPress={() => setMistralAutoContext((v) => !v)} />
            <Hint>
              Toutes les quelques phrases, Mistral relit ce qui vient d'être dit et tient à jour des notes : de quoi on parle, comment s'écrivent les noms de marques ou de personnes (même mal entendus), quel mot choisir pour chaque terme technique. Ces notes sont données au traducteur avec chaque phrase, et gardées une demi-heure si vous relancez l'écoute. Le journal écrit « contexte détecté ». Cela ajoute un petit appel toutes les 40 secondes au plus.
            </Hint>
            <Text style={styles.label}>Termes à ajouter vous-même (facultatif)</Text>
            <TextInput
              style={[styles.input, { minHeight: 70 }]}
              value={mistralGlossary}
              onChangeText={setMistralGlossary}
              multiline
              maxLength={600}
              placeholder="ex. Réunion sur des brevets d'impression 3D résine. Garder tels quels : Formlabs, Carbon, CDOM. « film » = film de décollement."
              placeholderTextColor={palette().placeholder}
            />
            <Hint>
              Facultatif : ce que vous écrivez ici s'ajoute à ce qui est détecté (600 caractères au plus). Utile pour un nom que vous savez à l'avance.
            </Hint>
            <Text style={styles.label}>Voix de Mistral live</Text>
            <Chip label={elevenVoiceForAll ? 'Mes voix ElevenLabs pour toutes les langues' : 'Voix Mistral (ElevenLabs seulement en secours)'} on={elevenVoiceForAll} onPress={() => setElevenVoiceForAll((v) => !v)} />
            <Hint>
              Mistral parle 9 langues avec ses voix prédéfinies. Activée, cette option fait parler **toutes** les langues par vos voix ElevenLabs (les deux voix des réglages, clonées si vous les avez clonées) : il faut une clé ElevenLabs. Sinon ElevenLabs ne prend le relais que pour le chinois, le japonais…
            </Hint>
          </>
        )}

        <Text style={styles.label}>Connexion faible débit</Text>
        <Chip label={lowBandwidth ? 'Mode faible débit activé' : 'Mode faible débit désactivé'} on={lowBandwidth} onPress={() => setLowBandwidth((v) => !v)} />
        <Hint>
          Pour un réseau lent ou instable. L'appli n'envoie plus le son pendant que personne ne parle (une demi-seconde de son avant la voix et deux secondes de silence après sont conservées pour que la fin des phrases soit bien comprise), ce qui réduit fortement les données envoyées. Avec Mistral : voix ElevenLabs plus légère, deux fois plus de patience avant d'abandonner une demande, et pas d'appel de fond pour le contexte. Le journal indique la part du son réellement envoyée. Les phrases en retard sont de toute façon affichées avant leur voix.
        </Hint>

        <Text style={styles.label}>Mains libres : écho</Text>
        <Chip
          label={muteWwp(muteWhilePlaying)}
          on={muteWhilePlaying}
          onPress={() => setMuteWhilePlaying((v) => !v)}
        />
        <Hint>
          Coupe l'écoute pendant que la voix traduite est lue (et une demi-seconde après) : plus aucun risque que l'app se réécoute. En
          contrepartie, ce que l'on dit pendant la lecture n'est pas traduit : avec quelqu'un qui parle sans s'arrêter (radio, exposé),
          une grande partie des phrases est perdue. À n'activer que sans écouteurs, avec des interlocuteurs qui attendent la fin de la voix.
        </Hint>
        </Section>

        <Section title="Voix" subtitle={`${t('volume {v}', { v: voiceVolume === 1 ? t('normal') : `×${voiceVolume}` })}${live ? '' : ' · ElevenLabs'}`} open={!!openSection.voice} onToggle={() => toggle('voice')}>
        <Text style={styles.label}>Volume de la voix traduite</Text>
        <View style={styles.chips}>
          {VOICE_VOLUME_CHOICES.map((v) => (
            <Chip key={String(v)} label={v === 1 ? 'Normal' : `×${v}`} on={voiceVolume === v} onPress={() => setVoiceVolume(v)} />
          ))}
        </View>
        <Hint>
          Amplifie la voix dans les écouteurs sans la déformer. Pensez aussi à monter le volume « média » du téléphone et des écouteurs.
        </Hint>
        {!live && (<>
        <Text style={styles.label}>Réactivité de la traduction</Text>
        <View style={styles.chips}>
          {Object.entries(SPEEDS).map(([key, v]) => (
            <Chip key={key} label={v.label} on={speed === key} onPress={() => setSpeed(key)} />
          ))}
        </View>
        <Hint>
          « Rapide » lance la traduction après une pause plus courte et coupe les phrases plus tôt : la voix arrive plus vite, avec des
          morceaux de phrase plus courts (traduction un peu moins fluide). « Normale » attend des phrases plus naturelles.
        </Hint>
        </>)}
        {!live && (<>
        <Text style={styles.label}>Voix en flux (expérimental)</Text>
        <Chip
          label={streamVoice ? '✓ Commencer à parler avant la fin de la synthèse' : 'Voix en flux : non'}
          on={streamVoice}
          onPress={() => setStreamVoice((v) => !v)}
        />
        <Hint>
          La traduction démarre dans les écouteurs dès les premiers mots synthétisés au lieu d'attendre la phrase entière : le délai
          baisse, surtout sur les longues phrases. Si la voix saute ou se coupe, désactivez-la (le mode classique reprend aussi tout seul
          si le flux ne marche pas).
        </Hint>
        </>)}
        {!live && (<>
        <Text style={styles.label}>À qui appartient la voix ?</Text>
        <Chip
          label={voiceBySpeaker ? '✓ Voix liée à la personne qui parle' : 'Voix liée à la langue entendue (par défaut)'}
          on={voiceBySpeaker}
          onPress={() => setVoiceBySpeaker((v) => !v)}
        />
        <Hint>
          Par défaut, la voix A sert à parler la langue A et la voix B la langue B. Activez cette option pour que la voix A soit celle de la
          personne côté A — par exemple votre propre voix, créée dans ElevenLabs — qui « dit » alors ses traductions dans la langue de l'autre.
        </Hint>

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
                <Select
                  value={values[field]?.trim() || null}
                  onChange={(id) => setValues((cur) => ({ ...cur, [field]: id ?? '' }))}
                  placeholder={t('Choisir une voix')}
                  options={[
                    ...(values[field]?.trim() && !voices.some((v) => v.id === values[field].trim()) ? [{ id: values[field].trim(), label: `${t('Voix saisie')} · ${values[field].trim().slice(0, 10)}…` }] : []),
                    ...voices.map((v) => ({ id: v.id, label: v.name, hint: v.hint })),
                  ]}
                />
              </Fragment>
            ))}
            <Hint>
              Une voix différente pour chaque langue permet de savoir tout de suite qui « parle » dans les écouteurs.
            </Hint>
          </>
        )}
        <VoiceCloneCard
          apiKey={values.EXPO_PUBLIC_ELEVENLABS_API_KEY}
          settings={settings}
          onCreated={(voice) => setVoices((cur) => [voice, ...(cur ?? []).filter((v) => v.id !== voice.id)])}
        />
        </>)}
        </Section>

        <Section title="Apparence" subtitle={THEME_CHOICES[theme].label} open={!!openSection.look} onToggle={() => toggle('look')}>
          <View style={styles.chips}>
            {Object.entries(THEME_CHOICES).map(([key, choice]) => (
              <Chip
                key={key}
                label={choice.hint ? `${t(choice.label)} (${t(choice.hint)})` : t(choice.label)}
                on={theme === key}
                onPress={() => {
                  setThemeChoice(key);
                  onPreviewTheme?.(key); // the whole app changes at once, to see it before saving
                }}
              />
            ))}
          </View>
        </Section>

        <Section title="Arrière-plan" subtitle={background ? 'actif écran éteint' : 'désactivé'} open={!!openSection.bg} onToggle={() => toggle('bg')}>
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
        <Hint>
          Affiche une notification permanente. Si la traduction ne fonctionne plus, essayez de le désactiver.
        </Hint>
        {Power.available && (
          <>
            <Pressable
              style={[styles.chip, { alignSelf: 'flex-start' }]}
              onPress={() => Power.requestIgnoreBatteryOptimizations()}
              accessibilityRole="button"
            >
              <Text style={styles.chipText}>🔋 Autoriser sans limite de batterie</Text>
            </Pressable>
            <Hint>
              Recommandé pour que la traduction continue écran éteint : Android limite sinon les apps en veille.
            </Hint>
          </>
        )}
        </Section>
      </ScrollView>
      <View style={styles.footer}>
        <Pressable
          style={[styles.button, !complete && styles.disabled]}
          disabled={!complete || saving}
          onPress={async () => {
            setSaving(true);
            await saveKeys(values);
            const saved = await saveSettings({ ...settings, strategy, languages, background, micGain, voiceVolume, input, micSource, micAgc, streamVoice, speed, muteWhilePlaying, outputMode, elevenVoiceForAll, mistralQuality, mistralGlossary, mistralAutoContext, mistralTranslator, lowBandwidth, voiceBySpeaker, theme, uiLang, doubaoVoiceKind, doubaoVoices, mistralVoices, recentPairs: rememberPair(settings.recentPairs, languages) });
            setSaving(false);
            onDone(saved);
          }}
        >
          <Text style={styles.buttonText}>Enregistrer</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const muteWwp = (on) => (on ? '✓ Couper le micro pendant la voix traduite' : 'Couper le micro pendant la voix traduite : non');

/** A card that folds: title + one line of what is set, tap to open. */
function Section({ title, subtitle, open, onToggle, children }) {
  return (
    <View style={styles.card}>
      <Pressable onPress={onToggle} style={styles.cardHead} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View style={styles.cardHeadText}>
          <Text style={styles.cardTitle}>{title}</Text>
          {!!subtitle && !open && (
            <Text style={styles.cardSub} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>
        <View style={open ? styles.chevronOpen : null}>
          <Icon name="chevron" size={18} color={palette().textMuted} />
        </View>
      </Pressable>
      {open && <View style={styles.cardBody}>{children}</View>}
    </View>
  );
}

function SummaryLine({ label, value, good, bad }) {
  return (
    <View style={styles.summaryLine}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, good && styles.summaryGood, bad && styles.summaryBad]} numberOfLines={1}>
        {value}
      </Text>
    </View>
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

const styles = themedStyles((c) => StyleSheet.create({
  section: { color: c.text, fontSize: 18, fontWeight: '700', marginTop: 24 },
  summary: { backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, borderRadius: 20, padding: 16, marginTop: 16, gap: 8, ...cardShadow(c) },
  flags: { marginTop: 12, marginBottom: 4 },
  summaryLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  summaryLabel: { color: c.textMuted, fontSize: 14, width: 84 },
  summaryValue: { color: c.text, fontSize: 15, fontWeight: '600', flex: 1 },
  summaryGood: { color: c.success },
  summaryBad: { color: c.danger },
  card: { backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, borderRadius: 20, marginTop: 12, overflow: 'hidden', ...cardShadow(c) },
  cardHead: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  cardHeadText: { flex: 1 },
  cardTitle: { color: c.text, fontSize: 17, fontWeight: '600', letterSpacing: -0.2 },
  cardSub: { color: c.textMuted, fontSize: 13, marginTop: 2 },
  chevronOpen: { transform: [{ rotate: '90deg' }] },
  voiceRow: { gap: 4, marginBottom: 6 },
  gainHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  labelInline: { color: c.textSoft, fontSize: 14 },
  gainValue: { color: c.accent, fontSize: 15, fontWeight: '700', fontFamily: 'monospace' },
  cardBody: { paddingHorizontal: 16, paddingBottom: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  footer: { padding: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.bg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: c.inset, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 15 },
  chipOn: { backgroundColor: c.accentSoft, borderColor: c.accent },
  chipText: { color: c.text, fontSize: 15 },
  root: { flex: 1, backgroundColor: c.bg },
  content: { padding: 20, paddingTop: 48, paddingBottom: 24 },
  title: { color: c.text, fontSize: 34, fontWeight: '700', letterSpacing: -0.8 },
  hint: { color: c.textMuted, fontSize: 15, marginVertical: 12 },
  label: { color: c.textSoft, fontSize: 13, fontWeight: '600', marginTop: 18, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: c.inset, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, color: c.text, borderRadius: 14, padding: 14, fontSize: 16 },
  button: { backgroundColor: c.accent, borderRadius: 999, padding: 16, alignItems: 'center' },
  disabled: { opacity: 0.4 },
  good: { color: c.success, fontSize: 15, marginTop: 8 },
  bad: { color: c.danger, fontSize: 15, marginTop: 8 },
  buttonText: { color: c.onAccent, fontSize: 17, fontWeight: '700' },
}));
