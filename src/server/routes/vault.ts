import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { syncAllVaults, syncVault } from '../vault/importer.js';

export async function vaultRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/vaults', async () => ({
    vaults: config.vaults.map((v) => ({ label: v.label, path: v.path })),
    aviso:
      'Leitura apenas. O cofre do SENAI nao deve ser configurado aqui: ele entra numa instancia rodando na conta do SENAI.',
  }));

  app.post('/api/vaults/sync', async () => ({ reports: syncAllVaults() }));

  app.post<{ Params: { label: string } }>('/api/vaults/:label/sync', async (request, reply) => {
    const vault = config.vaults.find((v) => v.label === request.params.label);
    if (!vault) return reply.code(404).send({ error: `vault '${request.params.label}' nao configurado` });
    return syncVault(vault);
  });
}
