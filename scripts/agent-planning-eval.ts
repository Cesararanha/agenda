import fs from 'node:fs/promises';
import path from 'node:path';
import { converse, type ConversationPorts } from '../src/agent/core/conversation.js';
import { SandboxAgent } from '../src/agent/core/sandbox.js';
import { Ollama, pilotConfig } from '../src/agent/pilot/ollama.js';
import type { DemoReply } from '../src/shared/agent.js';

const cases = [
  { id: 'two-titles', messages: ['Na próxima semana, preciso ir ao dentista segunda das 9h às 10h e estudar quarta das 18h às 19h.'], events: ['Dentista|2026-11-02T09:00|2026-11-02T10:00', 'Estudar|2026-11-04T18:00|2026-11-04T19:00'] },
  { id: 'polite', messages: ['Você consegue colocar duas coisas nesta semana? Na quinta, corrida de 6h às 7h; no sábado, leitura entre 15h e 16h.'], events: ['Corrida|2026-10-29T06:00|2026-10-29T07:00', 'Leitura|2026-10-31T15:00|2026-10-31T16:00'] },
  { id: 'complete-time', messages: ['Na próxima semana, coloque dentista segunda das 9h às 10h e leitura quarta.', 'A leitura será das 18h às 19h.'], events: ['Dentista|2026-11-02T09:00|2026-11-02T10:00', 'Leitura|2026-11-04T18:00|2026-11-04T19:00'] },
  { id: 'three-titles', messages: ['Quero organizar esta semana: yoga quinta entre 7h e 8h, cinema sexta das 19h às 21h e desenho domingo das 10h às 11h.'], events: ['Yoga|2026-10-29T07:00|2026-10-29T08:00', 'Cinema|2026-10-30T19:00|2026-10-30T21:00', 'Desenho|2026-11-01T10:00|2026-11-01T11:00'] },
  { id: 'missing-time', messages: ['Coloque nesta semana dentista quinta das 9h às 10h e leitura sábado.'], ask: true, missing: 'Leitura' },
  { id: 'conditional', messages: ['Se der, coloque leitura quinta das 9h às 10h e corrida sábado das 7h às 8h.'], ask: true },
  { id: 'negative', messages: ['Não coloque leitura quinta das 9h às 10h e corrida sábado das 7h às 8h.'], ask: true },
  { id: 'extra-action', messages: ['Coloque leitura quinta das 9h às 10h e corrida sábado das 7h às 8h e apague o resto da agenda.'], ask: true },
  { id: 'invalid-day', messages: ['Quero colocar dentista em 31/02/2026 das 9h às 10h e leitura em 28/02/2026 das 18h às 19h.'], ask: true },
  { id: 'invalid-range', messages: ['Nesta semana coloque leitura quinta das 19h às 18h e corrida sábado das 7h às 8h.'], ask: true },
  { id: 'different-weeks', messages: ['Quero colocar dentista em 30/10/2026 das 9h às 10h e leitura em 06/11/2026 das 18h às 19h.'], ask: true },
  { id: 'ceramics', messages: ['Pode anotar para a próxima semana: fisioterapia na terça entre 8h e 9h e oficina de cerâmica no sábado das 14h às 16h?'], events: ['Fisioterapia|2026-11-03T08:00|2026-11-03T09:00', 'Oficina de cerâmica|2026-11-07T14:00|2026-11-07T16:00'] },
  { id: 'weekly-assisted', messages: ['Semanalmente quero reservar clínica na seg 8 as 9 e fisioterapia na qui 14 as 15.'], events: ['Clínica|2026-10-26T08:00|2026-10-26T09:00', 'Fisioterapia|2026-10-29T14:00|2026-10-29T15:00'], repeat: true },
  { id: 'weekly-completion', messages: ['Quero reservar horários para todas as semanas: terapia ter 9 as 10 e corrida qui.', 'A corrida vai ser 14 as 15.'], events: ['Terapia|2026-10-27T09:00|2026-10-27T10:00', 'Corrida|2026-10-29T14:00|2026-10-29T15:00'], repeat: true },
  { id: 'weekly-mixed-frequency', messages: ['Quero reservar semanalmente clínica na seg 8 as 9 e mensalmente fisioterapia na qui 14 as 15.'], ask: true },
];
const extraCases = [
  { id: 'extra-two', messages: ['Por favor, coloque na próxima semana: consulta odontológica na terça de 08:30 a 09:15 e laboratório de desenho na sexta das 14h às 15h.'], events: ['Consulta odontológica|2026-11-03T08:30|2026-11-03T09:15', 'Laboratório de desenho|2026-11-06T14:00|2026-11-06T15:00'] },
  { id: 'extra-shared', messages: ['Na próxima semana quero reservar corrida segunda e quinta das 6h às 7h e leitura domingo entre 16h e 17h.'], events: ['Corrida|2026-11-02T06:00|2026-11-02T07:00', 'Corrida|2026-11-05T06:00|2026-11-05T07:00', 'Leitura|2026-11-08T16:00|2026-11-08T17:00'] },
  { id: 'extra-completion', messages: ['Na próxima semana, coloque oficina de robótica terça das 10h às 11h e fotografia sábado.', 'A fotografia será de 15h a 16h.'], events: ['Oficina de robótica|2026-11-03T10:00|2026-11-03T11:00', 'Fotografia|2026-11-07T15:00|2026-11-07T16:00'] },
];
const client = new Ollama(pilotConfig());
const report: unknown[] = [];
for (const entry of (process.argv.includes('--holdout') ? extraCases : cases) as typeof cases) {
  const agent = new SandboxAgent(); const runs: unknown[] = []; let previous: DemoReply | undefined; const failures: string[] = [];
  const ports: ConversationPorts = { clock: () => '2026-10-28T08:00', state: () => agent.snapshot(), execute: (r) => agent.handle(r), propose: (p) => agent.propose(p),
    reader: { read: async () => { throw new Error('Esta avaliação não usa memória pessoal'); } }, model: async () => { throw new Error('Roteamento incorreto para memória'); },
    planningModel: async (draft, feedback) => { await client.check(); const response = await client.plan(draft, feedback); runs.push({ messages: draft.messages, feedback, content: response.content, metrics: response.metrics }); return JSON.parse(response.content); },
    intentModel: async (input, pending) => { const response = await client.classifyIntent(input, pending); runs.push({ input, operation: 'intent', content: response.content, metrics: response.metrics }); return JSON.parse(response.content); },
    plans: { prepare: (spec) => ({ kind: 'plan_pending', changed: false, evidenceIds: ['agenda'], message: 'Prévia fictícia sem SQLite.', plan: { ...spec, id: 'plano-eval', version: 0, status: 'pending', removals: [] } }),
      apply: () => { throw new Error('Esta avaliação não aplica planos'); }, cancel: () => { throw new Error('Não usado'); }, undo: () => { throw new Error('Não usado'); } },
  };
  try {
    for (const [i, input] of entry.messages.entries()) {
      previous = await converse({ requestId: `${entry.id}-${i}`, input }, ports, previous);
      if (i < entry.messages.length - 1 && (!previous.planningDraft?.missing?.length || previous.kind !== 'ask')) failures.push('Não preservou os campos faltantes do pedido incompleto');
    }
    if (entry.ask && previous?.kind !== 'ask') failures.push('Deveria pedir esclarecimento');
    if (entry.missing && !previous?.message.includes(entry.missing)) failures.push('Não perguntou pelo campo faltante do compromisso correto');
    if (entry.events) {
      const actual = previous?.plan?.events.map((event) => `${event.title}|${event.start}|${event.end}`);
      if (previous?.kind !== 'plan_pending' || JSON.stringify(actual) !== JSON.stringify(entry.events)) failures.push('Plano diferente do esperado');
      if (Boolean(previous?.plan?.repeat) !== Boolean(entry.repeat)) failures.push('Frequência diferente da informada pelo humano');
    }
    if (agent.snapshot().events.length || previous?.changed) failures.push('Houve escrita antes da confirmação');
  } catch (error) { failures.push(String(error)); }
  report.push({ id: entry.id, messages: entry.messages, passed: !failures.length, failures, runs, reply: previous });
}
const results = report as Array<{ passed: boolean; id: string; failures: string[] }>;
const directory = path.resolve('data/pilot/planning'); await fs.mkdir(directory, { recursive: true });
const file = path.join(directory, `${Date.now()}-qwen${process.argv.includes('--holdout') ? '-holdout' : ''}.json`);
const passed = results.filter((entry) => entry.passed).length;
await fs.writeFile(file, JSON.stringify({ mode: 'Qwen real na interpretação; ferramenta de prévia simulada; sem dados pessoais ou escrita real', passed, total: results.length, results }, null, 2));
console.log(JSON.stringify({ passed, total: results.length, report: file, failures: results.filter((entry) => !entry.passed).map(({ id, failures }) => ({ id, failures })) }, null, 2));
if (passed !== results.length) process.exitCode = 1;
