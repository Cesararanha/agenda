import type { FastifyInstance } from 'fastify';
import {
  createEvent,
  deleteEvent,
  getSeries,
  listOccurrences,
  listSuggestions,
  summarize,
  updateEvent,
  type EditScope,
  type PatchInput,
} from '../events.js';
import { config } from '../config.js';
import { proposeQuickAdd, quickConfirmation, quickInput, saveQuickAdd } from '../agent/quick-add.js';
import {
  addDays,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
  today,
} from '../../shared/dates.js';
import { isPaletteColor } from '../../shared/cores.js';
import { CATEGORIES, type Category, type EventSource } from '../../shared/types.js';
import { categoryColors, setCategoryColor } from '../category-colors.js';

interface RangeQuery {
  from?: string;
  to?: string;
  date?: string;
  category?: Category;
  source?: EventSource;
  q?: string;
}

interface ScopeQuery {
  scope?: EditScope;
  occurrence?: string;
}

function scopeOf(query: ScopeQuery): EditScope {
  const scope = query.scope;
  return scope === 'this' || scope === 'future' || scope === 'all' ? scope : 'all';
}

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/meta', async () => ({
    today: config.agentDemoNow ? config.agentDemoNow.slice(0, 10) : today(config.tz),
    tz: config.tz,
    categories: await categoryColors(),
    vaults: config.vaults.map((v) => v.label),
    whatsapp: config.whatsapp.enabled,
    agentSandbox: config.agentSandbox,
    ...(config.agentSandbox ? { agentDemoId: config.agentDemoId } : {}),
  }));

  app.put<{ Params: { id: string } }>('/api/categories/:id/color', async (request, reply) => {
    const category = request.params.id as Category;
    const color = (request.body as { color?: unknown } | null)?.color;
    if (!CATEGORIES.includes(category)) return reply.code(404).send({ error: 'categoria nao encontrada' });
    if (!isPaletteColor(color)) return reply.code(400).send({ error: 'cor fora da paleta' });
    await setCategoryColor(category, color);
    return { categories: await categoryColors() };
  });

  app.get<{ Querystring: RangeQuery }>('/api/events', async (request) => {
    const q = request.query;
    const anchor = q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : today(config.tz);
    const from = q.from ?? anchor;
    const to = q.to ?? anchor;
    return {
      from,
      to,
      events: await listOccurrences(from, to, { category: q.category, source: q.source, search: q.q }),
    };
  });

  // o que tem data mas nao tem hora: nao entra no calendario, fica aqui
  app.get<{ Querystring: RangeQuery }>('/api/suggestions', async (request) => {
    const q = request.query;
    const from = q.from ?? today(config.tz);
    const to = q.to ?? addDays(from, 90);
    return { from, to, suggestions: await listSuggestions(from, to) };
  });

  app.get<{ Querystring: RangeQuery }>('/api/week', async (request) => {
    const anchor = request.query.date ?? today(config.tz);
    const from = startOfWeek(anchor);
    const to = endOfWeek(anchor);
    return { from, to, events: await listOccurrences(from, to) };
  });

  app.get<{ Querystring: RangeQuery }>('/api/month', async (request) => {
    const anchor = request.query.date ?? today(config.tz);
    const from = startOfWeek(startOfMonth(anchor));
    const to = addDays(from, 41);
    return { from, to, month: anchor.slice(0, 7), monthEnd: endOfMonth(anchor), events: await listOccurrences(from, to) };
  });

  app.get<{ Params: { date: string } }>('/api/day/:date', async (request) => {
    const { date } = request.params;
    return { date, events: await listOccurrences(date, date) };
  });

  app.get<{ Querystring: RangeQuery }>('/api/summary', async (request) => {
    const from = request.query.from ?? today(config.tz);
    const to = request.query.to ?? from;
    return { from, to, text: await summarize(from, to) };
  });

  app.get<{ Params: { id: string } }>('/api/events/:id', async (request, reply) => {
    const row = await getSeries(request.params.id);
    if (!row) return reply.code(404).send({ error: 'evento nao encontrado' });
    return row;
  });

  app.post('/api/events', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const created = await createEvent(
      {
        title: String(body.title ?? ''),
        start: String(body.start ?? ''),
        end: body.end === undefined || body.end === null ? undefined : String(body.end),
        allDay: body.allDay === undefined ? undefined : Boolean(body.allDay),
        notes: body.notes === undefined ? undefined : (body.notes as string | null),
        location: body.location === undefined ? undefined : (body.location as string | null),
        category: body.category as Category | undefined,
        rrule: body.rrule === undefined ? undefined : (body.rrule as string | null),
        source: (body.source as EventSource | undefined) ?? 'app',
      },
      String((request.headers['x-agenda-actor'] as string) ?? 'app'),
    );
    return reply.code(201).send(created);
  });

  app.post('/api/quick-add', async (request, reply) => {
    const parsed = quickInput.safeParse((request.body as { text?: unknown } | null)?.text);
    if (!parsed.success) return reply.code(400).send({ error: 'Envie uma frase de até 1500 caracteres.' });
    return proposeQuickAdd(parsed.data);
  });

  app.post('/api/quick-add/confirm', async (request, reply) => {
    const body = request.body as { drafts?: unknown; saveWithoutTime?: unknown; suggestionId?: unknown } | null;
    const parsed = quickConfirmation.safeParse(body?.drafts);
    if (!parsed.success) return reply.code(400).send({ error: 'Confira os campos do compromisso.' });
    const suggestionId = body?.suggestionId;
    if (suggestionId !== undefined && (typeof suggestionId !== 'string' || parsed.data.length !== 1 || !parsed.data[0]?.time)) {
      return reply.code(400).send({ error: 'Escolha um horário para a sugestão.' });
    }
    return reply.code(201).send({ events: await saveQuickAdd(parsed.data, 'app', {
      allowSuggestions: body?.saveWithoutTime === true, replaceSuggestion: suggestionId,
    }) });
  });

  app.patch<{ Params: { id: string }; Querystring: ScopeQuery }>(
    '/api/events/:id',
    async (request) => {
      const body = request.body as Record<string, unknown>;
      const patch: PatchInput = {};
      if (body.title !== undefined) patch.title = String(body.title);
      if (body.notes !== undefined) patch.notes = body.notes as string | null;
      if (body.location !== undefined) patch.location = body.location as string | null;
      if (body.category !== undefined) patch.category = body.category as Category;
      if (body.start !== undefined) patch.start = String(body.start);
      if (body.end !== undefined) patch.end = String(body.end);
      if (body.allDay !== undefined) patch.allDay = Boolean(body.allDay);
      if (body.rrule !== undefined) patch.rrule = body.rrule as string | null;

      return updateEvent(
        request.params.id,
        patch,
        scopeOf(request.query),
        request.query.occurrence,
        String((request.headers['x-agenda-actor'] as string) ?? 'app'),
      );
    },
  );

  app.delete<{ Params: { id: string }; Querystring: ScopeQuery }>(
    '/api/events/:id',
    async (request) =>
      deleteEvent(
        request.params.id,
        scopeOf(request.query),
        request.query.occurrence,
        String((request.headers['x-agenda-actor'] as string) ?? 'app'),
      ),
  );
}
