import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChangeExtraction, parseChangeTime, manageEvent, type ChangeTarget, type ChangeSpec } from './event-change.js';
import { converse, type ConversationPorts } from './conversation.js';
const now = '2030-05-14T08:00';
const extraction = (overrides: Record<string, unknown> = {}) => ({ action: 'move', titleSpan: 'Leitura', dateSpan: 'amanhã', targetTimeSpan: null, newDateSpan: null, newTimeSpan: 'das 19h às 20h', unsupported: [], ...overrides });
const target = (id: string, start = '2030-05-15T10:00', end = '2030-05-15T11:00'): ChangeTarget => ({ id, seriesId: id, occurrenceDate: start.slice(0, 10), title: 'Leitura', start, end, allDay: false, recurring: false });
function fixture(rows = [target('um')], output: unknown = extraction()) {
    const prepared: ChangeSpec[] = [];
    let modelCalls = 0;
    const ports: ConversationPorts = { clock: () => now, state: () => ({ schemaVersion: 1, version: 0, events: [], suggestions: [], receipts: [] }),
        reader: { read: async () => ({ sources: [], openTasks: [], readSequence: [], usage: { filesRead: 0, charactersRead: 0, charactersReturned: 0 } }) }, model: async () => { throw Error('Não deve consultar memória'); },
        execute: () => { throw Error('Não deve executar'); }, propose: () => { throw Error('Não deve registrar'); },
        changeModel: async () => { modelCalls++; return output; }, changes: { list: (from, to) => rows.filter(row => row.start.slice(0, 10) >= from && row.start.slice(0, 10) <= to),
            prepare: (spec) => { prepared.push(spec); return { kind: 'change_pending', message: 'Prévia.', changed: false, evidenceIds: ['agenda'], change: { ...spec, id: 'alteracao-teste', status: 'pending' } }; },
            apply: () => ({ kind: 'change_applied', message: 'Confirmada.', changed: true, evidenceIds: ['agenda'] }), cancel: () => ({ kind: 'change_canceled', message: 'Cancelada.', changed: false, evidenceIds: ['agenda'] }), undo: () => ({ kind: 'change_undone', message: 'Desfeita.', changed: true, evidenceIds: ['agenda'] }) } };
    return { ports, prepared, calls: () => modelCalls };
}
test('extração de alteração só aceita trechos humanos, ação coerente e cobertura dos horários', () => {
    const input = 'Mude Leitura de amanhã das 10h às 11h para das 19h às 20h';
    const value = extraction({ targetTimeSpan: 'das 10h às 11h' });
    assert.ok(!('ask' in validateChangeExtraction(value, [input], now)));
    for (const raw of [extraction(), { ...value, targetId: 'injetado' }, extraction({ titleSpan: 'Título inexistente' }), extraction({ action: 'delete' }), extraction({ unsupported: ['pagar boleto'] })])
        assert.ok('ask' in validateChangeExtraction(raw, [input], now));
});
test('não prepara só a primeira parte de um cancelamento com dois títulos', () => {
    const input = 'Cancele Leitura amanhã e Corrida';
    assert.ok('ask' in validateChangeExtraction(extraction({ action: 'delete', newTimeSpan: null }), [input], now));
});
test('mudança de um evento existente prepara prévia sem executar e pode ser confirmada após consulta', async () => {
    const { ports, prepared } = fixture();
    const proposal = await converse({ requestId: 'mover', input: 'Mude Leitura amanhã para das 19h às 20h' }, ports);
    assert.equal(proposal.kind, 'change_pending');
    assert.equal(prepared[0]?.target.id, 'um');
    assert.equal(prepared[0]?.after?.start, '2030-05-15T19:00');
    const read = await converse({ requestId: 'ler', input: 'Quais tarefas estão abertas?' }, ports, proposal);
    assert.equal(read.change, undefined);
    assert.equal(read.continuation?.change?.id, 'alteracao-teste');
    assert.equal((await converse({ requestId: 'sim', input: 'Pode confirmar' }, ports, JSON.parse(JSON.stringify(read)))).kind, 'change_applied');
});
test('títulos duplicados exigem seleção e aceitam escolha explícita após consulta e serialização', async () => {
    const { ports, prepared } = fixture([target('primeiro'), target('segundo', '2030-05-15T15:00', '2030-05-15T16:00')], extraction({ action: 'delete', newTimeSpan: null }));
    const first = await converse({ requestId: 'ambigua', input: 'Cancele Leitura amanhã' }, ports);
    assert.equal(first.kind, 'ask');
    assert.equal(first.changeDraft?.candidates?.length, 2);
    assert.equal(prepared.length, 0);
    const read = await converse({ requestId: 'tarefas', input: 'Quais tarefas estão abertas?' }, ports, first);
    const chosen = await converse({ requestId: 'escolha', input: 'Escolho a opção 2' }, ports, JSON.parse(JSON.stringify(read)));
    assert.equal(chosen.kind, 'change_pending');
    assert.equal(prepared[0]?.target.id, 'segundo');
});
test('dia ausente mantém título e ação para receber só a data', async () => {
    const { ports, prepared, calls } = fixture([target('um')], extraction({ action: 'delete', dateSpan: null, newTimeSpan: null }));
    const first = await converse({ requestId: 'sem-dia', input: 'Cancele Leitura' }, ports);
    assert.equal(first.changeDraft?.missing, 'date');
    assert.equal(prepared.length, 0);
    const next = await converse({ requestId: 'dia', input: 'amanhã' }, ports, first);
    assert.equal(next.kind, 'change_pending');
    assert.equal(prepared[0]?.action, 'delete');
    assert.equal(calls(), 1);
});
test('hora inicial isolada e mudança só de dia preservam a duração existente', async () => {
    for (const [input, output, start, end] of [
        ['Mude Leitura amanhã para as 19h', extraction({ newTimeSpan: 'as 19h' }), '2030-05-15T19:00', '2030-05-15T20:30'],
        ['Passe Leitura de amanhã para sexta', extraction({ newTimeSpan: null, newDateSpan: 'sexta' }), '2030-05-17T10:00', '2030-05-17T11:30'],
    ] as const) {
        const { ports, prepared } = fixture([target('um', '2030-05-15T10:00', '2030-05-15T11:30')], output);
        await manageEvent({ requestId: 'mover', input }, ports);
        assert.equal(prepared[0]?.after?.start, start);
        assert.equal(prepared[0]?.after?.end, end);
    }
});
test('negação, condição e pedidos de série inteira não chegam ao modelo nem ao executor', async () => {
    const { ports, prepared, calls } = fixture();
    for (const input of ['Não cancele Leitura amanhã', 'Se der, mude Leitura amanhã para as 19h', 'Cancele todas as ocorrências de Leitura'])
        assert.equal((await manageEvent({ requestId: input, input }, ports)).kind, 'ask');
    assert.equal(calls(), 0);
    assert.equal(prepared.length, 0);
});
test('falha do modelo preserva o pedido, e cancelar o rascunho impede confirmação', async () => {
    const { ports } = fixture();
    ports.changeModel = async () => { throw Error('offline'); };
    const failed = await converse({ requestId: 'offline', input: 'Cancele Leitura amanhã' }, ports);
    assert.equal(failed.kind, 'model_error');
    assert.equal(failed.changeDraft?.messages.length, 1);
    const canceled = await converse({ requestId: 'nao', input: 'Não' }, ports, failed);
    assert.equal(canceled.changeDraft, undefined);
    assert.equal((await converse({ requestId: 'sim', input: 'Pode confirmar' }, ports, canceled)).kind, 'ask');
});
test('horários inválidos não são completados por valores padrão', () => {
    for (const raw of ['25h', 'das 18h às 17h', '19:80', '0h90'])
        assert.equal(parseChangeTime(raw), null);
    assert.deepEqual(parseChangeTime('às 08h30'), { start: '08:30' });
});
test('uma justificativa negativa não nega o pedido afirmativo de cancelamento em outra frase', async () => {
    const { ports, prepared } = fixture([target('um')], extraction({ action: 'delete', newTimeSpan: null }));
    const reply = await manageEvent({ requestId: 'justificativa', input: 'Não vou poder fazer a Leitura amanhã. Pode cancelar esse compromisso?' }, ports);
    assert.equal(reply.kind, 'change_pending');
    assert.equal(prepared[0]?.action, 'delete');
    const rejected = await manageEvent({ requestId: 'negacao', input: 'Não quero que você cancele Leitura amanhã' }, ports);
    assert.equal(rejected.kind, 'ask');
    assert.equal(prepared.length, 1);
});
test('revisar uma prévia identificada usa só o novo horário e cancela a prévia anterior', async () => {
    const {ports,prepared,calls}=fixture();
    const canceled:string[]=[];
    ports.changes!.cancel=(id)=>{canceled.push(id);return {kind:'change_canceled',message:'Cancelada.',changed:false,evidenceIds:['agenda']};};
    const first=await converse({requestId:'primeira',input:'Mude Leitura amanhã para das 19h às 20h'},ports);
    const revised=await converse({requestId:'revisao',input:'Mude para 20h'},ports,first);
    assert.equal(revised.kind,'change_pending');assert.equal(prepared[1]?.after?.start,'2030-05-15T20:00');
    assert.equal(calls(),1);assert.deepEqual(canceled,['alteracao-teste']);
});
test('título ausente pode ser completado explicitamente sem desviar consultas ou chamar novamente o modelo',async()=>{
    const {ports,prepared,calls}=fixture([target('um')],extraction({action:'delete',titleSpan:null,newTimeSpan:null}));
    const first=await converse({requestId:'sem-titulo',input:'Cancele o compromisso de amanhã'},ports);
    assert.equal(first.changeDraft?.missing,'title');
    const read=await converse({requestId:'consulta',input:'Quais tarefas estão abertas?'},ports,first);
    const next=await converse({requestId:'titulo',input:'O título é Leitura'},ports,read);
    assert.equal(next.kind,'change_pending');assert.equal(prepared[0]?.target.id,'um');assert.equal(calls(),1);
});
