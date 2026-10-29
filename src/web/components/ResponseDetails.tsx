import type { ResponseDiagnostics } from '../../shared/agent.js';

const paths: Record<ResponseDiagnostics['path'], string> = {
  calendar: 'Consulta de agenda', tasks: 'Consulta de tarefas', suggestion: 'Sugestão de organização',
  validation: 'Validação e ferramentas', weekly_plan: 'Plano semanal', memory: 'Consulta de contexto', interpretation: 'Interpretação assistida do pedido', planning: 'Planejamento com IA local', clarification: 'Esclarecimento',
  routing: 'Identificação da intenção',
};
const steps: Record<string, string> = { state: 'Conferir o estado da agenda', execute: 'Validar o pedido e executar a ação permitida',
  interpret_plan: 'Separar e conferir os compromissos do pedido completo',
  route_intent: 'Identificar a intenção para escolher a ferramenta permitida',
  propose: 'Preparar sugestão sem registrar', agenda: 'Consultar compromissos no banco', cancel: 'Cancelar a sugestão',
  plan_prepare: 'Preparar o plano completo', plan_apply: 'Validar e aplicar o plano', plan_cancel: 'Cancelar o plano', plan_undo: 'Desfazer o plano',
  read_tasks: 'Consultar a fonte de tarefas', read_context: 'Recuperar contexto permitido', check_model: 'Verificar o modelo local', generate_answer: 'Solicitar resposta ao modelo', receipt: 'Recuperar recibo da operação sem repeti-la', interpret_event: 'Identificar no pedido o título do compromisso' };
const duration = (ms: number) => ms === 0 ? 'menos de 1 ms' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
const metric = (value: number | null | undefined, format: (value: number) => string = String) => value == null ? 'Não informado' : format(value);

export function ResponseDetails({ data }: { data: ResponseDiagnostics }) {
  const model = data.model;
  const label = !model ? 'Processado por código'
    : model.status === 'needs_clarification' ? 'IA pediu esclarecimento'
    : model.status === 'completed' ? 'Usou IA local' : model.status === 'rejected' ? 'Resposta da IA recusada'
    : model.status === 'unavailable' ? 'Modelo indisponível' : 'Falha na consulta à IA';
  return <details className="demo-diagnostics">
    <summary>{label} · {duration(data.durationMs)}</summary>
    <dl><dt>Caminho</dt><dd>{paths[data.path]}</dd>
      <dt>Tempo de processamento</dt><dd>{duration(data.durationMs)}</dd>
      {model ? <><dt>Modelo</dt><dd>{model.name}</dd>
        <dt>Geração solicitada</dt><dd>{model.requested ? 'Sim' : 'Não'}</dd>
        <dt>Tentativas de geração</dt><dd>{metric(model.generations)}</dd>
        <dt>Tokens de entrada</dt><dd>{metric(model.metrics?.promptTokens)}</dd>
        <dt>Tokens de saída</dt><dd>{metric(model.metrics?.outputTokens)}</dd>
        <dt>Carregamento do modelo</dt><dd>{metric(model.metrics?.loadMs, duration)}</dd>
        <dt>Processamento da entrada</dt><dd>{metric(model.metrics?.promptMs, duration)}</dd>
        <dt>Geração da saída</dt><dd>{metric(model.metrics?.outputMs, duration)}</dd></>
        : <><dt>Modelo de linguagem</dt><dd>Não foi chamado</dd></>}
      {data.context && <><dt>Contexto lido</dt><dd>{data.context.filesRead} arquivo(s), {data.context.charactersRead} caracteres, incluindo índices</dd>
        <dt>Texto selecionado das fontes</dt><dd>{data.context.charactersReturned} caracteres</dd>
        <dt>Fontes recuperadas</dt><dd>{data.context.sourceIds.join(', ')}</dd></>}
    </dl>
    {data.steps.length > 0 && <><p>Etapas realizadas:</p><ol>{data.steps.map((step) => <li key={step}>{steps[step] ?? step}</li>)}</ol></>}
    <p>O histórico preserva as medições originais. Se a resposta precisar ser reconstruída a partir de um recibo, o tempo mede essa reconstrução.</p>
    <p>CPU, memória e energia não foram medidas nesta resposta.</p>
  </details>;
}
