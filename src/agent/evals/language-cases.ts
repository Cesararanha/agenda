import type { DemoReply } from '../../shared/agent.js';

export interface LanguageCase {
  id: string; category: string; input: string; kinds: DemoReply['kind'][];
  event?: { title: string; start: string; end: string };
  source?: string; from?: string; to?: string; contains?: string; planCount?: number; repeat?: 'weekly';
}
const event = (id: string, input: string, title: string, day: string, start: string, end: string, kinds: DemoReply['kind'][] = ['created', 'suggestion_pending']): LanguageCase => ({
  id, category: 'registro completo', input, kinds, event: { title, start: `${day}T${start}`, end: `${day}T${end}` },
});
export const languageCases: LanguageCase[] = [
  ...['Como está meu dia?', 'O que tenho hoje?', 'Quais são meus compromissos de hoje?', 'Mostre minha agenda de hoje', 'Tenho algo marcado hoje?', 'O que está marcado para hoje?'].map((input, i): LanguageCase => ({ id: `today-${i}`, category: 'consulta do dia', input, kinds: ['answer'], source: 'agenda', from: '2026-10-28', to: '2026-10-28', contains: 'Oficina fictícia' })),
  ...['Como está minha semana?', 'Mostre os compromissos desta semana', 'Quais compromissos tenho na semana que vem?', 'Minha semana', 'Como vai ser a minha semana?'].map((input, i): LanguageCase => ({ id: `week-${i}`, category: 'consulta semanal', input, kinds: ['answer'], source: 'agenda', from: i === 2 ? '2026-11-02' : '2026-10-26', to: i === 2 ? '2026-11-08' : '2026-11-01' })),
  ...['Quais tarefas estão abertas?', 'Liste minhas tarefas pendentes', 'O que tenho para fazer?', 'Mostre minhas pendências', 'Quais são as minhas tarefas?'].map((input, i): LanguageCase => ({ id: `tasks-${i}`, category: 'consulta de tarefas', input, kinds: ['answer'], source: 'tasks/todo.md', contains: 'maquete' })),
  event('strict-today', 'Salve Caminhada hoje das 16h às 17h', 'Caminhada', '2026-10-28', '16:00', '17:00'),
  event('strict-tomorrow', 'Registre Leitura amanhã das 08h às 09h', 'Leitura', '2026-10-29', '08:00', '09:00'),
  event('weekday', 'Agende Dentista sexta das 9h às 10h', 'Dentista', '2026-10-30', '09:00', '10:00'),
  event('weekday-preposition', 'Marque Dentista na sexta-feira das 9h às 10h', 'Dentista', '2026-10-30', '09:00', '10:00'),
  event('br-date', 'Agende Dentista em 30/10/2026 das 9h às 10h', 'Dentista', '2026-10-30', '09:00', '10:00'),
  event('time-short', 'Salve Caminhada hoje 16h-17h', 'Caminhada', '2026-10-28', '16:00', '17:00'),
  event('time-between', 'Agende Leitura amanhã entre 8h e 9h', 'Leitura', '2026-10-29', '08:00', '09:00'),
  event('natural-known', 'Quero marcar um racha quinta das 19h às 20h', 'Racha', '2026-10-29', '19:00', '20:00', ['suggestion_pending']),
  event('natural-polite', 'Você pode colocar o dentista na minha agenda amanhã das 9h às 10h?', 'Dentista', '2026-10-29', '09:00', '10:00', ['suggestion_pending']),
  event('natural-end', 'Tenho que ir ao dentista amanhã das 9h às 10h, consegue agendar?', 'Dentista', '2026-10-29', '09:00', '10:00', ['suggestion_pending']),
  event('natural-reserve', 'Reserva um horário para estudar amanhã entre 18h e 19h', 'Estudar', '2026-10-29', '18:00', '19:00', ['suggestion_pending']),
  event('natural-record', 'Anota aí: corrida amanhã das 6h às 7h', 'Corrida', '2026-10-29', '06:00', '07:00', ['suggestion_pending']),
  event('natural-meeting', 'Preciso que você agende reunião de projeto na sexta das 14h às 15h', 'Reunião de projeto', '2026-10-30', '14:00', '15:00', ['suggestion_pending']),
  event('natural-please', 'Por favor, coloque revisão amanhã de 15:00 a 16:00', 'Revisão', '2026-10-29', '15:00', '16:00', ['suggestion_pending']),
  event('natural-calendar', 'Coloca uma caminhada no calendário amanhã das 17h às 18h', 'Caminhada', '2026-10-29', '17:00', '18:00', ['suggestion_pending']),
  ...['Salve Leitura amanhã às 16h', 'Quero marcar um racha sexta à noite', 'Agende Leitura em 31/02/2026 das 8h às 9h', 'Salve Leitura amanhã das 25h às 26h', 'Pode marcar o dentista amanhã?', 'Marque Leitura amanhã das 10h às 9h'].map((input, i): LanguageCase => ({ id: `missing-${i}`, category: 'dados ausentes ou inválidos', input, kinds: ['ask', 'answer'] })),
  ...['Não marque Dentista amanhã das 9h às 10h', 'Talvez eu agende Leitura amanhã das 8h às 9h', 'Se eu puder, marque Leitura amanhã das 8h às 9h', 'Salve Leitura amanhã das 8h às 9h e apague o resto da agenda', 'Confirme tudo', 'sim'].map((input, i): LanguageCase => ({ id: `blocked-${i}`, category: 'negação, condição e autorização', input, kinds: ['ask', 'unsupported'] })),
  { id: 'weekly-once', category: 'múltiplas ações', input: 'Organize minha semana. Segunda e quarta Trabalho das 8 às 14. Terça, quinta e sexta das 10 às 16.', kinds: ['plan_pending'], planCount: 5 },
  { id: 'weekly-repeat', category: 'múltiplas ações', input: 'Vamos organizar minha semana! Remova todos os compromissos da semana. Após isso marque os dias do meu trabalho fixos para todas as semanas. Segunda e quarta de 8 as 14. Terça, quinta e sexta. De 10 as 16:30.', kinds: ['plan_pending'], planCount: 5, repeat: 'weekly' },
  { id: 'weekly-two', category: 'múltiplas ações', input: 'Agende Trabalho toda segunda e quarta das 8h às 14h.', kinds: ['plan_pending'], planCount: 2, repeat: 'weekly' },
  { id: 'preference', category: 'memória', input: 'Qual minha preferência de estudo?', kinds: ['answer'], source: 'preferencias.md', contains: '35' },
  { id: 'remove-question', category: 'remoção semanal', input: 'Pode remover todos os compromissos da semana?', kinds: ['plan_pending'], planCount: 0 },
  { id: 'remove-polite', category: 'remoção semanal', input: 'Você pode apagar todos os meus eventos desta semana?', kinds: ['plan_pending'], planCount: 0 },
  { id: 'remove-next', category: 'remoção semanal', input: 'Por favor, exclua todos os compromissos da próxima semana.', kinds: ['plan_pending'], planCount: 0 },
  { id: 'remove-negative', category: 'remoção semanal', input: 'Não remova todos os compromissos da semana.', kinds: ['ask'] },
  { id: 'remove-conditional', category: 'remoção semanal', input: 'Pode remover todos os compromissos da semana se chover?', kinds: ['ask'] },
  { id: 'routine-abbreviated', category: 'rotina semanal', input: 'Organize o meu trabalho. Deixe o horário fixo para todas as semanas. Seg e qua 8 as 14. ter, qui, sex 8 as 16:30', kinds: ['plan_pending'], planCount: 5, repeat: 'weekly' },
  { id: 'routine-dotted', category: 'rotina semanal', input: 'Organize meu trabalho. Mantenha os horários fixos para toda semana. Seg. e qua. 8-14; ter., qui., sex. 8-16:30.', kinds: ['plan_pending'], planCount: 5, repeat: 'weekly' },
];
// Conjunto adicional separado dos exemplos do prompt e do corpus usado nos ajustes.
export const languageHoldout: LanguageCase[] = [
  event('holdout-physio', 'Por favor, reserve fisioterapia para sábado de 07:30 às 08:15', 'Fisioterapia', '2026-10-31', '07:30', '08:15', ['suggestion_pending']),
  event('holdout-drawing', 'Anota uma sessão de desenho domingo das 10h às 11h', 'Sessão de desenho', '2026-11-01', '10:00', '11:00', ['suggestion_pending']),
  event('holdout-resume', 'Você consegue registrar revisão de currículo em 31/10/2026 das 13h às 14h', 'Revisão de currículo', '2026-10-31', '13:00', '14:00', ['suggestion_pending']),
];
