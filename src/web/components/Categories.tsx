import { useEffect, useState } from 'react';
import { api, type CategoryInfo } from '../api.js';
import { inkFor, PALETTE } from '../../shared/cores.js';

interface Props {
  categories: CategoryInfo[];
  onChange: (categories: CategoryInfo[]) => void;
  /** ao remover, os compromissos da categoria mudam de cor na tela */
  onEventsMoved: () => void | Promise<void>;
  onClose: () => void;
}

const QUEM_FICA = 'outro';

export function Categories({ categories, onChange, onEventsMoved, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [removing, setRemoving] = useState<{ id: string; count: number } | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (removing) setRemoving(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, removing]);

  async function attempt(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function choose(id: string, color: string) {
    const before = categories;
    onChange(categories.map((item) => (item.id === id ? { ...item, color } : item)));
    return attempt(async () => {
      try {
        onChange((await api.setCategoryColor(id, color)).categories);
      } catch (failure) {
        onChange(before);
        throw failure;
      }
    });
  }

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) return;
    void attempt(async () => {
      onChange((await api.createCategory(newName)).categories);
      setNewName('');
    });
  };

  const fallbackName = categories.find((item) => item.id === QUEM_FICA)?.name ?? 'Outro';

  return (
    <div
      className="overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog colors-dialog" role="dialog" aria-modal="true" aria-labelledby="categorias-titulo">
        <h2 id="categorias-titulo">Categorias</h2>
        {error && <p role="alert">{error}</p>}

        <div className="colors-list">
          {categories.map(({ id, name, color }) => (
            <div key={id} className="colors-row">
              <span title={name}>{name}</span>
              {removing?.id === id ? (
                <div className="colors-confirm">
                  <p>
                    {removing.count === 0
                      ? 'Nenhum compromisso usa esta categoria.'
                      : `${removing.count} ${removing.count === 1 ? 'compromisso vai' : 'compromissos vão'} para ${fallbackName}.`}
                  </p>
                  <button onClick={() => setRemoving(null)} disabled={busy}>Voltar</button>
                  <button
                    className="danger-solid"
                    disabled={busy}
                    onClick={() => void attempt(async () => {
                      const result = await api.removeCategory(id);
                      onChange(result.categories);
                      setRemoving(null);
                      await onEventsMoved();
                    })}
                  >
                    Remover {name}
                  </button>
                </div>
              ) : (
                <>
                  <div className="swatches" role="radiogroup" aria-label={`Cor de ${name}`}>
                    {PALETTE.map((item) => (
                      <button
                        key={item.cor}
                        type="button"
                        className="swatch"
                        role="radio"
                        aria-checked={item.cor === color}
                        aria-label={item.nome}
                        title={item.nome}
                        disabled={busy}
                        style={{ background: item.cor, color: inkFor(item.cor) }}
                        onClick={() => void choose(id, item.cor)}
                      >
                        {item.cor === color && (
                          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6.5 5 9.5 10 3" /></svg>
                        )}
                      </button>
                    ))}
                  </div>
                  {id === QUEM_FICA ? (
                    <span className="colors-remove-slot" title="Fica sempre: recebe os compromissos das categorias removidas" />
                  ) : (
                    <button
                      className="icon ghost colors-remove"
                      aria-label={`Remover ${name}`}
                      title={`Remover ${name}`}
                      disabled={busy}
                      onClick={() => void attempt(async () => {
                        setRemoving({ id, count: (await api.categoryUsage(id)).count });
                      })}
                    >
                      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></svg>
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        <form className="colors-add" onSubmit={add}>
          <input
            value={newName}
            maxLength={30}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Nova categoria"
            aria-label="Nome da nova categoria"
          />
          <button type="submit" disabled={busy || !newName.trim()}>Adicionar</button>
        </form>

        <div className="dialog-actions">
          <span className="spacer" />
          <button className="primary" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
