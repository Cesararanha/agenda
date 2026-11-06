import type { BuiltinCategory } from './types.js';

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

export const DEFAULT_COLORS: Record<BuiltinCategory, string> = {
  trabalho: '#7a4fd0',
  faculdade: '#0fa3b1',
  estudo: '#f6c700',
  projeto: '#e5532d',
  saude: '#e85c9c',
  pessoal: '#2f6fdb',
  outro: '#d9d9d6',
};

export const DEFAULT_NAMES: Record<BuiltinCategory, string> = {
  faculdade: 'Faculdade',
  trabalho: 'Trabalho',
  projeto: 'Projeto',
  estudo: 'Estudo',
  pessoal: 'Pessoal',
  saude: 'Saúde',
  outro: 'Outro',
};

export function isPaletteColor(value: unknown): value is string {
  return PALETTE.some((item) => item.cor === value);
}

function mix(hex: string, into: string, peso: number): string {
  const canal = (cor: string, inicio: number) => parseInt(cor.slice(inicio, inicio + 2), 16);
  const valor = (inicio: number) =>
    Math.round(canal(hex, inicio) * peso + canal(into, inicio) * (1 - peso)).toString(16).padStart(2, '0');
  return `#${valor(1)}${valor(3)}${valor(5)}`;
}

function contrast(a: string, b: string): number {
  const [claro, escuro] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (claro + 0.05) / (escuro + 0.05);
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

/**
 * Os tons de um compromisso: fundo claro, texto escuro da mesma cor e a barrinha.
 * A cor cheia fica para o que está acontecendo agora.
 */
export function tonesFor(hex: string): { soft: string; deep: string; bar: string } {
  // cor clara precisa entrar em maior quantidade, senão o bloco some no branco
  let peso = 0.16;
  let soft = mix(hex, '#ffffff', peso);
  while (contrast(soft, '#ffffff') < 1.15 && peso < 0.7) {
    peso += 0.02;
    soft = mix(hex, '#ffffff', peso);
  }

  let manter = 1;
  let deep = hex;
  while (contrast(deep, soft) < 4.5 && manter > 0) {
    manter -= 0.05;
    deep = mix(hex, '#000000', manter);
  }

  return { soft, deep, bar: contrast(hex, soft) >= 1.25 ? hex : deep };
}
