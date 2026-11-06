import { inkFor } from '../shared/cores.js';

const CHAVE = 'agenda:cores';
type Cor = { id: string; color: string };

function pintar(cores: Cor[]): void {
  const raiz = document.documentElement.style;
  for (const { id, color } of cores) {
    raiz.setProperty(`--cat-${id}`, color);
    raiz.setProperty(`--cat-${id}-ink`, inkFor(color));
  }
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
  try {
    const guardadas = localStorage.getItem(CHAVE);
    if (guardadas) pintar(JSON.parse(guardadas) as Cor[]);
  } catch {
    // sem nada guardado, valem as cores padrão do CSS
  }
}
