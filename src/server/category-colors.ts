import { DEFAULT_COLORS } from '../shared/cores.js';
import { CATEGORIES, type Category } from '../shared/types.js';
import { audit, queryAll, run } from './store.js';

/** A cor de cada categoria, com a escolha do dono por cima do padrão. */
export async function categoryColors(): Promise<Array<{ id: Category; color: string }>> {
  const rows = await queryAll<{ category: string; color: string }>('SELECT category, color FROM category_colors');
  const chosen = new Map(rows.map((row) => [row.category, row.color]));
  return CATEGORIES.map((id) => ({ id, color: chosen.get(id) ?? DEFAULT_COLORS[id] }));
}

export async function setCategoryColor(category: Category, color: string, actor = 'app'): Promise<void> {
  await run(
    'INSERT INTO category_colors (category, color) VALUES (?, ?) ON CONFLICT (category) DO UPDATE SET color = excluded.color',
    category, color,
  );
  await audit(actor, 'category.color', { category, color });
}
