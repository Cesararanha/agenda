// Roda a regressão da agenda contra um Postgres de verdade, num contêiner descartável.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';

const name = `agenda-test-${randomUUID().slice(0, 8)}`;
const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8' });
const started = docker('run', '-d', '--rm', '--name', name, '-e', 'POSTGRES_PASSWORD=teste', '-p', '127.0.0.1:0:5432', 'postgres:17-alpine');
if (started.status !== 0) throw new Error(started.stderr);
try {
  const port = docker('port', name, '5432/tcp').stdout.trim().split(':').pop();
  const url = `postgresql://postgres:teste@127.0.0.1:${port}/postgres`;
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    const client = new pg.Client({ connectionString: url });
    try { await client.connect(); await client.query('SELECT 1'); ready = true; } catch { await setTimeout(500); }
    await client.end().catch(() => undefined);
  }
  if (!ready) throw new Error('Postgres de teste não subiu');
  const env = { ...process.env, AGENDA_DB: '', DATABASE_URL: url, DATABASE_CA: '' };
  for (const script of [['--import', 'tsx', 'scripts/db-migrate.ts'], ['--import', 'tsx', 'scripts/db-migrate.ts'], ['scripts/agenda-regression.mjs']]) {
    const run = spawnSync(process.execPath, script, { stdio: 'inherit', env });
    if (run.status !== 0) { process.exitCode = run.status ?? 1; break; }
  }
  // Prova de que a regressão gravou neste Postgres, e não num SQLite por engano.
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const { rows } = await client.query('SELECT count(*)::int AS total FROM audit');
  await client.end();
  if (!process.exitCode && !rows[0].total) throw new Error('A regressão não gravou nada no Postgres.');
  console.log(`Postgres de teste: ${rows[0].total} registros de auditoria gravados pela regressão.`);
} finally {
  docker('rm', '-f', name);
}
