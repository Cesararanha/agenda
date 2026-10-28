import { useMemo, useState } from 'react';
import { api, type Scope } from '../api.js';
import { dateOf, timeOf } from '../../shared/dates.js';
import { formatRrule, parseRrule } from '../../shared/recurrence.js';
import { CATEGORIES, type Category, type Occurrence } from '../../shared/types.js';

export type DialogState =
  | { mode: 'create'; date: string; time: string; title?: string }
  | { mode: 'edit'; occurrence: Occurrence };

interface Props {
  state: DialogState;
  onClose: () => void;
  onSaved: (message?: string) => void | Promise<void>;
  onError: (message: string) => void;
}

type Repeat = 'none' | 'daily' | 'weekly' | 'weekdays' | 'monthly' | 'custom';

const DAY_LABELS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const WEEKDAYS = [1, 2, 3, 4, 5];

function repeatFromRrule(rrule: string | null): { repeat: Repeat; days: number[]; until: string } {
  const rule = parseRrule(rrule);
  if (!rule) return { repeat: 'none', days: [], until: '' };
  const until = rule.until ?? '';
  if (rule.freq === 'DAILY') return { repeat: 'daily', days: [], until };
  if (rule.freq === 'MONTHLY') return { repeat: 'monthly', days: [], until };
  const days = rule.byday ?? [];
  if (!days.length) return { repeat: 'weekly', days: [], until };
  if (days.length === 5 && WEEKDAYS.every((day) => days.includes(day))) {
    return { repeat: 'weekdays', days, until };
  }
  return { repeat: 'custom', days, until };
}

function buildRrule(repeat: Repeat, days: number[], until: string, date: string): string | null {
  if (repeat === 'none') return null;
  const untilValue = until || undefined;
  if (repeat === 'daily') return formatRrule({ freq: 'DAILY', interval: 1, until: untilValue });
  if (repeat === 'monthly') return formatRrule({ freq: 'MONTHLY', interval: 1, until: untilValue });
  if (repeat === 'weekdays') {
    return formatRrule({ freq: 'WEEKLY', interval: 1, byday: WEEKDAYS, until: untilValue });
  }
  if (repeat === 'custom') {
    const byday = days.length ? days : [new Date(`${date}T12:00:00Z`).getUTCDay()];
    return formatRrule({ freq: 'WEEKLY', interval: 1, byday, until: untilValue });
  }
  return formatRrule({ freq: 'WEEKLY', interval: 1, until: untilValue });
}

export function EventDialog({ state, onClose, onSaved, onError }: Props) {
  const editing = state.mode === 'edit' ? state.occurrence : null;
  const initialRepeat = useMemo(
    () => repeatFromRrule(editing?.rrule ?? null),
    [editing?.rrule],
  );

  const [title, setTitle] = useState(
    editing?.title ?? (state.mode === 'create' ? (state.title ?? '') : ''),
  );
  const [category, setCategory] = useState<Category>(editing?.category ?? 'outro');
  const [allDay, setAllDay] = useState(editing?.allDay ?? false);
  const [date, setDate] = useState(
    editing ? dateOf(editing.start) : state.mode === 'create' ? state.date : '',
  );
  const [startTime, setStartTime] = useState(
    editing && !editing.allDay ? (timeOf(editing.start) ?? '09:00') : state.mode === 'create' ? state.time : '09:00',
  );
  const [endTime, setEndTime] = useState(() => {
    if (editing && !editing.allDay) return timeOf(editing.end) ?? '10:00';
    const base = state.mode === 'create' ? state.time : '09:00';
    const hour = Math.min(23, Number(base.slice(0, 2)) + 1);
    return `${String(hour).padStart(2, '0')}:${base.slice(3, 5)}`;
  });
  const [endDate, setEndDate] = useState(editing ? dateOf(editing.end) : '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [location, setLocation] = useState(editing?.location ?? '');
  const [repeat, setRepeat] = useState<Repeat>(initialRepeat.repeat);
  const [days, setDays] = useState<number[]>(initialRepeat.days);
  const [until, setUntil] = useState(initialRepeat.until);
  const [scope, setScope] = useState<Scope>('this');
  const [busy, setBusy] = useState(false);

  const fromVault = editing?.source === 'vault';
  const askScope = Boolean(editing?.recurring);

  async function save() {
    if (!title.trim()) return onError('Falta o titulo.');
    if (!date) return onError('Falta a data.');
    setBusy(true);
    try {
      const payload = {
        title: title.trim(),
        category,
        allDay,
        start: allDay ? date : `${date}T${startTime}`,
        end: allDay ? endDate || date : `${date}T${endTime}`,
        notes: notes.trim() || null,
        location: location.trim() || null,
        rrule: buildRrule(repeat, days, until, date),
      };

      if (editing) {
        await api.update(editing.seriesId, payload, askScope ? scope : 'all', editing.occurrenceDate);
        await onSaved(`Atualizado: ${payload.title}`);
      } else {
        await api.create(payload);
        await onSaved(`Marcado: ${payload.title}`);
      }
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing) return;
    setBusy(true);
    try {
      await api.remove(editing.seriesId, askScope ? scope : 'all', editing.occurrenceDate);
      await onSaved(`Removido: ${editing.title}`);
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true">
        <h2>{editing ? 'Compromisso' : 'Novo compromisso'}</h2>

        {fromVault && (
          <div className="scope-ask">
            Esse marco vem do vault ({editing?.notes ?? 'arquivo do vault'}). Mude no arquivo e
            clique em <strong>Vault</strong> pra ressincronizar: o que voce editar aqui volta atras
            na proxima sincronizacao.
          </div>
        )}

        {askScope && !fromVault && (
          <div className="scope-ask">
            Esse compromisso repete. O que voce quer mudar?
            <div className="options">
              {(
                [
                  ['this', 'So esse dia'],
                  ['future', 'Daqui pra frente'],
                  ['all', 'A serie toda'],
                ] as Array<[Scope, string]>
              ).map(([value, label]) => (
                <button key={value} aria-pressed={scope === value} onClick={() => setScope(value)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="titulo">Titulo</label>
          <input
            id="titulo"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus={!editing}
            placeholder="Aula de IA, academia, entrega do trabalho..."
          />
        </div>

        <div className="field row">
          <div>
            <label htmlFor="categoria">Categoria</label>
            <select
              id="categoria"
              value={category}
              onChange={(event) => setCategory(event.target.value as Category)}
            >
              {CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="local">Local</label>
            <input
              id="local"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="opcional"
            />
          </div>
        </div>

        <div className="field">
          <label className="check">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(event) => setAllDay(event.target.checked)}
            />
            Dia inteiro
          </label>
        </div>

        <div className="field row">
          <div>
            <label htmlFor="data">{allDay ? 'Comeca em' : 'Data'}</label>
            <input
              id="data"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          {allDay ? (
            <div>
              <label htmlFor="data-fim">Termina em</label>
              <input
                id="data-fim"
                type="date"
                value={endDate || date}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
          ) : (
            <>
              <div>
                <label htmlFor="inicio">Inicio</label>
                <input
                  id="inicio"
                  type="time"
                  step={300}
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="fim">Fim</label>
                <input
                  id="fim"
                  type="time"
                  step={300}
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                />
              </div>
            </>
          )}
        </div>

        <div className="field row">
          <div>
            <label htmlFor="repete">Repete</label>
            <select
              id="repete"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value as Repeat)}
            >
              <option value="none">nao repete</option>
              <option value="daily">todo dia</option>
              <option value="weekly">toda semana, nesse dia</option>
              <option value="weekdays">de segunda a sexta</option>
              <option value="monthly">todo mes, nesse dia</option>
              <option value="custom">dias escolhidos</option>
            </select>
          </div>
          {repeat !== 'none' && (
            <div>
              <label htmlFor="ate">Repete ate</label>
              <input
                id="ate"
                type="date"
                value={until}
                onChange={(event) => setUntil(event.target.value)}
              />
            </div>
          )}
        </div>

        {repeat === 'custom' && (
          <div className="field">
            <label>Dias da semana</label>
            <div className="options" style={{ display: 'flex', gap: 6 }}>
              {DAY_LABELS.map((label, index) => (
                <button
                  key={label}
                  aria-pressed={days.includes(index)}
                  onClick={() =>
                    setDays((current) =>
                      current.includes(index)
                        ? current.filter((day) => day !== index)
                        : [...current, index].sort((a, b) => a - b),
                    )
                  }
                  style={{ flex: 1, padding: '6px 2px' }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="nota">Nota</label>
          <textarea
            id="nota"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="opcional"
          />
        </div>

        <div className="dialog-actions">
          {editing && (
            <button className="danger" onClick={remove} disabled={busy}>
              Remover
            </button>
          )}
          <span className="spacer" />
          <button onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="primary" onClick={save} disabled={busy}>
            {busy ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
