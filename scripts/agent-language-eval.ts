import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { converse, type ConversationPorts } from '../src/agent/core/conversation.js';
import { SandboxAgent } from '../src/agent/core/sandbox.js';
import { LocalContextReader } from '../src/agent/core/context.js';
import { languageCases } from '../src/agent/evals/language-cases.js';
import { Ollama, pilotConfig } from '../src/agent/pilot/ollama.js';
import { languageHoldout } from '../src/agent/evals/language-cases.js';

const now = '2026-10-28T08:00';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-language-fiction-'));
const results: unknown[] = [];
const withModel = process.argv.includes('--with-model');
const cases = process.argv.includes('--holdout') ? languageHoldout : languageCases;
const client = new Ollama(pilotConfig());
const modelRuns: unknown[] = [];
try {
  await fs.mkdir(path.join(root, 'tasks'));
  for (const [name, text] of Object.entries({ 'AGENTS.md': 'Fontes fictícias em preferencias.md e tasks/todo.md.',
    'preferencias.md': 'Blocos de estudo de 35 minutos. Janela de estudo: 14:00-18:00.',
    'tasks/AGENTS.md': 'Tarefas fictícias em todo.md.', 'tasks/todo.md': '- [ ] Preparar maquete fictícia\n- [x] Tarefa concluída\n' })) await fs.writeFile(path.join(root, name), text);
  for (const test of cases) {
    const agent = new SandboxAgent();
    agent.handle({ requestId: 'seed', input: 'Salve Oficina fictícia hoje das 09h às 10h', now });
    const before = agent.snapshot().events.length;
    const ports: ConversationPorts = {
      clock: () => now, state: () => agent.snapshot(), execute: (request) => agent.handle(request),
      propose: (proposal) => agent.propose(proposal), cancel: (id, request) => agent.cancel(id, request),
      reader: new LocalContextReader(root, { memory: { notes: ['preferencias.md'] }, tasks: { notes: [], includeTasks: true } }),
      model: async () => ({ kind: 'answer', event: null, suggestionId: null, evidenceIds: ['preferencias.md'], message: 'A preferência fictícia é de 35 minutos.' }),
      ...(withModel ? { titleModel: async (input: string) => {
        await client.check();
        const response = await client.extractTitle(input);
        modelRuns.push({ id: test.id, input, output: response.content, metrics: response.metrics });
        return JSON.parse(response.content);
      } } : {}),
      ...(withModel ? { planningModel: async (draft: import('../src/agent/core/assisted-plan.js').PlanningDraft, feedback?: string) => {
        await client.check(); const response = await client.plan(draft, feedback);
        modelRuns.push({ id: test.id, messages: draft.messages, output: response.content, metrics: response.metrics });
        return JSON.parse(response.content);
      } } : {}),
      ...(withModel ? { intentModel: async (input: string, pending?: boolean) => {
        const response = await client.classifyIntent(input, pending);
        modelRuns.push({ id: test.id, operation: 'intent', input, output: response.content, metrics: response.metrics });
        return JSON.parse(response.content);
      } } : {}),
      plans: { prepare: (spec) => ({ kind: 'plan_pending', changed: false, evidenceIds: ['agenda'], message: 'Plano fictício.', plan: { ...spec, id: 'plano-ficticio', version: agent.snapshot().version, status: 'pending', removals: [] } }),
        apply: () => { throw new Error('Esta avaliação não confirma planos'); }, cancel: () => { throw new Error('Não usado'); }, undo: () => { throw new Error('Não usado'); } },
    };
    let reply; const failures: string[] = [];
    try {
      reply = await converse({ requestId: test.id, input: test.input }, ports);
      if (!test.kinds.includes(reply.kind)) failures.push(`tipo: esperado ${test.kinds.join('/')}, recebido ${reply.kind}`);
      if (test.source && !reply.evidenceIds.includes(test.source)) failures.push(`fonte esperada: ${test.source}`);
      if (test.from && (reply.agendaQuery?.from !== test.from || reply.agendaQuery?.to !== test.to)) failures.push('período de consulta incorreto');
      if (test.contains && !reply.message.toLocaleLowerCase('pt-BR').includes(test.contains.toLocaleLowerCase('pt-BR'))) failures.push('fato esperado ausente');
      if (test.event) {
        const event = reply.event?.details ?? reply.suggestion?.event;
        if (!event || event.start !== test.event.start || event.end !== test.event.end || !event.title.toLocaleLowerCase('pt-BR').includes(test.event.title.toLocaleLowerCase('pt-BR'))) failures.push('evento diferente do esperado');
      }
      if (test.planCount !== undefined && (reply.plan?.events.length !== test.planCount || reply.plan.repeat !== test.repeat)) failures.push('quantidade de blocos ou frequência incorreta');
      const added = agent.snapshot().events.length - before;
      if (added !== (reply.kind === 'created' ? 1 : 0)) failures.push('escrita indevida ou ausência de registro');
      if (!test.kinds.includes('created') && added !== 0) failures.push('ação sem autorização esperada');
    } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
    results.push({ id: test.id, category: test.category, input: test.input, passed: !failures.length, failures, reply });
  }
  const passed = results.filter((value: any) => value.passed).length;
  const directory = path.resolve('data/pilot/language'); await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `${Date.now()}-${withModel ? 'qwen' : 'code'}${process.argv.includes('--holdout') ? '-holdout' : ''}.json`);
  await fs.writeFile(file, JSON.stringify({ now, mode: `${withModel ? 'Qwen real na extração de títulos' : 'somente código'}; resposta de memória simulada; sem banco pessoal ou escrita real`, passed, total: results.length, modelRuns, results }, null, 2));
  console.log(JSON.stringify({ passed, total: results.length, report: file, failures: results.filter((value: any) => !value.passed).map((value: any) => ({ id: value.id, failures: value.failures })) }, null, 2));
  if (passed !== results.length) process.exitCode = 1;
} finally { await fs.rm(root, { recursive: true, force: true }); }
