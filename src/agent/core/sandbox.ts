import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { parseRequest, timedEvent, humanRequest, type TimedEvent } from './request.js';

const id = z.string().min(1).max(128);
const agendaEvent = z.object({ id, details: timedEvent }).strict();
const suggestion = z.object({ id, status: z.enum(['pending', 'applied', 'canceled']), agendaVersion: z.number().int().nonnegative(),
  event: timedEvent, targetEventId: id.nullable() }).strict();
export type Suggestion = z.infer<typeof suggestion>;
export type AgendaEvent = z.infer<typeof agendaEvent>;
export type ResultKind = 'created' | 'applied' | 'ask' | 'conflict' | 'suggest' | 'suggestion_pending'
  | 'already_applied' | 'stale_suggestion' | 'tool_error' | 'unsupported' | 'request_reused' | 'suggestion_canceled';
const resultKinds = ['created', 'applied', 'ask', 'conflict', 'suggest', 'suggestion_pending', 'already_applied',
  'stale_suggestion', 'tool_error', 'unsupported', 'request_reused', 'suggestion_canceled'] as const;
const resultSchema = z.object({ kind: z.enum(resultKinds), message: z.string(),
  event: agendaEvent.optional(), suggestionId: id.optional(), conflictIds: z.array(id).optional() }).strict();
export type AgentResult = z.infer<typeof resultSchema>;
const receipt = z.object({ requestId: id, fingerprint: z.string(), result: resultSchema }).strict();
const stateSchema = z.object({ schemaVersion: z.literal(1), version: z.number().int().nonnegative(),
  events: z.array(agendaEvent), suggestions: z.array(suggestion), receipts: z.array(receipt) }).strict()
  .superRefine((state, ctx) => {
    for (const entries of [state.events.map((e) => e.id), state.suggestions.map((s) => s.id), state.receipts.map((r) => r.requestId)]) {
      if (new Set(entries).size !== entries.length) ctx.addIssue({ code: 'custom', message: 'IDs duplicados no checkpoint' });
    }
    for (const item of state.suggestions) {
      if (item.agendaVersion > state.version) ctx.addIssue({ code: 'custom', message: 'Sugestão aponta para versão futura' });
    }
  });
export type SandboxState = z.infer<typeof stateSchema>;
type HumanRequest = z.infer<typeof humanRequest>;
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure = (): AgentResult => ({ kind: 'tool_error', message: 'A ferramenta de teste falhou. Nenhuma alteração foi realizada.' });

function conflicts(events: AgendaEvent[], proposed: TimedEvent, excludeId?: string): string[] {
  // Intervalos [início, fim): terminar às 16h permite outro evento começar às 16h.
  return events.filter((item) => item.id !== excludeId && item.details.start < proposed.end && proposed.start < item.details.end)
    .map((item) => item.id);
}

/**
 * Ferramenta exclusivamente fictícia. Não importa config, banco ou rotas da agenda.
 * Toda escrita, recibo e consumo de sugestão entram no mesmo commit em memória.
 * O estado exportado serve para testar retomada; não é um banco de produção.
 */
export class SandboxAgent {
  private state: SandboxState;
  private failNext = false;
  constructor(checkpoint?: unknown) {
    this.state = stateSchema.parse(checkpoint ?? { schemaVersion: 1, version: 0, events: [], suggestions: [], receipts: [] });
  }
  snapshot(): SandboxState { return structuredClone(this.state); }
  exportCheckpoint(): string { return JSON.stringify(this.state); }
  static restore(checkpoint: string): SandboxAgent { return new SandboxAgent(JSON.parse(checkpoint)); }
  failNextWriteForTest(): void { this.failNext = true; }

  handle(raw: unknown): AgentResult {
    const request = humanRequest.parse(raw);
    const key = fingerprint(request.input);
    const existing = this.state.receipts.find((item) => item.requestId === request.requestId);
    if (existing) return existing.fingerprint === key ? structuredClone(existing.result)
      : { kind: 'request_reused', message: 'Este identificador já pertence a outro pedido. Nenhuma alteração foi realizada.' };
    const draft = this.snapshot();
    const result = this.decide(request, draft);
    if (result.kind === 'created' || result.kind === 'applied') {
      if (this.failNext) {
        this.failNext = false;
        const error = failure();
        // A falha injetada é anterior ao commit. Retentar o mesmo pedido devolve o recibo de falha.
        this.state.receipts.push({ requestId: request.requestId, fingerprint: key, result: error });
        return structuredClone(error);
      }
    }
    draft.receipts.push({ requestId: request.requestId, fingerprint: key, result });
    this.state = draft;
    return structuredClone(result);
  }

  /** Cancela somente a proposta pendente; nunca remove um compromisso. */
  cancel(suggestionId: string, raw: unknown): AgentResult {
    const request = humanRequest.parse(raw);
    const key = fingerprint(request.input);
    const existing = this.state.receipts.find((item) => item.requestId === request.requestId);
    if (existing) return existing.fingerprint === key ? structuredClone(existing.result)
      : { kind: 'request_reused', message: 'Esse identificador pertence a outro pedido.' };
    const draft = this.snapshot();
    const selected = draft.suggestions.find((item) => item.id === suggestionId);
    let result: AgentResult;
    if (!selected) result = { kind: 'ask', message: 'Não encontrei essa sugestão. Nenhum compromisso foi alterado.' };
    else if (selected.status === 'applied') result = { kind: 'ask', suggestionId, message: 'Essa sugestão já virou um compromisso. Cancelar a proposta não remove o evento registrado.' };
    else {
      selected.status = 'canceled';
      result = { kind: 'suggestion_canceled', suggestionId, message: 'Sugestão cancelada. Nenhum compromisso novo foi registrado.' };
    }
    draft.receipts.push({ requestId: request.requestId, fingerprint: key, result });
    this.state = draft;
    return structuredClone(result);
  }

  /** Proposta ainda sem efeito na agenda. O ID é gerado aqui, nunca pelo modelo. */
  propose(raw: { event: TimedEvent; targetEventId?: string; expectedVersion: number }): AgentResult {
    const parsed = z.object({ event: timedEvent, targetEventId: id.optional(), expectedVersion: z.number().int().nonnegative() }).strict().parse(raw);
    if (parsed.expectedVersion !== this.state.version) return { kind: 'stale_suggestion', message: 'A agenda mudou. A proposta precisa ser refeita.' };
    if (parsed.targetEventId) {
      const target = this.state.events.find((item) => item.id === parsed.targetEventId);
      if (!target || target.details.title !== parsed.event.title
        || duration(target.details) !== duration(parsed.event)) return { kind: 'ask', message: 'Uma reorganização deve preservar o evento e sua duração.' };
    }
    const overlap = conflicts(this.state.events, parsed.event, parsed.targetEventId);
    if (overlap.length) return { kind: 'conflict', conflictIds: overlap, message: 'A proposta conflita com a agenda. Escolha outro horário.' };
    const suggestionId = `sug-${randomUUID()}`;
    this.state.suggestions.push({ id: suggestionId, status: 'pending', agendaVersion: this.state.version,
      event: structuredClone(parsed.event), targetEventId: parsed.targetEventId ?? null });
    return { kind: 'suggestion_pending', suggestionId,
      message: `Proposta pendente. Para aplicar no sandbox, diga: Confirmo a sugestão ${suggestionId}.` };
  }

  private decide(request: HumanRequest, draft: SandboxState): AgentResult {
    const parsed = parseRequest(request.input, request.now);
    if (parsed.kind === 'missing') return { kind: 'ask', message: `Preciso de: ${parsed.fields.join(', ')}.` };
    if (parsed.kind === 'unsupported') return { kind: 'unsupported', message: 'O núcleo de teste ainda não interpreta esse formato. Nenhuma alteração foi realizada.' };
    if (parsed.kind === 'suggest') return { kind: 'suggest', message: 'Posso preparar uma proposta de organização; a aplicação depende de confirmação identificada.' };
    let details: TimedEvent;
    let confirmed: Suggestion | undefined;
    if (parsed.kind === 'confirm') {
      confirmed = draft.suggestions.find((item) => item.id === parsed.suggestionId);
      if (!confirmed) return { kind: 'ask', message: 'Não encontrei essa sugestão. Informe o identificador exato.' };
      if (confirmed.status === 'applied') return { kind: 'already_applied', suggestionId: confirmed.id, message: 'Essa sugestão já foi aplicada no sandbox. Nenhuma nova alteração foi realizada.' };
      if (confirmed.status === 'canceled') return { kind: 'ask', suggestionId: confirmed.id, message: 'Essa sugestão foi cancelada. Peça uma nova proposta antes de confirmar.' };
      if (confirmed.agendaVersion !== draft.version) return { kind: 'stale_suggestion', suggestionId: confirmed.id, message: 'A agenda mudou após a proposta. Revise a organização antes de confirmar novamente.' };
      details = confirmed.event;
    } else details = parsed.event;
    const overlap = conflicts(draft.events, details, confirmed?.targetEventId ?? undefined);
    if (overlap.length) return { kind: 'conflict', conflictIds: overlap, message: 'Há conflito de horário. Aguardando sua orientação; nenhum evento foi alterado.' };
    const event: AgendaEvent = { id: confirmed?.targetEventId ?? `evt-${randomUUID()}`, details: structuredClone(details) };
    if (confirmed?.targetEventId) {
      const index = draft.events.findIndex((item) => item.id === confirmed.targetEventId);
      if (index < 0) return { kind: 'stale_suggestion', suggestionId: confirmed.id, message: 'O evento alvo não existe mais. Refaça a proposta.' };
      draft.events[index] = event;
    } else draft.events.push(event);
    if (confirmed) confirmed.status = 'applied';
    draft.version++;
    return { kind: confirmed ? 'applied' : 'created', event,
      ...(confirmed ? { suggestionId: confirmed.id } : {}),
      message: confirmed ? 'Sugestão aplicada e conferida no sandbox.' : 'Evento registrado e conferido no sandbox.' };
  }
}

function duration(event: TimedEvent): number { return Date.parse(`${event.end}:00Z`) - Date.parse(`${event.start}:00Z`); }
