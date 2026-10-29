// Exercita a API existente em processo separado, banco temporário e vaults desativados.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
    AGENDA_DB: path.join(temp, 'test.db'), AGENDA_HOST: '127.0.0.1', AGENDA_PORT: String(port),
    AGENDA_VAULTS: '', AGENDA_TOKEN: token, AGENDA_ALLOW_LOCAL: '1', AGENDA_SERVE_WEB: '1',
    AGENDA_AGENT_SANDBOX: '0',
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
  const quick = await request('/api/quick-add', 'POST', { text: '2030-05-17 14h-15h Oficina fictícia' });
  assert.equal(quick.status, 201);
  assert.equal(quick.body.evento.start, '2030-05-17T14:00');
  console.log('PASS agenda: PWA, autenticação/proxy, webhook, CRUD, recorrência e quick-add, com banco temporário e zero vaults.');
} finally {
  child.kill('SIGTERM');
  await Promise.race([exited, setTimeout(3000)]);
  if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
  await fs.rm(temp, { recursive: true, force: true });
}
