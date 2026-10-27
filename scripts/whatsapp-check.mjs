/**
 * Confere a configuracao do WhatsApp e diz exatamente o que falta.
 *   npm run whatsapp              -> so confere o .env e testa as credenciais
 *   npm run whatsapp <url-tunel>  -> tambem monta a URL do webhook pra colar na Meta
 */
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

const campos = [
  ['WHATSAPP_VERIFY_TOKEN', 'uma senha que voce inventa; a Meta devolve ela na verificacao'],
  ['WHATSAPP_ACCESS_TOKEN', 'token de acesso do app (Meta > WhatsApp > API Setup)'],
  ['WHATSAPP_APP_SECRET', 'Meta > Configuracoes do app > Basico > Chave secreta'],
  ['WHATSAPP_PHONE_NUMBER_ID', 'Meta > WhatsApp > API Setup > Phone number ID'],
  ['WHATSAPP_ALLOWED_FROM', 'seu numero, so digitos, com pais: 5582...'],
];

let faltando = 0;
console.log('\n.env:\n');
for (const [chave, dica] of campos) {
  const ok = Boolean(env[chave]);
  if (!ok) faltando++;
  console.log(`  ${ok ? 'ok  ' : 'FALTA'}  ${chave}${ok ? '' : `  <- ${dica}`}`);
}

if (faltando) {
  console.log(`\n${faltando} campo(s) faltando. Preencha o .env e rode de novo.\n`);
  process.exit(1);
}

console.log('\nTestando as credenciais na Meta...');
const url = `https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_NUMBER_ID}?fields=display_phone_number,verified_name`;
const resposta = await fetch(url, {
  headers: { authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
});
const corpo = await resposta.json();

if (!resposta.ok) {
  console.log(`\nA Meta recusou: ${corpo?.error?.message ?? resposta.status}`);
  console.log('Confira o ACCESS_TOKEN e o PHONE_NUMBER_ID.\n');
  process.exit(1);
}

console.log(`  numero: ${corpo.display_phone_number} (${corpo.verified_name})`);

const tunel = process.argv[2];
console.log('\nNa Meta, em WhatsApp > Configuration > Webhook, cadastre:\n');
console.log(`  Callback URL:  ${tunel ? tunel.replace(/\/$/, '') : 'https://SEU-TUNEL'}/api/whatsapp/webhook`);
console.log(`  Verify token:  ${env.WHATSAPP_VERIFY_TOKEN}`);
console.log('  Campo a assinar: messages\n');
console.log('Depois mande "ajuda" pro numero.\n');
