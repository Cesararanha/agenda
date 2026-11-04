import React, { useCallback, useEffect, useState } from 'react';
import { api, setAccessToken, Unauthorized } from '../api.js';

/** Pede o token uma vez quando a API recusa. Outros erros seguem para o App mostrar. */
export function AccessGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'checking' | 'locked' | 'open'>('checking');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const check = useCallback(async () => {
    try {
      await api.meta();
      setState('open');
    } catch (failure) {
      if (failure instanceof Unauthorized) setState('locked');
      else setState('open');
      return failure;
    }
    return null;
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  async function enter(event: React.FormEvent) {
    event.preventDefault();
    setAccessToken(value.trim());
    const failure = await check();
    if (failure instanceof Unauthorized) {
      setAccessToken('');
      setError('Token incorreto.');
    }
  }

  if (state === 'open') return <>{children}</>;
  if (state === 'checking') return null;
  return (
    <main className="access-gate">
      <form onSubmit={enter}>
        <h1>Agenda</h1>
        <label htmlFor="access-token">Token de acesso</label>
        <input id="access-token" type="password" autoComplete="current-password" autoFocus
          value={value} onChange={(event) => setValue(event.target.value)} />
        {error && <p role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={!value.trim()}>Entrar</button>
      </form>
    </main>
  );
}
