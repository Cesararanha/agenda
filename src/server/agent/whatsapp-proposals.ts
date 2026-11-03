import { randomBytes } from 'node:crypto';
import { dateOf, formatDateBR } from '../../shared/dates.js';
import { describeRrule, parseRrule } from '../../shared/recurrence.js';
import type { QuickDraft } from '../../shared/quick-add.js';
import { db, queryOne } from '../db.js';
import { proposeQuickAdd, quickConfirmation, quickInput, saveQuickAdd } from './quick-add.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS whatsapp_proposals (
    code TEXT PRIMARY KEY,
    sender TEXT NOT NULL,
    message_id TEXT,
    expires INTEGER NOT NULL,
    drafts TEXT NOT NULL,
    preview TEXT NOT NULL,
    confirmed INTEGER NOT NULL DEFAULT 0,
    UNIQUE (sender, message_id)
  )
`);

interface Pending {
  code: string;
  expires: number;
  drafts: string;
  preview: string;
  confirmed: number;
}

function describe(draft: QuickDraft) {
  return [
    `*${draft.title}* — ${formatDateBR(dateOf(draft.date))} ${draft.time ? `${draft.time}–${draft.endTime}` : 'sugestão sem horário'} (${draft.category})`,
    draft.location && `Local: ${draft.location}`,
    draft.notes && `Nota: ${draft.notes}`,
    draft.rrule && `Repete: ${describeRrule(parseRrule(draft.rrule))}`,
  ].filter(Boolean).join('\n');
}

export async function whatsappProposal(text: string, sender: string, messageId?: string): Promise<string> {
  const confirm = /^confirmo\s+([a-f0-9]{12})$/i.exec(text);
  if (confirm) {
    const code = confirm[1]!.toLowerCase();
    const pending = queryOne<Pending>('SELECT * FROM whatsapp_proposals WHERE sender = ? AND code = ?', sender, code);
    if (!pending || pending.expires <= Date.now()) return 'Essa proposta expirou ou não foi encontrada. Envie a frase novamente.';
    if (pending.confirmed) return 'Essa proposta já foi confirmada.';
    const drafts = quickConfirmation.parse(JSON.parse(pending.drafts));
    const created = saveQuickAdd(drafts, 'whatsapp', { allowSuggestions: true, consume: () => {
      const result = db.prepare('UPDATE whatsapp_proposals SET confirmed = 1 WHERE code = ? AND confirmed = 0').run(code);
      if (!result.changes) throw new Error('Essa proposta já foi confirmada.');
    } });
    return created.map((event) => `${event.suggestion ? 'Sugestão guardada' : 'Marcado'}: ${event.title}.`).join('\n');
  }
  if (/^(sim|confirmo|confirmar|ok)[.!]?$/i.test(text)) return 'Responda com “confirmo” e o código que veio na proposta.';

  const input = quickInput.safeParse(text);
  if (!input.success) return 'Envie uma frase de até 1500 caracteres.';
  db.prepare('DELETE FROM whatsapp_proposals WHERE expires < ?').run(Date.now() - 7 * 86_400_000);
  const previous = () => messageId ? queryOne<Pending>(
    'SELECT * FROM whatsapp_proposals WHERE sender = ? AND message_id = ?', sender, messageId,
  ) : null;
  const prior = previous();
  if (prior) return prior.confirmed ? 'Essa proposta já foi confirmada.' : prior.preview;

  const proposal = await proposeQuickAdd(input.data);
  if (proposal.conflict || !proposal.drafts.length || proposal.drafts.some((draft) => !draft.date)) {
    return [proposal.notice, proposal.question, proposal.conflict, 'Envie a frase completa com os dados atualizados.'].filter(Boolean).join('\n');
  }
  const code = randomBytes(6).toString('hex');
  const preview = [proposal.notice, ...proposal.drafts.map(describe),
    `Para guardar a proposta acima, responda *confirmo ${code}* em até 30 minutos.`,
    proposal.question && `${proposal.question} Se quiser marcar no calendário, envie a frase completa com o horário.`]
    .filter(Boolean).join('\n\n');
  db.prepare(`
    INSERT INTO whatsapp_proposals (code, sender, message_id, expires, drafts, preview)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (sender, message_id) DO NOTHING
  `).run(code, sender, messageId ?? null, Date.now() + 30 * 60_000, JSON.stringify(proposal.drafts), preview);
  const saved = previous();
  return saved?.confirmed ? 'Essa proposta já foi confirmada.' : saved?.preview ?? preview;
}
