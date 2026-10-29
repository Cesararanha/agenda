import type { DemoReply, ResponseDiagnostics } from '../../shared/agent.js';
import type { LocalContext } from './context.js';

/** Uma instância por pedido. Guarda medições e identificadores, nunca texto de notas ou prompts. */
export class ResponseTrace {
  private start = performance.now();
  private steps = new Set<string>();
  private context?: ResponseDiagnostics['context'];
  private model?: ResponseDiagnostics['model'];
  record(step: string): void { this.steps.add(step); }
  read(context: LocalContext): void {
    this.record(context.sources.some((item) => item.id === 'tasks/todo.md') ? 'read_tasks' : 'read_context');
    const previous = this.context ?? { filesRead: 0, charactersRead: 0, charactersReturned: 0, sourceIds: [] };
    this.context = { filesRead: previous.filesRead + context.usage.filesRead,
      charactersRead: previous.charactersRead + context.usage.charactersRead,
      charactersReturned: previous.charactersReturned + context.usage.charactersReturned,
      sourceIds: [...new Set([...previous.sourceIds, ...context.sources.map((item) => item.id)])] };
  }
  beginModel(name: string): void { this.record('check_model'); this.model ??= { name, requested: false, generations: 0, status: 'unavailable' }; }
  requestModel(): void { this.record('generate_answer'); if (this.model) { this.model.requested = true; this.model.generations = (this.model.generations ?? 0) + 1; this.model.status = 'failed'; } }
  completeModel(metrics: NonNullable<ResponseDiagnostics['model']>['metrics']): void {
    if (this.model) {
      this.model.status = 'completed';
      const previous = this.model.metrics;
      if ((this.model.generations ?? 1) > 1) {
        this.model.metrics = previous && metrics ? Object.fromEntries(Object.entries(metrics).map(([key, value]) => {
          const old = previous[key as keyof typeof previous]; return [key, old == null || value == null ? null : old + value];
        })) as typeof metrics : undefined;
      } else this.model.metrics = structuredClone(metrics);
    }
  }
  failModel(): void { if (this.model?.requested) this.model.status = 'failed'; }
  finish(reply: DemoReply): DemoReply {
    if (reply.kind === 'ask' && this.model?.status === 'completed') this.model.status = reply.planningDraft?.missing?.length || reply.needsDetails ? 'needs_clarification' : 'rejected';
    const steps = [...this.steps];
    const path: ResponseDiagnostics['path'] = steps.includes('interpret_plan') ? 'planning' : steps.includes('interpret_event') ? 'interpretation'
      : steps.some((step) => step.startsWith('plan_')) ? 'weekly_plan'
      : steps.includes('propose') || (steps.includes('state') && steps.includes('read_context')) ? 'suggestion'
      : steps.includes('execute') || steps.includes('cancel') ? 'validation'
      : steps.includes('agenda') ? 'calendar'
      : steps.includes('read_tasks') ? 'tasks' : steps.includes('read_context') ? 'memory' : steps.includes('route_intent') ? 'routing' : this.model ? 'memory' : 'clarification';
    return { ...reply, diagnostics: structuredClone({ durationMs: Math.max(0, Math.round(performance.now() - this.start)),
      path, steps, ...(this.context ? { context: this.context } : {}), ...(this.model ? { model: this.model } : {}) }) };
  }
}
