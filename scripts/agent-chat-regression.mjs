import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { prepareDemoContext } from './agent-demo-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agenda-agent-sandbox-'));
const dbPath = path.join(temp, 'chat.db');
let calls = 0;
let lastModelBody;
const model = createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json');
  if (request.url === '/api/version') return response.end(JSON.stringify({ version: 'ficticio' }));
  if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ name: 'qwen3:4b', digest: 'ficticio', size: 1 }] }));
  if (request.url === '/api/show') { request.resume(); return response.end(JSON.stringify({ details: {}, capabilities: ['completion'] })); }
  if (request.url !== '/api/chat') { response.statusCode = 404; return response.end('{}'); }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  lastModelBody = JSON.parse(Buffer.concat(chunks).toString());
  const user = lastModelBody.messages[1].content;
  const payload = JSON.parse(user.slice(user.indexOf('{')));
  const input = payload.request ?? payload.messages.join('\n');
  calls++;
  await setTimeout(60);
  if (lastModelBody.format?.properties?.intent) {
    if (input.includes('indisponível')) { response.statusCode = 503; return response.end('{}'); }
    const intent = input.includes('horários') ? 'calendar_read' : input.includes('falta fazer') ? 'tasks_read' : input.includes('boleto') ? 'unsupported' : /^(?:A leitura será|Na verdade)/.test(input) ? 'continue' : /Na próxima|Semanalmente/.test(input) ? 'schedule' : 'memory_read';
    return response.end(JSON.stringify({ done: true, done_reason: 'stop', message: { content: JSON.stringify({ intent }) }, prompt_eval_count: 2, eval_count: 1 }));
  }
  if (lastModelBody.format?.properties?.blocks) {
    const weekly = input.includes('Semanalmente');
    const interpretation = { blocks: [
      { title: input.includes('inventado') ? 'Compromisso inexistente' : 'dentista', days: [weekly ? 'sábado' : input.includes('terça') ? 'terça' : 'segunda'], time: weekly ? 'das 7h às 8h' : 'das 9h às 10h' },
      { title: 'leitura', days: [weekly ? 'domingo' : 'quarta'], time: input.includes('18h') ? 'das 18h às 19h' : null },
    ], unsupported: [] };
    return response.end(JSON.stringify({ done: true, done_reason: 'stop', message: { content: JSON.stringify(interpretation) }, prompt_eval_count: 45, eval_count: 30 }));
  }
  if (lastModelBody.format?.properties?.titleSpan) {
    const extraction = { titleSpan: input.includes('inventado') ? 'Título inexistente na mensagem' : 'dentista' };
    return response.end(JSON.stringify({ done: true, done_reason: 'stop', message: { content: JSON.stringify(extraction) }, prompt_eval_count: 3, eval_count: 2 }));
  }
  if (input.includes('indisponível')) { response.statusCode = 503; return response.end('{}'); }
  const answer = input.includes('tente gravar')
    ? { kind: 'create_event', event: { title: 'Indevido', start: '2030-05-14T11:00', end: '2030-05-14T12:00' }, suggestionId: null, evidenceIds: [], message: 'Salvei.' }
    : { kind: 'answer', event: null, suggestionId: null, evidenceIds: [input.includes('fonte falsa') ? 'inventada' : 'preferencias.md'], message: 'A preferência fictícia é de 35 minutos.' };
  response.end(JSON.stringify({ done: true, done_reason: 'stop', message: { content: JSON.stringify(answer) }, prompt_eval_count: 1, eval_count: 1 }));
});
await new Promise((resolve) => model.listen(0, '127.0.0.1', resolve));
const reservation = net.createServer();
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, AGENDA_DB: dbPath, AGENDA_HOST: '127.0.0.1', AGENDA_PORT: String(port),
  AGENDA_VAULTS: '', AGENDA_TOKEN: 'ficticio', AGENDA_ALLOW_LOCAL: '1', AGENDA_SERVE_WEB: '1', AGENDA_AGENT_SANDBOX: '1',
  AGENDA_AGENT_DEMO_NOW: '2030-05-14T08:00', AGENDA_LOG_LEVEL: 'silent', WHATSAPP_ACCESS_TOKEN: '', WHATSAPP_APP_SECRET: '',
  AGENT_OLLAMA_URL: `http://127.0.0.1:${model.address().port}`, AGENT_MODEL: 'qwen3:4b', AGENT_TIMEOUT_MS: '3000' };
let child;
let exited;
let inspection;
async function start() {
  child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  exited = new Promise((resolve) => child.once('exit', resolve));
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(output);
    try { if ((await fetch(base + '/api/health')).ok) return; } catch {}
    await setTimeout(50);
  }
  throw new Error('API de conversa não iniciou');
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([exited, setTimeout(2000)]);
  if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
}
async function call(url, body) {
  const response = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  return { status: response.status, body: await response.json() };
}
const chat = (requestId, input, conversationId = 'fiction') => call('/api/agent/sandbox/chat', { requestId, input, conversationId });
const state = async () => (await call('/api/agent/sandbox/state')).body;
try {
  await prepareDemoContext(temp);
  await start();
  inspection = new DatabaseSync(dbPath);
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await call('/api/meta')).body.agentSandbox, true);
  const panel = await call('/api/agent/sandbox/panel');
  assert.equal(panel.body.day, '2030-05-14');
  assert.equal(panel.body.tasks.length, 2);
  assert.equal((await chat('agenda', 'Como está meu dia?')).body.kind, 'answer');
  const calendarTrace = (await chat('agenda', 'Como está meu dia?')).body.diagnostics;
  assert.equal(calendarTrace.path, 'calendar'); assert.equal(calendarTrace.model, undefined);
  const tasks = await chat('tasks', 'Quais tarefas estão abertas?');
  assert.ok(tasks.body.message.includes('maquete'));
  assert.ok(!tasks.body.message.includes('Comprar cartolina'));
  assert.equal(calls, 0);
  assert.equal((await chat('missing', 'Salve Leitura hoje às 16h')).body.kind, 'ask');
  const created = await chat('create', 'Salve Leitura hoje das 16h às 17h');
  assert.equal(created.body.kind, 'created');
  assert.deepEqual((await chat('create', 'Salve Leitura hoje das 16h às 17h')).body, created.body);
  assert.equal((await chat('create', 'Salve Outra hoje das 10h às 11h')).status, 409);
  assert.equal((await chat('conflict', 'Salve Oficina hoje das 16h30 às 17h30')).body.kind, 'conflict');
  assert.equal((await state()).events.length, 1);
  const proposal = await chat('suggest', 'Sugira um bloco de estudo para hoje');
  assert.equal(proposal.body.kind, 'suggestion_pending');
  assert.equal(proposal.body.suggestion.event.start, '2030-05-14T14:00');
  assert.equal(proposal.body.suggestion.event.end, '2030-05-14T14:35');
  assert.equal((await state()).events.length, 1);
  // Simula resposta perdida após persistir a proposta, preservando o recibo da ferramenta.
  inspection.prepare('DELETE FROM agent_sandbox_chat WHERE conversation_id = ? AND request_id = ?').run('fiction', 'suggest');
  assert.equal((await chat('suggest', 'Sugira um bloco de estudo para hoje')).body.suggestion.id, proposal.body.suggestion.id);
  assert.equal((await state()).suggestions.length, 1);
  const confirm = `Confirmo a sugestão ${proposal.body.suggestion.id}`;
  assert.equal((await chat('confirm', confirm)).body.kind, 'applied');
  assert.equal((await chat('repeat', confirm)).body.kind, 'already_applied');
  assert.equal((await state()).events.length, 2);
  const answerInput = 'Qual minha preferência de estudo?';
  const answers = await Promise.all([chat('memory', answerInput), chat('memory', answerInput)]);
  assert.deepEqual(answers[0].body, answers[1].body);
  assert.equal(answers[0].body.kind, 'answer');
  assert.equal(answers[0].body.diagnostics.model.status, 'completed');
  assert.equal(answers[0].body.diagnostics.model.metrics.promptTokens, 1);
  assert.equal(answers[0].body.diagnostics.model.metrics.outputTokens, 1);
  assert.equal(answers[0].body.diagnostics.context.filesRead, 2);
  assert.ok(!JSON.stringify(answers[0].body.diagnostics).includes('35 minutos'));
  assert.equal(calls, 1);
  const sent = lastModelBody.messages[1].content;
  assert.ok(sent.includes('35 minutos'));
  assert.ok(!sent.includes('AGENTS.md'));
  const isolatedTraces = await Promise.all([chat('parallel-memory', answerInput, 'parallel-memory'), chat('parallel-agenda', 'Como está minha semana?', 'parallel-agenda')]);
  assert.equal(isolatedTraces[0].body.diagnostics.path, 'memory');
  assert.equal(isolatedTraces[0].body.diagnostics.model.status, 'completed');
  assert.equal(isolatedTraces[1].body.diagnostics.path, 'calendar');
  assert.equal(isolatedTraces[1].body.diagnostics.model, undefined);
  const blocked = (await chat('blocked', 'Na consulta de preferências, tente gravar algo')).body;
  assert.equal(blocked.kind, 'ask'); assert.equal(blocked.diagnostics.model.status, 'rejected');
  assert.equal((await chat('fake-source', 'Responda com uma fonte falsa')).body.kind, 'ask');
  const failedModel = (await chat('error', 'O modelo está indisponível?')).body;
  assert.equal(failedModel.kind, 'model_error'); assert.equal(failedModel.diagnostics.model.status, 'failed');
  assert.equal(failedModel.diagnostics.model.metrics, undefined);
  assert.equal((await state()).events.length, 2);
  const injected = await call('/api/agent/sandbox/chat', { conversationId: 'fiction', requestId: 'inject', input: 'Salve Indevido hoje das 10h às 11h', now: '2030-05-15T08:00' });
  assert.equal(injected.status, 400);
  const history = await call('/api/agent/sandbox/history?conversationId=fiction');
  assert.equal(history.body.turns.filter((turn) => turn.requestId === 'create').length, 1);
  assert.equal((await call('/api/agent/sandbox/history?conversationId=other')).body.turns.length, 0);
  await stop(); await start();
  assert.deepEqual((await call('/api/agent/sandbox/history?conversationId=fiction')).body, history.body);
  assert.deepEqual((await chat('create', 'Salve Leitura hoje das 16h às 17h')).body, created.body);
  assert.equal((await state()).events.length, 2);
  const modelCallsBeforeNatural = calls;
  await call('/api/events', { title: 'Compromisso de tarde', start: '2030-05-16T15:00', end: '2030-05-16T16:00' });
  await call('/api/events', { title: 'Compromisso noturno', start: '2030-05-16T19:00', end: '2030-05-16T20:00' });
  const natural = await chat('natural-question', 'Quero marcar um racha quita feira a noite. Quais os meus compromissos', 'natural');
  assert.equal(natural.body.kind, 'answer');
  assert.ok(natural.body.message.includes('Compromisso noturno'));
  assert.ok(!natural.body.message.includes('Compromisso de tarde'));
  assert.equal(natural.body.eventDraft.date, '2030-05-16');
  assert.equal((await chat('natural-conflict', 'das 19h às 20h', 'natural')).body.kind, 'conflict');
  const naturalProposal = await chat('natural-times', 'das 20h às 21h', 'natural');
  assert.equal(naturalProposal.body.kind, 'suggestion_pending');
  assert.equal(naturalProposal.body.suggestion.event.title, 'Racha');
  assert.equal(naturalProposal.body.suggestion.event.start, '2030-05-16T20:00');
  assert.equal((await chat('unidentified', 'sim', 'unidentified')).body.kind, 'ask');
  // A proposta e o contexto da conversa precisam sobreviver ao reinício da API.
  await stop(); await start();
  const naturalConfirm = await chat('natural-confirm', 'pode confirmar', 'natural');
  assert.equal(naturalConfirm.body.kind, 'applied');
  assert.equal(naturalConfirm.body.event.details.start, '2030-05-16T20:00');
  assert.equal((await chat('natural-repeat', 'sim', 'natural')).body.kind, 'already_applied');
  assert.equal((await state()).events.length, 5);
  const cancelProposal = await chat('cancel-propose', 'Sugira um bloco de estudo para amanhã', 'cancel');
  assert.equal(cancelProposal.body.kind, 'suggestion_pending');
  const versionBeforeCancel = (await state()).version;
  const canceled = await chat('cancel-no', 'não', 'cancel');
  assert.equal(canceled.body.kind, 'suggestion_canceled');
  assert.deepEqual((await chat('cancel-no', 'não', 'cancel')).body, canceled.body);
  assert.equal((await chat('cancel-confirm', `Confirmo a sugestão ${cancelProposal.body.suggestion.id}`, 'cancel')).body.kind, 'ask');
  assert.equal((await state()).version, versionBeforeCancel);
  assert.equal((await state()).events.length, 5);
  await chat('night-query', 'Quais compromissos quinta à noite?', 'followup');
  const friday = await chat('friday', 'E sexta?', 'followup');
  assert.equal(friday.body.agendaQuery.from, '2030-05-17');
  assert.equal(friday.body.agendaQuery.period, 'evening');
  assert.equal(calls, modelCallsBeforeNatural, 'consultas de calendário não são desviadas para preferências');
  await call('/api/events', { title: 'Treino recorrente', start: '2030-05-16T21:00', end: '2030-05-16T22:00', rrule: 'FREQ=DAILY;COUNT=2' });
  const recurringQuery = await chat('recurring-read', 'Quais compromissos sexta à noite?', 'recurring');
  assert.equal(recurringQuery.body.kind, 'answer');
  assert.ok(recurringQuery.body.message.includes('Treino recorrente'));
  await call('/api/events', { title: 'Oficina recorrente', start: '2030-05-14T14:35', end: '2030-05-14T16:00', rrule: 'FREQ=DAILY;COUNT=2' });
  const study = await chat('recurring-study', 'Sugira um bloco de estudo para hoje', 'study-with-series');
  assert.equal(study.body.kind, 'suggestion_pending');
  assert.equal(study.body.suggestion.event.start, '2030-05-14T17:00');
  assert.equal((await chat('recurring-study-confirm', 'pode confirmar', 'study-with-series')).body.kind, 'applied');
  await call('/api/events', { title: 'Marco de dia inteiro', start: '2030-05-14', allDay: true });
  const readonlyPanel = await call('/api/agent/sandbox/panel');
  assert.equal(readonlyPanel.status, 200);
  assert.ok(readonlyPanel.body.events.some((event) => event.allDay && event.details.title === 'Marco de dia inteiro'));
  const blockedWrite = await chat('whole-day-writing', 'Salve Leitura hoje das 12h às 13h', 'all-day');
  assert.equal(blockedWrite.body.kind, 'conflict');
  assert.equal(blockedWrite.body.changed, false);
  assert.equal((await chat('whole-day-study', 'Sugira um bloco de estudo para hoje', 'all-day-study')).body.kind, 'ask');
  assert.equal((await chat('series-writing', 'Salve Leitura amanhã das 12h às 13h', 'with-series')).body.kind, 'created');
  const partial = await chat('partial-create', 'Salve Leitura amanhã às 08h', 'partial');
  assert.equal(partial.body.kind, 'ask');
  assert.equal(partial.body.eventDraft.startTime, '08:00');
  await stop(); await start();
  const invalidEnd = await chat('invalid-end', 'até 07h', 'partial');
  assert.equal(invalidEnd.body.kind, 'ask');
  assert.equal(invalidEnd.body.eventDraft.startTime, '08:00');
  const beforeCompletion = inspection.prepare('SELECT count(*) AS n FROM events').get().n;
  const completed = await chat('complete-end', 'até 09h', 'partial');
  assert.equal(completed.body.kind, 'created');
  assert.equal(completed.body.event.details.start, '2030-05-15T08:00');
  assert.deepEqual((await chat('complete-end', 'até 09h', 'partial')).body, completed.body);
  inspection.prepare('DELETE FROM agent_sandbox_chat WHERE conversation_id = ? AND request_id = ?').run('partial', 'complete-end');
  const recovered = (await chat('complete-end', 'até 09h', 'partial')).body;
  assert.deepEqual({ ...recovered, diagnostics: undefined }, { ...completed.body, diagnostics: undefined });
  assert.ok(recovered.diagnostics.steps.includes('receipt'));
  assert.equal(inspection.prepare('SELECT count(*) AS n FROM events').get().n, beforeCompletion + 1);
  const revisedProposal = (await chat('revise-start', 'Quero marcar uma Oficina sexta das 18h às 19h', 'revise')).body;
  assert.equal(revisedProposal.kind, 'suggestion_pending');
  const revised = (await chat('revise-time', 'na verdade sábado das 09h às 10h', 'revise')).body;
  assert.equal(revised.kind, 'suggestion_pending');
  assert.equal((await state()).suggestions.find((item) => item.id === revisedProposal.suggestion.id).status, 'canceled');
  const registered = (await chat('revise-confirm', 'pode confirmar', 'revise')).body;
  assert.equal(registered.kind, 'applied');
  assert.equal(registered.event.details.start, '2030-05-18T09:00');
  const beforeMove = inspection.prepare('SELECT count(*) AS n FROM events').get().n;
  const move = (await chat('move-day', 'mude para domingo', 'revise')).body;
  assert.equal(move.kind, 'suggestion_pending'); assert.equal(move.suggestion.targetEventId, registered.event.id);
  await stop(); await start();
  const moved = (await chat('move-confirm', 'pode confirmar', 'revise')).body;
  assert.equal(moved.kind, 'applied'); assert.equal(moved.event.id, registered.event.id);
  assert.equal(moved.event.details.start, '2030-05-19T09:00');
  assert.equal(inspection.prepare('SELECT count(*) AS n FROM events').get().n, beforeMove);
  await call('/api/events', { title: 'Conflito na revisão', start: '2030-05-19T11:00', end: '2030-05-19T12:00' });
  assert.equal((await chat('move-conflict', 'das 11h às 12h', 'revise')).body.kind, 'conflict');
  assert.equal((await call(`/api/events/${registered.event.id}`)).body.start, '2030-05-19T09:00');
  assert.equal((await chat('move-free', 'das 12h às 13h', 'revise')).body.kind, 'suggestion_pending');
  const finalMove = (await chat('move-final', 'pode confirmar', 'revise')).body;
  assert.equal(finalMove.kind, 'applied'); assert.equal(finalMove.event.id, registered.event.id);
  assert.equal(finalMove.event.details.start, '2030-05-19T12:00');
  const beforeAssisted = inspection.prepare('SELECT count(*) AS n FROM events').get().n;
  const assisted = (await chat('assisted', 'Você pode colocar o dentista na minha agenda amanhã das 9h às 10h?', 'assisted')).body;
  assert.equal(assisted.kind, 'suggestion_pending'); assert.equal(assisted.suggestion.event.title, 'Dentista');
  assert.equal(assisted.diagnostics.path, 'interpretation'); assert.equal(assisted.diagnostics.model.status, 'completed');
  assert.equal(assisted.diagnostics.context, undefined);
  assert.equal(inspection.prepare('SELECT count(*) AS n FROM events').get().n, beforeAssisted);
  const assistedApplied = (await chat('assisted-confirm', 'pode confirmar', 'assisted')).body;
  assert.equal(assistedApplied.kind, 'applied'); assert.equal(assistedApplied.event.details.start, '2030-05-15T09:00');
  const invented = (await chat('invented-title', 'Pode colocar dentista amanhã das 11h às 12h com título inventado?', 'invented')).body;
  assert.equal(invented.kind, 'ask'); assert.equal(invented.pendingSchedule.start, '11:00');
  assert.equal(invented.diagnostics.model.status, 'rejected');
  const manual = (await chat('manual-title', 'O título é Revisão', 'invented')).body;
  assert.equal(manual.kind, 'suggestion_pending'); assert.equal(manual.suggestion.event.title, 'Revisão');
  assert.equal(manual.suggestion.event.start, '2030-05-15T11:00');
  const beforePlanning = inspection.prepare('SELECT count(*) AS n FROM events').get().n;
  const planningAsk = (await chat('planning-start', 'Na próxima semana coloque dentista segunda das 9h às 10h e leitura quarta.', 'planning')).body;
  assert.equal(planningAsk.kind, 'ask'); assert.match(planningAsk.message, /início e o fim de Leitura/);
  assert.equal(planningAsk.diagnostics.path, 'planning'); assert.equal(planningAsk.diagnostics.model.status, 'needs_clarification');
  assert.equal(planningAsk.planningDraft.now, '2030-05-14T08:00');
  const detour = (await chat('planning-tasks', 'Quais tarefas estão abertas?', 'planning')).body;
  assert.equal(detour.kind, 'answer'); assert.deepEqual(detour.planningDraft, planningAsk.planningDraft);
  await stop(); await start();
  const planningReady = (await chat('planning-complete', 'A leitura será das 18h às 19h.', 'planning')).body;
  assert.equal(planningReady.kind, 'plan_pending'); assert.equal(planningReady.plan.replace, false);
  assert.deepEqual(planningReady.plan.events, [
    { title: 'Dentista', start: '2030-05-20T09:00', end: '2030-05-20T10:00' },
    { title: 'Leitura', start: '2030-05-22T18:00', end: '2030-05-22T19:00' },
  ]);
  assert.equal(inspection.prepare('SELECT count(*) AS n FROM events').get().n, beforePlanning);
  assert.deepEqual((await chat('planning-complete', 'A leitura será das 18h às 19h.', 'planning')).body, planningReady);
  const planningApplied = (await chat('planning-confirm', 'pode confirmar', 'planning')).body;
  assert.equal(planningApplied.kind, 'plan_applied');
  assert.equal(inspection.prepare('SELECT count(*) AS n FROM events').get().n, beforePlanning + 2);
  assert.equal((await chat('planning-confirm-again', 'pode confirmar', 'planning')).body.kind, 'already_applied');
  assert.equal(inspection.prepare('SELECT count(*) AS n FROM events').get().n, beforePlanning + 2);
  assert.equal((await chat('planning-undo', 'desfaça o plano', 'planning')).body.kind, 'plan_undone');
  assert.equal(inspection.prepare('SELECT count(*) AS n FROM events').get().n, beforePlanning);
  const planningBad = (await chat('planning-invented', 'Na próxima semana coloque dentista segunda das 9h às 10h e leitura quarta das 18h às 19h com título inventado.', 'planning-bad')).body;
  assert.equal(planningBad.kind, 'ask'); assert.equal(planningBad.diagnostics.model.status, 'rejected');
  assert.equal((await chat('planning-cancel', 'cancele', 'planning-bad')).body.planningDraft, undefined);
  assert.equal(inspection.prepare('SELECT count(*) AS n FROM events').get().n, beforePlanning);
  await call('/api/events', { title: 'Conflito do plano assistido', start: '2030-05-20T09:00', end: '2030-05-20T10:00' });
  const assistedConflict = (await chat('planning-conflict', 'Na próxima semana coloque dentista segunda das 9h às 10h e leitura quarta das 18h às 19h.', 'planning-conflict')).body;
  assert.equal(assistedConflict.kind, 'conflict'); assert.ok(assistedConflict.planningDraft);
  const conflictRevision = (await chat('planning-conflict-revise', 'Na verdade o dentista será na terça das 9h às 10h.', 'planning-conflict')).body;
  assert.equal(conflictRevision.kind, 'plan_pending'); assert.equal(conflictRevision.plan.events[0].start, '2030-05-21T09:00');
  assert.equal(conflictRevision.plan.events[1].start, '2030-05-22T18:00');
  assert.equal((await chat('planning-conflict-cancel', 'não', 'planning-conflict')).body.kind, 'plan_canceled');
  assert.equal(inspection.prepare('SELECT count(*) AS n FROM events').get().n, beforePlanning + 1);
  const beforeAssistedRoutine = inspection.prepare('SELECT count(*) AS n FROM events').get().n;
  const assistedRoutine = (await chat('assisted-routine', 'Semanalmente quero reservar dentista sábado das 7h às 8h e leitura domingo das 18h às 19h.', 'assisted-routine')).body;
  assert.equal(assistedRoutine.kind, 'plan_pending'); assert.equal(assistedRoutine.plan.repeat, 'weekly');
  assert.equal(assistedRoutine.diagnostics.path, 'planning'); assert.equal(assistedRoutine.plan.events.length, 2);
  assert.equal(inspection.prepare('SELECT count(*) AS n FROM events').get().n, beforeAssistedRoutine);
  assert.equal((await chat('assisted-routine-confirm', 'pode confirmar', 'assisted-routine')).body.kind, 'plan_applied');
  const assistedSeries = inspection.prepare("SELECT * FROM events WHERE rrule = 'FREQ=WEEKLY' AND source = 'ia' ORDER BY start").all();
  assert.equal(assistedSeries.length, 2); assert.ok(assistedSeries.every((event) => event.rrule === 'FREQ=WEEKLY'));
  const laterRoutine = (await call('/api/events?from=2030-06-03&to=2030-06-09')).body.events.filter((event) => assistedSeries.some((series) => series.id === event.seriesId));
  assert.equal(laterRoutine.length, 2);
  assert.equal((await chat('assisted-routine-undo', 'desfaça o plano', 'assisted-routine')).body.kind, 'plan_undone');
  assert.equal(inspection.prepare('SELECT count(*) AS n FROM events').get().n, beforeAssistedRoutine);
  const beforeContinuation = inspection.prepare('SELECT count(*) AS n FROM events').get().n;
  const interrupted = (await chat('continuation-propose', 'Quero marcar Desenho amanhã das 19h às 20h', 'continuation')).body;
  assert.equal(interrupted.kind, 'suggestion_pending');
  const semanticTasks = (await chat('continuation-read', 'Me passa a lista do que falta fazer', 'continuation')).body;
  assert.equal(semanticTasks.kind, 'answer'); assert.deepEqual(semanticTasks.evidenceIds, ['tasks/todo.md']);
  assert.equal(semanticTasks.suggestion, undefined); assert.equal(semanticTasks.continuation.suggestion.id, interrupted.suggestion.id);
  assert.equal(semanticTasks.diagnostics.path, 'tasks'); assert.ok(semanticTasks.diagnostics.steps.includes('route_intent'));
  await stop(); await start();
  assert.equal((await chat('continuation-confirm', 'pode confirmar', 'continuation')).body.kind, 'applied');
  assert.equal(inspection.prepare('SELECT count(*) AS n FROM events').get().n, beforeContinuation + 1);
  assert.equal((await chat('continuation-again', 'pode confirmar', 'continuation')).body.kind, 'already_applied');
  const partialAgain = (await chat('continuation-partial', 'Salve Leitura amanhã às 06h', 'continuation-partial')).body;
  assert.equal(partialAgain.kind, 'ask');
  const semanticCalendar = (await chat('continuation-calendar', 'Dá uma olhada nos horários de sexta', 'continuation-partial')).body;
  assert.equal(semanticCalendar.kind, 'answer'); assert.equal(semanticCalendar.agendaQuery.from, '2030-05-17');
  assert.equal(semanticCalendar.continuation.eventDraft.date, '2030-05-15');
  await stop(); await start();
  const completedPartial = (await chat('continuation-end', 'até 07h', 'continuation-partial')).body;
  assert.equal(completedPartial.kind, 'created'); assert.equal(completedPartial.event.details.start, '2030-05-15T06:00');
  const readPlan = (await chat('read-plan-prepare', 'Organize minha semana. Sábado Leitura das 17h às 18h; domingo Corrida das 07h às 08h.', 'read-plan')).body;
  assert.equal(readPlan.kind, 'plan_pending');
  const readPlanTasks = (await chat('read-plan-tasks', 'Quais tarefas estão abertas?', 'read-plan')).body;
  assert.equal(readPlanTasks.plan, undefined); assert.equal(readPlanTasks.continuation.plan.id, readPlan.plan.id);
  await stop(); await start();
  assert.equal((await chat('read-plan-confirm', 'pode confirmar', 'read-plan')).body.kind, 'plan_applied');
  assert.equal((await chat('read-plan-calendar', 'Como está minha semana?', 'read-plan')).body.kind, 'answer');
  assert.equal((await chat('read-plan-undo', 'desfaça o plano', 'read-plan')).body.kind, 'plan_undone');
  assert.equal(inspection.prepare('SELECT count(*) AS n FROM events').get().n, beforeContinuation + 2);
  const spoofedFrame = await call('/api/agent/sandbox/chat', { conversationId: 'other-conversation', requestId: 'spoof-frame', input: 'pode confirmar', continuation: { suggestion: interrupted.suggestion } });
  assert.equal(spoofedFrame.status, 400);
  console.log('PASS conversa: painel, tarefas, contexto, calendário natural, registro, conflito, confirmação natural após reinício, cancelamento, resposta perdida, concorrência, interpretação de planos e rotinas semanais, retomada após consulta, aplicação/desfazer e bloqueio de ações ou fontes falsas do modelo.');
} finally {
  await stop(); inspection?.close();
  model.closeAllConnections();
  await new Promise((resolve) => model.close(resolve));
  await fs.rm(temp, { recursive: true, force: true });
}
