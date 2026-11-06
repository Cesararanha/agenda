import { DEFAULT_COLORS, inkFor, tonesFor } from '../shared/cores.js';

const CHAVE = 'agenda:cores';
type Cor = { id: string; color: string };

/** Categoria é do dono, então a folha de estilo de cada uma nasce aqui, e não no CSS. */
function pintar(cores: Cor[]): void {
  let folha = document.getElementById('cores-categorias');
  if (!folha) {
    folha = document.createElement('style');
    folha.id = 'cores-categorias';
    document.head.append(folha);
  }
  folha.textContent = cores
    .filter(({ id, color }) => /^[a-z][a-z0-9-]*$/.test(id) && /^#[0-9a-f]{6}$/i.test(color))
    .map(({ id, color }) => {
      const { soft, deep, bar } = tonesFor(color);
      return `.cat-${id} { --ev: ${color}; --ev-ink: ${inkFor(color)}; --ev-soft: ${soft}; --ev-deep: ${deep}; --ev-bar: ${bar}; }`;
    })
    .join('\n');
}

export function aplicarCores(cores: Cor[]): void {
  pintar(cores);
  try {
    localStorage.setItem(CHAVE, JSON.stringify(cores));
  } catch {
    // modo privado: só não evita a troca de cor ao abrir
  }
}

/** Evita abrir com as cores padrão por um instante, antes da resposta do servidor. */
export function aplicarCoresGuardadas(): void {
  pintar(Object.entries(DEFAULT_COLORS).map(([id, color]) => ({ id, color })));
  try {
    const guardadas = localStorage.getItem(CHAVE);
    if (guardadas) pintar(JSON.parse(guardadas) as Cor[]);
  } catch {
    // sem nada guardado, valem as cores padrão
  }
}
