import { useRef, useState } from 'react';
import { Alert, Image, Pressable, Share, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { env } from '../config/env';
import { Plain, Text } from '../i18n/Text';
import { t } from '../i18n';
import { ask } from '../services/LlmService';
import { describeError } from '../utils/http';
import { imageDataUrl, parsePhotoLines, photoLinesText, photoMessages } from '../utils/photoText';
import { palette, themedStyles } from '../theme';
import Icon from './Icon';
import { Card, PrimaryButton } from './ui';

const PICK = { mediaTypes: ['images'], base64: true, quality: 0.5, allowsEditing: true, exif: false };

/** "Photo" mode of the text tab: a picture of a sign, menu or page → its text read and translated by a vision model. */
export default function PhotoPanel({ from, to, onWord }) {
  const c = palette();
  const [uri, setUri] = useState(null);
  const [lines, setLines] = useState(null); // null = nothing yet, [] = no text found
  const [busy, setBusy] = useState(false);
  const run = useRef(0);

  const translate = async (asset) => {
    const id = ++run.current;
    setUri(asset.uri);
    setLines(null);
    setBusy(true);
    try {
      const answer = await ask(photoMessages(imageDataUrl(asset.base64, asset.mimeType), { fromLabel: from.label, toLabel: to.label }), { maxTokens: 3000 });
      if (id === run.current) setLines(parsePhotoLines(answer));
    } catch (error) {
      if (id === run.current) Alert.alert(t('Traduction impossible'), describeError(error));
    }
    if (id === run.current) setBusy(false);
  };

  const pick = async (camera) => {
    if (busy) return;
    if (!env.openRouterKey) {
      Alert.alert(t('Clé manquante'), t('Ajoutez votre clé OpenRouter dans ⚙︎ → Clés API pour traduire une photo.'));
      return;
    }
    try {
      if (camera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(t('Caméra refusée'), t('Autorisez la caméra dans les réglages du téléphone, ou choisissez une image de la galerie.'));
          return;
        }
      }
      const result = camera ? await ImagePicker.launchCameraAsync(PICK) : await ImagePicker.launchImageLibraryAsync(PICK);
      const asset = result.canceled ? null : result.assets?.[0];
      if (asset?.base64) translate(asset);
      else if (asset) Alert.alert(t('Image illisible'), t('Cette image n’a pas pu être lue. Essayez-en une autre.'));
    } catch (error) {
      Alert.alert(t('Photo impossible'), describeError(error));
    }
  };

  const reset = () => {
    run.current++;
    setUri(null);
    setLines(null);
    setBusy(false);
  };

  return (
    <>
      <View style={styles.buttons}>
        <View style={styles.grow}>
          <PrimaryButton label="Prendre une photo" icon="camera" onPress={() => pick(true)} busy={busy} />
        </View>
        <Pressable onPress={() => pick(false)} disabled={busy} accessibilityRole="button" style={[styles.gallery, busy && { opacity: 0.5 }]}>
          <Icon name="image" size={20} color={c.accent} />
          <Text style={styles.galleryText}>Galerie</Text>
        </Pressable>
      </View>

      {!uri && <Text style={styles.empty}>Photographiez un panneau, un menu, une étiquette ou une page : le texte est lu puis traduit. Vous pouvez recadrer l’image pour ne garder que la partie utile.</Text>}

      {!!uri && (
        <Card style={styles.preview}>
          <Image source={{ uri }} style={styles.image} resizeMode="contain" accessibilityIgnoresInvertColors />
          <Pressable onPress={reset} hitSlop={10} accessibilityRole="button" style={styles.ghost}>
            <Icon name="close" size={14} color={c.textMuted} />
            <Text style={styles.ghostText}>Effacer</Text>
          </Pressable>
        </Card>
      )}

      {busy && <Text style={styles.wait}>Lecture et traduction de l’image…</Text>}

      {lines && !lines.length && <Text style={styles.empty}>Aucun texte lisible trouvé dans cette image.</Text>}

      {!!lines?.length && (
        <>
          <Card style={styles.results}>
            {lines.map((l, i) => (
              <View key={i} style={[styles.line, i > 0 && styles.lineBorder]}>
                <Plain style={styles.translation} selectable>{l.translation || l.source}</Plain>
                {!!l.source && !!l.translation && <Plain style={styles.source} selectable>{l.source}</Plain>}
                {!!l.source && !!onWord && (
                  <Pressable onPress={() => onWord(l.source)} hitSlop={8} accessibilityRole="button" style={styles.ghost}>
                    <Icon name="bookmark" size={15} color={c.accent} />
                    <Text style={[styles.ghostText, { color: c.accent }]}>Voir en fiche</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </Card>
          <Pressable onPress={() => Share.share({ message: photoLinesText(lines) }).catch(() => {})} hitSlop={10} accessibilityRole="button" style={styles.ghost}>
            <Icon name="share" size={16} color={c.accent} />
            <Text style={[styles.ghostText, { color: c.accent }]}>Partager / copier tout</Text>
          </Pressable>
          <Text style={styles.empty}>Texte lu et traduit par un modèle de langage : vérifiez les mots importants (prix, doses, adresses).</Text>
        </>
      )}
    </>
  );
}

const styles = themedStyles((c) => StyleSheet.create({
  buttons: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1 },
  gallery: { height: 54, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, borderRadius: 27, backgroundColor: c.accentSoft },
  galleryText: { color: c.accent, fontSize: 16, fontWeight: '600' },
  empty: { color: c.textMuted, fontSize: 14, lineHeight: 20 },
  wait: { color: c.textMuted, fontSize: 15 },
  preview: { gap: 10 },
  image: { width: '100%', height: 220, borderRadius: 12 },
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  ghostText: { color: c.textMuted, fontSize: 14, fontWeight: '500' },
  results: { paddingVertical: 4 },
  line: { gap: 4, paddingVertical: 12 },
  lineBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  translation: { color: c.cyan, fontSize: 20, lineHeight: 28, fontWeight: '600' },
  source: { color: c.textMuted, fontSize: 14, lineHeight: 20 },
}));
