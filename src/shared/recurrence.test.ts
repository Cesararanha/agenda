import test from 'node:test';
import assert from 'node:assert/strict';
import { occurrenceDates, parseRrule } from './recurrence.js';

test('recorrência diária antiga continua presente sem percorrer décadas de passado', () => {
  assert.deepEqual(occurrenceDates('2000-01-01', parseRrule('FREQ=DAILY'), '2030-05-14', '2030-05-16'), ['2030-05-14', '2030-05-15', '2030-05-16']);
  assert.deepEqual(occurrenceDates('2030-05-14', parseRrule('FREQ=DAILY;INTERVAL=2;COUNT=3'), '2030-05-15', '2030-05-30'), ['2030-05-16', '2030-05-18']);
  assert.deepEqual(occurrenceDates('2030-05-14', parseRrule('FREQ=DAILY;COUNT=3'), '2030-05-17', '2030-05-30'), []);
});
test('semanas puladas preservam COUNT, inclusive primeira semana parcial e intervalos', () => {
  const rule = parseRrule('FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=5');
  // Âncora na terça: quarta e sexta, depois segunda, quarta e sexta.
  assert.deepEqual(occurrenceDates('2030-05-14', rule, '2030-05-20', '2030-06-30'), ['2030-05-20', '2030-05-22', '2030-05-24']);
  assert.deepEqual(occurrenceDates('2030-05-14', rule, '2030-05-27', '2030-06-30'), []);
  assert.deepEqual(occurrenceDates('2030-05-14', parseRrule('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=5'), '2030-05-21', '2030-06-30'), ['2030-05-28', '2030-05-30', '2030-06-11']);
});
test('série semanal antiga respeita UNTIL e não desaparece pelo limite de iteração', () => {
  const rule = parseRrule('FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=2030-05-16');
  assert.deepEqual(occurrenceDates('1900-01-01', rule, '2030-05-14', '2030-05-30'), ['2030-05-14', '2030-05-16']);
});
test('série mensal mantém COUNT ao pular meses sem o dia da âncora', () => {
  assert.deepEqual(occurrenceDates('2030-01-31', parseRrule('FREQ=MONTHLY;COUNT=3'), '2030-03-01', '2030-12-31'), ['2030-03-31', '2030-05-31']);
});
test('expansão excessiva falha em vez de devolver uma agenda parcialmente livre', () => {
  assert.throws(() => occurrenceDates('2000-01-01', parseRrule('FREQ=DAILY'), '2000-01-01', '2030-01-01'), /Limite/);
});
