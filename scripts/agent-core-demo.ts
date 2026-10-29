import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SandboxAgent } from '../src/agent/core/sandbox.js';
import { LocalContextReader } from '../src/agent/core/context.js';

const now = '2030-05-14T08:00';
const agent = new SandboxAgent();
function handle(requestId: string, input: string) {
  const result = agent.handle({ requestId, input, now });
  console.log(`${input}\n  ${result.kind}: ${result.message}`);
  return result;
}
assert.equal(handle('incomplete', 'Salve Leitura hoje às 15h').kind, 'ask');
const created = handle('create', 'Salve Leitura hoje das 15h às 16h');
assert.equal(created.kind, 'created');
assert.equal(handle('conflict', 'Salve Oficina hoje das 15h30 às 16h30').kind, 'conflict');
const suggestion = agent.propose({ expectedVersion: agent.snapshot().version, targetEventId: created.event!.id,
  event: { title: 'Leitura', start: '2030-05-14T17:00', end: '2030-05-14T18:00' } });
assert.equal(suggestion.kind, 'suggestion_pending');
assert.equal(agent.snapshot().events[0]?.details.start, '2030-05-14T15:00');
console.log(`\n${suggestion.message}\nAgenda ainda no horário original. Retomando em outra instância...`);
const resumed = SandboxAgent.restore(agent.exportCheckpoint());
const confirmation = `Confirmo a sugestão ${suggestion.suggestionId}`;
assert.equal(resumed.handle({ requestId: 'confirm', input: confirmation, now }).kind, 'applied');
assert.equal(resumed.handle({ requestId: 'repeat', input: confirmation, now }).kind, 'already_applied');
assert.equal(resumed.snapshot().events.length, 1);
console.log('Confirmação aplicada uma vez após retomada. Evento final:', resumed.snapshot().events[0]);
console.log('\nPASS: ciclo fictício de pedido, validação, conflito, sugestão, confirmação e retomada.');

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-demo-fiction-'));
try {
  await fs.mkdir(path.join(temp, 'tasks'));
  await fs.mkdir(path.join(temp, 'preferencias'));
  for (const [relative, text] of Object.entries({
    'AGENTS.md': 'Exemplo fictício: preferencias/ e tasks/todo.md.',
    'tasks/AGENTS.md': 'Tarefas fictícias somente em todo.md.',
    'tasks/todo.md': '- [ ] Preparar maquete de papel\n- [x] Comprar cartolina\n',
    'preferencias/AGENTS.md': 'estudo.md contém a preferência fictícia.',
    'preferencias/estudo.md': 'Preferência fictícia: blocos de estudo de 35 minutos.',
  })) await fs.writeFile(path.join(temp, relative), text);
  const reader = new LocalContextReader(temp, { study: { notes: ['preferencias/estudo.md'], includeTasks: true } });
  const context = await reader.read('study');
  assert.equal(context.openTasks.length, 1);
  console.log('\nContexto recuperado de arquivos fictícios:', context.sources);
  console.log('Leituras e volume, incluindo índices:', context.usage);
  console.log('PASS: memória e tarefas recuperadas sem alterar as fontes.');
} finally { await fs.rm(temp, { recursive: true, force: true }); }
