import fsp from 'node:fs/promises';
import { ASSETS_DIR, BACKUPS_DIR, DATA_DIR, HOST, PORT } from './config.js';
import { initializeDatabase } from './database.js';
import { startHeartbeat } from './heartbeat.js';
import { server } from './http-server.js';
import { runInitialAssetMaintenance, startMaintenance } from './maintenance.js';
import { pruneOperationHistory } from './recovery.js';
import { shutdown } from './shutdown.js';
import { initializeStaticAssets } from './static-assets.js';

process.on('SIGINT', () => shutdown('SIGINT'));

process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  shutdown('uncaughtException', 1);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  shutdown('unhandledRejection', 1);
});

async function main() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(ASSETS_DIR, { recursive: true });
  await fsp.mkdir(BACKUPS_DIR, { recursive: true });
  await initializeStaticAssets();
  initializeDatabase();
  pruneOperationHistory();
  startHeartbeat();
  startMaintenance();
  server.listen(PORT, HOST, () => {
    const address = server.address();
    const port = address && typeof address === 'object' ? address.port : PORT;
    console.log(`Realtime whiteboard running at http://${HOST}:${port}`);
    void runInitialAssetMaintenance();
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export { main };
