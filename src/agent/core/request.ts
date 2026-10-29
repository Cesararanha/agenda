import { z } from 'zod';
import { wallMoment } from './time-contract.js';
import { humanDatePattern, resolveHumanDate, humanTimeRange } from './human-time.js';
export { wallMoment } from './time-contract.js';
export const timedEvent = z.object({ title: z.string().trim().min(1).max(500), start: wallMoment, end: wallMoment })
  .strict().refine((event) => event.end > event.start, 'O fim precisa ser depois do início');
export type TimedEvent = z.infer<typeof timedEvent>;
export interface EventDraft { title: string; date?: string; startTime?: string; endTime?: string; mode?: 'create' | 'propose'; targetEventId?: string }

export const humanRequest = z.object({ requestId: z.string().min(1).max(128), input: z.string().trim().min(1).max(8000), now: wallMoment }).strict();

export type ParsedRequest =
  | { kind: 'create'; event: TimedEvent }
  | { kind: 'confirm'; suggestionId: string }
  | { kind: 'missing'; fields: string[]; draft?: EventDraft }
  | { kind: 'suggest' }
  | { kind: 'unsupported' };

const plain = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const hour = '(\\d{1,2}(?::\\d{2}|h\\d{2}|h)?)';

function time(value: string): string | null {
  const match = /^(\d{1,2})(?:[:h](\d{2}))?h?$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2] ?? 0) > 59) return null;
  return `${match[1]!.padStart(2, '0')}:${(match[2] ?? '00').padStart(2, '0')}`;
}

/** Gramática deliberadamente restrita. Nenhum horário padrão ou dado vindo do modelo. */
export function parseRequest(input: string, now: string): ParsedRequest {
  wallMoment.parse(now);
  const text = input.trim();
  const normalized = plain(text);
  const confirmation = /^confirmo\s+(?:a\s+)?sugest[ãa]o\s+([a-z0-9][a-z0-9_-]{0,127})(?:\s+(?:novamente|agora))?[.!]?$/iu.exec(text);
  if (confirmation) {
    return { kind: 'confirm', suggestionId: confirmation[1]! };
  }
  if (/^confirmo\b/.test(normalized)) return { kind: 'missing', fields: ['identificação exata da sugestão'] };
  if (/^sugira\b/.test(normalized)) return { kind: 'suggest' };
  if (!/^(salve|agende|registre|marque|crie|adicione)\s/.test(normalized)) return { kind: 'unsupported' };

  const command = new RegExp(`^(?:salve|agende|registre|marque|crie|adicione)\\s+(.+?)\\s+(?:(?:na|no|em|para|dia)\\s+)?(${humanDatePattern})(?:\\s+(.+))?$`, 'i').exec(normalized);
  if (!command) return { kind: 'missing', fields: ['título, data e intervalo explícito de início e fim'] };
  const [, normalizedTitle, day, rawRange] = command;
  const titleStart = normalized.indexOf(normalizedTitle!);
  const title = text.slice(titleStart, titleStart + normalizedTitle!.length);
  const date = resolveHumanDate(day!, now);
  if (!date) return { kind: 'missing', fields: ['data válida'] };
  if (!title || title.length > 500) return { kind: 'missing', fields: ['título de até 500 caracteres'] };
  const draft: EventDraft = { title, date, mode: 'create' };
  if (!rawRange) return { kind: 'missing', fields: ['horário de início', 'horário de fim'], draft };
  const single = new RegExp(`^(?:as|a partir das)\\s+${hour}[.!]?$`).exec(plain(rawRange));
  const startTime = single ? time(single[1]!) : null;
  if (startTime) return { kind: 'missing', fields: ['horário de fim'], draft: { ...draft, startTime } };
  const range = humanTimeRange(rawRange);
  if (!range) return { kind: 'missing', fields: ['intervalo explícito, por exemplo: das 15h às 16h'] };
  const start = range.start;
  const end = range.end;
  if (!start || !end) return { kind: 'missing', fields: ['horários válidos entre 00:00 e 23:59'] };
  const parsed = timedEvent.safeParse({ title, start: `${date}T${start}`, end: `${date}T${end}` });
  if (!parsed.success) return { kind: 'missing', fields: ['data válida e fim posterior ao início'] };
  return { kind: 'create', event: parsed.data };
}
