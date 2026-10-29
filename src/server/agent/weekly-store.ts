import { randomUUID } from 'node:crypto';
import { db, queryAll, queryOne, audit } from '../db.js';
import { listOccurrences, createEvent, deleteEvent, BadRequest } from '../events.js';
import { addDays, formatDateBR } from '../../shared/dates.js';
import { humanRequest } from '../../agent/core/request.js';
import { describePlan, weeklyRequest, planOccurrences, firstWeeklyOverlap, type WeeklyRequest, type WeeklyPlan, type PlanResult } from '../../agent/core/weekly-plan.js';
import type { EventRow } from '../../shared/types.js';
import type { Occurrence } from '../../shared/types.js';

type Request = { requestId: string; input: string; now: string };
interface StoredPlan { data: string; backup: string | null }
interface Backup { rows: EventRow[]; overrides: Record<string, string | number | null>[]; created: string[] }
const version = () => queryOne<{ version: number }>('SELECT version FROM agent_sandbox_meta WHERE id = 1')!.version;
const result = (kind: PlanResult['kind'], message: string, plan?: WeeklyPlan, changed = false): PlanResult => ({ kind, message, plan, changed, evidenceIds: ['agenda'] });
function conflict(spec: WeeklyRequest, through: string, existing: Occurrence[]): string | null {
  const overlap = planOccurrences(spec, through).flatMap((event) => {
    const match = existing.find((item) => (item.allDay ? `${item.start}T00:00` : item.start) < event.end
      && event.start < (item.allDay ? `${addDays(item.end, 1)}T00:00` : item.end));
    return match ? [{ event, title: match.title }] : [];
  })[0];
  if (overlap) return `O bloco de ${formatDateBR(overlap.event.start.slice(0, 10))}, ${overlap.event.start.slice(11)} às ${overlap.event.end.slice(11)}, conflita com ${overlap.title}. Nenhuma parte foi aplicada.`;
  if (spec.repeat) {
    for (const row of queryAll<EventRow>('SELECT * FROM events WHERE rrule IS NULL AND substr(end, 1, 10) > ?', through)) {
      const block = { start: row.all_day ? `${row.start}T00:00` : row.start, end: row.all_day ? `${addDays(row.end, 1)}T00:00` : row.end };
      for (const event of spec.events) {
        const future = firstWeeklyOverlap(event, block);
        if (future) return `A rotina conflita em ${formatDateBR(future.start.slice(0, 10))} com ${row.title}, já cadastrado na agenda. Nenhuma parte foi aplicada.`;
      }
    }
  }
  return null;
}

/** Lotes só existem no sandbox. Proposta, aplicação e desfazer têm recibos e transações próprios. */
export class WeeklyStore {
  constructor() {
    db.exec(`CREATE TABLE IF NOT EXISTS agent_sandbox_plans (id TEXT PRIMARY KEY, data TEXT NOT NULL, backup TEXT);
      CREATE TABLE IF NOT EXISTS agent_sandbox_plan_receipts (id TEXT PRIMARY KEY, input TEXT NOT NULL, result TEXT NOT NULL);`);
  }
  list(): WeeklyPlan[] { return queryAll<{ data: string }>('SELECT data FROM agent_sandbox_plans ORDER BY rowid').map((row) => JSON.parse(row.data) as WeeklyPlan); }
  prepare(raw: WeeklyRequest, request: Request): PlanResult {
    return this.transact(request, () => {
      const spec = weeklyRequest.parse(raw);
      const occurrences = listOccurrences(spec.from, spec.to);
      if (spec.replace && !spec.events.length && !occurrences.length) return result('answer', `Não há compromissos cadastrados de ${formatDateBR(spec.from)} a ${formatDateBR(spec.to)} para remover. Nenhuma alteração foi necessária.`);
      const end = `${addDays(spec.to, 1)}T00:00`;
      if (spec.replace && occurrences.some((item) => item.start.slice(0, 10) < spec.from || (item.allDay ? item.end > spec.to : item.end > end))) {
        return result('ask', 'Há compromissos que atravessam o limite dessa semana. Preciso esclarecer como tratá-los antes de remover qualquer coisa.');
      }
      const through = spec.repeat ? addDays(spec.from, 365) : spec.to;
      const removedIds = new Set(spec.replace ? occurrences.map((item) => item.id) : []);
      const keep = listOccurrences(spec.from, through).filter((item) => !removedIds.has(item.id));
      const blocked = conflict(spec, through, keep);
      if (blocked) return result('conflict', blocked);
      if (spec.events.some((event, i) => spec.events.some((other, j) => j < i && event.start < other.end && other.start < event.end))) return result('conflict', 'Os blocos do plano conflitam entre si. Nenhuma parte foi aplicada.');
      const plan: WeeklyPlan = { ...spec, id: `plano-${randomUUID()}`, version: version(), status: 'pending', ...(spec.repeat ? { conflictsThrough: through } : {}),
        removals: spec.replace ? occurrences.map(({ id, seriesId, occurrenceDate, recurring, title, start, end, allDay }) => ({ id, seriesId, occurrenceDate, recurring, title, start, end, allDay })) : [] };
      db.prepare('INSERT INTO agent_sandbox_plans (id, data) VALUES (?, ?)').run(plan.id, JSON.stringify(plan));
      return result('plan_pending', describePlan(plan), plan);
    });
  }
  apply(id: string, request: Request): PlanResult {
    return this.transact(request, () => {
      const stored = queryOne<StoredPlan>('SELECT data, backup FROM agent_sandbox_plans WHERE id = ?', id);
      if (!stored) return result('ask', 'Não encontrei esse plano. Peça uma nova proposta.');
      const plan = JSON.parse(stored.data) as WeeklyPlan;
      if (plan.status === 'applied') return result('already_applied', 'Esse plano já foi aplicado. Nenhuma alteração foi repetida.', plan);
      if (plan.status !== 'pending') return result('ask', 'Esse plano foi cancelado ou desfeito. Peça uma nova proposta.', plan);
      if (version() !== plan.version) return result('stale_suggestion', 'A agenda mudou depois da proposta. Peça um plano atualizado antes de confirmar.', plan);
      const ids = [...new Set(plan.removals.map((item) => item.seriesId))];
      const backup: Backup = { rows: [], overrides: [], created: [] };
      for (const eventId of ids) {
        const row = queryOne<EventRow>('SELECT * FROM events WHERE id = ?', eventId);
        if (!row) throw new Error('Compromisso do plano não encontrado');
        backup.rows.push(row);
        backup.overrides.push(...queryAll<Record<string, string | number | null>>('SELECT * FROM overrides WHERE event_id = ?', eventId));
      }
      for (const item of plan.removals) deleteEvent(item.seriesId, item.recurring ? 'this' : 'all', item.recurring ? item.occurrenceDate : undefined, 'agent-sandbox-plan');
      // Confere o estado resultante dentro da mesma transação, antes do primeiro registro.
      const through = plan.conflictsThrough ?? plan.to;
      if (conflict(plan, through, listOccurrences(plan.from, through))) throw new Error('Conflito após preparar a alteração');
      for (const event of plan.events) {
        const saved = createEvent({ ...event, allDay: false, source: 'ia', ...(plan.repeat ? { rrule: 'FREQ=WEEKLY' } : {}) }, 'agent-sandbox-plan');
        if (saved.start !== event.start || saved.end !== event.end || saved.title !== event.title || (plan.repeat && saved.rrule !== 'FREQ=WEEKLY')) throw new Error('Registro divergente do plano');
        backup.created.push(saved.seriesId);
      }
      plan.status = 'applied'; plan.appliedVersion = version();
      db.prepare('UPDATE agent_sandbox_plans SET data = ?, backup = ? WHERE id = ?').run(JSON.stringify(plan), JSON.stringify(backup), plan.id);
      audit('agent-sandbox-plan', 'plan:apply', { id: plan.id, removed: plan.removals.length, created: backup.created.length });
      return result('plan_applied', `Plano aplicado: ${plan.removals.length} compromisso(s) removido(s) somente de ${formatDateBR(plan.from)} a ${formatDateBR(plan.to)} e ${backup.created.length} ${plan.repeat ? 'série(s) semanal(is) criada(s), sem data final' : 'compromisso(s) adicionado(s)'}. Você pode desfazer esse plano enquanto a agenda não receber outras alterações.`, plan, true);
    });
  }
  cancel(id: string, request: Request): PlanResult {
    return this.transact(request, () => {
      const stored = queryOne<StoredPlan>('SELECT data, backup FROM agent_sandbox_plans WHERE id = ?', id);
      if (!stored) return result('ask', 'Não encontrei esse plano.');
      const plan = JSON.parse(stored.data) as WeeklyPlan;
      if (plan.status === 'applied') return result('ask', 'Esse plano já foi aplicado. Para restaurar a agenda anterior, peça para desfazer o plano.', plan);
      if (plan.status === 'pending') { plan.status = 'canceled'; db.prepare('UPDATE agent_sandbox_plans SET data = ? WHERE id = ?').run(JSON.stringify(plan), id); }
      return result('plan_canceled', 'Plano cancelado. Nenhum compromisso foi alterado.', plan);
    });
  }
  undo(id: string, request: Request): PlanResult {
    return this.transact(request, () => {
      const stored = queryOne<StoredPlan>('SELECT data, backup FROM agent_sandbox_plans WHERE id = ?', id);
      if (!stored) return result('ask', 'Não encontrei esse plano.');
      const plan = JSON.parse(stored.data) as WeeklyPlan;
      if (plan.status === 'undone') return result('plan_undone', 'Esse plano já foi desfeito. Nenhuma alteração foi repetida.', plan);
      if (plan.status !== 'applied' || !stored.backup) return result('ask', 'Esse plano não foi aplicado. Não há alteração para desfazer.', plan);
      if (version() !== plan.appliedVersion) return result('stale_suggestion', 'A agenda recebeu outras alterações. Não vou sobrescrevê-las ao desfazer. Preciso preparar uma nova revisão.', plan);
      const backup = JSON.parse(stored.backup) as Backup;
      for (const eventId of backup.created) deleteEvent(eventId, 'all', undefined, 'agent-sandbox-plan');
      for (const row of backup.rows) {
        const columns = ['id', 'title', 'notes', 'location', 'start', 'end', 'all_day', 'category', 'rrule', 'exdates', 'source', 'external_id', 'created_at', 'updated_at'] as const;
        db.prepare(`INSERT OR REPLACE INTO events (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map((key) => row[key]));
        db.prepare('DELETE FROM overrides WHERE event_id = ?').run(row.id);
      }
      for (const override of backup.overrides) {
        const columns = ['event_id', 'occurrence_date', 'title', 'notes', 'location', 'start', 'end', 'canceled'];
        db.prepare(`INSERT INTO overrides (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map((key) => override[key]!));
      }
      plan.status = 'undone';
      db.prepare('UPDATE agent_sandbox_plans SET data = ? WHERE id = ?').run(JSON.stringify(plan), id);
      audit('agent-sandbox-plan', 'plan:undo', { id });
      return result('plan_undone', 'Plano desfeito. Os compromissos anteriores foram restaurados e os criados pelo plano foram removidos.', plan, true);
    });
  }
  private transact(raw: Request, run: () => PlanResult): PlanResult {
    const request = humanRequest.parse(raw);
    db.exec('BEGIN IMMEDIATE');
    try {
      const receipt = queryOne<{ input: string; result: string }>('SELECT input, result FROM agent_sandbox_plan_receipts WHERE id = ?', request.requestId);
      if (receipt) { db.exec('COMMIT'); return receipt.input === request.input ? JSON.parse(receipt.result) as PlanResult : result('request_reused', 'Esse identificador pertence a outro pedido.'); }
      const answer = run();
      db.prepare('INSERT INTO agent_sandbox_plan_receipts (id, input, result) VALUES (?, ?, ?)').run(request.requestId, request.input, JSON.stringify(answer));
      db.exec('COMMIT');
      return answer;
    } catch (error) {
      db.exec('ROLLBACK');
      if (error instanceof BadRequest) throw error;
      return result('tool_error', 'Não consegui aplicar o conjunto. A transação foi desfeita; nenhuma parte da agenda foi alterada.');
    }
  }
}
