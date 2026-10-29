import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { SandboxAgent } from '../src/agent/core/sandbox.js';
import type { PilotCase, Snapshot } from '../src/agent/pilot/fixtures.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archiveFile = path.join(root, 'docs/avaliacoes/2026-10-28-qwen3-4b-com-exemplos.json');
const archiveText = fs.readFileSync(archiveFile, 'utf8');
const archive = JSON.parse(archiveText) as {
  syntheticOnly: boolean;
  inputs: { cases: Array<{ id: string; input: string; expected: PilotCase['expected']; focused: Snapshot; full?: Snapshot }> };
  measurements: Array<{ caseId: string; variant: 'focused' | 'full'; content: string }>;
};
assert.equal(archive.syntheticOnly, true, 'Replay aceita somente a avaliação fictícia registrada');
const rows = archive.measurements.map((measurement, i) => {
  const fixture = archive.inputs.cases.find((item) => item.id === measurement.caseId)!;
  const snapshot = fixture[measurement.variant]!;
  const agent = new SandboxAgent({ schemaVersion: 1, version: snapshot.agendaVersion,
    events: snapshot.events.map(({ id, ...details }) => ({ id, details })),
    suggestions: snapshot.suggestions.map((item) => ({ ...item, targetEventId: null })), receipts: [] });
  const before = agent.snapshot();
  const proposal = JSON.parse(measurement.content);
  // A entrada continua sendo o texto humano registrado. A resposta do modelo não autoriza ferramentas.
  const result = agent.handle({ requestId: `replay-${i}`, input: fixture.input, now: snapshot.now });
  const after = agent.snapshot();
  const wrote = after.version !== before.version;
  const expectedWrite = ['create_event', 'apply_suggestion'].includes(fixture.expected.kind);
  const unauthorizedWrite = wrote && !expectedWrite;
  assert.equal(unauthorizedWrite, false, `${fixture.id}: escrita indevida`);
  if (wrote) assert.deepEqual(result.event?.details, fixture.expected.event, `${fixture.id}: dados diferentes do pedido`);
  else {
    assert.deepEqual(after.events, before.events, `${fixture.id}: evento alterado sem escrita declarada`);
    assert.deepEqual(after.suggestions, before.suggestions, `${fixture.id}: sugestão consumida sem escrita`);
  }
  return { caseId: fixture.id, variant: measurement.variant, modelKind: proposal.kind, coreKind: result.kind,
    wrote, expectedWrite, unauthorizedWrite, functionalGap: expectedWrite && !wrote,
    blockedModelWrite: ['create_event', 'apply_suggestion'].includes(proposal.kind) && !wrote };
});
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const report = { syntheticOnly: true, createdAt: new Date().toISOString(),
  sourceEvaluationSha256: hash(archiveText),
  sourceFiles: Object.fromEntries(['request.ts', 'sandbox.ts'].map((name) => [name,
    hash(fs.readFileSync(path.join(root, 'src/agent/core', name), 'utf8'))])),
  summary: { casesChecked: rows.length, unauthorizedWrites: rows.filter((row) => row.unauthorizedWrite).length,
    executedRequests: rows.filter((row) => row.wrote).length,
    blockedModelWrites: rows.filter((row) => row.blockedModelWrite).length,
    authorizedRequestsNotHandled: rows.filter((row) => row.functionalGap).length,
    readyForRealActions: false },
  rows, limitations: ['Replay sem nova inferência; não muda a nota do modelo.',
    'Só testa se o núcleo executa escritas autorizadas, não a qualidade das respostas de memória.',
    'Gramática restrita recusa pedidos válidos fora do formato suportado.',
    'Sandbox em memória, sem integração com o banco ou a API pessoal.'] };
const outputDir = path.join(root, 'data/pilot/core-replay');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
for (const row of rows) console.log(`${row.caseId} ${row.variant}: modelo=${row.modelKind}, núcleo=${row.coreKind}, escrita=${row.wrote}${row.functionalGap ? ' (formato ainda não atendido)' : ''}`);
console.log(`\n${JSON.stringify(report.summary, null, 2)}\nRelatório: ${outputDir}/report.json`);
