/** Filtro parcial de alegações de escrita, com reconhecimento de negação simples. */
export function claimsExecution(message: string): boolean {
  const claims = /\b(salvei|salvo com sucesso|registrei|registrado com sucesso|agendei|alterei|reagendei|foi salvo|foi registrado|foi agendado)\b/gi;
  return [...message.matchAll(claims)].some((match) => {
    const before = message.slice(0, match.index);
    return !/\b(não|nao|nunca|nem)\s*$/i.test(before);
  });
}
