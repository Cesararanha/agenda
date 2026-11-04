/**
 * Acesso assíncrono ao banco do app real: Postgres quando há DATABASE_URL,
 * SQLite no Mac e nos testes. O SQL é o mesmo nos dois, com "?" nos parâmetros
 * e "end" sempre entre aspas, porque é palavra reservada no Postgres.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from './config.js';

export type Param = string | number | null;

interface Driver {
  all(sql: string, params: Param[]): Promise<unknown[]>;
  run(sql: string, params: Param[]): Promise<number>;
  transaction<T>(work: () => Promise<T>): Promise<T>;
}

async function postgresDriver(): Promise<Driver> {
  const { default: pg } = await import('pg');
  pg.types.setTypeParser(20, Number); // bigint: os prazos do WhatsApp cabem em Number
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    ...(config.databaseCa ? { ssl: { ca: config.databaseCa, rejectUnauthorized: true } } : {}),
  });
  // Conexão ociosa caída não pode derrubar o processo; a próxima consulta abre outra.
  pool.on('error', (error) => console.error('postgres: conexao ociosa caiu', error.message));

  const scope = new AsyncLocalStorage<{ client: import('pg').PoolClient; savepoints: number }>();
  const numbered = (sql: string) => {
    let index = 0;
    return sql.replace(/\?/g, () => `$${++index}`);
  };
  const runner = () => scope.getStore()?.client ?? pool;

  return {
    async all(sql, params) {
      return (await runner().query(numbered(sql), params)).rows;
    },
    async run(sql, params) {
      return (await runner().query(numbered(sql), params)).rowCount ?? 0;
    },
    async transaction<T>(work: () => Promise<T>) {
      const active = scope.getStore();
      if (active) {
        const name = `agenda_${++active.savepoints}`;
        await active.client.query(`SAVEPOINT ${name}`);
        try {
          const result = await work();
          await active.client.query(`RELEASE SAVEPOINT ${name}`);
          return result;
        } catch (error) {
          await active.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
          await active.client.query(`RELEASE SAVEPOINT ${name}`);
          throw error;
        }
      }
      const client = await pool.connect();
      let failure: Error | undefined;
      try {
        await client.query('BEGIN');
        // Uma escrita por vez, como o BEGIN IMMEDIATE do SQLite: a checagem de conflito segue valendo.
        await client.query('SELECT pg_advisory_xact_lock(8787)');
        const result = await scope.run({ client, savepoints: 0 }, work);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        failure = error as Error;
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release(failure);
      }
    },
  };
}

async function sqliteDriver(): Promise<Driver> {
  const { db } = await import('./db.js');
  const scope = new AsyncLocalStorage<{ savepoints: number }>();
  let queue: Promise<unknown> = Promise.resolve();

  return {
    async all(sql, params) {
      return db.prepare(sql).all(...params);
    },
    async run(sql, params) {
      return Number(db.prepare(sql).run(...params).changes);
    },
    async transaction<T>(work: () => Promise<T>) {
      const active = scope.getStore();
      if (active) {
        const name = `agenda_${++active.savepoints}`;
        db.exec(`SAVEPOINT ${name}`);
        try {
          const result = await work();
          db.exec(`RELEASE ${name}`);
          return result;
        } catch (error) {
          db.exec(`ROLLBACK TO ${name}`);
          db.exec(`RELEASE ${name}`);
          throw error;
        }
      }
      const turn = queue.then(async () => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = await scope.run({ savepoints: 0 }, work);
          db.exec('COMMIT');
          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      });
      queue = turn.catch(() => undefined);
      return turn;
    },
  };
}

const driver = config.databaseUrl ? postgresDriver() : sqliteDriver();

export async function queryAll<T>(sql: string, ...params: Param[]): Promise<T[]> {
  return (await (await driver).all(sql, params)) as T[];
}

export async function queryOne<T>(sql: string, ...params: Param[]): Promise<T | null> {
  return ((await (await driver).all(sql, params))[0] as T | undefined) ?? null;
}

/** Devolve quantas linhas mudaram. */
export async function run(sql: string, ...params: Param[]): Promise<number> {
  return (await driver).run(sql, params);
}

export async function transaction<T>(work: () => Promise<T>): Promise<T> {
  return (await driver).transaction(work);
}

export async function audit(actor: string, action: string, detail?: unknown): Promise<void> {
  await run('INSERT INTO audit (at, actor, action, detail) VALUES (?, ?, ?, ?)',
    new Date().toISOString(), actor, action, detail === undefined ? null : JSON.stringify(detail));
}
