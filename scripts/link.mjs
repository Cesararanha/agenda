/**
 * Imprime o endereco pra abrir a agenda no celular, com o token embutido.
 * O token fica no .env; este script so o le pra montar a URL.
 *   npm run link
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, '.env'), 'utf8')
    .split('\n')
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
);

const port = env.AGENDA_PORT || '8787';
const token = env.AGENDA_TOKEN || '';

const ips = Object.values(os.networkInterfaces())
  .flat()
  .filter((a) => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
  .map((a) => a.address);

if (!token) {
  console.log('\nAGENDA_TOKEN esta vazio no .env. Gere um antes de abrir no celular:');
  console.log('  openssl rand -hex 24\n');
  process.exit(1);
}

// se o tunel estiver no ar, pega a URL publica do log dele
let tunel = process.argv[2];
if (!tunel) {
  try {
    const log = fs.readFileSync('/tmp/cloudflared.log', 'utf8');
    tunel = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
  } catch {
    // sem tunel no ar, segue so com a rede local
  }
}

if (tunel) {
  console.log('\nDe qualquer rede (o tunel esta no ar):\n');
  console.log(`  ${tunel.replace(/\/$/, '')}/?token=${token}`);
}

console.log('\nNa mesma rede wi-fi:\n');
for (const ip of ips) console.log(`  http://${ip}:${port}/?token=${token}`);
if (!ips.length) console.log('  (nenhum endereco de rede encontrado: o Mac esta sem wi-fi?)');

console.log('\nO token fica salvo no aparelho e some da barra de endereco.');
console.log('Depois: Compartilhar > Adicionar a Tela de Inicio, e vira app.');
if (tunel) {
  console.log('\nAtencao: a URL do tunel muda toda vez que ele sobe, e o Mac precisa');
  console.log('estar ligado e com o tunel rodando pra ela funcionar.\n');
} else {
  console.log('\nPra usar fora de casa: npm run tunel (noutro terminal) e rode isto de novo.\n');
}
