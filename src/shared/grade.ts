/** A grade da semana vai das 7h às 22h, e só cresce para mostrar compromisso fora disso. */
export const DEFAULT_START_HOUR = 7;
export const DEFAULT_END_HOUR = 22;

/** Recebe início e fim em minutos do dia. O fim do intervalo é exclusivo. */
export function hourRange(spans: Array<{ startMin: number; endMin: number }>): { start: number; end: number } {
  let start = DEFAULT_START_HOUR;
  let end = DEFAULT_END_HOUR;
  for (const { startMin, endMin } of spans) {
    start = Math.min(start, Math.floor(startMin / 60));
    end = Math.max(end, Math.ceil(endMin / 60));
  }
  return { start, end };
}
