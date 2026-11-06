import { useState } from 'react';
import { api, type Meta } from '../api.js';
import { inkFor, PALETTE } from '../../shared/cores.js';
import type { Category } from '../../shared/types.js';
import { NOME_CATEGORIA } from '../rotulos.js';

interface Props {
  categories: Meta['categories'];
  onChange: (categories: Meta['categories']) => void;
  onClose: () => void;
  onError: (message: string) => void;
}

export function CategoryColors({ categories, onChange, onClose, onError }: Props) {
  const [saving, setSaving] = useState(false);

  async function choose(id: string, color: string) {
    const before = categories;
    onChange(categories.map((item) => (item.id === id ? { ...item, color } : item)));
    setSaving(true);
    try {
      onChange((await api.setCategoryColor(id, color)).categories);
    } catch (error) {
      onChange(before);
      onError(`Não consegui salvar a cor: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog colors-dialog" role="dialog" aria-modal="true" aria-labelledby="cores-titulo">
        <h2 id="cores-titulo">Cores</h2>
        <p>A cor vale para todos os compromissos da categoria, no Mac e no celular.</p>

        <div className="colors-list">
          {categories.map(({ id, color }) => {
            const nome = NOME_CATEGORIA[id as Category] ?? id;
            return (
              <div key={id} className="colors-row" role="radiogroup" aria-label={`Cor de ${nome}`}>
                <span>{nome}</span>
                <div className="swatches">
                  {PALETTE.map((item) => (
                    <button
                      key={item.cor}
                      type="button"
                      className="swatch"
                      role="radio"
                      aria-checked={item.cor === color}
                      aria-label={item.nome}
                      title={item.nome}
                      disabled={saving}
                      style={{ background: item.cor, color: inkFor(item.cor) }}
                      onClick={() => void choose(id, item.cor)}
                    >
                      {item.cor === color && (
                        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6.5 5 9.5 10 3" /></svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="dialog-actions">
          <span className="spacer" />
          <button className="primary" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
