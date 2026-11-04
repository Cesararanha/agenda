// Função da Vercel: entrega as requisições de /api ao mesmo Fastify usado no Mac.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { app } from '../src/server/app.js';

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  await app.ready();
  app.server.emit('request', request, response);
}
