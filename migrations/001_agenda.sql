-- Schema da agenda no Postgres. A API automática do Supabase não deve ler estas tabelas:
-- o RLS fica ligado e sem política, e só o servidor da agenda acessa, como dono das tabelas.
CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  notes         TEXT,
  location      TEXT,
  start         TEXT NOT NULL,
  "end"         TEXT NOT NULL,
  all_day       INTEGER NOT NULL DEFAULT 0,
  category      TEXT NOT NULL DEFAULT 'outro',
  rrule         TEXT,
  exdates       TEXT NOT NULL DEFAULT '[]',
  source        TEXT NOT NULL DEFAULT 'app',
  external_id   TEXT,
  is_suggestion INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_start_idx ON events(start);
CREATE UNIQUE INDEX IF NOT EXISTS events_external_idx ON events(source, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS overrides (
  event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  occurrence_date TEXT NOT NULL,
  title           TEXT,
  notes           TEXT,
  location        TEXT,
  start           TEXT,
  "end"           TEXT,
  canceled        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, occurrence_date)
);

CREATE TABLE IF NOT EXISTS audit (
  id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at     TEXT NOT NULL,
  actor  TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS whatsapp_proposals (
  code       TEXT PRIMARY KEY,
  sender     TEXT NOT NULL,
  message_id TEXT,
  expires    BIGINT NOT NULL,
  drafts     TEXT NOT NULL,
  preview    TEXT NOT NULL,
  confirmed  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (sender, message_id)
);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_proposals ENABLE ROW LEVEL SECURITY;

-- Os papéis anon e authenticated só existem no Supabase.
DO $$
DECLARE papel TEXT;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON events, overrides, audit, whatsapp_proposals FROM %I', papel);
    END IF;
  END LOOP;
END $$;
