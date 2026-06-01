import { createApp } from './app.js';
import { config } from './config.js';

/**
 * Transport layer: start the HTTP server.
 *
 * This file is responsible for:
 * - Creating the Nest application instance from app.ts
 * - Listening on the configured port
 * - Handling process lifecycle (SIGTERM, SIGINT)
 */
async function main(): Promise<void> {
  const app = await createApp();

  try {
    await app.listen(config.PORT, config.HOST);
    console.log(`Server listening at ${await app.getUrl()}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

void main();
