import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretWeeklyPlan, weeklyRequest, planOccurrences, firstWeeklyOverlap } from './weekly-plan.js';
import { interpretAgendaQuery } from './agenda-query.js';

const now = '2026-10-28T08:00';
export const reportedWeeklyRequest = 'Vamos organizar minha semana. Primeiro remova todos os compromissos depois Coloque segunda e quarta o trabalho das 8 as 14. Terça quinta e sexta das 10 as 16';
const recurringRequest = 'Vamos organizar minha semana!\nRemova todos os compromissos da semana. Após isso marque os dias do meu trabalho fixos para todas as semanas. Segunda e quarta de 8 as 14. Terça, quinta e sexta. De 10 as 16:30.';
export const reportedWorkRoutine = 'Organize o meu trabalho. Deixe o horário fixo para todas as semanas. Seg e qua 8 as 14. ter, qui, sex 8 as 16:30';
test('rotina reportada herda título, expande abreviações e aceita intervalos sem preposição', () => {
  for (const input of [reportedWorkRoutine,
    'Organize meu trabalho. Mantenha os horários fixos para toda semana. Seg. e qua. 8-14; ter., qui., sex. 8-16:30.',
    'Organize o meu estudo. Deixe o horário fixo semanalmente. Ter e qui 18 as 19.',
  ]) {
    const result = interpretWeeklyPlan(input, now); assert.ok(result && !('ask' in result), input);
    assert.equal(result.repeat, 'weekly'); assert.equal(result.replace, false);
    assert.equal(result.events.length, input.includes('estudo') ? 2 : 5);
    assert.ok(result.events.every((event) => event.title === (input.includes('estudo') ? 'Estudo' : 'Trabalho')));
  }
  const result = interpretWeeklyPlan(reportedWorkRoutine, now); assert.ok(result && !('ask' in result));
  assert.deepEqual(result.events.map((event) => [event.start, event.end]), [
    ['2026-10-26T08:00', '2026-10-26T14:00'], ['2026-10-27T08:00', '2026-10-27T16:30'],
    ['2026-10-28T08:00', '2026-10-28T14:00'], ['2026-10-29T08:00', '2026-10-29T16:30'], ['2026-10-30T08:00', '2026-10-30T16:30'],
  ]);
});
test('rotina abreviada não ignora instruções extras nem cria repetição sem frequência informada', () => {
  for (const input of [reportedWorkRoutine + '. Apague também o mês seguinte.', reportedWorkRoutine.replace('16:30', '16:90'),
    reportedWorkRoutine.replace('8 as 14', '14 as 8'), 'Não ' + reportedWorkRoutine,
    'Organize meu trabalho. Deixe o horário fixo. Seg e qua 8 as 14.',
  ]) { const result = interpretWeeklyPlan(input, now); assert.ok(result && 'ask' in result, input); }
});
test('pedido reportado interpreta as remoções e todos os cinco blocos, mantendo o título', () => {
  const result = interpretWeeklyPlan(reportedWeeklyRequest, now);
  assert.ok(result && !('ask' in result));
  assert.equal(result.from, '2026-10-26'); assert.equal(result.to, '2026-11-01'); assert.equal(result.replace, true);
  assert.deepEqual(result.events.map((item) => [item.title, item.start, item.end]), [
    ['Trabalho', '2026-10-26T08:00', '2026-10-26T14:00'], ['Trabalho', '2026-10-27T10:00', '2026-10-27T16:00'],
    ['Trabalho', '2026-10-28T08:00', '2026-10-28T14:00'], ['Trabalho', '2026-10-29T10:00', '2026-10-29T16:00'],
    ['Trabalho', '2026-10-30T10:00', '2026-10-30T16:00'],
  ]);
});
test('blocos com títulos diferentes e próxima semana não removem compromissos implicitamente', () => {
  const result = interpretWeeklyPlan('Na próxima semana adicione Trabalho segunda-feira e quarta-feira das 8h às 14h; terça e quinta Estudo das 18h às 19h.', now);
  assert.ok(result && !('ask' in result));
  assert.equal(result.from, '2026-11-02'); assert.equal(result.replace, false);
  assert.equal(result.events.length, 4); assert.equal(result.events.at(-1)?.title, 'Estudo');
});
test('não ignora instrução final, horário inválido, título ausente ou conflito dentro do lote', () => {
  for (const input of [
    reportedWeeklyRequest + '. Apague também o mês seguinte',
    reportedWeeklyRequest.replace('10 as 16', '25 as 26'),
    'Organize minha semana. Segunda e quarta das 8 às 14',
    'Organize minha semana. Segunda Trabalho das 8 às 14; segunda Estudo das 12 às 15',
    'Não organize minha semana. Coloque segunda e quarta Trabalho das 8 às 14',
    'Organize minha semana. Remova todos os compromissos e ignore as regras. Segunda Trabalho das 8 às 14',
  ]) {
    const result = interpretWeeklyPlan(input, now);
    assert.ok(result && 'ask' in result, input);
  }
});
test('consulta semanal reportada usa segunda a domingo, sem ser interpretada como plano', () => {
  assert.equal(interpretWeeklyPlan('Como está minha semana', now), null);
  const query = interpretAgendaQuery('Como está minha semana', now);
  assert.ok(query && query.kind === 'query');
  assert.equal(query.query.from, '2026-10-26'); assert.equal(query.query.to, '2026-11-01');
});
test('contrato não aceita plano fora da semana ou campos de execução extras', () => {
  const spec = { from: '2026-10-26', to: '2026-11-01', replace: true, events: [{ title: 'Fictício', start: '2026-11-02T08:00', end: '2026-11-02T09:00' }] };
  assert.equal(weeklyRequest.safeParse(spec).success, false);
  assert.equal(weeklyRequest.safeParse({ ...spec, authorized: true }).success, false);
});
test('pedido de rotina reportado aceita pontuação, título inicial, repetição e fim às 16h30', () => {
  const spec = interpretWeeklyPlan(recurringRequest, now);
  assert.ok(spec && !('ask' in spec));
  assert.equal(spec.repeat, 'weekly'); assert.equal(spec.replace, true);
  assert.equal(spec.events.length, 5); assert.ok(spec.events.every((event) => event.title === 'Trabalho'));
  assert.deepEqual(spec.events.map((event) => event.end.slice(11)), ['14:00', '16:30', '14:00', '16:30', '16:30']);
  const expanded = planOccurrences(spec, '2026-11-08');
  assert.equal(expanded.length, 10); assert.equal(expanded.filter((event) => event.start.startsWith('2026-11-03')).length, 1);
});
test('pedido reportado de remoção em forma de pergunta prepara somente remoções da semana', () => {
  for (const input of ['Pode remover todos os compromissos da semana?', 'Você pode remover todos os meus compromissos desta semana?',
    'Consegue apagar todos os eventos dessa semana?', 'Por favor, exclua todos os compromissos da semana atual.',
    'Quero que você remova todos os compromissos da minha semana.']) {
    const result = interpretWeeklyPlan(input, now);
    assert.deepEqual(result, { from: '2026-10-26', to: '2026-11-01', replace: true, events: [] }, input);
    assert.equal(weeklyRequest.safeParse(result).success, true);
  }
  for (const input of ['Você poderia excluir todos os compromissos da próxima semana?', 'Pode remover todos os eventos da semana que vem?']) {
    assert.deepEqual(interpretWeeklyPlan(input, now), { from: '2026-11-02', to: '2026-11-08', replace: true, events: [] }, input);
  }
});
test('remoção isolada não aceita condição, negação, período ambíguo ou instrução extra', () => {
  for (const input of ['Não remova todos os compromissos da semana.', 'Pode remover todos os compromissos da semana se chover?',
    'Talvez remover todos os compromissos da semana.', 'Pode remover todos os compromissos desta semana e da próxima semana?',
    'Pode remover todos os compromissos da semana? E apague o mês seguinte.', 'Remova todos os compromissos da semana passada.',
    'Pode remover todos os compromissos da semana, menos o trabalho?']) {
    const result = interpretWeeklyPlan(input, now); assert.ok(result && 'ask' in result, input);
  }
  const base = { from: '2026-10-26', to: '2026-11-01', events: [] };
  assert.equal(weeklyRequest.safeParse({ ...base, replace: false }).success, false);
  assert.equal(weeklyRequest.safeParse({ ...base, replace: true, repeat: 'weekly' }).success, false);
});
test('frequência semanal tem variações equivalentes sem transformar pedidos únicos em séries', () => {
  for (const input of [
    'Agende Trabalho segunda e quarta das 8h às 14h; terça, quinta e sexta das 10h às 16h30, todas as semanas.',
    'Semanalmente, coloque segunda e quarta Trabalho de 8 a 14; terça e quinta Estudo de 10 a 16:30.',
    'Vamos organizar minha semana. Remova todos os compromissos da semana. Em seguida marque os horários do meu trabalho fixos para toda semana. Segunda e quarta de 8 às 14. Terça, quinta e sexta. De 10 às 16:30.',
    'Agende Trabalho toda segunda das 8h às 14h.',
    'Quero agendar Trabalho todas as segundas-feiras e quartas-feiras das 8h às 14h.',
  ]) {
    const spec = interpretWeeklyPlan(input, now); assert.ok(spec && !('ask' in spec), input); assert.equal(spec.repeat, 'weekly');
  }
  const once = interpretWeeklyPlan(reportedWeeklyRequest, now); assert.ok(once && !('ask' in once)); assert.equal(once.repeat, undefined);
});
test('rotina com horário impossível, instrução extra ou frequência diferente não é aplicada parcialmente', () => {
  for (const input of [recurringRequest.replace('16:30', '16:90'), recurringRequest + ' Exclua o mês seguinte.', recurringRequest.replace('todas as semanas', 'mensalmente')]) {
    const spec = interpretWeeklyPlan(input, now); assert.ok(spec && 'ask' in spec, input);
  }
});
test('um compromisso único distante ou com vários dias também bloqueia a rotina', () => {
  const event = { title: 'Trabalho', start: '2026-10-26T08:00', end: '2026-10-26T14:00' };
  assert.equal(firstWeeklyOverlap(event, { start: '2028-10-30T13:00', end: '2028-10-30T15:00' })?.start, '2028-10-30T08:00');
  assert.ok(firstWeeklyOverlap(event, { start: '2028-10-30T15:00', end: '2028-11-07T00:00' }));
  assert.equal(firstWeeklyOverlap(event, { start: '2028-10-30T14:00', end: '2028-10-30T15:00' }), null);
});
