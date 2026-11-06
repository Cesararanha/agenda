-- Categorias passam a ser do dono: ele adiciona, remove e escolhe a cor.
-- Só semeia com a tabela vazia, porque as migrações rodam de novo e a categoria removida não pode voltar.
CREATE TABLE IF NOT EXISTS categories (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  color    TEXT NOT NULL,
  position INTEGER NOT NULL
);

INSERT INTO categories (id, name, color, position)
SELECT padrao.id, padrao.name, COALESCE(escolhida.color, padrao.color), padrao.position
FROM (VALUES
  ('faculdade', 'Faculdade', '#0fa3b1', 0),
  ('trabalho', 'Trabalho', '#7a4fd0', 1),
  ('projeto', 'Projeto', '#e5532d', 2),
  ('estudo', 'Estudo', '#f6c700', 3),
  ('pessoal', 'Pessoal', '#2f6fdb', 4),
  ('saude', 'Saúde', '#e85c9c', 5),
  ('outro', 'Outro', '#d9d9d6', 6)
) AS padrao (id, name, color, position)
LEFT JOIN category_colors escolhida ON escolhida.category = padrao.id
WHERE NOT EXISTS (SELECT 1 FROM categories);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE papel TEXT;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON categories FROM %I', papel);
    END IF;
  END LOOP;
END $$;
