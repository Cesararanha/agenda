import { useEffect, useMemo, useState } from 'react';
import { api, type CategoryInfo, type Scope } from '../api.js';
import type { QuickDraft } from '../../shared/quick-add.js';
import { dateOf, minutesOfTime, timeFromMinutes, timeOf } from '../../shared/dates.js';
import { formatRrule, parseRrule } from '../../shared/recurrence.js';
import type { Category, Occurrence } from '../../shared/types.js';

export type DialogState =
  | { mode: 'create'; date: string; time: string; title?: string; draft?: QuickDraft; notice?: string; remaining?: number; suggestionId?: string }
  | { mode: 'edit'; occurrence: Occurrence };

interface Props {
  state: DialogState;
  categories: CategoryInfo[];
  onClose: () => void;
  onSaved: (message?: string) => void | Promise<void>;
}

type Repeat = 'none' | 'daily' | 'weekly' | 'weekdays' | 'monthly' | 'custom';

const DAYS = [
  ['D', 'domingo'], ['S', 'segunda'], ['T', 'terça'], ['Q', 'quarta'], ['Q', 'quinta'], ['S', 'sexta'], ['S', 'sábado'],
] as const;
const DAY_MINUTES = 24 * 60;

function durationLabel(start: string, end: string): string {
  if (!start || !end || end <= start) return '';
  const total = minutesOfTime(end) - minutesOfTime(start);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes} min`;
  return minutes ? `${hours} h ${minutes}` : `${hours} h`;
}

const Icon = ({ path }: { path: string }) => (
  <svg className="ev-icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>
);

const ICONS = {
  when: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM8 4.5V8l2.5 1.5',
  repeat: 'M11 1.5 13.5 4 11 6.5M13.5 4H5a2.5 2.5 0 0 0-2.5 2.5V7M5 14.5 2.5 12 5 9.5M2.5 12H11a2.5 2.5 0 0 0 2.5-2.5V9',
  category: 'M8.6 1.8H2.8a1 1 0 0 0-1 1v5.8l6.3 6.3a1 1 0 0 0 1.4 0l5-5a1 1 0 0 0 0-1.4L8.6 1.8ZM5.2 5.2h.01',
  place: 'M8 14.5s5-4.3 5-8.2a5 5 0 0 0-10 0c0 3.9 5 8.2 5 8.2ZM8 8a1.7 1.7 0 1 0 0-3.4A1.7 1.7 0 0 0 8 8Z',
  note: 'M2.5 4h11M2.5 8h11M2.5 12h7',
};
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

export function EventDialog({ state, categories, onClose, onSaved }: Props) {
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
  const [asking, setAsking] = useState<'save' | 'remove' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const fromVault = editing?.source === 'vault';
  const recurring = Boolean(editing?.recurring);
  const repeatUnchanged = repeat === initialRepeat.repeat && days.join(',') === initialRepeat.days.join(',') && until === initialRepeat.until;
  // categoria, dia inteiro e repetição são da série: não dá para mudar em um dia só
  const changesSeries = Boolean(editing) && (category !== editing?.category || allDay !== editing?.allDay || !repeatUnchanged);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (asking) setAsking(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [asking, onClose]);

  function changeStart(value: string) {
    // o compromisso anda inteiro: mudar o início mantém a duração
    const duration = startTime && endTime && endTime > startTime ? minutesOfTime(endTime) - minutesOfTime(startTime) : 0;
    setStartTime(value);
    if (value && duration && minutesOfTime(value) + duration < DAY_MINUTES) {
      setEndTime(timeFromMinutes(minutesOfTime(value) + duration));
    }
  }

  function validate(saveWithoutTime: boolean): boolean {
    let problem = '';
    if (!title.trim()) problem = 'Falta o título.';
    else if (!date) problem = 'Falta a data.';
    else if (!saveWithoutTime && !allDay && (!startTime || !endTime || endTime <= startTime)) problem = 'O fim precisa ser depois do início.';
    else if (allDay && endDate && endDate < date) problem = 'A data final precisa ser igual ou depois da inicial.';
    setError(problem);
    return !problem;
  }

  async function save(saveWithoutTime = false, scope: Scope = recurring ? 'this' : 'all') {
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
        rrule: editing && repeatUnchanged ? editing.rrule : buildRrule(repeat, days, until, date),
      };

      if (editing) {
        await api.update(editing.seriesId, payload, scope, editing.occurrenceDate);
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
    } catch (failure) {
      setError((failure as Error).message);
      setAsking(null);
    } finally {
      setBusy(false);
    }
  }

  async function remove(scope: Scope = recurring ? 'this' : 'all') {
    if (!editing) return;
    setBusy(true);
    try {
      await api.remove(editing.seriesId, scope, editing.occurrenceDate);
      await onSaved(`Removido: ${editing.title}`);
    } catch (failure) {
      setError((failure as Error).message);
      setAsking(null);
    } finally {
      setBusy(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (asking || busy || !validate(false)) return;
    // quem repete só precisa decidir o alcance na hora de salvar
    if (recurring && !fromVault) setAsking('save');
    else void save();
  }

  const askScope = recurring && !fromVault;
  const act = (scope: Scope) => (asking === 'remove' ? remove(scope) : save(false, scope));
  const duration = durationLabel(startTime, endTime);

  return (
    <div
      className="overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className={`dialog event-dialog cat-${category}`}
        role="dialog"
        aria-modal="true"
        aria-label={editing ? 'Compromisso' : 'Novo compromisso'}
        onSubmit={submit}
        noValidate
      >
        <div className="ev-head">
          <input
            className="ev-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus={!editing}
            placeholder="Novo compromisso"
            aria-label="Título"
          />
        </div>

        <div className="ev-body">
          {state.mode === 'create' && state.notice && <p className="ev-note" role="status">{state.notice}</p>}
          {state.mode === 'create' && (state.remaining ?? 0) > 1 && <p className="ev-note">{state.remaining} propostas para revisar.</p>}
          {fromVault && (
            <p className="ev-note">
              Vem do vault ({editing?.notes ?? 'arquivo do vault'}). Mude no arquivo e use <strong>Vault</strong> para sincronizar: o que mudar aqui volta atrás.
            </p>
          )}

          <div className="ev-row">
            <Icon path={ICONS.when} />
            <div className="ev-field">
              <div className="ev-when">
                <input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label={allDay ? 'Começa em' : 'Data'} />
                {allDay ? (
                  <>
                    <span className="ev-to">até</span>
                    <input type="date" value={endDate || date} onChange={(event) => setEndDate(event.target.value)} aria-label="Termina em" />
                  </>
                ) : (
                  <span className="ev-times">
                    <input type="time" step={60} value={startTime} onChange={(event) => changeStart(event.target.value)} aria-label="Início" />
                    <span className="ev-to">até</span>
                    <input type="time" step={60} value={endTime} onChange={(event) => setEndTime(event.target.value)} aria-label="Fim" />
                    {duration && <span className="ev-duration">{duration}</span>}
                  </span>
                )}
              </div>
              <div className="ev-quiet">
                {!draft && (
                  <button type="button" aria-pressed={allDay} onClick={() => setAllDay((value) => !value)}>Dia inteiro</button>
                )}
                <button type="button" aria-pressed={repeat !== 'none'} onClick={() => setRepeat(repeat === 'none' ? 'weekly' : 'none')}>Repetir</button>
              </div>
            </div>
          </div>

          {repeat !== 'none' && (
            <div className="ev-row">
              <Icon path={ICONS.repeat} />
              <div className="ev-field">
                <div className="ev-repeat">
                  <select value={repeat} onChange={(event) => setRepeat(event.target.value as Repeat)} aria-label="Repete">
                    <option value="daily">todo dia</option>
                    <option value="weekly">toda semana, nesse dia</option>
                    <option value="weekdays">de segunda a sexta</option>
                    <option value="monthly">todo mês, nesse dia</option>
                    <option value="custom">dias escolhidos</option>
                  </select>
                  <span className="ev-to">até</span>
                  <input type="date" value={until} onChange={(event) => setUntil(event.target.value)} aria-label="Repete até" />
                </div>
                {repeat === 'custom' && (
                  <div className="ev-days" role="group" aria-label="Dias da semana">
                    {DAYS.map(([letter, name], index) => (
                      <button
                        key={name}
                        type="button"
                        aria-pressed={days.includes(index)}
                        aria-label={name}
                        title={name}
                        onClick={() =>
                          setDays((current) =>
                            current.includes(index)
                              ? current.filter((day) => day !== index)
                              : [...current, index].sort((a, b) => a - b),
                          )
                        }
                      >
                        {letter}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="ev-row">
            <Icon path={ICONS.category} />
            <div className="ev-cats" role="radiogroup" aria-label="Categoria">
              {categories.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={item.id === category}
                  className={`ev-cat cat-${item.id}`}
                  onClick={() => setCategory(item.id)}
                >
                  <i className="sw" aria-hidden="true" />
                  {item.name}
                </button>
              ))}
            </div>
          </div>

          <div className="ev-row">
            <Icon path={ICONS.place} />
            <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Local" aria-label="Local" />
          </div>

          <div className="ev-row">
            <Icon path={ICONS.note} />
            <textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Nota" aria-label="Nota" />
          </div>

          {error && <p className="ev-error" role="alert">{error}</p>}
        </div>

        {asking === 'remove' && !askScope ? (
          <div className="ev-ask">
            <p>Remover este compromisso?</p>
            <div className="ev-ask-actions">
              <button type="button" onClick={() => setAsking(null)} disabled={busy}>Voltar</button>
              <button type="button" className="danger-solid" onClick={() => void remove()} disabled={busy}>Remover</button>
            </div>
          </div>
        ) : asking ? (
          <div className="ev-ask">
            <p>{asking === 'remove' ? 'Esse compromisso repete. O que remover?' : 'Esse compromisso repete. Onde salvar?'}</p>
            <div className="ev-ask-options">
              {([
                ['this', 'Só este dia'],
                ['future', 'Daqui pra frente'],
                ['all', 'A série toda'],
              ] as Array<[Scope, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={asking === 'remove' ? 'danger' : ''}
                  disabled={busy || (asking === 'save' && value === 'this' && changesSeries)}
                  onClick={() => void act(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {asking === 'save' && changesSeries && <p className="ev-hint">Categoria, dia inteiro e repetição valem da data em diante ou para a série toda.</p>}
            <div className="ev-ask-actions">
              <button type="button" onClick={() => setAsking(null)} disabled={busy}>Voltar</button>
            </div>
          </div>
        ) : (
          <div className="dialog-actions ev-actions">
            {editing && (
              <button type="button" className="danger" onClick={() => setAsking('remove')} disabled={busy}>Remover</button>
            )}
            <span className="spacer" />
            <button type="button" onClick={onClose} disabled={busy}>Cancelar</button>
            {draft && date && !startTime && !endTime && state.mode === 'create' && !state.suggestionId && (
              <button type="button" onClick={() => { if (validate(true)) void save(true); }} disabled={busy}>Guardar como sugestão</button>
            )}
            <button type="submit" className="primary" disabled={busy}>{busy ? 'Salvando...' : 'Salvar'}</button>
          </div>
        )}
      </form>
    </div>
  );
}
