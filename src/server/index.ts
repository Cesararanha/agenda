import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { eventRoutes } from './routes/events.js';
import { vaultRoutes } from './routes/vault.js';
import { whatsappRoutes } from './routes/whatsapp.js';
import { syncAllVaults } from './vault/importer.js';
import { BadRequest, NotFound } from './events.js';

const app = Fastify({
  logger: {
    level: process.env.AGENDA_LOG_LEVEL ?? 'info',
    base: undefined,
    timestamp: () => `,"time":"${new Date().toLocaleTimeString('pt-BR')}"`,
  },
});

/** Rotas que a Meta chama e nao podem exigir o token da agenda. */
const PUBLIC_PATHS = new Set(['/api/whatsapp/webhook', '/api/health']);

/**
 * A Meta assina o corpo BRUTO. Depois do JSON.parse o byte exato se perde
 * (espaco, ordem, escape), entao guardamos o buffer original pra conferir a
 * assinatura. Vale pra todas as rotas; so o webhook usa.
 */
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
  (request as FastifyRequest & { rawBody?: Buffer }).rawBody = body as Buffer;
  try {
    const text = (body as Buffer).toString('utf8');
    done(null, text.length ? JSON.parse(text) : {});
  } catch (error) {
    done(error as Error, undefined);
  }
});

/**
 * Cabecalhos que so existem quando a requisicao passou por proxy ou tunel.
 */
const PROXY_HEADERS = [
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'forwarded',
  'cf-connecting-ip',
  'cf-ray',
  'cf-ipcountry',
  'cf-visitor',
  'true-client-ip',
];

/**
 * IP de loopback NAO prova que a requisicao nasceu neste Mac: o cloudflared roda
 * aqui e conecta de 127.0.0.1, entao confiar so no IP abria a agenda inteira pra
 * internet, sem token, assim que o tunel subia. Qualquer cabecalho de
 * encaminhamento derruba a isencao e o token volta a ser obrigatorio.
 */
function isFromThisMac(request: FastifyRequest): boolean {
  const ip = request.ip;
  if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') return false;
  return !PROXY_HEADERS.some((header) => request.headers[header] !== undefined);
}

app.addHook('onRequest', async (request, reply) => {
  reply.header('access-control-allow-origin', '*');
  reply.header('access-control-allow-headers', 'content-type, x-agenda-token, x-agenda-actor, authorization');
  reply.header('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (request.method === 'OPTIONS') return reply.code(204).send();

  const url = request.url.split('?')[0] ?? '';
  if (!url.startsWith('/api/')) return; // PWA e arquivos estaticos
  if (PUBLIC_PATHS.has(url)) return;
  if (!config.token) return; // sem token configurado, nada e exigido (so local)
  if (config.allowLocal && isFromThisMac(request)) return;

  const header = request.headers['x-agenda-token'];
  const bearer = (request.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const query = (request.query as { token?: string } | undefined)?.token;
  const provided = (typeof header === 'string' ? header : '') || bearer || query || '';

  if (provided !== config.token) {
    return reply.code(401).send({ error: 'token invalido ou ausente (header x-agenda-token)' });
  }
});

app.setErrorHandler((raw, request, reply) => {
  const error = raw as Error & { statusCode?: number };
  if (error instanceof BadRequest) return reply.code(400).send({ error: error.message });
  if (error instanceof NotFound) return reply.code(404).send({ error: error.message });
  request.log.error({ err: error }, 'erro na requisicao');
  return reply.code(error.statusCode ?? 500).send({ error: error.message || 'erro interno' });
});

app.get('/api/health', async () => ({ ok: true, tz: config.tz }));

await app.register(eventRoutes);
await app.register(vaultRoutes);
await app.register(whatsappRoutes);

if (config.serveWeb) {
  await app.register(fastifyStatic, { root: config.webDir });
  // PWA de rota unica: qualquer caminho que nao seja /api cai no index.html
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'rota inexistente' });
    return reply.sendFile('index.html');
  });
}

function lanAddress(): string | null {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return null;
}

try {
  const reports = syncAllVaults();
  for (const report of reports) {
    app.log.info(
      `vault '${report.vault}': ${report.found} prazos (${report.created} novos, ${report.updated} atualizados, ${report.removed} removidos)`,
    );
  }
  if (!reports.length) app.log.warn('nenhum vault configurado (AGENDA_VAULTS no .env)');
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
app.log.info(`banco: ${path.relative(process.cwd(), config.dbPath)}`);
