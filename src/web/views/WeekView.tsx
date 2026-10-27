import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import {
  addDays,
  addMinutes,
  dateOf,
  minutesOfTime,
  timeOf,
  WEEKDAY_SHORT,
  weekday,
} from '../../shared/dates.js';
import type { Occurrence } from '../../shared/types.js';

const HOUR_HEIGHT = 50;
const SNAP_MINUTES = 15;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface Props {
  from: string;
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
function place(occurrences: Occurrence[]): Placed[] {
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
    const startMin = minutesOfTime(timeOf(occurrence.start) ?? '00:00');
    const endSameDay = dateOf(occurrence.end) === dateOf(occurrence.start);
    const endMin = endSameDay ? minutesOfTime(timeOf(occurrence.end) ?? '00:00') : 24 * 60;
    const height = Math.max(18, ((endMin - startMin) / 60) * HOUR_HEIGHT);

    if (startMin >= clusterEnd && cluster.length) flush();

    const taken = new Set(cluster.map((item) => item.lane));
    let lane = 0;
    while (taken.has(lane)) lane++;

    cluster.push({ occurrence, top: (startMin / 60) * HOUR_HEIGHT, height, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, endMin);
  }
  if (cluster.length) flush();
  return placed;
}

export function WeekView({ from, today, events, onPick, onOpen, onMoved, onError }: Props) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(from, index));
  const gridRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [nowTop, setNowTop] = useState<number | null>(null);

  // linha do agora, so quando a semana mostrada contem hoje
  useEffect(() => {
    const update = () => {
      const current = new Date();
      const date = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
      if (date < from || date > addDays(from, 6)) return setNowTop(null);
      setNowTop(((current.getHours() * 60 + current.getMinutes()) / 60) * HOUR_HEIGHT);
    };
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, [from]);

  // abre a semana na altura da manha, nao a meia-noite
  useEffect(() => {
    const content = gridRef.current?.closest('.content');
    if (content) content.scrollTop = 7 * HOUR_HEIGHT - 20;
  }, []);

  const allDay = events.filter((event) => event.allDay);
  const timed = events.filter((event) => !event.allDay);

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
      .catch((error: Error) => onError(`Nao consegui mover: ${error.message}`));
  }

  return (
    <div className="week" ref={gridRef}>
      <div className="week-head">
        <div />
        {days.map((date) => (
          <div key={date} className={`day${date === today ? ' is-today' : ''}`}>
            {WEEKDAY_SHORT[weekday(date)]}
            <strong>{Number(date.slice(8, 10))}</strong>
          </div>
        ))}
      </div>

      <div className="allday-row">
        <div className="label">dia inteiro</div>
        {days.map((date) => (
          <div key={date} className="cell">
            {allDay
              .filter((event) => dateOf(event.start) <= date && dateOf(event.end) >= date)
              .map((event) => (
                <button
                  key={event.occurrenceId}
                  className={`chip${event.source === 'vault' ? ' from-vault' : ''}`}
                  style={{ background: event.color }}
                  onClick={() => onOpen(event)}
                  title={event.source === 'vault' ? `${event.title} (do vault)` : event.title}
                >
                  {event.title}
                </button>
              ))}
          </div>
        ))}
      </div>

      <div className="grid">
        <div className="hours">
          {HOURS.map((hour) => (
            <span key={hour}>{hour === 0 ? '' : `${String(hour).padStart(2, '0')}:00`}</span>
          ))}
        </div>

        {days.map((date) => (
          <div key={date} className={`col${date === today ? ' is-today' : ''}`}>
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="slot"
                onClick={() => onPick(date, `${String(hour).padStart(2, '0')}:00`)}
              />
            ))}

            {date === today && nowTop !== null && (
              <div className="nowline" style={{ top: nowTop }} />
            )}

            {place(timed.filter((event) => dateOf(event.start) === date)).map(
              ({ occurrence, top, height, lane, lanes }) => {
                const isDragging = drag?.id === occurrence.occurrenceId;
                const width = 100 / lanes;
                return (
                  <button
                    key={occurrence.occurrenceId}
                    className={`event${isDragging ? ' dragging' : ''}${occurrence.source === 'vault' ? ' from-vault' : ''}`}
                    style={{
                      top,
                      height,
                      left: `calc(${lane * width}% + 2px)`,
                      width: `calc(${width}% - 4px)`,
                      background: occurrence.color,
                      transform: isDragging ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
                    }}
                    onPointerDown={(pointer) => {
                      if (occurrence.source === 'vault') return;
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
                      if (!origin) return;
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
                    <span className="time">
                      {timeOf(occurrence.start)}
                      {height > 34 ? `–${timeOf(occurrence.end)}` : ''}
                    </span>
                    {occurrence.title}
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
