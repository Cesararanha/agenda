import Fastify, { type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { eventRoutes } from './routes/events.js';
import { vaultRoutes } from './routes/vault.js';
import { whatsappRoutes } from './routes/whatsapp.js';
import { BadRequest, NotFound } from './errors.js';

export const app = Fastify({
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

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * IP de loopback NAO prova que a requisicao nasceu neste Mac: o cloudflared roda
 * aqui e conecta de 127.0.0.1, entao confiar so no IP abria a agenda inteira pra
 * internet, sem token, assim que o tunel subia. Qualquer cabecalho de
 * encaminhamento derruba a isencao e o token volta a ser obrigatorio.
 *
 * Pagina de outro site aberta no navegador tambem conecta de loopback. Por isso a
 * isencao exige Host local (contra DNS rebinding) e, quando ha Origin, a propria agenda.
 */
function isFromThisMac(request: FastifyRequest): boolean {
  const ip = request.ip;
  if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') return false;
  if (PROXY_HEADERS.some((header) => request.headers[header] !== undefined)) return false;
  const host = request.headers.host ?? '';
  if (!isLocalHost(host)) return false;
  const origin = request.headers.origin;
  return origin === undefined || origin === `http://${host}`;
}

function isLocalHost(host: string): boolean {
  try {
    return LOCAL_HOSTNAMES.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

app.addHook('onRequest', async (request, reply) => {
  const url = request.url.split('?')[0] ?? '';
  if (!url.startsWith('/api/')) return; // PWA e arquivos estaticos
  if (PUBLIC_PATHS.has(url)) return;
  if (!config.token) return; // sem token configurado, nada e exigido (so local)
  if (config.allowLocal && isFromThisMac(request)) return;

  const header = request.headers['x-agenda-token'];
  const bearer = (request.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const provided = (typeof header === 'string' ? header : '') || bearer;

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
if (config.agentSandbox) {
  // Só a demo carrega o SQLite síncrono: na nuvem o disco é só leitura.
  const { agentSandboxRoutes } = await import('./routes/agent-sandbox.js');
  await app.register(agentSandboxRoutes);
}

if (config.serveWeb) {
  await app.register(fastifyStatic, { root: config.webDir });
  // PWA de rota unica: qualquer caminho que nao seja /api cai no index.html
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'rota inexistente' });
    return reply.sendFile('index.html');
  });
}
