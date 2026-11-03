import type { Category } from './types.js';

export interface QuickDraft {
  title: string;
  date: string;
  time: string;
  endTime: string;
  category: Category;
  location: string | null;
  notes: string | null;
  rrule: string | null;
}

export interface QuickProposal {
  drafts: QuickDraft[];
  notice?: string;
  question?: string;
  conflict?: string;
}
