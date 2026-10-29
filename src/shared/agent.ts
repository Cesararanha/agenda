import type { AgendaEvent, AgentResult, Suggestion } from '../agent/core/sandbox.js';
import type { OpenTask } from '../agent/core/context.js';
import type { EventDraft } from '../agent/core/request.js';
import type { WeeklyPlan, PlanResult } from '../agent/core/weekly-plan.js';
import type { PlanningDraft } from '../agent/core/assisted-plan.js';

export interface DemoReply {
  kind: AgentResult['kind'] | PlanResult['kind'] | 'answer' | 'context_unavailable' | 'model_error';
  message: string;
  evidenceIds: string[];
  changed: boolean;
  needsDetails?: boolean;
  event?: AgendaEvent;
  suggestion?: Suggestion;
  agendaQuery?: AgendaQuery;
  eventDraft?: EventDraft;
  plan?: WeeklyPlan;
  diagnostics?: ResponseDiagnostics;
  pendingSchedule?: { date: string; start: string; end: string };
  planningDraft?: PlanningDraft;
  continuation?: Pick<DemoReply, 'event' | 'suggestion' | 'plan' | 'eventDraft' | 'pendingSchedule' | 'planningDraft' | 'agendaQuery'>;
}
export interface ResponseDiagnostics {
  durationMs: number;
  path: 'calendar' | 'tasks' | 'suggestion' | 'validation' | 'weekly_plan' | 'memory' | 'interpretation' | 'planning' | 'routing' | 'clarification';
  steps: string[];
  context?: { filesRead: number; charactersRead: number; charactersReturned: number; sourceIds: string[] };
  model?: {
    name: string;
    requested: boolean;
    generations?: number;
    status: 'completed' | 'unavailable' | 'failed' | 'rejected' | 'needs_clarification';
    metrics?: { totalMs: number | null; loadMs: number | null; promptTokens: number | null; outputTokens: number | null; promptMs: number | null; outputMs: number | null };
  };
}
export interface AgendaQuery {
  from: string;
  to: string;
  label: string;
  startTime: string;
  endTime: string;
  period?: 'morning' | 'afternoon' | 'evening' | 'early' | 'day';
  dateExplicit: boolean;
  correction?: string;
  pointTime?: string;
}
export interface DemoTurn { requestId: string; input: string; reply: DemoReply }
export interface DemoPanel {
  version: number;
  day: string;
  events: Array<AgendaEvent & { allDay?: boolean }>;
  suggestions: Suggestion[];
  tasks: OpenTask[];
  contextAvailable: boolean;
  plans: WeeklyPlan[];
}
