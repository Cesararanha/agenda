import { z } from 'zod';
import { addDays, addMinutes, endOfMonth, timeOf, weekday } from '../../shared/dates.js';
import { formatRrule } from '../../shared/recurrence.js';
import { CATEGORIES } from '../../shared/types.js';
import type { QuickDraft } from '../../shared/quick-add.js';
import { planningRead } from './assisted-plan.js';
import { isEventChangeRequest, parseChangeTime } from './event-change.js';
import { expandWeekdayAliases, explicitWeeklyRepeat, humanDatePattern, humanRangesIn, humanTimeRange, normalizeText, resolveHumanDate, weeklyRepeatHasConstraint } from './human-time.js';
import { timedEvent } from './request.js';
import { groundedTitle } from './title-interpretation.js';
import { wallMoment } from './time-contract.js';

const nullableText = { type: ['string', 'null'] };
export const quickFormat = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: { items: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['titleSpan', 'category', 'location', 'notes'],
    properties: { titleSpan: nullableText, category: { type: 'string', enum: CATEGORIES }, location: nullableText, notes: nullableText },
  } } },
};

export const quickPrompt = `Extraia exatamente um item para cada bloco, na ordem recebida. JSON {"items":[...]}.
Campos: titleSpan (copie o trecho de "event" que nomeia a atividade), category (faculdade, trabalho, projeto, estudo, pessoal, saude, outro), location (trecho literal do local ou null), notes (copie um trecho relevante de "detail", ou null).
Inclua atividades sem hora. Preserve verbos da atividade como "buscar o carro". Se houver local, separe-o do título. Nunca transforme "detail" em outro item.
Exemplos:
{"event":"ortopedista","detail":"Tenho que sair de casa 14:30 para chegar lá na hora"} -> {"titleSpan":"ortopedista","category":"saude","location":null,"notes":"Sair de casa às 14:30"}
{"event":"café com Ana no Café Central","detail":""} -> {"titleSpan":"café com Ana","category":"pessoal","location":"Café Central","notes":null}
{"event":"ligar pro coordenador","detail":""} -> {"titleSpan":"ligar pro coordenador","category":"pessoal","location":null,"notes":null}`;

const extraction = z.object({
  items: z.array(z.object({
    titleSpan: z.string().trim().max(160).nullable(),
    category: z.enum(CATEGORIES),
    location: z.string().trim().max(160).nullable(),
    notes: z.string().trim().max(500).nullable(),
  }).strict()),
}).strict();

const weekdays = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const dayPattern = new RegExp(`\\b(?:${humanDatePattern}|dia \\d{1,2}(?![\\d/:h]))\\b`, 'g');
const hourPattern = /\b(?:\d{1,2}(?::\d{2}|h\d{2}|h)|(?:as|das)\s+\d{1,2}(?![\d:h]))\b/g;
const noteBoundary = /[.!;]\s+|,\s+(?=(?:tenho que|preciso)\s+(?:sair|levar|chegar))|\s+(?=(?:tenho que|preciso)\s+sair)/iu;
const atTime = /\s+e\s+(?=[^.;]*\b(?:\d{1,2}(?::\d{2}|h)|(?:às|as)\s+\d)\b)/iu;

export interface QuickBlock {
  text: string;
  eventText: string;
  date: string;
  time: string;
  endTime: string;
  rrule: string | null;
}

function resolveDate(span: string, now: string): string | null {
  if (!span.startsWith('dia ')) return resolveHumanDate(span, now);
  const base = now.slice(0, 10);
  const day = span.slice(4).padStart(2, '0');
  const month = day >= base.slice(8) ? base : addDays(endOfMonth(base), 1);
  const candidate = `${month.slice(0, 7)}-${day}`;
  return wallMoment.safeParse(`${candidate}T00:00`).success ? candidate : null;
}

export function quickBlocks(input: string, now: string): { blocks: QuickBlock[] } | { question: string } {
  const text = normalizeText(input);
  if (isEventChangeRequest(input) || planningRead(input) || /\b(?:nao|nunca|talvez|ignore)\b|^se\b/.test(text)) {
    return { question: 'Qual novo compromisso você quer adicionar?' };
  }
  if (/\b(?:quinzenal\w*|anual\w*|mensal\w*|dias uteis|a cada|todo mes)\b/.test(text)
    || weeklyRepeatHasConstraint(text)) return { question: 'Qual é a repetição exata? Você também pode defini-la no formulário de novo compromisso.' };

  const parts = input.split(/\s*(?:[.;]\s*)?(?:\s+e\s+depois\s+|\s+e\s+tamb[eé]m\s+|;\s+|[.!]\s+(?=(?:depois|tamb[eé]m)\s+))/iu)
    .flatMap((part) => {
      const boundary = part.search(noteBoundary);
      const main = boundary < 0 ? part : part.slice(0, boundary);
      const candidate = main.search(atTime);
      const left = normalizeText(main.slice(0, candidate));
      const split = candidate >= 0 && !/\bentre\b/.test(left) && !/\d(?:h\d*|:\d{2})$/.test(left)
        && [...left.matchAll(hourPattern)].length ? main.split(atTime) : [main];
      split[split.length - 1] += boundary < 0 ? '' : part.slice(boundary);
      return split;
    });
  if (parts.length > 5) return { question: 'Envie até cinco compromissos por mensagem.' };

  const blocks: QuickBlock[] = [];
  for (const part of parts) {
    const eventText = part.trim().replace(/^(?:depois(?!\s+de\b)|tamb[eé]m)\s+/iu, '').split(noteBoundary)[0]!.trim();
    const event = expandWeekdayAliases(eventText).replace(/\bquita(?=[ -]feira\b)/g, 'quinta');
    const spans = [...event.matchAll(dayPattern)].map((match) => match[0]);
    const dates = spans.map((span) => resolveDate(span, now));
    if (dates.includes(null)) return { question: 'Qual é a data válida do compromisso?' };
    const days = [...new Set(spans.map((span) => weekdays.indexOf(span.split(/[- ]/)[0]!)).filter((day) => day >= 0))].sort((a, b) => a - b);
    const daily = /\btodos? (?:os )?dias?\b/.test(event);
    const weekly = days.length > 1 || explicitWeeklyRepeat(event) || /\btodas? (?:as )?(?:domingo|segunda|terca|quarta|quinta|sexta|sabado)\b/.test(event);
    if (new Set(dates).size > 1 && (!weekly || days.length !== spans.length)) return { question: 'Qual dia devo usar para cada compromisso?' };
    const date = dates.filter((day): day is string => day !== null).sort()[0]
      ?? blocks.at(-1)?.date ?? (daily ? now.slice(0, 10) : '');
    const rrule = daily ? 'FREQ=DAILY' : weekly && date
      ? formatRrule({ freq: 'WEEKLY', interval: 1, byday: days.length ? days : [weekday(date)] }) : null;
    const withoutDates = event.replace(dayPattern, ' ');
    const ranges = humanRangesIn(withoutDates);
    const hours = [...withoutDates.matchAll(hourPattern)].map((match) => match[0]);
    const range = ranges.length === 1 ? humanTimeRange(ranges[0]!) : null;
    const single = hours.length === 1 ? parseChangeTime(hours[0]!.replace(/^(?:as|das)\s+/, '')) : null;
    if (ranges.length > 1 || (ranges.length && !range) || (!range && hours.length > 1)
      || (range && hours.length > 2) || (hours.length === 1 && !single && !range)) {
      return { question: 'Qual é o horário correto de cada compromisso? Confira o início e o fim.' };
    }
    const time = range?.start ?? single?.start ?? '';
    const endTime = range?.end ?? (time ? timeOf(addMinutes(`2000-01-01T${time}`, 60)) ?? '' : '');
    if (time && endTime <= time) return { question: 'Qual é o horário de fim antes da meia-noite?' };
    if (date && time && !timedEvent.safeParse({ title: 'Proposta', start: `${date}T${time}`, end: `${date}T${endTime}` }).success) {
      return { question: 'Confira a data e os horários do compromisso.' };
    }
    blocks.push({ text: part.trim(), eventText, date, time, endTime, rrule });
  }
  return { blocks };
}

// Retira apenas marcadores já tratados pelo código. O modelo recebe o texto restante
// e os detalhes em campos separados, sem acesso à agenda.
function eventHint(text: string) {
  const plain = normalizeText(text);
  const markers = [
    ...plain.matchAll(new RegExp(`\\b(?:${humanDatePattern}|dia \\d{1,2}|seg|ter|qua|qui|sex|sab|dom|quita[ -]feira)\\b`, 'g')),
    ...plain.matchAll(hourPattern),
    ...plain.matchAll(/\b(?:todos? (?:os )?dias?|todas?(?: as)?|(?:a|de) (?:noite|tarde|manha)|semanalmente)\b/g),
  ];
  // Marca os intervalos no original para preservar acentos e a grafia do título.
  const remove = new Set<number>();
  for (const match of markers) {
    for (let i = match.index; i < match.index + match[0].length; i++) remove.add(i);
  }
  return text.split('').map((char, index) => remove.has(index) ? ' ' : char).join('')
    .replace(/^(?:(?:quero|preciso)\s+)?(?:marcar|agendar|marque|agende|reserva|reserve|coloca|coloque|anota(?: aí)?|anote)(?=[,:\s]|$)[,: ]*/iu, '')
    .replace(/(?:^|\s)(?:às|as|das|até|ate|para)(?=\s|$)/giu, ' ')
    .replace(/^[\s,;:.–-]+|[\s,;:.–-]+$/g, '')
    .replace(/^(?:o|a|um|uma|no|na|de)\s+/iu, '')
    .replace(/^(?:[–-]|a|e)\s+/iu, '')
    .replace(/\s+/g, ' ').trim();
}

export function quickModelInput(blocks: QuickBlock[]) {
  return blocks.map(({ text, eventText }) => ({
    event: eventHint(eventText) || eventText,
    detail: text.slice(text.indexOf(eventText) + eventText.length).replace(/^[.!,;\s]+/, '').trim(),
  }));
}

export function quickNotes(detail: string, proposed: string | null): string | null {
  const departure = /\bsair de casa\s+(?:[àa]s\s+)?(\d{1,2}:\d{2}|\d{1,2}h(?:\d{2})?)/iu.exec(detail);
  if (departure) return `Sair de casa às ${departure[1]}`;
  const note = proposed && normalizeText(detail).includes(normalizeText(proposed)) ? proposed : detail;
  return note.slice(0, 500).trim() || null;
}

export function applyQuickExtraction(raw: unknown, blocks: QuickBlock[]): QuickDraft[] | null {
  const result = extraction.safeParse(raw);
  if (!result.success || result.data.items.length !== blocks.length) return null;
  const drafts: QuickDraft[] = [];
  const modelInput = quickModelInput(blocks);
  for (const [index, item] of result.data.items.entries()) {
    const block = blocks[index]!;
    const fields = modelInput[index]!;
    const location = item.location && normalizeText(block.eventText).includes(normalizeText(item.location)) ? item.location : null;
    const rawTitle = item.titleSpan?.replace(/^(?:o|a|um|uma)\s+/iu, '') ?? null;
    const titleWithoutLocation = location && rawTitle?.endsWith(location)
      ? rawTitle.slice(0, -location.length).replace(/\s+(?:em|no|na|ao|à)\s*$/iu, '').trim()
      : rawTitle;
    const title = groundedTitle({ titleSpan: titleWithoutLocation }, block.eventText, true);
    if (!title) return null;
    drafts.push({ title, date: block.date, time: block.time, endTime: block.endTime,
      rrule: block.rrule, category: item.category, location, notes: quickNotes(fields.detail, fields.detail ? item.notes : null) });
  }
  return drafts;
}
