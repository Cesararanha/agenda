import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

export interface ContextRoute { notes: string[]; includeTasks?: boolean }
export interface ContextSource { id: string; text: string }
export interface OpenTask { id: string; text: string; sourceId: string; line: number }
export interface LocalContext {
  sources: ContextSource[];
  openTasks: OpenTask[];
  readSequence: string[];
  usage: { filesRead: number; charactersRead: number; charactersReturned: number };
}
export interface ContextLimits { maxFiles: number; maxFileBytes: number; maxReadCharacters: number }
export type ContextReader = Pick<LocalContextReader, 'read'>;

/**
 * Rotas e raiz são fornecidas pelo host, nunca pelo modelo. O leitor não escreve.
 * Os índices são lidos antes das notas; seu texto não vira instrução de ferramenta.
 */
export class LocalContextReader {
  private routes: Record<string, ContextRoute>;
  private limits: ContextLimits;
  constructor(private root: string, routes: Record<string, ContextRoute>, limits: Partial<ContextLimits> = {}) {
    this.routes = structuredClone(routes);
    this.limits = { maxFiles: 12, maxFileBytes: 32768, maxReadCharacters: 12000, ...limits };
    for (const value of Object.values(this.limits)) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Limite de contexto inválido');
    }
    for (const route of Object.values(this.routes)) for (const note of route.notes) validateRelative(note);
  }

  async read(topic: string): Promise<LocalContext> {
    if (!Object.hasOwn(this.routes, topic)) throw new Error('Assunto não configurado para consulta');
    const route = this.routes[topic]!;
    const root = await fs.realpath(this.root);
    const cache = new Map<string, string>();
    let charactersRead = 0;
    const read = async (relative: string): Promise<string> => {
      validateRelative(relative);
      if (cache.has(relative)) return cache.get(relative)!;
      if (cache.size >= this.limits.maxFiles) throw new Error('Consulta excedeu o limite de arquivos');
      // Recusa atalhos que poderiam levar a outra fonte. Abre só arquivos regulares.
      let current = root;
      for (const part of relative.split('/')) {
        current = path.join(current, part);
        if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Links simbólicos não são fontes permitidas');
      }
      const canonical = await fs.realpath(current);
      const rel = path.relative(root, canonical);
      if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Fonte fora da raiz permitida');
      const handle = await fs.open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > this.limits.maxFileBytes) throw new Error('Fonte não é arquivo regular ou excede o limite');
        // Lê no máximo limite+1, mesmo se o arquivo crescer após o stat.
        const buffer = Buffer.alloc(this.limits.maxFileBytes + 1);
        let size = 0;
        while (size < buffer.length) {
          const chunk = await handle.read(buffer, size, buffer.length - size, size);
          if (chunk.bytesRead === 0) break;
          size += chunk.bytesRead;
        }
        if (size > this.limits.maxFileBytes) throw new Error('Fonte excede o limite de bytes');
        const text = buffer.subarray(0, size).toString('utf8');
        charactersRead += text.length;
        if (charactersRead > this.limits.maxReadCharacters) throw new Error('Consulta excedeu o limite de caracteres');
        cache.set(relative, text);
        return text;
      } finally { await handle.close(); }
    };
    const indexes = async (note: string) => {
      await read('AGENTS.md');
      const parts = note.split('/');
      for (let i = 1; i < parts.length; i++) await read(`${parts.slice(0, i).join('/')}/AGENTS.md`);
    };
    const sources: ContextSource[] = [];
    for (const note of [...new Set(route.notes)]) {
      await indexes(note);
      sources.push({ id: note, text: await read(note) });
    }
    const openTasks: OpenTask[] = [];
    if (route.includeTasks) {
      const taskPath = 'tasks/todo.md';
      await indexes(taskPath);
      const text = await read(taskPath);
      const lines: string[] = [];
      for (const [i, line] of text.split('\n').entries()) {
        const match = /^\s*-\s+\[ \]\s+(.+?)\s*$/.exec(line);
        if (match) {
          openTasks.push({ id: `${taskPath}:${i + 1}`, text: match[1]!, sourceId: taskPath, line: i + 1 });
          lines.push(`${i + 1}: ${match[1]}`);
        }
      }
      sources.push({ id: taskPath, text: lines.join('\n') });
    }
    return { sources, openTasks, readSequence: [...cache.keys()],
      usage: { filesRead: cache.size, charactersRead,
        charactersReturned: sources.reduce((n, source) => n + source.text.length, 0) } };
  }
}

function validateRelative(value: string): void {
  if (!value || path.isAbsolute(value) || value.includes('\\') || value.includes('\0')
    || value.split('/').some((part) => !part || part === '.' || part === '..')
    || !value.endsWith('.md')) throw new Error('Caminho de fonte inválido');
}

export function verifyEvidence(evidenceIds: string[], context: LocalContext): boolean {
  const allowed = new Set(context.sources.map((source) => source.id));
  // Só verifica atribuição. Não prova que o texto da resposta é sustentado pela fonte.
  return evidenceIds.length > 0 && evidenceIds.every((source) => allowed.has(source));
}
