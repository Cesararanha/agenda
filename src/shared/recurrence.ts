/**
 * Recorrencia: subconjunto do RRULE do iCalendar (RFC 5545), o bastante pra rotina
 * de verdade (aula toda terca, academia seg/qua/sex, reuniao mensal).
 * Formato guardado no banco: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE;UNTIL=2026-12-20'
 */
import { addDays, diffDays, endOfMonth, startOfWeek, weekday } from './dates.js';
import type { DateStr } from './types.js';

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface Rrule {
  freq: Freq;
  interval: number;
  /** 0 = domingo ... 6 = sabado */
  byday?: number[];
  until?: DateStr;
  count?: number;
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
/** Limite de seguranca: ninguem precisa expandir mais que isso de uma vez. */
const MAX_ITERATIONS = 4000;

export function parseRrule(raw: string | null | undefined): Rrule | null {
  if (!raw) return null;
  const parts = new Map<string, string>();
  for (const chunk of raw.split(';')) {
    const [k, v] = chunk.split('=');
    if (k && v) parts.set(k.trim().toUpperCase(), v.trim());
  }
  const freq = parts.get('FREQ')?.toUpperCase();
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') return null;

  const rule: Rrule = { freq, interval: Math.max(1, Number(parts.get('INTERVAL') ?? 1) || 1) };

  const byday = parts.get('BYDAY');
  if (byday) {
    const days = byday
      .split(',')
      .map((d) => DAY_CODES.indexOf(d.trim().toUpperCase()))
      .filter((i) => i >= 0);
    if (days.length) rule.byday = [...new Set(days)].sort((a, b) => a - b);
  }

  const until = parts.get('UNTIL');
  if (until) {
    // aceita '2026-12-20' e o formato compacto '20261220'
    const normalized = /^\d{8}$/.test(until)
      ? `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`
      : until.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) rule.until = normalized;
  }

  const count = Number(parts.get('COUNT'));
  if (Number.isInteger(count) && count > 0) rule.count = count;

  return rule;
}

export function formatRrule(rule: Rrule | null): string | null {
  if (!rule) return null;
  const out = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) out.push(`INTERVAL=${rule.interval}`);
  if (rule.byday?.length) out.push(`BYDAY=${rule.byday.map((d) => DAY_CODES[d]).join(',')}`);
  if (rule.until) out.push(`UNTIL=${rule.until}`);
  if (rule.count) out.push(`COUNT=${rule.count}`);
  return out.join(';');
}

/**
 * Datas das ocorrencias de uma serie dentro de [from, to].
 * Gera sempre a partir da ancora, pra que COUNT conte certo.
 */
export function occurrenceDates(
  anchor: DateStr,
  rule: Rrule | null,
  from: DateStr,
  to: DateStr,
): DateStr[] {
  if (!rule) return anchor >= from && anchor <= to ? [anchor] : [];

  const hardStop = rule.until && rule.until < to ? rule.until : to;
  const out: DateStr[] = [];
  let emitted = 0;
  let iterations = 0;

  const emit = (date: DateStr): 'ok' | 'stop' => {
    if (date < anchor) return 'ok';
    if (rule.until && date > rule.until) return 'stop';
    if (date > hardStop) return 'stop';
    emitted++;
    if (date >= from) out.push(date);
    if (rule.count && emitted >= rule.count) return 'stop';
    return 'ok';
  };

  if (rule.freq === 'DAILY') {
    for (let d = anchor; d <= hardStop; d = addDays(d, rule.interval)) {
      if (iterations++ > MAX_ITERATIONS) break;
      if (emit(d) === 'stop') break;
    }
    return out;
  }

  if (rule.freq === 'WEEKLY') {
    const days = rule.byday?.length ? rule.byday : [weekday(anchor)];
    // ordem da semana do Cesar: segunda primeiro, domingo por ultimo
    const offsets = days
      .map((d) => (d === 0 ? 6 : d - 1))
      .sort((a, b) => a - b);
    let weekStart = startOfWeek(anchor);
    while (weekStart <= hardStop) {
      if (iterations++ > MAX_ITERATIONS) break;
      let stopped = false;
      for (const offset of offsets) {
        if (emit(addDays(weekStart, offset)) === 'stop') {
          stopped = true;
          break;
        }
      }
      if (stopped) break;
      weekStart = addDays(weekStart, 7 * rule.interval);
    }
    return out;
  }

  // MONTHLY: mesmo dia do mes da ancora; mes sem aquele dia (31 em fevereiro) e pulado
  const dayOfMonth = Number(anchor.slice(8, 10));
  let year = Number(anchor.slice(0, 4));
  let month = Number(anchor.slice(5, 7));
  while (iterations++ <= MAX_ITERATIONS) {
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    if (monthStart > hardStop) break;
    const lastDay = Number(endOfMonth(monthStart).slice(8, 10));
    if (dayOfMonth <= lastDay) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
      if (emit(date) === 'stop') break;
    }
    month += rule.interval;
    while (month > 12) {
      month -= 12;
      year++;
    }
  }
  return out;
}

/** Texto curto pra mostrar na interface e nas respostas das IAs. */
export function describeRrule(rule: Rrule | null): string {
  if (!rule) return 'uma vez';
  const every = rule.interval > 1 ? `a cada ${rule.interval} ` : 'toda ';
  let base: string;
  if (rule.freq === 'DAILY') {
    base = rule.interval > 1 ? `a cada ${rule.interval} dias` : 'todo dia';
  } else if (rule.freq === 'WEEKLY') {
    const names = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
    const days = rule.byday?.length
      ? rule.byday.map((d) => names[d]).join(', ')
      : 'semana';
    base = rule.interval > 1 ? `a cada ${rule.interval} semanas (${days})` : `toda ${days}`;
  } else {
    base = rule.interval > 1 ? `${every}meses` : 'todo mes';
  }
  if (rule.until) base += ` ate ${rule.until.slice(8, 10)}/${rule.until.slice(5, 7)}`;
  if (rule.count) base += ` (${rule.count}x)`;
  return base;
}

/** Atalho: 'seg,qua,sex' -> BYDAY. Usado pelo WhatsApp e pelas IAs. */
export function bydayFromText(text: string): number[] | undefined {
  const map: Record<string, number> = {
    dom: 0, domingo: 0,
    seg: 1, segunda: 1, segundas: 1,
    ter: 2, terca: 2, tercas: 2, terça: 2, terças: 2,
    qua: 3, quarta: 3, quartas: 3,
    qui: 4, quinta: 4, quintas: 4,
    sex: 5, sexta: 5, sextas: 5,
    sab: 6, sabado: 6, sábado: 6, sabados: 6,
  };
  const days = text
    .toLowerCase()
    // o 'e' separa ('seg e qua'), mas so como palavra: senao 'terca' virava 't' + 'rca'
    .replace(/\s+e\s+/g, ',')
    .split(/[\s,;/]+/)
    .map((t) => map[t.trim()])
    .filter((d): d is number => d !== undefined);
  return days.length ? [...new Set(days)].sort((a, b) => a - b) : undefined;
}

export { diffDays };
