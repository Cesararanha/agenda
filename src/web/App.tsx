import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Meta } from './api.js';
import { WeekView } from './views/WeekView.js';
import { DayView } from './views/DayView.js';
import { MonthView } from './views/MonthView.js';
import { EventDialog, type DialogState } from './components/EventDialog.js';
import {
  addDays,
  endOfMonth,
  endOfWeek,
  formatDateBR,
  formatRangeLabel,
  MONTH_LONG,
  startOfMonth,
  startOfWeek,
  today as todayIn,
} from '../shared/dates.js';
import type { Occurrence } from '../shared/types.js';

type View = 'dia' | 'semana' | 'mes';

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
  if (view === 'dia') return { from: anchor, to: anchor };
  if (view === 'semana') return { from: startOfWeek(anchor), to: endOfWeek(anchor) };
  const from = startOfWeek(startOfMonth(anchor));
  return { from, to: addDays(from, 41) };
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
  const [view, setView] = useState<View>(() => {
    try {
      const saved = localStorage.getItem('agenda:view');
      return saved === 'dia' || saved === 'mes' ? saved : 'semana';
    } catch {
      return 'semana';
    }
  });
  const [anchor, setAnchor] = useState<string>(() => todayIn());
  const [events, setEvents] = useState<Occurrence[]>([]);
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
  const [message, setMessage] = useState<{ text: string; kind: 'info' | 'error' } | null>(null);
  const [quick, setQuick] = useState('');
  const [busy, setBusy] = useState(false);

  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const today = meta?.today ?? todayIn();

  useEffect(() => {
    try {
      localStorage.setItem('agenda:view', view);
    } catch {
      // modo privado: nao guarda a preferencia, tudo bem
    }
  }, [view]);

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
      const [data, pendentes] = await Promise.all([
        api.events(range.from, range.to),
        api.suggestions(todayIn(), addDays(todayIn(), 180)),
      ]);
      setEvents(data.events);
      setSuggestions(pendentes.suggestions);
    } catch (error) {
      setMessage({ text: `Nao consegui carregar: ${(error as Error).message}`, kind: 'error' });
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

  const label = useMemo(() => {
    if (view === 'dia') return formatDateBR(anchor);
    if (view === 'semana') return formatRangeLabel(range.from, range.to);
    return `${MONTH_LONG[Number(anchor.slice(5, 7)) - 1]} de ${anchor.slice(0, 4)}`;
  }, [view, anchor, range.from, range.to]);

  function shift(delta: number) {
    if (view === 'dia') return setAnchor(addDays(anchor, delta));
    if (view === 'semana') return setAnchor(addDays(anchor, delta * 7));
    return setAnchor(addMonths(anchor, delta));
  }

  async function runQuickAdd(event: React.FormEvent) {
    event.preventDefault();
    const text = quick.trim();
    if (!text) return;
    setBusy(true);
    try {
      const { evento } = await api.quickAdd(text);
      setQuick('');
      setMessage({
        text: `Marcado: ${evento.title} em ${formatDateBR(evento.occurrenceDate)}${evento.allDay ? ' (dia inteiro)' : ` as ${evento.start.slice(11, 16)}`}`,
        kind: 'info',
      });
      await load();
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

  return (
    <div className="app">
      <header className="topbar">
        <h1>Agenda</h1>
        <button onClick={() => setAnchor(today)}>Hoje</button>
        <button className="ghost" onClick={() => shift(-1)} aria-label="anterior">
          &#8249;
        </button>
        <button className="ghost" onClick={() => shift(1)} aria-label="proximo">
          &#8250;
        </button>
        <span className="range-label">{label}</span>
        <span className="spacer" />
        <div className="views">
          {(['dia', 'semana', 'mes'] as View[]).map((option) => (
            <button
              key={option}
              aria-pressed={view === option}
              onClick={() => setView(option)}
            >
              {option === 'mes' ? 'Mes' : option[0]?.toUpperCase() + option.slice(1)}
            </button>
          ))}
        </div>
        <button onClick={syncVaults} disabled={busy} title="Rele os prazos do vault">
          Vault
        </button>
        <button
          className="primary"
          onClick={() =>
            setDialog({ mode: 'create', date: view === 'dia' ? anchor : today, time: '09:00' })
          }
        >
          + Novo
        </button>
      </header>

      <form className="quickbar" onSubmit={runQuickAdd}>
        <input
          value={quick}
          onChange={(event) => setQuick(event.target.value)}
          placeholder="amanha 14h dentista · toda terca 19h aula de IA · 27/10 15h-17h estudar"
          aria-label="marcar escrevendo"
        />
        <button className="primary" type="submit" disabled={busy || !quick.trim()}>
          Marcar
        </button>
      </form>

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
            sem horario definido
            <span className="sugestoes-seta">{showSuggestions ? '\u2303' : '\u2304'}</span>
          </button>
          {showSuggestions && (
            <ul className="sugestoes-lista">
              {suggestions.map((s) => (
                <li key={s.id} style={{ borderLeftColor: s.color }}>
                  <span className="sugestoes-data">{formatDateBR(s.occurrenceDate).slice(0, 5)}</span>
                  <span className="sugestoes-titulo" title={s.title}>
                    {tituloCurto(s.title)}
                  </span>
                  <button
                    className="ghost"
                    onClick={() =>
                      setDialog({
                        mode: 'create',
                        date: s.occurrenceDate,
                        time: '09:00',
                        title: tituloCurto(s.title),
                      })
                    }
                  >
                    Dar horario
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <main className="content">
        {view === 'semana' && (
          <WeekView
            from={range.from}
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
            events={events}
            onOpen={(occurrence) => setDialog({ mode: 'edit', occurrence })}
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

      {dialog && (
        <EventDialog
          state={dialog}
          onClose={() => setDialog(null)}
          onSaved={async (text) => {
            setDialog(null);
            if (text) setMessage({ text, kind: 'info' });
            await load();
          }}
          onError={(text) => setMessage({ text, kind: 'error' })}
        />
      )}
    </div>
  );
}
