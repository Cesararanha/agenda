/**
 * Servidor MCP da agenda: e por aqui que as IAs (Claude Code, Codex, qualquer
 * cliente MCP) leem e escrevem na agenda.
 *
 * Fala com a API por HTTP, nunca direto no banco: assim existe um unico escritor
 * (o servidor da agenda) e as regras de recorrencia valem pra todo mundo.
 *
 * Registro no Claude Code:
 *   claude mcp add agenda -- npx tsx "$PWD/src/mcp/server.ts"   (rodando na raiz do projeto)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE_URL = (process.env.AGENDA_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const TOKEN = process.env.AGENDA_TOKEN ?? '';

async function call<T>(method: string, pathname: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-agenda-actor': 'ia',
      ...(TOKEN ? { 'x-agenda-token': TOKEN } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`agenda respondeu ${response.status}: ${text.slice(0, 400)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

function asText(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

const server = new McpServer({ name: 'agenda', version: '0.1.0' });

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use 'YYYY-MM-DD'");
const MOMENT = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, "use 'YYYY-MM-DD' ou 'YYYY-MM-DDTHH:mm'");
const CATEGORY = z.enum(['faculdade', 'trabalho', 'projeto', 'estudo', 'pessoal', 'saude', 'outro']);
const SCOPE = z.enum(['this', 'future', 'all']);

server.tool(
  'agenda_contexto',
  'Data de hoje, fuso, categorias e vaults ligados na agenda. Chame antes de marcar algo, pra nao errar a data.',
  {},
  async () => asText(await call('GET', '/api/meta')),
);

server.tool(
  'agenda_listar',
  'Lista os compromissos de um intervalo de datas, ja com as recorrencias expandidas em ocorrencias concretas.',
  {
    from: DATE.describe('primeiro dia do intervalo'),
    to: DATE.describe('ultimo dia do intervalo'),
    category: CATEGORY.optional(),
    q: z.string().optional().describe('filtra por texto no titulo, nota ou local'),
  },
  async ({ from, to, category, q }) => {
    const params = new URLSearchParams({ from, to });
    if (category) params.set('category', category);
    if (q) params.set('q', q);
    return asText(await call('GET', `/api/events?${params}`));
  },
);

server.tool(
  'agenda_hoje',
  'Os compromissos de hoje, em texto pronto pra ler.',
  {},
  async () => asText(await call('GET', '/api/summary')),
);

server.tool(
  'agenda_semana',
  'A semana (segunda a domingo) que contem a data informada; sem data, a semana atual.',
  { date: DATE.optional() },
  async ({ date }) =>
    asText(await call('GET', `/api/week${date ? `?date=${date}` : ''}`)),
);

server.tool(
  'agenda_criar',
  'Marca um compromisso. Para algo que repete, passe rrule no formato iCalendar simplificado: FREQ=WEEKLY;BYDAY=TU;UNTIL=2026-12-20.',
  {
    title: z.string().min(1),
    start: MOMENT.describe("inicio; data pura ('2026-10-27') cria evento de dia inteiro"),
    end: MOMENT.optional().describe('fim; sem isso, 1 hora depois do inicio'),
    allDay: z.boolean().optional(),
    category: CATEGORY.optional(),
    notes: z.string().optional(),
    location: z.string().optional(),
    rrule: z
      .string()
      .optional()
      .describe('FREQ=DAILY|WEEKLY|MONTHLY, com INTERVAL, BYDAY (MO,TU,WE,TH,FR,SA,SU), UNTIL, COUNT'),
  },
  async (input) => asText(await call('POST', '/api/events', { ...input, source: 'ia' })),
);

server.tool(
  'agenda_criar_texto',
  'Marca um compromisso a partir de uma frase solta em portugues, como "amanha 14h dentista" ou "toda terca 19h aula de IA".',
  { texto: z.string().min(1) },
  async ({ texto }) => asText(await call('POST', '/api/quick-add', { text: texto, source: 'ia' })),
);

server.tool(
  'agenda_editar',
  "Muda um compromisso. Em serie que repete, escolha o escopo: 'this' (so aquele dia), 'future' (dali pra frente) ou 'all' (a serie toda).",
  {
    id: z.string().describe('id da serie (campo seriesId das ocorrencias)'),
    scope: SCOPE.default('all'),
    occurrence: DATE.optional().describe("obrigatorio quando scope e 'this' ou 'future'"),
    title: z.string().optional(),
    start: MOMENT.optional(),
    end: MOMENT.optional(),
    allDay: z.boolean().optional(),
    category: CATEGORY.optional(),
    notes: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    rrule: z.string().nullable().optional(),
  },
  async ({ id, scope, occurrence, ...patch }) => {
    const params = new URLSearchParams({ scope });
    if (occurrence) params.set('occurrence', occurrence);
    return asText(await call('PATCH', `/api/events/${id}?${params}`, patch));
  },
);

server.tool(
  'agenda_remover',
  "Remove um compromisso. Em serie que repete, 'this' apaga so aquele dia, 'future' encerra a serie a partir dali, 'all' apaga tudo.",
  {
    id: z.string(),
    scope: SCOPE.default('all'),
    occurrence: DATE.optional(),
  },
  async ({ id, scope, occurrence }) => {
    const params = new URLSearchParams({ scope });
    if (occurrence) params.set('occurrence', occurrence);
    return asText(await call('DELETE', `/api/events/${id}?${params}`));
  },
);

server.tool(
  'agenda_resumo',
  'Resumo em texto corrido de um intervalo, bom pra responder "como esta minha semana".',
  { from: DATE, to: DATE },
  async ({ from, to }) => {
    const data = await call<{ text: string }>('GET', `/api/summary?from=${from}&to=${to}`);
    return { content: [{ type: 'text' as const, text: data.text }] };
  },
);

server.tool(
  'agenda_sincronizar_vault',
  'Rele os prazos dos vaults configurados (tasks/todo.md e faculdade/*/overview.md) e atualiza os marcos na agenda. Somente leitura do vault.',
  {},
  async () => asText(await call('POST', '/api/vaults/sync')),
);

await server.connect(new StdioServerTransport());
