import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agenda-agent-sandbox-'));
const dbPath = path.join(temp, 'test.db');
const token = randomUUID();
const reservation = net.createServer();
await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, AGENDA_DB: dbPath, AGENDA_HOST: '127.0.0.1', AGENDA_PORT: String(port),
  AGENDA_VAULTS: '', AGENDA_TOKEN: token, AGENDA_ALLOW_LOCAL: '1', AGENDA_SERVE_WEB: '0',
  AGENDA_AGENT_SANDBOX: '1', WHATSAPP_ACCESS_TOKEN: '', WHATSAPP_APP_SECRET: '', AGENDA_LOG_LEVEL: 'silent' };
let child;
let exited;
let inspection;
const now = '2030-05-14T08:00';
async function start() {
  child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  exited = new Promise((resolve) => child.once('exit', resolve));
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`API de teste encerrou: ${output}`);
    try { if ((await fetch(base + '/api/health')).ok) return; } catch {}
    await setTimeout(100);
  }
  throw new Error('API de teste não iniciou');
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([exited, setTimeout(2000)]);
  if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
}
async function call(url, method = 'GET', body, headers = {}) {
  const response = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  return { status: response.status, body: await response.json() };
}
const command = (requestId, input) => call('/api/agent/sandbox/request', 'POST', { requestId, input, now });
const state = async () => { const response = await call('/api/agent/sandbox/state'); assert.equal(response.status, 200); return response.body; };
async function rejectConfig(overrides) {
  const configChild = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "await import('./src/server/config.ts')"],
    { cwd: root, env: { ...env, ...overrides }, stdio: 'ignore' });
  const code = await new Promise((resolve) => configChild.once('exit', resolve));
  assert.notEqual(code, 0, 'Configuração insegura de sandbox deveria ser recusada');
}
try {
  const invalidDir = path.join(temp, 'invalid');
  await fs.mkdir(invalidDir);
  await rejectConfig({ AGENDA_DB: path.join(invalidDir, 'never-open.db') });
  await assert.rejects(fs.access(path.join(invalidDir, 'never-open.db')));
  await rejectConfig({ AGENDA_VAULTS: 'fiction=/caminho-ficticio-nao-consultado' });
  await rejectConfig({ WHATSAPP_ACCESS_TOKEN: 'ficticio' });
  const alias = path.join(temp, 'alias.db');
  await fs.symlink(path.join(invalidDir, 'never-open.db'), alias);
  await rejectConfig({ AGENDA_DB: alias });
  await start();
  inspection = new DatabaseSync(dbPath);
  assert.deepEqual((await call('/api/meta')).body.vaults, []);
  assert.equal((await call('/api/agent/sandbox/state', 'GET', undefined, { 'x-forwarded-for': '203.0.113.8' })).status, 401);
  assert.equal((await call('/api/agent/sandbox/state', 'GET', undefined, { 'x-forwarded-for': '203.0.113.8', 'x-agenda-token': token })).status, 200);
  assert.equal((await state()).events.length, 0);
  assert.equal((await command('missing', 'Salve Oficina hoje às 15h')).body.kind, 'ask');
  const created = await command('create', 'Salve Oficina hoje das 15h às 16h');
  assert.equal(created.body.kind, 'created');
  const id = created.body.event.id;
  assert.equal((await call(`/api/events/${id}`)).body.start, '2030-05-14T15:00');
  assert.deepEqual((await command('create', 'Salve Oficina hoje das 15h às 16h')).body, created.body);
  assert.equal((await state()).events.length, 1);
  assert.equal((await command('conflict', 'Salve Leitura hoje das 15h30 às 16h30')).body.kind, 'conflict');
  const invalid = await call('/api/agent/sandbox/request', 'POST', { requestId: 'injected', input: 'Salve Oficina amanhã', now, event: { title: 'Injected' }, authorized: true });
  assert.equal(invalid.status, 400);
  const proposal = await call('/api/agent/sandbox/propose', 'POST', { expectedVersion: (await state()).version, targetEventId: id,
    event: { title: 'Oficina', start: '2030-05-14T17:00', end: '2030-05-14T18:00' } });
  assert.equal(proposal.body.kind, 'suggestion_pending');
  assert.equal((await call(`/api/events/${id}`)).body.start, '2030-05-14T15:00');
  await stop();
  await start();
  assert.deepEqual((await command('create', 'Salve Oficina hoje das 15h às 16h')).body, created.body, 'recibo sobrevive ao reinício');
  const confirmation = `Confirmo a sugestão ${proposal.body.suggestionId}`;
  assert.equal((await command('confirm', confirmation)).body.kind, 'applied');
  assert.equal((await command('repeat', confirmation)).body.kind, 'already_applied');
  assert.equal((await call(`/api/events/${id}`)).body.start, '2030-05-14T17:00');
  assert.equal((await state()).events.length, 1);
  const next = await call('/api/agent/sandbox/propose', 'POST', { expectedVersion: (await state()).version, targetEventId: id,
    event: { title: 'Oficina', start: '2030-05-14T19:00', end: '2030-05-14T20:00' } });
  assert.equal(next.body.kind, 'suggestion_pending');
  await call(`/api/events/${id}`, 'PATCH', { start: '2030-05-14T17:15' });
  assert.equal((await command('stale', `Confirmo a sugestão ${next.body.suggestionId}`)).body.kind, 'stale_suggestion');
  const removed = await call('/api/agent/sandbox/propose', 'POST', { expectedVersion: (await state()).version, targetEventId: id,
    event: { title: 'Oficina', start: '2030-05-14T19:00', end: '2030-05-14T20:00' } });
  await call(`/api/events/${id}`, 'DELETE');
  assert.equal((await command('deleted', `Confirmo a sugestão ${removed.body.suggestionId}`)).body.kind, 'stale_suggestion');
  const concurrent = await Promise.all([
    command('concurrent', 'Salve Caminhada hoje das 22h às 23h'),
    command('concurrent', 'Salve Caminhada hoje das 22h às 23h'),
  ]);
  assert.deepEqual(concurrent[0].body, concurrent[1].body);
  assert.equal((await state()).events.length, 1);
  await call(`/api/events/${concurrent[0].body.event.id}`, 'DELETE');
  const before = await state();
  const auditBefore = inspection.prepare('SELECT count(*) AS n FROM audit').get().n;
  inspection.exec("CREATE TRIGGER reject_agent_test BEFORE INSERT ON events WHEN NEW.source = 'ia' BEGIN SELECT RAISE(ABORT, 'falha fictícia'); END");
  assert.equal((await command('fail', 'Salve Leitura hoje das 19h às 20h')).body.kind, 'tool_error');
  const after = await state();
  assert.equal(after.version, before.version);
  assert.deepEqual(after.events, before.events);
  assert.deepEqual(after.suggestions, before.suggestions);
  assert.equal(inspection.prepare('SELECT count(*) AS n FROM audit').get().n, auditBefore);
  inspection.exec('DROP TRIGGER reject_agent_test');
  assert.equal((await command('retry-explicit', 'Salve Leitura hoje das 19h às 20h')).body.kind, 'created');
  assert.equal((await state()).events.length, 1);
  const recurring = await call('/api/events', 'POST', { title: 'Série fictícia', start: '2030-05-16T10:00', end: '2030-05-16T11:00', rrule: 'FREQ=DAILY;COUNT=2' });
  assert.equal(recurring.status, 201);
  const recurringId = recurring.body.seriesId;
  assert.equal((await command('with-series', 'Salve Caminhada amanhã das 06h às 07h')).body.kind, 'created');
  assert.equal((await command('series-conflict', 'Salve Oficina 2030-05-17 das 10h30 às 11h30')).body.kind, 'conflict');
  assert.equal((await command('series-adjacent', 'Salve Leitura 2030-05-17 das 11h às 12h')).body.kind, 'created');
  // Move ocorrência futura para antes do início da própria série.
  await call(`/api/events/${recurringId}?scope=this&occurrence=2030-05-17`, 'PATCH', { start: '2030-05-15T12:00', end: '2030-05-15T13:00' });
  assert.equal((await command('moved-conflict', 'Salve Oficina 2030-05-15 das 12h30 às 13h30')).body.kind, 'conflict');
  assert.equal((await command('moved-vacancy', 'Salve Oficina 2030-05-17 das 10h às 11h')).body.kind, 'created');
  const seriesState = await call('/api/agent/sandbox/state?from=2030-05-16&to=2030-05-17');
  assert.equal((await call('/api/agent/sandbox/propose', 'POST', { expectedVersion: seriesState.body.version, targetEventId: recurringId,
    event: { title: 'Série fictícia', start: '2030-05-16T08:00', end: '2030-05-16T09:00' } })).status, 400);
  // Excluir só uma ocorrência deve liberar somente aquele intervalo.
  await call(`/api/events/${recurringId}?scope=this&occurrence=2030-05-16`, 'DELETE');
  assert.equal((await command('canceled-vacancy', 'Salve Oficina 2030-05-16 das 10h às 11h')).body.kind, 'created');
  const allDay = await call('/api/events', 'POST', { title: 'Viagem fictícia', start: '2030-05-20', end: '2030-05-21', allDay: true });
  assert.equal(allDay.status, 201);
  assert.equal((await command('day-block', 'Salve Oficina 2030-05-20 das 09h às 10h')).body.kind, 'conflict');
  assert.equal((await command('last-day-block', 'Salve Oficina 2030-05-21 das 23h às 23h30')).body.kind, 'conflict');
  assert.equal((await command('after-day', 'Salve Oficina 2030-05-22 das 00h às 01h')).body.kind, 'created');
  const overnight = await call('/api/events', 'POST', { title: 'Plantão fictício', start: '2030-05-23T23:00', end: '2030-05-24T01:00', rrule: 'FREQ=DAILY;COUNT=2' });
  assert.equal(overnight.status, 201);
  assert.equal((await command('overnight-block', 'Salve Oficina 2030-05-24 das 00h30 às 01h30')).body.kind, 'conflict');
  assert.equal((await command('overnight-adjacent', 'Salve Oficina 2030-05-24 das 01h às 02h')).body.kind, 'created');
  // Uma exceção criada depois da proposta invalida sua confirmação e preserva a série.
  const pendingSeries = await call('/api/agent/sandbox/propose', 'POST', { expectedVersion: (await state()).version,
    event: { title: 'Leitura', start: '2030-05-25T10:00', end: '2030-05-25T11:00' } });
  assert.equal(pendingSeries.body.kind, 'suggestion_pending');
  await call(`/api/events/${overnight.body.seriesId}?scope=this&occurrence=2030-05-24`, 'PATCH', { start: '2030-05-25T10:00', end: '2030-05-25T11:00' });
  assert.equal((await command('exception-stale', `Confirmo a sugestão ${pendingSeries.body.suggestionId}`)).body.kind, 'stale_suggestion');
  assert.equal((await command('exception-overlap', 'Salve Oficina 2030-05-25 das 10h às 11h')).body.kind, 'conflict');
  assert.equal((await call('/api/agent/sandbox/state?from=2030-05-20&to=2030-05-19')).status, 400);
  assert.equal((await call('/api/agent/sandbox/state?from=2030-05-20&to=2032-05-20')).status, 400);
  // Séries antigas não podem desaparecer e produzir uma autorização falsa de escrita.
  await call('/api/events', 'POST', { title: 'Série antiga', start: '2000-01-01T03:00', end: '2000-01-01T04:00', rrule: 'FREQ=DAILY' });
  assert.equal((await command('old-series', 'Salve Oficina 2030-05-14 das 03h às 04h')).body.kind, 'conflict');
  const weeklyDay = await call('/api/events', 'POST', { title: 'Dia reservado', start: '2030-05-27', allDay: true, rrule: 'FREQ=WEEKLY;COUNT=2' });
  assert.equal(weeklyDay.status, 201);
  assert.equal((await command('recurring-day', 'Salve Oficina 2030-06-03 das 09h às 10h')).body.kind, 'conflict');
  assert.equal((await command('after-recurring-day', 'Salve Oficina 2030-06-04 das 09h às 10h')).body.kind, 'created');
  const pendingWrite = await call('/api/agent/sandbox/propose', 'POST', { expectedVersion: (await state()).version,
    event: { title: 'Teste de transação', start: '2030-05-30T06:00', end: '2030-05-30T07:00' } });
  assert.equal(pendingWrite.body.kind, 'suggestion_pending');
  const beforeFailure = await state();
  inspection.exec("CREATE TRIGGER reject_agent_test BEFORE INSERT ON events WHEN NEW.source = 'ia' BEGIN SELECT RAISE(ABORT, 'falha fictícia'); END");
  const confirmPending = `Confirmo a sugestão ${pendingWrite.body.suggestionId}`;
  assert.equal((await command('series-confirm-fail', confirmPending)).body.kind, 'tool_error');
  assert.deepEqual(await state(), beforeFailure, 'falha não consome proposta nem altera versão, recibos ou eventos');
  inspection.exec('DROP TRIGGER reject_agent_test');
  assert.equal((await command('series-confirm-retry', confirmPending)).body.kind, 'applied');
  assert.equal((await command('series-confirm-repeat', confirmPending)).body.kind, 'already_applied');
  console.log('PASS agente/API: isolamento, autenticação, recibos, reinício, concorrência, rollback, conflitos com séries/exceções/dia inteiro/meia-noite, adjacência e confirmação desatualizada.');
} finally {
  await stop();
  inspection?.close();
  await fs.rm(temp, { recursive: true, force: true });
}
