/**
 * Importador de vault: SOMENTE LEITURA.
 * Le os prazos que ja existem no vault (tasks/todo.md e faculdade/<x>/overview.md)
 * e os espelha na agenda como marcos de dia inteiro.
 *
 * Nada e escrito no vault e nada do vault e copiado pra dentro deste repo:
 * o que fica no banco e titulo, data e o caminho de origem.
 *
 * Multi-fonte de proposito: na conta pessoal so o vault pessoal esta configurado;
 * o cofre do SENAI so entra numa instancia rodando na conta do SENAI.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, type VaultSource } from '../config.js';
import { syncExternal } from '../events.js';
import { inferCategory } from '../nlp.js';
import type { Category, EventInput } from '../../shared/types.js';

export interface VaultItem extends EventInput {
  externalId: string;
}

const TASK_LINE = /^\s*-\s*\[( |x|X)\]\s*(.+)$/;
const DATE_AT_START = /^(\d{4}-\d{2}-\d{2})\s*(?:\([^)]*\))?\s*[:\-]?\s*(.*)$/;

/** [[a|b]] -> b, [[a]] -> a, `code` -> code, **x** -> x */
function cleanText(raw: string): string {
  return raw
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, (_, link: string) => link.split('/').pop() ?? link)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function stableId(prefix: string, parts: string[]): string {
  const hash = createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
  return `${prefix}${hash}`;
}

/** A secao diz muito, mas 'Esta semana' nao diz nada: ai vale a palavra do item. */
function categoryFor(section: string, text: string): Category {
  const bySection = categoryForSection(section);
  if (bySection !== 'outro') return bySection;
  return inferCategory(text) ?? 'outro';
}

function categoryForSection(section: string): Category {
  const s = section.toLowerCase();
  if (s.includes('faculdade')) return 'faculdade';
  if (s.includes('projeto')) return 'projeto';
  if (s.includes('carreira') || s.includes('estudo')) return 'estudo';
  if (s.includes('trabalho')) return 'trabalho';
  if (s.includes('pessoal') || s.includes('saúde') || s.includes('saude')) return 'pessoal';
  return 'outro';
}

interface ParsedTask {
  date: string;
  text: string;
  done: boolean;
  section: string;
}

function parseTaskFile(content: string, onlySection?: RegExp): ParsedTask[] {
  const out: ParsedTask[] = [];
  let section = '';
  let inTargetSection = !onlySection;

  for (const line of content.split('\n')) {
    const heading = /^#{2,3}\s+(.*)$/.exec(line);
    if (heading) {
      section = cleanText(heading[1] ?? '');
      inTargetSection = onlySection ? onlySection.test(section) : true;
      continue;
    }
    if (!inTargetSection) continue;

    const task = TASK_LINE.exec(line);
    if (!task) continue;
    const done = task[1]?.toLowerCase() === 'x';
    const body = cleanText(task[2] ?? '');
    const dated = DATE_AT_START.exec(body);
    if (!dated?.[1]) continue;
    const text = cleanText(dated[2] ?? '');
    if (!text) continue;
    out.push({ date: dated[1], text, done, section });
  }
  return out;
}

function readTodo(vault: VaultSource): VaultItem[] {
  const file = path.join(vault.path, 'tasks', 'todo.md');
  if (!fs.existsSync(file)) return [];
  const prefix = `${vault.label}:todo:`;
  return parseTaskFile(fs.readFileSync(file, 'utf8'))
    .filter((t) => !t.done)
    .map((t) => ({
      title: t.text,
      start: t.date,
      end: t.date,
      allDay: true,
      category: categoryFor(t.section, t.text),
      notes: `vault ${vault.label} · tasks/todo.md${t.section ? ` · ${t.section}` : ''}`,
      externalId: stableId(prefix, [t.date, t.text]),
    }));
}

function readDisciplinas(vault: VaultSource): VaultItem[] {
  const dir = path.join(vault.path, 'faculdade');
  if (!fs.existsSync(dir)) return [];
  const items: VaultItem[] = [];
  const prefix = `${vault.label}:faculdade:`;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, 'overview.md');
    if (!fs.existsSync(file)) continue;

    const content = fs.readFileSync(file, 'utf8');
    const titleLine = /^#\s+(.*)$/m.exec(content);
    const disciplina = cleanText(titleLine?.[1] ?? entry.name);

    for (const task of parseTaskFile(content, /prazo|entrega|avalia/i)) {
      if (task.done) continue;
      items.push({
        title: `${disciplina}: ${task.text}`,
        start: task.date,
        end: task.date,
        allDay: true,
        category: 'faculdade',
        notes: `vault ${vault.label} · faculdade/${entry.name}/overview.md`,
        externalId: stableId(prefix, [entry.name, task.date, task.text]),
      });
    }
  }
  return items;
}

export interface SyncReport {
  vault: string;
  path: string;
  found: number;
  created: number;
  updated: number;
  removed: number;
}

export function syncVault(vault: VaultSource): SyncReport {
  const items = [...readTodo(vault), ...readDisciplinas(vault)];
  // dois arquivos podem citar o mesmo prazo; o externalId difere, entao desduplica por data+titulo
  const unique = new Map<string, VaultItem>();
  for (const item of items) unique.set(`${item.start}|${item.title.toLowerCase()}`, item);

  const result = syncExternal('vault', `${vault.label}:`, [...unique.values()], `vault:${vault.label}`);
  return { vault: vault.label, path: vault.path, found: unique.size, ...result };
}

export function syncAllVaults(): SyncReport[] {
  return config.vaults.map(syncVault);
}
