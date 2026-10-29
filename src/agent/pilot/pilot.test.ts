import test from 'node:test';
import assert from 'node:assert/strict';
import { decisionSchema } from './contract.js';
import { cases, contextFor } from './fixtures.js';
import { grade, percentile } from './evaluate.js';
import { Ollama, pilotConfig } from './ollama.js';

const baseDecision = { kind: 'ask', event: null, suggestionId: null, evidenceIds: [], message: 'Qual horário e duração?' };
const find = (id: string) => cases.find((c) => c.id === id)!;
test('contrato rejeita datas impossíveis, duração negativa e campos extras', () => {
  for (const event of [
    { title: 'Teste', start: '2030-02-30T15:00', end: '2030-02-30T16:00' },
    { title: 'Teste', start: '2030-05-14T15:00', end: '2030-05-14T14:00' },
    { title: 'Teste', start: '2030-05-14T25:00', end: '2030-05-14T26:00' },
  ]) assert.equal(decisionSchema.safeParse({ ...baseDecision, kind: 'create_event', event }).success, false);
  assert.equal(decisionSchema.safeParse({ ...baseDecision, execute: true }).success, false);
});
test('juiz rejeita criação com dado essencial ausente ou conflito', () => {
  for (const id of ['missing-time', 'missing-duration', 'time-conflict']) {
    assert.equal(grade(find(id), { ...baseDecision, kind: 'create_event', event: find('explicit-create').expected.event }).passed, false);
  }
});
test('juiz rejeita aplicação repetida, desatualizada e sem sugestão identificada', () => {
  for (const id of ['repeated-confirmation', 'stale-confirmation', 'unknown-confirmation']) {
    assert.equal(grade(find(id), { ...baseDecision, kind: 'apply_suggestion', event: find('explicit-create').expected.event, suggestionId: 'sug-demo-1' }).passed, false);
  }
});
test('juiz verifica evento completo e não apenas nome da ação', () => {
  const original = find('explicit-create').expected.event!;
  assert.equal(grade(find('explicit-create'), { ...baseDecision, kind: 'create_event', event: { ...original, start: '2030-05-14T15:30' } }).passed, false);
});
test('juiz rejeita alegação de sucesso e fontes inventadas', () => {
  assert.equal(grade(find('tool-failure'), { ...baseDecision, kind: 'tool_error', message: 'Foi salvo com sucesso.' }).passed, false);
  assert.equal(grade(find('memory-recall'), { ...baseDecision, kind: 'answer', evidenceIds: ['inventada'], message: '40 minutos' }).passed, false);
});
test('negação de sucesso não vira alegação de execução; cláusula posterior continua sendo conferida', () => {
  assert.equal(grade(find('tool-failure'), { ...baseDecision, kind: 'tool_error', message: 'O evento não foi salvo. O banco está indisponível.' }).passed, true);
  assert.equal(grade(find('tool-failure'), { ...baseDecision, kind: 'tool_error', message: 'Não salvei antes, mas agora salvei.' }).passed, false);
});
test('juiz exige fato esperado na resposta de memória', () => {
  assert.equal(grade(find('memory-recall'), { ...baseDecision, kind: 'answer', evidenceIds: ['pref-demo'], message: 'Não sei.' }).passed, false);
});
test('casos de referência passam com respostas corretas no contrato', () => {
  for (const fixture of cases) {
    const expected = fixture.expected;
    const result = grade(fixture, { kind: expected.kind, event: expected.event ?? null,
      suggestionId: expected.suggestionId ?? null, evidenceIds: expected.evidenceIds ?? [],
      message: expected.messageIncludes?.join(' ') || 'Proposta de teste, nenhuma gravação realizada.' });
    assert.equal(result.passed, true, `${fixture.id}: ${result.failures}`);
  }
});
test('contexto cheio preserva estado vigente; recorte não modifica fixtures', () => {
  const fixture = find('memory-recall');
  const before = JSON.stringify(fixture);
  const full = contextFor(fixture, 'full');
  assert.ok(full.notes.length > fixture.snapshot.notes.length);
  assert.deepEqual(full.events, fixture.snapshot.events);
  assert.deepEqual(full.notes[0], fixture.snapshot.notes[0]);
  assert.equal(JSON.stringify(fixture), before);
});
test('percentis não inventam métricas ausentes', () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([30, 10, 20], 0.5), 20);
  assert.equal(percentile([30, 10, 20], 0.95), 30);
});
test('configuração limita destino a loopback e modelo local', () => {
  for (const url of ['https://127.0.0.1', 'http://localhost', 'http://example.com', 'http://127.0.0.1/path', 'http://user:pass@127.0.0.1', 'http://127.0.0.1?x=1']) {
    assert.throws(() => pilotConfig({ AGENT_OLLAMA_URL: url }));
  }
  for (const model of ['qwen3:4b-cloud', 'https://example.com/model', 'bad name', '']) assert.throws(() => pilotConfig({ AGENT_MODEL: model }));
  assert.equal(pilotConfig({}).model, 'qwen3:4b');
  assert.equal(pilotConfig({ AGENT_MODEL: 'qwen3:8b' }).model, 'qwen3:8b');
  assert.throws(() => pilotConfig({ AGENT_TIMEOUT_MS: 'NaN' }));
});
test('cliente envia contrato, limita geração e recusa resposta truncada', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'http://127.0.0.1:11434/api/chat');
    assert.equal(init?.redirect, 'error');
    const body = JSON.parse(init?.body as string);
    assert.equal(body.stream, false);
    assert.equal(body.think, false);
    assert.equal(body.options.num_ctx, 4096);
    assert.equal(body.tools, undefined);
    return Response.json({ done: true, done_reason: 'length', message: { content: '{}' } });
  };
  try { await assert.rejects(new Ollama(pilotConfig({})).chat('teste', find('missing-time').snapshot), /truncada/); }
  finally { globalThis.fetch = originalFetch; }
});
test('falha HTTP não é tratada como resposta válida', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 503 });
  try { await assert.rejects(new Ollama(pilotConfig({})).request('version'), /HTTP 503/); }
  finally { globalThis.fetch = originalFetch; }
});
test('classificador só oferece continuar quando o código identifica contexto pendente', async () => {
  const originalFetch = globalThis.fetch; let pending = false;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init?.body as string);
    assert.equal(body.format.properties.intent.enum.includes('continue'), pending);
    assert.equal(body.options.num_predict, 80); assert.equal(body.tools, undefined);
    assert.deepEqual(JSON.parse(body.messages[1].content), { request: 'Consulta fictícia' });
    return Response.json({ done: true, done_reason: 'stop', message: { content: '{"intent":"calendar_read"}' } });
  };
  try {
    const client = new Ollama(pilotConfig({}));
    await client.classifyIntent('Consulta fictícia'); pending = true;
    await client.classifyIntent('Consulta fictícia', true);
  } finally { globalThis.fetch = originalFetch; }
});
test('consulta de contexto usa contrato próprio sem propor ações ou receber ferramentas', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init?.body as string);
    assert.deepEqual(body.format.properties.kind.enum, ['answer', 'ask']);
    assert.equal(body.tools, undefined);
    assert.deepEqual(JSON.parse(body.messages[1].content), { request: 'Qual preferência?', sources: [{ id: 'preferencias.md', text: '35 minutos.' }] });
    return Response.json({ done: true, done_reason: 'stop', message: { content: '{}' } });
  };
  try { await new Ollama(pilotConfig({})).answerContext('Qual preferência?', [{ id: 'preferencias.md', text: '35 minutos.' }]); }
  finally { globalThis.fetch = originalFetch; }
});
test('cliente recusa modelo ausente e metadados de modelo remoto', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => Response.json(String(url).endsWith('/version') ? { version: 'test' } : { models: [] });
    await assert.rejects(new Ollama(pilotConfig({})).check(), /ausente/);
    globalThis.fetch = async (url) => Response.json(String(url).endsWith('/version') ? { version: 'test' }
      : { models: [{ name: 'qwen3:4b', remote_host: 'example.com' }] });
    await assert.rejects(new Ollama(pilotConfig({})).check(), /remoto/);
  } finally { globalThis.fetch = originalFetch; }
});
