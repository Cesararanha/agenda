import { randomUUID } from 'node:crypto';
import { audit, queryAll, queryOne, run, transaction } from './store.js';
import { config } from './config.js';
import { BadRequest, NotFound } from './errors.js';
import {
  addDays,
  addMinutes,
  dateOf,
  diffDays,
  durationMinutes,
  isDateStr,
  isDateTimeStr,
  joinDateTime,
  now,
  timeOf,
} from '../shared/dates.js';
import { formatRrule, occurrenceDates, parseRrule, type Rrule } from '../shared/recurrence.js';
import {
  CATEGORIES,
  type Category,
  type DateStr,
  type EventInput,
  type EventRow,
  type EventSource,
  type Occurrence,
} from '../shared/types.js';

export type EditScope = 'this' | 'future' | 'all';

interface OverrideRow {
  event_id: string;
  occurrence_date: DateStr;
  title: string | null;
  notes: string | null;
  location: string | null;
  start: string | null;
  end: string | null;
  canceled: 0 | 1;
}

export { BadRequest, NotFound };

function normalizeCategory(value: unknown): Category {
  return CATEGORIES.includes(value as Category) ? (value as Category) : 'outro';
}

/** Aceita '2026-10-27T14:00', '2026-10-27 14:00', '2026-10-27T14:00:00' e '2026-10-27'. */
function normalizeMoment(value: string, label: string): string {
  const v = value.trim().replace(' ', 'T');
  if (isDateStr(v)) return v;
  if (isDateTimeStr(v)) return v;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) return v.slice(0, 16);
  throw new BadRequest(`${label} invalido: use 'YYYY-MM-DD' ou 'YYYY-MM-DDTHH:mm' (recebi '${value}')`);
}

function rowToOccurrence(
  row: EventRow,
  occurrenceDate: DateStr,
  override: OverrideRow | undefined,
): Occurrence {
  const allDay = row.all_day === 1;
  const anchor = dateOf(row.start);
  const spanDays = Math.max(0, diffDays(dateOf(row.end), anchor));

  let start: string;
  let end: string;
  if (override?.start) {
    start = override.start;
    end = override.end ?? (allDay ? override.start : addMinutes(override.start, 60));
  } else if (allDay) {
    start = occurrenceDate;
    end = addDays(occurrenceDate, spanDays);
  } else {
    start = joinDateTime(occurrenceDate, timeOf(row.start));
    end = addMinutes(start, durationMinutes(row.start, row.end));
  }

  const category = normalizeCategory(row.category);
  return {
    id: `${row.id}:${occurrenceDate}`,
    occurrenceId: `${row.id}:${occurrenceDate}`,
    seriesId: row.id,
    occurrenceDate,
    title: override?.title ?? row.title,
    notes: override?.notes ?? row.notes,
    location: override?.location ?? row.location,
    start,
    end,
    allDay,
    category,
    recurring: Boolean(row.rrule),
    rrule: row.rrule,
    source: row.source,
    overridden: Boolean(override && (override.start || override.title || override.notes)),
    suggestion: row.is_suggestion === 1,
  };
}

export async function getSeries(id: string): Promise<EventRow | null> {
  return queryOne<EventRow>('SELECT * FROM events WHERE id = ?', id);
}

async function overridesFor(ids: string[]): Promise<Map<string, OverrideRow>> {
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await queryAll<OverrideRow>(
    `SELECT * FROM overrides WHERE event_id IN (${placeholders})`,
    ...ids,
  );
  return new Map(rows.map((r) => [`${r.event_id}:${r.occurrence_date}`, r]));
}

export interface ListFilters {
  category?: Category;
  source?: EventSource;
  search?: string;
}

/** Ocorrencias concretas no intervalo [from, to], ja ordenadas. */
export async function listOccurrences(from: DateStr, to: DateStr, filters: ListFilters = {}): Promise<Occurrence[]> {
  if (!isDateStr(from) || !isDateStr(to)) throw new BadRequest("'from' e 'to' precisam ser 'YYYY-MM-DD'");
  if (from > to) throw new BadRequest("'from' precisa ser menor ou igual a 'to'");

  const rows = await queryAll<EventRow>(
    `SELECT * FROM events
     WHERE is_suggestion = 0
       AND ((rrule IS NULL AND substr("end", 1, 10) >= ? AND substr(start, 1, 10) <= ?)
            OR (rrule IS NOT NULL AND substr(start, 1, 10) <= ?)
            OR EXISTS (SELECT 1 FROM overrides o WHERE o.event_id = events.id AND o.canceled = 0
              AND o.start IS NOT NULL AND substr(o.start, 1, 10) <= ? AND substr(COALESCE(o."end", o.start), 1, 10) >= ?))`,
    from,
    to,
    to,
    to,
    from,
  );

  const overrides = await overridesFor(rows.map((r) => r.id));
  const out: Occurrence[] = [];

  for (const row of rows) {
    if (filters.category && normalizeCategory(row.category) !== filters.category) continue;
    if (filters.source && row.source !== filters.source) continue;

    const anchor = dateOf(row.start);
    const spanDays = Math.max(0, diffDays(dateOf(row.end), anchor));
    // evento que comeca antes da janela mas invade ela
    const searchFrom = spanDays > 0 ? addDays(from, -spanDays) : from;
    const rule = parseRrule(row.rrule);
    const exdates = new Set<string>(JSON.parse(row.exdates || '[]') as string[]);

    const dates = new Set(occurrenceDates(anchor, rule, searchFrom, to));
    // Uma exceção pode ter sido movida de fora da janela, inclusive de uma série futura.
    for (const override of overrides.values()) {
      if (override.event_id !== row.id || override.canceled || !override.start
        || dateOf(override.start) > to || dateOf(override.end ?? override.start) < from) continue;
      if (occurrenceDates(anchor, rule, override.occurrence_date, override.occurrence_date).length) dates.add(override.occurrence_date);
    }
    for (const date of dates) {
      if (exdates.has(date)) continue;
      const override = overrides.get(`${row.id}:${date}`);
      if (override?.canceled) continue;
      const occ = rowToOccurrence(row, date, override);
      if (dateOf(occ.end) < from || dateOf(occ.start) > to) continue;
      if (filters.search) {
        const needle = filters.search.toLowerCase();
        const haystack = `${occ.title} ${occ.notes ?? ''} ${occ.location ?? ''}`.toLowerCase();
        if (!haystack.includes(needle)) continue;
      }
      out.push(occ);
    }
  }

  return out.sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    if (a.start !== b.start) return a.start < b.start ? -1 : 1;
    return a.title.localeCompare(b.title, 'pt-BR');
  });
}

export async function createEvent(input: EventInput, actor = 'app'): Promise<Occurrence> {
  if (!input.title?.trim()) throw new BadRequest('titulo e obrigatorio');

  const start = normalizeMoment(input.start, 'start');
  const allDay = input.allDay ?? isDateStr(start);
  let end: string;

  if (input.end) {
    end = normalizeMoment(input.end, 'end');
  } else {
    end = allDay ? dateOf(start) : addMinutes(start, 60);
  }

  if (allDay) {
    end = dateOf(end);
    if (end < dateOf(start)) throw new BadRequest('fim antes do inicio');
  } else {
    if (isDateStr(end)) end = joinDateTime(end, timeOf(start) ?? '00:00');
    if (end <= start) throw new BadRequest('fim precisa ser depois do inicio');
  }

  const rule = parseRrule(input.rrule ?? null);
  if (input.rrule && !rule) throw new BadRequest(`rrule invalido: '${input.rrule}'`);

  const timestamp = new Date().toISOString();
  const row: EventRow = {
    id: randomUUID(),
    title: input.title.trim(),
    notes: input.notes?.trim() || null,
    location: input.location?.trim() || null,
    start: allDay ? dateOf(start) : start,
    end,
    all_day: allDay ? 1 : 0,
    category: normalizeCategory(input.category),
    rrule: formatRrule(rule),
    exdates: '[]',
    source: input.source ?? 'app',
    external_id: input.externalId ?? null,
    is_suggestion: input.suggestion ? 1 : 0,
    created_at: timestamp,
    updated_at: timestamp,
  };

  await run(`INSERT INTO events (id, title, notes, location, start, "end", all_day, category, rrule, exdates, source, external_id, is_suggestion, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, row.id,
    row.title,
    row.notes,
    row.location,
    row.start,
    row.end,
    row.all_day,
    row.category,
    row.rrule,
    row.exdates,
    row.source,
    row.external_id,
    row.is_suggestion,
    row.created_at,
    row.updated_at,
  );

  await audit(actor, 'create', { id: row.id, title: row.title, start: row.start, rrule: row.rrule });
  return rowToOccurrence(row, dateOf(row.start), undefined);
}

export interface PatchInput {
  title?: string;
  notes?: string | null;
  location?: string | null;
  category?: Category;
  start?: string;
  end?: string;
  allDay?: boolean;
  rrule?: string | null;
}

/** Edita a serie inteira. */
async function patchSeries(row: EventRow, patch: PatchInput, actor: string): Promise<Occurrence> {
  const allDay = patch.allDay ?? row.all_day === 1;
  if (allDay !== (row.all_day === 1) && await queryOne<{ present: number }>('SELECT 1 AS present FROM overrides WHERE event_id = ? LIMIT 1', row.id)) {
    throw new BadRequest('A série tem ocorrências editadas. Revise as exceções antes de mudar entre dia inteiro e horário definido. Nenhuma alteração foi aplicada.');
  }
  let start = patch.start ? normalizeMoment(patch.start, 'start') : row.start;
  let end = patch.end ? normalizeMoment(patch.end, 'end') : row.end;

  if (allDay) {
    start = dateOf(start);
    end = dateOf(end);
    if (end < start) end = start;
  } else {
    if (isDateStr(start)) start = joinDateTime(start, timeOf(row.start) ?? '09:00');
    if (isDateStr(end)) end = joinDateTime(end, timeOf(row.end) ?? timeOf(start) ?? '10:00');
    if (patch.start && !patch.end) {
      end = addMinutes(start, durationMinutes(row.start, row.end) || 60);
    }
    if (end <= start) end = addMinutes(start, 60);
  }

  let rrule = row.rrule;
  if (patch.rrule !== undefined) {
    const rule = parseRrule(patch.rrule);
    if (patch.rrule && !rule) throw new BadRequest(`rrule invalido: '${patch.rrule}'`);
    rrule = formatRrule(rule);
  }

  const updated: EventRow = {
    ...row,
    title: patch.title?.trim() || row.title,
    notes: patch.notes === undefined ? row.notes : patch.notes?.trim() || null,
    location: patch.location === undefined ? row.location : patch.location?.trim() || null,
    category: patch.category ? normalizeCategory(patch.category) : normalizeCategory(row.category),
    start,
    end,
    all_day: allDay ? 1 : 0,
    rrule,
    updated_at: new Date().toISOString(),
  };

  await run(`UPDATE events SET title = ?, notes = ?, location = ?, start = ?, "end" = ?, all_day = ?,
       category = ?, rrule = ?, updated_at = ? WHERE id = ?`, updated.title,
    updated.notes,
    updated.location,
    updated.start,
    updated.end,
    updated.all_day,
    updated.category,
    updated.rrule,
    updated.updated_at,
    updated.id,
  );

  await audit(actor, 'update:all', { id: updated.id, title: updated.title, start: updated.start });
  return rowToOccurrence(updated, dateOf(updated.start), undefined);
}

/** Edita so a ocorrencia daquele dia, deixando a serie intacta. */
async function patchOccurrence(
  row: EventRow,
  occurrenceDate: DateStr,
  patch: PatchInput,
  actor: string,
): Promise<Occurrence> {
  const current = rowToOccurrence(
    row,
    occurrenceDate,
    (await queryOne<OverrideRow>(
      'SELECT * FROM overrides WHERE event_id = ? AND occurrence_date = ?',
      row.id,
      occurrenceDate,
    )) ?? undefined,
  );

  if ((patch.allDay !== undefined && patch.allDay !== current.allDay)
    || (patch.category !== undefined && normalizeCategory(patch.category) !== current.category)
    || (patch.rrule !== undefined && patch.rrule !== row.rrule)) {
    throw new BadRequest('Para mudar categoria, dia inteiro ou repetição, escolha daqui para frente ou a série toda.');
  }

  const allDay = patch.allDay ?? current.allDay;
  let start = patch.start ? normalizeMoment(patch.start, 'start') : current.start;
  let end = patch.end ? normalizeMoment(patch.end, 'end') : current.end;

  if (allDay) {
    start = dateOf(start);
    end = dateOf(end) < start ? start : dateOf(end);
  } else {
    if (isDateStr(start)) start = joinDateTime(start, timeOf(current.start) ?? '09:00');
    if (patch.start && !patch.end) {
      end = addMinutes(start, durationMinutes(current.start, current.end) || 60);
    } else if (isDateStr(end)) {
      end = joinDateTime(end, timeOf(current.end) ?? '10:00');
    }
    if (end <= start) end = addMinutes(start, 60);
  }

  await run(`INSERT INTO overrides (event_id, occurrence_date, title, notes, location, start, "end", canceled)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(event_id, occurrence_date) DO UPDATE SET
       title = excluded.title, notes = excluded.notes, location = excluded.location,
       start = excluded.start, "end" = excluded."end", canceled = 0`, row.id,
    occurrenceDate,
    patch.title?.trim() ?? current.title,
    patch.notes === undefined ? current.notes : patch.notes?.trim() || null,
    patch.location === undefined ? current.location : patch.location?.trim() || null,
    start,
    end,
    );

  await audit(actor, 'update:this', { id: row.id, occurrenceDate, start });
  return (await listOccurrences(dateOf(start), dateOf(start))).find((o) => o.seriesId === row.id && o.occurrenceDate === occurrenceDate) ??
    rowToOccurrence(row, occurrenceDate, undefined);
}

/** Corta a serie no dia e recomeca uma nova com os valores novos. */
async function patchFuture(
  row: EventRow,
  occurrenceDate: DateStr,
  patch: PatchInput,
  actor: string,
): Promise<Occurrence> {
  const rule = parseRrule(row.rrule);
  if (!rule) return patchSeries(row, patch, actor);

  const cutoff = addDays(occurrenceDate, -1);
  if (cutoff < dateOf(row.start)) {
    // a mudanca comeca na primeira ocorrencia: nao ha passado pra preservar
    return patchSeries(row, patch, actor);
  }

  const futureOverrides = await queryAll<OverrideRow>('SELECT * FROM overrides WHERE event_id = ? AND occurrence_date >= ?', row.id, occurrenceDate);
  const exdates = JSON.parse(row.exdates || '[]') as string[];
  const futureExdates = exdates.filter((date) => date >= occurrenceDate);
  const inheritedRule = patch.rrule === undefined || patch.rrule === row.rrule;
  const requestedStart = patch.start ? normalizeMoment(patch.start, 'start') : rowToOccurrence(row, occurrenceDate, undefined).start;
  if ((futureOverrides.length || futureExdates.length) && (!inheritedRule || dateOf(requestedStart) !== occurrenceDate || (patch.allDay !== undefined && patch.allDay !== (row.all_day === 1)))) {
    throw new BadRequest('Há exceções futuras nessa série. Revise as exceções antes de mudar o dia, a repetição ou o tipo de horário. Nenhuma alteração foi aplicada.');
  }
  const remaining = rule.count ? rule.count - occurrenceDates(dateOf(row.start), rule, dateOf(row.start), cutoff).length : undefined;
  const trimmed: Rrule = { ...rule, until: cutoff };
  await run('UPDATE events SET rrule = ?, exdates = ?, updated_at = ? WHERE id = ?', formatRrule(trimmed),
    JSON.stringify(exdates.filter((date) => date < occurrenceDate)),
    new Date().toISOString(),
    row.id,
  );

  const current = rowToOccurrence(row, occurrenceDate, undefined);
  const created = await createEvent(
    {
      title: patch.title ?? current.title,
      notes: patch.notes === undefined ? current.notes : patch.notes,
      location: patch.location === undefined ? current.location : patch.location,
      category: patch.category ?? current.category,
      start: patch.start ?? current.start,
      end: patch.end ?? current.end,
      allDay: patch.allDay ?? current.allDay,
      rrule: inheritedRule ? formatRrule({ ...rule, count: remaining }) : patch.rrule,
      source: row.source,
    },
    actor,
  );

  if (futureExdates.length) await run('UPDATE events SET exdates = ? WHERE id = ?', JSON.stringify(futureExdates), created.seriesId);
  await run('UPDATE overrides SET event_id = ? WHERE event_id = ? AND occurrence_date >= ?', created.seriesId, row.id, occurrenceDate);

  await audit(actor, 'update:future', { id: row.id, from: occurrenceDate, newId: created.seriesId });
  return created;
}

export async function updateEvent(
  id: string,
  patch: PatchInput,
  scope: EditScope = 'all',
  occurrenceDate?: DateStr,
  actor = 'app',
): Promise<Occurrence> {
  return transaction(() => updateEventInternal(id, patch, scope, occurrenceDate, actor));
}
async function updateEventInternal(id: string, patch: PatchInput, scope: EditScope, occurrenceDate: DateStr | undefined, actor: string): Promise<Occurrence> {
  const row = await getSeries(id);
  if (!row) throw new NotFound(`evento ${id} nao existe`);

  if (scope === 'all' || !row.rrule) return patchSeries(row, patch, actor);
  if (!occurrenceDate || !isDateStr(occurrenceDate)) {
    throw new BadRequest("para escopo 'this' ou 'future' informe 'occurrence' ('YYYY-MM-DD')");
  }
  if (!occurrenceDates(dateOf(row.start), parseRrule(row.rrule), occurrenceDate, occurrenceDate).length) {
    throw new BadRequest('A data informada não corresponde a uma ocorrência dessa série.');
  }
  if (scope === 'this') return patchOccurrence(row, occurrenceDate, patch, actor);
  return patchFuture(row, occurrenceDate, patch, actor);
}

export async function deleteEvent(
  id: string,
  scope: EditScope = 'all',
  occurrenceDate?: DateStr,
  actor = 'app',
): Promise<{ deleted: EditScope }> {
  return transaction(() => deleteEventInternal(id, scope, occurrenceDate, actor));
}
async function deleteEventInternal(id: string, scope: EditScope, occurrenceDate: DateStr | undefined, actor: string): Promise<{ deleted: EditScope }> {
  const row = await getSeries(id);
  if (!row) throw new NotFound(`evento ${id} nao existe`);

  if (scope === 'all' || !row.rrule) {
    await run('DELETE FROM events WHERE id = ?', id);
    await audit(actor, 'delete:all', { id, title: row.title });
    return { deleted: 'all' };
  }

  if (!occurrenceDate || !isDateStr(occurrenceDate)) {
    throw new BadRequest("para escopo 'this' ou 'future' informe 'occurrence' ('YYYY-MM-DD')");
  }
  if (!occurrenceDates(dateOf(row.start), parseRrule(row.rrule), occurrenceDate, occurrenceDate).length) {
    throw new BadRequest('A data informada não corresponde a uma ocorrência dessa série.');
  }

  if (scope === 'this') {
    const exdates = new Set<string>(JSON.parse(row.exdates || '[]') as string[]);
    exdates.add(occurrenceDate);
    await run('UPDATE events SET exdates = ?, updated_at = ? WHERE id = ?', JSON.stringify([...exdates].sort()),
      new Date().toISOString(),
      id,
    );
    await run('DELETE FROM overrides WHERE event_id = ? AND occurrence_date = ?', id,
      occurrenceDate,
    );
    await audit(actor, 'delete:this', { id, occurrenceDate });
    return { deleted: 'this' };
  }

  const rule = parseRrule(row.rrule);
  const cutoff = addDays(occurrenceDate, -1);
  if (!rule || cutoff < dateOf(row.start)) {
    await run('DELETE FROM events WHERE id = ?', id);
    await audit(actor, 'delete:future->all', { id });
    return { deleted: 'all' };
  }
  await run('UPDATE events SET rrule = ?, updated_at = ? WHERE id = ?', formatRrule({ ...rule, until: cutoff }),
    new Date().toISOString(),
    id,
  );
  await run('DELETE FROM overrides WHERE event_id = ? AND occurrence_date >= ?', id, occurrenceDate);
  await audit(actor, 'delete:future', { id, from: occurrenceDate });
  return { deleted: 'future' };
}

/** Sincroniza os itens de um vault: cria, atualiza e remove o que saiu de la. */
export async function syncExternal(
  source: EventSource,
  prefix: string,
  items: Array<EventInput & { externalId: string }>,
  actor = 'vault',
): Promise<{ created: number; updated: number; removed: number }> {
  const existing = await queryAll<
    Pick<EventRow, 'id' | 'external_id' | 'title' | 'start' | 'end' | 'all_day' | 'category' | 'notes'>
  >(
    `SELECT id, external_id, title, start, "end", all_day, category, notes
     FROM events WHERE source = ? AND external_id LIKE ?`,
    source,
    `${prefix}%`,
  );

  const byExternal = new Map(existing.map((e) => [e.external_id ?? '', e]));
  const seen = new Set<string>();
  let created = 0;
  let updated = 0;

  for (const item of items) {
    seen.add(item.externalId);
    const current = byExternal.get(item.externalId);
    if (!current) {
      await createEvent({ ...item, source }, actor);
      created++;
      continue;
    }
    const start = normalizeMoment(item.start, 'start');
    const changed =
      current.title !== item.title ||
      current.start !== start ||
      (item.notes ?? null) !== current.notes;
    if (changed) {
      await updateEvent(
        current.id,
        { title: item.title, start: item.start, end: item.end, notes: item.notes ?? null, category: item.category },
        'all',
        undefined,
        actor,
      );
      updated++;
    }
  }

  let removed = 0;
  for (const [externalId, row] of byExternal) {
    if (seen.has(externalId)) continue;
    await run('DELETE FROM events WHERE id = ?', row.id);
    removed++;
  }

  await audit(actor, 'sync', { source, prefix, created, updated, removed });
  return { created, updated, removed };
}

/**
 * As sugestoes: o que tem data mas nao tem hora marcada.
 *
 * Regra do Cesar (2026-10-27): nada entra no calendario sem horario definido. O
 * prazo que vem do vault sabe o dia, nunca a hora, entao vive aqui ate ele
 * decidir a hora. Nada se perde, so nao polui a semana.
 */
export async function listSuggestions(from: DateStr, to: DateStr): Promise<Occurrence[]> {
  if (!isDateStr(from) || !isDateStr(to)) throw new BadRequest("'from' e 'to' precisam ser 'YYYY-MM-DD'");
  const rows = await queryAll<EventRow>(
    `SELECT * FROM events
     WHERE is_suggestion = 1 AND substr(start, 1, 10) >= ? AND substr(start, 1, 10) <= ?
     ORDER BY start`,
    from,
    to,
  );
  return rows.map((row) => rowToOccurrence(row, dateOf(row.start), undefined));
}

/** Resumo em texto, pro WhatsApp e pras IAs. */
export async function summarize(from: DateStr, to: DateStr): Promise<string> {
  const occurrences = await listOccurrences(from, to);
  if (!occurrences.length) return 'Nada na agenda nesse periodo.';

  const byDay = new Map<DateStr, Occurrence[]>();
  for (const occ of occurrences) {
    const key = dateOf(occ.start);
    const list = byDay.get(key) ?? [];
    list.push(occ);
    byDay.set(key, list);
  }

  const lines: string[] = [];
  for (const day of [...byDay.keys()].sort()) {
    lines.push(`*${day.slice(8, 10)}/${day.slice(5, 7)}*`);
    for (const occ of byDay.get(day) ?? []) {
      const time = occ.allDay ? 'dia inteiro' : `${timeOf(occ.start)}-${timeOf(occ.end)}`;
      lines.push(`  ${time}  ${occ.title}${occ.location ? ` (${occ.location})` : ''}`);
    }
  }
  return lines.join('\n');
}

export const serverNow = () => now(config.tz);
