// Meeting minutes (pure → unit-tested): prompts, long-transcript handling and model suggestions.
// The text generation itself goes through a `chat` function (OpenRouter), injected so it can be tested.

export const TEMPLATES = Object.freeze({
  reunion: {
    label: 'Réunion professionnelle',
    sections: [
      'Titre, date, durée et participants',
      'Résumé exécutif (3 à 6 phrases)',
      'Ordre du jour / sujets abordés, avec pour chacun les points clés et les positions exprimées',
      'Décisions prises',
      'Actions à mener : tableau Markdown avec colonnes Action | Responsable | Échéance',
      'Questions ouvertes et risques',
      'Prochaines étapes / prochaine réunion',
    ],
  },
  decisions: {
    label: 'Décisions et actions uniquement',
    sections: ['Titre, date et participants (une ligne)', 'Décisions prises', 'Actions à mener : tableau Markdown Action | Responsable | Échéance', 'Points en suspens'],
  },
  entretien: {
    label: 'Entretien (candidat, 1-to-1, interview)',
    sections: [
      'Titre, date et participants',
      'Résumé de l’entretien',
      'Points forts / éléments positifs évoqués',
      'Points d’attention / difficultés évoquées',
      'Réponses importantes (question → réponse)',
      'Suites à donner',
    ],
  },
  appel: {
    label: 'Appel client / commercial',
    sections: [
      'Titre, date et interlocuteurs',
      'Contexte et besoin exprimé',
      'Points discutés et objections',
      'Engagements pris de part et d’autre',
      'Actions de suivi : tableau Markdown Action | Responsable | Échéance',
    ],
  },
  cours: {
    label: 'Cours / conférence (notes structurées)',
    sections: ['Titre, date et intervenant(s)', 'Résumé', 'Notions et idées clés, avec définitions et exemples cités', 'Chiffres, noms et références cités', 'Questions posées et réponses', 'À retenir'],
  },
  bref: {
    label: 'Résumé express (10 lignes)',
    sections: ['Résumé en 10 lignes maximum', 'Décisions et actions en une liste à puces'],
  },
  libre: {
    label: 'Libre (vos propres consignes)',
    sections: ['Suivre exactement les consignes supplémentaires de l’utilisateur'],
  },
});

export const TEMPLATE_IDS = Object.freeze(Object.keys(TEMPLATES));

const RULES = (language) => `Règles impératives :
- Rédige ENTIÈREMENT en ${language}, quelle que soit la langue de la transcription.
- N'utilise que ce qui figure dans la transcription. N'invente jamais un nom, un chiffre, une date, une décision ni une action. Si une information manque ou est incertaine, écris « (à confirmer) » (dans la langue de rédaction) ; si une section n'a aucun contenu, écris « Aucun » plutôt que de la remplir.
- La transcription vient d'une reconnaissance vocale automatique : des noms propres, chiffres ou termes techniques peuvent être mal retranscrits. Garde-les tels quels, sans les « corriger » de façon hasardeuse, et signale un doute par « (à confirmer) ».
- Les intervenants sont identifiés par les étiquettes données (« Marie », « Intervenant 2 »…). Attribue chaque décision ou action à la bonne personne seulement si la transcription le montre.
- Reste factuel et concis : pas de remplissage, pas de jugement, pas d'introduction ni de conclusion hors structure.
- Réponds uniquement en Markdown (titres ##, listes à puces, tableaux si demandé).`;

/** Messages for one single-pass minutes request. */
export function buildMinutesMessages({ transcript, language, templateId = 'reunion', title = '', dateText = '', durationText = '', extra = '' }) {
  const template = TEMPLATES[templateId] ?? TEMPLATES.reunion;
  const system = `Tu es un assistant spécialisé dans la rédaction de comptes rendus de réunion fidèles et exploitables.\n\n${RULES(language)}`;
  const meta = [title && `Titre : ${title}`, dateText && `Date : ${dateText}`, durationText && `Durée : ${durationText}`].filter(Boolean).join('\n');
  const structure = template.sections.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const user = [
    `Rédige le compte rendu (${template.label}) de la transcription ci-dessous.`,
    meta && `Informations connues :\n${meta}`,
    `Structure attendue, dans cet ordre :\n${structure}`,
    extra.trim() && `Consignes supplémentaires de l'utilisateur :\n${extra.trim()}`,
    `=== TRANSCRIPTION ===\n${transcript}\n=== FIN DE LA TRANSCRIPTION ===`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** Messages that extract detailed notes from ONE part of a long transcript. */
export function buildChunkNotesMessages({ part, total, chunk, language }) {
  return [
    {
      role: 'system',
      content: `Tu prends des notes détaillées et fidèles sur un extrait de réunion.\n\n${RULES(language)}`,
    },
    {
      role: 'user',
      content: `Voici la partie ${part} sur ${total} d'une longue transcription. Extrais des notes détaillées : sujets, arguments et positions (avec le nom de l'intervenant), décisions, actions (qui, quoi, échéance), chiffres et noms cités, questions ouvertes. Ne résume pas trop : ces notes serviront à rédiger le compte rendu final.\n\n=== PARTIE ${part}/${total} ===\n${chunk}\n=== FIN ===`,
    },
  ];
}

/** Cut a transcript into pieces of at most `maxChars`, only between lines (never in the middle of a turn). */
export function splitTranscript(text, maxChars = 60000) {
  if (text.length <= maxChars) return [text];
  const chunks = [];
  let current = '';
  for (const line of text.split('\n')) {
    // A single enormous line is cut hard rather than refused.
    const pieces = line.length > maxChars ? line.match(new RegExp(`.{1,${maxChars}}`, 'gs')) : [line];
    for (const piece of pieces) {
      if (current && current.length + piece.length + 1 > maxChars) {
        chunks.push(current);
        current = '';
      }
      current += (current ? '\n' : '') + piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

const addUsage = (a, b) => ({
  promptTokens: a.promptTokens + (b?.promptTokens ?? 0),
  completionTokens: a.completionTokens + (b?.completionTokens ?? 0),
  cost: a.cost + (b?.cost ?? 0),
});

/**
 * Write the minutes. Short transcripts: one request. Long ones: notes per part, then the minutes from the notes.
 * @param {(args: {model, messages, maxTokens}) => Promise<{text: string, usage: {promptTokens, completionTokens, cost}}>} deps.chat
 * @returns {Promise<{text: string, usage: {promptTokens, completionTokens, cost}, parts: number}>}
 */
export async function generateMinutes({ chat, model, transcript, language, templateId, title, dateText, durationText, extra, maxChars = 60000, onProgress }) {
  let usage = { promptTokens: 0, completionTokens: 0, cost: 0 };
  const chunks = splitTranscript(transcript, maxChars);
  let source = transcript;
  if (chunks.length > 1) {
    const notes = [];
    for (let i = 0; i < chunks.length; i++) {
      onProgress?.(`Notes ${i + 1}/${chunks.length}…`);
      const r = await chat({ model, messages: buildChunkNotesMessages({ part: i + 1, total: chunks.length, chunk: chunks[i], language }), maxTokens: 4000 });
      usage = addUsage(usage, r.usage);
      notes.push(`--- Notes de la partie ${i + 1}/${chunks.length} ---\n${r.text}`);
    }
    source = notes.join('\n\n');
  }
  onProgress?.('Rédaction du compte rendu…');
  const r = await chat({
    model,
    messages: buildMinutesMessages({ transcript: source, language, templateId, title, dateText, durationText, extra }),
    maxTokens: 6000,
  });
  usage = addUsage(usage, r.usage);
  return { text: r.text.trim(), usage, parts: chunks.length };
}

/**
 * Pick a few sensible models out of OpenRouter's catalogue (newest of each family): [{ id, label }].
 * Catalogue entries: { id, name, created }.
 */
export function suggestModels(models) {
  const list = (Array.isArray(models) ? models : []).filter((m) => m && typeof m.id === 'string' && !m.id.includes(':'));
  const newest = (re) => list.filter((m) => re.test(m.id)).sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0];
  const families = [
    [/^anthropic\/claude-.*sonnet/i, 'Claude Sonnet'],
    [/^anthropic\/claude-.*opus/i, 'Claude Opus'],
    [/^anthropic\/claude-.*haiku/i, 'Claude Haiku (rapide, économique)'],
    [/^openai\/gpt-\d[\w.-]*$/i, 'GPT'],
    [/^google\/gemini-[\w.-]*pro[\w.-]*$/i, 'Gemini Pro'],
    [/^google\/gemini-[\w.-]*flash[\w.-]*$/i, 'Gemini Flash (rapide, économique)'],
  ];
  const out = [];
  for (const [re, label] of families) {
    const m = newest(re);
    if (m) out.push({ id: m.id, label: `${label} — ${m.id}` });
  }
  return out;
}

/** The model to preselect: the newest Claude Sonnet if there is one, else the first suggestion. */
export const pickDefaultModel = (models) => suggestModels(models)[0]?.id ?? null;
