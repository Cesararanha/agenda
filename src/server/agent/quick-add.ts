import { z } from 'zod';
import { applyQuickExtraction, eventHint, quickBlocks, quickModelInput, quickNotes } from '../../agent/core/quick-add.js';
import { timedEvent, wallMoment } from '../../agent/core/request.js';
import { Ollama, pilotConfig } from '../../agent/pilot/ollama.js';
import { addDays, dateOf, now } from '../../shared/dates.js';
import { occurrenceDates, parseRrule } from '../../shared/recurrence.js';
import type { QuickDraft, QuickProposal } from '../../shared/quick-add.js';
import { CATEGORIES, type EventSource } from '../../shared/types.js';
import { config } from '../config.js';
import { BadRequest, createEvent, listOccurrences } from '../events.js';
import { audit, run, transaction } from '../store.js';
import { inferCategory } from '../nlp.js';

export const SIMPLE_NOTICE = 'Entendi do jeito simples, confira os campos.';
export const quickInput = z.string().trim().min(1).max(1500);

export function quickModel() {
  return new Ollama({ ...pilotConfig(), timeoutMs: 8000 });
}

// O modelo roda no Mac. Na nuvem a barra usa só as regras, sem esperar o limite de 8 s.
const extractWithModel = async (blocks: ReturnType<typeof quickModelInput>) => {
  if (config.cloud) throw new Error('modelo indisponivel na nuvem');
  return quickModel().extractQuickAdd(blocks);
};

export async function interpretQuickAdd(
  input: string,
  reference: string,
  extract = extractWithModel,
): Promise<QuickProposal> {
  const parsed = quickBlocks(input, reference);
  if ('question' in parsed) return { drafts: [], question: parsed.question };

  let drafts: QuickDraft[] | null;
  let notice: string | undefined;
  try {
    const result = await extract(quickModelInput(parsed.blocks));
    drafts = applyQuickExtraction(JSON.parse(result.content), parsed.blocks);
    if (!drafts) return { drafts: [], question: 'Pode reformular os títulos dos compromissos?' };
  } catch {
    notice = SIMPLE_NOTICE;
    drafts = parsed.blocks.map(({ text, eventText, date, time, endTime, rrule }) => {
      const title = (eventHint(eventText) || 'Sem titulo').replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase('pt-BR'));
      const detail = text.slice(text.indexOf(eventText) + eventText.length).replace(/^[.!,;\s]+/, '').trim();
      return { title, date, time, endTime, rrule, category: 'outro', location: null,
        notes: quickNotes(detail, null) };
    });
    if (drafts.some((draft) => draft.title === 'Sem titulo')) {
      return { drafts: [], notice, question: 'Qual é o título do compromisso?' };
    }
  }
  drafts = drafts.map((draft) => ({ ...draft, category: (/\b(?:correr|corrida|caminhada)\b/i.test(draft.title) ? 'saude' : inferCategory(draft.title)) ?? draft.category }));
  const missing = drafts.filter((draft) => !draft.date || !draft.time);
  const question = missing.length
    ? missing.map((draft) => `Qual ${!draft.date && !draft.time ? 'é a data e o horário' : !draft.date ? 'é a data' : 'é o horário'} de “${draft.title}”?`).join(' ')
    : undefined;
  return { drafts, notice, question };
}

const quickDraft = z.object({
  title: z.string().trim().min(1).max(500),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^(?:\d{2}:\d{2})?$/),
  endTime: z.string().regex(/^(?:\d{2}:\d{2})?$/),
  category: z.enum(CATEGORIES),
  notes: z.string().max(500).nullable(),
  location: z.string().max(160).nullable(),
  rrule: z.string().max(120).nullable(),
}).strict();

export const quickConfirmation = z.array(quickDraft).min(1).max(5);

function eventOf(draft: QuickDraft, allowSuggestions = false) {
  const rule = parseRrule(draft.rrule);
  if (draft.rrule && (!rule || (rule.until && rule.until < draft.date))) throw new BadRequest('Confira a repetição.');
  const details = { title: draft.title, category: draft.category, notes: draft.notes, location: draft.location, rrule: draft.rrule };
  if (allowSuggestions && !draft.time && !draft.endTime && wallMoment.safeParse(`${draft.date}T00:00`).success) {
    return { ...details, start: draft.date, end: draft.date, allDay: true, suggestion: true };
  }
  const event = timedEvent.safeParse({ title: draft.title, start: `${draft.date}T${draft.time}`, end: `${draft.date}T${draft.endTime}` });
  if (!event.success) throw new BadRequest('Confira a data e os horários.');
  return { ...details, ...event.data };
}

export async function quickConflict(drafts: QuickDraft[]): Promise<string | undefined> {
  const batch: { start: string; end: string; title: string }[] = [];
  for (const draft of drafts) {
    if (!draft.date || !draft.time || !draft.endTime) continue;
    const event = eventOf(draft);
    const rule = parseRrule(event.rrule);
    const until = rule ? addDays(draft.date, 90) : draft.date;
    const existing = await listOccurrences(draft.date, until);
    for (const day of occurrenceDates(draft.date, rule, draft.date, until)) {
      const start = day + event.start.slice(10);
      const end = day + event.end.slice(10);
      const conflict = [...existing, ...batch].find((other) =>
        dateOf(other.start) <= day && (other.end.length === 10 ? other.end >= day : other.end > start) && other.start < end);
      if (conflict) return `“${event.title}” coincide com “${conflict.title}” em ${day}. Confira os horários.`;
      batch.push({ start, end, title: event.title });
    }
  }
}

export async function proposeQuickAdd(input: string): Promise<QuickProposal> {
  const proposal = await interpretQuickAdd(input, config.agentDemoNow || now(config.tz));
  return { ...proposal, conflict: await quickConflict(proposal.drafts) };
}

// A gravação e o consumo da confirmação são uma única transação.
export async function saveQuickAdd(drafts: QuickDraft[], source: EventSource, options: {
  allowSuggestions?: boolean;
  replaceSuggestion?: string;
  consume?: () => Promise<void>;
} = {}) {
  const events = drafts.map((draft) => eventOf(draft, options.allowSuggestions));
  return transaction(async () => {
    const conflict = await quickConflict(drafts);
    if (conflict) throw new BadRequest(conflict);
    const created = [];
    for (const event of events) created.push(await createEvent({ ...event, source }, source));
    if (options.replaceSuggestion) {
      const changes = await run("DELETE FROM events WHERE id = ? AND is_suggestion = 1 AND source IN ('app', 'whatsapp')",
        options.replaceSuggestion);
      if (!changes) throw new BadRequest('Essa sugestão já foi usada ou removida.');
      await audit(source, 'suggestion:scheduled', { suggestionId: options.replaceSuggestion, eventId: created[0]?.seriesId });
    }
    await options.consume?.();
    return created;
  });
}
