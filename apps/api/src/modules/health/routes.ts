import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    data: { status: 'ok', uptime: Math.round(process.uptime()), time: new Date().toISOString() },
  }));
}
