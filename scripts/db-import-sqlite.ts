// Copia a agenda do SQLite local para o Postgres. Sem --apply, só mostra o que faria.
// Não copia nada vindo do vault nem a auditoria antiga (que cita títulos do vault e números de WhatsApp).
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import pg from 'pg';
import { config, ROOT } from '../src/server/config.js';

if (!config.databaseUrl) throw new Error('DATABASE_URL vazio (ou AGENDA_DB preenchido).');
const apply = process.argv.includes('--apply');
const sqlite = new DatabaseSync(path.join(ROOT, 'data', 'agenda.db'), { readOnly: true });

type Row = Record<string, string | number | null>;
const events = sqlite.prepare("SELECT * FROM events WHERE source <> 'vault'").all() as Row[];
const ids = new Set(events.map((event) => event.id));
const overrides = (sqlite.prepare('SELECT * FROM overrides').all() as Row[]).filter((row) => ids.has(row.event_id ?? null));
const skipped = (sqlite.prepare("SELECT count(*) AS total FROM events WHERE source = 'vault'").get() as { total: number }).total;

console.log(`eventos a copiar: ${events.length}`);
for (const event of events) console.log(`  ${String(event.start)}  ${String(event.title)}${event.rrule ? '  (repete)' : ''}`);
console.log(`exceções de série a copiar: ${overrides.length}`);
console.log(`eventos do vault ignorados: ${skipped}`);
if (!apply) {
  console.log('Simulação: nada foi gravado. Para gravar, rode de novo com --apply.');
  process.exit(0);
}

const quoted = (columns: string[]) => columns.map((column) => `"${column}"`).join(', ');
const client = new pg.Client({
  connectionString: config.databaseUrl,
  ...(config.databaseCa ? { ssl: { ca: config.databaseCa, rejectUnauthorized: true } } : {}),
});
await client.connect();
try {
  await client.query('BEGIN');
  const insert = async (table: string, rows: Row[], key: string) => {
    let written = 0;
    for (const row of rows) {
      const columns = Object.keys(row);
      const values = columns.map((_, index) => `$${index + 1}`).join(', ');
      const result = await client.query(
        `INSERT INTO ${table} (${quoted(columns)}) VALUES (${values}) ON CONFLICT (${key}) DO NOTHING`,
        columns.map((column) => row[column]),
      );
      written += result.rowCount ?? 0;
    }
    return written;
  };
  const writtenEvents = await insert('events', events, 'id');
  const writtenOverrides = await insert('overrides', overrides, 'event_id, occurrence_date');
  await client.query('COMMIT');
  console.log(`gravados: ${writtenEvents} eventos e ${writtenOverrides} exceções (o que já existia não mudou).`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
