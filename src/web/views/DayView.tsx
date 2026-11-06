import { addDays, dateOf, startOfWeek, weekday } from '../../shared/dates.js';
import type { Occurrence } from '../../shared/types.js';
import { DIA_CURTO, DIA_LONGO } from '../rotulos.js';
import { WeekView } from './WeekView.js';

interface Props {
  date: string;
  today: string;
  /** a semana inteira da data: a faixa do topo mostra quais dias têm compromisso */
  events: Occurrence[];
  onSelect: (date: string) => void;
  onPick: (date: string, time: string) => void;
  onOpen: (occurrence: Occurrence) => void;
  onMoved: () => void | Promise<void>;
  onError: (message: string) => void;
}

function occursOn(event: Occurrence, date: string): boolean {
  return dateOf(event.start) <= date && dateOf(event.end) >= date;
}

export function DayView({ date, today, events, onSelect, onPick, onOpen, onMoved, onError }: Props) {
  const from = startOfWeek(date);
  const days = Array.from({ length: 7 }, (_, index) => addDays(from, index));

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

      <WeekView days={[date]} today={today} events={events} onPick={onPick} onOpen={onOpen} onMoved={onMoved} onError={onError} />
    </div>
  );
}
