// AI writing tools (pure → unit-tested). Each tool turns what the user typed into a chat request for a language model.
// `ctx`: { lang: language of the text / of the answer (English name), other: the other language of the pair, ui: the interface language }.

const PLAIN = 'Answer with plain text only (no markdown symbols, no preamble, no closing remark).';

export const TONES = Object.freeze({
  neutral: { label: 'Neutre', rule: 'a neutral, clear tone' },
  formal: { label: 'Formel', rule: 'a formal, polite, professional tone' },
  friendly: { label: 'Amical', rule: 'a warm, friendly, relaxed tone' },
  short: { label: 'Court', rule: 'the shortest possible wording that keeps the meaning' },
});

/** id → { icon, title, hint, placeholder, tones?, build(text, ctx, tone) → messages } */
export const TOOLS = Object.freeze({
  rewrite: {
    icon: 'pencil',
    title: 'Reformuler',
    hint: 'Adapter la formulation et le ton',
    placeholder: 'Le texte à reformuler',
    tones: true,
    build: (text, { lang }, tone = 'neutral') => [
      { role: 'system', content: `You rewrite texts. Rewrite the user's text in ${lang}, with ${(TONES[tone] ?? TONES.neutral).rule}. Keep the meaning, names and numbers. ${PLAIN}` },
      { role: 'user', content: text },
    ],
  },
  grammar: {
    icon: 'checkcircle',
    title: 'Vérifier la grammaire',
    hint: 'Corriger les fautes et expliquer',
    placeholder: 'Le texte à vérifier',
    build: (text, { lang, ui }) => [
      { role: 'system', content: `You are a proofreader for ${lang}. First give the corrected text. Then, after a line with only "---", list each correction briefly, explained in ${ui}. If there is nothing to correct, say so in ${ui}. ${PLAIN}` },
      { role: 'user', content: text },
    ],
  },
  email: {
    icon: 'mail',
    title: 'Assistant e-mail',
    hint: 'Rédiger un e-mail à partir de quelques notes',
    placeholder: 'Vos notes : à qui, pourquoi, ce que vous voulez dire',
    tones: true,
    build: (text, { lang }, tone = 'formal') => [
      { role: 'system', content: `You write e-mails. From the user's notes, write a complete e-mail in ${lang} (subject line, greeting, body, sign-off) with ${(TONES[tone] ?? TONES.formal).rule}. Do not invent facts that are not in the notes. ${PLAIN}` },
      { role: 'user', content: text },
    ],
  },
  replies: {
    icon: 'bubble',
    title: 'Idées de réponses',
    hint: 'Trois façons de répondre à un message',
    placeholder: 'Le message reçu',
    build: (text, { lang, ui }) => [
      { role: 'system', content: `The user received a message. Suggest three different replies written in ${lang}: one short, one polite and detailed, one friendly. Number them 1, 2, 3. After each reply add its translation in ${ui} on the next line, in parentheses. ${PLAIN}` },
      { role: 'user', content: text },
    ],
  },
  culture: {
    icon: 'globe',
    title: 'Guide culturel',
    hint: 'Comprendre le contexte d’une expression ou d’une situation',
    placeholder: 'Une expression, un geste, une situation…',
    build: (text, { ui }) => [
      { role: 'system', content: `You are a cultural guide. Explain in ${ui} the meaning, the context, the level of politeness and the cultural background of what the user gives you (an expression, a custom, a situation). Say what to do or avoid. Be concrete and short. ${PLAIN}` },
      { role: 'user', content: text },
    ],
  },
  business: {
    icon: 'briefcase',
    title: 'Phrases d’affaires',
    hint: 'Les phrases utiles pour une situation professionnelle',
    placeholder: 'La situation : négocier un prix, présenter son entreprise…',
    build: (text, { lang, other }) => [
      { role: 'system', content: `Give 8 useful phrases for the professional situation the user describes. Write each phrase in ${lang}, then its translation in ${other} on the next line. Number them. ${PLAIN}` },
      { role: 'user', content: text },
    ],
  },
  urgent: {
    icon: 'lifebuoy',
    title: 'Aide rapide',
    hint: 'Phrases d’urgence, prêtes à montrer',
    placeholder: 'Le problème : perdu, malade, volé, accident…',
    build: (text, { lang, ui }) => [
      { role: 'system', content: `Emergency help. Write 5 very short, clear phrases in ${lang} that the user can show or read to a stranger for the situation they describe (ask for help, say the problem, ask for a doctor / police / address). After each phrase add its meaning in ${ui} in parentheses. If the situation is life-threatening, begin by telling the user (in ${ui}) to call the local emergency number. ${PLAIN}` },
      { role: 'user', content: text },
    ],
  },
  synonyms: {
    icon: 'search',
    title: 'Trouver des synonymes',
    hint: 'Des mots proches, avec leur nuance',
    placeholder: 'Un mot ou une expression',
    build: (text, { lang, ui }) => [
      { role: 'system', content: `Give 6 synonyms or near-synonyms in ${lang} of the user's word or expression, from the most common to the most formal, each with a few words in ${ui} on its nuance. ${PLAIN}` },
      { role: 'user', content: text },
    ],
  },
});

export const TOOL_IDS = Object.freeze(Object.keys(TOOLS));

/** Messages for a tool, or null when the tool is unknown or the text is empty. */
export function buildToolMessages(id, text, ctx, tone) {
  const tool = TOOLS[id];
  const body = String(text ?? '').trim();
  if (!tool || !body) return null;
  return tool.build(body.slice(0, 6000), ctx, tone);
}

/** Plain translation by a language model (when DeepL is not available). */
export function translationMessages(text, from, to) {
  return [
    { role: 'system', content: `You are a professional translator. Translate the user's text from ${from} to ${to}. Keep names, numbers and line breaks. Answer with the translation only.` },
    { role: 'user', content: String(text) },
  ];
}

/** A quick, cheap model of the catalogue ([{ id, created }]): the newest Claude Haiku, else the newest Gemini Flash, else null. */
export function pickFastModel(models) {
  const list = (Array.isArray(models) ? models : []).filter((m) => m && typeof m.id === 'string' && !m.id.includes(':'));
  const newest = (re) => list.filter((m) => re.test(m.id)).sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0]?.id ?? null;
  return newest(/^anthropic\/claude-.*haiku/i) ?? newest(/^google\/gemini-[\w.-]*flash[\w.-]*$/i) ?? null;
}
