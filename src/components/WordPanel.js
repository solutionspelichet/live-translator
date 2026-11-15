import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, View } from 'react-native';

import { env } from '../config/env';
import { Plain, Text, TextInput } from '../i18n/Text';
import { t } from '../i18n';
import { getLanguage } from '../config/languages';
import { ask } from '../services/LlmService';
import DeepLClient from '../services/translate/DeepLClient';
import UsageTracker from '../services/UsageTracker';
import WordStore from '../services/WordStore';
import { deleteWordAudio, loadWordAudio, playWord, saveWordAudio, shareWordAudio, stopWord, synthesizeWord, voiceFor } from '../services/WordAudio';
import { describeError } from '../utils/http';
import { translationMessages } from '../utils/tools';
import { addCard, cardKey, cardText, cleanWord, defaultStyle, filterCards, parsePhonetic, PHONETIC_STYLES, phoneticMessages, removeCard, stylesFor, validStyle } from '../utils/wordCard';
import { palette, themedStyles } from '../theme';
import Icon from './Icon';
import { Card, Pill, PrimaryButton } from './ui';

const hasVoice = () => Boolean(env.elevenLabsKey && (env.voiceA || env.voiceB));

/** "Mot" mode of the text tab: a word in language A → translation in B, how to say it, its sound; saved words are kept in a list. */
export default function WordPanel({ settings, fromKey, toKey, seed }) {
  const c = palette();
  const from = getLanguage(fromKey);
  const to = getLanguage(toKey);
  const [input, setInput] = useState('');
  const [card, setCard] = useState(null); // the card being shown (saved or not)
  const [style, setStyle] = useState(defaultStyle(toKey));
  const [busy, setBusy] = useState(false);
  const [phoneticBusy, setPhoneticBusy] = useState(false);
  const [soundBusy, setSoundBusy] = useState(false);
  const [saved, setSaved] = useState([]);
  const [query, setQuery] = useState('');
  const pcm = useRef(new Map()); // card key → decoded sound, for this session
  const run = useRef(0); // a newer lookup makes the older one stop updating the screen

  // A text sent from the photo tab: put it in the box and look it up.
  useEffect(() => {
    if (seed?.text) {
      setInput(cleanWord(seed.text));
      setCard(null);
    }
  }, [seed?.n]);

  useEffect(() => {
    WordStore.load().then(setSaved);
    return () => stopWord();
  }, []);

  const persist = (next) => {
    setSaved(next);
    WordStore.save(next);
  };

  const phoneticOf = async (text, lang, st) => {
    if (!env.openRouterKey) return '';
    return parsePhonetic(await ask(phoneticMessages(text, { toLang: lang, toLabel: getLanguage(lang).label, ui: 'French', style: st }), { maxTokens: 120 }));
  };

  /** The sound of a card: from memory, from its saved file, or generated (and kept with a saved card). */
  const soundOf = async (cd) => {
    const key = cardKey(cd.fromLang, cd.toLang, cd.source);
    let sound = pcm.current.get(key) ?? loadWordAudio(cd);
    if (!sound) {
      const voiceId = voiceFor(cd.toLang, settings.languages);
      sound = await synthesizeWord(cd.translated, cd.toLang, voiceId);
      const isSaved = saved.some((s) => s.id === cd.id);
      if (isSaved) {
        const uri = saveWordAudio(cd, sound);
        if (uri) persist(saved.map((s) => (s.id === cd.id ? { ...s, audioUri: uri } : s)));
      }
    }
    pcm.current.set(key, sound);
    return sound;
  };

  const speak = async (cd, slow = false) => {
    if (!hasVoice()) {
      Alert.alert(t('Voix indisponible'), t('Ajoutez votre clé ElevenLabs et une voix dans ⚙︎ → Clés API pour écouter les mots.'));
      return;
    }
    setSoundBusy(true);
    try {
      await playWord(await soundOf(cd), { slow });
    } catch (error) {
      Alert.alert(t('Lecture impossible'), describeError(error));
    }
    setSoundBusy(false);
  };

  const lookup = async () => {
    const word = cleanWord(input);
    if (!word || busy) return;
    const id = ++run.current;
    setBusy(true);
    stopWord();
    setCard(null);
    try {
      const translated = env.deeplKey
        ? await new DeepLClient().translate(word, fromKey, toKey)
        : await ask(translationMessages(word, from.label, to.label), { maxTokens: 400 });
      if (env.deeplKey) UsageTracker.add({ deeplChars: word.length });
      if (id !== run.current) return;
      const st = validStyle(toKey, style);
      const key = cardKey(fromKey, toKey, word);
      const known = saved.find((s) => cardKey(s.fromLang, s.toLang, s.source) === key);
      const cd = known ?? { id: key, fromLang: fromKey, toLang: toKey, source: word, translated: translated.trim(), phonetic: '', style: st, at: Date.now() };
      setStyle(known?.style ?? st);
      setCard(cd);
      setBusy(false);
      if (known) return; // already saved: pronunciation and sound are on the card
      setPhoneticBusy(true);
      try {
        const phonetic = await phoneticOf(cd.translated, cd.toLang, st);
        if (id === run.current) setCard((now) => (now ? { ...now, phonetic } : now));
      } catch {
        // the translation stays; the pronunciation can be asked again with the style chips
      }
      if (id === run.current) setPhoneticBusy(false);
    } catch (error) {
      if (id === run.current) {
        setBusy(false);
        Alert.alert(t('Traduction impossible'), describeError(error));
      }
    }
  };

  const changeStyle = async (st) => {
    if (!card || st === style) return;
    setStyle(st);
    if (!env.openRouterKey) return;
    setPhoneticBusy(true);
    try {
      const phonetic = await phoneticOf(card.translated, card.toLang, st);
      setCard((now) => (now ? { ...now, phonetic, style: st } : now));
      if (saved.some((s) => s.id === card.id)) persist(saved.map((s) => (s.id === card.id ? { ...s, phonetic, style: st } : s)));
    } catch (error) {
      Alert.alert(t('Prononciation impossible'), describeError(error));
    }
    setPhoneticBusy(false);
  };

  const isSaved = card ? saved.some((s) => s.id === card.id) : false;

  const toggleSave = async () => {
    if (!card) return;
    if (isSaved) {
      const gone = saved.find((s) => s.id === card.id);
      if (gone) deleteWordAudio(gone);
      persist(removeCard(saved, card.id));
      return;
    }
    let audioUri;
    try {
      const sound = pcm.current.get(cardKey(card.fromLang, card.toLang, card.source));
      if (sound) audioUri = saveWordAudio(card, sound);
    } catch {}
    const next = { ...card, style, audioUri, at: Date.now() };
    persist(addCard(saved, next));
    setCard(next);
  };

  const shareSound = async (cd) => {
    if (!hasVoice()) return speak(cd);
    setSoundBusy(true);
    try {
      await shareWordAudio(cd, await soundOf(cd));
    } catch (error) {
      Alert.alert(t('Partage impossible'), describeError(error));
    }
    setSoundBusy(false);
  };

  const remove = (cd) => {
    deleteWordAudio(cd);
    pcm.current.delete(cardKey(cd.fromLang, cd.toLang, cd.source));
    persist(removeCard(saved, cd.id));
    if (card?.id === cd.id) setCard({ ...card, audioUri: undefined });
  };

  const list = filterCards(saved, query);

  const actions = (cd) => (
    <View style={styles.actions}>
      <ActionButton icon="speaker" label="Écouter" onPress={() => speak(cd)} busy={soundBusy} />
      <ActionButton icon="rotate" label="Lent" onPress={() => speak(cd, true)} busy={soundBusy} />
      <ActionButton icon="share" label="Fichier audio" onPress={() => shareSound(cd)} busy={soundBusy} />
      <ActionButton icon="text" label="Texte" onPress={() => Share.share({ message: cardText(cd) }).catch(() => {})} />
    </View>
  );

  return (
    <>
      <Card>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={lookup}
          placeholder="Un mot ou une courte phrase"
          placeholderTextColor={c.placeholder}
          autoCapitalize="none"
          returnKeyType="search"
          blurOnSubmit
        />
        <View style={styles.row}>
          <Pressable onPress={() => { setInput(''); setCard(null); }} hitSlop={10} accessibilityRole="button" style={styles.ghost}>
            <Icon name="close" size={14} color={c.textMuted} />
            <Text style={styles.ghostText}>Effacer</Text>
          </Pressable>
        </View>
      </Card>

      <PrimaryButton label="Traduire le mot" icon="sparkles" onPress={lookup} disabled={!cleanWord(input)} busy={busy} />

      {!!card && (
        <Card style={styles.result}>
          <View style={styles.head}>
            <Plain style={styles.flag}>{getLanguage(card.toLang).flag}</Plain>
            <Plain style={styles.small}>{card.source}</Plain>
            <View style={styles.grow} />
            <Pressable onPress={toggleSave} hitSlop={10} accessibilityRole="button" accessibilityLabel={t(isSaved ? 'Retirer des mots enregistrés' : 'Enregistrer ce mot')} style={[styles.save, isSaved && { backgroundColor: c.accentSoft }]}>
              <Icon name="bookmark" size={18} color={isSaved ? c.accent : c.textMuted} />
              <Text style={[styles.saveText, isSaved && { color: c.accent }]}>{isSaved ? 'Enregistré' : 'Enregistrer'}</Text>
            </Pressable>
          </View>
          <Plain style={styles.word} selectable>{card.translated}</Plain>
          {phoneticBusy ? (
            <Text style={styles.phoneticWait}>Prononciation…</Text>
          ) : card.phonetic ? (
            <Plain style={styles.phonetic} selectable>{card.phonetic}</Plain>
          ) : !env.openRouterKey ? (
            <Text style={styles.phoneticWait}>Ajoutez une clé OpenRouter (⚙︎ → Clés API) pour voir la prononciation.</Text>
          ) : null}
          {!!env.openRouterKey && (
            <View style={styles.pills}>
              {stylesFor(card.toLang).map((id) => (
                <Pill key={id} label={t(PHONETIC_STYLES[id])} on={validStyle(card.toLang, style) === id} onPress={() => changeStyle(id)} />
              ))}
            </View>
          )}
          {actions(card)}
          {!hasVoice() && <Text style={styles.phoneticWait}>L’audio demande une clé ElevenLabs et une voix, à régler dans ⚙︎ → Clés API.</Text>}
        </Card>
      )}

      <View style={styles.listHead}>
        <Text style={styles.listTitle}>Mots enregistrés</Text>
        <Plain style={styles.small}>{`${saved.length}`}</Plain>
      </View>
      {saved.length > 4 && (
        <Card>
          <TextInput style={styles.search} value={query} onChangeText={setQuery} placeholder="Chercher un mot" placeholderTextColor={c.placeholder} autoCapitalize="none" />
        </Card>
      )}
      {!saved.length && <Text style={styles.empty}>Les mots que vous enregistrez apparaissent ici, avec leur prononciation et leur audio.</Text>}
      {list.map((cd) => (
        <Card key={cd.id} style={styles.item}>
          <View style={styles.head}>
            <Plain style={styles.flag}>{getLanguage(cd.toLang).flag}</Plain>
            <View style={styles.grow}>
              <Plain style={styles.itemWord}>{cd.translated}</Plain>
              {!!cd.phonetic && <Plain style={styles.itemPhonetic}>{cd.phonetic}</Plain>}
              <Plain style={styles.small}>{cd.source}</Plain>
            </View>
            <Pressable onPress={() => remove(cd)} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('Supprimer')}>
              <Icon name="trash" size={18} color={c.textFaint} />
            </Pressable>
          </View>
          {actions(cd)}
        </Card>
      ))}
    </>
  );
}

function ActionButton({ icon, label, onPress, busy }) {
  const c = palette();
  return (
    <Pressable onPress={onPress} disabled={busy} accessibilityRole="button" style={[styles.action, busy && { opacity: 0.5 }]}>
      <Icon name={icon} size={16} color={c.accent} />
      <Text style={styles.actionText} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = themedStyles((c) => StyleSheet.create({
  input: { color: c.text, fontSize: 22, lineHeight: 30, padding: 0, minHeight: 36 },
  search: { color: c.text, fontSize: 16, padding: 0 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ghostText: { color: c.textMuted, fontSize: 14, fontWeight: '500' },
  result: { gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1 },
  flag: { fontSize: 22 },
  small: { color: c.textMuted, fontSize: 13 },
  save: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 14 },
  saveText: { color: c.textMuted, fontSize: 13, fontWeight: '600' },
  word: { color: c.text, fontSize: 34, lineHeight: 42, fontWeight: '700', letterSpacing: -0.5 },
  phonetic: { color: c.cyan, fontSize: 22, lineHeight: 30, fontWeight: '500' },
  phoneticWait: { color: c.textFaint, fontSize: 14 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14, backgroundColor: c.accentSoft },
  actionText: { color: c.accent, fontSize: 14, fontWeight: '600' },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  listTitle: { color: c.text, fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  empty: { color: c.textMuted, fontSize: 14, lineHeight: 20 },
  item: { gap: 12 },
  itemWord: { color: c.text, fontSize: 22, fontWeight: '700' },
  itemPhonetic: { color: c.cyan, fontSize: 16, marginTop: 2 },
}));
