import type { Occurrence } from '../shared/types.js';
import type { DemoReply, DemoPanel, DemoTurn } from '../shared/agent.js';

/**
 * No Mac o token nao e exigido; no celular ele vem da URL (?token=...) uma vez
 * e fica guardado no localStorage do aparelho.
 */
function readToken(): string {
  const fromUrl = new URLSearchParams(location.search).get('token');
  if (fromUrl) {
    try {
      localStorage.setItem('agenda:token', fromUrl);
    } catch {
      // modo privado: segue sem guardar
    }
    history.replaceState(null, '', location.pathname);
    return fromUrl;
  }
  try {
    return localStorage.getItem('agenda:token') ?? '';
  } catch {
    return '';
  }
}

const token = readToken();

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-agenda-token': token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error((data as { error?: string }).error ?? `erro ${response.status}`);
  }
  return data as T;
}

export interface Meta {
  today: string;
  tz: string;
  categories: Array<{ id: string; color: string }>;
  vaults: string[];
  whatsapp: boolean;
  agentSandbox?: boolean;
}

export interface EventPayload {
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  category?: string;
  notes?: string | null;
  location?: string | null;
  rrule?: string | null;
}

export type Scope = 'this' | 'future' | 'all';

export const api = {
  meta: () => request<Meta>('GET', '/api/meta'),

  events: (from: string, to: string) =>
    request<{ from: string; to: string; events: Occurrence[] }>(
      'GET',
      `/api/events?from=${from}&to=${to}`,
    ),

  create: (payload: EventPayload) => request<Occurrence>('POST', '/api/events', payload),

  quickAdd: (text: string) =>
    request<{ evento: Occurrence }>('POST', '/api/quick-add', { text }),

  update: (id: string, payload: Partial<EventPayload>, scope: Scope, occurrence?: string) => {
    const params = new URLSearchParams({ scope });
    if (occurrence) params.set('occurrence', occurrence);
    return request<Occurrence>('PATCH', `/api/events/${id}?${params}`, payload);
  },

  remove: (id: string, scope: Scope, occurrence?: string) => {
    const params = new URLSearchParams({ scope });
    if (occurrence) params.set('occurrence', occurrence);
    return request<{ deleted: string }>('DELETE', `/api/events/${id}?${params}`);
  },

  syncVaults: () =>
    request<{ reports: Array<{ vault: string; found: number; created: number; updated: number; removed: number }> }>(
      'POST',
      '/api/vaults/sync',
    ),
};

export const demoApi = {
  panel: () => request<DemoPanel>('GET', '/api/agent/sandbox/panel'),
  history: (conversationId: string) => request<{ turns: DemoTurn[] }>('GET', `/api/agent/sandbox/history?conversationId=${encodeURIComponent(conversationId)}`),
  chat: (body: { conversationId: string; requestId: string; input: string }) => request<DemoReply>('POST', '/api/agent/sandbox/chat', body),
};
