import { z } from 'zod';
import { addDays, addMinutes, endOfMonth, startOfWeek, timeOf, weekday } from '../../shared/dates.js';
import { formatRrule } from '../../shared/recurrence.js';
import { CATEGORIES } from '../../shared/types.js';
import type { QuickDraft } from '../../shared/quick-add.js';
import { planningRead } from './assisted-plan.js';
import { isEventChangeRequest, parseChangeTime } from './event-change.js';
import { expandWeekdayAliases, explicitWeeklyRepeat, humanDatePattern, normalizeText, resolveHumanDate, weeklyRepeatHasConstraint } from './human-time.js';
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
const weekdaySource = '(?:domingo|segunda|terca|quarta|quinta|quita|sexta|sabado|seg|ter|qua|qui|sex|sab|dom)(?:[- ]feira)?';
const weekSource = 'semana que vem|(?:na |da )?proxima semana';
const dayPattern = new RegExp(`\\b(?:proxima ${weekdaySource}|${humanDatePattern}|dia \\d{1,2}(?![\\d/:h])(?: do mes que vem)?|${weekdaySource})\\b`, 'g');
const clock = '(?:meio-dia|meia-noite|\\d{1,2}(?::\\d{2}|h\\d{2}|h)?(?: e (?:meia|\\d{1,2}))?(?: (?:da|de) (?:manha|tarde|noite))?)';
const rangePattern = new RegExp(`\\b(?:(?:das|de|entre)\\s+(?:as\\s+)?)?(${clock})\\s*(as|ao|ate|a|e|-)\\s*(?:as\\s+)?(${clock})\\b(?![\\d:])`, 'g');
const approximateClock = '(?:da|de) (?:manha|tarde|noite) (?:umas? )?' + clock;
const hourPattern = new RegExp(`\\b(?:(?:as|ao|a)\\s+${clock}|${approximateClock}|meio-dia|meia-noite|\\d{1,2}(?::\\d{2}|h\\d{2}|h)(?: (?:da|de) (?:manha|tarde|noite))?|\\d{1,2}(?: e (?:meia|\\d{1,2}))? (?:da|de) (?:manha|tarde|noite))\\b(?![\\d:])`, 'g');
const durationAmounts: Record<string, number> = { uma: 1, duas: 2, tres: 3, quatro: 4, meia: 0.5 };
const durationPattern = /\b(?:por|(?:deve )?levar) (?:umas? )?(\d+|uma|duas|tres|quatro|meia) (horas?|minutos?)\b/g;

function spokenTime(raw: string): string | undefined {
  const value = raw.replace(/^(?:as|ao|a)\s+/, '')
    .replace(/^(?:da|de) (manha|tarde|noite) (?:umas? )?(.+)$/, '$2 da $1');
  if (value === 'meio-dia') return '12:00';
  if (value === 'meia-noite') return '00:00';
  const match = /^(\d{1,2})(?:[:h](\d{2})|h)?(?: e (meia|\d{1,2}))?(?: (?:da|de) (manha|tarde|noite))?$/.exec(value);
  if (!match) return;
  let hour = Number(match[1]);
  const minutes = match[2] ?? (match[3] === 'meia' ? '30' : match[3] ?? '00');
  if (match[4] && (hour < 1 || hour > 12)) return;
  if (match[4] === 'manha' && hour === 12) hour = 0;
  if ((match[4] === 'tarde' || match[4] === 'noite') && hour < 12) hour += 12;
  return parseChangeTime(`${hour}:${minutes.padStart(2, '0')}`)?.start;
}

function timeSpans(event: string) {
  const ranges = [...event.matchAll(rangePattern)].filter((match) =>
    // "às 9 e 15" é um horário, e "9h e 15h" pode separar compromissos.
    match[2] !== 'e' || match[0].startsWith('entre '));
  const hours = [...event.matchAll(hourPattern)].filter((hour) =>
    !ranges.some((range) => hour.index >= range.index && hour.index < range.index + range[0].length));
  return { ranges, hours };
}

const weekdayList = `${weekdaySource}(?:(?:\\s*,\\s*|\\s+e\\s+|\\s+)${weekdaySource})*`;
const weekdayRange = new RegExp(`\\bde (${weekdaySource}) (?:a|ate) (${weekdaySource})\\b`, 'g');
const weekdaySchedule = `${weekdayList}\\s+das\\s+${clock}\\s+(?:as|ao|ate|a)\\s+${clock}`;
const sharedWeekdays = new RegExp(`^(.+?)\\s+(${weekdaySchedule}(?:\\s+e\\s+${weekdaySchedule})+)[.!]?$`);
const weekdaySchedules = new RegExp(weekdaySchedule, 'g');

function weekdayIndex(span: string) {
  return weekdays.indexOf(expandWeekdayAliases(span).replace(/^proxima /, '').replace(/^quita\b/, 'quinta').split(/[- ]/)[0]!);
}
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
  if (span.startsWith('proxima ')) return resolveHumanDate(`${span.slice(8)} que vem`, now);
  if (!span.startsWith('dia ')) return resolveHumanDate(span, now);
  const base = now.slice(0, 10);
  const day = span.split(' ')[1]!.padStart(2, '0');
  const month = !span.endsWith('mes que vem') && day >= base.slice(8) ? base : addDays(endOfMonth(base), 1);
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

  const shared = sharedWeekdays.exec(text);
  const original = input.trim();
  const sharedParts = shared
    ? [...shared[2]!.matchAll(weekdaySchedules)].map((group) => {
      const offset = text.indexOf(shared[2]!, shared[1]!.length) + group.index;
      return `${original.slice(0, shared[1]!.length)} ${original.slice(offset, offset + group[0].length)}`;
    })
    : [input];
  const parts = sharedParts.flatMap((entry) => entry.split(/\s*(?:[.;]\s*)?(?:\s+e\s+depois\s+|\s+e\s+tamb[eé]m\s+|;\s+|[.!]\s+(?=(?:depois|tamb[eé]m)\s+))/iu))
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
    if (/\bfim de semana\b/.test(event)) return { question: 'Qual dia do fim de semana, sábado ou domingo?' };
    const daily = /\btodos? (?:os )?dias?\b/.test(event);
    const clean = event.replace(/\btodos? (?:os )?dias?\b/g, ' ');
    const nextWeek = new RegExp(`\\b(?:${weekSource})\\b`).test(clean);
    const spans = [...clean.matchAll(dayPattern)].map((match) => match[0]);
    const days = new Set(spans.map(weekdayIndex).filter((day) => day >= 0));
    for (const [, first, last] of clean.matchAll(weekdayRange)) {
      const start = weekdayIndex(first!), end = weekdayIndex(last!);
      for (let day = start; day !== end; day = (day + 1) % 7) days.add(day);
    }
    if (nextWeek && days.size !== 1) return { question: 'Qual dia da próxima semana?' };
    const dates = spans.map((span) => nextWeek && weekdayIndex(span) >= 0
      ? addDays(startOfWeek(now.slice(0, 10)), 7 + (weekdayIndex(span) + 6) % 7) : resolveDate(span, now));
    if ([...clean.matchAll(weekdayRange)].length) {
      for (const day of days) dates.push(addDays(now.slice(0, 10), (day - weekday(now.slice(0, 10)) + 7) % 7));
    }
    if (dates.includes(null)) return { question: 'Qual é a data válida do compromisso?' };
    const weekly = !nextWeek && (Boolean(shared) || days.size > 1 || explicitWeeklyRepeat(event)
      || /\btodas? (?:as )?(?:domingo|segunda|terca|quarta|quinta|sexta|sabado)\b/.test(event));
    if (new Set(dates).size > 1 && (!weekly || spans.some((span) => weekdayIndex(span) < 0))) {
      return { question: 'Qual dia devo usar para cada compromisso?' };
    }
    const date = dates.filter((day): day is string => day !== null).sort()[0]
      ?? blocks.at(-1)?.date ?? (daily ? now.slice(0, 10) : '');
    const rrule = daily ? 'FREQ=DAILY' : weekly && date
      ? formatRrule({ freq: 'WEEKLY', interval: 1, byday: days.size ? [...days].sort((a, b) => a - b) : [weekday(date)] }) : null;
    const withoutDates = clean.replace(dayPattern, ' ');
    const durations = [...withoutDates.matchAll(durationPattern)];
    const { ranges, hours } = timeSpans(withoutDates.replace(durationPattern, ' '));
    const range = ranges[0];
    const start = range?.[1] ?? hours[0]?.[0];
    const time = start ? spokenTime(start) ?? '' : '';
    const duration = durations[0];
    const count = duration ? (durationAmounts[duration[1]!] ?? Number(duration[1])) : 1;
    const minutes = count * (duration?.[2]?.startsWith('minuto') ? 1 : 60);
    if (ranges.length + hours.length > 1 || durations.length > 1 || (range && duration)
      || (start && !time) || !Number.isInteger(minutes) || minutes <= 0 || minutes >= 1440) {
      return { question: 'Qual é o horário correto de cada compromisso? Confira o início e o fim.' };
    }
    const endTime = range ? spokenTime(range[3]!) ?? '' : time ? timeOf(addMinutes(`2000-01-01T${time}`, minutes)) ?? '' : '';
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
export function eventHint(text: string) {
  const plain = normalizeText(text);
  const dailyMarkers = [...plain.matchAll(/\btodos? (?:os )?dias?\b/g)];
  const calendar = plain.replace(/\btodos? (?:os )?dias?\b/g, (match) => ' '.repeat(match.length));
  const dateMarkers = [
    ...calendar.matchAll(weekdayRange),
    ...calendar.matchAll(new RegExp(`\\b${weekdayList}\\b`, 'g')),
    ...calendar.matchAll(new RegExp(`\\b(?:(?:na|no|para)\\s+)?(?:${dayPattern.source.replace(/^\\b|\\b$/g, '')}|${weekSource})\\b`, 'g')),
    ...dailyMarkers,
  ];
  const withoutDates = plain.split('').map((char, index) => dateMarkers.some((match) =>
    index >= match.index && index < match.index + match[0].length) ? ' ' : char).join('');
  const { ranges, hours } = timeSpans(withoutDates);
  const markers = [
    ...dateMarkers, ...ranges, ...hours, ...plain.matchAll(durationPattern),
    ...plain.matchAll(/\b(?:todas?(?: as)?|(?:a|de) (?:noite|tarde|manha)|semanalmente)\b/g),
  ];
  // Marca os intervalos no original para preservar acentos e a grafia do título.
  const remove = new Set<number>();
  for (const match of markers) {
    for (let i = match.index; i < match.index + match[0].length; i++) remove.add(i);
  }
  return text.split('').map((char, index) => remove.has(index) ? ' ' : char).join('')
    .trimStart()
    .replace(/^(?:(?:quero|preciso)\s+)?(?:marcar|marca|agendar|marque|agende|reserva|reserve|coloca|coloque|anota(?: aí)?|anote)(?=[,:\s]|$)[,: ]*(?:(?:pra|para) mim\s+)?/iu, '')
    .replace(/^\s*(?:tenho(?: que)?|preciso)\s+/iu, '')
    .replace(/(?:^|\s)(?:às|as|das|até|ate|para)(?=\s|$)/giu, ' ')
    .replace(/\s+(?:e|de)\s*(?=[,;.]*$)/iu, '')
    .replace(/^[\s,;:.–-]+|[\s,;:.–-]+$/g, '')
    .replace(/^(?:o|a|um|uma|no|na|de)\s+/iu, '')
    .replace(/^(?:[–-]|a|e)\s+/iu, '')
    .replace(/\s+/g, ' ').trim();
}

function modelFields({ text, eventText }: QuickBlock) {
  return {
    event: eventHint(eventText) || eventText,
    detail: text.slice(text.indexOf(eventText) + eventText.length).replace(/^[.!,;\s]+/, '').trim(),
  };
}

function sameFields(a: ReturnType<typeof modelFields>, b: ReturnType<typeof modelFields>) {
  return a.event === b.event && a.detail === b.detail;
}

export function quickModelInput(blocks: QuickBlock[]) {
  const fields = blocks.map(modelFields);
  return fields.filter((field, index) => fields.findIndex((candidate) => sameFields(candidate, field)) === index);
}

export function quickNotes(detail: string, proposed: string | null): string | null {
  const departure = /\bsair de casa\s+(?:[àa]s\s+)?(\d{1,2}:\d{2}|\d{1,2}h(?:\d{2})?)/iu.exec(detail);
  if (departure) return `Sair de casa às ${departure[1]}`;
  const note = proposed && normalizeText(detail).includes(normalizeText(proposed)) ? proposed : detail;
  return note.slice(0, 500).trim() || null;
}

export function applyQuickExtraction(raw: unknown, blocks: QuickBlock[]): QuickDraft[] | null {
  const result = extraction.safeParse(raw);
  const modelInput = quickModelInput(blocks);
  if (!result.success || result.data.items.length !== modelInput.length) return null;
  const drafts: QuickDraft[] = [];
  for (const block of blocks) {
    const fields = modelFields(block);
    const index = modelInput.findIndex((candidate) => sameFields(candidate, fields));
    const item = result.data.items[index]!;
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
