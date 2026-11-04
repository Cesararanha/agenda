// Aplica as migrações SQL no Postgres de DATABASE_URL. Pode rodar de novo: tudo é idempotente.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { config, ROOT } from '../src/server/config.js';

if (!config.databaseUrl) throw new Error('DATABASE_URL vazio (ou AGENDA_DB preenchido).');
const client = new pg.Client({
  connectionString: config.databaseUrl,
  ...(config.databaseCa ? { ssl: { ca: config.databaseCa, rejectUnauthorized: true } } : {}),
});
await client.connect();
try {
  const dir = path.join(ROOT, 'migrations');
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) {
    await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    console.log(`aplicada: ${file}`);
  }
  const { rows } = await client.query<{ tablename: string; rowsecurity: boolean }>(
    "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  for (const row of rows) console.log(`${row.tablename}: RLS ${row.rowsecurity ? 'ligado' : 'DESLIGADO'}`);
  if (rows.some((row) => !row.rowsecurity)) process.exitCode = 1;
} finally {
  await client.end();
}
