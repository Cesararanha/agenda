import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Conteúdo inteiramente inventado, sem dependência de qualquer vault pessoal.
export async function prepareDemoContext(directory) {
  const canonical = await fs.realpath(directory);
  if (path.dirname(canonical) !== await fs.realpath(os.tmpdir()) || !path.basename(canonical).startsWith('agenda-agent-sandbox-')) {
    throw new Error('Os dados fictícios só podem ser preparados no diretório temporário da demonstração.');
  }
  const context = path.join(canonical, 'context');
  await fs.mkdir(context);
  await fs.mkdir(path.join(context, 'tasks'));
  const files = {
    'AGENTS.md': 'Demonstração fictícia. Preferências em preferencias.md. Tarefas em tasks/todo.md.',
    'preferencias.md': 'Preferência da pessoa fictícia: blocos de estudo de 35 minutos. Janela de estudo: 14:00-18:00.',
    'tasks/AGENTS.md': 'Fonte única de tarefas desta demonstração: todo.md. Não alterar o arquivo durante consultas.',
    'tasks/todo.md': '# Tarefas fictícias\n- [ ] Preparar uma maquete de papel\n- [ ] Ler um capítulo de astronomia\n- [x] Comprar cartolina\n',
  };
  for (const [relative, content] of Object.entries(files)) await fs.writeFile(path.join(context, relative), content, { flag: 'wx' });
}

export async function validateDemoDirectory(directory) {
  const canonical = await fs.realpath(directory);
  if (path.dirname(canonical) !== await fs.realpath(os.tmpdir()) || !path.basename(canonical).startsWith('agenda-agent-sandbox-')) throw new Error('Diretório de demonstração inválido');
  return canonical;
}
export async function copyDemoContext(source, destination) {
  source = await validateDemoDirectory(source);
  destination = await validateDemoDirectory(destination);
  await fs.mkdir(path.join(destination, 'context/tasks'), { recursive: true });
  for (const relative of ['context/AGENTS.md', 'context/preferencias.md', 'context/tasks/AGENTS.md', 'context/tasks/todo.md']) {
    let current = source;
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Atalhos não são permitidos no contexto de demonstração');
    }
    const info = await fs.stat(current);
    if (!info.isFile() || info.size > 32768) throw new Error('Fonte fictícia inválida');
    await fs.copyFile(current, path.join(destination, relative));
  }
}
export async function restoreDemoSnapshot(source, destination) {
  source = await validateDemoDirectory(source);
  destination = await validateDemoDirectory(destination);
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'demo-snapshot.json'), 'utf8'));
  if (manifest.type !== 'agente-demo-snapshot-v1' || !/^\d{4}-\d{2}-\d{2}$/.test(manifest.day)) throw new Error('Snapshot de demonstração inválido');
  const database = path.join(source, 'demo.db');
  const stat = await fs.lstat(database);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Banco de demonstração inválido');
  await fs.copyFile(database, path.join(destination, 'demo.db'));
  await copyDemoContext(source, destination);
  return manifest.day;
}
