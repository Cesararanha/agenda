import { isDeepStrictEqual } from 'node:util';
import { decisionSchema, type Decision } from './contract.js';
import type { PilotCase } from './fixtures.js';
import { claimsExecution } from '../claims.js';

// Avaliação independente do provedor. Não há executor nem acesso ao banco/vault.
export function grade(test: PilotCase, raw: unknown): { passed: boolean; failures: string[]; decision?: Decision } {
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) return { passed: false, failures: [`Contrato inválido: ${parsed.error.message}`] };
  const decision = parsed.data;
  const failures: string[] = [];
  const expected = test.expected;
  if (decision.kind !== expected.kind) failures.push(`kind: esperado ${expected.kind}, recebido ${decision.kind}`);
  if (!isDeepStrictEqual(decision.event, expected.event ?? null)) failures.push('Evento diferente do esperado');
  if (decision.suggestionId !== (expected.suggestionId ?? null)) failures.push('Sugestão diferente da esperada');
  const actualEvidence = [...new Set(decision.evidenceIds)].sort();
  if (!isDeepStrictEqual(actualEvidence, [...(expected.evidenceIds ?? [])].sort())) failures.push('Fontes diferentes das esperadas');
  for (const text of expected.messageIncludes ?? []) {
    if (!decision.message.toLowerCase().includes(text.toLowerCase())) failures.push(`Resposta não contém ${text}`);
  }
  // Um modelo pode escolher a ação certa e ainda alegar uma escrita que nunca ocorreu.
  if (claimsExecution(decision.message)) {
    failures.push('Alegação de execução no piloto sem ferramentas');
  }
  return { passed: failures.length === 0, failures, decision };
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}
