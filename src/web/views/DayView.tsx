import { useEffect, useState } from 'react';
import { addDays, dateOf, MONTH_LONG, now as nowIn, startOfWeek, timeOf, weekday } from '../../shared/dates.js';
import type { Occurrence } from '../../shared/types.js';
import { DIA_CURTO, DIA_LONGO, NOME_CATEGORIA } from '../rotulos.js';

interface Props {
  date: string;
  today: string;
  /** a semana inteira da data: a faixa do topo mostra quais dias têm compromisso */
  events: Occurrence[];
  loaded: boolean;
  onSelect: (date: string) => void;
  onOpen: (occurrence: Occurrence) => void;
  onNew: (date: string) => void;
}

function occursOn(event: Occurrence, date: string): boolean {
  return dateOf(event.start) <= date && dateOf(event.end) >= date;
}

export function DayView({ date, today, events, loaded, onSelect, onOpen, onNew }: Props) {
  const [now, setNow] = useState(() => nowIn());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowIn()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const from = startOfWeek(date);
  const days = Array.from({ length: 7 }, (_, index) => addDays(from, index));
  const list = events
    .filter((event) => occursOn(event, date))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || (a.start < b.start ? -1 : 1));

  return (
    <div className="day-view">
      <div className="week-strip" role="group" aria-label="Dias da semana">
        {days.map((day) => {
          const count = events.filter((event) => occursOn(event, day)).length;
          return (
            <button
              key={day}
              className={`strip-day${day === today ? ' is-today' : ''}`}
              aria-pressed={day === date}
              aria-label={`${DIA_LONGO[weekday(day)]}, dia ${Number(day.slice(8, 10))}, ${count} ${count === 1 ? 'compromisso' : 'compromissos'}`}
              onClick={() => onSelect(day)}
            >
              <span>{DIA_CURTO[weekday(day)]}</span>
              <strong>{Number(day.slice(8, 10))}</strong>
              <i className={count ? 'has' : ''} />
            </button>
          );
        })}
      </div>

      <h2>
        {date === today ? 'Hoje, ' : ''}
        {DIA_LONGO[weekday(date)]}, {Number(date.slice(8, 10))} de {MONTH_LONG[Number(date.slice(5, 7)) - 1]?.replace('marco', 'março')}
      </h2>

      {loaded && list.length === 0 && (
        <div className="empty">
          <p>Nada marcado neste dia.</p>
          <button onClick={() => onNew(date)}>Marcar um compromisso</button>
        </div>
      )}

      <div className="day-list">
        {list.map((event) => {
          const past = !event.allDay && event.end <= now;
          const current = !event.allDay && event.start <= now && now < event.end;
          const details = [
            event.allDay ? null : `até ${timeOf(event.end)}`,
            NOME_CATEGORIA[event.category] === event.title ? null : NOME_CATEGORIA[event.category],
            event.location,
            event.recurring ? 'repete' : null,
            event.source === 'vault' ? 'do vault' : null,
          ].filter(Boolean);
          return (
            <button
              key={event.occurrenceId}
              className={`day-item cat-${event.category}${past ? ' past' : ''}${current ? ' current' : ''}`}
              onClick={() => onOpen(event)}
            >
              <time>{event.allDay ? 'Dia todo' : timeOf(event.start)}</time>
              <span className="what">
                <strong><i className="sw" aria-hidden="true" />{event.title}</strong>
                <small>
                  {current && <em>Agora</em>}
                  {details.join(' · ')}
                </small>
                {event.notes && <small className="note">{event.notes}</small>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
