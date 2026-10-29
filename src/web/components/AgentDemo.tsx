import { useCallback, useEffect, useRef, useState } from 'react';
import { demoApi } from '../api.js';
import type { DemoPanel, DemoTurn, DemoReply } from '../../shared/agent.js';
import { formatDateBR, formatDayLabel } from '../../shared/dates.js';
import { ResponseDetails } from './ResponseDetails.js';

interface Message { id: string; role: 'user' | 'assistant'; text: string; reply?: DemoReply }
interface PendingMessage { conversationId: string; requestId: string; input: string }
function conversationId(): string {
  try {
    const saved = sessionStorage.getItem('agent-demo:conversation');
    if (saved && /^[a-zA-Z0-9_-]{1,60}$/.test(saved)) return saved;
  } catch {}
  const id = crypto.randomUUID();
  try { sessionStorage.setItem('agent-demo:conversation', id); } catch {}
  return id;
}
const sources: Record<string, string> = { agenda: 'Agenda fictícia', 'tasks/todo.md': 'Tarefas fictícias', 'preferencias.md': 'Preferências fictícias' };
const examples = ['Como está meu dia?', 'Quais tarefas estão abertas?', 'Qual minha preferência de estudo?',
  'Salve Caminhada hoje das 16h às 17h', 'Sugira um bloco de estudo para hoje',
  'Na próxima semana coloque dentista segunda das 9h às 10h e leitura quarta.'];
function replyText(reply: DemoReply): string {
  if (reply.kind === 'created' && reply.event) return `Registrei ${reply.event.details.title} na agenda fictícia, das ${reply.event.details.start.slice(11)} às ${reply.event.details.end.slice(11)} em ${formatDateBR(reply.event.details.start.slice(0, 10))}.`;
  if (reply.kind === 'applied' && reply.event) return `Sugestão confirmada: ${reply.event.details.title} em ${formatDateBR(reply.event.details.start.slice(0, 10))}, das ${reply.event.details.start.slice(11)} às ${reply.event.details.end.slice(11)}. Registrada na agenda fictícia.`;
  if (reply.kind === 'already_applied' && !reply.plan) return 'Essa sugestão já foi aplicada. Nenhuma alteração nova foi feita.';
  return reply.message;
}

export function AgentDemo({ onCalendar }: { onCalendar: (date?: string) => void }) {
  const [conversation] = useState(conversationId);
  const [panel, setPanel] = useState<DemoPanel | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState<PendingMessage | null>(null);
  const sending = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const refresh = useCallback(async () => setPanel(await demoApi.panel()), []);

  useEffect(() => {
    let live = true;
    Promise.all([demoApi.panel(), demoApi.history(conversation)]).then(([data, history]) => {
      if (!live) return;
      setPanel(data);
      setMessages(history.turns.flatMap((turn: DemoTurn): Message[] => [
        { id: `${turn.requestId}:user`, role: 'user', text: turn.input },
        { id: `${turn.requestId}:assistant`, role: 'assistant', text: turn.reply.message, reply: turn.reply },
      ]));
      setReady(true);
    }).catch(() => { if (live) setError('Não consegui abrir a demonstração. Recarregue a página para tentar novamente.'); });
    return () => { live = false; };
  }, [conversation]);
  useEffect(() => {
    const update = () => { void refresh().catch(() => setError('Não consegui atualizar o painel. Confira a conexão com a demonstração.')); };
    const timer = window.setInterval(update, 15000);
    window.addEventListener('focus', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); };
  }, [refresh]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages, busy]);
  useEffect(() => {
    const previous = document.title;
    document.title = 'Agente César 2.0 | Demonstração';
    return () => { document.title = previous; };
  }, []);

  async function send(text: string, retry?: PendingMessage) {
    if (!text.trim() || sending.current || !ready) return;
    const body = retry ?? { conversationId: conversation, requestId: crypto.randomUUID(), input: text.trim() };
    sending.current = true;
    setBusy(true);
    setError('');
    setFailed(null);
    if (!retry) {
      setInput('');
      setMessages((current) => [...current, { id: `${body.requestId}:user`, role: 'user', text: body.input }]);
    }
    try {
      const reply = await demoApi.chat(body);
      setMessages((current) => [...current, { id: `${body.requestId}:assistant`, role: 'assistant', text: reply.message, reply }]);
      try { await refresh(); } catch { setError('A resposta chegou, mas o painel não atualizou. Recarregue para conferir a agenda.'); }
    } catch {
      setFailed(body);
      setError('A resposta não chegou. Confira o painel antes de repetir. “Tentar novamente” recupera o mesmo pedido.');
      void refresh().catch(() => {});
    } finally {
      sending.current = false;
      setBusy(false);
      textarea.current?.focus();
    }
  }
  function suggestionButton(id: string) {
    const suggestion = panel?.suggestions.find((item) => item.id === id);
    if (!suggestion) return null;
    if (suggestion.status === 'applied') return <span className="demo-applied">Aplicada na agenda fictícia</span>;
    if (suggestion.status === 'canceled') return <span className="demo-applied">Sugestão cancelada</span>;
    if (suggestion.agendaVersion !== panel?.version) return <span className="demo-applied">A agenda mudou. Peça uma nova sugestão antes de confirmar.</span>;
    return <button className="primary" disabled={busy || !ready} onClick={() => void send(`Confirmo a sugestão ${id}`)}>Confirmar sugestão</button>;
  }
  function planButtons(id: string) {
    const plan = panel?.plans.find((item) => item.id === id);
    if (!plan) return null;
    if (plan.status === 'canceled') return <span className="demo-applied">Plano cancelado</span>;
    if (plan.status === 'undone') return <span className="demo-applied">Plano desfeito</span>;
    if (plan.status === 'applied') return plan.appliedVersion === panel?.version
      ? <button disabled={busy || !ready} onClick={() => void send(`Desfaça o plano ${id}`)}>Desfazer plano</button>
      : <span className="demo-applied">Plano aplicado. A agenda recebeu outras alterações.</span>;
    if (plan.version !== panel?.version) return <span className="demo-applied">A agenda mudou. Peça um plano atualizado.</span>;
    return <><button className="primary" disabled={busy || !ready} onClick={() => void send(`Confirmo o plano ${id}`)}>{plan.replace && !plan.events.length ? 'Confirmar remoções' : plan.repeat ? 'Confirmar rotina semanal' : 'Confirmar plano completo'}</button>{' '}
      <button disabled={busy || !ready} onClick={() => void send(`Cancele o plano ${id}`)}>Cancelar plano</button></>;
  }

  return <div className="demo-app">
    <header className="demo-header">
      <div><p className="demo-eyebrow">AGENTE CÉSAR 2.0</p><h1>Seu dia, com contexto.</h1>
        <p>Demonstração com agenda, tarefas e preferências fictícias.</p></div>
      <button onClick={() => onCalendar()} disabled={busy}>Ver calendário fictício</button>
    </header>
    <div className="demo-notice">Você está em uma demonstração separada da sua agenda pessoal.</div>
    {error && <div className="banner error" role="alert">{error}
      {failed && <button disabled={busy} onClick={() => void send(failed.input, failed)}>Tentar novamente</button>}
    </div>}
    <main className="demo-layout">
      <aside className="demo-day" aria-label="Painel do dia">
        <section className="demo-card"><h2>Hoje {panel && <span>{formatDateBR(panel.day)}</span>}</h2>
          {!panel ? <p role="status">Carregando seu dia fictício…</p> : panel.events.length === 0 ? <p>Agenda livre por enquanto.</p>
            : <ol className="demo-events">{panel.events.map((event) => <li key={event.id}>
              <time>{event.allDay ? 'Dia inteiro' : event.details.start.slice(11)}{!event.allDay && <small>{event.details.end.slice(11)}</small>}</time><strong>{event.details.title}</strong>
            </li>)}</ol>}
        </section>
        <section className="demo-card"><h2>Tarefas abertas <span>{panel?.tasks.length ?? 0}</span></h2>
          {panel && !panel.contextAvailable ? <p>Não consegui consultar as tarefas fictícias.</p>
            : <ul className="demo-tasks">{panel?.tasks.map((task) => <li key={task.id}>{task.text}</li>)}</ul>}
        </section>
        {panel?.suggestions.some((item) => item.status === 'pending') && <section className="demo-card"><h2>Aguardando confirmação</h2>
          {panel.suggestions.filter((item) => item.status === 'pending').map((item) => <div className="demo-suggestion" key={item.id}>
            <strong>{item.event.title}</strong><p>{formatDateBR(item.event.start.slice(0, 10))}, {item.event.start.slice(11)} às {item.event.end.slice(11)}</p>
            {suggestionButton(item.id)}
          </div>)}
        </section>}
        {panel?.plans.some((item) => item.status === 'pending') && <section className="demo-card"><h2>Planos da semana</h2>
          {panel.plans.filter((item) => item.status === 'pending').map((item) => <div className="demo-suggestion" key={item.id}>
            <strong>{formatDateBR(item.from)} a {formatDateBR(item.to)}</strong><p>{item.removals.length} remoções nesta semana{item.events.length > 0 && <> e {item.events.length} {item.repeat ? 'séries semanais, sem data final' : 'inclusões'}</>}</p>
            <details className="demo-plan-review"><summary>Revisar todas as alterações</summary>
              <p>{item.replace ? 'Remover desta semana:' : 'Manter os compromissos existentes.'}</p>
              {item.replace && <ul>{item.removals.length ? item.removals.map((event) => <li key={event.id}>
                {formatDateBR(event.start.slice(0, 10))}, {event.allDay ? 'dia inteiro' : `${event.start.slice(11)} às ${event.end.slice(11)}`}: {event.title}
              </li>) : <li>Nenhum compromisso cadastrado.</li>}</ul>}
              <p>{!item.events.length ? 'Nenhum compromisso será adicionado.' : item.repeat ? 'Repetir toda semana, a partir destas datas:' : 'Adicionar somente nesta semana:'}</p><ul>{item.events.map((event, index) => <li key={index}>
                {item.repeat ? formatDayLabel(event.start.slice(0, 10)) : formatDateBR(event.start.slice(0, 10))}, {event.start.slice(11)} às {event.end.slice(11)}: {event.title}
              </li>)}</ul>
              {item.repeat && item.conflictsThrough && <p>Conflitos da rotina conferidos até {formatDateBR(item.conflictsThrough)}. A repetição continua sem data final.</p>}
              <p>As alterações serão aplicadas juntas após sua confirmação.</p>
            </details>{planButtons(item.id)}
          </div>)}
        </section>}
      </aside>
      <section className="demo-card demo-chat" aria-labelledby="chat-heading">
        <h2 id="chat-heading">Converse com o agente</h2>
        <div className="demo-examples" aria-label="Exemplos de mensagens">{examples.map((example) => <button key={example} disabled={!ready || busy}
          onClick={() => { setInput(example); textarea.current?.focus(); }}>{example}</button>)}</div>
        <div className="demo-messages" ref={log} role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversa de demonstração">
          {ready && messages.length === 0 && <div className="demo-welcome"><strong>Vamos organizar um dia de exemplo?</strong>
            <p>Consulte sua agenda, registre um compromisso ou peça uma sugestão de estudo. Sugestões aguardam sua confirmação.</p></div>}
          {messages.map((message) => <article key={message.id} className={`demo-message ${message.role}`}>
            <small>{message.role === 'user' ? 'Você' : 'Agente'}</small><p>{message.reply ? replyText(message.reply) : displayInput(message.text, panel)}</p>
            {message.reply?.evidenceIds.length ? <small className="demo-sources">Fontes: {message.reply.evidenceIds.map((id) => sources[id] ?? id).join(', ')}</small> : null}
            {message.reply?.diagnostics && <ResponseDetails data={message.reply.diagnostics} />}
            {message.reply?.suggestion && suggestionButton(message.reply.suggestion.id)}
            {message.reply?.plan && planButtons(message.reply.plan.id)}
            {message.reply?.event && <button disabled={busy} onClick={() => onCalendar(message.reply!.event!.details.start.slice(0, 10))}>Ver compromisso no calendário</button>}
          </article>)}
          {busy && <p className="demo-thinking" role="status">Consultando e conferindo…</p>}
        </div>
        <form className="demo-composer" onSubmit={(event) => { event.preventDefault(); void send(input); }}>
          <label htmlFor="demo-message">Sua mensagem</label>
          <textarea id="demo-message" ref={textarea} value={input} maxLength={8000} rows={2} disabled={!ready || busy}
            onChange={(event) => setInput(event.target.value)} placeholder="Ex.: Salve Leitura hoje das 16h às 17h" />
          <button className="primary" type="submit" disabled={!ready || busy || !input.trim()}>Enviar</button>
        </form>
      </section>
    </main>
  </div>;
}

function displayInput(input: string, panel: DemoPanel | null): string {
  const match = /^Confirmo a sugestão (\S+)$/.exec(input);
  const suggestion = match && panel?.suggestions.find((item) => item.id === match[1]);
  return suggestion ? `Confirmo a sugestão de ${suggestion.event.title.toLowerCase()} das ${suggestion.event.start.slice(11)} às ${suggestion.event.end.slice(11)}.` : input;
}
