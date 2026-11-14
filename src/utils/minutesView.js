// Structured view of minutes written by the model (pure → unit-tested): the Markdown is cut into its `##` sections, each one is
// recognised (summary, decisions, actions, risks…) so the screen can show executive blocks instead of one long text.

const KINDS = [
  ['summary', /résumé|resume|summary|resumen|zusammenfassung|riassunto|摘要|总结|概要/i],
  ['decisions', /décision|decision|decisión|entscheid|decisione|决定|决议|决策/i],
  ['actions', /action|acción|aktion|azion|ação|行动|待办|任务/i],
  ['risks', /risque|question|ouvert|suspens|risk|open|riesgo|pregunta|risiko|offene|rischi|domande|风险|问题|未决/i],
  ['next', /prochaine|suite|next step|próximo|nächste|prossim|后续|下一步/i],
  ['info', /titre|participants|attendees|asistentes|teilnehmer|partecipanti|参会|与会/i],
];

const CONFIRM = /à confirmer|to be confirmed|\btbc\b|por confirmar|zu bestätigen|da confermare|待确认|待定/i;

export const kindOf = (title) => KINDS.find(([, re]) => re.test(title))?.[0] ?? 'other';
export const needsConfirmation = (text) => CONFIRM.test(String(text ?? ''));

/** Markdown table lines → rows of cells (the header and the |---| separator removed). */
export function parseTable(body) {
  const lines = String(body ?? '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  if (lines.length < 2) return null;
  const cells = (l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const rows = lines.map(cells).filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
  if (rows.length < 2) return null;
  const [head, ...rest] = rows;
  return { head, rows: rest };
}

/** « - item » / « * item » / « 1. item » lines → items (a paragraph without bullets is one item per non-empty line). */
export function bulletsOf(body) {
  return String(body ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('|'))
    .map((l) => l.replace(/^([-*•]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
}

/**
 * @returns {{title: string, body: string, kind: string, flagged: boolean}[]} the sections in order; text before the first `##`
 * becomes a section without a title (kind 'intro'). `flagged`: the body says something is « to be confirmed ».
 */
export function parseMinutes(markdown) {
  const text = String(markdown ?? '').replace(/\r/g, '');
  const sections = [];
  let current = { title: '', lines: [], level: 0 };
  const push = () => {
    const body = current.lines.join('\n').trim();
    if (current.title || body) sections.push({ title: current.title, body, kind: current.title && !(current.level === 1 && !sections.length) ? kindOf(current.title) : 'intro', flagged: needsConfirmation(body) });
  };
  for (const line of text.split('\n')) {
    const m = /^(#{1,3})\s+(.*\S)\s*$/.exec(line);
    if (m) {
      push();
      current = { title: m[2].replace(/\*+/g, '').trim(), lines: [], level: m[1].length };
    } else current.lines.push(line);
  }
  push();
  return sections;
}
