import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlanning, planningGuard, planningCandidate, type PlanningDraft } from './assisted-plan.js';
import { converse, type ConversationPorts } from './conversation.js';
import { SandboxAgent } from './sandbox.js';

const now = '2026-10-28T08:00';
const input = 'Na próxima semana coloque dentista segunda das 9h às 10h e leitura quarta entre 18h e 19h.';
const draft: PlanningDraft = { now, messages: [input] };
const valid = { blocks: [{ title: 'dentista', days: ['segunda'], time: 'das 9h às 10h' }, { title: 'leitura', days: ['quarta'], time: 'entre 18h e 19h' }], unsupported: [] };

test('plano assistido resolve todos os blocos em uma prévia sem remoções implícitas', () => {
  assert.equal(planningCandidate(input), true);
  const result = validatePlanning(valid, draft, now);
  assert.ok('spec' in result);
  assert.deepEqual(result.spec, { from: '2026-11-02', to: '2026-11-08', replace: false, events: [
    { title: 'Dentista', start: '2026-11-02T09:00', end: '2026-11-02T10:00' },
    { title: 'Leitura', start: '2026-11-04T18:00', end: '2026-11-04T19:00' },
  ] });
});
test('campos inventados, ação extra e bloco omitido não chegam à ferramenta', () => {
  for (const raw of [ { ...valid, execute: true }, { ...valid, unsupported: ['pague algo'] },
    { ...valid, blocks: [valid.blocks[0]] }, { ...valid, blocks: [{ ...valid.blocks[0], title: 'Academia' }, valid.blocks[1]] },
    { ...valid, blocks: [{ ...valid.blocks[0], days: ['sexta'] }, valid.blocks[1]] },
    { ...valid, blocks: [{ ...valid.blocks[0], time: 'das 10h às 11h' }, valid.blocks[1]] } ]) assert.ok('ask' in validatePlanning(raw, draft, now));
});
test('dados ausentes mantêm conversa para completar somente o bloco incompleto', () => {
  const result = validatePlanning({ ...valid, blocks: [valid.blocks[0], { ...valid.blocks[1], time: null }] },
    { now, messages: ['Na próxima semana coloque dentista segunda das 9h às 10h e leitura quarta.'] }, now);
  assert.ok('ask' in result); assert.match(result.ask, /início e o fim de Leitura/); assert.ok(result.draft);
  const complete = validatePlanning(valid, { ...result.draft, messages: [...result.draft.messages, 'A leitura será entre 18h e 19h.'] }, now);
  assert.ok('spec' in complete); assert.equal(complete.spec.events.length, 2);
  const omitted = validatePlanning({ ...valid, blocks: [valid.blocks[1]] }, { ...result.draft, messages: [...result.draft.messages, 'Na verdade a leitura será entre 18h e 19h.'] }, now);
  assert.ok('ask' in omitted, 'uma correção não pode apagar outro título mantido no rascunho');
});
test('datas relativas usam o dia real, e todas as datas precisam pertencer à semana escolhida', () => {
  const result = validatePlanning({ blocks: [{ title: 'leitura', days: ['amanhã'], time: 'das 18h às 19h' }], unsupported: [] },
    { now, messages: ['Nesta semana coloque leitura amanhã das 18h às 19h.'] }, now);
  assert.ok('spec' in result); assert.equal(result.spec.events[0]!.start, '2026-10-29T18:00');
  const outside = validatePlanning({ blocks: [{ title: 'leitura', days: ['02/11/2026'], time: 'das 18h às 19h' }], unsupported: [] },
    { now, messages: ['Nesta semana coloque leitura em 02/11/2026 das 18h às 19h.'] }, now);
  assert.ok('ask' in outside);
});
test('guardas recusam condições, outras ações e frequências não suportadas antes de consultar o modelo', () => {
  for (const input of ['Se der, coloque leitura segunda e quarta.', 'Não coloque leitura segunda e quarta.',
    'Coloque leitura segunda e quarta e apague a agenda.', 'Organize todo dia com leitura segunda e quarta.',
    'Coloque leitura segunda e quarta e pague a viagem.']) assert.ok(planningGuard([input]));
  assert.ok(planningGuard(Array.from({ length: 7 }, () => 'x')));
});
test('repetição semanal explícita aceita dias abreviados e preserva frequência fora da saída do modelo', () => {
  const messages = ['Semanalmente quero reservar clínica seg 8 as 9 e fisioterapia qui 14 as 15.'];
  assert.equal(planningGuard(messages), null);
  const result = validatePlanning({ blocks: [{ title: 'clínica', days: ['seg'], time: '8 as 9' }, { title: 'fisioterapia', days: ['qui'], time: '14 as 15' }], unsupported: [] }, { now, messages }, now);
  assert.ok('spec' in result); assert.equal(result.spec.repeat, 'weekly');
  assert.equal(result.spec.replace, false); assert.equal(result.spec.events[0]!.start, '2026-10-26T08:00');
  assert.equal(result.spec.events[1]!.start, '2026-10-29T14:00');
  for (const input of ['Semanalmente coloque leitura seg 8 as 9, mas corrida qui apenas nesta semana 14 as 15.', 'Toda semana coloque leitura seg 8 as 9 e mensalmente corrida qui 14 as 15.']) assert.ok(planningGuard([input]));
});
test('horários inválidos e conflitos dentro do próprio plano pedem revisão do conjunto', () => {
  const invalid = validatePlanning({ blocks: [{ title: 'leitura', days: ['quinta'], time: 'das 19h às 18h' }], unsupported: [] },
    { now, messages: ['Coloque leitura quinta das 19h às 18h.'] }, now);
  assert.ok('ask' in invalid); assert.match(invalid.ask, /fim depois/);
  const overlap = validatePlanning({ blocks: [{ title: 'leitura', days: ['quinta'], time: 'das 18h às 19h' }, { title: 'corrida', days: ['quinta'], time: 'das 18h às 19h' }], unsupported: [] },
    { now, messages: ['Coloque leitura e corrida quinta das 18h às 19h.'] }, now);
  assert.ok('ask' in overlap); assert.match(overlap.ask, /sobrepõem/);
});
test('falha do modelo preserva o pedido, sem ferramentas de escrita, e cancelamento limpa o rascunho', async () => {
  const agent = new SandboxAgent(); let calls = 0;
  const ports: ConversationPorts = { clock: () => now, state: () => agent.snapshot(), execute: () => { throw new Error('Não deve executar'); }, propose: () => { throw new Error('Não deve propor evento isolado'); },
    reader: { read: async () => { throw new Error('Não deve ler contexto'); } }, model: async () => { throw new Error('Não deve consultar memória'); },
    planningModel: async () => { calls++; throw new Error('Ollama indisponível'); } };
  const first = await converse({ requestId: 'first', input }, ports);
  assert.equal(first.kind, 'model_error'); assert.deepEqual(first.planningDraft?.messages, [input]);
  const canceled = await converse({ requestId: 'cancel', input: 'cancele' }, ports, first);
  assert.equal(canceled.planningDraft, undefined); assert.equal(canceled.changed, false); assert.equal(calls, 1);
  assert.equal(agent.snapshot().events.length, 0);
});
test('mudança superficial no conector de horas não permite inventar um intervalo', () => {
  const original = { now, messages: ['Nesta semana coloque leitura quinta de 18h a 19h e corrida sábado 6h-7h.'] };
  const result = validatePlanning({ blocks: [{ title: 'leitura', days: ['quinta'], time: 'das 18h às 19h' }, { title: 'corrida', days: ['sábado'], time: '6h-7h' }], unsupported: [] }, original, now);
  assert.ok('spec' in result); assert.equal(result.spec.events.length, 2);
});
test('uma extração inválida recebe somente uma tentativa de correção e nunca confirma sozinha', async () => {
  let calls = 0, prepared = 0; const agent = new SandboxAgent();
  const ports: ConversationPorts = { clock: () => now, state: () => agent.snapshot(), execute: () => { throw new Error('Não deve executar'); }, propose: () => { throw new Error('Não deve propor evento isolado'); },
    reader: { read: async () => { throw new Error('Não deve ler contexto'); } }, model: async () => { throw new Error('Não deve consultar memória'); },
    planningModel: async (_draft, feedback) => { calls++; if (calls === 1) return { ...valid, blocks: [{ ...valid.blocks[0], title: 'dentist' }, valid.blocks[1]] }; assert.ok(feedback); return valid; },
    plans: { prepare: (spec) => { prepared++; return { kind: 'plan_pending', message: 'Prévia fictícia.', changed: false, evidenceIds: ['agenda'], plan: { ...spec, id: 'plano-test', version: 0, status: 'pending', removals: [] } }; },
      apply: () => { throw new Error('Não deve aplicar'); }, cancel: () => { throw new Error('Não deve cancelar'); }, undo: () => { throw new Error('Não deve desfazer'); } } };
  assert.equal((await converse({ requestId: 'test', input }, ports)).kind, 'plan_pending');
  assert.equal(calls, 2); assert.equal(prepared, 1); assert.equal(agent.snapshot().events.length, 0);
  calls = 0; prepared = 0; ports.planningModel = async () => { calls++; return { execute: true }; };
  assert.equal((await converse({ requestId: 'bad', input }, ports)).kind, 'ask');
  assert.equal(calls, 2); assert.equal(prepared, 0);
});
test('continuação recusada não incorpora uma mensagem alheia ao rascunho já validado', async () => {
  const agent = new SandboxAgent();
  const saved = { now, messages: ['Na próxima semana coloque dentista segunda das 9h às 10h e leitura quarta.'], titles: ['dentista', 'leitura'], missing: ['horário de leitura'] };
  const ports: ConversationPorts = { clock: () => now, state: () => agent.snapshot(), execute: () => { throw new Error('Não deve executar'); }, propose: () => { throw new Error('Não deve propor'); },
    reader: { read: async () => { throw new Error('Não deve ler contexto'); } }, model: async () => { throw new Error('Não deve consultar memória'); },
    intentModel: async () => ({ intent: 'continue' }), planningModel: async () => ({ execute: true }) };
  const reply = await converse({ requestId: 'rejected', input: 'Dá uma olhada nos horários de amanhã' }, ports,
    { kind: 'ask', changed: false, evidenceIds: [], message: 'Qual horário de leitura?', planningDraft: saved });
  assert.equal(reply.kind, 'ask'); assert.deepEqual(reply.planningDraft, saved);
});
