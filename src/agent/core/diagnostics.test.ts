import test from 'node:test';
import assert from 'node:assert/strict';
import { ResponseTrace } from './diagnostics.js';
import type { DemoReply } from '../../shared/agent.js';

const answer: DemoReply = { kind: 'answer', changed: false, evidenceIds: ['agenda'], message: 'Resposta fictícia.' };
test('diagnóstico de calendário não inventa uso do modelo, tokens ou medidas de hardware', () => {
  const trace = new ResponseTrace(); trace.record('agenda');
  const result = trace.finish(answer);
  assert.equal(result.diagnostics?.path, 'calendar'); assert.equal(result.diagnostics?.model, undefined);
  assert.ok(result.diagnostics!.durationMs >= 0);
});
test('medições de geração e contexto não incluem conteúdo das notas', () => {
  const trace = new ResponseTrace();
  trace.read({ sources: [{ id: 'preferencias.md', text: 'CONTEUDO-NAO-EXPOSTO' }], openTasks: [], readSequence: ['AGENTS.md', 'preferencias.md'],
    usage: { filesRead: 2, charactersRead: 40, charactersReturned: 20 } });
  trace.beginModel('qwen3:4b'); trace.requestModel();
  trace.completeModel({ totalMs: 100, loadMs: 0, promptTokens: 12, outputTokens: 5, promptMs: 30, outputMs: 70 });
  const result = trace.finish(answer);
  assert.equal(result.diagnostics?.model?.metrics?.promptTokens, 12);
  assert.equal(result.diagnostics?.model?.metrics?.loadMs, 0);
  assert.equal(result.diagnostics?.context?.filesRead, 2);
  assert.ok(!JSON.stringify(result.diagnostics).includes('CONTEUDO-NAO-EXPOSTO'));
});
test('pedidos simultâneos têm rastros independentes e respostas anteriores não são mutáveis', () => {
  const first = new ResponseTrace(), second = new ResponseTrace(); first.beginModel('qwen3:4b'); second.record('agenda');
  const stored = first.finish(answer); first.requestModel(); first.failModel();
  assert.equal(stored.diagnostics?.model?.requested, false);
  assert.equal(second.finish(answer).diagnostics?.model, undefined);
});
test('saída recusada e modelo indisponível não aparecem como geração bem-sucedida', () => {
  const trace = new ResponseTrace(); trace.beginModel('qwen3:4b');
  assert.equal(trace.finish({ ...answer, kind: 'model_error' }).diagnostics?.model?.status, 'unavailable');
  trace.requestModel(); trace.completeModel(undefined);
  const result = trace.finish({ ...answer, kind: 'ask' });
  assert.equal(result.diagnostics?.model?.status, 'rejected');
  assert.equal(result.diagnostics?.model?.metrics, undefined);
});
test('planejamento com dado ausente distingue esclarecimento de saída recusada', () => {
  const trace = new ResponseTrace(); trace.record('interpret_plan'); trace.beginModel('qwen3:4b'); trace.requestModel(); trace.completeModel(undefined);
  const result = trace.finish({ ...answer, kind: 'ask', planningDraft: { now: '2026-10-28T08:00', messages: ['Pedido fictício'], missing: ['horário de Leitura'] } });
  assert.equal(result.diagnostics?.path, 'planning'); assert.equal(result.diagnostics?.model?.status, 'needs_clarification');
});
test('correção limitada de extração soma as medições das duas gerações', () => {
  const trace = new ResponseTrace(); trace.record('interpret_plan'); trace.beginModel('qwen3:4b'); trace.requestModel();
  trace.completeModel({ totalMs: 30, loadMs: 1, promptTokens: 20, outputTokens: 5, promptMs: 10, outputMs: 19 });
  trace.beginModel('qwen3:4b'); trace.requestModel();
  trace.completeModel({ totalMs: 40, loadMs: 0, promptTokens: 25, outputTokens: 7, promptMs: 15, outputMs: 25 });
  const model = trace.finish(answer).diagnostics?.model;
  assert.equal(model?.generations, 2); assert.equal(model?.metrics?.promptTokens, 45);
  assert.equal(model?.metrics?.outputTokens, 12); assert.equal(model?.metrics?.totalMs, 70);
});
