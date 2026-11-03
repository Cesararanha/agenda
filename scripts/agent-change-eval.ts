import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { prepareDemoContext } from './agent-demo-fixtures.mjs';
import { Ollama, pilotConfig } from '../src/agent/pilot/ollama.js';
import type { DemoReply } from '../src/shared/agent.js';
interface Seed {
    title: string;
    start: string;
    end: string;
    rrule?: string;
    allDay?: boolean;
}
interface Case {
    id: string;
    input: string;
    seeds?: Seed[];
    first?: DemoReply['kind'];
    followups?: string[];
    kind: DemoReply['kind'];
    after?: [
        string,
        string
    ];
    targetStart?: string;
}
const reading: Seed = { title: 'Leitura', start: '2030-05-15T10:00', end: '2030-05-15T11:00' };
const duplicate: Seed = { ...reading, start: '2030-05-15T15:00', end: '2030-05-15T16:00' };
const cases: Case[] = [
    { id: 'move-hour', input: 'Pode mudar a leitura de amanhã para as 19h?', kind: 'change_pending', after: ['2030-05-15T19:00', '2030-05-15T20:00'] },
    { id: 'revise-preview', input: 'Pode mudar a leitura de amanhã para as 19h?', first:'change_pending', followups:['Mude para 20h'],kind: 'change_pending', after: ['2030-05-15T20:00', '2030-05-15T21:00'] },
    { id: 'move-day', input: 'Passe a leitura de amanhã para sexta-feira.', kind: 'change_pending', after: ['2030-05-17T10:00', '2030-05-17T11:00'] },
    { id: 'cancel-polite', input: 'Desmarca a leitura de amanhã, por favor.', kind: 'change_pending' },
    { id: 'cancel-explanation', input: 'Não vou poder fazer a leitura amanhã. Pode cancelar esse compromisso?', kind: 'change_pending' },
    { id: 'choose-duplicate', input: 'Cancele leitura amanhã', seeds: [reading, duplicate], first: 'ask', followups: ['Escolho a opção 2'], kind: 'change_pending', targetStart: '2030-05-15T15:00' },
    { id: 'old-time-filter', input: 'Pode cancelar a leitura de amanhã das 15h às 16h?', seeds: [reading, duplicate], kind: 'change_pending', targetStart: '2030-05-15T15:00' },
    { id: 'complete-date', input: 'Quero cancelar minha leitura.', first: 'ask', followups: ['amanhã'], kind: 'change_pending' },
    { id: 'complete-title', input: 'Cancele o compromisso de amanhã.', first:'ask',followups:['O título é Leitura'],kind:'change_pending'},
    { id: 'complete-new-time', input: 'Preciso remarcar a leitura de amanhã.', first: 'ask', followups: ['das 18h às 19h'], kind: 'change_pending', after: ['2030-05-15T18:00', '2030-05-15T19:00'] },
    { id: 'accented-title', input: 'Mude a revisão de amanhã para das 14h às 15h.', seeds: [{ ...reading, title: 'Revisão' }], kind: 'change_pending', after: ['2030-05-15T14:00', '2030-05-15T15:00'] },
    { id: 'recurring-one', input: 'Cancele a leitura de amanhã.', seeds: [{ ...reading, rrule: 'FREQ=WEEKLY;COUNT=3' }], kind: 'change_pending' },
    { id: 'all-day', input: 'Pode cancelar a viagem de amanhã?', seeds: [{ title: 'Viagem', start: '2030-05-15', end: '2030-05-16', allDay: true }], kind: 'change_pending' },
    { id: 'multiple-actions', input: 'Cancele leitura amanhã e agende corrida sexta das 7h às 8h.', kind: 'ask' },
    { id: 'not-found', input: 'Cancele a natação amanhã.', kind: 'ask' },
    { id: 'conflict', input: 'Pode mudar a leitura de amanhã para as 19h?', seeds: [reading, { ...reading, title: 'Ocupado', start: '2030-05-15T19:00', end: '2030-05-15T20:00' }], kind: 'conflict' },
    { id: 'conditional', input: 'Se puder, passe a leitura de amanhã para as 19h.', kind: 'ask' },
    { id: 'negative', input: 'Não cancele a leitura de amanhã.', kind: 'ask' },
];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agenda-agent-sandbox-'));
const reservation = net.createServer();
await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = (reservation.address() as net.AddressInfo).port;
await new Promise<void>(resolve => reservation.close(() => resolve()));
const base = `http://127.0.0.1:${port}`, client = new Ollama(pilotConfig());
let child: ReturnType<typeof spawn> | undefined;
const results: Array<{
    id: string;
    passed: boolean;
    failures: string[];
    turns: Array<{
        input: string;
        reply: DemoReply;
    }>;
}> = [];
async function call(url: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') { const response = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(180000) }); const data = await response.json(); if (!response.ok)
    throw Error(`API ${response.status}: ${JSON.stringify(data)}`); return data; }
const events = async () => ((await call('/api/events?from=2030-05-14&to=2030-05-31')).events as Array<Seed & {
    id: string;
    seriesId: string;
}>).sort((a, b) => a.id.localeCompare(b.id));
try {
    await client.check();
    await prepareDemoContext(temp);
    child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AGENDA_DB: path.join(temp, 'eval.db'), AGENDA_HOST: '127.0.0.1', AGENDA_PORT: String(port), AGENDA_AGENT_SANDBOX: '1', AGENDA_AGENT_DEMO_NOW: '2030-05-14T08:00', AGENDA_VAULTS: '', AGENDA_ALLOW_LOCAL: '1', AGENDA_LOG_LEVEL: 'silent', WHATSAPP_ACCESS_TOKEN: '', WHATSAPP_APP_SECRET: '' } });
    let output = '';
    child.stderr!.on('data', chunk => output += chunk);
    child.stdout!.on('data', chunk => output += chunk);
    let ready = false;
    for (let i = 0; i < 100; i++) {
        if (child.exitCode !== null)
            throw Error(output);
        try {
            if ((await fetch(base + '/api/health')).ok) {
                ready = true;
                break;
            }
        }
        catch { }
        await setTimeout(50);
    }
    assert.ok(ready, 'API não iniciou');
    const meta = await call('/api/meta');
    assert.equal(meta.agentSandbox, true);
    assert.deepEqual(meta.vaults, []);
    const selectedId = process.argv.find(value => value.startsWith('--case='))?.slice('--case='.length);
    const selectedCases = selectedId ? cases.filter(entry => entry.id === selectedId) : cases;
    assert.ok(selectedCases.length, 'Caso de avaliação não encontrado');
    for (const entry of selectedCases) {
        for (const id of new Set((await events()).map(event => event.seriesId)))
            await call(`/api/events/${id}`, undefined, 'DELETE');
        for (const seed of entry.seeds ?? [reading])
            await call('/api/events', seed);
        const before = await events(), turns: Array<{
            input: string;
            reply: DemoReply;
        }> = [], failures: string[] = [];
        const chat = async (input: string) => { const reply = await call('/api/agent/sandbox/chat', { conversationId: entry.id, requestId: `turn-${turns.length}`, input }) as DemoReply; turns.push({ input, reply }); return reply; };
        try {
            let reply = await chat(entry.input);
            if (entry.first)
                assert.equal(reply.kind, entry.first);
            for (const input of entry.followups ?? [])
                reply = await chat(input);
            assert.equal(reply.kind, entry.kind);
            assert.deepEqual(await events(), before, 'a preparação não pode alterar eventos');
            if (entry.kind === 'change_pending') {
                assert.ok(reply.change);
                const change = reply.change;
                if (entry.after)
                    assert.deepEqual([change.after?.start, change.after?.end], entry.after);
                else
                    assert.equal(change.action, 'delete');
                if (entry.targetStart)
                    assert.equal(change.target.start, entry.targetStart);
                assert.equal((await chat('Pode confirmar')).kind, 'change_applied');
                const after = await events();
                if (change.action === 'move') {
                    const edited = after.find(event => event.seriesId === change.target.seriesId && event.start === change.after!.start);
                    assert.ok(edited);
                    assert.equal(edited.end, change.after!.end);
                    assert.equal(edited.title, change.target.title);
                    assert.equal(after.length, before.length);
                }
                else {
                    assert.ok(!after.some(event => event.id === change.target.id));
                    assert.equal(after.length, before.length - (change.target.recurring ? 1 : before.filter(event => event.seriesId === change.target.seriesId).length));
                }
                const queriedDay = change.after?.start.slice(0, 10) ?? change.target.start.slice(0, 10);
                const read = await chat(`Quais compromissos em ${queriedDay}?`);
                assert.equal(read.kind, 'answer');
                assert.ok(read.evidenceIds.includes('agenda'));
                if (change.after)
                    assert.ok(read.message.includes(change.after.start.slice(11)));
                assert.equal((await chat('Desfaça a alteração')).kind, 'change_undone');
                assert.deepEqual(await events(), before, 'desfazer precisa restaurar exatamente os eventos e exceções');
            }
        }
        catch (error) {
            failures.push(String(error));
        }
        results.push({ id: entry.id, passed: !failures.length, failures, turns });
    }
    const directory = path.join(root, 'data/pilot/changes');
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, `${Date.now()}-qwen.json`);
    const passed = results.filter(entry => entry.passed).length;
    await fs.writeFile(file, JSON.stringify({ mode: 'Qwen real, API e SQLite temporários, contexto fictício', passed, total: results.length, results }, null, 2));
    console.log(JSON.stringify({ passed, total: results.length, report: file, failures: results.filter(entry => !entry.passed).map(({ id, failures }) => ({ id, failures })) }, null, 2));
    if (passed !== results.length)
        process.exitCode = 1;
}
finally {
    if (child && child.exitCode === null) {
        const exited = new Promise(resolve => child!.once('exit', resolve));
        child.kill('SIGTERM');
        await Promise.race([exited, setTimeout(2000)]);
        if (child.exitCode === null) {
            child.kill('SIGKILL');
            await exited;
        }
    }
    await fs.rm(temp, { recursive: true, force: true });
}
