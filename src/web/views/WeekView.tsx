import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import {
  addDays,
  addMinutes,
  dateOf,
  minutesOfTime,
  now as nowIn,
  timeOf,
  weekday,
} from '../../shared/dates.js';
import type { Occurrence } from '../../shared/types.js';
import { hourRange } from '../../shared/grade.js';
import { DIA_CURTO } from '../rotulos.js';

const HOUR_HEIGHT = 52;
const SNAP_MINUTES = 15;

interface Props {
  /** os dias da grade: sete na semana, um na tela do dia */
  days: string[];
  today: string;
  events: Occurrence[];
  onPick: (date: string, time: string) => void;
  onOpen: (occurrence: Occurrence) => void;
  onMoved: () => void | Promise<void>;
  onError: (message: string) => void;
}

interface Placed {
  occurrence: Occurrence;
  top: number;
  height: number;
  lane: number;
  lanes: number;
}

/** Distribui eventos que se sobrepoem em faixas lado a lado. */
function minutesOf(occurrence: Occurrence): { startMin: number; endMin: number } {
  const startMin = minutesOfTime(timeOf(occurrence.start) ?? '00:00');
  const endSameDay = dateOf(occurrence.end) === dateOf(occurrence.start);
  return { startMin, endMin: endSameDay ? minutesOfTime(timeOf(occurrence.end) ?? '00:00') : 24 * 60 };
}

function place(occurrences: Occurrence[], startHour: number): Placed[] {
  const sorted = [...occurrences].sort((a, b) => (a.start < b.start ? -1 : 1));
  const placed: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;

  const flush = () => {
    const lanes = cluster.reduce((max, item) => Math.max(max, item.lane + 1), 0);
    for (const item of cluster) item.lanes = lanes;
    placed.push(...cluster);
    cluster = [];
    clusterEnd = -1;
  };

  for (const occurrence of sorted) {
    const { startMin, endMin } = minutesOf(occurrence);
    const height = Math.max(20, ((endMin - startMin) / 60) * HOUR_HEIGHT);

    if (startMin >= clusterEnd && cluster.length) flush();

    const taken = new Set(cluster.map((item) => item.lane));
    let lane = 0;
    while (taken.has(lane)) lane++;

    cluster.push({ occurrence, top: ((startMin - startHour * 60) / 60) * HOUR_HEIGHT, height, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, endMin);
  }
  if (cluster.length) flush();
  return placed;
}

export function WeekView({ days, today, events, onPick, onOpen, onMoved, onError }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  // no toque, arrastar é rolar a tela: compromisso só abre
  const touchRef = useRef(false);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [now, setNow] = useState(() => nowIn());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowIn()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const allDay = events.filter(
    (event) => event.allDay && days.some((date) => dateOf(event.start) <= date && dateOf(event.end) >= date),
  );
  const timed = events.filter((event) => !event.allDay);
  const inView = timed.filter((event) => days.includes(dateOf(event.start)));
  const { start: startHour, end: endHour } = hourRange(inView.map(minutesOf));
  const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
  // a linha do agora só existe quando o dia de hoje está na grade e dentro das horas dela
  const nowMinutes = days.includes(dateOf(now)) ? minutesOfTime(timeOf(now) ?? '00:00') : null;
  const nowTop =
    nowMinutes !== null && nowMinutes >= startHour * 60 && nowMinutes < endHour * 60
      ? ((nowMinutes - startHour * 60) / 60) * HOUR_HEIGHT
      : null;

  // abre com o agora à vista; sem ele, do começo da manhã
  useEffect(() => {
    const content = gridRef.current?.closest('.content');
    if (content) content.scrollTop = nowTop === null ? 0 : Math.max(0, nowTop - content.clientHeight / 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days[0], days.length]);

  function commitMove(occurrence: Occurrence, dx: number, dy: number) {
    const column = (gridRef.current?.querySelector('.col')?.clientWidth ?? 1) || 1;
    const deltaDays = Math.round(dx / column);
    const deltaMinutes =
      Math.round((dy / HOUR_HEIGHT) * 60 / SNAP_MINUTES) * SNAP_MINUTES;
    if (!deltaDays && !deltaMinutes) return onOpen(occurrence);

    const movedStart = addMinutes(
      `${addDays(dateOf(occurrence.start), deltaDays)}T${timeOf(occurrence.start)}`,
      deltaMinutes,
    );
    const movedEnd = addMinutes(
      `${addDays(dateOf(occurrence.end), deltaDays)}T${timeOf(occurrence.end)}`,
      deltaMinutes,
    );
    const scope = occurrence.recurring ? 'this' : 'all';

    api
      .update(occurrence.seriesId, { start: movedStart, end: movedEnd }, scope, occurrence.occurrenceDate)
      .then(() => onMoved())
      .catch((error: Error) => onError(`Não consegui mover: ${error.message}`));
  }

  return (
    <div className={`week${days.length === 1 ? ' single' : ''}`} ref={gridRef} style={{ '--cols': days.length } as React.CSSProperties}>
      {days.length > 1 && <div className="week-head">
        <div />
        {days.map((date) => (
          <div key={date} className={`day${date === today ? ' is-today' : ''}`}>
            <span>{DIA_CURTO[weekday(date)]}</span>
            <strong>{Number(date.slice(8, 10))}</strong>
          </div>
        ))}
      </div>}

      {allDay.length > 0 && <div className="allday-row">
        <div className="label">dia inteiro</div>
        {days.map((date) => (
          <div key={date} className="cell">
            {allDay
              .filter((event) => dateOf(event.start) <= date && dateOf(event.end) >= date)
              .map((event) => (
                <button
                  key={event.occurrenceId}
                  className={`chip cat-${event.category}${event.source === 'vault' ? ' from-vault' : ''}`}
                  onClick={() => onOpen(event)}
                  title={event.source === 'vault' ? `${event.title} (do vault)` : event.title}
                >
                  {event.title}
                </button>
              ))}
          </div>
        ))}
      </div>}

      <div className="grid">
        <div className="hours">
          {hours.map((hour) => (
            <span key={hour}>{hour === 0 ? '' : <>{String(hour).padStart(2, '0')}<small>:00</small></>}</span>
          ))}
          {endHour < 24 && <span className="last">{String(endHour).padStart(2, '0')}<small>:00</small></span>}
        </div>

        {nowTop !== null && (
          <>
            <div className="now-across" style={{ top: nowTop }} />
            <div className="now-label" style={{ top: nowTop }}>{timeOf(now)}</div>
          </>
        )}

        {days.map((date) => (
          <div key={date} className={`col${date === today ? ' is-today' : ''}${weekday(date) % 6 === 0 ? ' is-weekend' : ''}`}>
            {hours.map((hour) => (
              <div
                key={hour}
                className="slot"
                onClick={() => onPick(date, `${String(hour).padStart(2, '0')}:00`)}
              />
            ))}

            {date === today && nowTop !== null && (
              <div className="nowline" style={{ top: nowTop }} />
            )}

            {place(timed.filter((event) => dateOf(event.start) === date), startHour).map(
              ({ occurrence, top, height, lane, lanes }) => {
                const isDragging = drag?.id === occurrence.occurrenceId;
                const width = 100 / lanes;
                const past = occurrence.end <= now;
                const current = occurrence.start <= now && now < occurrence.end;
                const short = height < 34;
                return (
                  <button
                    key={occurrence.occurrenceId}
                    className={`event cat-${occurrence.category}${isDragging ? ' dragging' : ''}${occurrence.source === 'vault' ? ' from-vault' : ''}${past ? ' past' : ''}${current ? ' current' : ''}${short ? ' short' : ''}`}
                    style={{
                      top,
                      height,
                      left: `calc(${lane * width}% + 2px)`,
                      width: `calc(${width}% - 4px)`,
                      transform: isDragging ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
                    }}
                    onClick={(click) => {
                      // teclado (detail 0) e toque; com mouse quem abre é o onPointerUp
                      if (click.detail === 0 || touchRef.current) onOpen(occurrence);
                    }}
                    onPointerDown={(pointer) => {
                      touchRef.current = pointer.pointerType === 'touch';
                      if (touchRef.current || occurrence.source === 'vault') return;
                      originRef.current = { x: pointer.clientX, y: pointer.clientY };
                      pointer.currentTarget.setPointerCapture(pointer.pointerId);
                      setDrag({ id: occurrence.occurrenceId, dx: 0, dy: 0 });
                    }}
                    onPointerMove={(pointer) => {
                      const origin = originRef.current;
                      if (!origin || drag?.id !== occurrence.occurrenceId) return;
                      setDrag({
                        id: occurrence.occurrenceId,
                        dx: pointer.clientX - origin.x,
                        dy: pointer.clientY - origin.y,
                      });
                    }}
                    onPointerUp={(pointer) => {
                      const origin = originRef.current;
                      originRef.current = null;
                      setDrag(null);
                      if (!origin) {
                        if (occurrence.source === 'vault' && !touchRef.current) onOpen(occurrence);
                        return;
                      }
                      const dx = pointer.clientX - origin.x;
                      const dy = pointer.clientY - origin.y;
                      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return onOpen(occurrence);
                      commitMove(occurrence, dx, dy);
                    }}
                    onPointerCancel={() => {
                      originRef.current = null;
                      setDrag(null);
                    }}
                    title={`${timeOf(occurrence.start)} ${occurrence.title}`}
                  >
                    <strong>{occurrence.title}</strong>
                    <span className="time">
                      {timeOf(occurrence.start)}
                      {short ? '' : `–${timeOf(occurrence.end)}`}
                      {height >= 60 && occurrence.location ? ` · ${occurrence.location}` : ''}
                    </span>
                  </button>
                );
              },
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
