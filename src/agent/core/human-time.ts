import { addDays, weekday, startOfWeek } from '../../shared/dates.js';
import { wallMoment } from './time-contract.js';

export const normalizeText = (input: string) => input.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
export const weekdayAliases: Record<string, string> = { seg: 'segunda', ter: 'terca', qua: 'quarta', qui: 'quinta', sex: 'sexta', sab: 'sabado', dom: 'domingo' };
/** Usado em blocos de agenda e campos de dia, sem reescrever títulos de memória. */
export const expandWeekdayAliases = (input: string) => normalizeText(input).replace(/\b(seg|ter|qua|qui|sex|sab|dom)\b\.?/g, (word) => weekdayAliases[word.replace('.', '')]!);
export const explicitWeeklyRepeat = (input: string) => /\b(?:todas as semanas|toda semana|todas semanas|semanalmente|semanal|sempre)\b/.test(normalizeText(input));
export const weeklyRepeatHasConstraint = (input: string) => /\b(?:uma vez|somente nesta semana|apenas nesta semana|sempre que|ate o dia|ate dia)\b/.test(normalizeText(input));
export const humanDatePattern = '(?:depois de amanha|hoje|amanha|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}(?:/\\d{4})?|(?:domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:[- ]feira)?(?:\\s+(?:que vem|(?:da |na )?(?:proxima|esta|essa) semana))?)';
const hourPattern = '(\\d{1,2}(?::\\d{2}|h\\d{2}|h)?)';
const rangeSource = `(?:(?:das|de|entre)\\s+(?:as\\s+)?)?${hourPattern}\\s*(?:as|a|ate|e|-)\\s*(?:as\\s+)?${hourPattern}`;
function time(raw: string): string | null {
  const match = /^(\d{1,2})(?:[:h](\d{2}))?h?$/.exec(raw);
  return match && Number(match[1]) < 24 && Number(match[2] ?? 0) < 60 ? `${match[1]!.padStart(2, '0')}:${(match[2] ?? '00').padStart(2, '0')}` : null;
}
export function humanTimeRange(raw: string): { start: string; end: string } | null {
  const match = new RegExp(`^${rangeSource}[.!]?$`).exec(normalizeText(raw));
  if (!match) return null;
  const start = time(match[1]!), end = time(match[2]!);
  return start && end && end > start ? { start, end } : null;
}
export function humanRangesIn(input: string): string[] {
  const text = normalizeText(input);
  const dates = [...text.matchAll(new RegExp(`\\b${humanDatePattern}\\b`, 'g'))];
  return [...text.matchAll(new RegExp(`\\b${rangeSource}(?![\\d:])`, 'g'))]
    .filter((range) => !dates.some((date) => range.index! >= date.index! && range.index! < date.index! + date[0].length))
    .map((range) => range[0]);
}
export function resolveHumanDate(raw: string, now: string): string | null {
  const text = normalizeText(raw), base = now.slice(0, 10);
  const relative: Record<string, number> = { hoje: 0, amanha: 1, 'depois de amanha': 2 };
  let date: string;
  if (Object.hasOwn(relative, text)) date = addDays(base, relative[text]!);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(text)) date = text;
  else {
    const br = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(text);
    if (br) date = `${br[3] ?? base.slice(0, 4)}-${br[2]!.padStart(2, '0')}-${br[1]!.padStart(2, '0')}`;
    else {
      const match = /^(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:[- ]feira)?(?:\s+(que vem|(?:da |na )?(?:proxima|esta|essa) semana))?$/.exec(text);
      if (!match) return null;
      const index = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'].indexOf(match[1]!);
      date = match[2]?.includes('semana') ? addDays(startOfWeek(base), (match[2].includes('proxima') ? 7 : 0) + (index + 6) % 7)
        : addDays(base, ((index - weekday(base) + 7) % 7) || (match[2] ? 7 : 0));
    }
  }
  return wallMoment.safeParse(`${date}T00:00`).success ? date : null;
}
export const schedulingIntent = (input: string) => /\b(?:marcar|marque|agendar|agende|registre|registrar|salve|salvar|colocar|coloca|coloque|anota|anote|reservar|reserva|reserve|inclua|incluir)\b/.test(normalizeText(input));

export function groundedSchedule(input: string, now: string): { date: string; start: string; end: string } | { ask: string } | null {
  if (!schedulingIntent(input)) return null;
  const text = normalizeText(input);
  if (/\b(?:nao|nunca|talvez|se)\b/.test(text)) return { ask: 'O pedido tem uma negação ou condição. Não preparei nenhum registro. Diga o que deseja marcar quando estiver decidido.' };
  const dateMatches = [...text.matchAll(new RegExp(`\\b${humanDatePattern}\\b`, 'g'))];
  const dates = dateMatches.map((match) => resolveHumanDate(match[0], now));
  if (dates.some((value) => !value)) return { ask: 'A data informada não é válida. Qual é o dia correto?' };
  if (!dates.length || new Set(dates).size !== 1) return { ask: 'Preciso de um único dia identificado para esse compromisso. Qual é a data?' };
  const ranges = [...text.matchAll(new RegExp(`\\b${rangeSource}(?![\\d:])`, 'g'))].filter((range) => !dateMatches.some((date) => range.index! >= date.index! && range.index! < date.index! + date[0].length));
  if (ranges.length !== 1) return { ask: 'Preciso de um intervalo completo de início e fim para cada compromisso. Informe um bloco por vez ou os blocos de um plano semanal.' };
  const range = humanTimeRange(ranges[0]![0]);
  if (!range) return { ask: 'Informe horários válidos, com o fim depois do início. Nenhuma alteração foi feita.' };
  // Uma extração simples não pode executar apenas parte de um pedido composto.
  if (/\b(?:apague|exclua|remova|mova|troque|cancele|ignore|depois|tambem)\b/.test(text)) return { ask: 'Esse pedido contém outras instruções. Preciso revisar o conjunto completo antes de preparar qualquer alteração.' };
  return { date: dates[0]!, ...range };
}
