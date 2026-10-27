/**
 * Interpretador de texto curto, usado pelo WhatsApp e pelas IAs.
 * Nao e modelo de linguagem: e um parser de padroes que cobrem o jeito
 * que o Cesar escreve ("amanha 14h dentista", "toda terca 19h aula de IA").
 */
import {
  addDays,
  addMinutes,
  dateOf,
  joinDateTime,
  timeFromMinutes,
  today,
  weekday,
} from '../shared/dates.js';
import { bydayFromText, formatRrule, parseRrule } from '../shared/recurrence.js';
import type { Category, DateStr } from '../shared/types.js';

export interface QuickAdd {
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  rrule?: string | null;
  category?: Category;
}

const WEEKDAY_WORDS: Record<string, number> = {
  domingo: 0, dom: 0,
  segunda: 1, seg: 1, 'segunda-feira': 1,
  terca: 2, ter: 2, 'terça': 2, 'terca-feira': 2, 'terça-feira': 2,
  quarta: 3, qua: 3, 'quarta-feira': 3,
  quinta: 4, qui: 4, 'quinta-feira': 4,
  sexta: 5, sex: 5, 'sexta-feira': 5,
  sabado: 6, sab: 6, 'sábado': 6,
};

const CATEGORY_WORDS: Record<string, Category> = {
  aula: 'faculdade', prova: 'faculdade', faculdade: 'faculdade', cesmac: 'faculdade',
  entrega: 'faculdade', apresentacao: 'faculdade', trabalho: 'trabalho', senai: 'trabalho',
  reuniao: 'trabalho', daily: 'trabalho', planning: 'trabalho',
  colete: 'projeto', projeto: 'projeto', freela: 'projeto',
  estudar: 'estudo', estudo: 'estudo', curso: 'estudo',
  academia: 'saude', treino: 'saude', medico: 'saude', dentista: 'saude',
};

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Primeira data a partir de hoje (inclusive) que cai num dos dias informados. */
function firstMatching(from: DateStr, days: number[]): DateStr {
  for (let i = 0; i < 7; i++) {
    const candidate = addDays(from, i);
    if (days.includes(weekday(candidate))) return candidate;
  }
  return from;
}

/** Proxima ocorrencia daquele dia da semana, a partir de hoje (exclusivo se for hoje). */
function nextWeekday(from: DateStr, target: number): DateStr {
  const current = weekday(from);
  const delta = (target - current + 7) % 7;
  return addDays(from, delta === 0 ? 7 : delta);
}

function normalizeTime(raw: string): string | null {
  const m = /^(\d{1,2})(?:[:h](\d{2}))?h?$/.exec(raw);
  if (!m?.[1]) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Categoria deduzida das palavras do texto. Usada pelo quick-add e pelo importador. */
export function inferCategory(text: string): Category | undefined {
  const normalized = stripAccents(text.toLowerCase());
  for (const [word, category] of Object.entries(CATEGORY_WORDS)) {
    if (normalized.includes(word)) return category;
  }
  return undefined;
}

export function parseQuickAdd(input: string, tz = 'America/Maceio'): QuickAdd {
  const base = today(tz);
  let text = input.trim().replace(/^(add|adicionar|criar|marcar|agendar)\s+/i, '');
  let date: DateStr | null = null;
  let startTime: string | null = null;
  let endTime: string | null = null;
  let rrule: string | null = null;

  const consume = (pattern: RegExp): string | null => {
    const match = pattern.exec(text);
    if (!match) return null;
    text = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`.replace(/\s+/g, ' ').trim();
    return match[0];
  };

  const plain = () => stripAccents(text.toLowerCase());

  // recorrencia: "toda terca", "todas as segundas e quartas", "todo dia", "seg/qua/sex"
  const recurring = /\b(todos?\s+os?\s+dias?|todo\s+dia|toda[s]?\s+(?:as\s+)?([a-zç-]+(?:\s*(?:,|e|\/)\s*[a-zç-]+)*))\b/i.exec(
    plain(),
  );
  if (recurring) {
    const whole = recurring[0];
    if (/dias?$/.test(whole)) {
      rrule = 'FREQ=DAILY';
    } else {
      const days = bydayFromText(recurring[2] ?? '');
      if (days?.length) rrule = formatRrule({ freq: 'WEEKLY', interval: 1, byday: days });
    }
    // remove a expressao do titulo
    const idx = plain().indexOf(whole);
    if (idx >= 0) text = `${text.slice(0, idx)} ${text.slice(idx + whole.length)}`.replace(/\s+/g, ' ').trim();
  }

  // data explicita: 2026-10-27, 27/10, 27/10/2026
  const iso = consume(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) {
    date = iso.trim();
  } else {
    const br = consume(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (br) {
      const [d, m, y] = br.trim().split('/');
      const year = y ? (y.length === 2 ? `20${y}` : y) : base.slice(0, 4);
      date = `${year}-${String(Number(m)).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`;
    }
  }

  if (!date) {
    if (/\bhoje\b/.test(plain())) {
      consume(/\bhoje\b/i);
      date = base;
    } else if (/\b(amanha|amanhã)\b/.test(plain())) {
      consume(/\b(amanha|amanhã)\b/i);
      date = addDays(base, 1);
    } else if (/\b(depois de amanha|depois de amanhã)\b/.test(plain())) {
      consume(/\b(depois de amanha|depois de amanhã)\b/i);
      date = addDays(base, 2);
    } else {
      // todos os dias da semana citados: 'seg qua sex' quer dizer uma rotina
      const mentioned: number[] = [];
      for (const word of plain().split(/\s+/)) {
        const target = WEEKDAY_WORDS[word];
        if (target === undefined || mentioned.includes(target)) continue;
        mentioned.push(target);
        const match = new RegExp(`\\b${word}\\b`, 'i').exec(stripAccents(text.toLowerCase()));
        if (match) {
          text = `${text.slice(0, match.index)} ${text.slice(match.index + word.length)}`
            .replace(/\s+/g, ' ')
            .trim();
        }
      }
      if (mentioned.length) {
        const days = [...mentioned].sort((a, b) => a - b);
        if (!rrule && days.length > 1) {
          rrule = formatRrule({ freq: 'WEEKLY', interval: 1, byday: days });
        }
        // com recorrencia, a ancora e o proximo dia valido contando hoje;
        // sem ela, 'sexta' dita numa sexta quer dizer a sexta que vem
        date = rrule
          ? firstMatching(base, days)
          : nextWeekday(base, days[0] ?? weekday(base));
      }
    }
  }

  // intervalo de hora: "14h-16h", "14:00 as 16:00"
  const range = consume(/\b(\d{1,2}(?:[:h]\d{2})?h?)\s*(?:-|as|às|até|ate|a)\s*(\d{1,2}(?:[:h]\d{2})?h?)\b/i);
  if (range) {
    const parts = range.trim().split(/\s*(?:-|as|às|até|ate|a)\s*/i);
    startTime = normalizeTime(parts[0]?.trim() ?? '');
    endTime = normalizeTime(parts[1]?.trim() ?? '');
  } else {
    const single = consume(/\b(\d{1,2}[:h]\d{2}|\d{1,2}h)\b/i);
    if (single) startTime = normalizeTime(single.trim());
  }

  const title = text.replace(/^[\s,:;-]+|[\s,:;-]+$/g, '').replace(/\s+/g, ' ') || 'Sem titulo';

  const category = inferCategory(title);

  // 'toda terca' dita numa segunda: a ancora da serie e a propria terca,
  // pra que a linha no banco nao minta sobre quando a serie comeca
  let day = date ?? base;
  const rule = parseRrule(rrule);
  if (rule?.freq === 'WEEKLY' && rule.byday?.length) {
    day = firstMatching(day, rule.byday);
  }

  if (!startTime) {
    return { title, start: day, allDay: true, rrule, category };
  }

  const start = joinDateTime(day, startTime);
  const end = endTime ? joinDateTime(day, endTime) : addMinutes(start, 60);
  return {
    title,
    start,
    end: end <= start ? addMinutes(start, 60) : end,
    allDay: false,
    rrule,
    category,
  };
}

export interface ParsedRange {
  from: DateStr;
  to: DateStr;
  label: string;
}

/** "hoje", "amanha", "semana", "proxima semana", "mes" -> intervalo. */
export function parseRangeQuery(input: string, tz = 'America/Maceio'): ParsedRange | null {
  const text = stripAccents(input.trim().toLowerCase());
  const base = today(tz);
  const monday = addDays(base, weekday(base) === 0 ? -6 : -(weekday(base) - 1));

  if (/^(hoje|agenda|hoje\?)$/.test(text)) return { from: base, to: base, label: 'hoje' };
  if (/^(amanha|amanhã)$/.test(text)) {
    const d = addDays(base, 1);
    return { from: d, to: d, label: 'amanha' };
  }
  if (/^(semana|essa semana|esta semana)$/.test(text)) {
    return { from: monday, to: addDays(monday, 6), label: 'esta semana' };
  }
  if (/^(proxima semana|semana que vem)$/.test(text)) {
    const next = addDays(monday, 7);
    return { from: next, to: addDays(next, 6), label: 'proxima semana' };
  }
  if (/^(mes|esse mes|este mes)$/.test(text)) {
    return { from: base, to: addDays(base, 30), label: 'proximos 30 dias' };
  }
  for (const [word, target] of Object.entries(WEEKDAY_WORDS)) {
    if (text === word) {
      const d = nextWeekday(base, target);
      return { from: d, to: d, label: word };
    }
  }
  return null;
}

export { dateOf, timeFromMinutes };
