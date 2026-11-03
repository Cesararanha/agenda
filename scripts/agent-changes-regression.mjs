import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { prepareDemoContext } from './agent-demo-fixtures.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agenda-agent-sandbox-')), dbPath = path.join(temp, 'changes.db');
const extract = (action, titleSpan = 'Leitura', extra = {}) => ({ action, titleSpan, dateSpan: 'amanhã', targetTimeSpan: null, newDateSpan: null, newTimeSpan: null, unsupported: [], ...extra });
const outputs = new Map([
    ['Mude Leitura amanhã para as 19h', extract('move', 'Leitura', { newTimeSpan: 'as 19h' })],
    ['Passe Leitura de amanhã para sexta', extract('move', 'Leitura', { newDateSpan: 'sexta' })],
    ['Cancele Leitura amanhã', extract('delete')],
    ['Cancele Leitura', extract('delete', 'Leitura', { dateSpan: null })],
    ['Mude Leitura amanhã', extract('move')],
    ['Cancele Viagem amanhã', extract('delete', 'Viagem')],
    ['Cancele Leitura amanhã com execução extra', { ...extract('delete'), execute: true }],
]);
let unavailable = false, modelCalls = 0;
const model = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/version')
        return response.end(JSON.stringify({ version: 'ficticio' }));
    if (request.url === '/api/tags')
        return response.end(JSON.stringify({ models: [{ name: 'qwen3:4b', digest: 'ficticio', size: 1 }] }));
    if (request.url === '/api/show') {
        request.resume();
        return response.end(JSON.stringify({ details: {} }));
    }
    const chunks = [];
    for await (const chunk of request)
        chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()), payload = JSON.parse(body.messages[1].content), input = payload.messages?.at(-1) ?? payload.request;
    modelCalls++;
    if (unavailable) {
        response.statusCode = 503;
        return response.end('{}');
    }
    const output = body.format?.properties?.intent ? { intent: input.includes('falta fazer') ? 'tasks_read' : 'continue' } : outputs.get(input);
    if (!output) {
        response.statusCode = 500;
        return response.end('{}');
    }
    response.end(JSON.stringify({ done: true, done_reason: 'stop', message: { content: JSON.stringify(output) }, prompt_eval_count: 10, eval_count: 5 }));
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const reserve = net.createServer();
await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
const base = `http://127.0.0.1:${port}`, env = { ...process.env, AGENDA_DB: dbPath, AGENDA_HOST: '127.0.0.1', AGENDA_PORT: String(port), AGENDA_AGENT_SANDBOX: '1', AGENDA_AGENT_DEMO_NOW: '2030-05-14T08:00', AGENDA_VAULTS: '', AGENDA_ALLOW_LOCAL: '1', AGENDA_LOG_LEVEL: 'silent', WHATSAPP_ACCESS_TOKEN: '', WHATSAPP_APP_SECRET: '', AGENT_OLLAMA_URL: `http://127.0.0.1:${model.address().port}`, AGENT_MODEL: 'qwen3:4b' };
let child, exited, inspection;
async function start() { child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] }); let output = ''; child.stderr.on('data', chunk => output += chunk); child.stdout.on('data', chunk => output += chunk); exited = new Promise(resolve => child.once('exit', resolve)); for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null)
        throw Error(output);
    try {
        if ((await fetch(base + '/api/health')).ok)
            return;
    }
    catch { }
    await setTimeout(50);
} throw Error('API não iniciou'); }
async function stop() { if (!child || child.exitCode !== null)
    return; child.kill('SIGTERM'); await Promise.race([exited, setTimeout(2000)]); if (child.exitCode === null) {
    child.kill('SIGKILL');
    await exited;
} }
async function call(url, body, method = body === undefined ? 'GET' : 'POST') { const response = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) }); return { status: response.status, body: await response.json() }; }
const chat = async (conversationId, requestId, input) => (await call('/api/agent/sandbox/chat', { conversationId, requestId, input })).body;
const events = async (from = '2030-05-15', to = from) => (await call(`/api/events?from=${from}&to=${to}`)).body.events;
const seed = async (extra = {}) => (await call('/api/events', { title: 'Leitura', start: '2030-05-15T10:00', end: '2030-05-15T11:00', ...extra })).body;
async function clear() { for (const row of inspection.prepare('SELECT id FROM events').all())
    await call(`/api/events/${row.id}`, undefined, 'DELETE'); }
try {
    await prepareDemoContext(temp);
    await start();
    inspection = new DatabaseSync(dbPath);
    const original = await seed();
    const proposal = await chat('move', 'prepare', 'Mude Leitura amanhã para as 19h');
    assert.equal(proposal.kind, 'change_pending');
    assert.equal((await events())[0].start, '2030-05-15T10:00');
    await chat('move', 'tasks', 'Me passa a lista do que falta fazer');
    await stop();
    await start();
    const confirmations = await Promise.all([chat('move', 'confirm', 'Pode confirmar'), chat('move', 'confirm', 'Pode confirmar')]);
    assert.ok(confirmations.every(reply => reply.kind === 'change_applied'));
    assert.equal((await events()).length, 1);
    assert.equal((await events())[0].seriesId, original.seriesId);
    assert.equal((await events())[0].start, '2030-05-15T19:00');
    assert.equal((await chat('move', 'again', 'Pode confirmar')).kind, 'already_applied');
    assert.equal((await chat('move', 'read', 'Quais compromissos amanhã?')).kind, 'answer');
    assert.equal((await chat('move', 'undo', 'Desfaça a alteração')).kind, 'change_undone');
    assert.equal((await events())[0].start, '2030-05-15T10:00');
    const beforeCancel = await events();
    const cancelProposal = await chat('cancel-preview', 'prepare', 'Cancele Leitura amanhã');
    assert.equal(cancelProposal.kind, 'change_pending');
    assert.equal((await chat('cancel-preview', 'no', 'Não')).kind, 'change_canceled');
    assert.equal((await chat('cancel-preview', 'yes', 'Pode confirmar')).kind, 'ask');
    assert.deepEqual(await events(), beforeCancel);
    const missing = await chat('missing', 'prepare', 'Cancele Leitura');
    assert.equal(missing.changeDraft.missing, 'date');
    assert.equal((await chat('missing', 'date', 'amanhã')).kind, 'change_pending');
    assert.equal((await chat('missing', 'confirm', 'Pode cancelar')).kind, 'change_applied');
    assert.equal((await events()).length, 0);
    await stop();
    await start();
    assert.equal((await chat('missing', 'undo', 'Desfaça a alteração')).kind, 'change_undone');
    assert.deepEqual(await events(), beforeCancel);
    await seed({ start: '2030-05-15T15:00', end: '2030-05-15T16:00' });
    const ambiguous = await chat('ambiguous', 'prepare', 'Cancele Leitura amanhã');
    assert.equal(ambiguous.kind, 'ask');
    assert.equal(ambiguous.changeDraft.candidates.length, 2);
    await chat('ambiguous', 'tasks', 'Me passa a lista do que falta fazer');
    await stop();
    await start();
    const chosen = await chat('ambiguous', 'choose', 'Escolho a opção 2');
    assert.equal(chosen.change.target.start, '2030-05-15T15:00');
    assert.equal((await chat('ambiguous', 'confirm', 'Pode confirmar')).kind, 'change_applied');
    assert.deepEqual((await events()).map(item => item.start), ['2030-05-15T10:00']);
    assert.equal((await chat('ambiguous', 'undo', 'Desfaça a alteração')).kind, 'change_undone');
    assert.equal((await events()).length, 2);
    await clear();
    await seed();
    await seed({ title: 'Ocupado', start: '2030-05-15T19:00', end: '2030-05-15T20:00' });
    assert.equal((await chat('conflict', 'prepare', 'Mude Leitura amanhã para as 19h')).kind, 'conflict');
    assert.equal((await chat('conflict', 'retry', 'das 20h às 21h')).kind, 'change_pending');
    await clear();
    const staleOriginal = await seed();
    const stale = await chat('stale', 'prepare', 'Cancele Leitura amanhã');
    assert.equal(stale.kind, 'change_pending');
    await call(`/api/events/${staleOriginal.seriesId}`, { start: '2030-05-15T11:00', end: '2030-05-15T12:00' }, 'PATCH');
    assert.equal((await chat('stale', 'confirm', 'Pode confirmar')).kind, 'stale_suggestion');
    assert.equal((await events()).length, 1);
    await clear();
    await seed();
    const beforeRejected = await events(), callsBeforeGuards = modelCalls;
    for (const [index, input] of ['Não cancele Leitura amanhã', 'Se der, mude Leitura amanhã para as 19h', 'Cancele todas as ocorrências de Leitura', 'Cancele Leitura amanhã e registre Corrida'].entries())
        assert.equal((await chat('guard', String(index), input)).kind, 'ask');
    assert.equal(modelCalls, callsBeforeGuards);
    assert.deepEqual(await events(), beforeRejected);
    assert.equal((await chat('extra', 'prepare', 'Cancele Leitura amanhã com execução extra')).kind, 'ask');
    assert.deepEqual(await events(), beforeRejected);
    unavailable = true;
    assert.equal((await chat('offline', 'prepare', 'Cancele Leitura amanhã')).kind, 'model_error');
    unavailable = false;
    assert.deepEqual(await events(), beforeRejected);
    const rollback = await chat('rollback', 'prepare', 'Cancele Leitura amanhã');
    assert.equal(rollback.kind, 'change_pending');
    inspection.exec("CREATE TRIGGER fail_change BEFORE DELETE ON events WHEN OLD.title = 'Leitura' BEGIN SELECT RAISE(ABORT,'falha fictícia'); END;");
    assert.equal((await chat('rollback', 'confirm', 'Pode confirmar')).kind, 'tool_error');
    assert.deepEqual(await events(), beforeRejected);
    assert.equal((await call('/api/agent/sandbox/panel')).body.changes.find(item => item.id === rollback.change.id).status, 'pending');
    inspection.exec('DROP TRIGGER fail_change');
    assert.equal((await chat('rollback', 'retry', 'Pode confirmar')).kind, 'change_applied');
    assert.equal((await chat('rollback', 'undo', 'Desfaça a alteração')).kind, 'change_undone');
    await clear();
    const recurring = await seed({ rrule: 'FREQ=WEEKLY;COUNT=3' });
    const recurringBefore = await events('2030-05-15', '2030-05-31');
    const oneOccurrence = await chat('recurring', 'prepare', 'Cancele Leitura amanhã');
    assert.equal(oneOccurrence.change.target.recurring, true);
    assert.equal((await chat('recurring', 'confirm', 'Pode confirmar')).kind, 'change_applied');
    assert.deepEqual((await events('2030-05-15', '2030-05-31')).map(item => item.start), ['2030-05-22T10:00', '2030-05-29T10:00']);
    assert.equal((await chat('recurring', 'undo', 'Desfaça a alteração')).kind, 'change_undone');
    assert.deepEqual(await events('2030-05-15', '2030-05-31'), recurringBefore);
    const moveOccurrence = await chat('recurring-move', 'prepare', 'Mude Leitura amanhã para as 19h');
    assert.equal(moveOccurrence.kind, 'change_pending');
    assert.equal((await chat('recurring-move', 'confirm', 'Pode confirmar')).kind, 'change_applied');
    assert.equal((await events())[0].seriesId, recurring.seriesId);
    assert.equal((await events())[0].start, '2030-05-15T19:00');
    assert.equal((await events('2030-05-22'))[0].start, '2030-05-22T10:00');
    await seed({ title: 'Mudança posterior', start: '2030-05-16T14:00', end: '2030-05-16T15:00' });
    assert.equal((await chat('recurring-move', 'undo', 'Desfaça a alteração')).kind, 'stale_suggestion');
    assert.equal((await events())[0].start, '2030-05-15T19:00');
    await clear();
    await seed({ title: 'Viagem', start: '2030-05-15', end: '2030-05-16', allDay: true });
    const wholeDay = await chat('all-day', 'prepare', 'Cancele Viagem amanhã');
    assert.equal(wholeDay.kind, 'change_pending');
    assert.ok(wholeDay.message.includes('16/05/2030'));
    assert.equal((await chat('all-day', 'confirm', 'Pode confirmar')).kind, 'change_applied');
    assert.equal((await events()).length, 0);
    assert.equal((await chat('all-day', 'undo', 'Desfaça a alteração')).kind, 'change_undone');
    assert.equal((await events())[0].allDay, true);
    const injected = await call('/api/agent/sandbox/chat', { conversationId: 'spoof', requestId: 'spoof', input: 'Pode confirmar', change: wholeDay.change });
    assert.equal(injected.status, 400);
    assert.equal((await chat('no-context', 'confirm', 'Pode confirmar')).kind, 'ask');
    await clear();
    await seed();
    const revisionOriginal=await chat('revision','first','Mude Leitura amanhã para as 19h');
    const revisionNew=await chat('revision','new','Mude para 20h');
    assert.equal(revisionNew.kind,'change_pending');
    assert.notEqual(revisionNew.change.id,revisionOriginal.change.id);
    assert.equal(revisionNew.change.after.start,'2030-05-15T20:00');
    assert.equal((await call('/api/agent/sandbox/panel')).body.changes.find(item=>item.id===revisionOriginal.change.id).status,'canceled');
    assert.equal((await chat('revision','old-confirm',`Confirmo a alteração ${revisionOriginal.change.id}`)).kind,'ask');
    assert.equal((await chat('revision','new-confirm',`Confirmo a alteração ${revisionNew.change.id}`)).kind,'change_applied');
    assert.equal((await events())[0].start,'2030-05-15T20:00');
    const appliedRevision=await chat('revision','again','Mude para 21h');
    assert.equal(appliedRevision.kind,'change_pending');
    assert.equal(appliedRevision.change.target.start,'2030-05-15T20:00');
    assert.equal((await chat('revision','again-confirm','Pode mudar')).kind,'change_applied');
    assert.equal((await events())[0].start,'2030-05-15T21:00');
    assert.equal((await chat('revision','again-undo','Desfaça a alteração')).kind,'change_undone');
    assert.equal((await events())[0].start,'2030-05-15T20:00');
    console.log('PASS alterações: mover/cancelar por título, revisão de prévia e de compromisso aplicado, confirmação, seleção, continuidade, reinício, idempotência, conflitos, versão, rollback, exceções recorrentes, dia inteiro e desfazer sem sobrescrever mudanças posteriores.');
}
finally {
    await stop();
    inspection?.close();
    model.closeAllConnections();
    await new Promise(resolve => model.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
}
