import type { FastifyInstance } from 'fastify';
import {
  createEvent,
  deleteEvent,
  getSeries,
  listOccurrences,
  summarize,
  updateEvent,
  type EditScope,
  type PatchInput,
} from '../events.js';
import { config } from '../config.js';
import { parseQuickAdd } from '../nlp.js';
import {
  addDays,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
  today,
} from '../../shared/dates.js';
import { CATEGORIES, CATEGORY_COLORS, type Category, type EventSource } from '../../shared/types.js';

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
    categories: CATEGORIES.map((c) => ({ id: c, color: CATEGORY_COLORS[c] })),
    vaults: config.vaults.map((v) => v.label),
    whatsapp: config.whatsapp.enabled,
    agentSandbox: config.agentSandbox,
    ...(config.agentSandbox ? { agentDemoId: config.agentDemoId } : {}),
  }));

  app.get<{ Querystring: RangeQuery }>('/api/events', async (request) => {
    const q = request.query;
    const anchor = q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : today(config.tz);
    const from = q.from ?? anchor;
    const to = q.to ?? anchor;
    return {
      from,
      to,
      events: listOccurrences(from, to, { category: q.category, source: q.source, search: q.q }),
    };
  });

  app.get<{ Querystring: RangeQuery }>('/api/week', async (request) => {
    const anchor = request.query.date ?? today(config.tz);
    const from = startOfWeek(anchor);
    const to = endOfWeek(anchor);
    return { from, to, events: listOccurrences(from, to) };
  });

  app.get<{ Querystring: RangeQuery }>('/api/month', async (request) => {
    const anchor = request.query.date ?? today(config.tz);
    const from = startOfWeek(startOfMonth(anchor));
    const to = addDays(from, 41);
    return { from, to, month: anchor.slice(0, 7), monthEnd: endOfMonth(anchor), events: listOccurrences(from, to) };
  });

  app.get<{ Params: { date: string } }>('/api/day/:date', async (request) => {
    const { date } = request.params;
    return { date, events: listOccurrences(date, date) };
  });

  app.get<{ Querystring: RangeQuery }>('/api/summary', async (request) => {
    const from = request.query.from ?? today(config.tz);
    const to = request.query.to ?? from;
    return { from, to, text: summarize(from, to) };
  });

  app.get<{ Params: { id: string } }>('/api/events/:id', async (request, reply) => {
    const row = getSeries(request.params.id);
    if (!row) return reply.code(404).send({ error: 'evento nao encontrado' });
    return row;
  });

  app.post('/api/events', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const created = createEvent(
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

  /** Marca a partir de uma frase solta: "amanha 14h dentista". */
  app.post('/api/quick-add', async (request, reply) => {
    const { text, source } = (request.body ?? {}) as { text?: string; source?: EventSource };
    if (!text?.trim()) return reply.code(400).send({ error: 'texto vazio' });
    const parsed = parseQuickAdd(text, config.tz);
    const created = createEvent(
      {
        title: parsed.title,
        start: parsed.start,
        end: parsed.end,
        allDay: parsed.allDay,
        category: parsed.category,
        rrule: parsed.rrule,
        source: source ?? 'app',
      },
      source ?? 'app',
    );
    return reply.code(201).send({ interpretado: parsed, evento: created });
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
