import { SYSTEM_PROMPT, outputFormat } from './contract.js';
import type { Snapshot } from './fixtures.js';
import { titleFormat, titlePrompt } from '../core/title-interpretation.js';
import { planningFormat, planningPrompt, type PlanningDraft } from '../core/assisted-plan.js';
import { intentFormat, intentPrompt, intents } from '../core/intent.js';
import { contextAnswerFormat, contextAnswerPrompt } from '../core/answers.js';

export interface PilotConfig { baseUrl: string; model: string; timeoutMs: number; numCtx: number; numPredict: number }
export function pilotConfig(env = process.env): PilotConfig {
  const url = new URL(env.AGENT_OLLAMA_URL ?? 'http://127.0.0.1:11434');
  // Nenhuma configuração de .env da agenda é carregada. Nem proxy, cloud ou redirecionamento.
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('AGENT_OLLAMA_URL deve ser HTTP em loopback literal (127.0.0.1 ou [::1]), sem caminho ou credenciais.');
  }
  const model = env.AGENT_MODEL ?? 'qwen3:4b';
  if (!/^[a-z0-9_.-]+(?::[a-z0-9_.-]+)?$/i.test(model) || /cloud/i.test(model)) throw new Error('Use um nome de modelo local, sem cloud.');
  const timeoutMs = Number(env.AGENT_TIMEOUT_MS ?? 120000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) throw new Error('AGENT_TIMEOUT_MS inválido (1..600000).');
  return { baseUrl: url.origin, model, timeoutMs, numCtx: 4096, numPredict: 512 };
}

export class Ollama {
  constructor(readonly config: PilotConfig) {}
  async request(endpoint: string, body?: unknown): Promise<any> {
    const response = await fetch(`${this.config.baseUrl}/api/${endpoint}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs), redirect: 'error',
    });
    if (!response.ok) throw new Error(`Ollama /${endpoint}: HTTP ${response.status}`);
    return response.json();
  }
  async check() {
    const version = await this.request('version');
    const tags = await this.request('tags');
    const model = tags.models?.find((m: { name: string }) => m.name === this.config.model || m.name === `${this.config.model}:latest`);
    if (!model) throw new Error(`Modelo ${this.config.model} ausente. Baixe-o com ollama pull ${this.config.model}.`);
    if (model.remote_host || model.remote_model) throw new Error('Modelo remoto não permitido no piloto.');
    const show = await this.request('show', { model: this.config.model });
    if (show.remote_host || show.remote_model) throw new Error('Modelo remoto não permitido no piloto.');
    return { version: version.version, model: model.name, digest: model.digest, diskBytes: model.size,
      details: show.details, capabilities: show.capabilities };
  }
  async chat(input: string, snapshot: Snapshot) {
    const messages = [{ role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: 'Avalie o pedido abaixo conforme o contrato, sem executar ações.\n'
        + JSON.stringify({ context: snapshot, request: input }) }];
    return this.generate(messages, outputFormat);
  }
  async extractTitle(input: string) {
    return this.generate([{ role: 'system', content: titlePrompt }, { role: 'user', content: JSON.stringify({ request: input }) }], titleFormat);
  }
  async classifyIntent(input: string, pending = false) {
    const allowed = pending ? [...intents] : intents.filter((intent) => intent !== 'continue');
    const format = { ...intentFormat, properties: { intent: { ...intentFormat.properties.intent, enum: allowed } } };
    return this.generate([{ role: 'system', content: `${intentPrompt}\nOpções permitidas nesta chamada: ${allowed.join(', ')}.` }, { role: 'user', content: JSON.stringify({ request: input }) }], format, 80);
  }
  async answerContext(input: string, sources: Array<{ id: string; text: string }>) {
    return this.generate([{ role: 'system', content: contextAnswerPrompt }, { role: 'user', content: JSON.stringify({ request: input, sources }) }], contextAnswerFormat);
  }
  async plan(draft: PlanningDraft, feedback?: string) {
    return this.generate([{ role: 'system', content: planningPrompt + (feedback ? `\nValidação da tentativa anterior: ${feedback}` : '') }, { role: 'user', content: JSON.stringify({ messages: draft.messages }) }], planningFormat, 1400);
  }
  private async generate(messages: { role: string; content: string }[], format: unknown, numPredict = this.config.numPredict) {
    const start = performance.now();
    const result = await this.request('chat', {
      model: this.config.model, messages, format, stream: false, think: false, keep_alive: '5m',
      options: { temperature: 0, seed: 42, num_ctx: this.config.numCtx, num_predict: numPredict },
    });
    const wallMs = performance.now() - start;
    if (result.done !== true || result.done_reason === 'length') throw new Error('Resposta incompleta ou truncada do modelo.');
    const content = result.message?.content;
    if (typeof content !== 'string') throw new Error('Resposta sem conteúdo.');
    return { content, wallMs, inputChars: messages.reduce((n, m) => n + m.content.length, 0),
      metrics: { totalMs: nsToMs(result.total_duration), loadMs: nsToMs(result.load_duration),
        promptTokens: count(result.prompt_eval_count), outputTokens: count(result.eval_count),
        promptMs: nsToMs(result.prompt_eval_duration), outputMs: nsToMs(result.eval_duration) } };
  }
  async memory() {
    const result = await this.request('ps');
    const model = result.models?.find((m: { name: string }) => m.name === this.config.model || m.name === `${this.config.model}:latest`);
    return model ? { sizeBytes: count(model.size), vramBytes: count(model.size_vram), contextLength: count(model.context_length) } : null;
  }
}
function count(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
function nsToMs(value: unknown): number | null { const n = count(value); return n === null ? null : n / 1e6; }
