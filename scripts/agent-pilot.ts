import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SYSTEM_PROMPT, outputFormat } from '../src/agent/pilot/contract.js';
import { cases, contextFor } from '../src/agent/pilot/fixtures.js';
import { grade, percentile } from '../src/agent/pilot/evaluate.js';
import { Ollama, pilotConfig } from '../src/agent/pilot/ollama.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2];
if (!['check', 'eval', 'list'].includes(command ?? '')) {
  console.error('Uso: npm run agent:check | npm run agent:eval -- [--repeats N] | npx tsx scripts/agent-pilot.ts list');
  process.exit(2);
}
const args = process.argv.slice(3);
if (args.length && (command !== 'eval' || args.length !== 2 || args[0] !== '--repeats')) throw new Error('Argumentos inválidos. Use --repeats N.');
const repeats = Number(args[1] ?? 1);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 20) throw new Error('Repetições devem estar entre 1 e 20.');
if (command === 'list') {
  for (const test of cases) console.log(`${test.id}: ${test.expected.kind}${test.critical ? ' (crítico)' : ''}`);
  process.exit(0);
}
const config = pilotConfig();
const client = new Ollama(config);
const reportDir = path.join(root, 'data/pilot/reports', new Date().toISOString().replace(/[:.]/g, '-'));
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const git = (args: string[]) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); } catch { return null; } };
const sourceFiles = ['pilot/contract.ts', 'pilot/fixtures.ts', 'pilot/evaluate.ts', 'pilot/ollama.ts', 'claims.ts'];
const report: any = {
  schemaVersion: 1, startedAt: new Date().toISOString(), status: 'running', syntheticOnly: true,
  config, repeats, source: { revision: git(['rev-parse', 'HEAD']), dirty: Boolean(git(['status', '--porcelain'])),
    promptSha256: hash(SYSTEM_PROMPT), fixtureSha256: hash(JSON.stringify(cases)), formatSha256: hash(JSON.stringify(outputFormat)),
    files: Object.fromEntries(sourceFiles.map((name) => [name, hash(fs.readFileSync(path.join(root, 'src/agent', name), 'utf8'))])),
    runnerSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')) },
  host: { platform: os.platform(), arch: os.arch(), release: os.release(), node: process.version,
    cpu: os.cpus()[0]?.model, totalMemoryBytes: os.totalmem() },
  inputs: { systemPrompt: SYSTEM_PROMPT, outputFormat,
    userPrefix: 'Avalie o pedido abaixo conforme o contrato, sem executar ações.\n',
    cases: cases.map((test) => ({ id: test.id, input: test.input, expected: test.expected,
      focused: contextFor(test, 'focused'), full: test.compareContext ? contextFor(test, 'full') : undefined })) },
  measurements: [],
  limitations: [
    'Propostas sem execução. Nenhum banco, API da agenda ou vault é acessado.',
    'Contextos reduzidos são preparados manualmente, não há recuperação automática de memória.',
    'A retomada recebe um snapshot fictício em requisição nova, sem testar contas reais ou persistência.',
    'Tokens incluem todas as chamadas desta avaliação, sem medir manutenção real do vault ou sessões de desenvolvimento.',
    'Memória do Ollama via /api/ps após cada chamada não é pico de RSS; RSS do runner não é memória do modelo.',
    'Checagem automática de message é parcial; texto e propostas exigem revisão humana.',
  ],
};
function save() {
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
try {
  report.ollama = await client.check();
  if (command === 'check') {
    console.log(JSON.stringify({ ...report.ollama, config, host: report.host }, null, 2));
  } else {
    save();
    for (let repeat = 1; repeat <= repeats; repeat++) {
      for (const test of cases) {
        for (const variant of (test.compareContext ? ['focused', 'full'] : ['focused']) as Array<'focused' | 'full'>) {
          const row: any = { caseId: test.id, critical: test.critical, repeat, variant, passed: false };
          const attemptStart = performance.now();
          try {
            const response = await client.chat(test.input, contextFor(test, variant));
            Object.assign(row, response);
            Object.assign(row, grade(test, JSON.parse(response.content)));
          } catch (error) {
            row.wallMs = performance.now() - attemptStart;
            row.failures = [error instanceof Error ? error.message : 'Falha desconhecida'];
          }
          try { row.modelMemory = await client.memory(); } catch { row.modelMemory = null; }
          row.runnerRssBytes = process.memoryUsage().rss;
          report.measurements.push(row);
          save();
          console.log(`${row.passed ? 'PASS' : 'FAIL'} ${test.id} ${variant} #${repeat}${row.wallMs ? ` ${Math.round(row.wallMs)}ms` : ''}${row.failures?.length ? `: ${row.failures.join('; ')}` : ''}`);
        }
      }
    }
    const rows = report.measurements;
    const latencies = rows.map((r: any) => r.wallMs).filter((v: unknown): v is number => typeof v === 'number');
    const metricSum = (key: string) => {
      const values = rows.map((r: any) => r.metrics?.[key]);
      return values.every((v: unknown) => typeof v === 'number') ? values.reduce((a: number, b: number) => a + b, 0) : null;
    };
    const memory = rows.map((r: any) => r.modelMemory?.sizeBytes).filter((v: unknown): v is number => typeof v === 'number');
    report.summary = { attempts: rows.length, passed: rows.filter((r: any) => r.passed).length,
      criticalFailures: rows.filter((r: any) => r.critical && !r.passed).length,
      latencyP50Ms: percentile(latencies, 0.5), latencyP95Ms: percentile(latencies, 0.95),
      promptTokens: metricSum('promptTokens'), outputTokens: metricSum('outputTokens'),
      totalTokens: metricSum('promptTokens') === null || metricSum('outputTokens') === null ? null : metricSum('promptTokens') + metricSum('outputTokens'),
      maxObservedModelBytes: memory.length ? Math.max(...memory) : null,
      readyForRealActions: false };
    report.status = rows.every((r: any) => r.passed) ? 'passed' : 'failed';
    report.finishedAt = new Date().toISOString();
    save();
    const summary = report.summary;
    const table = rows.map((r: any) => `| ${r.caseId} | ${r.variant} | ${r.repeat} | ${r.passed ? 'PASS' : 'FAIL'} | ${r.wallMs?.toFixed(0) ?? '-'} | ${r.metrics?.promptTokens ?? '-'} | ${r.metrics?.outputTokens ?? '-'} |`).join('\n');
    const markdown = `# Piloto local, dados fictícios\n\nModelo: ${config.model}. Ollama: ${report.ollama.version}. Digest: ${report.ollama.digest}.\n\n${summary.passed}/${summary.attempts} avaliações aprovadas; ${summary.criticalFailures} falhas críticas.\nLatência p50: ${summary.latencyP50Ms?.toFixed(0) ?? '-'} ms; p95: ${summary.latencyP95Ms?.toFixed(0) ?? '-'} ms.\nTokens totais observados: ${summary.totalTokens ?? 'indisponível'}. Maior memória observada via /api/ps: ${summary.maxObservedModelBytes ?? 'indisponível'} bytes.\n\n| Caso | Contexto | Repetição | Resultado | ms | Tokens entrada | Tokens saída |\n|---|---|---|---|---|---|---|\n${table}\n\n## Limites\n\n${report.limitations.map((s: string) => `- ${s}`).join('\n')}\n\nResultado estruturado não substitui revisão humana. Nenhuma ação real está habilitada.\n`;
    fs.writeFileSync(path.join(reportDir, 'report.md'), markdown);
    console.log(`\nRelatório: ${reportDir}\n${JSON.stringify(summary, null, 2)}`);
    if (report.status !== 'passed') process.exitCode = 1;
  }
} catch (error) {
  report.status = 'blocked';
  report.error = error instanceof Error ? error.message : 'Falha desconhecida';
  report.finishedAt = new Date().toISOString();
  save();
  console.error(`${report.error}\nConfira npm run agent:serve e o download do modelo.\nRelatório de ambiente: ${reportDir}`);
  process.exitCode = 1;
}
