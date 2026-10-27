/**
 * Datas como string, sem fuso.
 * A agenda e de uma pessoa so, em Maceio: guardar hora de parede ('YYYY-MM-DDTHH:mm')
 * evita toda a dor de UTC, horario de verao e offset de servidor.
 * A aritmetica usa Date em UTC apenas como calculadora de dias.
 */
import type { DateStr, DateTimeStr } from './types.js';

const MS_DAY = 86_400_000;

export const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
export const WEEKDAY_LONG = [
  'domingo',
  'segunda',
  'terca',
  'quarta',
  'quinta',
  'sexta',
  'sabado',
];
export const MONTH_LONG = [
  'janeiro',
  'fevereiro',
  'marco',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

export function isDateStr(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function isDateTimeStr(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s);
}

/** Hoje no fuso informado, como 'YYYY-MM-DD'. */
export function today(tz = 'America/Maceio'): DateStr {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Agora no fuso informado, como 'YYYY-MM-DDTHH:mm'. */
export function now(tz = 'America/Maceio'): DateTimeStr {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  // 'en-CA' pode devolver hora 24 na virada; normaliza
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

export function dateOf(s: DateStr | DateTimeStr): DateStr {
  return s.slice(0, 10);
}

/** 'HH:mm' ou null quando e dia inteiro. */
export function timeOf(s: DateStr | DateTimeStr): string | null {
  return s.length >= 16 ? s.slice(11, 16) : null;
}

export function joinDateTime(date: DateStr, time: string | null): string {
  return time ? `${date}T${time}` : date;
}

function toUTC(date: DateStr): number {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms: number): DateStr {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: DateStr, n: number): DateStr {
  return fromUTC(toUTC(date) + n * MS_DAY);
}

export function diffDays(a: DateStr, b: DateStr): number {
  return Math.round((toUTC(a) - toUTC(b)) / MS_DAY);
}

/** 0 = domingo, 1 = segunda ... */
export function weekday(date: DateStr): number {
  return new Date(toUTC(date)).getUTCDay();
}

/** Segunda-feira da semana da data (a semana do Cesar comeca na segunda). */
export function startOfWeek(date: DateStr): DateStr {
  const wd = weekday(date);
  const back = wd === 0 ? 6 : wd - 1;
  return addDays(date, -back);
}

export function endOfWeek(date: DateStr): DateStr {
  return addDays(startOfWeek(date), 6);
}

export function startOfMonth(date: DateStr): DateStr {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: DateStr): DateStr {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

export function daysBetween(from: DateStr, to: DateStr): DateStr[] {
  const out: DateStr[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Grade do mes: 6 linhas de 7 dias, comecando na segunda. */
export function monthMatrix(date: DateStr): DateStr[][] {
  const first = startOfWeek(startOfMonth(date));
  const rows: DateStr[][] = [];
  for (let r = 0; r < 6; r++) {
    const row: DateStr[] = [];
    for (let c = 0; c < 7; c++) row.push(addDays(first, r * 7 + c));
    rows.push(row);
  }
  return rows;
}

export function minutesOfTime(time: string): number {
  const h = Number(time.slice(0, 2));
  const m = Number(time.slice(3, 5));
  return h * 60 + m;
}

export function timeFromMinutes(total: number): string {
  const m = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Duracao em minutos entre dois 'YYYY-MM-DDTHH:mm'. */
export function durationMinutes(start: DateTimeStr, end: DateTimeStr): number {
  const days = diffDays(dateOf(end), dateOf(start));
  const st = timeOf(start);
  const et = timeOf(end);
  if (!st || !et) return days * 1440;
  return days * 1440 + minutesOfTime(et) - minutesOfTime(st);
}

export function addMinutes(dt: DateTimeStr, minutes: number): DateTimeStr {
  const time = timeOf(dt);
  if (!time) return addDays(dt, Math.floor(minutes / 1440));
  const total = minutesOfTime(time) + minutes;
  const dayShift = Math.floor(total / 1440);
  return `${addDays(dateOf(dt), dayShift)}T${timeFromMinutes(total)}`;
}

export function formatDateBR(date: DateStr): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

export function formatDayLabel(date: DateStr): string {
  return `${WEEKDAY_SHORT[weekday(date)]} ${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

export function formatRangeLabel(from: DateStr, to: DateStr): string {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const monthName = MONTH_LONG[Number(to.slice(5, 7)) - 1];
  if (sameMonth) {
    return `${Number(from.slice(8, 10))} a ${Number(to.slice(8, 10))} de ${monthName} de ${to.slice(0, 4)}`;
  }
  const fromMonth = MONTH_LONG[Number(from.slice(5, 7)) - 1];
  return `${Number(from.slice(8, 10))} de ${fromMonth} a ${Number(to.slice(8, 10))} de ${monthName}`;
}
