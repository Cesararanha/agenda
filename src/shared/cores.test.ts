import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_COLORS, inkFor, isPaletteColor, PALETTE, tonesFor } from './cores.js';

const contraste = (a: string, b: string) => {
  const l = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const [claro, escuro] = [l(a), l(b)].sort((x, y) => y - x) as [number, number];
  return (claro + 0.05) / (escuro + 0.05);
};

test('toda cor da paleta tem texto legível', () => {
  for (const { nome, cor } of PALETTE) assert.ok(contraste(cor, inkFor(cor)) >= 4.5, nome);
});

test('as cores padrão estão na paleta', () => {
  for (const cor of Object.values(DEFAULT_COLORS)) assert.ok(isPaletteColor(cor), cor);
  assert.equal(isPaletteColor('#123456'), false);
});

test('todo bloco claro tem texto legível e não some no branco', () => {
  for (const { nome, cor } of PALETTE) {
    const { soft, deep, bar } = tonesFor(cor);
    assert.ok(contraste(deep, soft) >= 4.5, `${nome}: texto`);
    assert.ok(contraste(soft, '#ffffff') >= 1.14, `${nome}: fundo`);
    assert.ok(contraste(bar, soft) >= 1.25, `${nome}: barra`);
  }
});
