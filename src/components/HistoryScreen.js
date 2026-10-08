import { FlatList, Modal, Pressable, SafeAreaView, Share, StyleSheet, Text, View } from 'react-native';

import { getLanguage } from '../config/languages';
import { formatConversation } from '../utils/history';

/**
 * Everything translated since the app was opened, newest first: the original sentence and its
 * translation, so a word that went by too fast can be read again.
 * @param {{id: number, from: string, to: string, source: string, translated: string, at: number}[]} props.items
 * @param {{A: string, B: string}} props.languages
 */
export default function HistoryScreen({ visible, items, languages, onClear, onClose }) {
  const time = (at) => new Date(at).toTimeString().slice(0, 8);
  // The language the sentence was in when it was said (old items without it: the current pair).
  const describe = (i, which) => getLanguage((which === 'from' ? i.fromLang : i.toLang) ?? languages[which === 'from' ? i.from : i.to]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>Historique</Text>
          <Pressable
            onPress={() =>
              Share.share({
                message: formatConversation(items, (i, which) => describe(i, which)),
                title: 'Conversation DualCast Translate',
              }).catch(() => {})
            }
            hitSlop={12}
            accessibilityRole="button"
            disabled={!items.length}
          >
            <Text style={[styles.link, !items.length && styles.off]}>Partager</Text>
          </Pressable>
          <Pressable onPress={onClear} hitSlop={12} accessibilityRole="button">
            <Text style={styles.link}>Effacer</Text>
          </Pressable>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Text style={styles.link}>Fermer</Text>
          </Pressable>
        </View>
        <FlatList
          data={[...items].reverse()}
          keyExtractor={(i) => String(i.id)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>Rien pour l'instant. Les phrases traduites s'afficheront ici.</Text>}
          renderItem={({ item }) => (
            <View style={styles.item}>
              <Text style={styles.meta}>
                {`${time(item.at)} · ${describe(item, 'from').flag} → ${describe(item, 'to').flag}`}
              </Text>
              <Text style={styles.source}>{item.source}</Text>
              <Text style={styles.translated}>{item.translated}</Text>
            </View>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0F1A' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, paddingTop: 40 },
  title: { flex: 1, color: '#fff', fontSize: 24, fontWeight: '700' },
  link: { color: '#6FA0FF', fontSize: 16 },
  off: { opacity: 0.35 },
  list: { padding: 16, paddingTop: 0 },
  empty: { color: '#9AA6C4', fontSize: 16, marginTop: 24 },
  item: { backgroundColor: '#16233B', borderRadius: 12, padding: 14, marginBottom: 10 },
  meta: { color: '#7C89AA', fontSize: 12, marginBottom: 6 },
  source: { color: '#C9D2EA', fontSize: 16 },
  translated: { color: '#fff', fontSize: 18, fontWeight: '600', marginTop: 6 },
});
