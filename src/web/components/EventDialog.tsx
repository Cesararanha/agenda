import { useMemo, useState } from 'react';
import { api, type Scope } from '../api.js';
import type { QuickDraft } from '../../shared/quick-add.js';
import { dateOf, timeOf } from '../../shared/dates.js';
import { formatRrule, parseRrule } from '../../shared/recurrence.js';
import { CATEGORIES, type Category, type Occurrence } from '../../shared/types.js';
import { NOME_CATEGORIA } from '../rotulos.js';

export type DialogState =
  | { mode: 'create'; date: string; time: string; title?: string; draft?: QuickDraft; notice?: string; remaining?: number; suggestionId?: string }
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
  const draft = state.mode === 'create' ? state.draft : undefined;
  const initialRepeat = useMemo(
    () => repeatFromRrule(editing?.rrule ?? draft?.rrule ?? null),
    [editing?.rrule, draft?.rrule],
  );

  const [title, setTitle] = useState(
    editing?.title ?? draft?.title ?? (state.mode === 'create' ? (state.title ?? '') : ''),
  );
  const [category, setCategory] = useState<Category>(editing?.category ?? draft?.category ?? 'outro');
  const [allDay, setAllDay] = useState(editing?.allDay ?? false);
  const [date, setDate] = useState(
    editing ? dateOf(editing.start) : state.mode === 'create' ? state.date : '',
  );
  const [startTime, setStartTime] = useState(
    editing && !editing.allDay ? (timeOf(editing.start) ?? '09:00') : state.mode === 'create' ? state.time : '09:00',
  );
  const [endTime, setEndTime] = useState(() => {
    if (editing && !editing.allDay) return timeOf(editing.end) ?? '10:00';
    if (draft) return draft.endTime;
    const base = state.mode === 'create' ? state.time : '09:00';
    const hour = Math.min(23, Number(base.slice(0, 2)) + 1);
    return `${String(hour).padStart(2, '0')}:${base.slice(3, 5)}`;
  });
  const [endDate, setEndDate] = useState(editing ? dateOf(editing.end) : '');
  const [notes, setNotes] = useState(editing?.notes ?? draft?.notes ?? '');
  const [location, setLocation] = useState(editing?.location ?? draft?.location ?? '');
  const [repeat, setRepeat] = useState<Repeat>(initialRepeat.repeat);
  const [days, setDays] = useState<number[]>(initialRepeat.days);
  const [until, setUntil] = useState(initialRepeat.until);
  const [scope, setScope] = useState<Scope>('this');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const reportError = draft ? setSaveError : onError;

  const fromVault = editing?.source === 'vault';
  const askScope = Boolean(editing?.recurring);
  const occurrenceOnly = askScope && scope === 'this';

  async function save(saveWithoutTime = false) {
    if (!title.trim()) return reportError('Falta o título.');
    if (!date) return reportError('Falta a data.');
    if (!saveWithoutTime && !allDay && (!startTime || !endTime || endTime <= startTime)) return reportError('Informe início e fim válidos. O fim precisa ser depois do início.');
    if (allDay && endDate && endDate < date) return reportError('A data final precisa ser igual ou posterior à inicial.');
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
        rrule: editing && repeat === initialRepeat.repeat && days.join(',') === initialRepeat.days.join(',') && until === initialRepeat.until
          ? editing.rrule : buildRrule(repeat, days, until, date),
      };

      if (editing) {
        await api.update(editing.seriesId, payload, askScope ? scope : 'all', editing.occurrenceDate);
        await onSaved(`Atualizado: ${payload.title}`);
      } else {
        if (draft) {
          await api.confirmQuickAdd({ title: payload.title, category, date,
            time: saveWithoutTime ? '' : startTime, endTime: saveWithoutTime ? '' : endTime,
            notes: payload.notes, location: payload.location, rrule: payload.rrule },
          { saveWithoutTime, suggestionId: state.mode === 'create' ? state.suggestionId : undefined });
        } else {
          await api.create(payload);
        }
        await onSaved(`${saveWithoutTime ? 'Sugestão guardada' : 'Marcado'}: ${payload.title}`);
      }
    } catch (error) {
      reportError((error as Error).message);
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

        {state.mode === 'create' && state.notice && <p role="status">{state.notice}</p>}
        {state.mode === 'create' && (state.remaining ?? 0) > 1 && <p>{state.remaining} propostas para revisar.</p>}
        {saveError && <p role="alert">{saveError}</p>}

        {fromVault && (
          <div className="scope-ask">
            Esse marco vem do vault ({editing?.notes ?? 'arquivo do vault'}). Mude no arquivo e
            clique em <strong>Vault</strong> pra ressincronizar: o que você editar aqui volta atrás
            na próxima sincronização.
          </div>
        )}

        {askScope && !fromVault && (
          <div className="scope-ask">
            Esse compromisso repete. O que você quer mudar?
            <div className="options">
              {(
                [
                  ['this', 'Só esse dia'],
                  ['future', 'Daqui pra frente'],
                  ['all', 'A série toda'],
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
          <label htmlFor="titulo">Título</label>
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
              disabled={occurrenceOnly}
              value={category}
              onChange={(event) => setCategory(event.target.value as Category)}
            >
              {CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {NOME_CATEGORIA[option]}
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

        {!draft && <div className="field">
          <label className="check">
            <input
              type="checkbox"
              disabled={occurrenceOnly}
              checked={allDay}
              onChange={(event) => setAllDay(event.target.checked)}
            />
            Dia inteiro
          </label>
        </div>}

        <div className="field row">
          <div>
            <label htmlFor="data">{allDay ? 'Começa em' : 'Data'}</label>
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
                <label htmlFor="inicio">Início</label>
                <input
                  id="inicio"
                  type="time"
                  step={60}
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="fim">Fim</label>
                <input
                  id="fim"
                  type="time"
                  step={60}
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
              disabled={occurrenceOnly}
              value={repeat}
              onChange={(event) => setRepeat(event.target.value as Repeat)}
            >
              <option value="none">não repete</option>
              <option value="daily">todo dia</option>
              <option value="weekly">toda semana, nesse dia</option>
              <option value="weekdays">de segunda a sexta</option>
              <option value="monthly">todo mês, nesse dia</option>
              <option value="custom">dias escolhidos</option>
            </select>
          </div>
          {repeat !== 'none' && (
            <div>
              <label htmlFor="ate">Repete até</label>
              <input
                id="ate"
                type="date"
                disabled={occurrenceOnly}
                value={until}
                onChange={(event) => setUntil(event.target.value)}
              />
            </div>
          )}
        </div>

        {occurrenceOnly && <p>Para alterar categoria, dia inteiro ou repetição, selecione “Daqui pra frente” ou “A serie toda”.</p>}
        {repeat === 'custom' && (
          <div className="field">
            <label>Dias da semana</label>
            <div className="options" style={{ display: 'flex', gap: 6 }}>
              {DAY_LABELS.map((label, index) => (
                <button
                  key={label}
                  aria-pressed={days.includes(index)}
                  disabled={occurrenceOnly}
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
          {draft && date && !startTime && !endTime && state.mode === 'create' && !state.suggestionId && (
            <button onClick={() => void save(true)} disabled={busy}>Guardar como sugestão</button>
          )}
          <button className="primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
