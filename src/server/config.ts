import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Node >= 20.6 carrega .env sozinho; sem arquivo, segue com os padroes.
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // sem .env: tudo bem, roda com os padroes
}

export interface VaultSource {
  label: string;
  path: string;
}

function parseVaults(raw: string | undefined): VaultSource[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((entry) => {
      const [label, ...rest] = entry.split('=');
      const dir = rest.join('=').trim();
      if (!label?.trim() || !dir) return null;
      return { label: label.trim(), path: dir.replace(/^~/, process.env.HOME ?? '~') };
    })
    .filter((v): v is VaultSource => v !== null && fs.existsSync(v.path));
}

const dbPath = process.env.AGENDA_DB?.trim() || path.join(ROOT, 'data', 'agenda.db');
const agentSandbox = process.env.AGENDA_AGENT_SANDBOX === '1';
if (agentSandbox) {
  // Esse adaptador ainda não pode ser ligado ao banco pessoal, mesmo por engano.
  const parent = fs.realpathSync(path.dirname(dbPath));
  const tempRoot = fs.realpathSync(os.tmpdir());
  if (!process.env.AGENDA_DB?.trim() || path.dirname(parent) !== tempRoot
    || !path.basename(parent).startsWith('agenda-agent-sandbox-')
    || fs.lstatSync(dbPath, { throwIfNoEntry: false })?.isSymbolicLink()
    || process.env.AGENDA_VAULTS?.trim() || process.env.WHATSAPP_ACCESS_TOKEN?.trim()
    || process.env.WHATSAPP_APP_SECRET?.trim()) {
    throw new Error('O agente sandbox exige banco em diretório temporário agenda-agent-sandbox-*, sem vaults ou WhatsApp.');
  }
}

export const config = {
  port: Number(process.env.AGENDA_PORT ?? 8787),
  host: process.env.AGENDA_HOST?.trim() || '0.0.0.0',
  tz: process.env.AGENDA_TZ?.trim() || 'America/Maceio',
  dbPath,
  dbDir: path.dirname(dbPath),
  webDir: path.join(ROOT, 'dist', 'web'),
  serveWeb: process.env.AGENDA_SERVE_WEB === '1' && fs.existsSync(path.join(ROOT, 'dist', 'web')),
  token: process.env.AGENDA_TOKEN?.trim() || '',
  allowLocal: process.env.AGENDA_ALLOW_LOCAL !== '0',
  agentSandbox,
  agentDemoNow: agentSandbox ? process.env.AGENDA_AGENT_DEMO_NOW?.trim() || '' : '',
  agentDemoId: agentSandbox ? process.env.AGENDA_AGENT_DEMO_ID?.trim() || '' : '',
  vaults: parseVaults(process.env.AGENDA_VAULTS),
  whatsapp: {
    enabled: Boolean(process.env.WHATSAPP_ACCESS_TOKEN?.trim()),
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN?.trim() || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN?.trim() || '',
    appSecret: process.env.WHATSAPP_APP_SECRET?.trim() || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || '',
    allowedFrom: (process.env.WHATSAPP_ALLOWED_FROM?.trim() || '').replace(/\D/g, ''),
  },
};

export type Config = typeof config;
