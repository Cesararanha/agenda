import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { prepareDemoContext, restoreDemoSnapshot } from './agent-demo-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agenda-agent-sandbox-'));
const token = randomUUID();
const demoId = randomUUID();
let day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Maceio', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const restoreFrom = process.env.AGENT_DEMO_RESTORE_DIR?.trim();
const requestedPort = Number(process.env.AGENT_DEMO_PORT ?? 8790);
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new Error('AGENT_DEMO_PORT inválido');
const reservation = net.createServer();
try {
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(requestedPort, '127.0.0.1', resolve); });
} catch (error) {
  await fs.rm(temp, { recursive: true, force: true });
  throw new Error(`Não consegui reservar a porta ${requestedPort}. Escolha outra com AGENT_DEMO_PORT.`, { cause: error });
}
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
let apiChild;
let modelChild;
let stopping = false;
let restarting = false;
process.on('SIGHUP', () => { if (apiChild && !stopping) { restarting = true; apiChild.kill('SIGTERM'); } });
async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, setTimeout(2000)]);
  if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
}
async function cleanup() {
  if (stopping) return;
  stopping = true;
  await stopChild(apiChild);
  await stopChild(modelChild);
  await fs.rm(temp, { recursive: true, force: true });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void cleanup().then(() => { process.exitCode = 0; }); });
async function modelAvailable() {
  try { return (await fetch('http://127.0.0.1:11434/api/version', { signal: AbortSignal.timeout(1000), redirect: 'error' })).ok; }
  catch { return false; }
}
try {
  if (restoreFrom) day = await restoreDemoSnapshot(restoreFrom, temp);
  else await prepareDemoContext(temp);
  if (!await modelAvailable()) {
    console.log('Iniciando o modelo local para as consultas da demonstração…');
    const local = path.join(root, 'data/pilot/runtime/ollama');
    const binary = await fs.access(local).then(() => local).catch(() => 'ollama');
    modelChild = spawn(binary, ['serve'], { cwd: root, stdio: 'ignore', env: { ...process.env,
      OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_MODELS: path.join(root, 'data/pilot/models'), OLLAMA_NO_CLOUD: '1', OLLAMA_DEBUG: 'ERROR' } });
    modelChild.on('error', () => {});
    for (let i = 0; i < 40 && !await modelAvailable(); i++) await setTimeout(250);
  }
  if (!await modelAvailable()) console.log('Modelo indisponível. Agenda e tarefas funcionam; consultas ao modelo mostrarão a indisponibilidade.');
  let firstBoot = true;
  do {
  restarting = false;
  apiChild = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env, AGENDA_DB: path.join(temp, 'demo.db'), AGENDA_HOST: '127.0.0.1', AGENDA_PORT: String(port),
    AGENDA_TOKEN: token, AGENDA_ALLOW_LOCAL: '1', AGENDA_VAULTS: '', AGENDA_SERVE_WEB: '1', AGENDA_LOG_LEVEL: 'silent',
    AGENDA_AGENT_SANDBOX: '1', AGENDA_AGENT_DEMO_NOW: `${day}T08:00`, AGENDA_AGENT_DEMO_ID: demoId,
    WHATSAPP_ACCESS_TOKEN: '', WHATSAPP_APP_SECRET: '',
  } });
  let serverOutput = '';
  apiChild.stdout.on('data', (chunk) => { serverOutput += chunk; });
  apiChild.stderr.on('data', (chunk) => { serverOutput += chunk; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (apiChild.exitCode !== null) throw new Error(`A demonstração não iniciou: ${serverOutput}`);
    try {
      const response = await fetch(`${base}/api/meta`, { headers: { 'x-agenda-token': token }, signal: AbortSignal.timeout(1000) });
      const meta = await response.json();
      if (response.ok && meta.agentSandbox === true && meta.agentDemoId === demoId) { ready = true; break; }
    } catch {}
    await setTimeout(100);
  }
  if (!ready) throw new Error('A instância fictícia não ficou disponível.');
  if (firstBoot && !restoreFrom) for (const event of [
    { title: 'Oficina de desenho', start: `${day}T09:00`, end: `${day}T10:00` },
    { title: 'Clube de leitura', start: `${day}T14:30`, end: `${day}T15:30` },
  ]) {
    const response = await fetch(`${base}/api/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-agenda-token': token }, body: JSON.stringify(event) });
    if (!response.ok) throw new Error('Não consegui preparar os compromissos fictícios.');
  }
  firstBoot = false;
  console.log(`\nDemonstração pronta: ${base}\nDados inteiramente fictícios. A agenda pessoal não foi aberta.\nUse Ctrl+C para encerrar e remover somente esses dados temporários.`);
  await new Promise((resolve) => apiChild.once('exit', resolve));
  } while (restarting && !stopping);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { await cleanup(); }
