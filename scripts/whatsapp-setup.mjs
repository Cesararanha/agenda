/**
 * Preenche o .env do WhatsApp sem voce abrir o arquivo.
 * Os valores secretos nao aparecem na tela nem ficam no historico do shell.
 *   npm run whatsapp:setup
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

/** Pergunta escondendo o que e digitado (pra token e segredo). */
function pergunta(texto, { secreto = false, padrao = '' } = {}) {
  return new Promise((resolve) => {
    const dica = padrao ? ` [enter = ${secreto ? 'gerar' : padrao}]` : '';
    rl.question(`${texto}${dica}: `, (resposta) => {
      if (secreto) process.stdout.write('\n');
      resolve(resposta.trim() || padrao);
    });
    if (secreto) {
      const onData = (char) => {
        if (['\n', '\r', '\u0004'].includes(char.toString())) {
          process.stdin.removeListener('data', onData);
          return;
        }
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(`${texto}${dica}: ${'*'.repeat(rl.line.length)}`);
      };
      process.stdin.on('data', onData);
    }
  });
}

/** O que ja esta no .env, pra nao sobrescrever sem querer. */
const atual = Object.fromEntries(
  fs
    .readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

console.log('\nConfiguracao do WhatsApp. Deixe em branco pra manter o que ja esta no .env.\n');

// Enter aqui NAO pode gerar um verify token novo quando ja existe um: o webhook
// cadastrado na Meta usa o antigo e pararia de validar.
const verifyAtual = atual.WHATSAPP_VERIFY_TOKEN || '';
const verify = verifyAtual
  ? await pergunta(`1. Verify token (ja cadastrado, enter mantem ${verifyAtual.slice(0, 6)}...)`, {
      padrao: verifyAtual,
    })
  : await pergunta('1. Verify token (voce inventa)', { padrao: randomBytes(16).toString('hex') });
const accessToken = await pergunta('2. Access token (Meta > WhatsApp > API Setup)', { secreto: true });
const appSecret = await pergunta(
  '3. App Secret (Configuracoes do app > Basico, 32 caracteres)',
  { secreto: true },
);
const phoneId = await pergunta('4. Phone number ID (API Setup)');
const from = await pergunta('5. Seu numero, so digitos com pais (ex 5582988887777)');

rl.close();

// O App Secret e hexadecimal de 32 caracteres. Colar o access token aqui e o erro
// mais facil de cometer, e o sintoma (403 em todo webhook) nao aponta pra causa.
if (appSecret && !/^[0-9a-f]{32}$/i.test(appSecret)) {
  console.log('\nERRO: isso nao parece um App Secret.');
  console.log(`  Recebi ${appSecret.length} caracteres; o App Secret tem 32, so numeros e letras de a a f.`);
  console.log('  Ele fica em Configuracoes do app > Basico > Chave Secreta do App > Mostrar.');
  console.log('  Nada foi gravado. Rode de novo quando tiver o valor certo.\n');
  process.exit(1);
}

const valores = {
  WHATSAPP_VERIFY_TOKEN: verify,
  WHATSAPP_ACCESS_TOKEN: accessToken,
  WHATSAPP_APP_SECRET: appSecret,
  WHATSAPP_PHONE_NUMBER_ID: phoneId,
  WHATSAPP_ALLOWED_FROM: from.replace(/\D/g, ''),
};

const linhas = fs.readFileSync(envPath, 'utf8').split('\n');
for (const [chave, valor] of Object.entries(valores)) {
  if (!valor) continue; // em branco mantem o que ja existe
  const i = linhas.findIndex((l) => l.startsWith(`${chave}=`));
  if (i >= 0) linhas[i] = `${chave}=${valor}`;
  else linhas.push(`${chave}=${valor}`);
}
fs.writeFileSync(envPath, linhas.join('\n'), { mode: 0o600 });

console.log('\n.env atualizado.\n');
console.log('Agora reinicie o servidor pra ele ler os valores novos:');
console.log('  pkill -f "tsx src/server/index.ts"');
console.log('  npm start &\n');
console.log('E confira com:  npm run whatsapp <url-do-tunel>\n');
