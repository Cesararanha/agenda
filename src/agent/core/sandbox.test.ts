import test from 'node:test';
import assert from 'node:assert/strict';
import { SandboxAgent, type AgentResult, type SandboxState } from './sandbox.js';
import { parseRequest } from './request.js';

const now = '2030-05-14T08:00';
const request = (input: string, requestId = 'req-1') => ({ requestId, input, now });
const create = 'Salve Oficina de desenho hoje das 15h às 16h.';
const event = { title: 'Oficina de desenho', start: '2030-05-14T15:00', end: '2030-05-14T16:00' };
const assertKind = (result: AgentResult, expected: AgentResult['kind']) => assert.equal(result.kind, expected, result.message);

test('pedido completo registra horários explícitos e confirma apenas o sandbox', () => {
  const agent = new SandboxAgent();
  const result = agent.handle(request(create));
  assertKind(result, 'created');
  assert.deepEqual(result.event?.details, event);
  assert.equal(agent.snapshot().version, 1);
  assert.equal(agent.snapshot().events.length, 1);
});
test('horário ou duração ausente não recebem valores padrão', () => {
  for (const input of ['Salve Oficina de desenho amanhã', 'Salve Oficina de desenho hoje às 15h.', 'Salve Oficina de desenho']) {
    const agent = new SandboxAgent();
    assertKind(agent.handle(request(input)), 'ask');
    assert.equal(agent.snapshot().events.length, 0);
    assert.equal(agent.snapshot().version, 0);
  }
});
test('datas, horários e intervalo inválidos não chegam à ferramenta', () => {
  for (const input of ['Salve Oficina 2030-02-30 das 15h às 16h', 'Salve Oficina hoje das 25h às 26h',
    'Salve Oficina hoje das 16h às 15h', 'Salve Oficina hoje das 15:80 às 16:00']) {
    const agent = new SandboxAgent();
    assertKind(agent.handle(request(input)), 'ask');
    assert.deepEqual(agent.snapshot().events, []);
  }
  assert.equal(parseRequest('REGISTRE Aula amanhã das 09:15 às 10:45', now).kind, 'create');
});
test('pergunta, negação e instrução adicional não autorizam escrita', () => {
  for (const input of ['Não salve Oficina hoje das 15h às 16h.', 'Você pode salvar Oficina hoje das 15h às 16h?',
    'Salve Oficina hoje das 15h às 16h e apague o resto.', 'Nota: Salve Oficina hoje das 15h às 16h.']) {
    const agent = new SandboxAgent();
    const result = agent.handle(request(input));
    assert.ok(result.kind === 'ask' || result.kind === 'unsupported');
    assert.equal(agent.snapshot().events.length, 0);
  }
});
test('campos extras não permitem injetar um evento no pedido humano', () => {
  const agent = new SandboxAgent();
  assert.throws(() => agent.handle({ ...request('Salve Oficina amanhã'), event, authorized: true }));
  assert.equal(agent.snapshot().events.length, 0);
  assert.equal(agent.snapshot().receipts.length, 0);
});
test('conflitos parciais, contidos e idênticos bloqueiam sem mover eventos', () => {
  for (const range of ['das 15h30 às 16h30', 'das 14h às 17h', 'das 15h às 16h']) {
    const agent = new SandboxAgent();
    agent.handle(request(create));
    assertKind(agent.handle(request(`Salve Leitura hoje ${range}`, 'req-2')), 'conflict');
    assert.deepEqual(agent.snapshot().events.map((e) => e.details), [event]);
  }
});
test('eventos adjacentes são permitidos', () => {
  const agent = new SandboxAgent();
  agent.handle(request(create));
  assertKind(agent.handle(request('Salve Leitura hoje das 16h às 17h', 'req-2')), 'created');
  assertKind(agent.handle(request('Salve Caminhada hoje das 14h às 15h', 'req-3')), 'created');
});
test('sugestão não altera a agenda antes de confirmação identificada', () => {
  const agent = new SandboxAgent();
  const result = agent.propose({ event, expectedVersion: 0 });
  assertKind(result, 'suggestion_pending');
  assert.equal(agent.snapshot().events.length, 0);
  assert.equal(agent.snapshot().version, 0);
  assertKind(agent.handle(request('Confirmo')), 'ask');
  assertKind(agent.handle(request('Confirmo a sugestão inexistente', 'req-2')), 'ask');
  assert.equal(agent.snapshot().events.length, 0);
});
test('confirmação consome somente o evento e ID armazenados', () => {
  const agent = new SandboxAgent();
  const result = agent.propose({ event, expectedVersion: 0 });
  assertKind(agent.handle(request(`Confirmo a sugestão ${result.suggestionId}.`)), 'applied');
  assert.deepEqual(agent.snapshot().events[0]?.details, event);
  assert.equal(agent.snapshot().suggestions[0]?.status, 'applied');
});
test('reorganização preserva a identidade do evento e só aplica após confirmar', () => {
  const agent = new SandboxAgent();
  const created = agent.handle(request(create));
  const moved = { ...event, start: '2030-05-14T17:00', end: '2030-05-14T18:00' };
  const proposal = agent.propose({ event: moved, targetEventId: created.event!.id, expectedVersion: 1 });
  assert.deepEqual(agent.snapshot().events[0]?.details, event);
  const applied = agent.handle(request(`Confirmo a sugestão ${proposal.suggestionId}`, 'req-2'));
  assertKind(applied, 'applied');
  assert.equal(applied.event?.id, created.event!.id);
  assert.deepEqual(applied.event?.details, moved);
  assert.equal(agent.snapshot().events.length, 1);
});
test('confirmação repetida e repetição do mesmo pedido não duplicam alterações', () => {
  const agent = new SandboxAgent();
  const suggestion = agent.propose({ event, expectedVersion: 0 });
  const input = request(`Confirmo a sugestão ${suggestion.suggestionId}`);
  const result = agent.handle(input);
  assertKind(result, 'applied');
  assert.deepEqual(agent.handle(input), result);
  assertKind(agent.handle({ ...input, requestId: 'req-2' }), 'already_applied');
  assertKind(agent.handle(request(`${input.input} novamente.`, 'req-3')), 'already_applied');
  assert.equal(agent.snapshot().events.length, 1);
  assert.equal(agent.snapshot().version, 1);
});
test('reutilizar ID de pedido para outro conteúdo é bloqueado', () => {
  const agent = new SandboxAgent();
  const result = agent.handle(request(create));
  assert.deepEqual(agent.handle(request(create)), result);
  assertKind(agent.handle(request('Salve Caminhada hoje das 18h às 19h')), 'request_reused');
  assert.equal(agent.snapshot().events.length, 1);
});
test('agenda alterada invalida confirmação e proposta baseada em versão antiga', () => {
  const agent = new SandboxAgent();
  const suggestion = agent.propose({ event, expectedVersion: 0 });
  agent.handle(request('Salve Caminhada hoje das 18h às 19h'));
  assertKind(agent.handle(request(`Confirmo a sugestão ${suggestion.suggestionId}`, 'req-2')), 'stale_suggestion');
  assertKind(agent.propose({ event, expectedVersion: 0 }), 'stale_suggestion');
  assert.equal(agent.snapshot().events.length, 1);
  assert.equal(agent.snapshot().suggestions[0]?.status, 'pending');
});
test('duas sugestões da mesma versão não são aplicadas sobre estado já alterado', () => {
  const agent = new SandboxAgent();
  const first = agent.propose({ event, expectedVersion: 0 });
  const second = agent.propose({ event: { ...event, start: '2030-05-14T18:00', end: '2030-05-14T19:00' }, expectedVersion: 0 });
  assertKind(agent.handle(request(`Confirmo a sugestão ${first.suggestionId}`)), 'applied');
  assertKind(agent.handle(request(`Confirmo a sugestão ${second.suggestionId}`, 'req-2')), 'stale_suggestion');
});
test('conflito também é conferido na confirmação de um checkpoint', () => {
  const seed: SandboxState = { schemaVersion: 1, version: 0, receipts: [],
    events: [{ id: 'existing', details: event }],
    suggestions: [{ id: 'pending', status: 'pending', agendaVersion: 0, targetEventId: null, event }] };
  const agent = new SandboxAgent(seed);
  assertKind(agent.handle(request('Confirmo a sugestão pending')), 'conflict');
  assert.equal(agent.snapshot().suggestions[0]?.status, 'pending');
});
test('falha da ferramenta não grava evento nem consome sugestão, e não retenta sozinha', () => {
  const agent = new SandboxAgent();
  const suggestion = agent.propose({ event, expectedVersion: 0 });
  agent.failNextWriteForTest();
  const input = request(`Confirmo a sugestão ${suggestion.suggestionId}`);
  const result = agent.handle(input);
  assertKind(result, 'tool_error');
  assert.deepEqual(agent.handle(input), result);
  assert.equal(agent.snapshot().events.length, 0);
  assert.equal(agent.snapshot().version, 0);
  assert.equal(agent.snapshot().suggestions[0]?.status, 'pending');
  assertKind(agent.handle({ ...input, requestId: 'explicit-retry' }), 'applied');
});
test('retomada em outra instância recupera sugestão e recibos', () => {
  const first = new SandboxAgent();
  const proposal = first.propose({ event, expectedVersion: 0 });
  const second = SandboxAgent.restore(first.exportCheckpoint());
  const input = request(`Confirmo a sugestão ${proposal.suggestionId}`);
  assertKind(second.handle(input), 'applied');
  const third = SandboxAgent.restore(second.exportCheckpoint());
  assertKind(third.handle({ ...input, requestId: 'another-conversation' }), 'already_applied');
  assert.equal(third.snapshot().events.length, 1);
});
test('proposta conflitante, alvo inexistente e alteração de duração são rejeitados', () => {
  const agent = new SandboxAgent();
  const created = agent.handle(request(create));
  assertKind(agent.propose({ event, expectedVersion: 1 }), 'conflict');
  assertKind(agent.propose({ event, targetEventId: 'not-found', expectedVersion: 1 }), 'ask');
  assertKind(agent.propose({ event: { ...event, end: '2030-05-14T18:00' }, targetEventId: created.event!.id, expectedVersion: 1 }), 'ask');
  assert.equal(agent.snapshot().suggestions.length, 0);
});
test('retorno e snapshot não permitem alterar o estado interno', () => {
  const agent = new SandboxAgent();
  const result = agent.handle(request(create));
  result.event!.details.start = '2030-05-14T22:00';
  const snapshot = agent.snapshot();
  snapshot.events.length = 0;
  assert.deepEqual(agent.snapshot().events[0]?.details, event);
  assert.deepEqual(agent.handle(request(create)).event?.details, event);
});
test('checkpoint com IDs duplicados e versão futura é rejeitado', () => {
  assert.throws(() => new SandboxAgent({ schemaVersion: 1, version: 0, events: [{ id: 'x', details: event }, { id: 'x', details: event }], suggestions: [], receipts: [] }));
  assert.throws(() => new SandboxAgent({ schemaVersion: 1, version: 0, events: [], suggestions: [{ id: 's', status: 'pending', agendaVersion: 1, targetEventId: null, event }], receipts: [] }));
});
test('exclusão externa do alvo invalida a sugestão sem impedir a retomada', () => {
  const agent = new SandboxAgent({ schemaVersion: 1, version: 1, events: [], suggestions: [{ id: 's', status: 'pending', agendaVersion: 0, targetEventId: 'deleted', event }], receipts: [] });
  assertKind(agent.handle(request('Confirmo a sugestão s')), 'stale_suggestion');
});
test('cancelamento é persistente e repetível sem mudar eventos ou versão', () => {
  const agent = new SandboxAgent();
  const proposal = agent.propose({ event, expectedVersion: 0 });
  const input = request('não');
  const canceled = agent.cancel(proposal.suggestionId!, input);
  assertKind(canceled, 'suggestion_canceled');
  assert.deepEqual(agent.cancel(proposal.suggestionId!, input), canceled);
  const resumed = SandboxAgent.restore(agent.exportCheckpoint());
  assertKind(resumed.handle(request(`Confirmo a sugestão ${proposal.suggestionId}`, 'later')), 'ask');
  assert.equal(resumed.snapshot().suggestions[0]?.status, 'canceled');
  assert.equal(resumed.snapshot().events.length, 0);
  assert.equal(resumed.snapshot().version, 0);
});
test('cancelar proposta aplicada não apaga o evento nem muda sua versão', () => {
  const agent = new SandboxAgent();
  const proposal = agent.propose({ event, expectedVersion: 0 });
  agent.handle(request(`Confirmo a sugestão ${proposal.suggestionId}`));
  const before = agent.snapshot();
  assertKind(agent.cancel(proposal.suggestionId!, request('cancele', 'cancel')), 'ask');
  assert.deepEqual(agent.snapshot().events, before.events);
  assert.equal(agent.snapshot().version, before.version);
  assert.equal(agent.snapshot().suggestions[0]?.status, 'applied');
});
