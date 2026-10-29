import { addDays, startOfWeek, weekday, formatDateBR } from '../../shared/dates.js';
import type { AgendaQuery } from '../../shared/agent.js';
import { wallMoment } from './request.js';

export interface AgendaItem { id: string; title: string; start: string; end: string; allDay: boolean }
export type QueryInterpretation = { kind: 'query'; query: AgendaQuery; title?: string; followup: boolean }
  | { kind: 'clarify'; message: string; title?: string };
export const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const weekdays = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const abbreviations: Record<string, number> = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };
const periods = {
  early: { word: 'madrugada', start: '00:00', end: '06:00', label: 'de madrugada (00h às 06h)' },
  morning: { word: 'manha', start: '06:00', end: '12:00', label: 'pela manhã (06h às 12h)' },
  afternoon: { word: 'tarde', start: '12:00', end: '18:00', label: 'à tarde (12h às 18h)' },
  evening: { word: 'noite', start: '18:00', end: '24:00', label: 'à noite (18h às 24h)' },
  day: { word: 'dia inteiro', start: '00:00', end: '24:00', label: 'no dia inteiro' },
} as const;

function oneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (a.length - i) + (b.length - j) === 1;
}
function dayName(date: string): string {
  const index = weekday(date);
  return `${weekdays[index]}${index >= 1 && index <= 5 ? '-feira' : ''} (${formatDateBR(date)})`;
}
function time(value: string): string | null {
  const match = /^(\d{1,2})(?:[:h](\d{2}))?h?$/.exec(value);
  return match && Number(match[1]) < 24 && Number(match[2] ?? 0) < 60
    ? `${match[1]!.padStart(2, '0')}:${(match[2] ?? '00').padStart(2, '0')}` : null;
}
/** Só aceita um intervalo completo, sem instruções extras ou horários deduzidos. */
export function explicitTimeRange(input: string): { start: string; end: string } | null {
  const text = normalize(input).replace(/[.!]$/, '');
  const token = '(\\d{1,2}(?::\\d{2}|h\\d{2}|h)?)';
  const match = new RegExp(`^(?:das|de)\\s+${token}\\s*(?:as|ate|-)\\s*${token}$`).exec(text)
    ?? new RegExp(`^${token}\\s*(?:as|ate|-)\\s*${token}$`).exec(text);
  if (!match) return null;
  const start = time(match[1]!), end = time(match[2]!);
  return start && end && end > start ? { start, end } : null;
}

export function interpretAgendaQuery(raw: string, now: string, previous?: AgendaQuery): QueryInterpretation | null {
  const text = normalize(raw);
  const planning = /^(?:(?:quero|queria|pretendo|preciso|vou|posso)\s+|gostaria de\s+)(?:marcar|agendar|reservar|organizar)\s+/.exec(text);
  const agendaWords = /\b(agenda|compromissos?|eventos?|marcad[oa]s?|agendad[oa]s?|disponibilidade|disponivel|livre|ocupad[oa])\b|\bo que (?:eu )?tenho\b|\bmeu dia\b|^(?:como (?:esta|vai|sera)|mostre|resuma|ver)\b.*\bsemana\b|^(?:minha|esta|essa|proxima) semana[.!?]?$/;
  const temporal = /\b(hoje|amanha|semana|feira|dia|manha|tarde|noite|madrugada|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}/.test(text);
  const followup = Boolean(previous) && (temporal || agendaWords.test(text)) && /^(e\b|na\b|no\b|nesse\b|neste\b|pela\b|de\b|amanha\b|hoje\b|segunda\b|terca\b|quarta\b|quinta\b|sexta\b|sabado\b|domingo\b)/.test(text);
  if (!planning && !agendaWords.test(text) && !followup) return null;

  let title: string | undefined;
  if (planning) {
    const remainder = raw.trim().slice(planning[0].length).replace(/^(um|uma|o|a)\s+/i, '');
    title = remainder.split(/\s+(?:(?:das|de|[àa]s)\s+\d|(?:na|no|para|pra|hoje|amanh[ãa]|segunda|ter[cç]a|quarta|quinta|quita|sexta|s[aá]bado|domingo)\b|\d{1,2}\/|\d{4}-)|[.!?]/iu)[0]?.trim();
    if (title) title = title[0]!.toUpperCase() + title.slice(1);
  }
  const clarify = (message: string): QueryInterpretation => ({ kind: 'clarify', message, title });
  const base = now.slice(0, 10);
  const dates = new Set<string>();
  const week = /\b(?:semana que vem|proxima semana)\b/.test(text) ? addDays(startOfWeek(base), 7)
    : /\b(?:esta semana|essa semana|nesta semana|nessa semana|minha semana|a semana)\b/.test(text) || /\bsemana[.!?]?$/.test(text) ? startOfWeek(base) : undefined;
  for (const match of text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b|\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g)) {
    const date = match[1] ?? `${match[4] ?? base.slice(0, 4)}-${match[3]!.padStart(2, '0')}-${match[2]!.padStart(2, '0')}`;
    if (!wallMoment.safeParse(`${date}T00:00`).success) return clarify('Essa data não é válida. Qual dia você quer consultar?');
    dates.add(date);
  }
  for (const match of text.matchAll(/\b(depois de amanha|anteontem|amanha|ontem|hoje)\b/g)) {
    const delta: Record<string, number> = { 'depois de amanha': 2, anteontem: -2, amanha: 1, ontem: -1, hoje: 0 };
    dates.add(addDays(base, delta[match[1]!]!));
  }
  const mentioned = new Set<number>();
  let correction: string | undefined;
  for (const token of text.matchAll(/\b[a-z]+\b/g)) {
    let index = weekdays.indexOf(token[0]);
    if (index < 0 && !/\b(?:vou|vai|posso|pode|devo|preciso)\s*$/.test(text.slice(0, token.index))) index = abbreviations[token[0]] ?? -1;
    // Corrige uma letra somente em contexto de dia da semana, sem transformar "segundo" em segunda.
    if (index < 0 && token[0].length >= 5) {
      const before = text.slice(0, token.index);
      const after = text.slice(token.index! + token[0].length);
      if (/^[-\s]+feira\b/.test(after) || (['quita', 'qinta', 'qarta', 'seguda'].includes(token[0]) && /\b(?:na|no|nesta|nessa|proxima|dia)\s*$/.test(before))) {
        const candidates = weekdays.map((name, i) => oneEdit(token[0], name) ? i : -1).filter((i) => i >= 0);
        if (candidates.length === 1) { index = candidates[0]!; correction = `Interpretei “${token[0]}” como ${weekdays[index]}.`; }
      }
    }
    if (index >= 0) mentioned.add(index);
  }
  for (const index of mentioned) {
    let date: string;
    if (week) date = addDays(week, (index + 6) % 7);
    else if (/\bpassad[ao]\b/.test(text)) {
      const back = (weekday(base) - index + 7) % 7;
      date = addDays(base, -(back || 7));
    } else {
      const anchor = followup ? previous!.from : base;
      let delta = (index - weekday(anchor) + 7) % 7;
      if (delta === 0 && /\b(?:proxima|que vem)\b/.test(text)) delta = 7;
      date = addDays(anchor, delta);
    }
    dates.add(date);
  }
  if (dates.size > 1) return clarify('Você mencionou mais de um dia. Qual deles quer consultar primeiro?');
  if (!dates.size && !week && /\b(feriado|ferias|natal|carnaval|pascoa|mes|ano|daqui a)\b/.test(text)) return clarify('Qual é a data que você quer consultar? Pode informar um dia da semana ou uma data completa.');
  if (!dates.size && /\b(?:quinta|quarta|segunda|terca|sexta|sabado|domingo|feira|dia|amanha)\b/.test(text)
    && !week && !/meu dia|hoje|dia inteiro|nesse dia|neste dia/.test(text)) return clarify('Não consegui identificar a data com segurança. Qual dia você quer consultar?');
  const dateExplicit = dates.size > 0 || Boolean(week);
  const from = [...dates][0] ?? (week || (followup ? previous?.from : undefined) || base);
  const to = dates.size ? from : week ? addDays(week, 6) : followup ? previous?.to ?? from : from;
  const selectedPeriods = Object.entries(periods).filter(([, value]) => new RegExp(`\\b${value.word}\\b`).test(text));
  if (selectedPeriods.length > 1) return clarify('Qual período você quer consultar: manhã, tarde, noite ou dia inteiro?');
  const selected = selectedPeriods[0]?.[0] as keyof typeof periods | undefined;
  const period = selected ?? (followup ? previous?.period : undefined) ?? 'day';
  const range = periods[period];
  const dateLabel = from === to ? dayName(from) : `${formatDateBR(from)} a ${formatDateBR(to)}`;
  const timeToken = '(\\d{1,2}(?::\\d{2}|h\\d{2}|h)?)';
  const clockRange = new RegExp(`\\b(?:das|de)\\s+${timeToken}\\s*(?:as|ate|-)\\s*${timeToken}\\b`).exec(text);
  if (clockRange) {
    const start = time(clockRange[1]!), end = time(clockRange[2]!);
    if (!start || !end || end <= start) return clarify('Qual é o intervalo de horário? Se atravessa a meia-noite, informe também a data final.');
    if (selected && (start < range.start || end > range.end)) return clarify(`O intervalo informado está fora do período ${range.label}. Qual período você quer consultar?`);
    return { kind: 'query', title, followup, query: { from, to, startTime: start, endTime: end,
      dateExplicit, correction, label: `${dateLabel}, das ${start} às ${end}` } };
  }
  const clockPoint = /\b(?:as|a)\s+(\d{1,2}(?::\d{2}|h\d{2}|h)?)\b/.exec(text)
    ?? /\b(\d{1,2}(?:h\d{2}|h|:\d{2}))\b/.exec(text);
  if (clockPoint) {
    const point = time(clockPoint[1]!);
    if (!point) return clarify('Qual horário você quer consultar? Use um horário entre 00:00 e 23:59.');
    if (selected && (point < range.start || point >= range.end)) return clarify(`O horário ${point} está fora do período ${range.label}. Qual dos dois você quer consultar?`);
    return { kind: 'query', title, followup, query: { from, to, startTime: point, endTime: point, pointTime: point,
      dateExplicit, correction, label: `${dateLabel}, às ${point}` } };
  }
  if (followup && !selected && previous && !previous.period) {
    return { kind: 'query', title, followup, query: { ...previous, from, to, dateExplicit, correction,
      label: previous.pointTime ? `${dateLabel}, às ${previous.pointTime}` : `${dateLabel}, das ${previous.startTime} às ${previous.endTime}` } };
  }
  return { kind: 'query', title, followup, query: { from, to, startTime: range.start, endTime: range.end, period,
    dateExplicit: dateExplicit || Boolean(followup && previous?.dateExplicit), correction,
    label: `${dateLabel}, ${range.label}` } };
}

export function eventsForQuery(events: AgendaItem[], query: AgendaQuery): AgendaItem[] {
  return events.filter((event) => {
    for (let day = query.from; day <= query.to; day = addDays(day, 1)) {
      const start = `${day}T${query.startTime}`;
      const end = query.endTime === '24:00' ? `${addDays(day, 1)}T00:00` : `${day}T${query.endTime}`;
      if (event.allDay ? event.start.slice(0, 10) <= day && event.end.slice(0, 10) >= day
        : query.pointTime ? event.start <= start && start < event.end : event.start < end && start < event.end) return true;
    }
    return false;
  }).sort((a, b) => a.start.localeCompare(b.start));
}
