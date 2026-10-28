import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(config.dbDir, { recursive: true });

export const db = new DatabaseSync(config.dbPath);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    notes       TEXT,
    location    TEXT,
    start       TEXT NOT NULL,
    end         TEXT NOT NULL,
    all_day     INTEGER NOT NULL DEFAULT 0,
    category    TEXT NOT NULL DEFAULT 'outro',
    rrule       TEXT,
    exdates     TEXT NOT NULL DEFAULT '[]',
    source      TEXT NOT NULL DEFAULT 'app',
    external_id TEXT,
    is_suggestion INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS events_start_idx ON events(start);
  CREATE UNIQUE INDEX IF NOT EXISTS events_external_idx
    ON events(source, external_id) WHERE external_id IS NOT NULL;

  -- uma ocorrencia que fugiu da serie (movida, renomeada ou cancelada)
  CREATE TABLE IF NOT EXISTS overrides (
    event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    occurrence_date TEXT NOT NULL,
    title           TEXT,
    notes           TEXT,
    location        TEXT,
    start           TEXT,
    end             TEXT,
    canceled        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (event_id, occurrence_date)
  );

  -- trilha do que as IAs e o WhatsApp fizeram, pra auditoria
  CREATE TABLE IF NOT EXISTS audit (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    at        TEXT NOT NULL,
    actor     TEXT NOT NULL,
    action    TEXT NOT NULL,
    detail    TEXT
  );
`);

// Banco criado antes da coluna de sugestao precisa ganhar ela sem perder dado.
// Regra do Cesar (2026-10-27): nada sem horario definido entra no calendario.
{
  const colunas = db.prepare('PRAGMA table_info(events)').all() as Array<{ name: string }>;
  if (!colunas.some((c) => c.name === 'is_suggestion')) {
    db.exec('ALTER TABLE events ADD COLUMN is_suggestion INTEGER NOT NULL DEFAULT 0');
  }
}

/**
 * node:sqlite devolve Record<string, SQLOutputValue>; estes dois atalhos tipam a
 * leitura num lugar so, em vez de espalhar casts pelo codigo.
 */
export function queryAll<T>(sql: string, ...params: Array<string | number | null>): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

export function queryOne<T>(sql: string, ...params: Array<string | number | null>): T | null {
  return (db.prepare(sql).get(...params) as unknown as T | undefined) ?? null;
}

export function audit(actor: string, action: string, detail?: unknown): void {
  db.prepare('INSERT INTO audit (at, actor, action, detail) VALUES (?, ?, ?, ?)').run(
    new Date().toISOString(),
    actor,
    action,
    detail === undefined ? null : JSON.stringify(detail),
  );
}
