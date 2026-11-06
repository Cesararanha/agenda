import type { Category } from './types.js';

/** As cores que dá para escolher: a mesma família das frentes do painel. */
export const PALETTE = [
  { nome: 'Azul', cor: '#2f6fdb' },
  { nome: 'Amarelo', cor: '#f6c700' },
  { nome: 'Vermelho', cor: '#e5532d' },
  { nome: 'Roxo', cor: '#7a4fd0' },
  { nome: 'Turquesa', cor: '#0fa3b1' },
  { nome: 'Rosa', cor: '#e85c9c' },
  { nome: 'Céu', cor: '#62b5e5' },
  { nome: 'Lilás', cor: '#b59ae6' },
  { nome: 'Terracota', cor: '#9a5b3f' },
  { nome: 'Vinho', cor: '#a32a5e' },
  { nome: 'Preto', cor: '#0e0e0e' },
  { nome: 'Cinza', cor: '#d9d9d6' },
] as const;

export const DEFAULT_COLORS: Record<Category, string> = {
  trabalho: '#7a4fd0',
  faculdade: '#0fa3b1',
  estudo: '#f6c700',
  projeto: '#e5532d',
  saude: '#e85c9c',
  pessoal: '#2f6fdb',
  outro: '#d9d9d6',
};

export function isPaletteColor(value: unknown): value is string {
  return PALETTE.some((item) => item.cor === value);
}

function luminance(hex: string): number {
  const canal = (inicio: number) => {
    const valor = parseInt(hex.slice(inicio, inicio + 2), 16) / 255;
    return valor <= 0.03928 ? valor / 12.92 : ((valor + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

/** Texto preto ou branco, o que tiver mais contraste com o fundo. */
export function inkFor(hex: string): '#ffffff' | '#0e0e0e' {
  const fundo = luminance(hex);
  const comBranco = 1.05 / (fundo + 0.05);
  const comPreto = (fundo + 0.05) / (luminance('#0e0e0e') + 0.05);
  return comBranco >= comPreto ? '#ffffff' : '#0e0e0e';
}
