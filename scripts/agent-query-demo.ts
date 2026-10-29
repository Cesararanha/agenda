import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { LocalContextReader } from '../src/agent/core/context.js';
import { answerFromContext } from '../src/agent/core/answers.js';
import { Ollama, pilotConfig } from '../src/agent/pilot/ollama.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-query-fiction-'));
try {
  await fs.mkdir(path.join(temp, 'tasks'));
  for (const [relative, text] of Object.entries({
    'AGENTS.md': 'Exemplo fictício. preferencias.md e tasks/todo.md.',
    'preferencias.md': 'Preferência vigente da pessoa fictícia: blocos de estudo de 35 minutos.',
    'tasks/AGENTS.md': 'Fonte de tarefas fictícias: todo.md.',
    'tasks/todo.md': '- [ ] Preparar maquete de papel\n- [x] Comprar cartolina\n',
  })) await fs.writeFile(path.join(temp, relative), text);
  const client = new Ollama(pilotConfig());
  const environment = await client.check();
  const reader = new LocalContextReader(temp, { study: { notes: ['preferencias.md'], includeTasks: true } });
  const measurements: unknown[] = [];
  const result = await answerFromContext({ input: 'Qual a duração preferida dos blocos de estudo da pessoa fictícia?', topic: 'study' }, reader, async (input, sources) => {
    const response = await client.chat(input, { now: '2030-05-14T08:00', agendaVersion: 0, events: [], suggestions: [], notes: sources });
    measurements.push(response);
    return JSON.parse(response.content);
  });
  const report = { syntheticOnly: true, createdAt: new Date().toISOString(), environment, result, measurements,
    readyForRealActions: false, limitations: ['Atribuição de fontes não prova exatidão semântica.', 'Consulta fictícia sem ferramentas de escrita.'] };
  const destination = path.join(root, 'data/pilot/query-demo');
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (result.kind !== 'answer') process.exitCode = 1;
} finally { await fs.rm(temp, { recursive: true, force: true }); }
