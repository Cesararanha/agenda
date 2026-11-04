// Exercita a API existente em processo separado, banco temporário e vaults desativados.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agenda-regression-'));
const token = randomUUID();
const reservation = net.createServer();
await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/server/index.ts'], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
    // Com DATABASE_URL explícito e AGENDA_DB vazio, roda no Postgres de teste.
    AGENDA_DB: process.env.DATABASE_URL && process.env.AGENDA_DB === '' ? '' : path.join(temp, 'test.db'), AGENDA_HOST: '127.0.0.1', AGENDA_PORT: String(port),
    AGENDA_VAULTS: '', AGENDA_TOKEN: token, AGENDA_ALLOW_LOCAL: '1', AGENDA_SERVE_WEB: '1',
    AGENDA_AGENT_SANDBOX: '0', AGENT_OLLAMA_URL: base,
    WHATSAPP_ACCESS_TOKEN: '', WHATSAPP_APP_SECRET: '', AGENDA_LOG_LEVEL: 'silent',
  },
});
let output = '';
child.stdout.on('data', (chunk) => { output += chunk; });
child.stderr.on('data', (chunk) => { output += chunk; });
const exited = new Promise((resolve) => child.once('exit', resolve));
async function request(url, method = 'GET', body, headers = {}) {
  const response = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(3000) });
  return { status: response.status, body: await response.json() };
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`API de teste encerrou: ${output}`);
    try { ready = (await fetch(base + '/api/health')).ok; } catch {}
    if (ready) break;
    await setTimeout(100);
  }
  assert.ok(ready, 'API não iniciou');
  assert.equal((await fetch(base + '/')).status, 200, 'PWA');
  assert.deepEqual((await request('/api/meta')).body.vaults, [], 'vaults precisam estar desligados');
  assert.equal((await request('/api/agent/sandbox/state')).status, 404, 'agente não é exposto por padrão');
  assert.equal((await request(`/api/meta?token=${token}`, 'GET', undefined, { 'x-forwarded-for': '203.0.113.9' })).status, 401, 'token na URL não vale');
  // Na nuvem não existe modo aberto: sem token, o servidor não sobe.
  const open = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/server/config.ts'], { cwd: root, encoding: 'utf8',
    env: { ...process.env, VERCEL: '1', AGENDA_DB: '', DATABASE_URL: 'postgresql://nunca-conecta', AGENDA_TOKEN: '' } });
  assert.notEqual(open.status, 0, 'nuvem sem token precisa falhar');
  for (const header of ['x-forwarded-for', 'cf-connecting-ip']) {
    assert.equal((await request('/api/meta', 'GET', undefined, { [header]: '203.0.113.9' })).status, 401);
    assert.equal((await request('/api/meta', 'GET', undefined, { [header]: '203.0.113.9', 'x-agenda-token': token })).status, 200);
  }
  assert.equal((await request('/api/whatsapp/webhook', 'POST', {})).status, 403);
  const created = await request('/api/events', 'POST', { title: 'Evento fictício', start: '2030-05-14T15:00', end: '2030-05-14T16:00' });
  assert.equal(created.status, 201);
  const id = created.body.seriesId;
  assert.equal((await request('/api/events?from=2030-05-14&to=2030-05-14')).body.events.length, 1);
  assert.equal((await request(`/api/events/${id}`, 'PATCH', { start: '2030-05-14T16:00' })).body.start, '2030-05-14T16:00');
  await request(`/api/events/${id}`, 'DELETE');
  assert.equal((await request('/api/events?from=2030-05-14&to=2030-05-14')).body.events.length, 0);
  const recurring = await request('/api/events', 'POST', { title: 'Série fictícia', start: '2030-05-14T10:00', end: '2030-05-14T11:00', rrule: 'FREQ=DAILY;COUNT=3' });
  assert.equal(recurring.status, 201);
  const seriesId = recurring.body.seriesId;
  await request(`/api/events/${seriesId}?scope=this&occurrence=2030-05-15`, 'PATCH', { start: '2030-05-15T12:00' });
  const occurrences = (await request('/api/events?from=2030-05-14&to=2030-05-16')).body.events;
  assert.deepEqual(occurrences.map((event) => event.start), ['2030-05-14T10:00', '2030-05-15T12:00', '2030-05-16T10:00']);
  await request(`/api/events/${seriesId}?scope=this&occurrence=2030-05-16`, 'PATCH', { start: '2030-05-13T10:00', end: '2030-05-13T11:00' });
  const beforeAnchor = (await request('/api/events?from=2030-05-13&to=2030-05-13')).body.events;
  assert.equal(beforeAnchor.length, 1, 'exceção movida para antes da âncora precisa aparecer');
  assert.equal(beforeAnchor[0].occurrenceDate, '2030-05-16');
  await request(`/api/events/${seriesId}?scope=this&occurrence=2030-05-15`, 'PATCH', { start: '2030-06-01T12:00', end: '2030-06-01T13:00' });
  const movedLater = (await request('/api/events?from=2030-06-01&to=2030-06-01')).body.events;
  assert.equal(movedLater.length, 1, 'exceção movida para depois do fim da série precisa aparecer');
  await request(`/api/events/${seriesId}?scope=this&occurrence=2030-05-15`, 'DELETE');
  assert.equal((await request('/api/events?from=2030-06-01&to=2030-06-01')).body.events.length, 0);
  // Fora da demo, data relativa parte do relógio real.
  const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Maceio' }).format(new Date(Date.now() + 86400000));
  const relative = await request('/api/quick-add', 'POST', { text: 'amanhã 14h oficina fictícia' });
  assert.equal(relative.body.drafts[0].date, tomorrow);
  const quick = await request('/api/quick-add', 'POST', { text: '2030-05-17 14h-15h Oficina fictícia' });
  assert.equal(quick.status, 200);
  assert.match(quick.body.notice, /jeito simples/);
  assert.equal(quick.body.drafts[0].time, '14:00');
  const day = (date) => request(`/api/events?from=${date}&to=${date}`);
  assert.equal((await day('2030-05-17')).body.events.length, 0);
  const saved = await request('/api/quick-add/confirm', 'POST', { drafts: quick.body.drafts });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.events[0].start, '2030-05-17T14:00');
  assert.equal((await request('/api/quick-add/confirm', 'POST', { drafts: quick.body.drafts })).status, 400);
  const missing = await request('/api/quick-add', 'POST', { text: '2030-05-18 ligar pro coordenador' });
  assert.equal(missing.body.drafts[0].time, '');
  assert.equal((await request('/api/quick-add/confirm', 'POST', { drafts: missing.body.drafts })).status, 400);
  const suggestions = (date) => request(`/api/suggestions?from=${date}&to=${date}`);
  assert.equal((await suggestions('2030-05-18')).body.suggestions.length, 0);
  const untimed = await request('/api/quick-add/confirm', 'POST', { drafts: missing.body.drafts, saveWithoutTime: true });
  assert.equal(untimed.status, 201);
  assert.equal(untimed.body.events[0].suggestion, true);
  assert.equal((await day('2030-05-18')).body.events.length, 0);
  assert.equal((await suggestions('2030-05-18')).body.suggestions.length, 1);
  const scheduled = await request('/api/quick-add/confirm', 'POST', {
    drafts: [{ ...missing.body.drafts[0], time: '12:00', endTime: '13:00' }],
    suggestionId: untimed.body.events[0].seriesId,
  });
  assert.equal(scheduled.status, 201);
  assert.equal((await suggestions('2030-05-18')).body.suggestions.length, 0);
  assert.equal((await day('2030-05-18')).body.events.length, 1);
  const whatsapp = (text) => request('/api/whatsapp/simulate', 'POST', { text });
  const proposed = await whatsapp('2030-05-18 9h consulta e depois 15h exame');
  const code = proposed.body.reply.match(/confirmo [a-f0-9]{12}/)?.[0];
  assert.ok(code, proposed.body.reply);
  assert.match(proposed.body.reply, /Consulta/i);
  assert.match(proposed.body.reply, /Exame/i);
  assert.equal((await day('2030-05-18')).body.events.length, 1);
  assert.match((await whatsapp('sim')).body.reply, /código/);
  assert.match((await whatsapp(code)).body.reply, /Marcado/);
  assert.match((await whatsapp(code)).body.reply, /já foi confirmada/);
  assert.equal((await day('2030-05-18')).body.events.length, 3);
  const untimedWhatsapp = await whatsapp('2030-05-20 levar documentos');
  assert.match(untimedWhatsapp.body.reply, /sugestão sem horário/);
  const untimedCode = untimedWhatsapp.body.reply.match(/confirmo [a-f0-9]{12}/)?.[0];
  assert.ok(untimedCode, untimedWhatsapp.body.reply);
  assert.equal((await suggestions('2030-05-20')).body.suggestions.length, 0);
  assert.match((await whatsapp(untimedCode)).body.reply, /Sugestão guardada/);
  assert.equal((await day('2030-05-20')).body.events.length, 0);
  assert.equal((await suggestions('2030-05-20')).body.suggestions.length, 1);
  const contested = await whatsapp('2030-05-19 9h ensaio e depois 15h leitura');
  const contestedCode = contested.body.reply.match(/confirmo [a-f0-9]{12}/)?.[0];
  assert.ok(contestedCode, contested.body.reply);
  await request('/api/events', 'POST', { title: 'Conflito fictício', start: '2030-05-19T15:00' });
  assert.equal((await whatsapp(contestedCode)).status, 400);
  assert.equal((await day('2030-05-19')).body.events.length, 1);
  const finite = (await request('/api/events', 'POST', { title: 'Rotina finita fictícia', start: '2030-06-10T10:00', end: '2030-06-10T11:00', rrule: 'FREQ=DAILY;COUNT=5' })).body.seriesId;
  await request(`/api/events/${finite}?scope=this&occurrence=2030-06-13`, 'PATCH', { start: '2030-06-13T15:00', end: '2030-06-13T16:00' });
  await request(`/api/events/${finite}?scope=this&occurrence=2030-06-14`, 'DELETE');
  const finiteUrl = '/api/events?from=2030-06-10&to=2030-06-20';
  const beforeSplit = (await request(finiteUrl)).body.events;
  const incompatible = await request(`/api/events/${finite}?scope=future&occurrence=2030-06-12`, 'PATCH', { start: '2030-06-13T12:00', end: '2030-06-13T13:00' });
  assert.equal(incompatible.status, 400, 'trocar a data com exceções futuras exige esclarecimento');
  assert.deepEqual((await request(finiteUrl)).body.events, beforeSplit);
  const split = await request(`/api/events/${finite}?scope=future&occurrence=2030-06-12`, 'PATCH', { start: '2030-06-12T12:00', end: '2030-06-12T13:00', rrule: 'FREQ=DAILY;COUNT=5' });
  assert.equal(split.status, 200);
  const remainingId = split.body.seriesId;
  assert.notEqual(remainingId, finite);
  const splitEvents = (await request(finiteUrl)).body.events;
  assert.deepEqual(splitEvents.map((event) => event.start), ['2030-06-10T10:00', '2030-06-11T10:00', '2030-06-12T12:00', '2030-06-13T15:00'], 'dividir mantém a contagem e as exceções');
  assert.equal((await request(`/api/events/${remainingId}`)).body.rrule, 'FREQ=DAILY;COUNT=3');
  assert.ok(splitEvents.slice(2).every((event) => event.seriesId === remainingId));
  assert.equal((await request(`/api/events/${remainingId}?scope=future&occurrence=2030-06-16`, 'DELETE')).status, 400, 'data fora da série não pode estendê-la');
  assert.deepEqual((await request(finiteUrl)).body.events, splitEvents);
  await request(`/api/events/${remainingId}?scope=future&occurrence=2030-06-13`, 'DELETE');
  assert.deepEqual((await request(finiteUrl)).body.events.map((event) => event.start), ['2030-06-10T10:00', '2030-06-11T10:00', '2030-06-12T12:00'], 'remover daqui para frente remove também as exceções futuras');
  const atomic = (await request('/api/events', 'POST', { title: 'Rotina atômica fictícia', start: '2030-07-01T10:00', end: '2030-07-01T11:00', rrule: 'FREQ=DAILY;COUNT=5' })).body.seriesId;
  const atomicUrl = '/api/events?from=2030-07-01&to=2030-07-10';
  const beforeFailedSplit = (await request(atomicUrl)).body.events;
  const failedSplit = await request(`/api/events/${atomic}?scope=future&occurrence=2030-07-03`, 'PATCH', { start: '2030-07-03T12:00', end: '2030-07-03T13:00', rrule: 'FREQ=INVALID' });
  assert.equal(failedSplit.status, 400);
  assert.deepEqual((await request(atomicUrl)).body.events, beforeFailedSplit, 'falha na segunda série não pode cortar a original');
  assert.equal((await request(`/api/events/${atomic}`)).body.rrule, 'FREQ=DAILY;COUNT=5');
  const until = (await request('/api/events', 'POST', { title: 'Rotina com fim fictícia', start: '2030-08-01T10:00', end: '2030-08-01T11:00', rrule: 'FREQ=DAILY;UNTIL=2030-08-05' })).body.seriesId;
  assert.equal((await request(`/api/events/${until}?scope=future&occurrence=2030-08-03`, 'PATCH', { start: '2030-08-03T14:00', end: '2030-08-03T15:00' })).status, 200);
  assert.deepEqual((await request('/api/events?from=2030-08-01&to=2030-08-10')).body.events.map((event) => event.start), ['2030-08-01T10:00', '2030-08-02T10:00', '2030-08-03T14:00', '2030-08-04T14:00', '2030-08-05T14:00'], 'dividir preserva a data final original');
  const scoped = (await request('/api/events', 'POST', { title: 'Escopo fictício', start: '2030-09-01T10:00', end: '2030-09-01T11:00', rrule: 'FREQ=DAILY;COUNT=3' })).body.seriesId;
  const scopeUrl = `/api/events/${scoped}?scope=this&occurrence=2030-09-02`;
  const beforeScoped = (await request('/api/events?from=2030-09-01&to=2030-09-03')).body.events;
  for (const patch of [{ allDay: true }, { category: 'trabalho' }, { rrule: null }]) {
    assert.equal((await request(scopeUrl, 'PATCH', patch)).status, 400, 'campos da série não podem ser silenciosamente ignorados no escopo de uma ocorrência');
    assert.deepEqual((await request('/api/events?from=2030-09-01&to=2030-09-03')).body.events, beforeScoped);
  }
  const movedOntoExisting = await request(scopeUrl, 'PATCH', { start: '2030-09-01T15:00', end: '2030-09-01T16:00' });
  assert.equal(movedOntoExisting.status, 200);
  assert.equal(movedOntoExisting.body.occurrenceDate, '2030-09-02', 'resposta deve identificar a ocorrência editada, mesmo se outra cair na mesma data');
  assert.equal(movedOntoExisting.body.start, '2030-09-01T15:00');
  assert.equal((await request('/api/events?from=2030-09-01&to=2030-09-01')).body.events.length, 2);
  const beforeTypeChange = (await request('/api/events?from=2030-09-01&to=2030-09-03')).body.events;
  assert.equal((await request(`/api/events/${scoped}?scope=all`, 'PATCH', { allDay: true })).status, 400, 'mudança de tipo não pode tornar exceções incompatíveis');
  assert.deepEqual((await request('/api/events?from=2030-09-01&to=2030-09-03')).body.events, beforeTypeChange);
  console.log('PASS agenda: PWA, autenticação/proxy, webhook, CRUD, recorrência e quick-add, com banco temporário e zero vaults.');
} finally {
  child.kill('SIGTERM');
  await Promise.race([exited, setTimeout(3000)]);
  if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
  await fs.rm(temp, { recursive: true, force: true });
}
