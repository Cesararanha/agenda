/** Tipos compartilhados entre servidor, PWA e MCP. */

/** 'YYYY-MM-DD' */
export type DateStr = string;
/** 'YYYY-MM-DDTHH:mm' (hora local, sem fuso: a agenda e de uma pessoa, num lugar) */
export type DateTimeStr = string;

export const CATEGORIES = [
  'faculdade',
  'trabalho',
  'projeto',
  'estudo',
  'pessoal',
  'saude',
  'outro',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_COLORS: Record<Category, string> = {
  faculdade: '#5b8def',
  trabalho: '#f2994a',
  projeto: '#27ae60',
  estudo: '#9b51e0',
  pessoal: '#eb5757',
  saude: '#2d9cdb',
  outro: '#828282',
};

export type EventSource = 'app' | 'vault' | 'whatsapp' | 'ia';

/** Linha do banco: a serie, nao a ocorrencia. */
export interface EventRow {
  id: string;
  title: string;
  notes: string | null;
  location: string | null;
  start: DateTimeStr | DateStr;
  end: DateTimeStr | DateStr;
  all_day: 0 | 1;
  category: Category;
  rrule: string | null;
  exdates: string;
  source: EventSource;
  external_id: string | null;
  is_suggestion: 0 | 1;
  created_at: string;
  updated_at: string;
}

/** O que a API devolve: uma ocorrencia concreta num dia. */
export interface Occurrence {
  id: string;
  /** id da serie + data da ocorrencia, estavel: serve pra editar "só esta" */
  occurrenceId: string;
  seriesId: string;
  occurrenceDate: DateStr;
  title: string;
  notes: string | null;
  location: string | null;
  start: DateTimeStr | DateStr;
  end: DateTimeStr | DateStr;
  allDay: boolean;
  category: Category;
  color: string;
  recurring: boolean;
  rrule: string | null;
  source: EventSource;
  /** ocorrencia com horario/titulo proprio, diferente da serie */
  overridden: boolean;
  /** sem horario definido: e sugestao, nao compromisso marcado */
  suggestion: boolean;
}

export interface EventInput {
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  notes?: string | null;
  location?: string | null;
  category?: Category;
  rrule?: string | null;
  source?: EventSource;
  externalId?: string | null;
  /** Item sem horario definido: fica na lista de sugestoes, fora do calendario. */
  suggestion?: boolean;
}
