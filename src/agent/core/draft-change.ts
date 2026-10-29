import { explicitTimeRange, interpretAgendaQuery, normalize } from './agenda-query.js';
import type { EventDraft } from './request.js';
import type { AgendaQuery } from '../../shared/agent.js';

type Change = Partial<Pick<EventDraft, 'date' | 'startTime' | 'endTime'>> | { ask: string };
/** Só altera campos explicitamente informados e consome o texto inteiro. */
export function interpretDraftChange(input: string, now: string, previous?: AgendaQuery): Change | null {
  let text = normalize(input).replace(/[.!?]+$/, '').replace(/^(?:na verdade|melhor|mude para|troque para|passe para|fica para|entao|pode ser|(?:pode |quero |vamos )(?:mudar|trocar|passar) para)\s*[, :]?\s*/, '');
  const completeRange = explicitTimeRange(text);
  if (completeRange) return { startTime: completeRange.start, endTime: completeRange.end };
  const hour = '(\\d{1,2}(?::\\d{2}|h\\d{2}|h)?)';
  const single = new RegExp(`^(inicio|comeca|comece|fim|termina|termine)(?:\\s+(?:as|a|para))?\\s+${hour}$`).exec(text);
  if (single) {
    const point = /^(\d{1,2})(?:[:h](\d{2}))?h?$/.exec(single[2]!);
    if (!point || Number(point[1]) > 23 || Number(point[2] ?? 0) > 59) return { ask: 'Qual é o horário válido, entre 00:00 e 23:59?' };
    const value = `${point[1]!.padStart(2, '0')}:${(point[2] ?? '00').padStart(2, '0')}`;
    return ['inicio', 'comeca', 'comece'].includes(single[1]!) ? { startTime: value } : { endTime: value };
  }
  const rangeAtEnd = /\b(?:das|de)\s+\d/.exec(text);
  let change: Change = {};
  if (rangeAtEnd) {
    const range = explicitTimeRange(text.slice(rangeAtEnd.index));
    if (!range) return { ask: 'Informe um intervalo válido e completo, por exemplo das 19h às 20h. Nenhum compromisso foi alterado.' };
    change = { startTime: range.start, endTime: range.end };
    text = text.slice(0, rangeAtEnd.index).trim();
  }
  text = text.replace(/^(?:na|no|para|dia)\s+/, '').replace(/\s+(?:entao|por favor)$/, '');
  const date = /^(?:hoje|amanha|depois de amanha|(?:segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:[- ]feira)?(?:\s+(?:que vem|(?:da |na )?(?:proxima|esta|essa) semana))?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{4})?)$/;
  if (!date.test(text)) return null;
  const interpreted = interpretAgendaQuery(`E ${text}`, now, previous ?? { from: now.slice(0, 10), to: now.slice(0, 10), label: '', startTime: '00:00', endTime: '24:00', period: 'day', dateExplicit: true });
  if (!interpreted || interpreted.kind !== 'query' || interpreted.query.from !== interpreted.query.to) return { ask: interpreted?.kind === 'clarify' ? interpreted.message : 'Qual é o dia exato desse compromisso?' };
  return { ...change, date: interpreted.query.from };
}
