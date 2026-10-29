import { createHash } from 'node:crypto';
import { addDays, addMinutes, formatDateBR } from '../../shared/dates.js';
import type { DemoReply } from '../../shared/agent.js';
import { answerFromContext, type ReadonlyModel } from './answers.js';
import type { ContextReader } from './context.js';
import { parseRequest, timedEvent, type TimedEvent, type EventDraft } from './request.js';
import type { SandboxState, AgentResult } from './sandbox.js';
import { interpretAgendaQuery, eventsForQuery, explicitTimeRange, normalize, type AgendaItem } from './agenda-query.js';
import { interpretWeeklyPlan, type WeeklyRequest, type PlanResult } from './weekly-plan.js';
import { interpretDraftChange } from './draft-change.js';
import { groundedSchedule, schedulingIntent } from './human-time.js';
import { groundedTitle } from './title-interpretation.js';
import { planningCandidate, planningGuard, planningRead, validatePlanning, type PlanningDraft } from './assisted-plan.js';
import { intentSchema } from './intent.js';

export interface ConversationPorts {
  state(from?: string, to?: string): SandboxState;
  execute(request: { requestId: string; input: string; now: string }): AgentResult;
  propose(proposal: { event: TimedEvent; expectedVersion: number; targetEventId?: string }, receipt: { requestId: string; input: string }): AgentResult;
  reader: ContextReader;
  model: ReadonlyModel;
  titleModel?: (input: string) => Promise<unknown>;
  planningModel?: (draft: PlanningDraft, feedback?: string) => Promise<unknown>;
  intentModel?: (input: string, pending?: boolean) => Promise<unknown>;
  clock(): string;
  agenda?(from: string, to: string): AgendaItem[];
  cancel?(suggestionId: string, request: { requestId: string; input: string; now: string }): AgentResult;
  plans?: {
    prepare(spec: WeeklyRequest, request: { requestId: string; input: string; now: string }): PlanResult;
    apply(id: string, request: { requestId: string; input: string; now: string }): PlanResult;
    cancel(id: string, request: { requestId: string; input: string; now: string }): PlanResult;
    undo(id: string, request: { requestId: string; input: string; now: string }): PlanResult;
  };
}
const plain = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const ask = (message: string): DemoReply => ({ kind: 'ask', message, evidenceIds: [], changed: false });

export async function converse(request: { requestId: string; input: string }, ports: ConversationPorts, previous?: DemoReply): Promise<DemoReply> {
  const frame = previous?.continuation ? { ...previous, ...previous.continuation } : previous;
  const reply = await routeConversation(request, ports, frame);
  const hasOperation = reply.event || reply.suggestion || reply.plan || reply.eventDraft || reply.pendingSchedule || reply.planningDraft;
  // Leituras não substituem a operação identificada nesta conversa nem mostram botões duplicados.
  if (frame && reply.kind === 'answer' && reply.evidenceIds.length && !reply.changed && !hasOperation) {
    const continuation: NonNullable<DemoReply['continuation']> = {};
    for (const key of ['event', 'suggestion', 'plan', 'eventDraft', 'pendingSchedule', 'planningDraft', 'agendaQuery'] as const) {
      if (frame[key]) Object.assign(continuation, { [key]: frame[key] });
    }
    if (continuation.suggestion?.status === 'canceled') delete continuation.suggestion;
    if (continuation.plan?.status === 'canceled' || continuation.plan?.status === 'undone') delete continuation.plan;
    const waiting = continuation.event || continuation.suggestion || continuation.plan || continuation.eventDraft || continuation.pendingSchedule || continuation.planningDraft;
    if (!waiting && reply.agendaQuery) continuation.agendaQuery = reply.agendaQuery;
    return { ...reply, ...(Object.keys(continuation).length ? { continuation } : {}),
      ...(continuation.planningDraft ? { planningDraft: continuation.planningDraft } : {}) };
  }
  return reply;
}

async function routeConversation(request: { requestId: string; input: string }, ports: ConversationPorts, previous?: DemoReply): Promise<DemoReply> {
  const now = ports.clock();
  const normalized = normalize(request.input).replace(/[.!?]+$/, '');
  const exactPlan = /^(confirmo|confirme|cancele|desfaca) (?:o )?plano (plano-[a-z0-9-]+)$/.exec(normalized);
  if (exactPlan && ports.plans) {
    const method = exactPlan[1] === 'cancele' ? 'cancel' : exactPlan[1] === 'desfaca' ? 'undo' : 'apply';
    return ports.plans[method](exactPlan[2]!, { ...request, now });
  }
  if (/^(desfazer|desfaca|desfazer o plano|desfaca o plano|desfaca esse plano)$/.test(normalized)) {
    return previous?.plan && ports.plans ? ports.plans.undo(previous.plan.id, { ...request, now }) : ask('Qual plano você quer desfazer? Preciso que ele esteja identificado na conversa.');
  }
  if (previous?.plan && ports.plans) {
    if (/^(sim|confirmo|confirmado|pode confirmar|pode aplicar|aplique|confirme|confirmo o plano|confirme o plano|pode sim|isso mesmo|pode ser)$/.test(normalized)) return ports.plans.apply(previous.plan.id, { ...request, now });
    if (/^(nao|nao quero|cancele|cancelar|cancele o plano|deixa pra la)$/.test(normalized)) return ports.plans.cancel(previous.plan.id, { ...request, now });
  }
  const weekly = interpretWeeklyPlan(request.input, now);
  if (previous?.planningDraft && /^(?:nao|cancele|cancelar|deixa pra la|desista)[.!?]?$/.test(normalized)) return { kind: 'answer', changed: false, evidenceIds: [], message: 'Cancelei esse pedido de plano. Nenhum compromisso foi alterado.' };
  const directWeekly = weekly && !('ask' in weekly) && (weekly.replace || weekly.repeat
    || /^(?:vamos organizar|organize|coloque|adicione|agende|marque|registre|inclua)\b/.test(normalized));
  if (ports.planningModel && !directWeekly && !planningRead(request.input)
    && (previous?.planningDraft || planningCandidate(request.input))) {
    const blocked = planningGuard([request.input]);
    if (blocked) return ask(blocked);
    return ports.intentModel ? routeByIntent(request, ports, now, previous) : prepareAssisted(request, ports, now, previous);
  }
  if (weekly) {
    if ('ask' in weekly) return ask(weekly.ask);
    return ports.plans ? ports.plans.prepare(weekly, { ...request, now }) : ask('A ferramenta de planos semanais não está disponível. Nenhuma parte do pedido foi aplicada.');
  }
  if (/^(?:primeiro\s+)?(?:remova|remover|apague|apagar|exclua|excluir)\b/.test(normalized)) return ask('Qual período você quer alterar e quais compromissos devem entrar no lugar? Vou apresentar todas as alterações antes de aplicá-las.');
  if (schedulingIntent(request.input) && /\b(?:nao|nunca|talvez|se)\b/.test(normalized)) return ask('O pedido tem uma negação ou condição. Não preparei nenhum registro. Diga o que deseja marcar quando estiver decidido.');
  if (/\b(?:tarefas|pendencias)\b/.test(normalized) && /\b(?:conclua|concluir|crie|criar|apague|remova|salve|adicione|inclua|incluir|registre|registrar|atualize)\b/.test(normalized)) return ask('Nesta demonstração, consulto as tarefas da fonte. Alterações de tarefas ainda não estão disponíveis.');
  const positive = /^(sim|confirmo|confirmado|pode confirmar|pode marcar|pode salvar|pode registrar|pode sim|isso mesmo|pode ser)$/.test(normalized);
  const negative = /^(nao|nao confirme|nao quero|nao marque|nao agende|cancele(?: a sugestao)?|cancelar|deixa pra la|desista)$/.test(normalized);
  if (positive) {
    if (!previous?.suggestion) return ask('Qual sugestão você quer confirmar? Preciso que a proposta esteja identificada antes de registrar.');
    const result = ports.execute({ requestId: request.requestId, input: `Confirmo a sugestão ${previous.suggestion.id}`, now });
    const suggestion = ports.state().suggestions.find((item) => item.id === previous.suggestion!.id);
    return { ...result, suggestion, changed: result.kind === 'applied', evidenceIds: ['agenda'] };
  }
  if (negative && (previous?.suggestion || previous?.eventDraft || previous?.pendingSchedule)) {
    if (!previous.suggestion) return { kind: 'answer', changed: false, evidenceIds: [], message: 'Certo, deixei esse pedido sem registrar.' };
    if (!ports.cancel) return ask('Não registrei nada novo. Para cancelar a proposta, preciso da ferramenta de cancelamento.');
    const result = ports.cancel(previous.suggestion.id, { ...request, now });
    return { ...result, changed: false, evidenceIds: ['agenda'] };
  }
  const parsed = parseRequest(request.input, now);
  if (parsed.kind === 'create' || parsed.kind === 'confirm' || parsed.kind === 'missing') {
    const result = ports.execute({ ...request, now });
    const suggestion = parsed.kind === 'confirm' ? ports.state().suggestions.find((item) => item.id === parsed.suggestionId) : undefined;
    return { ...result, suggestion, evidenceIds: ['agenda'], changed: result.kind === 'created' || result.kind === 'applied',
      ...(parsed.kind === 'missing' && parsed.draft ? { eventDraft: parsed.draft,
        message: parsed.draft.startTime ? `Para salvar ${parsed.draft.title} em ${formatDateBR(parsed.draft.date!)}, com início às ${parsed.draft.startTime}, até que horário vai?`
          : `Para salvar ${parsed.draft.title} em ${formatDateBR(parsed.draft.date!)}, quais são os horários de início e fim?` } : {}) };
  }
  if (/^(?:confirme|confirmar|confirmo)\b/.test(normalized)) return ask('Qual sugestão ou plano você quer confirmar? Preciso que a alteração esteja identificada.');
  if (previous?.pendingSchedule && !schedulingIntent(request.input) && !/\?|^(?:qual|quais|como|mostre|liste|o que|minha agenda|minhas tarefas)\b/.test(normalized)) {
    if (ports.intentModel && !/^(?:o titulo e|titulo\s*:)/.test(normalized)) return routeByIntent(request, ports, now, previous);
    const humanTitle = request.input.replace(/^(?:o t[ií]tulo [eé]|t[ií]tulo\s*:|[eé])\s+/i, '');
    const title = groundedTitle({ titleSpan: humanTitle }, humanTitle);
    if (!title) return { ...ask('Qual é o título do compromisso? Mantive o dia e os horários, sem registrar nada.'), pendingSchedule: previous.pendingSchedule };
    return completeDraft(request, ports, now, { title, date: previous.pendingSchedule.date,
      startTime: previous.pendingSchedule.start, endTime: previous.pendingSchedule.end, mode: 'propose' });
  }
  const previousEvent = previous?.event?.details ?? previous?.suggestion?.event;
  const editable: EventDraft | undefined = previous?.eventDraft ?? (previousEvent ? { title: previousEvent.title, date: previousEvent.start.slice(0, 10),
    startTime: previousEvent.start.slice(11), endTime: previousEvent.end.slice(11), mode: 'propose',
    targetEventId: previous?.event?.id ?? previous?.suggestion?.targetEventId ?? undefined } : undefined);
  if (editable) {
    const anchor = previous?.agendaQuery ?? (editable.date ? { from: editable.date, to: editable.date, label: '', startTime: '00:00', endTime: '24:00', dateExplicit: true, period: 'day' as const } : undefined);
    const change = interpretDraftChange(request.input, now, anchor);
    if (change) {
      if (previous?.suggestion?.status === 'applied' && !previous.event) return ask('Esse compromisso já foi registrado. Abra-o no calendário para selecionar exatamente qual evento quer alterar.');
      if (previous?.suggestion?.status === 'pending') {
        if (!ports.cancel) return ask('Não consegui substituir a sugestão anterior. Nenhum compromisso foi alterado.');
        const canceled = ports.cancel(previous.suggestion.id, { ...request, now,
          requestId: `replace-${createHash('sha256').update(request.requestId).digest('hex')}` });
        if (canceled.kind !== 'suggestion_canceled') return { ...canceled, changed: false, evidenceIds: ['agenda'] };
      }
      if ('ask' in change) return { ...ask(change.ask), eventDraft: editable, agendaQuery: previous?.agendaQuery };
      return completeDraft(request, ports, now, { ...editable, ...change });
    }
  }
  if (previous?.eventDraft) {
    const draft = previous.eventDraft;
    const range = explicitTimeRange(request.input) ?? (draft.startTime
      ? explicitTimeRange(`das ${draft.startTime} ${normalize(request.input)}`) ?? explicitTimeRange(`das ${draft.startTime} as ${normalize(request.input)}`) : null);
    if (range && draft.date) {
      return completeDraft(request, ports, now, { ...draft, startTime: range.start, endTime: range.end });
    }
    const singleTime = draft.startTime ? normalize(request.input).replace(/^ate\s+/, '') : normalize(request.input);
    const start = /^(?:as?\s+)?(\d{1,2})(?:[:h](\d{2}))?h?[.!?]?$/.exec(singleTime);
    if (start && Number(start[1]) < 24 && Number(start[2] ?? 0) < 60) {
      if (draft.startTime) return { ...ask(`O horário de fim precisa ser depois das ${draft.startTime}. Até que horário vai o compromisso?`), eventDraft: draft, agendaQuery: previous.agendaQuery };
      const startTime = `${start[1]!.padStart(2, '0')}:${(start[2] ?? '00').padStart(2, '0')}`;
      return { ...ask(`Certo, início às ${startTime}. Até que horário?`), eventDraft: { ...draft, startTime }, agendaQuery: previous.agendaQuery };
    }
    if (range && !draft.date) return completeDraft(request, ports, now, { ...draft, startTime: range.start, endTime: range.end });
  }
  const input = plain(request.input).replace(/[.!?]+$/, '');
  if (parsed.kind === 'suggest') return proposeStudy(request, ports, now);
  if (/\b(?:tarefas|pendencias)\b|^o que (?:eu )?tenho (?:para|pra) fazer$|^o que esta pendente$/.test(input)) {
    if (/\b(?:conclua|concluir|crie|criar|apague|remova|salve|adicione|inclua|incluir|registre|registrar|atualize)\b/.test(input)) return ask('Nesta demonstração, consulto as tarefas da fonte. Alterações de tarefas ainda não estão disponíveis.');
    try {
      const context = await ports.reader.read('tasks');
      return { kind: 'answer', changed: false, evidenceIds: ['tasks/todo.md'], message: context.openTasks.length
        ? `Tarefas abertas:\n${context.openTasks.map((task) => `• ${task.text}`).join('\n')}` : 'Nenhuma tarefa aberta na fonte fictícia.' };
    } catch { return { kind: 'context_unavailable', changed: false, evidenceIds: [], message: 'Não consegui consultar as tarefas fictícias. Tente novamente.' }; }
  }
  const agenda = interpretAgendaQuery(request.input, now, previous?.agendaQuery);
  if (!agenda || (agenda.kind === 'query' && !agenda.title)) {
    const grounded = groundedSchedule(request.input, now);
    if (grounded) {
      if ('ask' in grounded) return ask(grounded.ask);
      if (!ports.titleModel) return { ...ask('Identifiquei o dia e os horários. Qual é o título do compromisso?'), pendingSchedule: grounded };
      let raw: unknown;
      try { raw = await ports.titleModel(request.input); }
      catch { return { kind: 'model_error', changed: false, evidenceIds: [], pendingSchedule: grounded, message: 'O modelo local não respondeu à interpretação. Mantive o dia e os horários. Qual é o título do compromisso?' }; }
      const title = groundedTitle(raw, request.input);
      if (!title) return { ...ask('Não consegui identificar um título presente no seu pedido com segurança. Mantive o dia e os horários. Qual é o título do compromisso?'), pendingSchedule: grounded };
      return completeDraft(request, ports, now, { title, date: grounded.date, startTime: grounded.start, endTime: grounded.end, mode: 'propose' });
    }
  }
  if (agenda) {
    if (agenda.kind === 'clarify') return { ...ask(agenda.message), ...(agenda.title ? { eventDraft: { title: agenda.title } } : {}) };
    const query = agenda.query;
    const entries = ports.agenda ? ports.agenda(query.from, query.to) : ports.state().events.map((event) => ({ id: event.id, ...event.details, allDay: false }));
    const events = eventsForQuery(entries, query);
    const title = agenda.title ?? (agenda.followup ? previous?.eventDraft?.title : undefined);
    const eventDraft: EventDraft | undefined = title ? { title, ...(query.dateExplicit && query.from === query.to ? { date: query.from } : {}),
      ...(query.pointTime ? { startTime: query.pointTime } : !query.period ? { startTime: query.startTime, endTime: query.endTime } : {}) } : undefined;
    if (eventDraft?.date && eventDraft.startTime && eventDraft.endTime) return completeDraft(request, ports, now, eventDraft);
    const details = events.map((event) => {
      const multiDate = query.from !== query.to || event.start.slice(0, 10) !== query.from || event.end.slice(0, 10) !== event.start.slice(0, 10);
      return event.allDay ? `Dia inteiro: ${event.title}` : `${multiDate ? formatDateBR(event.start.slice(0, 10)) + ' ' : ''}${event.start.slice(11)} às ${multiDate ? formatDateBR(event.end.slice(0, 10)) + ' ' : ''}${event.end.slice(11)}: ${event.title}`;
    });
    let message = events.length ? `Seus compromissos em ${query.label}:\n${details.join('\n')}` : `Não encontrei compromissos cadastrados na agenda fictícia em ${query.label}.`;
    if (query.correction) message += `\n${query.correction}`;
    if (eventDraft) message += eventDraft.date
      ? eventDraft.startTime ? `\n\nPara marcar ${eventDraft.title.toLowerCase()} com início às ${eventDraft.startTime}, qual é o horário de fim?` : `\n\nPara marcar ${eventDraft.title.toLowerCase()}, qual é o horário de início e de fim?`
      : `\n\nPara marcar ${eventDraft.title.toLowerCase()}, me diga o dia e os horários de início e fim.`;
    return { kind: 'answer', changed: false, evidenceIds: ['agenda'], message, agendaQuery: query, eventDraft };
  }
  if (ports.intentModel && !/\bpreferencias?\b/.test(input)) return routeByIntent(request, ports, now, previous);
  return readMemory(request.input, ports);
}

async function readMemory(input: string, ports: ConversationPorts): Promise<DemoReply> {
  const answer = await answerFromContext({ input, topic: 'memory' }, ports.reader, ports.model);
  return { kind: answer.kind, message: answer.message, evidenceIds: answer.evidenceIds, changed: false, ...(answer.needsDetails ? { needsDetails: true } : {}) };
}

async function routeByIntent(request: { requestId: string; input: string }, ports: ConversationPorts, now: string, previous?: DemoReply): Promise<DemoReply> {
  const clarify = (message: string) => ({ ...ask(message), needsDetails: true });
  let raw: unknown;
  const pending = Boolean(previous?.planningDraft || previous?.eventDraft || previous?.pendingSchedule);
  try { raw = await ports.intentModel!(request.input, pending); }
  catch { return { kind: 'model_error', changed: false, evidenceIds: [], message: 'O modelo local não conseguiu interpretar o pedido agora. Nenhuma alteração foi feita. Você pode tentar novamente com a mesma mensagem.' }; }
  const selected = intentSchema.safeParse(raw);
  if (!selected.success) return ask('Não consegui identificar a intenção com segurança. Você quer consultar a agenda, ver tarefas ou preparar um compromisso?');
  if (selected.data.intent === 'calendar_read') {
    const interpreted = interpretAgendaQuery(`Mostre minha agenda: ${request.input}`, now, previous?.agendaQuery);
    if (!interpreted || interpreted.kind !== 'query') return clarify(interpreted?.kind === 'clarify' ? interpreted.message : 'Qual dia ou semana você quer consultar?');
    return readCalendar(interpreted.query, ports);
  }
  if (selected.data.intent === 'tasks_read') return readTasks(ports);
  if (selected.data.intent === 'continue') {
    if (previous?.planningDraft && ports.planningModel) return prepareAssisted(request, ports, now, previous);
    if (previous?.pendingSchedule) {
      const title = groundedTitle({ titleSpan: request.input }, request.input);
      return title ? completeDraft(request, ports, now, { title, date: previous.pendingSchedule.date, startTime: previous.pendingSchedule.start, endTime: previous.pendingSchedule.end, mode: 'propose' })
        : { ...ask('Qual é o título do compromisso? O dia e os horários foram mantidos.'), pendingSchedule: previous.pendingSchedule };
    }
    if (previous?.eventDraft) return { ...ask(`Para ${previous.eventDraft.title}, informe ${previous.eventDraft.startTime ? 'o horário de fim' : 'o dia e os horários que faltam'}.`), eventDraft: previous.eventDraft };
    return clarify('Qual pedido você quer continuar? Preciso que ele esteja identificado nesta conversa.');
  }
  if (selected.data.intent === 'schedule') return ports.planningModel ? prepareAssisted(request, ports, now) : ask('Qual é o título, o dia e o intervalo de início e fim do compromisso?');
  if (selected.data.intent === 'study_suggestion') {
    const interpreted = interpretAgendaQuery(`Mostre minha agenda: ${request.input}`, now);
    if (/\b(?:[2-9]|dois|duas|tres|quatro|cinco|varios)\b/.test(plain(request.input))) return clarify('Nesta versão posso sugerir um bloco por vez. Para qual dia você quer a primeira sugestão?');
    if (interpreted?.kind !== 'query' || interpreted.query.from !== interpreted.query.to) return clarify('Você prefere um bloco de estudo hoje ou amanhã?');
    if (interpreted.query.pointTime || (interpreted.query.period && interpreted.query.period !== 'day')) return clarify('Seu pedido limita o horário de estudo. Posso sugerir um bloco usando a janela de preferência ou você quer informar um intervalo específico?');
    const day = interpreted.query.from === now.slice(0, 10) ? 'hoje' : interpreted.query.from === addDays(now.slice(0, 10), 1) ? 'amanhã' : null;
    return day ? proposeStudy({ ...request, input: `Sugira um bloco de estudo para ${day}` }, ports, now) : ask('Nesta versão sugiro estudo para hoje ou amanhã. Qual você prefere?');
  }
  if (selected.data.intent === 'unsupported') return { kind: 'unsupported', changed: false, evidenceIds: [], message: 'Esse pedido está fora das ferramentas disponíveis nesta versão. Posso consultar agenda, tarefas e preferências, preparar compromissos e sugerir um bloco de estudo. Nenhuma ação foi executada.' };
  if (selected.data.intent === 'clarify') return clarify('Você quer consultar sua agenda, ver tarefas, marcar um compromisso ou pedir uma sugestão de estudo?');
  return readMemory(request.input, ports);
}

async function readTasks(ports: ConversationPorts): Promise<DemoReply> {
  try {
    const context = await ports.reader.read('tasks');
    return { kind: 'answer', changed: false, evidenceIds: ['tasks/todo.md'], message: context.openTasks.length
      ? `Tarefas abertas:\n${context.openTasks.map((task) => `• ${task.text}`).join('\n')}` : 'Nenhuma tarefa aberta na fonte fictícia.' };
  } catch { return { kind: 'context_unavailable', changed: false, evidenceIds: [], message: 'Não consegui consultar as tarefas fictícias. Tente novamente.' }; }
}

function readCalendar(query: NonNullable<DemoReply['agendaQuery']>, ports: ConversationPorts): DemoReply {
  const entries = ports.agenda ? ports.agenda(query.from, query.to) : ports.state().events.map((event) => ({ id: event.id, ...event.details, allDay: false }));
  const events = eventsForQuery(entries, query);
  const details = events.map((event) => {
    const first = formatDateBR(event.start.slice(0, 10)), last = formatDateBR(event.end.slice(0, 10));
    return event.allDay ? `${first}${first !== last ? ` a ${last}` : ''}, dia inteiro: ${event.title}`
      : `${first} ${event.start.slice(11)} às ${first !== last ? last + ' ' : ''}${event.end.slice(11)}: ${event.title}`;
  });
  return { kind: 'answer', changed: false, evidenceIds: ['agenda'], agendaQuery: query, message: events.length
    ? `Seus compromissos em ${query.label}:\n${details.join('\n')}` : `Não encontrei compromissos cadastrados na agenda fictícia em ${query.label}.` };
}

async function prepareAssisted(request: { requestId: string; input: string }, ports: ConversationPorts, now: string, previous?: DemoReply): Promise<DemoReply> {
  const draft: PlanningDraft = { messages: [...(previous?.planningDraft?.messages ?? []), request.input], now: previous?.planningDraft?.now ?? now,
    ...(previous?.planningDraft?.titles ? { titles: previous.planningDraft.titles } : {}) };
  const blocked = planningGuard(draft.messages);
  if (blocked) return ask(blocked);
  let raw: unknown;
  try { raw = await ports.planningModel!(draft); }
  catch { return { kind: 'model_error', message: 'O modelo local não respondeu ao planejamento. Mantive o pedido para tentar novamente. Nenhuma parte foi aplicada.', evidenceIds: [], changed: false, planningDraft: previous?.planningDraft ?? draft }; }
  let result = validatePlanning(raw, draft, draft.now);
  if ('ask' in result && result.retryable) {
    try {
      raw = await ports.planningModel!(draft, `${result.feedback ?? ''} Confira TODOS os blocos. Copie títulos e dias literalmente das mensagens, sem traduzir. Use somente intervalos presentes nas mensagens humanas; quando faltar um campo, use null ou []. Não use dados dos exemplos.`);
      result = validatePlanning(raw, draft, draft.now);
    } catch { /* Uma pergunta segura mantém o pedido mesmo quando a correção falha. */ }
  }
  if ('ask' in result) {
    // Uma interpretação recusada não contamina o último rascunho já validado.
    const kept = result.draft?.missing?.length ? result.draft : previous?.planningDraft ?? result.draft;
    return { ...ask(result.ask), ...(kept ? { planningDraft: kept } : {}) };
  }
  if (!ports.plans) return ask('A ferramenta de planos não está disponível. Nenhuma parte foi aplicada.');
  const prepared = ports.plans.prepare(result.spec, { ...request, now });
  return prepared.kind === 'conflict' ? { ...prepared, planningDraft: { ...draft, titles: [...new Set(result.spec.events.map((event) => event.title))] } } : prepared;
}

function completeDraft(request: { requestId: string; input: string }, ports: ConversationPorts, now: string, draft: EventDraft): DemoReply {
  if (!draft.date) return { ...ask('Qual é a data desse compromisso? Os horários informados foram mantidos.'), eventDraft: draft };
  if (!draft.startTime || !draft.endTime) return { ...ask(draft.startTime
    ? `Certo, ${draft.title} em ${formatDateBR(draft.date)}, com início às ${draft.startTime}. Até que horário?`
    : `Certo, ${draft.title} em ${formatDateBR(draft.date)}. Qual é o horário de início e de fim?`), eventDraft: draft };
  const event = { title: draft.title, start: `${draft.date}T${draft.startTime}`, end: `${draft.date}T${draft.endTime}` };
  if (!timedEvent.safeParse(event).success) return { ...ask('O fim precisa ser depois do início, com horários válidos. Qual é o intervalo correto?'), eventDraft: draft };
  const result = draft.mode === 'create' ? ports.execute({ requestId: request.requestId, now,
    input: `Salve ${draft.title} ${draft.date} das ${draft.startTime} às ${draft.endTime}` })
    : ports.propose({ event, expectedVersion: ports.state(draft.date, draft.date).version,
      ...(draft.targetEventId ? { targetEventId: draft.targetEventId } : {}) }, request);
  const suggestion = result.suggestionId ? ports.state().suggestions.find((item) => item.id === result.suggestionId) : undefined;
  return { ...result, changed: result.kind === 'created', evidenceIds: ['agenda'], suggestion,
    ...(result.kind === 'conflict' || result.kind === 'ask' ? { eventDraft: draft } : {}),
    message: suggestion ? `Preparei ${draft.title} para ${formatDateBR(draft.date)}, das ${draft.startTime} às ${draft.endTime}. Confirme para ${draft.targetEventId ? 'alterar o compromisso' : 'registrar'} na agenda fictícia.` : result.message };
}

async function proposeStudy(request: { requestId: string; input: string }, ports: ConversationPorts, now: string): Promise<DemoReply> {
  const match = /^sugira (?:um )?bloco de estudo(?: para)? (hoje|amanha)[.!?]?$/.exec(plain(request.input));
  if (!match) return ask('Nesta demonstração, posso sugerir um bloco de estudo para hoje ou amanhã. Qual você prefere?');
  let text: string;
  try { text = (await ports.reader.read('memory')).sources.map((source) => source.text).join('\n'); }
  catch { return { kind: 'context_unavailable', changed: false, evidenceIds: [], message: 'Não consegui consultar a preferência de estudo fictícia.' }; }
  const duration = /blocos? de estudo de (\d{1,3}) minutos/i.exec(text)?.[1];
  const window = /janela de estudo:\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/i.exec(text);
  if (!duration || !window || Number(duration) < 5 || Number(duration) > 180) return ask('Preciso da duração e da janela de horário preferidas para sugerir o estudo.');
  const day = match[1] === 'amanha' ? addDays(now.slice(0, 10), 1) : now.slice(0, 10);
  const state = ports.state(day, day);
  const limit = `${day}T${window[2]}`;
  let start = `${day}T${window[1]}`;
  if (!timedEvent.safeParse({ title: 'Janela de estudo', start, end: limit }).success) return ask('A janela de estudo precisa ter horários válidos de início e fim.');
  for (let i = 0; i < 288 && start < limit; i++, start = addMinutes(start, 5)) {
    const end = addMinutes(start, Number(duration));
    if (start < now || end > limit) continue;
    if (state.events.some((event) => event.details.start < end && start < event.details.end)) continue;
    const result = ports.propose({ event: { title: 'Estudo', start, end }, expectedVersion: state.version }, request);
    const suggestion = result.suggestionId ? ports.state().suggestions.find((item) => item.id === result.suggestionId) : undefined;
    return { ...result, changed: false, evidenceIds: ['agenda', 'preferencias.md'], suggestion,
      message: result.kind === 'suggestion_pending' && suggestion
        ? `Sugiro ${suggestion.event.title.toLowerCase()} das ${suggestion.event.start.slice(11)} às ${suggestion.event.end.slice(11)} em ${day.split('-').reverse().join('/')}. Aguardo sua confirmação para registrar.`
        : result.message };
  }
  return ask('Não encontrei um intervalo livre na janela de estudo desse dia. Você prefere tentar amanhã ou escolher outro horário?');
}
