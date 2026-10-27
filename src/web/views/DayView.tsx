import { dateOf, formatDateBR, timeOf, WEEKDAY_LONG, weekday } from '../../shared/dates.js';
import type { Occurrence } from '../../shared/types.js';

interface Props {
  date: string;
  events: Occurrence[];
  onOpen: (occurrence: Occurrence) => void;
}

export function DayView({ date, events, onOpen }: Props) {
  const list = events.filter(
    (event) => dateOf(event.start) <= date && dateOf(event.end) >= date,
  );

  return (
    <div className="day-view">
      <h2>
        {WEEKDAY_LONG[weekday(date)]}, {formatDateBR(date)}
      </h2>

      {list.length === 0 ? (
        <p className="empty">Nada marcado nesse dia.</p>
      ) : (
        <div className="day-list">
          {list.map((event) => (
            <button key={event.occurrenceId} className="day-item" onClick={() => onOpen(event)}>
              <span className="when">
                {event.allDay ? 'dia inteiro' : `${timeOf(event.start)}\u2013${timeOf(event.end)}`}
              </span>
              <span className="bar" style={{ background: event.color }} />
              <span className="what">
                <strong>{event.title}</strong>
                <small>
                  {[
                    event.category,
                    event.location,
                    event.recurring ? 'repete' : null,
                    event.source === 'vault' ? 'do vault' : null,
                    event.source === 'whatsapp' ? 'pelo WhatsApp' : null,
                    event.source === 'ia' ? 'por IA' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
                {event.notes && <small>{event.notes}</small>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
