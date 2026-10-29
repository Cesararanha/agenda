import { execFileSync } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { copyDemoContext, validateDemoDirectory } from './agent-demo-fixtures.mjs';

const port = Number(process.env.AGENT_DEMO_PORT ?? 8790);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Porta inválida');
const meta = await fetch(`http://127.0.0.1:${port}/api/meta`, { signal: AbortSignal.timeout(3000) }).then((response) => response.json());
if (meta.agentSandbox !== true) throw new Error('A instância não é uma demonstração. Nenhum banco foi aberto.');
const pid = execFileSync('lsof', ['-nP', `-tiTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim();
if (!/^\d+$/.test(pid)) throw new Error('Processo da demonstração não identificado');
const files = execFileSync('lsof', ['-a', '-p', pid, '-Fn'], { encoding: 'utf8' }).split('\n');
const file = files.find((line) => line.startsWith('n') && line.endsWith('/demo.db'))?.slice(1);
if (!file) throw new Error('Banco de demonstração não identificado');
const source = await validateDemoDirectory(path.dirname(file));
if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('Banco inválido');
const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'agenda-agent-sandbox-'));
const database = new DatabaseSync(file, { readOnly: true });
try {
  await backup(database, path.join(destination, 'demo.db'));
  await copyDemoContext(source, destination);
  await fs.writeFile(path.join(destination, 'demo-snapshot.json'), JSON.stringify({ type: 'agente-demo-snapshot-v1', day: meta.today }));
  console.log(destination);
} finally { database.close(); }
