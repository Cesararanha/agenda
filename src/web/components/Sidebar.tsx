import { useEffect, useState } from 'react';
import type { Meta } from '../api.js';
import {
  addDays,
  dateOf,
  durationMinutes,
  formatDateBR,
  MONTH_LONG,
  monthMatrix,
  now as nowIn,
  startOfWeek,
  timeOf,
  weekday,
} from '../../shared/dates.js';
import type { Occurrence } from '../../shared/types.js';
import { DIA_LONGO } from '../rotulos.js';

const MAX_PROXIMOS = 8;

interface Props {
  anchor: string;
  view: 'dia' | 'semana' | 'mes';
  today: string;
  /** de hoje até os próximos dias, independente do que está aberto no calendário */
  upcoming: Occurrence[];
  suggestions: Occurrence[];
  categories: Meta['categories'];
  canEditColors: boolean;
  onSelectDay: (date: string) => void;
  onOpen: (occurrence: Occurrence) => void;
  onGiveTime: (suggestion: Occurrence) => void;
  onColors: () => void;
  shortTitle: (text: string) => string;
}

function primeiroDoMes(date: string, delta: number): string {
  const total = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1 + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

function MiniMonth({ anchor, view, today, onSelectDay }: Pick<Props, 'anchor' | 'view' | 'today' | 'onSelectDay'>) {
  const [shown, setShown] = useState(() => primeiroDoMes(anchor, 0));
  useEffect(() => setShown(primeiroDoMes(anchor, 0)), [anchor]);

  const month = shown.slice(0, 7);
  const name = (MONTH_LONG[Number(shown.slice(5, 7)) - 1] ?? '').replace('marco', 'março');
  const week = startOfWeek(anchor);

  return (
    <section className="mini" aria-label="Escolher dia">
      <header>
        <strong>{name} <span>{shown.slice(0, 4)}</span></strong>
        <button className="icon ghost" onClick={() => setShown(primeiroDoMes(shown, -1))} aria-label="Mês anterior">
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 3 5 8l5 5" /></svg>
        </button>
        <button className="icon ghost" onClick={() => setShown(primeiroDoMes(shown, 1))} aria-label="Mês seguinte">
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m6 3 5 5-5 5" /></svg>
        </button>
      </header>
      <div className="mini-row mini-head" aria-hidden="true">
        {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((letter, index) => <span key={index}>{letter}</span>)}
      </div>
      {monthMatrix(shown).map((row) => (
        <div key={row[0]} className={`mini-row${view === 'semana' && row[0] === week ? ' is-week' : ''}`}>
          {row.map((date) => (
            <button
              key={date}
              className={`mini-day${date.slice(0, 7) === month ? '' : ' other'}${date === today ? ' is-today' : ''}`}
              aria-pressed={view === 'dia' && date === anchor}
              aria-label={formatDateBR(date)}
              onClick={() => onSelectDay(date)}
            >
              {Number(date.slice(8, 10))}
            </button>
          ))}
        </div>
      ))}
    </section>
  );
}

function diaDoGrupo(date: string, today: string): string {
  if (date === today) return 'Hoje';
  if (date === addDays(today, 1)) return 'Amanhã';
  const dia = DIA_LONGO[weekday(date)] ?? '';
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)}, ${Number(date.slice(8, 10))}`;
}

function faltam(minutos: number): string {
  if (minutos < 60) return `em ${minutos} min`;
  const horas = Math.round(minutos / 60);
  return `em ${horas} h`;
}

/** Os dias que vêm, em lista: o que está acontecendo e o que falta. */
function Upcoming({ today, upcoming, onOpen, shortTitle }: Pick<Props, 'today' | 'upcoming' | 'onOpen' | 'shortTitle'>) {
  const [now, setNow] = useState(() => nowIn());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowIn()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const diaDe = (event: Occurrence) => (dateOf(event.start) < today ? today : dateOf(event.start));
  const proximos = upcoming
    .filter((event) => (event.allDay ? dateOf(event.end) >= today : event.end > now))
    .sort((a, b) => diaDe(a).localeCompare(diaDe(b)) || Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start))
    .slice(0, MAX_PROXIMOS);
  const proximoComHora = proximos.find((event) => !event.allDay && event.start > now);

  const grupos = new Map<string, Occurrence[]>();
  grupos.set(today, []);
  for (const event of proximos) grupos.set(diaDe(event), [...(grupos.get(diaDe(event)) ?? []), event]);

  return (
    <section className="side-section">
      {[...grupos].map(([date, lista]) => (
        <div key={date} className="side-group">
          <h2>{diaDoGrupo(date, today)}</h2>
          {lista.length === 0 && <p>Nada mais hoje.</p>}
          {lista.map((event) => {
            const current = !event.allDay && event.start <= now;
            let quando = 'dia inteiro';
            if (current) quando = `agora, até ${timeOf(event.end)}`;
            else if (!event.allDay) {
              quando = `${timeOf(event.start)}–${timeOf(event.end)}`;
              if (event === proximoComHora && date === today) quando += ` · ${faltam(durationMinutes(now, event.start))}`;
            }
            return (
              <button key={event.occurrenceId} className={`side-event cat-${event.category}${current ? ' current' : ''}`} onClick={() => onOpen(event)} title={event.title}>
                <i className="sw" aria-hidden="true" />
                <span>
                  <b>{shortTitle(event.title)}</b>
                  <small>{quando}</small>
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </section>
  );
}

export function Sidebar({ anchor, view, today, upcoming, suggestions, categories, canEditColors, onSelectDay, onOpen, onGiveTime, onColors, shortTitle }: Props) {
  return (
    <aside className="sidebar">
      <MiniMonth anchor={anchor} view={view} today={today} onSelectDay={onSelectDay} />

      <div className="side-scroll">
        <Upcoming today={today} upcoming={upcoming} onOpen={onOpen} shortTitle={shortTitle} />

        {suggestions.length > 0 && (
          <section className="side-section">
            <h2>Sem horário <span>{suggestions.length}</span></h2>
            {suggestions.map((suggestion) => (
              <button key={suggestion.id} className={`side-event cat-${suggestion.category}`} onClick={() => onGiveTime(suggestion)} title={`Dar horário: ${suggestion.title}`}>
                <i className="sw" aria-hidden="true" />
                <span>
                  <b>{shortTitle(suggestion.title)}</b>
                  <small>{formatDateBR(suggestion.occurrenceDate).slice(0, 5)}</small>
                </span>
              </button>
            ))}
          </section>
        )}
      </div>

      <footer className="legend">
        <ul>
          {categories.map(({ id, name }) => (
            <li key={id} className={`cat-${id}`} title={name}>
              <i className="sw" aria-hidden="true" />
              <span>{name}</span>
            </li>
          ))}
        </ul>
        {canEditColors && <button className="link" onClick={onColors}>Editar categorias</button>}
      </footer>
    </aside>
  );
}
