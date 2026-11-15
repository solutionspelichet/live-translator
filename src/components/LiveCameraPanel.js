import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import TextRecognition from '@react-native-ml-kit/text-recognition';

import { Plain, Text } from '../i18n/Text';
import { t } from '../i18n';
import { env } from '../config/env';
import { translateTexts } from '../services/LiveTextTranslator';
import { describeError } from '../utils/http';
import { blocksToItems, fitFontSize, mapFrame, scriptFor, TranslationCache, trackItems, uprightSize } from '../utils/liveOcr';
import { palette, themedStyles } from '../theme';
import Icon from './Icon';
import { PrimaryButton } from './ui';

const PAUSE_MS = 250; // between two pictures
const VIEW_HEIGHT = 440;

/**
 * "Direct" mode: the camera takes a picture about once a second, the phone reads its text (ML Kit, offline), the new
 * texts are translated (one DeepL request for all of them) and drawn over the live image, where the original text is.
 */
export default function LiveCameraPanel({ from, to, fromKey, toKey, onWord }) {
  const c = palette();
  const [permission, requestPermission] = useCameraPermissions();
  const [on, setOn] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [boxes, setBoxes] = useState([]); // [{ key, text, translation, left, top, width, height }]
  const [status, setStatus] = useState('');
  const camera = useRef(null);
  const size = useRef({ width: 0, height: 0 });
  const cache = useRef(new TranslationCache());
  const tracked = useRef([]);
  const frameNo = useRef(0);
  const loop = useRef(0); // identity of the running loop: a new one (or stop) ends the previous
  const script = scriptFor(fromKey);

  useEffect(() => () => { loop.current++; }, []);
  // a new pair of languages: the remembered translations are for the old pair
  useEffect(() => {
    cache.current = new TranslationCache();
    tracked.current = [];
    setBoxes([]);
  }, [fromKey, toKey]);

  const draw = (items) => {
    setBoxes(
      items
        .filter((i) => cache.current.has(i.key) && cache.current.get(i.key))
        .map((i) => ({ key: i.key, text: i.text, translation: cache.current.get(i.key), ...i.frameView })),
    );
  };

  const step = async (id) => {
    const view = size.current;
    if (!camera.current || !view.width) return;
    const pic = await camera.current.takePictureAsync({ quality: 0.3, shutterSound: false, skipProcessing: false, exif: false });
    if (id !== loop.current) return;
    const result = await TextRecognition.recognize(pic.uri, script);
    if (id !== loop.current) return;
    const image = uprightSize(pic.width, pic.height, view.width, view.height);
    const items = blocksToItems(result.blocks).map((i) => ({ ...i, frameView: mapFrame(i.frame, image, view) }));
    frameNo.current += 1;
    tracked.current = trackItems(tracked.current, items, frameNo.current);
    // the position follows the latest picture; the text and its translation are remembered
    const fresh = tracked.current.filter((i) => !cache.current.has(i.key));
    draw(tracked.current);
    if (fresh.length) {
      const unique = [...new Map(fresh.map((i) => [i.key, i.text])).entries()].slice(0, 20);
      const translations = await translateTexts(unique.map(([, text]) => text), fromKey, toKey);
      if (id !== loop.current) return;
      unique.forEach(([key], n) => cache.current.set(key, translations[n] || ''));
      draw(tracked.current);
    }
    setStatus(tracked.current.length ? '' : t('Pointez la caméra vers un texte.'));
  };

  const start = async () => {
    if (!script) return;
    if (!env.deeplKey && !env.openRouterKey) {
      Alert.alert(t('Clé manquante'), t('Ajoutez votre clé DeepL (ou OpenRouter) dans ⚙︎ → Clés API pour traduire avec la caméra.'));
      return;
    }
    if (!permission?.granted) {
      const r = await requestPermission();
      if (!r.granted) {
        Alert.alert(t('Caméra refusée'), t('Autorisez la caméra dans les réglages du téléphone, ou choisissez une image de la galerie.'));
        return;
      }
    }
    const id = ++loop.current;
    setOn(true);
    setFrozen(false);
    setStatus(t('Pointez la caméra vers un texte.'));
    let failures = 0;
    while (id === loop.current) {
      try {
        await step(id);
        failures = 0;
      } catch (error) {
        failures += 1;
        if (failures >= 3) {
          loop.current++;
          setOn(false);
          Alert.alert(t('Traduction impossible'), describeError(error));
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    }
  };

  const stop = () => {
    loop.current++;
    setOn(false);
    setFrozen(false);
    setBoxes([]);
    tracked.current = [];
    setStatus('');
  };

  const freeze = () => {
    loop.current++; // stops taking pictures; the translations stay on the screen
    setFrozen(true);
  };

  if (!script) {
    return <Text style={styles.note}>La caméra en direct lit le texte en alphabet latin, chinois, japonais, coréen et devanagari. Pour cette langue, utilisez l’onglet Photo.</Text>;
  }

  return (
    <>
      <View style={styles.frame} onLayout={(e) => { size.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height }; }}>
        {on || frozen ? (
          <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" animateShutter={false} />
        ) : (
          <View style={styles.idle}>
            <Icon name="camera" size={34} color={c.textFaint} />
            <Text style={styles.idleText}>La traduction s’affiche sur le texte, en direct.</Text>
          </View>
        )}
        {boxes.map((b) => (
          <Pressable
            key={b.key}
            onPress={() => onWord?.(b.text)}
            style={[styles.box, { left: Math.max(0, b.left), top: Math.max(0, b.top), width: Math.max(40, b.width), minHeight: b.height }]}
          >
            <Plain style={[styles.boxText, { fontSize: fitFontSize(b.translation, b) }]}>{b.translation}</Plain>
          </Pressable>
        ))}
        {!!status && on && <Text style={styles.status}>{status}</Text>}
      </View>

      {on || frozen ? (
        <View style={styles.row}>
          {!frozen ? (
            <Pressable onPress={freeze} accessibilityRole="button" style={styles.secondary}>
              <Icon name="record" size={16} color={c.accent} />
              <Text style={styles.secondaryText}>Figer</Text>
            </Pressable>
          ) : (
            <Pressable onPress={start} accessibilityRole="button" style={styles.secondary}>
              <Icon name="rotate" size={16} color={c.accent} />
              <Text style={styles.secondaryText}>Reprendre</Text>
            </Pressable>
          )}
          <Pressable onPress={stop} accessibilityRole="button" style={styles.secondary}>
            <Icon name="close" size={16} color={c.accent} />
            <Text style={styles.secondaryText}>Arrêter</Text>
          </Pressable>
        </View>
      ) : (
        <PrimaryButton label="Lancer la caméra" icon="camera" onPress={start} />
      )}
      <Text style={styles.note}>Touchez une traduction pour l’ouvrir en fiche. Texte lu par le téléphone puis traduit : vérifiez les mots importants. Pour un texte flou ou long, l’onglet Photo est plus fiable.</Text>
    </>
  );
}

const styles = themedStyles((c) => StyleSheet.create({
  frame: { height: VIEW_HEIGHT, borderRadius: 20, overflow: 'hidden', backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
  idle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  idleText: { color: c.textMuted, fontSize: 15, textAlign: 'center' },
  box: { position: 'absolute', backgroundColor: 'rgba(10,11,16,0.82)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2, justifyContent: 'center' },
  boxText: { color: '#FFFFFF', fontWeight: '600' },
  status: { position: 'absolute', bottom: 12, alignSelf: 'center', color: '#FFFFFF', backgroundColor: 'rgba(10,11,16,0.6)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, fontSize: 13, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: 10 },
  secondary: { flex: 1, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 24, backgroundColor: c.accentSoft },
  secondaryText: { color: c.accent, fontSize: 16, fontWeight: '600' },
  note: { color: c.textMuted, fontSize: 14, lineHeight: 20 },
}));
