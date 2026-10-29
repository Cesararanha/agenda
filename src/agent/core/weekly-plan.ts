import { z } from 'zod';
import { addDays, startOfWeek, formatDateBR, formatDayLabel, weekday } from '../../shared/dates.js';
import { timedEvent, wallMoment, type TimedEvent } from './request.js';
import { normalize } from './agenda-query.js';
import { expandWeekdayAliases, explicitWeeklyRepeat, weeklyRepeatHasConstraint } from './human-time.js';

export interface WeeklyRequest { from: string; to: string; replace: boolean; events: TimedEvent[]; repeat?: 'weekly' }
export interface PlanRemoval { id: string; seriesId: string; occurrenceDate: string; recurring: boolean; title: string; start: string; end: string; allDay: boolean }
export interface WeeklyPlan extends WeeklyRequest {
  id: string; version: number; status: 'pending' | 'applied' | 'canceled' | 'undone'; removals: PlanRemoval[]; appliedVersion?: number; conflictsThrough?: string;
}
export interface PlanResult {
  kind: 'plan_pending' | 'plan_applied' | 'plan_canceled' | 'plan_undone' | 'already_applied' | 'stale_suggestion' | 'ask' | 'answer' | 'conflict' | 'tool_error' | 'request_reused';
  message: string; plan?: WeeklyPlan; changed: boolean; evidenceIds: string[];
}
export const weeklyRequest = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  replace: z.boolean(), events: z.array(timedEvent).max(40), repeat: z.literal('weekly').optional() }).strict().superRefine((value, ctx) => {
  if (!value.events.length && (!value.replace || value.repeat)) ctx.addIssue({ code: 'custom', message: 'Um plano sem inclusões precisa ser uma remoção da semana, sem repetição.' });
  if (!wallMoment.safeParse(`${value.from}T00:00`).success || !wallMoment.safeParse(`${value.to}T00:00`).success) {
    ctx.addIssue({ code: 'custom', message: 'Data inválida no plano.' }); return;
  }
  if (startOfWeek(value.from) !== value.from || addDays(value.from, 6) !== value.to
    || value.events.some((event) => event.start.slice(0, 10) < value.from || event.end.slice(0, 10) > value.to
      || (value.repeat === 'weekly' && event.start.slice(0, 10) !== event.end.slice(0, 10)))) {
    ctx.addIssue({ code: 'custom', message: 'O plano precisa ficar dentro de uma semana explícita.' });
  }
});
const dayNames = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];
const dayPattern = '(?:segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira| feira)?';
const hours = '(\\d{1,2}(?::\\d{2}|h\\d{2}|h)?)';
const transition = /^(?:e\s+)?(?:(?:depois|apos isso|em seguida|a seguir)\s*[,.:;]?\s*)?/;
const creation = /^(?:coloque|colocar|adicione|adicionar|agende|agendar|marque|marcar|registre|registrar|inclua|incluir)\s+/;
function hour(raw: string): string | null {
  const match = /^(\d{1,2})(?:[:h](\d{2}))?h?$/.exec(raw);
  return match && Number(match[1]) < 24 && Number(match[2] ?? 0) < 60
    ? `${match[1]!.padStart(2, '0')}:${(match[2] ?? '00').padStart(2, '0')}` : null;
}

/** Interpreta todos os blocos ou devolve uma pergunta; nunca executa um prefixo válido. */
export function interpretWeeklyPlan(raw: string, now: string): WeeklyRequest | { ask: string } | null {
  let text = expandWeekdayAliases(raw).replace(/\b(segundas|tercas|quartas|quintas|sextas|sabados|domingos)\b/g, (word) => word.slice(0, -1)).replace(/-feiras\b/g, '-feira');
  // Uma pergunta educada pode pedir uma ação. A prévia continua exigindo confirmação.
  text = text.replace(/^por favor[,\s]+/, '').replace(/^(?:voce\s+)?(?:pode|poderia|consegue|conseguiria)\s+/, '')
    .replace(/^(?:quero|preciso|gostaria)\s+que\s+(?:voce\s+)?/, '').replace(/^por favor[,\s]+/, '').replace(/[?]+$/, '').trim();
  const everyDay = new RegExp(`\\b(?:todas?\\s+(?:as\\s+)?|todos?\\s+(?:os\\s+)?)(${dayPattern})\\b`, 'g');
  const everyWeekday = new RegExp(everyDay.source).test(text);
  const action = /\b(coloque|colocar|adicione|adicionar|agende|agendar|marque|marcar|registre|registrar|inclua|incluir|organize|organizar|remova|remover|apague|apagar|exclua|excluir)\b/;
  if (!action.test(text) || !(/\b(?:semanas?|semanalmente)\b/.test(text) || everyWeekday || (text.match(new RegExp(dayPattern, 'g'))?.length ?? 0) > 1)) return null;
  const ask = (message: string) => ({ ask: message + ' Nenhuma parte do pedido foi aplicada.' });
  if (/\b(nao|nunca|talvez|se)\b/.test(text)) return ask('Preciso esclarecer a condição ou negação antes de preparar as alterações.');
  if (/\b(mensal(?:mente)?|diariamente|quinzenal(?:mente)?|anual(?:mente)?|passada|anterior)\b/.test(text)) return ask('Este plano aceita uma semana ou repetição semanal. Qual período e frequência você quer usar?');
  const repeat = everyWeekday || explicitWeeklyRepeat(text);
  if (repeat && weeklyRepeatHasConstraint(text)) return ask('O pedido mistura repetição semanal com uma exceção ou limite. Preciso esclarecer essa diferença.');
  text = text.replace(/\b(?:para |em )?(?:todas as semanas|toda semana|todas semanas|semanalmente|semanal|sempre)\b/g, '').replace(everyDay, '$1').trim();
  if (/\b(?:toda|todas|recorrente)\b/.test(text)) return ask('Você quer repetir os blocos toda semana? Informe a frequência junto com os dias e horários.');
  const next = /\b(?:proxima semana|semana que vem)\b/.test(text);
  if (next && /\b(?:nesta semana|nessa semana|esta semana|essa semana|minha semana|semana atual)\b/.test(text)) return ask('Você quer organizar esta semana ou a próxima?');
  const from = addDays(startOfWeek(now.slice(0, 10)), next ? 7 : 0);
  const to = addDays(from, 6);
  const onlyRemoval = /^(?:remova|remover|apague|apagar|exclua|excluir)\s+todos\s+(?:os\s+)?(?:meus\s+)?(?:compromissos|eventos)\s+(?:(?:da|desta|dessa|nesta|nessa|na)\s+(?:(?:proxima|atual|esta|essa)\s+)?semana(?:\s+(?:que vem|atual))?|(?:da\s+)?minha\s+semana)[.!]*$/;
  if (onlyRemoval.test(text)) return { from, to, replace: true, events: [] };
  text = text.replace(/^(?:vamos\s+)?(?:organizar|organize)\s+(?:(?:a |minha |esta |essa |a proxima |proxima )semana(?: que vem)?)[\s.!,:;]*/, '');
  text = text.replace(/\b(?:na |nesta |nessa |para a )?(?:proxima semana|semana que vem|esta semana|essa semana)\b/g, '').trim();
  let replace = false;
  const removal = /^(?:primeiro\s+)?(?:remova|remover|apague|apagar|exclua|excluir)\s+todos\s+(?:os\s+)?(?:compromissos|eventos)(?:\s+(?:da|desta|dessa|na)\s+semana)?[\s.!,:;]*(?:depois\s+)?/;
  if (removal.test(text)) {
    if (!/\bsemana\b/.test(normalize(raw))) return ask('Qual semana deve ter os compromissos substituídos?');
    replace = true;
    text = text.replace(removal, '').replace(transition, '');
  }
  text = text.replace(transition, '').replace(/^(?:quero|gostaria de|preciso|vamos)\s+/, '').replace(creation, '');
  let declaredTitle: string | undefined;
  const topic = /^(?:vamos\s+)?(?:organize|organizar)\s+(?:(?:o|a)\s+)?(?:(?:meu|minha)\s+)?(.+?)\s*[.!;:]\s*/.exec(text);
  if (topic) {
    if (action.test(topic[1]!) || /\d|\b(?:ignore|mova|troque|cancele|semana|mes|ano)\b/.test(topic[1]!)) return ask('Preciso esclarecer o assunto e as instruções antes de preparar os blocos.');
    declaredTitle = topic[1]!.trim(); text = text.slice(topic[0].length);
  }
  const fixedHeader = /^(?:deixe|mantenha)\s+(?:(?:o|os)\s+)?horarios?\s+fixos?\s*[.!;:]\s*/;
  if (fixedHeader.test(text)) {
    if (!repeat) return ask('Você quer repetir esses horários toda semana?');
    text = text.replace(fixedHeader, '');
  }
  const pattern = new RegExp(`([\\s\\S]+?)(?:(?:das|de)\\s+)?${hours}\\s*(?:as|a|ate|-)\\s*${hours}(?=\\s|[.!;,]|$)`, 'g');
  const events: TimedEvent[] = [];
  let consumed = 0, previousTitle = declaredTitle;
  for (const match of text.matchAll(pattern)) {
    if (match.index !== consumed) return ask('Não consegui separar todas as instruções. Informe um bloco de dias e horários por frase.');
    consumed = match.index! + match[0].length;
    let prefix = match[1]!.replace(/^[\s.!;,]+/, '').replace(transition, '').replace(creation, '').replace(/[.!;]+\s*$/, '').trim();
    // Um título pode ser declarado antes dos blocos: "os dias do meu trabalho fixos. Segunda...".
    const header = /^(?:(?:os|as)\s+)?(?:dias|horarios|blocos|rotina)\s+(?:do|da|de)\s+(?:(?:meu|minha)\s+)?(.+?)(?:\s+fix[oa]s?)?\s*[.!;]\s*/.exec(prefix);
    if (header) {
      if (action.test(header[1]!) || /\b(?:ignore|mova|troque|cancele)\b/.test(header[1]!)) return ask('Preciso esclarecer uma instrução extra antes dos blocos.');
      previousTitle = header[1]!.trim(); prefix = prefix.slice(header[0].length);
    }
    const days = [...prefix.matchAll(new RegExp(`\\b(${dayPattern})\\b`, 'g'))].map((item) => item[1]!.replace(/(?:-feira| feira)$/, ''));
    if (!days.length || new Set(days).size !== days.length) return ask('Cada bloco precisa de dias da semana distintos.');
    const remainder = prefix.replace(new RegExp(`\\b${dayPattern}\\b`, 'g'), ' ').replace(/[,]/g, ' ').replace(/\b(?:e|na|nas|no|nos|o|a|os|as)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (action.test(remainder) || /\d|[.!?;:]|\b(?:ignore|mova|troque|cancele|depois|antes|semana)\b/.test(remainder)) return ask('Há uma instrução nesse bloco que preciso esclarecer antes de preparar o conjunto.');
    const title = remainder || previousTitle;
    const start = hour(match[2]!), end = hour(match[3]!);
    if (!title || !start || !end || end <= start) return ask('Preciso do título e de horários válidos de início e fim em cada bloco. O título pode ser mantido do bloco anterior.');
    previousTitle = title;
    for (const day of days) {
      const date = addDays(from, dayNames.indexOf(day));
      events.push({ title: title[0]!.toUpperCase() + title.slice(1), start: `${date}T${start}`, end: `${date}T${end}` });
    }
  }
  const spec: WeeklyRequest = { from, to, replace, events: events.sort((a, b) => a.start.localeCompare(b.start)), ...(repeat ? { repeat: 'weekly' } : {}) };
  if (!events.length || text.slice(consumed).replace(/[\s.!;,]/g, '') || !weeklyRequest.safeParse(spec).success) return ask('Não consegui interpretar o pedido inteiro. Use blocos como “segunda e quarta Trabalho das 8h às 14h; terça, quinta e sexta das 10h às 16h”.');
  if (events.some((event, index) => events.some((other, j) => j < index && event.start < other.end && other.start < event.end))) return ask('Os horários informados se sobrepõem entre si. Quais blocos você quer manter?');
  return spec;
}

export function describePlan(plan: WeeklyPlan): string {
  return `Plano para ${formatDateBR(plan.from)} a ${formatDateBR(plan.to)}${plan.repeat ? ', com nova rotina semanal' : ', somente essa semana'}:\n`
    + (plan.replace ? `Remover ${plan.removals.length} compromisso(s) desse período:\n${plan.removals.map((item) => `• ${formatDateBR(item.start.slice(0, 10))} ${item.allDay ? 'dia inteiro' : item.start.slice(11) + ' às ' + item.end.slice(11)}: ${item.title}`).join('\n') || '• Nenhum compromisso cadastrado no período.'}\n\n` : 'Manter os compromissos existentes.\n\n')
    + (plan.events.length ? `Adicionar ${plan.events.length} ${plan.repeat ? 'série(s), repetindo toda semana, sem data final' : 'compromisso(s)'}:\n${plan.events.map((item) => `• ${plan.repeat ? formatDayLabel(item.start.slice(0, 10)) : formatDateBR(item.start.slice(0, 10))}, ${item.start.slice(11)} às ${item.end.slice(11)}: ${item.title}`).join('\n')}\n\n` : 'Nenhum compromisso será adicionado.\n\n')
    + (plan.repeat && plan.conflictsThrough ? `${plan.replace ? 'Os compromissos removidos pertencem somente à semana mostrada. ' : ''}Conflitos da nova rotina foram conferidos até ${formatDateBR(plan.conflictsThrough)}.\n\n` : '')
    + 'Confirme o plano para aplicar todas as alterações juntas. Nada foi alterado ainda.';
}

/** Projeção para conferir conflitos; só as séries-base são gravadas. */
export function planOccurrences(spec: WeeklyRequest, through = spec.to): TimedEvent[] {
  if (!spec.repeat) return spec.events;
  const result: TimedEvent[] = [];
  for (const event of spec.events) for (let date = event.start.slice(0, 10); date <= through; date = addDays(date, 7)) {
    result.push({ title: event.title, start: `${date}T${event.start.slice(11)}`, end: `${date}T${event.end.slice(11)}` });
  }
  return result;
}

/** Confere também um compromisso único já conhecido, mesmo após a janela de projeção. */
export function firstWeeklyOverlap(event: TimedEvent, block: { start: string; end: string }): TimedEvent | null {
  const anchor = event.start.slice(0, 10) > block.start.slice(0, 10) ? event.start.slice(0, 10) : block.start.slice(0, 10);
  const date = addDays(anchor, (weekday(event.start.slice(0, 10)) - weekday(anchor) + 7) % 7);
  for (const day of [date, addDays(date, 7)]) {
    const occurrence = { title: event.title, start: `${day}T${event.start.slice(11)}`, end: `${day}T${event.end.slice(11)}` };
    if (occurrence.start < block.end && block.start < occurrence.end) return occurrence;
  }
  return null;
}
