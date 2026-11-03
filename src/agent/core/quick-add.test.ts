import assert from 'node:assert/strict';
import test from 'node:test';
import { applyQuickExtraction, quickBlocks, quickModelInput } from './quick-add.js';
import { quickCases, reference } from '../evals/quick-add-cases.js';
import { parseQuickAdd } from '../../server/nlp.js';

for (const { input, expected } of quickCases) {
  test(`Marcar: ${input}`, () => {
    const parsed = quickBlocks(input, reference);
    if (!expected.length) {
      assert.ok('question' in parsed);
      return;
    }
    assert.ok('blocks' in parsed, 'question' in parsed ? parsed.question : '');
    const raw = { items: quickModelInput(parsed.blocks).map((_, index) => {
      const [titleSpan, , , extra] = expected[index]!;
      return {
        titleSpan, category: extra?.category ?? 'outro', location: extra?.location ?? null, notes: extra?.notes ?? null,
      };
    }) };
    const drafts = applyQuickExtraction(raw, parsed.blocks);
    assert.ok(drafts);
    assert.deepEqual(drafts.map(({ title, date, time }) => [title, date, time]), expected.map((item) => item.slice(0, 3)));
    for (const [index, [, , , extra]] of expected.entries()) {
      for (const [field, value] of Object.entries(extra ?? {})) assert.equal(drafts[index]![field as keyof typeof drafts[number]], value);
    }
  });
}

test('extração simulada recusa título inventado, bloco omitido e horário enviado pelo modelo', () => {
  const parsed = quickBlocks('amanhã 9h aula e depois 15h dentista', reference);
  assert.ok('blocks' in parsed);
  const aula = { titleSpan: 'aula', category: 'faculdade', location: null, notes: null };
  const dentista = { titleSpan: 'dentista', category: 'saude', location: null, notes: null };
  assert.equal(applyQuickExtraction({ items: [aula] }, parsed.blocks), null);
  assert.equal(applyQuickExtraction({ items: [aula, { ...dentista, titleSpan: 'Exame' }] }, parsed.blocks), null);
  assert.equal(applyQuickExtraction({ items: [aula, { ...dentista, time: '12:00' }] }, parsed.blocks), null);
});

test('reserva remove pedido e data acentuada, separa preparação e classifica saúde', () => {
  const parsed = parseQuickAdd('Quero marcar o ortopedista para amanhã 14:45. Tenho que sair de casa 14:30');
  assert.equal(parsed.title, 'ortopedista');
  assert.equal(parsed.category, 'saude');
  assert.equal(parsed.start.slice(11), '14:45');
});
