import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Meta } from './api.js';
import { WeekView } from './views/WeekView.js';
import { DayView } from './views/DayView.js';
import { MonthView } from './views/MonthView.js';
import { EventDialog, type DialogState } from './components/EventDialog.js';
import { AgentDemo } from './components/AgentDemo.js';
import { Sidebar } from './components/Sidebar.js';
import { DIA_LONGO } from './rotulos.js';
import { Categories } from './components/Categories.js';
import { aplicarCores, aplicarCoresGuardadas } from './cores.js';
import {
  addDays,
  endOfMonth,
  endOfWeek,
  formatDateBR,
  MONTH_LONG,
  startOfMonth,
  startOfWeek,
  today as todayIn,
  weekday,
} from '../shared/dates.js';
import type { QuickDraft } from '../shared/quick-add.js';
import type { Occurrence } from '../shared/types.js';

type View = 'dia' | 'semana' | 'mes';

aplicarCoresGuardadas();

function addMonths(date: string, delta: number): string {
  let year = Number(date.slice(0, 4));
  let month = Number(date.slice(5, 7)) + delta;
  while (month > 12) {
    month -= 12;
    year++;
  }
  while (month < 1) {
    month += 12;
    year--;
  }
  const firstOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = Number(endOfMonth(firstOfMonth).slice(8, 10));
  const day = Math.min(Number(date.slice(8, 10)), lastDay);
  return `${firstOfMonth.slice(0, 8)}${String(day).padStart(2, '0')}`;
}

function rangeFor(view: View, anchor: string): { from: string; to: string } {
  // o dia também carrega a semana: a faixa do topo mostra quais dias têm compromisso
  if (view === 'dia' || view === 'semana') return { from: startOfWeek(anchor), to: endOfWeek(anchor) };
  const from = startOfWeek(startOfMonth(anchor));
  return { from, to: addDays(from, 41) };
}

function mesDe(date: string): string {
  return (MONTH_LONG[Number(date.slice(5, 7)) - 1] ?? '').replace('marco', 'março');
}

const comMaiuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

/** O título da tela: a parte forte e a parte leve. */
function tituloDa(view: View, anchor: string, from: string, to: string): [string, string] {
  if (view === 'dia') {
    return [`${comMaiuscula(DIA_LONGO[weekday(anchor)] ?? '')}, ${Number(anchor.slice(8, 10))}`, `de ${mesDe(anchor)}`];
  }
  if (view === 'semana' && from.slice(0, 7) !== to.slice(0, 7)) {
    return [`${comMaiuscula(mesDe(from).slice(0, 3))} a ${mesDe(to).slice(0, 3)}`, to.slice(0, 4)];
  }
  return [comMaiuscula(mesDe(view === 'semana' ? from : anchor)), anchor.slice(0, 4)];
}

/**
 * Prazo que vem do vault carrega a linha inteira do todo como titulo, as vezes um
 * paragrafo com link. Na lista isso tem que caber numa linha; o texto completo
 * fica no title do elemento, e o titulo curto e o que vai pro dialogo.
 */
const LIMITE_TITULO = 80;

function tituloCurto(texto: string): string {
  const ateOPonto = (texto.split(/\.\s|\(http/)[0] ?? texto).trim();
  if (ateOPonto.length <= LIMITE_TITULO) return ateOPonto;
  // cortar no meio da palavra deixa titulo tipo "salesforce-fas...", entao
  // volta ate o ultimo espaco antes do limite
  const pedaco = ateOPonto.slice(0, LIMITE_TITULO);
  const ultimoEspaco = pedaco.lastIndexOf(' ');
  const base = ultimoEspaco > LIMITE_TITULO / 2 ? pedaco.slice(0, ultimoEspaco) : pedaco;
  return `${base.trimEnd()}...`;
}

export function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  // abre sempre na semana, em qualquer aparelho: preferência do dono
  const [view, setView] = useState<View>('semana');
  const [anchor, setAnchor] = useState<string>(() => todayIn());
  const [events, setEvents] = useState<Occurrence[]>([]);
  const [upcoming, setUpcoming] = useState<Occurrence[]>([]);
  const [suggestions, setSuggestions] = useState<Occurrence[]>([]);
  // no celular a lista aberta empurra o calendario pra fora da tela, entao ela
  // nasce recolhida em tela estreita. A escolha do Cesar vence e fica guardada.
  const [showSuggestions, setShowSuggestions] = useState(() => {
    try {
      const saved = localStorage.getItem('agenda:sugestoes');
      if (saved === 'abertas') return true;
      if (saved === 'recolhidas') return false;
    } catch {
      // modo privado: segue com o padrao da largura
    }
    return window.innerWidth > 560;
  });
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [quickQueue, setQuickQueue] = useState<QuickDraft[]>([]);
  const [quickNotice, setQuickNotice] = useState('');
  const [message, setMessage] = useState<{ text: string; kind: 'info' | 'error' } | null>(null);
  const [quick, setQuick] = useState('');
  const [busy, setBusy] = useState(false);
  const [demoCalendar, setDemoCalendar] = useState(false);
  const [colorsOpen, setColorsOpen] = useState(false);
  const quickRef = useRef<HTMLInputElement>(null);

  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);

  useEffect(() => {
    if (meta) aplicarCores(meta.categories);
  }, [meta]);
  const today = meta?.today ?? todayIn();

  useEffect(() => {
    try {
      localStorage.setItem('agenda:sugestoes', showSuggestions ? 'abertas' : 'recolhidas');
    } catch {
      // idem
    }
  }, [showSuggestions]);

  const load = useCallback(async () => {
    try {
      // as sugestoes nao seguem a janela do calendario: sao poucas e valem ser
      // vistas de uma vez, senao some da tela o que nao tem hora marcada
      const [data, pendentes, proximos] = await Promise.all([
        api.events(range.from, range.to),
        api.suggestions(todayIn(), addDays(todayIn(), 180)),
        api.events(todayIn(), addDays(todayIn(), 14)),
      ]);
      setEvents(data.events);
      setSuggestions(pendentes.suggestions);
      setUpcoming(proximos.events);
    } catch (error) {
      setMessage({ text: `Não consegui carregar: ${(error as Error).message}`, kind: 'error' });
    }
  }, [range.from, range.to]);

  useEffect(() => {
    api
      .meta()
      .then(setMeta)
      .catch((error: Error) => setMessage({ text: error.message, kind: 'error' }));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // o servidor e a fonte da verdade: WhatsApp e IA podem escrever a qualquer momento
  useEffect(() => {
    const onFocus = () => void load();
    const timer = window.setInterval(onFocus, 60_000);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const [tituloForte, tituloLeve] = tituloDa(view, anchor, range.from, range.to);

  function giveTime(s: Occurrence) {
    setDialog({
      mode: 'create',
      date: s.occurrenceDate,
      time: s.source === 'app' || s.source === 'whatsapp' ? '' : '09:00',
      title: tituloCurto(s.title),
      ...(s.source === 'app' || s.source === 'whatsapp' ? {
        suggestionId: s.seriesId,
        draft: { title: s.title, date: s.occurrenceDate, time: '', endTime: '',
          category: s.category, notes: s.notes, location: s.location, rrule: s.rrule },
      } : {}),
    });
  }

  function shift(delta: number) {
    if (view === 'dia') return setAnchor(addDays(anchor, delta));
    if (view === 'semana') return setAnchor(addDays(anchor, delta * 7));
    return setAnchor(addMonths(anchor, delta));
  }

  // atalhos de teclado: H hoje, D S M visões, setas navegam, N marca
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as HTMLElement).closest?.('input, textarea, select')) return;
      if (document.querySelector('.overlay')) return;
      const key = event.key.toLowerCase();
      if (key === 'h') setAnchor(today);
      else if (key === 'd') setView('dia');
      else if (key === 's') setView('semana');
      else if (key === 'm') setView('mes');
      else if (key === 'arrowleft') shift(-1);
      else if (key === 'arrowright') shift(1);
      else if (key === 'n') {
        event.preventDefault();
        quickRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function runQuickAdd(event: React.FormEvent) {
    event.preventDefault();
    const text = quick.trim();
    if (!text) return;
    setBusy(true);
    try {
      const proposal = await api.quickAdd(text);
      const notice = [proposal.notice, proposal.question, proposal.conflict].filter(Boolean).join(' ');
      if (!proposal.drafts.length) {
        setMessage({ text: notice, kind: 'info' });
        return;
      }
      setQuick('');
      setMessage(null);
      setQuickNotice(notice);
      setQuickQueue(proposal.drafts);
    } catch (error) {
      setMessage({ text: (error as Error).message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function syncVaults() {
    setBusy(true);
    try {
      const { reports } = await api.syncVaults();
      setMessage({
        text: reports.length
          ? reports
              .map(
                (r) =>
                  `${r.vault}: ${r.found} prazos (${r.created} novos, ${r.updated} atualizados, ${r.removed} removidos)`,
              )
              .join(' · ')
          : 'Nenhum vault configurado no .env (AGENDA_VAULTS)',
        kind: 'info',
      });
      await load();
    } catch (error) {
      setMessage({ text: (error as Error).message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (meta?.agentSandbox && !demoCalendar) return <AgentDemo onCalendar={(date) => { setMessage(null); setAnchor(date ?? today); if (date) setView('dia'); setDemoCalendar(true); void load(); }} />;

  return (
    <div className="app">
      <div className="body">
        <Sidebar
          anchor={anchor}
          view={view}
          today={today}
          upcoming={upcoming}
          suggestions={suggestions}
          categories={meta?.categories ?? []}
          canEditColors={Boolean(meta && !meta.agentSandbox)}
          onSelectDay={setAnchor}
          onOpen={(occurrence) => setDialog({ mode: 'edit', occurrence })}
          onGiveTime={giveTime}
          onColors={() => setColorsOpen(true)}
          shortTitle={tituloCurto}
        />

        <div className="work">
          <header className="topbar">
            <div className="topbar-title">
              <h1>{tituloForte} <span>{tituloLeve}</span></h1>
              {meta?.agentSandbox && <button onClick={() => setDemoCalendar(false)}>Voltar ao painel do agente</button>}
            </div>

            <form className={`quickbar${quick.trim() ? ' has-text' : ''}`} onSubmit={runQuickAdd}>
              <button
                type="button"
                className="icon new"
                aria-label="Novo compromisso"
                title="Novo compromisso"
                onClick={() => setDialog({ mode: 'create', date: view === 'dia' ? anchor : today, time: '09:00' })}
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2.5v11M2.5 8h11" /></svg>
              </button>
              <input
                ref={quickRef}
                value={quick}
                onChange={(event) => setQuick(event.target.value)}
                placeholder="amanhã 14h dentista"
                aria-label="Marcar escrevendo"
                title="Atalho: N"
              />
              <button className="primary" type="submit" disabled={busy || !quick.trim()}>
                {busy ? 'Marcando...' : 'Marcar'}
              </button>
            </form>

            <div className="topbar-views">
              <div className="views" role="group" aria-label="Visão do calendário">
                {(['dia', 'semana', 'mes'] as View[]).map((option) => (
                  <button key={option} aria-pressed={view === option} onClick={() => setView(option)}>
                    {option === 'mes' ? 'Mês' : option === 'dia' ? 'Dia' : 'Semana'}
                  </button>
                ))}
              </div>
              {meta && !meta.agentSandbox && (
                <button className="icon only-narrow" onClick={() => setColorsOpen(true)} aria-label="Editar categorias" title="Editar categorias">
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>
                </button>
              )}
              {!meta?.agentSandbox && Boolean(meta?.vaults.length) && <button onClick={syncVaults} disabled={busy} title="Relê os prazos do vault">
                Vault
              </button>}
            </div>

            <div className="topbar-nav">
              <button onClick={() => setAnchor(today)} title="Atalho: H">Hoje</button>
              <button className="icon ghost" onClick={() => shift(-1)} aria-label="Anterior" title="Anterior">
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 3 5 8l5 5" /></svg>
              </button>
              <button className="icon ghost" onClick={() => shift(1)} aria-label="Próximo" title="Próximo">
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m6 3 5 5-5 5" /></svg>
              </button>
            </div>
          </header>

          {meta?.agentSandbox && <div className="banner" role="status">Calendário de demonstração, somente com dados fictícios.</div>}

          {message && (
            <div
              className={message.kind === 'error' ? 'banner error' : 'banner'}
              onClick={() => setMessage(null)}
              role="status"
            >
              {message.text}
            </div>
          )}

          {suggestions.length > 0 && (
            <section className="sugestoes">
              <button
                className="sugestoes-cabecalho"
                onClick={() => setShowSuggestions((v) => !v)}
                aria-expanded={showSuggestions}
              >
                <span className="sugestoes-contagem">{suggestions.length}</span>
                sem horário definido
                <svg className="sugestoes-seta" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d={showSuggestions ? 'm3 10 5-5 5 5' : 'm3 6 5 5 5-5'} /></svg>
              </button>
              {showSuggestions && (
                <ul className="sugestoes-lista">
                  {suggestions.map((s) => (
                    <li key={s.id} className={`cat-${s.category}`}>
                      <i className="sw" aria-hidden="true" />
                      <span className="sugestoes-data">{formatDateBR(s.occurrenceDate).slice(0, 5)}</span>
                      <span className="sugestoes-titulo" title={s.title}>
                        {tituloCurto(s.title)}
                      </span>
                      <button onClick={() => giveTime(s)}>Dar horário</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

      <main className="content">
        {view === 'semana' && (
          <WeekView
            days={Array.from({ length: 7 }, (_, index) => addDays(range.from, index))}
            today={today}
            events={events}
            onPick={(date, time) => setDialog({ mode: 'create', date, time })}
            onOpen={(occurrence) => setDialog({ mode: 'edit', occurrence })}
            onMoved={load}
            onError={(text) => setMessage({ text, kind: 'error' })}
          />
        )}
        {view === 'dia' && (
          <DayView
            date={anchor}
            today={today}
            events={events}
            onSelect={setAnchor}
            onPick={(date, time) => setDialog({ mode: 'create', date, time })}
            onOpen={(occurrence) => setDialog({ mode: 'edit', occurrence })}
            onMoved={load}
            onError={(text) => setMessage({ text, kind: 'error' })}
          />
        )}
        {view === 'mes' && (
          <MonthView
            anchor={anchor}
            today={today}
            events={events}
            onPickDay={(date) => {
              setAnchor(date);
              setView('dia');
            }}
            onOpen={(occurrence) => setDialog({ mode: 'edit', occurrence })}
          />
        )}
      </main>
        </div>
      </div>

      {colorsOpen && meta && (
        <Categories
          categories={meta.categories}
          onChange={(categories) => setMeta({ ...meta, categories })}
          onEventsMoved={load}
          onClose={() => setColorsOpen(false)}
        />
      )}
      {quickQueue[0] && (
        <EventDialog
          key={quickQueue.length}
          state={{ mode: 'create', date: quickQueue[0].date, time: quickQueue[0].time,
            draft: quickQueue[0], notice: quickNotice, remaining: quickQueue.length }}
          categories={meta?.categories ?? []}
          onClose={() => setQuickQueue([])}
          onSaved={async (text) => {
            setQuickQueue((drafts) => drafts.slice(1));
            if (text) setMessage({ text, kind: 'info' });
            await load();
          }}
        />
      )}

      {dialog && (
        <EventDialog
          state={dialog}
          categories={meta?.categories ?? []}
          onClose={() => setDialog(null)}
          onSaved={async (text) => {
            setDialog(null);
            if (text) setMessage({ text, kind: 'info' });
            await load();
          }}
        />
      )}
    </div>
  );
}
