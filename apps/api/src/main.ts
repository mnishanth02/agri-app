import { env } from './env.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const app = await buildServer();
  try {
    const address = await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info(`viz-crop api listening at ${address}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
