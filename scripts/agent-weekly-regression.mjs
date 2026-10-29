import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { prepareDemoContext } from './agent-demo-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agenda-agent-sandbox-'));
const dbPath = path.join(temp, 'weekly.db');
let modelCalls = 0;
const model = createServer((request, response) => { modelCalls++; request.resume(); response.statusCode = 503; response.end('{}'); });
await new Promise((resolve) => model.listen(0, '127.0.0.1', resolve));
const reservation = net.createServer();
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, AGENDA_DB: dbPath, AGENDA_HOST: '127.0.0.1', AGENDA_PORT: String(port),
  AGENDA_VAULTS: '', AGENDA_TOKEN: 'ficticio', AGENDA_ALLOW_LOCAL: '1', AGENDA_SERVE_WEB: '0', AGENDA_AGENT_SANDBOX: '1',
  AGENDA_AGENT_DEMO_NOW: '2026-10-28T08:00', AGENDA_LOG_LEVEL: 'silent', WHATSAPP_ACCESS_TOKEN: '', WHATSAPP_APP_SECRET: '',
  AGENT_OLLAMA_URL: `http://127.0.0.1:${model.address().port}`, AGENT_MODEL: 'qwen3:4b', AGENT_TIMEOUT_MS: '1000' };
const reported = 'Vamos organizar minha semana. Primeiro remova todos os compromissos depois Coloque segunda e quarta o trabalho das 8 as 14. Terça quinta e sexta das 10 as 16';
let child, exited, inspection;
async function start() {
  child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
  exited = new Promise((resolve) => child.once('exit', resolve));
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(output);
    try { if ((await fetch(base + '/api/health')).ok) return; } catch {}
    await setTimeout(50);
  }
  throw new Error('API de plano semanal não iniciou');
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM'); await Promise.race([exited, setTimeout(2000)]);
  if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
}
async function call(url, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + url, { method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value;
}
const chat = (requestId, input, conversationId = 'weekly') => call('/api/agent/sandbox/chat', { requestId, input, conversationId });
const occurrences = () => call('/api/events?from=2026-10-26&to=2026-11-01').then((value) => value.events);
const agendaSnapshot = () => ({ events: inspection.prepare('SELECT * FROM events ORDER BY id').all(), overrides: inspection.prepare('SELECT * FROM overrides ORDER BY event_id, occurrence_date').all() });
try {
  await prepareDemoContext(temp); await start(); inspection = new DatabaseSync(dbPath);
  await call('/api/events', { title: 'Oficina de desenho', start: '2026-10-28T09:00', end: '2026-10-28T10:00' });
  await call('/api/events', { title: 'Clube de leitura', start: '2026-10-28T14:30', end: '2026-10-28T15:30' });
  await call('/api/events', { title: 'Fora da semana', start: '2026-11-02T20:00', end: '2026-11-02T21:00' });
  const series = await call('/api/events', { title: 'Treino fictício', start: '2026-10-26T06:00', end: '2026-10-26T07:00', rrule: 'FREQ=DAILY;COUNT=14' });
  await call(`/api/events/${series.seriesId}?scope=this&occurrence=2026-10-27`, { start: '2026-10-27T06:30', end: '2026-10-27T07:30' }, 'PATCH');
  await call('/api/events', { title: 'Dia reservado', start: '2026-10-30', allDay: true });
  const original = agendaSnapshot();
  const query = await chat('overview', 'Como está minha semana');
  assert.equal(query.kind, 'answer'); assert.deepEqual(query.evidenceIds, ['agenda']);
  assert.ok(query.message.includes('Oficina de desenho')); assert.ok(query.message.includes('Clube de leitura'));
  assert.equal(query.agendaQuery.from, '2026-10-26'); assert.equal(query.agendaQuery.to, '2026-11-01');
  const removal = await chat('removal-prepare', 'Pode remover todos os compromissos da semana?', 'removal-only');
  assert.equal(removal.kind, 'plan_pending'); assert.equal(removal.plan.events.length, 0);
  assert.equal(removal.plan.removals.length, 10); assert.ok(removal.message.includes('Nenhum compromisso será adicionado'));
  assert.deepEqual(agendaSnapshot(), original, 'pergunta educada prepara a prévia sem remover nada');
  await stop(); await start();
  assert.equal((await chat('removal-apply', 'pode confirmar', 'removal-only')).kind, 'plan_applied');
  assert.equal((await occurrences()).length, 0);
  assert.equal((await call('/api/events?from=2026-11-02&to=2026-11-02')).events.length, 2, 'remoção afeta só esta semana, preservando série e evento posteriores');
  const removedSnapshot = agendaSnapshot();
  assert.equal((await chat('removal-repeat', 'sim', 'removal-only')).kind, 'already_applied'); assert.deepEqual(agendaSnapshot(), removedSnapshot);
  const alreadyEmpty = await chat('empty-week', 'Pode remover todos os compromissos da semana?', 'empty-week');
  assert.equal(alreadyEmpty.kind, 'answer'); assert.equal(alreadyEmpty.plan, undefined); assert.equal(alreadyEmpty.changed, false);
  assert.equal((await chat('removal-undo', 'desfazer o plano', 'removal-only')).kind, 'plan_undone'); assert.deepEqual(agendaSnapshot(), original);
  await chat('removal-cancel-prepare', 'Você pode apagar todos os eventos desta semana?', 'removal-cancel');
  assert.equal((await chat('removal-cancel', 'não', 'removal-cancel')).kind, 'plan_canceled'); assert.deepEqual(agendaSnapshot(), original);
  await chat('removal-fail-prepare', 'Pode remover todos os compromissos da semana?', 'removal-failure');
  inspection.exec("CREATE TRIGGER fail_removal BEFORE DELETE ON events WHEN OLD.title = 'Clube de leitura' BEGIN SELECT RAISE(ABORT, 'falha fictícia na remoção'); END");
  const removalAuditBefore = inspection.prepare('SELECT count(*) AS n FROM audit').get().n;
  assert.equal((await chat('removal-fail-confirm', 'pode confirmar', 'removal-failure')).kind, 'tool_error');
  assert.deepEqual(agendaSnapshot(), original, 'falha na remoção restaura eventos, exceções e séries na mesma transação');
  assert.equal(inspection.prepare('SELECT count(*) AS n FROM audit').get().n, removalAuditBefore);
  inspection.exec('DROP TRIGGER fail_removal');
  for (const [index, input] of ['Não remova todos os compromissos da semana.', 'Pode remover todos os compromissos da semana se chover?', 'Pode remover todos os compromissos desta semana e da próxima semana?'].entries()) {
    assert.equal((await chat(`removal-blocked-${index}`, input, `removal-blocked-${index}`)).kind, 'ask'); assert.deepEqual(agendaSnapshot(), original);
  }
  const prepared = await chat('prepare', reported);
  assert.equal(prepared.kind, 'plan_pending'); assert.equal(prepared.plan.events.length, 5); assert.equal(prepared.plan.removals.length, 10);
  assert.deepEqual(agendaSnapshot(), original, 'preparar não altera compromissos');
  assert.deepEqual(await chat('prepare', reported), prepared);
  await stop(); await start();
  const applied = await chat('confirm', 'pode confirmar');
  assert.equal(applied.kind, 'plan_applied'); assert.equal(applied.changed, true);
  assert.deepEqual((await occurrences()).map((item) => [item.title, item.start, item.end]), prepared.plan.events.map((item) => [item.title, item.start, item.end]));
  assert.equal((await call('/api/events?from=2026-11-02&to=2026-11-02')).events.length, 2, 'semana seguinte preservada, inclusive recorrência');
  const afterApply = agendaSnapshot();
  assert.equal((await chat('repeat-confirm', 'sim')).kind, 'already_applied'); assert.deepEqual(agendaSnapshot(), afterApply);
  const undone = await chat('undo', 'desfazer o plano');
  assert.equal(undone.kind, 'plan_undone'); assert.equal(undone.changed, true); assert.deepEqual(agendaSnapshot(), original);
  assert.equal((await chat('repeat-undo', 'desfazer o plano')).changed, false); assert.deepEqual(agendaSnapshot(), original);
  await chat('cancel-prepare', reported, 'cancel'); assert.equal((await chat('cancel', 'não', 'cancel')).kind, 'plan_canceled');
  assert.deepEqual(agendaSnapshot(), original);
  assert.equal((await chat('cancel-confirm', 'pode confirmar', 'cancel')).kind, 'ask'); assert.deepEqual(agendaSnapshot(), original);
  const stale = await chat('stale-prepare', reported, 'stale');
  await call('/api/events', { title: 'Alteração externa', start: '2026-10-31T20:00', end: '2026-10-31T21:00' });
  const afterExternal = agendaSnapshot();
  assert.equal((await chat('stale-confirm', `Confirmo o plano ${stale.plan.id}`, 'stale')).kind, 'stale_suggestion');
  assert.deepEqual(agendaSnapshot(), afterExternal);
  const failing = await chat('fail-prepare', reported, 'failure');
  const auditBefore = inspection.prepare('SELECT count(*) AS n FROM audit').get().n;
  inspection.exec("CREATE TRIGGER fail_weekly BEFORE INSERT ON events WHEN NEW.title = 'Trabalho' AND substr(NEW.start,1,10) = '2026-10-30' BEGIN SELECT RAISE(ABORT, 'falha fictícia no quinto evento'); END");
  assert.equal((await chat('fail-confirm', `Confirmo o plano ${failing.plan.id}`, 'failure')).kind, 'tool_error');
  assert.deepEqual(agendaSnapshot(), afterExternal, 'falha no quinto registro restaura também remoções e exceções');
  assert.equal(inspection.prepare('SELECT count(*) AS n FROM audit').get().n, auditBefore);
  assert.equal(JSON.parse(inspection.prepare('SELECT data FROM agent_sandbox_plans WHERE id = ?').get(failing.plan.id).data).status, 'pending');
  inspection.exec('DROP TRIGGER fail_weekly');
  const simultaneous = await Promise.all([chat('apply-one', `Confirmo o plano ${failing.plan.id}`, 'failure'), chat('apply-two', `Confirmo o plano ${failing.plan.id}`, 'failure')]);
  assert.deepEqual(simultaneous.map((item) => item.kind).sort(), ['already_applied', 'plan_applied']); assert.equal((await occurrences()).length, 5);
  await call('/api/events', { title: 'Nova edição', start: '2026-11-01T20:00', end: '2026-11-01T21:00' });
  const later = agendaSnapshot();
  assert.equal((await chat('undo-stale', `Desfaça o plano ${failing.plan.id}`, 'failure')).kind, 'stale_suggestion'); assert.deepEqual(agendaSnapshot(), later);
  assert.equal((await chat('invalid-tail', reported + '. Apague também o próximo mês', 'invalid')).kind, 'ask'); assert.deepEqual(agendaSnapshot(), later);
  const spanning = await call('/api/events', { title: 'Atravessa a semana', start: '2026-10-25T23:00', end: '2026-10-26T01:00' });
  const crossing = agendaSnapshot();
  assert.equal((await chat('crossing', reported, 'crossing')).kind, 'ask'); assert.deepEqual(agendaSnapshot(), crossing);
  await call(`/api/events/${spanning.seriesId}`, undefined, 'DELETE');
  const recurringRequest = 'Vamos organizar minha semana!\nRemova todos os compromissos da semana. Após isso marque os dias do meu trabalho fixos para todas as semanas. Segunda e quarta de 8 as 14. Terça, quinta e sexta. De 10 as 16:30.';
  const recurringBefore = agendaSnapshot();
  const recurringPlan = await chat('recurring-prepare', recurringRequest, 'recurring');
  assert.equal(recurringPlan.kind, 'plan_pending'); assert.equal(recurringPlan.plan.repeat, 'weekly');
  assert.equal(recurringPlan.plan.events.length, 5); assert.ok(recurringPlan.message.includes('16:30'));
  assert.ok(recurringPlan.message.includes('sem data final')); assert.ok(recurringPlan.plan.conflictsThrough > '2027-10-01');
  assert.deepEqual(agendaSnapshot(), recurringBefore);
  await stop(); await start();
  const recurringApplied = await chat('recurring-confirm', 'pode confirmar', 'recurring');
  assert.equal(recurringApplied.kind, 'plan_applied');
  const createdSeries = inspection.prepare("SELECT * FROM events WHERE source = 'ia' AND rrule = 'FREQ=WEEKLY' ORDER BY start").all();
  assert.equal(createdSeries.length, 5, 'cinco séries-base, sem materializar cópias de eventos por semana');
  for (const [from, to] of [['2026-11-02', '2026-11-08'], ['2026-11-23', '2026-11-29'], ['2028-10-23', '2028-10-29']]) {
    const work = (await call(`/api/events?from=${from}&to=${to}`)).events.filter((event) => event.title === 'Trabalho');
    assert.equal(work.length, 5); assert.ok(work.every((event) => event.recurring));
    assert.deepEqual(work.map((event) => event.end.slice(11)), ['14:00', '16:30', '14:00', '16:30', '16:30']);
  }
  assert.equal((await chat('recurring-repeat', 'sim', 'recurring')).kind, 'already_applied');
  assert.equal(inspection.prepare("SELECT count(*) AS n FROM events WHERE rrule = 'FREQ=WEEKLY' AND source = 'ia'").get().n, 5);
  assert.equal((await chat('recurring-undo', 'desfazer o plano', 'recurring')).kind, 'plan_undone');
  assert.deepEqual(agendaSnapshot(), recurringBefore, 'desfazer remove todas as séries novas e restaura somente as remoções previstas');
  const futureBusy = await call('/api/events', { title: 'Conflito na próxima semana', start: '2026-11-04T13:00', end: '2026-11-04T15:00', rrule: 'FREQ=WEEKLY;COUNT=3' });
  const beforeBlocked = agendaSnapshot();
  const blockedRoutine = await chat('recurring-conflict', recurringRequest, 'blocked-recurring');
  assert.equal(blockedRoutine.kind, 'conflict'); assert.ok(blockedRoutine.message.includes('04/11/2026'));
  assert.deepEqual(agendaSnapshot(), beforeBlocked);
  await call(`/api/events/${futureBusy.seriesId}`, undefined, 'DELETE');
  const distant = await call('/api/events', { title: 'Compromisso futuro distante', start: '2028-10-30T13:00', end: '2028-10-30T15:00' });
  assert.equal((await chat('recurring-distant', recurringRequest, 'distant')).kind, 'conflict');
  await call(`/api/events/${distant.seriesId}`, undefined, 'DELETE');
  const retryPlan = await chat('recurring-fail-prepare', recurringRequest, 'recurring-failure');
  assert.equal(retryPlan.kind, 'plan_pending');
  const beforeRecurringFailure = agendaSnapshot();
  inspection.exec("CREATE TRIGGER fail_recurring BEFORE INSERT ON events WHEN NEW.rrule = 'FREQ=WEEKLY' AND substr(NEW.start,1,10) = '2026-10-30' BEGIN SELECT RAISE(ABORT, 'falha fictícia na quinta série'); END");
  assert.equal((await chat('recurring-fail-confirm', `Confirmo o plano ${retryPlan.plan.id}`, 'recurring-failure')).kind, 'tool_error');
  assert.deepEqual(agendaSnapshot(), beforeRecurringFailure, 'rollback da quinta série restaura todas as remoções');
  inspection.exec('DROP TRIGGER fail_recurring');
  await chat('abbreviated-clear', 'Pode remover todos os compromissos da semana?', 'abbreviated-clear');
  assert.equal((await chat('abbreviated-clear-confirm', 'pode confirmar', 'abbreviated-clear')).kind, 'plan_applied');
  const beforeAbbreviated = agendaSnapshot();
  const abbreviated = 'Organize o meu trabalho. Deixe o horário fixo para todas as semanas. Seg e qua 8 as 14. ter, qui, sex 8 as 16:30';
  const abbreviatedPlan = await chat('abbreviated-prepare', abbreviated, 'abbreviated');
  assert.equal(abbreviatedPlan.kind, 'plan_pending'); assert.equal(abbreviatedPlan.plan.repeat, 'weekly');
  assert.equal(abbreviatedPlan.plan.replace, false); assert.equal(abbreviatedPlan.plan.events.length, 5);
  assert.ok(abbreviatedPlan.plan.events.every((event) => event.title === 'Trabalho' && event.start.endsWith('T08:00')));
  assert.deepEqual(abbreviatedPlan.plan.events.map((event) => event.end.slice(11)), ['14:00', '16:30', '14:00', '16:30', '16:30']);
  assert.deepEqual(agendaSnapshot(), beforeAbbreviated);
  await stop(); await start();
  assert.equal((await chat('abbreviated-confirm', 'pode confirmar', 'abbreviated')).kind, 'plan_applied');
  for (const [from, to] of [['2026-11-02', '2026-11-08'], ['2028-10-23', '2028-10-29']]) {
    const work = (await call(`/api/events?from=${from}&to=${to}`)).events.filter((event) => event.title === 'Trabalho');
    assert.equal(work.length, 5); assert.ok(work.every((event) => event.start.endsWith('T08:00') && event.recurring));
    assert.deepEqual(work.map((event) => event.end.slice(11)), ['14:00', '16:30', '14:00', '16:30', '16:30']);
  }
  assert.equal((await chat('abbreviated-repeat', 'sim', 'abbreviated')).kind, 'already_applied');
  assert.equal((await chat('abbreviated-undo', 'desfaça o plano', 'abbreviated')).kind, 'plan_undone');
  assert.deepEqual(agendaSnapshot(), beforeAbbreviated);
  assert.equal(modelCalls, 0, 'consultas e planos de calendário não usam preferências para inventar agenda');
  console.log('PASS semana: pedidos reportados, cinco blocos e cinco séries semanais, prévia, reinício, repetição, cancelamento, exceções, semanas futuras, conflitos futuros, desfazer, rollback e concorrência.');
} finally {
  await stop(); inspection?.close(); model.closeAllConnections(); await new Promise((resolve) => model.close(resolve)); await fs.rm(temp, { recursive: true, force: true });
}
