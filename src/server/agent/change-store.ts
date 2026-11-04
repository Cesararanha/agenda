import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { db, queryAll, queryOne, audit } from '../db.js';
import { config } from '../config.js';
import { getSeries, listOccurrences, updateEvent, deleteEvent, BadRequest } from './sandbox-events.js';
import { addDays } from '../../shared/dates.js';
import { humanRequest, timedEvent, wallMoment } from '../../agent/core/request.js';
import { describeChange, type ChangeTarget, type ChangeSpec, type EventChange, type ChangeResult } from '../../agent/core/event-change.js';
import type { EventRow } from '../../shared/types.js';
type Request = {
    requestId: string;
    input: string;
    now: string;
};
interface Stored {
    data: string;
    backup: string | null;
}
interface Backup {
    row: EventRow;
    overrides: Record<string, string | number | null>[];
}
const target = z.object({ id: z.string().min(1).max(128), seriesId: z.string().min(1).max(128), occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), title: z.string().min(1).max(500), start: z.string(), end: z.string(), allDay: z.boolean(), recurring: z.boolean() }).strict();
const specSchema = z.object({ action: z.enum(['move', 'delete']), target, expectedVersion: z.number().int().nonnegative(), after: timedEvent.optional() }).strict().superRefine((spec, ctx) => {
    if ((spec.action === 'move') !== Boolean(spec.after))
        ctx.addIssue({ code: 'custom', message: 'A alteração precisa de intervalo; cancelamento não recebe novo evento.' });
});
const answer = (kind: ChangeResult['kind'], message: string, change?: EventChange, changed = false): ChangeResult => ({ kind, message, changed, evidenceIds: ['agenda'], ...(change ? { change } : {}) });
const version = () => queryOne<{
    version: number;
}>('SELECT version FROM agent_sandbox_meta WHERE id = 1')!.version;
const key = (item: ChangeTarget) => JSON.stringify([item.id, item.seriesId, item.occurrenceDate, item.title, item.start, item.end, item.allDay, item.recurring]);
/** Só existe no sandbox: o modelo nunca recebe este executor nem escolhe IDs. */
export class ChangeStore {
    constructor() {
        if (!config.agentSandbox)
            throw Error('Alterações do agente exigem a demonstração isolada.');
        db.exec(`CREATE TABLE IF NOT EXISTS agent_sandbox_changes(id TEXT PRIMARY KEY,data TEXT NOT NULL,backup TEXT);
      CREATE TABLE IF NOT EXISTS agent_sandbox_change_receipts(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,result TEXT NOT NULL);`);
    }
    list(): EventChange[] { return queryAll<{
        data: string;
    }>('SELECT data FROM agent_sandbox_changes ORDER BY rowid DESC LIMIT 100').map(row => JSON.parse(row.data) as EventChange); }
    targets(from: string, to: string): ChangeTarget[] { return listOccurrences(from, to).map(({ id, seriesId, occurrenceDate, title, start, end, allDay, recurring }) => ({ id, seriesId, occurrenceDate, title, start, end, allDay, recurring })); }
    private current(item: ChangeTarget): ChangeTarget | undefined { return this.targets(item.start.slice(0, 10), item.end.slice(0, 10)).find(candidate => candidate.id === item.id); }
    private conflict(spec: ChangeSpec): boolean {
        if (!spec.after)
            return false;
        const next = spec.after;
        return listOccurrences(next.start.slice(0, 10), next.end.slice(0, 10)).some(item => {
            if (item.id === spec.target.id)
                return false;
            const start = item.allDay ? `${item.start}T00:00` : item.start;
            const end = item.allDay ? `${addDays(item.end, 1)}T00:00` : item.end;
            return start < next.end && next.start < end;
        });
    }
    prepare(raw: ChangeSpec, request: Request): ChangeResult {
        return this.transact(request, 'prepare', () => {
            const spec = specSchema.parse(raw) as ChangeSpec;
            if (!wallMoment.safeParse(`${spec.target.occurrenceDate}T00:00`).success)
                throw new BadRequest('Data de ocorrência inválida.');
            const current = this.current(spec.target);
            if (version() !== spec.expectedVersion || !current || key(current) !== key(spec.target))
                return answer('stale_suggestion', 'O compromisso mudou durante a consulta. Peça uma nova prévia.');
            if (spec.action === 'move' && (current.allDay || spec.after!.title !== current.title))
                return answer('ask', 'Essa alteração deve manter o título e um compromisso com horário definido. Use o calendário para mudar o tipo.');
            if (this.conflict(spec))
                return answer('conflict', 'O novo intervalo conflita com outro compromisso. Nenhuma alteração foi preparada. Escolha outro dia ou horário.');
            const change: EventChange = { ...spec, id: `alteracao-${randomUUID()}`, status: 'pending' };
            db.prepare('INSERT INTO agent_sandbox_changes(id,data) VALUES(?,?)').run(change.id, JSON.stringify(change));
            return answer('change_pending', describeChange(change), change);
        });
    }
    apply(id: string, request: Request): ChangeResult {
        return this.transact(request, `apply:${id}`, () => {
            const stored = queryOne<Stored>('SELECT data,backup FROM agent_sandbox_changes WHERE id = ?', id);
            if (!stored)
                return answer('ask', 'Não encontrei essa alteração. Peça uma nova prévia.');
            const change = JSON.parse(stored.data) as EventChange;
            if (change.status === 'applied')
                return answer('already_applied', 'Essa alteração já foi aplicada. Nenhum compromisso foi duplicado.', change);
            if (change.status !== 'pending')
                return answer('ask', 'Essa alteração foi cancelada ou desfeita. Peça uma nova prévia.', change);
            const current = this.current(change.target);
            if (version() !== change.expectedVersion || !current || key(current) !== key(change.target))
                return answer('stale_suggestion', 'A agenda mudou depois da prévia. Peça uma alteração atualizada antes de confirmar.', change);
            if (this.conflict(change))
                return answer('conflict', 'O novo horário está ocupado. Nenhum compromisso foi alterado.', change);
            const row = getSeries(change.target.seriesId);
            if (!row)
                throw Error('Compromisso não encontrado');
            const backup: Backup = { row, overrides: queryAll<Record<string, string | number | null>>('SELECT * FROM overrides WHERE event_id = ?', row.id) };
            const scope = change.target.recurring ? 'this' : 'all';
            if (change.action === 'move') {
                const saved = updateEvent(row.id, { start: change.after!.start, end: change.after!.end }, scope, change.target.occurrenceDate, 'agent-sandbox-change');
                if (saved.seriesId !== row.id || saved.title !== change.target.title || saved.start !== change.after!.start || saved.end !== change.after!.end)
                    throw Error('Gravação divergente da prévia');
            }
            else {
                deleteEvent(row.id, scope, change.target.occurrenceDate, 'agent-sandbox-change');
                if (this.current(change.target))
                    throw Error('A ocorrência cancelada continua presente');
            }
            change.status = 'applied';
            change.appliedVersion = version();
            db.prepare('UPDATE agent_sandbox_changes SET data = ?,backup = ? WHERE id = ?').run(JSON.stringify(change), JSON.stringify(backup), id);
            audit('agent-sandbox-change', `change:${change.action}`, { id, eventId: row.id, occurrenceDate: change.target.occurrenceDate });
            return answer('change_applied', `${change.action === 'delete' ? 'Cancelamento aplicado' : 'Mudança de horário aplicada'} a ${change.target.title}${change.target.recurring ? ', somente nessa ocorrência' : ''}. Você pode desfazer enquanto a agenda não receber outras alterações.`, change, true);
        });
    }
    cancel(id: string, request: Request): ChangeResult {
        return this.transact(request, `cancel:${id}`, () => {
            const stored = queryOne<Stored>('SELECT data,backup FROM agent_sandbox_changes WHERE id = ?', id);
            if (!stored)
                return answer('ask', 'Não encontrei essa alteração.');
            const change = JSON.parse(stored.data) as EventChange;
            if (change.status === 'applied')
                return answer('ask', 'A alteração já foi aplicada. Para restaurar o compromisso, use Desfazer alteração.', change);
            if (change.status === 'undone')
                return answer('ask', 'Essa alteração já foi desfeita.', change);
            change.status = 'canceled';
            db.prepare('UPDATE agent_sandbox_changes SET data = ? WHERE id = ?').run(JSON.stringify(change), id);
            return answer('change_canceled', 'Prévia cancelada. Nenhum compromisso foi alterado.', change);
        });
    }
    undo(id: string, request: Request): ChangeResult {
        return this.transact(request, `undo:${id}`, () => {
            const stored = queryOne<Stored>('SELECT data,backup FROM agent_sandbox_changes WHERE id = ?', id);
            if (!stored)
                return answer('ask', 'Não encontrei essa alteração.');
            const change = JSON.parse(stored.data) as EventChange;
            if (change.status === 'undone')
                return answer('change_undone', 'Essa alteração já foi desfeita.', change);
            if (change.status !== 'applied' || !stored.backup)
                return answer('ask', 'Essa alteração não foi aplicada.', change);
            if (version() !== change.appliedVersion)
                return answer('stale_suggestion', 'A agenda recebeu outras alterações. Não vou sobrescrevê-las ao desfazer.', change);
            const backup = JSON.parse(stored.backup) as Backup;
            const columns = ['id', 'title', 'notes', 'location', 'start', 'end', 'all_day', 'category', 'rrule', 'exdates', 'source', 'external_id', 'is_suggestion', 'created_at', 'updated_at'] as const;
            db.prepare(`INSERT OR REPLACE INTO events(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...columns.map(column => backup.row[column]));
            db.prepare('DELETE FROM overrides WHERE event_id = ?').run(backup.row.id);
            for (const row of backup.overrides) {
                const fields = ['event_id', 'occurrence_date', 'title', 'notes', 'location', 'start', 'end', 'canceled'];
                db.prepare(`INSERT INTO overrides(${fields.join(',')}) VALUES(${fields.map(() => '?').join(',')})`).run(...fields.map(field => row[field]!));
            }
            change.status = 'undone';
            db.prepare('UPDATE agent_sandbox_changes SET data = ? WHERE id = ?').run(JSON.stringify(change), id);
            audit('agent-sandbox-change', 'change:undo', { id });
            return answer('change_undone', 'Alteração desfeita. O compromisso e suas exceções anteriores foram restaurados.', change, true);
        });
    }
    private transact(raw: Request, operation: string, run: () => ChangeResult): ChangeResult {
        const request = humanRequest.parse(raw), fingerprint = createHash('sha256').update(JSON.stringify([operation, request.input])).digest('hex');
        db.exec('BEGIN IMMEDIATE');
        try {
            const receipt = queryOne<{
                fingerprint: string;
                result: string;
            }>('SELECT fingerprint,result FROM agent_sandbox_change_receipts WHERE id = ?', request.requestId);
            if (receipt) {
                db.exec('COMMIT');
                return receipt.fingerprint === fingerprint ? JSON.parse(receipt.result) as ChangeResult : answer('request_reused', 'Esse identificador pertence a outro pedido.');
            }
            const result = run();
            db.prepare('INSERT INTO agent_sandbox_change_receipts(id,fingerprint,result) VALUES(?,?,?)').run(request.requestId, fingerprint, JSON.stringify(result));
            db.exec('COMMIT');
            return result;
        }
        catch (error) {
            db.exec('ROLLBACK');
            if (error instanceof BadRequest)
                throw error;
            if (error instanceof z.ZodError)
                throw new BadRequest('Alteração inválida. Nenhum compromisso foi alterado.');
            const id = operation.split(':')[1], stored = id ? queryOne<Stored>('SELECT data,backup FROM agent_sandbox_changes WHERE id = ?', id) : undefined;
            return answer('tool_error', 'A ferramenta falhou. A transação foi desfeita; nenhum compromisso foi alterado.', stored ? JSON.parse(stored.data) as EventChange : undefined);
        }
    }
}
