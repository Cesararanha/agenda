import { dateOf, monthMatrix, startOfMonth, timeOf, weekday } from '../../shared/dates.js';
import type { Occurrence } from '../../shared/types.js';

interface Props {
  anchor: string;
  today: string;
  events: Occurrence[];
  onPickDay: (date: string) => void;
  onOpen: (occurrence: Occurrence) => void;
}

const MAX_PER_CELL = 3;

export function MonthView({ anchor, today, events, onPickDay, onOpen }: Props) {
  const rows = monthMatrix(anchor);
  const month = startOfMonth(anchor).slice(0, 7);

  const byDay = new Map<string, Occurrence[]>();
  for (const event of events) {
    const key = dateOf(event.start);
    const list = byDay.get(key) ?? [];
    list.push(event);
    byDay.set(key, list);
  }

  return (
    <div className="month">
      <div className="month-head">
        {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((day) => (
          <div key={day}>{day}</div>
        ))}
      </div>

      {rows.map((row) => (
        <div className="month-row" key={row[0]}>
          {row.map((date) => {
            const dayEvents = byDay.get(date) ?? [];
            const classes = [
              'month-cell',
              date.slice(0, 7) === month ? '' : 'other-month',
              date === today ? 'is-today' : '',
              weekday(date) % 6 === 0 ? 'is-weekend' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <div
                key={date}
                className={classes}
                onClick={() => onPickDay(date)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onPickDay(date);
                }}
              >
                <span className="num">{Number(date.slice(8, 10))}</span>
                {dayEvents.slice(0, MAX_PER_CELL).map((event) => (
                  <button
                    key={event.occurrenceId}
                    className={`chip cat-${event.category}`}
                    title={event.title}
                    onClick={(click) => {
                      click.stopPropagation();
                      onOpen(event);
                    }}
                  >
                    {!event.allDay && <span className="chip-time">{timeOf(event.start)}</span>}
                    {event.title}
                  </button>
                ))}
                {dayEvents.length > MAX_PER_CELL && (
                  <span className="more">+{dayEvents.length - MAX_PER_CELL}</span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
