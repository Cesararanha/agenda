import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, queryAll, queryOne } from '../db.js';
import { config } from '../config.js';
import { BadRequest } from '../events.js';
import { listOccurrences } from '../events.js';
import { SandboxStore } from '../agent/sandbox-store.js';
import { WeeklyStore } from '../agent/weekly-store.js';
import { converse, type ConversationPorts } from '../../agent/core/conversation.js';
import { LocalContextReader } from '../../agent/core/context.js';
import { wallMoment } from '../../agent/core/request.js';
import { ResponseTrace } from '../../agent/core/diagnostics.js';
import { Ollama, pilotConfig } from '../../agent/pilot/ollama.js';
import { now } from '../../shared/dates.js';
import type { DemoTurn, DemoReply, DemoPanel } from '../../shared/agent.js';

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/);
const messageSchema = z.object({ conversationId: identifier, requestId: identifier, input: z.string().trim().min(1).max(8000) }).strict();
interface TurnRow { request_id: string; input: string; reply: string }

export async function agentSandboxRoutes(app: FastifyInstance): Promise<void> {
  const store = new SandboxStore();
  const plans = new WeeklyStore();
  db.exec(`CREATE TABLE IF NOT EXISTS agent_sandbox_chat (
    conversation_id TEXT NOT NULL, request_id TEXT NOT NULL, input TEXT NOT NULL, reply TEXT NOT NULL,
    PRIMARY KEY (conversation_id, request_id)
  )`);
  const contextRoot = path.join(config.dbDir, 'context');
  if (fs.lstatSync(contextRoot, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('A demonstração exige contexto dentro do diretório temporário.');
  const reader = new LocalContextReader(contextRoot, { memory: { notes: ['preferencias.md'] }, tasks: { notes: [], includeTasks: true } });
  if (config.agentDemoNow) wallMoment.parse(config.agentDemoNow);
  const clock = () => config.agentDemoNow || now(config.tz);
  const client = new Ollama(pilotConfig());
  const createPorts = (trace: ResponseTrace): ConversationPorts => ({
    state: (from, to) => { trace.record('state'); return store.state(from, to); },
    execute: (request) => { trace.record('execute'); if (store.hasReceipt(request.requestId)) trace.record('receipt'); return store.execute(request); },
    propose: (proposal, receipt) => { trace.record('propose'); if (store.hasReceipt(receipt.requestId)) trace.record('receipt'); return store.propose(proposal, receipt); },
    reader: { read: async (topic) => { trace.record(topic === 'tasks' ? 'read_tasks' : 'read_context'); const context = await reader.read(topic); trace.read(context); return context; } }, clock,
    agenda: (from, to) => { trace.record('agenda'); return listOccurrences(from, to).map((event) => ({ id: event.id, title: event.title, start: event.start, end: event.end, allDay: event.allDay })); },
    cancel: (suggestionId, request) => { trace.record('cancel'); return store.cancel(suggestionId, request); },
    plans: { prepare: (spec, request) => { trace.record('plan_prepare'); return plans.prepare(spec, request); },
      apply: (id, request) => { trace.record('plan_apply'); return plans.apply(id, request); },
      cancel: (id, request) => { trace.record('plan_cancel'); return plans.cancel(id, request); },
      undo: (id, request) => { trace.record('plan_undo'); return plans.undo(id, request); } },
    titleModel: async (input) => {
      trace.record('interpret_event'); trace.beginModel(client.config.model);
      try {
        await client.check(); trace.requestModel();
        const response = await client.extractTitle(input); trace.completeModel(response.metrics);
        return JSON.parse(response.content);
      } catch (error) { trace.failModel(); throw error; }
    },
    planningModel: async (draft, feedback) => {
      trace.record('interpret_plan'); trace.beginModel(client.config.model);
      try {
        await client.check(); trace.requestModel();
        const response = await client.plan(draft, feedback); trace.completeModel(response.metrics);
        return JSON.parse(response.content);
      } catch (error) { trace.failModel(); throw error; }
    },
    intentModel: async (input, pending) => {
      trace.record('route_intent'); trace.beginModel(client.config.model);
      try {
        await client.check(); trace.requestModel();
        const response = await client.classifyIntent(input, pending); trace.completeModel(response.metrics);
        return JSON.parse(response.content);
      } catch (error) { trace.failModel(); throw error; }
    },
    model: async (input, sources) => {
      trace.beginModel(client.config.model);
      try {
        await client.check(); trace.requestModel();
        const response = await client.answerContext(input, sources);
        trace.completeModel(response.metrics);
        return JSON.parse(response.content);
      } catch (error) { trace.failModel(); throw error; }
    },
  });
  const pending = new Map<string, { input: string; promise: Promise<DemoReply> }>();
  app.get('/api/agent/sandbox/state', async (request) => {
    const range = z.object({ from: z.string().optional(), to: z.string().optional() }).strict().safeParse(request.query);
    if (!range.success || (range.data.to && !range.data.from)) throw new BadRequest('Intervalo de consulta inválido.');
    return store.state(range.data.from, range.data.to);
  });
  app.post('/api/agent/sandbox/propose', async (request) => store.propose(request.body as Parameters<SandboxStore['propose']>[0]));
  app.post('/api/agent/sandbox/request', async (request) => store.execute(request.body));
  app.get('/api/agent/sandbox/panel', async (): Promise<DemoPanel> => {
    const state = store.summary();
    let tasks: DemoPanel['tasks'] = [];
    let contextAvailable = true;
    try { tasks = (await reader.read('tasks')).openTasks; } catch { contextAvailable = false; }
    const day = clock().slice(0, 10);
    return { day, version: state.version, events: listOccurrences(day, day).map((item) => ({ id: item.id, allDay: item.allDay,
      details: { title: item.title, start: item.start, end: item.end } })), suggestions: state.suggestions, plans: plans.list(), tasks, contextAvailable };
  });
  app.get('/api/agent/sandbox/history', async (request): Promise<{ turns: DemoTurn[] }> => {
    const query = z.object({ conversationId: identifier }).strict().safeParse(request.query);
    if (!query.success) throw new BadRequest('Identificação de conversa inválida.');
    const rows = queryAll<TurnRow>('SELECT request_id, input, reply FROM agent_sandbox_chat WHERE conversation_id = ? ORDER BY rowid DESC LIMIT 100', query.data.conversationId).reverse();
    return { turns: rows.map((row) => ({ requestId: row.request_id, input: row.input, reply: JSON.parse(row.reply) as DemoReply })) };
  });
  app.post('/api/agent/sandbox/chat', async (request, reply) => {
    const parsed = messageSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequest('Mensagem inválida.');
    const message = parsed.data;
    const existing = queryOne<TurnRow>('SELECT request_id, input, reply FROM agent_sandbox_chat WHERE conversation_id = ? AND request_id = ?', message.conversationId, message.requestId);
    if (existing) return existing.input === message.input ? JSON.parse(existing.reply) : reply.code(409).send({ error: 'Esse identificador já pertence a outra mensagem.' });
    const key = `${message.conversationId}:${message.requestId}`;
    const active = pending.get(key);
    if (active) return active.input === message.input ? active.promise : reply.code(409).send({ error: 'Outra mensagem já está usando esse identificador.' });
    const promise = (async () => {
      const last = queryOne<{ reply: string }>('SELECT reply FROM agent_sandbox_chat WHERE conversation_id = ? ORDER BY rowid DESC LIMIT 1', message.conversationId);
      const trace = new ResponseTrace();
      let result: DemoReply;
      try { result = await converse({ requestId: key, input: message.input }, createPorts(trace), last ? JSON.parse(last.reply) as DemoReply : undefined); }
      catch (error) {
        if (!(error instanceof BadRequest)) throw error;
        result = { kind: 'unsupported', changed: false, evidenceIds: [], message: error.message };
      }
      result = trace.finish(result);
      db.prepare('INSERT INTO agent_sandbox_chat (conversation_id, request_id, input, reply) VALUES (?, ?, ?, ?)')
        .run(message.conversationId, message.requestId, message.input, JSON.stringify(result));
      return result;
    })();
    pending.set(key, { input: message.input, promise });
    try { return await promise; } finally { pending.delete(key); }
  });
}
