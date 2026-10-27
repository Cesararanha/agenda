/**
 * WhatsApp via Meta Cloud API.
 *
 * Fica DESLIGADO enquanto WHATSAPP_ACCESS_TOKEN estiver vazio: as rotas respondem
 * 503 e nada e processado. Com as credenciais no .env e uma URL publica apontando
 * pro Mac (Cloudflare Tunnel), o fluxo e:
 *   Meta -> GET  /api/whatsapp/webhook  (verificacao, uma vez)
 *   Meta -> POST /api/whatsapp/webhook  (cada mensagem recebida)
 *
 * Somente o numero em WHATSAPP_ALLOWED_FROM pode comandar a agenda.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { audit } from '../db.js';
import { createEvent, listOccurrences, summarize } from '../events.js';
import { parseQuickAdd, parseRangeQuery } from '../nlp.js';
import { describeRrule, parseRrule } from '../../shared/recurrence.js';
import { dateOf, formatDateBR, timeOf, today } from '../../shared/dates.js';

const GRAPH_VERSION = 'v21.0';

const AJUDA = [
  'Comandos da agenda:',
  '',
  '*hoje* · *amanha* · *semana* · *proxima semana*',
  '*seg* (ou qualquer dia da semana) mostra aquele dia',
  '',
  'Pra marcar, escreva naturalmente:',
  '  amanha 14h dentista',
  '  27/10 15h-17h estudar IA',
  '  toda terca 19h aula de IA',
  '  seg qua sex 7h academia',
  '',
  '*ajuda* mostra isso de novo.',
].join('\n');

async function postMensagem(to: string, body: string): Promise<Response> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${config.whatsapp.phoneNumberId}/messages`;
  return fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.whatsapp.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { preview_url: false, body: body.slice(0, 4000) },
    }),
  });
}

/** Numero fora da lista de permitidos do numero de teste. */
const NAO_PERMITIDO = 131030;
/** Token expirado. O token temporario do painel da Meta dura 24h. */
const TOKEN_EXPIRADO = 190;

/**
 * O codigo do erro vem no JSON. Procurar o numero no texto cru acha falso positivo
 * no fbtrace_id, que e justamente onde digito solto aparece.
 */
function codigoDoErro(texto: string): number | undefined {
  try {
    return (JSON.parse(texto) as { error?: { code?: number } }).error?.code;
  } catch {
    return undefined;
  }
}

export async function sendWhatsApp(to: string, body: string): Promise<void> {
  if (!config.whatsapp.enabled || !config.whatsapp.phoneNumberId) return;

  let response = await postMensagem(to, body);
  if (response.ok) return;

  let texto = await response.text();

  // A Meta entrega o remetente sem o nono digito e depois recusa esse mesmo numero
  // como destinatario. Quando der 131030, tentar a outra forma antes de desistir.
  const alternativo = variacoesNumero(to).find((n) => n !== to);
  if (alternativo && codigoDoErro(texto) === NAO_PERMITIDO) {
    audit('whatsapp', 'send:retry', { de: to, para: alternativo });
    response = await postMensagem(alternativo, body);
    if (response.ok) return;
    texto = await response.text();
  }

  const codigo = codigoDoErro(texto);
  const acao = codigo === TOKEN_EXPIRADO ? 'send:token-expirado' : 'send:error';
  audit('whatsapp', acao, { status: response.status, codigo, body: texto });
}

/** Decide o que uma mensagem significa e devolve a resposta em texto. */
export function handleMessage(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return AJUDA;
  if (/^(ajuda|help|\?|menu)$/i.test(trimmed)) return AJUDA;

  const range = parseRangeQuery(trimmed, config.tz);
  if (range) {
    const resumo = summarize(range.from, range.to);
    return `*${range.label}* (${formatDateBR(range.from)}${range.from === range.to ? '' : ` a ${formatDateBR(range.to)}`})\n\n${resumo}`;
  }

  const parsed = parseQuickAdd(trimmed, config.tz);
  if (parsed.title === 'Sem titulo') return AJUDA;

  const created = createEvent(
    {
      title: parsed.title,
      start: parsed.start,
      end: parsed.end,
      allDay: parsed.allDay,
      category: parsed.category,
      rrule: parsed.rrule,
      source: 'whatsapp',
    },
    'whatsapp',
  );

  const quando = created.allDay
    ? `${formatDateBR(dateOf(created.start))}, dia inteiro`
    : `${formatDateBR(dateOf(created.start))} ${timeOf(created.start)}-${timeOf(created.end)}`;
  const repete = created.rrule ? `\nRepete: ${describeRrule(parseRrule(created.rrule))}` : '';
  const mesmoDia = listOccurrences(dateOf(created.start), dateOf(created.start)).length;

  return `Marcado: *${created.title}*\n${quando}${repete}\n\n${mesmoDia} compromisso(s) nesse dia.`;
}

/**
 * A Meta assina cada POST com HMAC-SHA256 do corpo bruto, usando o App Secret.
 * Sem essa conferencia, quem descobrisse a URL do tunel mandaria comando falso.
 * Falha fechada: sem App Secret configurado, nenhum POST e processado.
 */
function signatureOk(request: FastifyRequest): boolean {
  const secret = config.whatsapp.appSecret;
  if (!secret) return false;

  const header = request.headers['x-hub-signature-256'];
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;

  const raw = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
  if (!raw) return false;

  const expected = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'), 'utf8');
  const received = Buffer.from(header.slice('sha256='.length), 'utf8');
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

/**
 * No Brasil o WhatsApp guarda o numero SEM o nono digito: quem manda de
 * +55 82 99999-8888 chega no webhook como 558299998888. Comparar texto puro
 * com o numero que a pessoa digitou (com o 9) bloquearia o dono da agenda em
 * silencio, entao a conferencia aceita as duas formas.
 */
export function variacoesNumero(n: string): string[] {
  const d = n.replace(/\D/g, '');
  // 55 + DDD (2) + 9 + 8 digitos = 13; sem o nono digito = 12
  const match = /^55(\d{2})(\d{8,9})$/.exec(d);
  if (!match) return [d];
  const [, ddd, resto] = match as unknown as [string, string, string];
  if (resto.length === 9 && resto.startsWith('9')) return [d, `55${ddd}${resto.slice(1)}`];
  if (resto.length === 8) return [d, `55${ddd}9${resto}`];
  return [d];
}

export function mesmoNumero(a: string, b: string): boolean {
  const umas = new Set(variacoesNumero(a));
  return variacoesNumero(b).some((v) => umas.has(v));
}

interface WebhookStatus {
  id?: string;
  status?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
}

interface WebhookBody {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        messages?: Array<{ from?: string; type?: string; text?: { body?: string } }>;
        statuses?: WebhookStatus[];
      };
    }>;
  }>;
}

export async function whatsappRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string };
  }>('/api/whatsapp/webhook', async (request, reply) => {
    if (!config.whatsapp.verifyToken) {
      return reply.code(503).send({ error: 'WhatsApp desligado: falta WHATSAPP_VERIFY_TOKEN no .env' });
    }
    const query = request.query;
    if (
      query['hub.mode'] === 'subscribe' &&
      query['hub.verify_token'] === config.whatsapp.verifyToken
    ) {
      return reply.code(200).type('text/plain').send(query['hub.challenge'] ?? '');
    }
    // sem hub.mode nao e a Meta verificando: e alguem (geralmente o proprio dono)
    // abrindo a URL no navegador. Dizer isso evita caca a fantasma.
    if (!query['hub.mode']) {
      return reply.code(400).send({
        error: 'Este endereco e so pra Meta chamar, nao pra abrir no navegador.',
        comoUsar: 'Cole esta URL no campo Callback URL do painel da Meta, junto com o verify token.',
      });
    }
    return reply.code(403).send({ error: 'verify token nao confere' });
  });

  app.post('/api/whatsapp/webhook', async (request, reply) => {
    if (!signatureOk(request)) {
      audit('whatsapp', 'signature:rejeitada', {
        ip: request.ip,
        motivo: config.whatsapp.appSecret ? 'assinatura nao confere' : 'WHATSAPP_APP_SECRET vazio',
      });
      return reply.code(403).send({ error: 'assinatura invalida' });
    }

    // a Meta exige 200 rapido; erro aqui vira reenvio infinito
    reply.code(200).send({ received: true });

    if (!config.whatsapp.enabled) return;

    const body = request.body as WebhookBody;
    const changes = body?.entry?.flatMap((e) => e.changes ?? []) ?? [];
    const messages = changes.flatMap((c) => c.value?.messages ?? []);

    // sent / delivered / read / failed de cada mensagem que a agenda mandou.
    // Fica so no audit: e o unico jeito de saber se a Meta entregou de verdade.
    for (const status of changes.flatMap((c) => c.value?.statuses ?? [])) {
      audit('whatsapp', `status:${status.status ?? 'desconhecido'}`, {
        para: status.recipient_id,
        mensagem: status.id,
        erros: status.errors,
      });
    }

    // Chamada que a agenda nao usa (evento de conta, status de template) tambem deixa
    // rastro. Sem isso, "a Meta nao chamou" e "chamou com evento que eu ignoro" ficam
    // iguais no audit, e a diferenca entre as duas e o diagnostico inteiro.
    const temStatus = changes.some((c) => (c.value?.statuses?.length ?? 0) > 0);
    if (messages.length === 0 && !temStatus) {
      audit('whatsapp', 'webhook:ignorado', {
        campos: changes.map((c) => c.field || Object.keys(c.value ?? {}).join('+') || 'vazio'),
      });
    }

    for (const message of messages) {
      const from = (message.from ?? '').replace(/\D/g, '');
      if (!from) continue;
      if (config.whatsapp.allowedFrom && !mesmoNumero(from, config.whatsapp.allowedFrom)) {
        audit('whatsapp', 'blocked', { from });
        continue;
      }
      if (message.type !== 'text' || !message.text?.body) {
        await sendWhatsApp(from, 'Por enquanto eu leio so texto. Manda *ajuda* pra ver os comandos.');
        continue;
      }
      try {
        const answer = handleMessage(message.text.body);
        audit('whatsapp', 'message', { from, text: message.text.body });
        await sendWhatsApp(from, answer);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        audit('whatsapp', 'error', { from, detail });
        await sendWhatsApp(from, `Nao consegui: ${detail}\n\nManda *ajuda* pra ver os comandos.`);
      }
    }
  });

  /** Teste local do interpretador, sem precisar da Meta. */
  app.post('/api/whatsapp/simulate', async (request) => {
    const { text } = (request.body ?? {}) as { text?: string };
    return { today: today(config.tz), reply: handleMessage(String(text ?? '')) };
  });
}
