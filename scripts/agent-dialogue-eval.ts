import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { converse, type ConversationPorts } from '../src/agent/core/conversation.js';
import { SandboxAgent } from '../src/agent/core/sandbox.js';
import { LocalContextReader } from '../src/agent/core/context.js';
import { Ollama, pilotConfig } from '../src/agent/pilot/ollama.js';
import type { DemoReply } from '../src/shared/agent.js';

interface Turn { input: string; kinds: DemoReply['kind'][]; source?: string; contains?: string; date?: string; added?: number; title?: string; eventStart?: string; eventEnd?: string; events?: string[]; draftStart?: string }
const cases: Array<{ id: string; turns: Turn[] }> = [
  { id: 'calendar-paraphrase', turns: [{ input: 'Dá uma olhada nos meus horários de amanhã', kinds: ['answer'], source: 'agenda', date: '2026-10-29', added: 0 }] },
  { id: 'calendar-weekday', turns: [{ input: 'Quero saber os horários de sexta', kinds: ['answer'], source: 'agenda', date: '2026-10-30', added: 0 }] },
  { id: 'tasks-paraphrase', turns: [{ input: 'O que ficou pendente para eu fazer?', kinds: ['answer'], source: 'tasks/todo.md', contains: 'maquete', added: 0 }] },
  { id: 'tasks-short', turns: [{ input: 'Me passa a lista do que falta fazer', kinds: ['answer'], source: 'tasks/todo.md', contains: 'maquete', added: 0 }] },
  { id: 'schedule-slang', turns: [{ input: 'Bota corrida na sexta de 6h a 7h', kinds: ['plan_pending', 'suggestion_pending'], title: 'Corrida', eventStart: '2026-10-30T06:00', eventEnd: '2026-10-30T07:00', added: 0 }] },
  { id: 'schedule-reordered', turns: [{ input: 'Amanhã entre 10h e 11h deixa reservado para leitura', kinds: ['plan_pending', 'suggestion_pending'], title: 'Leitura', eventStart: '2026-10-29T10:00', eventEnd: '2026-10-29T11:00', added: 0 }] },
  { id: 'study-paraphrase', turns: [{ input: 'Tem alguma sugestão de estudo para amanhã?', kinds: ['suggestion_pending'], source: 'preferencias.md', added: 0 }] },
  { id: 'outside-capabilities', turns: [{ input: 'Pague meu boleto amanhã', kinds: ['unsupported', 'ask'], added: 0 }] },
  { id: 'confirm-after-read', turns: [
    { input: 'Quero marcar Leitura amanhã das 18h às 19h', kinds: ['suggestion_pending'], added: 0 },
    { input: 'Quais tarefas estão abertas?', kinds: ['answer'], source: 'tasks/todo.md', added: 0 },
    { input: 'pode confirmar', kinds: ['applied'], added: 1 },
  ] },
  { id: 'complete-after-read', turns: [
    { input: 'Salve Leitura amanhã às 08h', kinds: ['ask'], draftStart: '08:00', added: 0 },
    { input: 'Quais tarefas estão abertas?', kinds: ['answer'], source: 'tasks/todo.md', added: 0 },
    { input: 'até 09h', kinds: ['created'], added: 1 },
  ] },
  { id: 'cancel-after-read', turns: [
    { input: 'Sugira um bloco de estudo para hoje', kinds: ['suggestion_pending'], added: 0 },
    { input: 'Quais tarefas estão abertas?', kinds: ['answer'], source: 'tasks/todo.md', added: 0 },
    { input: 'não', kinds: ['suggestion_canceled', 'answer'], added: 0 },
    { input: 'pode confirmar', kinds: ['ask'], added: 0 },
  ] },
  { id: 'calendar-context', turns: [
    { input: 'Quais compromissos tenho quinta à noite?', kinds: ['answer'], source: 'agenda', date: '2026-10-29' },
    { input: 'Quais tarefas estão abertas?', kinds: ['answer'], source: 'tasks/todo.md' },
    { input: 'E sexta?', kinds: ['answer'], source: 'agenda', date: '2026-10-30', contains: '18h às 24h', added: 0 },
  ] },
];
const client = new Ollama(pilotConfig()), now = '2026-10-28T08:00';
const holdout: typeof cases = [
  { id: 'extra-calendar', turns: [{ input: 'Consegue puxar meus horários de sábado?', kinds: ['answer'], source: 'agenda', date: '2026-10-31', added: 0 }] },
  { id: 'extra-tasks', turns: [{ input: 'Quero ver o que falta fazer antes de descansar', kinds: ['answer'], source: 'tasks/todo.md', contains: 'maquete', added: 0 }] },
  { id: 'extra-schedule', turns: [{ input: 'Deixa yoga guardado para sexta das 7h às 8h', kinds: ['plan_pending', 'suggestion_pending'], title: 'Yoga', eventStart: '2026-10-30T07:00', eventEnd: '2026-10-30T08:00', added: 0 }] },
  { id: 'extra-week-query', turns: [{ input: 'Quero saber meus horários nesta semana', kinds: ['answer'], source: 'agenda', date: '2026-10-26', added: 0 }] },
  { id: 'extra-plan-detour', turns: [
    { input: 'Na próxima semana coloque cerâmica terça das 10h às 11h e desenho sexta.', kinds: ['ask'], added: 0 },
    { input: 'Dá uma olhada nos horários de amanhã', kinds: ['answer'], source: 'agenda', date: '2026-10-29', added: 0 },
    { input: 'O desenho será das 15h às 16h.', kinds: ['plan_pending'], events: ['Cerâmica|2026-11-03T10:00|2026-11-03T11:00', 'Desenho|2026-11-06T15:00|2026-11-06T16:00'], added: 0 },
  ] },
];
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-dialogues-fiction-'));
const unseen: typeof cases = [
  { id: 'unseen-calendar', turns: [{ input: 'Confere os espaços que já ocupei amanhã?', kinds: ['answer'], source: 'agenda', date: '2026-10-29', added: 0 }] },
  { id: 'unseen-tasks', turns: [{ input: 'Que coisas ainda tenho para terminar?', kinds: ['answer'], source: 'tasks/todo.md', contains: 'maquete', added: 0 }] },
  { id: 'unseen-schedule', turns: [{ input: 'Queria encaixar meditação na quinta das 06h às 07h', kinds: ['plan_pending', 'suggestion_pending'], title: 'Meditação', eventStart: '2026-10-29T06:00', eventEnd: '2026-10-29T07:00', added: 0 }] },
];
const results: unknown[] = [];
try {
  await client.check();
  await fs.mkdir(path.join(root, 'tasks'));
  for (const [name, content] of Object.entries({ 'AGENTS.md': 'Fontes fictícias em preferencias.md e tasks/todo.md.',
    'preferencias.md': 'Blocos de estudo de 35 minutos. Janela de estudo: 14:00-18:00.', 'tasks/AGENTS.md': 'Fonte de tarefas fictícias: todo.md.', 'tasks/todo.md': '- [ ] Preparar uma maquete fictícia\n- [x] Tarefa finalizada\n' })) await fs.writeFile(path.join(root, name), content);
  for (const entry of process.argv.includes('--unseen') ? unseen : process.argv.includes('--holdout') ? holdout : cases) {
    const agent = new SandboxAgent(), generations: unknown[] = [];
    let previous: DemoReply | undefined;
    const ports: ConversationPorts = {
      clock: () => now, state: () => agent.snapshot(), execute: (request) => agent.handle(request), propose: (proposal) => agent.propose(proposal), cancel: (id, request) => agent.cancel(id, request),
      reader: new LocalContextReader(root, { memory: { notes: ['preferencias.md'] }, tasks: { notes: [], includeTasks: true } }),
      model: async (input, sources) => { const response = await client.answerContext(input, sources); generations.push({ operation: 'memory', content: response.content, metrics: response.metrics }); return JSON.parse(response.content); },
      intentModel: async (input, pending) => { const response = await client.classifyIntent(input, pending); generations.push({ operation: 'intent', content: response.content, metrics: response.metrics }); return JSON.parse(response.content); },
      titleModel: async (input) => { const response = await client.extractTitle(input); generations.push({ operation: 'title', content: response.content, metrics: response.metrics }); return JSON.parse(response.content); },
      planningModel: async (draft, feedback) => { const response = await client.plan(draft, feedback); generations.push({ operation: 'planning', content: response.content, metrics: response.metrics }); return JSON.parse(response.content); },
      plans: { prepare: (spec) => ({ kind: 'plan_pending', message: 'Prévia fictícia.', changed: false, evidenceIds: ['agenda'], plan: { ...spec, id: 'plano-eval', version: 0, status: 'pending', removals: [] } }),
        apply: () => { throw new Error('Este avaliador não aplica planos'); }, cancel: () => { throw new Error('Este avaliador não cancela planos'); }, undo: () => { throw new Error('Este avaliador não desfaz planos'); } },
    };
    const turns: unknown[] = []; const failures: string[] = [];
    for (const [index, turn] of entry.turns.entries()) {
      const problems: string[] = [];
      try {
        previous = await converse({ requestId: `${entry.id}-${index}`, input: turn.input }, ports, previous);
        if (!turn.kinds.includes(previous.kind)) problems.push(`tipo esperado ${turn.kinds.join('/')}, recebido ${previous.kind}`);
        if (turn.source && !previous.evidenceIds.includes(turn.source)) problems.push('fonte incorreta');
        if (turn.contains && !previous.message.includes(turn.contains)) problems.push('informação esperada ausente');
        if (turn.date && previous.agendaQuery?.from !== turn.date) problems.push('dia consultado incorreto');
        if (turn.added !== undefined && agent.snapshot().events.length !== turn.added) problems.push('quantidade de eventos divergente');
        if (turn.title && ![previous.suggestion?.event.title, previous.plan?.events[0]?.title].includes(turn.title)) problems.push('título diferente do pedido');
        const event = previous.suggestion?.event ?? previous.plan?.events[0];
        if (turn.eventStart && (event?.start !== turn.eventStart || event.end !== turn.eventEnd)) problems.push('dia ou intervalo incorreto');
        if (turn.draftStart && previous.eventDraft?.startTime !== turn.draftStart) problems.push('início do pedido incompleto não foi mantido');
        if (turn.events && JSON.stringify(previous.plan?.events.map((event) => `${event.title}|${event.start}|${event.end}`)) !== JSON.stringify(turn.events)) problems.push('blocos do plano não correspondem ao pedido');
      } catch (error) { problems.push(String(error)); }
      failures.push(...problems.map((problem) => `turno ${index + 1}: ${problem}`));
      turns.push({ input: turn.input, passed: !problems.length, failures: problems, reply: previous });
    }
    results.push({ id: entry.id, passed: !failures.length, failures, turns, generations });
  }
  const directory = path.resolve('data/pilot/dialogues'); await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `${Date.now()}-qwen${process.argv.includes('--unseen') ? '-unseen' : process.argv.includes('--holdout') ? '-holdout' : ''}.json`);
  const typed = results as Array<{ id: string; passed: boolean; failures: string[]; turns: Array<{ passed: boolean }> }>;
  const passed = typed.filter((entry) => entry.passed).length;
  const firstTurnPassed = typed.filter((entry) => entry.turns[0]?.passed).length;
  const turnsPassed = typed.flatMap((entry) => entry.turns).filter((turn) => turn.passed).length;
  const turnsTotal = typed.reduce((count, entry) => count + entry.turns.length, 0);
  await fs.writeFile(file, JSON.stringify({ mode: 'Qwen real; dados e armazenamento em memória fictícios; ferramentas de planos simuladas', passed, total: typed.length, firstTurnPassed, turnsPassed, turnsTotal, results }, null, 2));
  console.log(JSON.stringify({ passed, total: typed.length, firstTurnPassed, turnsPassed, turnsTotal, report: file, failures: typed.filter((entry) => !entry.passed).map(({ id, failures }) => ({ id, failures })) }, null, 2));
  if (passed !== typed.length) process.exitCode = 1;
} finally { await fs.rm(root, { recursive: true, force: true }); }
