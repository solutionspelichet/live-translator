import assert from 'node:assert/strict';
import test from 'node:test';

import { bulletsOf, kindOf, needsConfirmation, parseMinutes, parseTable } from '../src/utils/minutesView.js';

const SAMPLE = `# Réunion produit
12 novembre · 45 min · Marie, Li

## Résumé exécutif
On a validé le lancement.

## Décisions prises
- Lancer en décembre
- Budget plafonné à 20 k€ (à confirmer)

## Actions à mener
| Action | Responsable | Échéance |
|---|---|---|
| Préparer la démo | Li | 20 nov |
| Réserver la salle | Marie | (à confirmer) |

## Questions ouvertes et risques
- Fournisseur en retard
`;

test('sections are cut and recognised', () => {
  const s = parseMinutes(SAMPLE);
  assert.deepEqual(s.map((x) => x.kind), ['intro', 'summary', 'decisions', 'actions', 'risks']);
  assert.equal(s[0].title, 'Réunion produit');
  assert.equal(s[2].flagged, true);
  assert.equal(s[1].flagged, false);
});

test('kinds in other languages', () => {
  assert.equal(kindOf('Key decisions'), 'decisions');
  assert.equal(kindOf('Action items'), 'actions');
  assert.equal(kindOf('Risks and open questions'), 'risks');
  assert.equal(kindOf('Executive summary'), 'summary');
  assert.equal(kindOf('决定'), 'decisions');
  assert.equal(kindOf('Divers'), 'other');
});

test('table and bullets', () => {
  const actions = parseMinutes(SAMPLE)[3];
  const table = parseTable(actions.body);
  assert.deepEqual(table.head, ['Action', 'Responsable', 'Échéance']);
  assert.deepEqual(table.rows[0], ['Préparer la démo', 'Li', '20 nov']);
  assert.equal(table.rows.length, 2);
  assert.equal(parseTable('pas de tableau'), null);
  assert.deepEqual(bulletsOf('- un\n* deux\n3. trois\n\nquatre'), ['un', 'deux', 'trois', 'quatre']);
});

test('to be confirmed in several languages', () => {
  assert.equal(needsConfirmation('Budget (to be confirmed)'), true);
  assert.equal(needsConfirmation('预算（待确认）'), true);
  assert.equal(needsConfirmation('Rien'), false);
});
