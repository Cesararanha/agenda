/**
 * Testes de fumaca das regras de acesso. Roda contra o servidor que estiver no ar.
 *   npm run smoke                      -> testa http://127.0.0.1:8787
 *   npm run smoke https://seu-tunel    -> testa tambem pela URL publica
 *
 * O caso que importa: requisicao de loopback COM cabecalho de proxy tem que exigir
 * token. Foi assim que a agenda ficou aberta na internet quando o tunel subiu.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const base = (process.argv[2] ?? `http://127.0.0.1:${env.AGENDA_PORT || 8787}`).replace(/\/$/, '');
const token = env.AGENDA_TOKEN ?? '';
let falhas = 0;

async function checa(nome, esperado, caminho, init = {}) {
  let real;
  try {
    real = (await fetch(base + caminho, init)).status;
  } catch (error) {
    real = `erro: ${error.message}`;
  }
  const ok = real === esperado;
  if (!ok) falhas++;
  console.log(`  ${ok ? 'ok  ' : 'FALHA'}  ${nome}: esperado ${esperado}, veio ${real}`);
}

const publico = base.startsWith('https://');
console.log(`\nTestando ${base} (${publico ? 'pela internet' : 'local'})\n`);

await checa('health e publico', 200, '/api/health');
await checa('PWA abre sem token', 200, '/');
await checa('dados com token', 200, '/api/meta', { headers: { 'x-agenda-token': token } });
await checa('webhook sem assinatura', 403, '/api/whatsapp/webhook', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
});

if (publico) {
  // o que importa quando o tunel esta no ar
  await checa('sem token', 401, '/api/meta');
  await checa('token errado', 401, '/api/meta', { headers: { 'x-agenda-token': 'errado' } });
} else {
  // do proprio Mac a isencao local vale ANTES do token, e isso e o esperado
  await checa('token errado passa (isencao local)', 200, '/api/meta', {
    headers: { 'x-agenda-token': 'errado' },
  });
  // o bug que abriu a agenda na internet: loopback com cabecalho de proxy
  await checa('loopback com x-forwarded-for exige token', 401, '/api/meta', {
    headers: { 'x-forwarded-for': '203.0.113.9' },
  });
  await checa('loopback com cf-connecting-ip exige token', 401, '/api/meta', {
    headers: { 'cf-connecting-ip': '203.0.113.9' },
  });
}

console.log(`\n${falhas ? `${falhas} falha(s).` : 'tudo certo.'}\n`);
process.exit(falhas ? 1 : 0);
