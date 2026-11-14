import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Plain, Text } from '../i18n/Text';
import { bulletsOf, needsConfirmation, parseMinutes, parseTable } from '../utils/minutesView';
import { cardShadow, palette, themedStyles } from '../theme';
import Icon from './Icon';
import MarkdownText from './MarkdownText';

const KIND = {
  summary: { icon: 'sparkles', label: null },
  decisions: { icon: 'checkcircle', label: null },
  actions: { icon: 'check', label: null },
  risks: { icon: 'info', label: null },
  next: { icon: 'chevron', label: null },
  info: { icon: 'clock', label: null },
  other: { icon: 'notes', label: null },
};

/** Executive view of minutes: one block per section (summary, decisions, actions, risks…) instead of one long text. */
export default function MinutesBlocks({ text }) {
  const [raw, setRaw] = useState(false);
  const c = palette();
  const sections = parseMinutes(text);
  if (raw || !sections.some((s) => s.title)) return (
    <View style={styles.wrap}>
      <MarkdownText text={text} />
      {sections.some((s) => s.title) && <RawToggle raw onPress={() => setRaw(false)} />}
    </View>
  );
  return (
    <View style={styles.wrap}>
      {sections.map((s, i) => (s.kind === 'intro' ? <Intro key={i} s={s} /> : <Block key={i} s={s} c={c} />))}
      <RawToggle raw={false} onPress={() => setRaw(true)} />
    </View>
  );
}

function RawToggle({ raw, onPress }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" style={styles.rawBtn}>
      <Text style={styles.rawText}>{raw ? 'Voir en blocs' : 'Voir le texte brut'}</Text>
    </Pressable>
  );
}

function Intro({ s }) {
  return (
    <View style={styles.intro}>
      {!!s.title && <Plain style={styles.introTitle}>{s.title}</Plain>}
      {!!s.body && <Plain style={styles.introMeta}>{s.body}</Plain>}
    </View>
  );
}

function Tag({ label, tone }) {
  return (
    <View style={[styles.tag, tone === 'warn' && styles.tagWarn]}>
      <Plain style={[styles.tagText, tone === 'warn' && styles.tagTextWarn]}>{label}</Plain>
    </View>
  );
}

function Block({ s, c }) {
  const meta = KIND[s.kind] ?? KIND.other;
  const table = s.kind === 'actions' ? parseTable(s.body) : null;
  const empty = /^(aucun|none|ninguno|keine|nessuno|无)\.?$/i.test(s.body.trim());
  const container = [styles.block, s.kind === 'decisions' && styles.blockDecision, s.kind === 'risks' && styles.blockRisk];
  const tint = s.kind === 'risks' ? c.warnStrong : c.accent;
  return (
    <View style={container}>
      <View style={styles.blockHead}>
        <Icon name={meta.icon} size={18} color={tint} stroke={2} />
        <Plain style={[styles.blockTitle, s.kind === 'risks' && { color: c.warn }]}>{s.title}</Plain>
        {s.flagged && s.kind !== 'risks' && <Tag label="À confirmer" tone="warn" />}
      </View>
      {empty ? (
        <Plain style={styles.empty}>{s.body}</Plain>
      ) : table ? (
        <View style={styles.rows}>
          {table.rows.map((r, i) => (
            <View key={i} style={styles.actionRow}>
              <Icon name="check" size={16} color={c.textFaint} />
              <View style={styles.actionBody}>
                <Plain style={styles.itemText} selectable>{r[0]}</Plain>
                <View style={styles.tags}>
                  {!!r[1] && <Tag label={r[1]} />}
                  {!!r[2] && <Tag label={r[2]} tone={needsConfirmation(r[2]) ? 'warn' : undefined} />}
                </View>
              </View>
            </View>
          ))}
        </View>
      ) : s.kind === 'summary' || s.kind === 'other' || s.kind === 'info' || s.kind === 'next' ? (
        <MarkdownText text={s.body} />
      ) : (
        <View style={styles.rows}>
          {bulletsOf(s.body).map((b, i) => (
            <View key={i} style={styles.actionRow}>
              <View style={[styles.dot, { backgroundColor: tint }]} />
              <Plain style={[styles.itemText, styles.flex]} selectable>{b}</Plain>
              {needsConfirmation(b) && <Tag label="À confirmer" tone="warn" />}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = themedStyles((c) => StyleSheet.create({
  wrap: { gap: 12 },
  flex: { flex: 1 },
  intro: { gap: 4, paddingVertical: 4 },
  introTitle: { color: c.text, fontSize: 22, fontWeight: '700', letterSpacing: -0.4 },
  introMeta: { color: c.textMuted, fontSize: 13.5, lineHeight: 19 },
  block: { backgroundColor: c.surface, borderRadius: 18, padding: 16, gap: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, ...cardShadow(c) },
  blockDecision: { backgroundColor: c.accentSoft, borderColor: c.accent },
  blockRisk: { backgroundColor: `${c.warnStrong}1F`, borderColor: c.warnStrong },
  blockHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  blockTitle: { flex: 1, color: c.text, fontSize: 15, fontWeight: '600', letterSpacing: -0.1 },
  rows: { gap: 10 },
  actionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  actionBody: { flex: 1, gap: 6 },
  itemText: { color: c.textBody, fontSize: 15, lineHeight: 22 },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 9 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { backgroundColor: c.inset, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
  tagWarn: { backgroundColor: `${c.warnStrong}26`, borderColor: c.warnStrong },
  tagText: { color: c.textSoft, fontSize: 12, fontWeight: '500' },
  tagTextWarn: { color: c.warn },
  empty: { color: c.textMuted, fontSize: 14, fontStyle: 'italic' },
  rawBtn: { alignSelf: 'flex-start', paddingVertical: 4 },
  rawText: { color: c.link, fontSize: 13.5 },
}));
