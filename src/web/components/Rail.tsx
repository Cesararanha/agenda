import { useEffect, useState } from 'react';
import { dateOf, formatDateBR, now as nowIn, timeOf, weekday } from '../../shared/dates.js';
import type { Occurrence } from '../../shared/types.js';
import { DIA_CURTO } from '../rotulos.js';

interface Props {
  today: string;
  /** de hoje até os próximos dias, independente da semana aberta no calendário */
  upcoming: Occurrence[];
  suggestions: Occurrence[];
  onOpen: (occurrence: Occurrence) => void;
  onGiveTime: (suggestion: Occurrence) => void;
  shortTitle: (text: string) => string;
}

function whenLabel(event: Occurrence, today: string): string {
  const date = dateOf(event.start);
  return date === today ? 'hoje' : `${DIA_CURTO[weekday(date)]} ${Number(date.slice(8, 10))}`;
}

/** O que importa neste instante, sempre à vista, seja qual for a semana aberta. */
export function Rail({ today, upcoming, suggestions, onOpen, onGiveTime, shortTitle }: Props) {
  const [now, setNow] = useState(() => nowIn());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowIn()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const timed = upcoming.filter((event) => !event.allDay).sort((a, b) => (a.start < b.start ? -1 : 1));
  const current = timed.find((event) => event.start <= now && now < event.end);
  const next = timed.find((event) => event.start > now);
  const left = timed.filter((event) => dateOf(event.start) === today && event.end > now).length;

  return (
    <aside className="rail" aria-label="Agora">
      {current ? (
        <button className="tile tile-now" onClick={() => onOpen(current)}>
          <span className="tag">Agora</span>
          <b>{current.title}</b>
          <i>até {timeOf(current.end)}</i>
        </button>
      ) : (
        <div className="tile tile-now">
          <span className="tag">Agora</span>
          <b>Livre</b>
          <i>{next && dateOf(next.start) === today ? `até ${timeOf(next.start)}` : 'pelo resto do dia'}</i>
        </div>
      )}

      {next ? (
        <button className="tile tile-next" onClick={() => onOpen(next)}>
          <span className="tag">Próximo · {whenLabel(next, today)}</span>
          <b>{next.title}</b>
          <i className="big">{timeOf(next.start)}</i>
        </button>
      ) : (
        <div className="tile tile-next">
          <span className="tag">Próximo</span>
          <b>Nada nos próximos dias</b>
        </div>
      )}

      <div className="tile">
        <span className="tag">Restam hoje</span>
        <div className="count">
          {left}
          <small>{left === 1 ? 'compromisso' : 'compromissos'}</small>
        </div>
      </div>

      <div className="tile tile-pending">
        <span className="tag">Sem horário · {suggestions.length}</span>
        {suggestions.length === 0 ? (
          <p>Tudo tem hora marcada.</p>
        ) : (
          <>
          <p>Escolha um para dar horário.</p>
          <ul>
            {suggestions.map((suggestion) => (
              <li key={suggestion.id}>
                <button onClick={() => onGiveTime(suggestion)} title={`Dar horário: ${suggestion.title}`}>
                  <time>{formatDateBR(suggestion.occurrenceDate).slice(0, 5)}</time>
                  <span>{shortTitle(suggestion.title)}</span>
                </button>
              </li>
            ))}
          </ul>
          </>
        )}
      </div>
    </aside>
  );
}
