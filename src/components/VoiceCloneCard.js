import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { env } from '../config/env';
import VoiceSampleRecorder from '../services/VoiceSampleRecorder';
import { describeError } from '../utils/http';
import { CLONE_GOOD_SEC, CLONE_MIN_SEC, CONSENT_TEXT, sampleHint, sampleQuality } from '../utils/voiceClone';
import { palette, themedStyles } from '../theme';

/**
 * Record about a minute of a voice and create an ElevenLabs clone from it.
 * @param {{apiKey: string, settings: object, onCreated: (voice: {id: string, name: string}) => void}} props
 */
export default function VoiceCloneCard({ apiKey, settings, onCreated }) {
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | recording | recorded | sending
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const recorder = useRef(null);
  const c = palette();

  useEffect(() => () => recorder.current?.discard(), []);

  const start = async () => {
    setError('');
    setMessage('');
    setSeconds(0);
    const rec = new VoiceSampleRecorder({
      settings,
      onUpdate: ({ seconds: s, level: l, done }) => {
        setSeconds(s);
        setLevel(l);
        if (done) setPhase('recorded');
      },
    });
    recorder.current = rec;
    try {
      await rec.start();
      setPhase('recording');
    } catch (e) {
      setError(describeError(e));
      setPhase('idle');
    }
  };

  const stop = async () => {
    setSeconds(await recorder.current.finish());
    setLevel(0);
    setPhase('recorded');
  };

  const send = async () => {
    setPhase('sending');
    setError('');
    try {
      const { voiceId } = await recorder.current.upload({ apiKey, base: env.elevenLabsBaseUrl, name });
      const label = name.trim() || 'Ma voix';
      setMessage(`✓ Voix « ${label} » créée. Choisissez-la ci-dessus pour la langue A ou B.`);
      onCreated({ id: voiceId, name: label, hint: 'clonée' });
      await recorder.current.discard();
      recorder.current = null;
      setName('');
      setSeconds(0);
      setPhase('idle');
    } catch (e) {
      setError(describeError(e));
      setPhase('recorded');
    }
  };

  const quality = sampleQuality(seconds);
  const canRecord = consent && !!apiKey?.trim() && (phase === 'idle' || phase === 'recorded');
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Cloner une voix</Text>
      <Text style={styles.hint}>
        Parlez environ une minute (texte libre, endroit calme). ElevenLabs crée la voix, que vous utilisez ensuite comme n'importe quelle autre.
      </Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Nom de la voix (ex. Arnaud)"
        placeholderTextColor={c.placeholder}
        editable={phase !== 'recording' && phase !== 'sending'}
      />
      <Pressable style={styles.consentRow} onPress={() => setConsent((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: consent }}>
        <Text style={[styles.box, consent && styles.boxOn]}>{consent ? '✓' : ''}</Text>
        <Text style={styles.consentText}>{CONSENT_TEXT}</Text>
      </Pressable>

      {phase === 'recording' && (
        <>
          <View style={styles.meter}>
            <View style={[styles.meterFill, { width: `${Math.round(Math.min(1, level * 3) * 100)}%` }]} />
          </View>
          <Text style={styles.timer}>
            {Math.floor(seconds)} s / {CLONE_GOOD_SEC} s
          </Text>
          <Text style={[styles.hint, quality !== 'short' && { color: c.success }]}>{sampleHint(seconds)}</Text>
          <Pressable style={styles.danger} onPress={stop}>
            <Text style={styles.dangerText}>■ Arrêter</Text>
          </Pressable>
        </>
      )}
      {phase === 'recorded' && (
        <Text style={[styles.hint, quality === 'short' && { color: c.danger }]}>
          {Math.floor(seconds)} s enregistrées{quality === 'short' ? ` — il en faut au moins ${CLONE_MIN_SEC}` : ''}
        </Text>
      )}
      {phase === 'sending' && <Text style={styles.hint}>Envoi à ElevenLabs…</Text>}

      <View style={styles.row}>
        {(phase === 'idle' || phase === 'recorded') && (
          <Pressable style={[styles.chip, !canRecord && styles.disabled]} disabled={!canRecord} onPress={start}>
            <Text style={styles.chipText}>{phase === 'recorded' ? '🎙 Recommencer' : '🎙 Enregistrer'}</Text>
          </Pressable>
        )}
        {phase === 'recorded' && quality !== 'short' && (
          <Pressable style={styles.primary} onPress={send}>
            <Text style={styles.primaryText}>Créer la voix</Text>
          </Pressable>
        )}
      </View>
      {!consent && <Text style={styles.hint}>Cochez la case ci-dessus pour activer l'enregistrement.</Text>}
      {!apiKey?.trim() && <Text style={styles.hint}>Renseignez d'abord la clé ElevenLabs.</Text>}
      {!!message && <Text style={styles.ok}>{message}</Text>}
      {!!error && <Text style={styles.bad}>{error}</Text>}
    </View>
  );
}

const styles = themedStyles((c) =>
  StyleSheet.create({
    card: { backgroundColor: c.inset, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 14, marginTop: 20 },
    title: { color: c.text, fontSize: 17, fontWeight: '600' },
    hint: { color: c.textMuted, fontSize: 14, marginVertical: 8 },
    input: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 10, color: c.text, fontSize: 16, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6 },
    consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 12 },
    box: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: c.textMuted, color: c.onAccent, textAlign: 'center', lineHeight: 22, fontSize: 16 },
    boxOn: { backgroundColor: c.accent, borderColor: c.accent },
    consentText: { flex: 1, color: c.textBody, fontSize: 14 },
    meter: { height: 8, borderRadius: 4, backgroundColor: c.track, overflow: 'hidden', marginTop: 14 },
    meterFill: { height: 8, backgroundColor: c.rec },
    timer: { color: c.text, fontSize: 22, fontWeight: '600', marginTop: 8 },
    row: { flexDirection: 'row', gap: 10, marginTop: 10, flexWrap: 'wrap' },
    chip: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14 },
    chipText: { color: c.text, fontSize: 15 },
    disabled: { opacity: 0.4 },
    primary: { backgroundColor: c.accent, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 16 },
    primaryText: { color: c.onAccent, fontSize: 15, fontWeight: '600' },
    danger: { backgroundColor: c.dangerBg, borderWidth: 1, borderColor: c.danger, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 16, alignSelf: 'flex-start', marginTop: 4 },
    dangerText: { color: c.danger, fontSize: 15, fontWeight: '600' },
    ok: { color: c.success, fontSize: 15, marginTop: 8 },
    bad: { color: c.danger, fontSize: 15, marginTop: 8 },
  }),
);
