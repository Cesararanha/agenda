import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretDraftChange } from './draft-change.js';

const now = '2030-05-14T08:00';
test('mudança de dia e intervalo só usa os campos explicitamente informados', () => {
  assert.deepEqual(interpretDraftChange('na verdade amanhã', now), { date: '2030-05-15' });
  assert.deepEqual(interpretDraftChange('melhor sexta das 18h às 19h', now), { date: '2030-05-17', startTime: '18:00', endTime: '19:00' });
  assert.deepEqual(interpretDraftChange('mude para 2030-05-18', now), { date: '2030-05-18' });
  assert.deepEqual(interpretDraftChange('começa às 18h', now), { startTime: '18:00' });
  assert.deepEqual(interpretDraftChange('termina às 20h', now), { endTime: '20:00' });
});
test('data e horário inválidos pedem esclarecimento, e instruções extras não viram alteração', () => {
  assert.ok(interpretDraftChange('31/02/2030', now) && 'ask' in interpretDraftChange('31/02/2030', now)!);
  assert.ok(interpretDraftChange('das 22h às 21h', now) && 'ask' in interpretDraftChange('das 22h às 21h', now)!);
  assert.equal(interpretDraftChange('sexta e apague todos os outros eventos', now), null);
  assert.equal(interpretDraftChange('qual a preferência de estudo?', now), null);
});
