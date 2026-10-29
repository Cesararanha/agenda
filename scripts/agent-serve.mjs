import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, 'data/pilot/runtime/ollama');
const binary = fs.existsSync(local) ? local : 'ollama';
// Processo local em primeiro plano, sem launchd nem carregamento do .env da agenda.
const child = spawn(binary, ['serve'], { stdio: 'inherit', env: { ...process.env,
  OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_MODELS: path.join(root, 'data/pilot/models'), OLLAMA_NO_CLOUD: '1' } });
child.on('error', (error) => { console.error(`Ollama indisponível: ${error.message}. Consulte docs/agente-piloto.md.`); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
