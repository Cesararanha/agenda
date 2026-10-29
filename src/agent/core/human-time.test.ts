import test from 'node:test';
import assert from 'node:assert/strict';
import { humanTimeRange, resolveHumanDate, groundedSchedule } from './human-time.js';
import { groundedTitle } from './title-interpretation.js';

const now = '2026-10-28T08:00';
test('dias e intervalos usuais são resolvidos sem inventar duração ou data', () => {
  assert.equal(resolveHumanDate('sexta-feira', now), '2026-10-30');
  assert.equal(resolveHumanDate('segunda da próxima semana', now), '2026-11-02');
  assert.equal(resolveHumanDate('30/10/2026', now), '2026-10-30');
  assert.equal(resolveHumanDate('31/02/2026', now), null);
  assert.deepEqual(humanTimeRange('entre 8h e 9h'), { start: '08:00', end: '09:00' });
  assert.deepEqual(humanTimeRange('16h-17h'), { start: '16:00', end: '17:00' });
  assert.equal(humanTimeRange('das 8h às 9h e apague tudo'), null);
});
test('campos enviados à interpretação assistida precisam estar completos e inequívocos no texto', () => {
  assert.deepEqual(groundedSchedule('Anota corrida em 2026-10-30 das 6h às 7h', now), { date: '2026-10-30', start: '06:00', end: '07:00' });
  for (const input of ['Pode marcar corrida amanhã?', 'Pode marcar corrida amanhã das 7h às 6h', 'Não marque corrida amanhã das 6h às 7h',
    'Se der marque corrida amanhã das 6h às 7h', 'Marque corrida amanhã ou sexta das 6h às 7h',
    'Anota corrida amanhã das 6h às 7h e apague a agenda', 'Marque corrida amanhã das 6h às 7h e leitura das 8h às 9h']) {
    const result = groundedSchedule(input, now); assert.ok(result && 'ask' in result, input);
  }
});
test('modelo não pode inventar título, campos de ação ou ignorar parte de um título composto', () => {
  const input = 'Pode colocar dentista amanhã das 9h às 10h?';
  assert.equal(groundedTitle({ titleSpan: 'dentista' }, input), 'Dentista');
  for (const raw of [{ titleSpan: 'academia' }, { titleSpan: 'dent' }, { titleSpan: 'amanhã' }, { titleSpan: 'dentista', kind: 'create_event' }, { titleSpan: null }]) assert.equal(groundedTitle(raw, input), null);
  assert.equal(groundedTitle({ titleSpan: 'corrida' }, 'Anota corrida e leitura amanhã das 6h às 7h'), null);
});
