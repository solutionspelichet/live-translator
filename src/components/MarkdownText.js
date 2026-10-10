import { StyleSheet, Text, View } from 'react-native';

import { themedStyles } from '../theme';
import { parseMarkdown } from '../utils/markdown';

/** Meeting minutes as written by the model (headings, bullets, **bold**), shown as a readable document instead of raw symbols. */
export default function MarkdownText({ text }) {
  return (
    <View>
      {parseMarkdown(text).map((block, i) => {
        if (block.type === 'space') return <View key={i} style={styles.space} />;
        if (block.type === 'rule') return <View key={i} style={styles.rule} />;
        const spans = block.spans.map((span, j) => (
          <Text key={j} style={[span.bold && styles.bold, span.italic && styles.italic, span.code && styles.code]}>
            {span.text}
          </Text>
        ));
        if (block.type === 'heading') {
          return (
            <Text key={i} style={[styles.heading, styles[`h${block.level}`]]} selectable>
              {spans}
            </Text>
          );
        }
        if (block.type === 'bullet') {
          return (
            <View key={i} style={[styles.bulletRow, { paddingLeft: block.depth * 16 }]}>
              <Text style={[styles.body, styles.marker]}>{block.marker}</Text>
              <Text style={[styles.body, styles.bulletText]} selectable>
                {spans}
              </Text>
            </View>
          );
        }
        if (block.type === 'quote') {
          return (
            <View key={i} style={styles.quote}>
              <Text style={[styles.body, styles.italic]} selectable>
                {spans}
              </Text>
            </View>
          );
        }
        return (
          <Text key={i} style={[styles.body, styles.paragraph]} selectable>
            {spans}
          </Text>
        );
      })}
    </View>
  );
}

const styles = themedStyles((c) =>
  StyleSheet.create({
    body: { color: c.textBody, fontSize: 15, lineHeight: 22 },
    paragraph: { marginBottom: 2 },
    space: { height: 8 },
    rule: { height: 1, backgroundColor: c.border, marginVertical: 10 },
    heading: { color: c.text, fontWeight: '700', marginTop: 10, marginBottom: 4 },
    h1: { fontSize: 20, lineHeight: 26 },
    h2: { fontSize: 17, lineHeight: 23, color: c.link },
    h3: { fontSize: 15, lineHeight: 21 },
    bulletRow: { flexDirection: 'row', gap: 8, marginBottom: 2 },
    marker: { width: 22, color: c.textMuted },
    bulletText: { flex: 1 },
    quote: { borderLeftWidth: 3, borderLeftColor: c.accent, paddingLeft: 10, marginVertical: 4 },
    bold: { fontWeight: '700', color: c.text },
    italic: { fontStyle: 'italic' },
    code: { fontFamily: 'Courier', backgroundColor: c.inset },
  }),
);
