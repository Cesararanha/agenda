import { randomUUID } from 'node:crypto';
import { PALETTE } from '../shared/cores.js';
import { audit, queryAll, queryOne, run, transaction } from './store.js';
import { BadRequest, NotFound } from './errors.js';

export interface CategoryInfo {
  id: string;
  name: string;
  color: string;
}

/** Para onde vão os compromissos de uma categoria removida: por isso ela não pode sair. */
export const FALLBACK_CATEGORY = 'outro';

export async function listCategories(): Promise<CategoryInfo[]> {
  return queryAll<CategoryInfo>(
    `SELECT id, name, color FROM categories ORDER BY CASE WHEN id = '${FALLBACK_CATEGORY}' THEN 1 ELSE 0 END, position, id`,
  );
}

/** Categoria que não existe mais (texto de IA, do vault, do WhatsApp) cai em Outro. */
export async function knownCategory(value: unknown): Promise<string> {
  if (typeof value !== 'string' || !value) return FALLBACK_CATEGORY;
  const found = await queryOne<{ id: string }>('SELECT id FROM categories WHERE id = ?', value);
  return found ? found.id : FALLBACK_CATEGORY;
}

export function slugOf(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  // o id vira classe de CSS: precisa começar com letra
  return /^[a-z]/.test(slug) ? slug : `categoria-${slug || randomUUID().slice(0, 8)}`.replace(/-$/, '');
}

export async function createCategory(rawName: unknown, actor = 'app'): Promise<CategoryInfo> {
  const name = typeof rawName === 'string' ? rawName.trim().replace(/\s+/g, ' ') : '';
  if (!name) throw new BadRequest('Escreva o nome da categoria.');
  if (name.length > 30) throw new BadRequest('Nome muito longo: use até 30 letras.');

  return transaction(async () => {
    const current = await listCategories();
    if (current.some((item) => item.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) {
      throw new BadRequest(`Já existe a categoria ${name}.`);
    }
    const base = slugOf(name);
    let id = base;
    for (let n = 2; current.some((item) => item.id === id); n++) id = `${base}-${n}`;
    const used = new Set(current.map((item) => item.color));
    const color = (PALETTE.find((item) => !used.has(item.cor)) ?? PALETTE[0]).cor;
    const last = await queryOne<{ position: number }>('SELECT MAX(position) AS position FROM categories');
    await run('INSERT INTO categories (id, name, color, position) VALUES (?, ?, ?, ?)', id, name, color, (last?.position ?? 0) + 1);
    await audit(actor, 'category.create', { id, name, color });
    return { id, name, color };
  });
}

export async function setCategoryColor(id: string, color: string, actor = 'app'): Promise<void> {
  if (!(await run('UPDATE categories SET color = ? WHERE id = ?', color, id))) throw new NotFound('categoria nao encontrada');
  await audit(actor, 'category.color', { category: id, color });
}

export async function categoryUsage(id: string): Promise<number> {
  const row = await queryOne<{ total: number | string }>('SELECT COUNT(*) AS total FROM events WHERE category = ?', id);
  return Number(row?.total ?? 0);
}

/** Remove a categoria e devolve quantos compromissos foram para Outro. */
export async function removeCategory(id: string, actor = 'app'): Promise<number> {
  if (id === FALLBACK_CATEGORY) throw new BadRequest('Outro não pode sair: é para onde vão os compromissos de uma categoria removida.');
  return transaction(async () => {
    if (!(await queryOne('SELECT id FROM categories WHERE id = ?', id))) throw new NotFound('categoria nao encontrada');
    const moved = await run('UPDATE events SET category = ? WHERE category = ?', FALLBACK_CATEGORY, id);
    await run('DELETE FROM categories WHERE id = ?', id);
    await audit(actor, 'category.remove', { id, moved });
    return moved;
  });
}
