import os from 'node:os';
import path from 'node:path';
import { app } from './app.js';
import { config } from './config.js';
import { syncAllVaults } from './vault/importer.js';

function lanAddress(): string | null {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return null;
}

try {
  const reports = await syncAllVaults();
  for (const report of reports) {
    app.log.info(
      `vault '${report.vault}': ${report.found} prazos (${report.created} novos, ${report.updated} atualizados, ${report.removed} removidos)`,
    );
  }
  if (!reports.length && !config.databaseUrl) app.log.warn('nenhum vault configurado (AGENDA_VAULTS no .env)');
} catch (error) {
  app.log.error({ err: error }, 'falha ao sincronizar vault');
}

await app.listen({ port: config.port, host: config.host });

const lan = lanAddress();
app.log.info(`agenda no Mac:     http://localhost:${config.port}`);
if (lan && config.host === '0.0.0.0') {
  app.log.info(`agenda no celular: http://${lan}:${config.port}  (mesma rede wi-fi)`);
}
if (!config.token) {
  app.log.warn('AGENDA_TOKEN vazio: qualquer um na sua rede abre a agenda. Gere um antes de usar no celular.');
}
app.log.info(config.databaseUrl ? 'banco: Postgres' : `banco: ${path.relative(process.cwd(), config.dbPath)}`);
