/**
 * `npm run dev` sobe a API e o Vite juntos, e derruba os dois com um Ctrl+C.
 */
import { spawn } from 'node:child_process';

const children = [];

function run(name, args) {
  const child = spawn('npx', args, { stdio: 'inherit', shell: false });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`\n[dev] ${name} saiu com codigo ${code}`);
      shutdown(code);
    }
  });
  children.push(child);
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('api', ['tsx', 'watch', 'src/server/index.ts']);
run('web', ['vite']);

console.log('\n[dev] API em http://localhost:8787  ·  PWA em http://localhost:5173\n');
