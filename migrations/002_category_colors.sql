-- A cor que o dono escolheu para cada categoria. Categoria sem linha usa a cor padrão do código.
CREATE TABLE IF NOT EXISTS category_colors (
  category TEXT PRIMARY KEY,
  color    TEXT NOT NULL
);

ALTER TABLE category_colors ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE papel TEXT;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON category_colors FROM %I', papel);
    END IF;
  END LOOP;
END $$;
