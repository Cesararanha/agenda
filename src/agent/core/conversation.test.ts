import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SandboxAgent } from './sandbox.js';
import { LocalContextReader } from './context.js';
import { converse, type ConversationPorts } from './conversation.js';

async function fixture(run: (ports: ConversationPorts, agent: SandboxAgent, root: string, calls: { model: number }) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-fiction-'));
  try {
    await fs.mkdir(path.join(root, 'tasks'));
    for (const [name, text] of Object.entries({
      'AGENTS.md': 'Contexto fictício: preferencias.md e tasks/todo.md.',
      'preferencias.md': 'Blocos de estudo de 35 minutos. Janela de estudo: 14:00-18:00.',
      'tasks/AGENTS.md': 'Tarefas em todo.md.',
      'tasks/todo.md': '- [ ] Preparar maquete\n- [x] Comprar papel\n',
    })) await fs.writeFile(path.join(root, name), text);
    const agent = new SandboxAgent();
    const calls = { model: 0 };
    const ports: ConversationPorts = { state: () => agent.snapshot(), execute: (request) => agent.handle(request),
      propose: (proposal) => agent.propose(proposal), clock: () => '2030-05-14T08:00',
      cancel: (id, request) => agent.cancel(id, request),
      reader: new LocalContextReader(root, { memory: { notes: ['preferencias.md'] }, tasks: { notes: [], includeTasks: true } }),
      model: async () => { calls.model++; return { kind: 'answer', event: null, suggestionId: null, evidenceIds: ['preferencias.md'], message: '35 minutos.' }; } };
    await run(ports, agent, root, calls);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}
test('consulta intermediária preserva a proposta da conversa para confirmar, inclusive após serializar', () => fixture(async (ports, agent) => {
  const proposal = await converse({ requestId: 'prepare', input: 'Quero marcar Leitura amanhã das 18h às 19h' }, ports);
  const read = await converse({ requestId: 'read', input: 'Quais tarefas estão abertas?' }, ports, proposal);
  assert.equal(read.suggestion, undefined); assert.equal(read.continuation?.suggestion?.id, proposal.suggestion?.id);
  const restored = JSON.parse(JSON.stringify(read));
  const applied = await converse({ requestId: 'confirm', input: 'pode confirmar' }, ports, restored);
  assert.equal(applied.kind, 'applied'); assert.equal(agent.snapshot().events.length, 1);
}));
test('consultar tarefas não apaga início e data do registro explícito incompleto', () => fixture(async (ports, agent) => {
  const draft = await converse({ requestId: 'partial', input: 'Salve Leitura amanhã às 08h' }, ports);
  const read = await converse({ requestId: 'read', input: 'Quais tarefas estão abertas?' }, ports, draft);
  const created = await converse({ requestId: 'end', input: 'até 09h' }, ports, read);
  assert.equal(created.kind, 'created'); assert.equal(agent.snapshot().events[0]?.details.end, '2030-05-15T09:00');
}));
test('classificação semântica só seleciona ferramentas permitidas e recusa campos de execução', () => fixture(async (ports, agent) => {
  ports.intentModel = async () => ({ intent: 'tasks_read' });
  const read = await converse({ requestId: 'tasks', input: 'Me passa a lista do que falta fazer' }, ports);
  assert.deepEqual(read.evidenceIds, ['tasks/todo.md']); assert.match(read.message, /maquete/);
  ports.intentModel = async () => ({ intent: 'schedule', execute: true });
  const blocked = await converse({ requestId: 'attack', input: 'Bota leitura amanhã das 18h às 19h' }, ports);
  assert.equal(blocked.kind, 'ask'); assert.equal(agent.snapshot().events.length, 0);
}));
test('uma nova proposta substitui a referência anterior da conversa e cancelamento não a ressuscita', () => fixture(async (ports, agent) => {
  const first = await converse({ requestId: 'first', input: 'Quero marcar Leitura amanhã das 18h às 19h' }, ports);
  const second = await converse({ requestId: 'second', input: 'Quero marcar Corrida sexta das 06h às 07h' }, ports, first);
  const read = await converse({ requestId: 'read', input: 'Quais tarefas estão abertas?' }, ports, second);
  assert.equal(read.continuation?.suggestion?.id, second.suggestion?.id);
  const canceled = await converse({ requestId: 'cancel', input: 'não' }, ports, read);
  assert.equal(canceled.kind, 'suggestion_canceled');
  assert.equal((await converse({ requestId: 'confirm', input: 'pode confirmar' }, ports, canceled)).kind, 'ask');
  assert.equal(agent.snapshot().events.length, 0);
}));
test('consulta semântica informa a data final quando um compromisso atravessa a meia-noite', () => fixture(async (ports) => {
  ports.intentModel = async () => ({ intent: 'calendar_read' });
  ports.agenda = () => [{ id: 'overnight', title: 'Observação fictícia', start: '2030-05-15T23:00', end: '2030-05-16T01:00', allDay: false }];
  const reply = await converse({ requestId: 'query', input: 'Dá uma olhada nos horários de amanhã' }, ports);
  assert.equal(reply.kind, 'answer'); assert.match(reply.message, /15\/05\/2030 23:00 às 16\/05\/2030 01:00/);
}));
test('conversa encaminha registro e dados faltantes para validação sem consultar o modelo', () => fixture(async (ports, agent, root, calls) => {
  assert.equal((await converse({ requestId: 'missing', input: 'Salve Leitura hoje às 16h' }, ports)).kind, 'ask');
  assert.equal(agent.snapshot().events.length, 0);
  assert.equal((await converse({ requestId: 'create', input: 'Salve Leitura hoje das 16h às 17h' }, ports)).kind, 'created');
  assert.equal(agent.snapshot().events.length, 1);
  assert.equal(calls.model, 0);
}));
test('consulta de agenda e tarefas usa fontes atuais e não altera eventos', () => fixture(async (ports, agent, root, calls) => {
  const agenda = await converse({ requestId: 'agenda', input: 'Como está meu dia?' }, ports);
  assert.equal(agenda.kind, 'answer');
  assert.equal(agenda.changed, false);
  const tasks = await converse({ requestId: 'tasks', input: 'Quais tarefas estão abertas?' }, ports);
  assert.ok(tasks.message.includes('Preparar maquete'));
  assert.ok(!tasks.message.includes('Comprar papel'));
  assert.deepEqual(tasks.evidenceIds, ['tasks/todo.md']);
  assert.equal(agent.snapshot().events.length, 0);
  assert.equal(calls.model, 0);
}));
test('pergunta de memória recupera fontes antes de chamar o modelo', () => fixture(async (ports, agent, root, calls) => {
  const answer = await converse({ requestId: 'question', input: 'Qual a duração preferida de estudo?' }, ports);
  assert.equal(answer.kind, 'answer');
  assert.deepEqual(answer.evidenceIds, ['preferencias.md']);
  assert.equal(calls.model, 1);
  assert.equal(agent.snapshot().events.length, 0);
}));
test('modelo não pode transformar consulta em escrita', () => fixture(async (ports, agent) => {
  ports.model = async () => ({ kind: 'create_event', event: { title: 'Indevido', start: '2030-05-14T10:00', end: '2030-05-14T11:00' }, suggestionId: null, evidenceIds: [], message: 'Salvei.' });
  const result = await converse({ requestId: 'query', input: 'O que você sabe sobre a pessoa fictícia?' }, ports);
  assert.equal(result.kind, 'ask');
  assert.equal(result.changed, false);
  assert.equal(agent.snapshot().events.length, 0);
}));
test('sugestão usa duração da fonte e intervalo livre, aguardando confirmação na mesma conversa', () => fixture(async (ports, agent) => {
  await converse({ requestId: 'busy', input: 'Salve Oficina hoje das 14h30 às 15h30' }, ports);
  const result = await converse({ requestId: 'suggest', input: 'Sugira um bloco de estudo para hoje' }, ports);
  assert.equal(result.kind, 'suggestion_pending');
  assert.equal(result.suggestion?.event.start, '2030-05-14T15:30');
  assert.equal(result.suggestion?.event.end, '2030-05-14T16:05');
  assert.equal(agent.snapshot().events.length, 1);
  const confirmed = await converse({ requestId: 'confirm', input: `Confirmo a sugestão ${result.suggestion!.id}` }, ports);
  assert.equal(confirmed.kind, 'applied');
  assert.equal(agent.snapshot().events.length, 2);
}));
test('mudança após sugestão é conferida também pelo fluxo de conversa', () => fixture(async (ports, agent) => {
  const suggestion = await converse({ requestId: 'suggest', input: 'Sugira um bloco de estudo amanhã' }, ports);
  await converse({ requestId: 'create', input: 'Salve Leitura hoje das 10h às 11h' }, ports);
  const result = await converse({ requestId: 'confirm', input: `Confirmo a sugestão ${suggestion.suggestion!.id}` }, ports);
  assert.equal(result.kind, 'stale_suggestion');
  assert.equal(agent.snapshot().events.length, 1);
}));
test('preferência ausente ou inválida não recebe janela ou duração inventadas', () => fixture(async (ports, agent, root) => {
  await fs.writeFile(path.join(root, 'preferencias.md'), 'Não há preferência informada.');
  assert.equal((await converse({ requestId: 'missing', input: 'Sugira um bloco de estudo hoje' }, ports)).kind, 'ask');
  await fs.writeFile(path.join(root, 'preferencias.md'), 'Blocos de estudo de 35 minutos. Janela de estudo: 99:00-99:99.');
  assert.equal((await converse({ requestId: 'bad', input: 'Sugira um bloco de estudo hoje' }, ports)).kind, 'ask');
  assert.equal(agent.snapshot().suggestions.length, 0);
}));
test('pergunta natural mista consulta quinta à noite e pede horários, sem modelo ou escrita', () => fixture(async (ports, agent, root, calls) => {
  const result = await converse({ requestId: 'racha', input: 'Quero marcar um racha quita feira a noite. Quais os meus compromissos' }, ports);
  assert.equal(result.kind, 'answer');
  assert.ok(result.message.includes('16/05/2030'));
  assert.ok(result.message.includes('horário de início e de fim'));
  assert.deepEqual(result.eventDraft, { title: 'Racha', date: '2030-05-16' });
  assert.equal(calls.model, 0);
  assert.equal(agent.snapshot().events.length, 0);
}));
test('completar horários mantém o racha no dia pedido e prepara proposta sem registrar sozinho', () => fixture(async (ports, agent) => {
  const question = await converse({ requestId: 'question', input: 'Quero marcar um racha quinta à noite. Quais meus compromissos?' }, ports);
  const proposal = await converse({ requestId: 'times', input: 'das 19h às 20h' }, ports, question);
  assert.equal(proposal.kind, 'suggestion_pending');
  assert.equal(proposal.suggestion?.event.title, 'Racha');
  assert.equal(proposal.suggestion?.event.start, '2030-05-16T19:00');
  assert.equal(agent.snapshot().events.length, 0);
}));
test('início e fim informados em mensagens distintas não recebem duração padrão', () => fixture(async (ports, agent) => {
  const question = await converse({ requestId: 'question', input: 'Quero marcar um racha quinta à noite' }, ports);
  const start = await converse({ requestId: 'start', input: 'às 19h' }, ports, question);
  assert.equal(start.kind, 'ask'); assert.equal(agent.snapshot().suggestions.length, 0);
  const end = await converse({ requestId: 'end', input: '20h' }, ports, start);
  assert.equal(end.kind, 'suggestion_pending');
  assert.equal(end.suggestion?.event.end, '2030-05-16T20:00');
}));
test('consulta recebe compromissos reais do provedor da agenda em vez da memória de preferências', () => fixture(async (ports, agent, root, calls) => {
  ports.agenda = (from, to) => {
    assert.equal(from, '2030-05-16'); assert.equal(to, from);
    return [{ id: 'external', title: 'Oficina noturna', start: '2030-05-16T19:00', end: '2030-05-16T20:00', allDay: false }];
  };
  const result = await converse({ requestId: 'query', input: 'Quais compromissos quinta à noite?' }, ports);
  assert.ok(result.message.includes('Oficina noturna'));
  assert.deepEqual(result.evidenceIds, ['agenda']);
  assert.equal(calls.model, 0);
}));
test('confirmação natural aplica só a proposta identificada, e repetição não duplica', () => fixture(async (ports, agent) => {
  const proposal = await converse({ requestId: 'proposal', input: 'Sugira um bloco de estudo para hoje' }, ports);
  const confirmed = await converse({ requestId: 'yes', input: 'Pode confirmar' }, ports, proposal);
  assert.equal(confirmed.kind, 'applied');
  assert.equal(agent.snapshot().events.length, 1);
  assert.equal((await converse({ requestId: 'repeat', input: 'sim' }, ports, confirmed)).kind, 'already_applied');
  assert.equal(agent.snapshot().events.length, 1);
}));
test('sim sem proposta identificada não escolhe silenciosamente uma pendência', () => fixture(async (ports, agent) => {
  await converse({ requestId: 'proposal', input: 'Sugira um bloco de estudo para hoje' }, ports);
  assert.equal((await converse({ requestId: 'yes', input: 'sim' }, ports)).kind, 'ask');
  assert.equal(agent.snapshot().events.length, 0);
}));
test('negação cancela somente a sugestão e impede confirmação posterior', () => fixture(async (ports, agent) => {
  const proposal = await converse({ requestId: 'proposal', input: 'Sugira um bloco de estudo para hoje' }, ports);
  assert.equal((await converse({ requestId: 'no', input: 'Não' }, ports, proposal)).kind, 'suggestion_canceled');
  assert.equal(agent.snapshot().suggestions[0]?.status, 'canceled');
  const confirmation = await converse({ requestId: 'yes', input: `Confirmo a sugestão ${proposal.suggestion!.id}` }, ports);
  assert.equal(confirmation.kind, 'ask');
  assert.equal(agent.snapshot().events.length, 0);
}));
test('pedido explícito incompleto mantém data e início, sem inventar duração', () => fixture(async (ports, agent, root, calls) => {
  const first = await converse({ requestId: 'partial', input: 'Salve Leitura amanhã às 16h' }, ports);
  assert.equal(first.kind, 'ask');
  assert.equal(first.eventDraft?.startTime, '16:00');
  assert.equal(agent.snapshot().events.length, 0);
  const final = await converse({ requestId: 'end', input: 'até 17h' }, ports, first);
  assert.equal(final.kind, 'created');
  assert.deepEqual(final.event?.details, { title: 'Leitura', start: '2030-05-15T16:00', end: '2030-05-15T17:00' });
  assert.equal(calls.model, 0);
}));
test('pedido direto recebe início e fim separados, e conflito permite outro intervalo', () => fixture(async (ports, agent) => {
  await converse({ requestId: 'busy', input: 'Salve Oficina hoje das 16h às 17h' }, ports);
  const partial = await converse({ requestId: 'partial', input: 'Salve Leitura hoje' }, ports);
  const start = await converse({ requestId: 'start', input: 'às 16h' }, ports, partial);
  const conflict = await converse({ requestId: 'end', input: '17h' }, ports, start);
  assert.equal(conflict.kind, 'conflict');
  assert.equal(agent.snapshot().events.length, 1);
  const final = await converse({ requestId: 'other-time', input: 'das 17h às 18h' }, ports, conflict);
  assert.equal(final.kind, 'created');
  assert.equal(final.event?.details.start, '2030-05-14T17:00');
}));
test('negação e instrução adicional em pedido incompleto não autorizam o complemento', () => fixture(async (ports, agent) => {
  const invalid = await converse({ requestId: 'injected', input: 'Salve Leitura hoje às 16h mas não salve nada' }, ports);
  assert.equal(invalid.eventDraft, undefined);
  assert.notEqual((await converse({ requestId: 'extra', input: '17h' }, ports, invalid)).kind, 'created');
  const valid = await converse({ requestId: 'partial', input: 'Salve Leitura hoje às 16h' }, ports);
  const canceled = await converse({ requestId: 'no', input: 'não' }, ports, valid);
  assert.notEqual((await converse({ requestId: 'end', input: '17h' }, ports, canceled)).kind, 'created');
  assert.equal(agent.snapshot().events.length, 0);
}));
test('mudar o dia de um pedido incompleto preserva o início e só registra após receber o fim', () => fixture(async (ports, agent) => {
  const initial = await converse({ requestId: 'partial', input: 'Salve Leitura hoje às 08h' }, ports);
  const changed = await converse({ requestId: 'change-day', input: 'na verdade amanhã' }, ports, initial);
  assert.equal(changed.kind, 'ask'); assert.equal(changed.eventDraft?.date, '2030-05-15'); assert.equal(changed.eventDraft?.startTime, '08:00');
  assert.equal(agent.snapshot().events.length, 0);
  const done = await converse({ requestId: 'finish', input: 'até 09h' }, ports, changed);
  assert.equal(done.kind, 'created'); assert.equal(done.event?.details.start, '2030-05-15T08:00');
}));
test('planejamento completo usa os horários já informados e revisão cancela a proposta antiga', () => fixture(async (ports, agent) => {
  const proposal = await converse({ requestId: 'initial', input: 'Quero marcar um racha quinta das 19h às 20h' }, ports);
  assert.equal(proposal.kind, 'suggestion_pending');
  const revised = await converse({ requestId: 'revise', input: 'melhor sexta das 20h às 21h' }, ports, proposal);
  assert.equal(revised.kind, 'suggestion_pending'); assert.equal(revised.suggestion?.event.start, '2030-05-17T20:00');
  assert.equal(agent.snapshot().suggestions.find((item) => item.id === proposal.suggestion!.id)?.status, 'canceled');
  assert.equal(agent.snapshot().events.length, 0);
  assert.equal((await converse({ requestId: 'old-confirm', input: `Confirmo a sugestão ${proposal.suggestion!.id}` }, ports)).kind, 'ask');
}));
test('horários sem data ficam no rascunho quando o usuário informa o dia depois', () => fixture(async (ports, agent) => {
  const initial = await converse({ requestId: 'initial', input: 'Quero marcar um racha' }, ports);
  const times = await converse({ requestId: 'times', input: 'das 19h às 20h' }, ports, initial);
  assert.equal(times.kind, 'ask'); assert.equal(times.eventDraft?.endTime, '20:00');
  const dated = await converse({ requestId: 'date', input: '18/05/2030' }, ports, times);
  assert.equal(dated.kind, 'suggestion_pending'); assert.equal(dated.suggestion?.event.start, '2030-05-18T19:00');
  assert.equal(agent.snapshot().events.length, 0);
}));
test('trocar o dia de um evento registrado prepara edição com o mesmo ID e aguarda confirmação', () => fixture(async (ports, agent) => {
  const created = await converse({ requestId: 'create', input: 'Salve Leitura hoje das 08h às 09h' }, ports);
  const revised = await converse({ requestId: 'revise', input: 'mude para amanhã' }, ports, created);
  assert.equal(revised.kind, 'suggestion_pending'); assert.equal(revised.suggestion?.targetEventId, created.event?.id);
  assert.equal(agent.snapshot().events[0]?.details.start, '2030-05-14T08:00');
  const applied = await converse({ requestId: 'confirm', input: 'pode confirmar' }, ports, revised);
  assert.equal(applied.kind, 'applied'); assert.equal(applied.event?.id, created.event?.id);
  assert.equal(agent.snapshot().events.length, 1); assert.equal(applied.event?.details.start, '2030-05-15T08:00');
}));
test('revisão incompleta ou inválida não confirma implicitamente a proposta anterior', () => fixture(async (ports, agent) => {
  const proposal = await converse({ requestId: 'initial', input: 'Quero marcar Leitura amanhã das 19h às 20h' }, ports);
  const invalid = await converse({ requestId: 'invalid', input: 'na verdade das 21h às 20h' }, ports, proposal);
  assert.equal(invalid.kind, 'ask'); assert.equal(agent.snapshot().suggestions[0]?.status, 'canceled');
  assert.equal((await converse({ requestId: 'yes', input: 'sim' }, ports, invalid)).kind, 'ask');
  const corrected = await converse({ requestId: 'correct', input: 'das 21h às 22h' }, ports, invalid);
  assert.equal(corrected.kind, 'suggestion_pending'); assert.equal(agent.snapshot().events.length, 0);
}));
test('horários na primeira mensagem ficam preservados quando a data vem depois', () => fixture(async (ports, agent) => {
  const first = await converse({ requestId: 'times', input: 'Quero marcar um racha das 19h às 20h' }, ports);
  assert.equal(first.eventDraft?.title, 'Racha');
  const dated = await converse({ requestId: 'date', input: 'pode mudar para sexta?', }, ports, first);
  assert.equal(dated.kind, 'suggestion_pending'); assert.equal(dated.suggestion?.event.start, '2030-05-17T19:00');
  assert.equal(agent.snapshot().events.length, 0);
}));
test('interpretação assistida só prepara título presente no texto e exige confirmação para gravar', () => fixture(async (ports, agent) => {
  ports.titleModel = async () => ({ titleSpan: 'dentista' });
  const pending = await converse({ requestId: 'natural', input: 'Você pode colocar o dentista amanhã das 09h às 10h?' }, ports);
  assert.equal(pending.kind, 'suggestion_pending'); assert.equal(agent.snapshot().events.length, 0);
  assert.equal(pending.suggestion?.event.title, 'Dentista');
  assert.equal((await converse({ requestId: 'confirm', input: 'pode confirmar' }, ports, pending)).kind, 'applied');
  assert.equal(agent.snapshot().events.length, 1);
}));
test('título inventado pelo modelo não é salvo; esclarecer manualmente mantém os horários', () => fixture(async (ports, agent) => {
  ports.titleModel = async () => ({ titleSpan: 'Outra coisa' });
  const pending = await converse({ requestId: 'natural', input: 'Anota corrida amanhã das 06h às 07h' }, ports);
  assert.equal(pending.kind, 'ask'); assert.equal(pending.pendingSchedule?.start, '06:00');
  assert.equal(agent.snapshot().events.length, 0);
  const corrected = await converse({ requestId: 'manual', input: 'Corrida' }, ports, pending);
  assert.equal(corrected.kind, 'suggestion_pending'); assert.equal(corrected.suggestion?.event.start, '2030-05-15T06:00');
  assert.equal(agent.snapshot().events.length, 0);
}));
test('uma pergunta por tarefas após esclarecer título continua sendo consulta e não nova proposta', () => fixture(async (ports, agent) => {
  ports.titleModel = async () => ({ titleSpan: null });
  const waiting = await converse({ requestId: 'initial', input: 'Anota corrida amanhã das 06h às 07h' }, ports);
  const tasks = await converse({ requestId: 'tasks', input: 'Liste minhas tarefas pendentes' }, ports, waiting);
  assert.equal(tasks.kind, 'answer'); assert.deepEqual(tasks.evidenceIds, ['tasks/todo.md']);
  assert.equal(agent.snapshot().suggestions.length, 0); assert.equal(agent.snapshot().events.length, 0);
}));
