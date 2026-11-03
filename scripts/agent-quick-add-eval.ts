import { isDeepStrictEqual } from 'node:util';
import { quickCases, reference } from '../src/agent/evals/quick-add-cases.js';
import { applyQuickExtraction, quickBlocks, quickModelInput } from '../src/agent/core/quick-add.js';
import { Ollama, pilotConfig } from '../src/agent/pilot/ollama.js';
import { inferCategory } from '../src/server/nlp.js';

const ollama = new Ollama({ ...pilotConfig(), timeoutMs: 8000 });
const model = await ollama.check();
console.log(JSON.stringify({ model: model.model, digest: model.digest, version: model.version, reference, timeoutMs: 8000 }));
let passed = 0;
let generated = 0;
let generatedPassed = 0;
for (const { input, expected } of quickCases) {
  const started = performance.now();
  const parsed = quickBlocks(input, reference);
  let actual: unknown = [];
  let failure: unknown;
  const usedModel = 'blocks' in parsed;
  if (usedModel) {
    generated++;
    try {
      const response = await ollama.extractQuickAdd(quickModelInput(parsed.blocks));
      const drafts = applyQuickExtraction(JSON.parse(response.content), parsed.blocks);
      actual = drafts?.map((draft, i) => {
        const extra = expected[i]?.[3];
        const fields = { ...draft, category: inferCategory(draft.title) ?? draft.category };
        return [draft.title, draft.date, draft.time, ...(extra ? [Object.fromEntries(
          Object.keys(extra).map((key) => [key, fields[key as keyof typeof fields]]),
        )] : [])];
      }) ?? null;
      if (!drafts) failure = response.content;
    } catch (error) {
      actual = null;
      failure = String(error);
    }
  }
  const ok = isDeepStrictEqual(actual, expected);
  if (ok) {
    passed++;
    if (usedModel) generatedPassed++;
  }
  console.log(JSON.stringify({ ok, usedModel, ms: Math.round(performance.now() - started), input, ...(!ok ? { expected, actual, failure } : {}) }));
}
console.log(JSON.stringify({ passed, total: quickCases.length, generatedPassed, generated }));
if (passed !== quickCases.length) process.exitCode = 1;
