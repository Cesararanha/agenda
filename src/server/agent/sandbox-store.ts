import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db, queryAll, queryOne } from '../db.js';
import { createEvent, updateEvent, listOccurrences, getSeries, BadRequest } from '../events.js';
import { addDays, diffDays, now } from '../../shared/dates.js';
import { config } from '../config.js';
import { humanRequest, parseRequest, timedEvent, wallMoment, type TimedEvent } from '../../agent/core/request.js';
import { SandboxAgent, type SandboxState, type AgentResult } from '../../agent/core/sandbox.js';
import type { EventRow } from '../../shared/types.js';

export class SandboxStore {
  constructor() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_sandbox_meta (id INTEGER PRIMARY KEY CHECK(id = 1), version INTEGER NOT NULL);
      INSERT OR IGNORE INTO agent_sandbox_meta (id, version) VALUES (1, 0);
      CREATE TABLE IF NOT EXISTS agent_sandbox_control (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL);
    `);
    for (const table of ['events', 'overrides']) for (const action of ['INSERT', 'UPDATE', 'DELETE']) {
      db.exec(`CREATE TRIGGER IF NOT EXISTS agent_sandbox_${table}_${action}
        AFTER ${action} ON ${table} BEGIN UPDATE agent_sandbox_meta SET version = version + 1 WHERE id = 1; END;`);
    }
  }
  state(from = (config.agentDemoNow || now(config.tz)).slice(0, 10), to = from): SandboxState {
    if (!wallMoment.safeParse(`${from}T00:00`).success || !wallMoment.safeParse(`${to}T00:00`).success
      || to < from || diffDays(to, from) > 366) throw new BadRequest('A conferência do agente precisa de um intervalo válido de até 367 dias.');
    const rows = queryAll<EventRow>('SELECT * FROM events');
    const fixed = rows.filter((row) => !row.all_day && !row.rrule);
    const special = new Set(rows.filter((row) => row.all_day || row.rrule).map((row) => row.id));
    const busy = listOccurrences(from, to).filter((occurrence) => special.has(occurrence.seriesId)).map((occurrence) => ({
      id: occurrence.occurrenceId,
      details: { title: occurrence.title,
        start: occurrence.allDay ? `${occurrence.start}T00:00` : occurrence.start,
        // A agenda usa data final inclusiva para eventos de dia inteiro.
        end: occurrence.allDay ? `${addDays(occurrence.end, 1)}T00:00` : occurrence.end },
    }));
    const control = queryOne<{ data: string }>('SELECT data FROM agent_sandbox_control WHERE id = 1');
    const stored = control ? JSON.parse(control.data) as Pick<SandboxState, 'suggestions' | 'receipts'> : { suggestions: [], receipts: [] };
    return new SandboxAgent({ schemaVersion: 1, version: queryOne<{ version: number }>('SELECT version FROM agent_sandbox_meta WHERE id = 1')!.version,
      events: [...fixed.map((row) => ({ id: row.id, details: { title: row.title, start: row.start, end: row.end } })), ...busy],
      suggestions: stored.suggestions, receipts: stored.receipts }).snapshot();
  }
  summary(): Pick<SandboxState, 'version' | 'suggestions'> {
    const row = queryOne<{ data: string }>('SELECT data FROM agent_sandbox_control WHERE id = 1');
    const stored = row ? JSON.parse(row.data) as Pick<SandboxState, 'suggestions'> : { suggestions: [] };
    return { version: queryOne<{ version: number }>('SELECT version FROM agent_sandbox_meta WHERE id = 1')!.version,
      suggestions: stored.suggestions };
  }
  hasReceipt(requestId: string): boolean {
    const control = queryOne<{ data: string }>('SELECT data FROM agent_sandbox_control WHERE id = 1');
    return control ? (JSON.parse(control.data) as Pick<SandboxState, 'receipts'>).receipts.some((item) => item.requestId === requestId) : false;
  }
  cancel(suggestionId: string, request: { requestId: string; input: string; now: string }): AgentResult {
    return transaction(() => {
      const control = queryOne<{ data: string }>('SELECT data FROM agent_sandbox_control WHERE id = 1');
      const stored = control ? JSON.parse(control.data) as Pick<SandboxState, 'suggestions' | 'receipts'> : { suggestions: [], receipts: [] };
      const agent = new SandboxAgent({ schemaVersion: 1, version: this.summary().version, events: [], ...stored });
      const result = agent.cancel(suggestionId, request);
      saveControl(agent.snapshot());
      return result;
    });
  }
  propose(raw: Parameters<SandboxAgent['propose']>[0], receipt?: { requestId: string; input: string }): AgentResult {
    return transaction(() => {
      const event = timedEvent.parse(raw.event);
      if (raw.targetEventId) {
        const target = getSeries(raw.targetEventId);
        if (!target || target.rrule || target.all_day) throw new BadRequest('Para reorganizar, escolha um compromisso único com horário. O agente ainda não move séries ou eventos de dia inteiro.');
      }
      const agent = new SandboxAgent(this.state(event.start.slice(0, 10), event.end.slice(0, 10)));
      const key = receipt ? createHash('sha256').update(JSON.stringify(receipt.input)).digest('hex') : '';
      const existing = receipt ? agent.snapshot().receipts.find((item) => item.requestId === receipt.requestId) : undefined;
      if (existing) return existing.fingerprint === key ? existing.result : { kind: 'request_reused', message: 'Esse identificador pertence a outro pedido.' };
      const result = agent.propose(raw);
      const state = agent.snapshot();
      if (receipt) state.receipts.push({ requestId: receipt.requestId, fingerprint: key, result });
      saveControl(state);
      return result;
    });
  }
  execute(raw: unknown): AgentResult {
    return transaction(() => {
      const request = humanRequest.parse(raw);
      const parsed = parseRequest(request.input, request.now);
      const event: TimedEvent | undefined = parsed.kind === 'create' ? parsed.event
        : parsed.kind === 'confirm' ? this.summary().suggestions.find((item) => item.id === parsed.suggestionId)?.event : undefined;
      const before = this.state(event?.start.slice(0, 10) ?? request.now.slice(0, 10), event?.end.slice(0, 10));
      const agent = new SandboxAgent(before);
      const result = agent.handle(raw);
      const after = agent.snapshot();
      if (after.version !== before.version && result.event) {
        const candidateId = result.event.id;
        const details = result.event.details;
        const existing = before.events.some((event) => event.id === candidateId);
        if (existing) {
          const target = getSeries(candidateId);
          if (!target || target.rrule || target.all_day) throw new BadRequest('O agente ainda não reorganiza séries ou eventos de dia inteiro.');
        }
        const saved = existing ? updateEvent(candidateId, { start: details.start, end: details.end }, 'all', undefined, 'agent-sandbox')
          : createEvent({ ...details, allDay: false, source: 'ia' }, 'agent-sandbox');
        if (saved.title !== details.title || saved.start !== details.start || saved.end !== details.end) throw new Error('A ferramenta não preservou a proposta validada');
        result.event.id = saved.seriesId;
        for (const receipt of after.receipts) if (receipt.result.event?.id === candidateId) receipt.result.event.id = saved.seriesId;
      }
      saveControl(after);
      return result;
    });
  }
}
function saveControl(state: SandboxState): void {
  db.prepare('INSERT OR REPLACE INTO agent_sandbox_control (id, data) VALUES (1, ?)').run(JSON.stringify({ suggestions: state.suggestions, receipts: state.receipts }));
}
function transaction(run: () => AgentResult): AgentResult {
  db.exec('BEGIN IMMEDIATE');
  try { const result = run(); db.exec('COMMIT'); return result; }
  catch (error) {
    db.exec('ROLLBACK');
    if (error instanceof z.ZodError) throw new BadRequest('Pedido ou estado inválido para o núcleo de teste.');
    if (error instanceof BadRequest) throw error;
    return { kind: 'tool_error', message: 'A ferramenta de teste falhou. A transação foi desfeita; nenhuma alteração foi confirmada.' };
  }
}
