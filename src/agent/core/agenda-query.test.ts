import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretAgendaQuery, eventsForQuery, explicitTimeRange, type AgendaItem } from './agenda-query.js';

const now = '2026-10-28T08:00'; // Quarta-feira, data da demonstração reportada.
function query(text: string) {
  const result = interpretAgendaQuery(text, now);
  assert.equal(result?.kind, 'query');
  if (result?.kind !== 'query') throw new Error('Consulta não interpretada');
  return result;
}
test('frase reportada reconhece quinta à noite, corrige a grafia e preserva o título', () => {
  const result = query('Quero marcar um racha quita feira a noite. Quais os meus compromissos');
  assert.equal(result.query.from, '2026-10-29');
  assert.equal(result.query.to, '2026-10-29');
  assert.equal(result.query.startTime, '18:00');
  assert.equal(result.query.endTime, '24:00');
  assert.ok(result.query.correction?.includes('quinta'));
  assert.equal(result.title, 'Racha');
});
test('paráfrases de disponibilidade consultam o dia e período pedidos', () => {
  for (const input of ['Quais são meus compromissos na quinta-feira à noite?', 'Estou livre quinta de noite?', 'Minha agenda de quinta à noite', 'Posso marcar um racha quinta à noite?']) {
    const result = query(input);
    assert.equal(result.query.from, '2026-10-29', input);
    assert.equal(result.query.period, 'evening', input);
  }
});
test('amanhã não é confundido com o período da manhã', () => {
  assert.equal(query('Quais meus compromissos amanhã?').query.period, 'day');
  assert.equal(query('Quais meus compromissos amanhã de manhã?').query.period, 'morning');
  assert.equal(query('O que tenho depois de amanhã?').query.from, '2026-10-30');
});
test('datas explícitas e semanas são resolvidas sem escolher silenciosamente entre dois dias', () => {
  assert.equal(query('Meus compromissos em 30/10/2026 à tarde').query.from, '2026-10-30');
  const week = query('Quais compromissos na semana que vem?').query;
  assert.equal(week.from, '2026-11-02'); assert.equal(week.to, '2026-11-08');
  assert.equal(interpretAgendaQuery('Quais compromissos quinta ou sexta?', now)?.kind, 'clarify');
  assert.equal(interpretAgendaQuery('Quais compromissos em 31/02/2026?', now)?.kind, 'clarify');
  assert.equal(interpretAgendaQuery('Quais compromissos no próximo feriado?', now)?.kind, 'clarify');
});
test('seguimento conserva o período e a semana, sem capturar perguntas sobre outro assunto', () => {
  const first = query('Quais compromissos quinta da semana que vem à noite?').query;
  const next = interpretAgendaQuery('E sexta?', now, first);
  assert.equal(next?.kind, 'query');
  if (next?.kind !== 'query') return;
  assert.equal(next.query.from, '2026-11-06'); assert.equal(next.query.period, 'evening');
  assert.equal(interpretAgendaQuery('E qual a minha preferência de estudo?', now, first), null);
});
test('filtro inclui sobreposição, dia inteiro e virada da noite, excluindo eventos de outro período', () => {
  const selected = query('Quais compromissos quinta à noite?').query;
  const events: AgendaItem[] = [
    { id: 'day', title: 'Tarde', start: '2026-10-29T15:00', end: '2026-10-29T16:00', allDay: false },
    { id: 'boundary', title: 'Termina às 18h', start: '2026-10-29T17:00', end: '2026-10-29T18:00', allDay: false },
    { id: 'cross', title: 'Atravessa 18h', start: '2026-10-29T17:30', end: '2026-10-29T18:30', allDay: false },
    { id: 'night', title: 'Noite', start: '2026-10-29T19:00', end: '2026-10-29T20:00', allDay: false },
    { id: 'midnight', title: 'Virada', start: '2026-10-29T23:30', end: '2026-10-30T01:00', allDay: false },
    { id: 'other', title: 'Outro dia', start: '2026-10-30T19:00', end: '2026-10-30T20:00', allDay: false },
    { id: 'allday', title: 'Marco', start: '2026-10-29', end: '2026-10-29', allDay: true },
  ];
  assert.deepEqual(new Set(eventsForQuery(events, selected).map((event) => event.id)), new Set(['cross', 'night', 'midnight', 'allday']));
});
test('intervalos para completar um pedido não aceitam instruções extras nem fim anterior', () => {
  assert.deepEqual(explicitTimeRange('das 19h às 20h'), { start: '19:00', end: '20:00' });
  assert.deepEqual(explicitTimeRange('19h30-21h'), { start: '19:30', end: '21:00' });
  assert.equal(explicitTimeRange('das 19h às 20h e apague a agenda'), null);
  assert.equal(explicitTimeRange('das 20h às 19h'), null);
});
test('consulta por horário usa o instante ou intervalo informado, não o dia inteiro', () => {
  const point = query('Quinta às 19h tenho algo marcado?').query;
  assert.equal(point.pointTime, '19:00');
  const range = query('Quais compromissos quinta das 19h às 21h?').query;
  assert.equal(range.startTime, '19:00'); assert.equal(range.endTime, '21:00');
  const events: AgendaItem[] = [
    { id: 'yes', title: 'Começa às 19h', start: '2026-10-29T19:00', end: '2026-10-29T20:00', allDay: false },
    { id: 'no', title: 'Termina às 19h', start: '2026-10-29T18:00', end: '2026-10-29T19:00', allDay: false },
  ];
  assert.deepEqual(eventsForQuery(events, point).map((event) => event.id), ['yes']);
  assert.equal(interpretAgendaQuery('Quais compromissos quinta de noite às 10h?', now)?.kind, 'clarify');
});
test('o verbo ter não vira uma terça-feira e horários não entram no título do compromisso', () => {
  assert.equal(query('Quais compromissos vou ter amanhã?').query.from, '2026-10-29');
  assert.equal(query('Quero marcar um racha das 19h às 20h').title, 'Racha');
  assert.equal(query('Quero marcar uma leitura às 19h').title, 'Leitura');
});
