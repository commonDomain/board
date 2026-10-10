import { boards, clients } from './board-registry.js';
import { SHUTDOWN_GRACE_MS } from './config.js';
import { server } from './http-server.js';
import { assetMaintenanceRuntime } from './runtime/asset-maintenance.js';
import { backupRuntime } from './runtime/backup.js';
import { maintenanceStateRuntime } from './runtime/maintenance-state.js';
import { resourcesRuntime } from './runtime/resources.js';
import { serverStateRuntime } from './runtime/server-state.js';
import { servicesRuntime } from './runtime/services.js';
import { webSocketServer } from './websocket-server.js';

async function shutdown(signal, exitCode = 0) {
  if (serverStateRuntime.isShuttingDown) return;
  serverStateRuntime.isShuttingDown = true;
  serverStateRuntime.isAccepting = false;
  console.log(`Received ${signal}; draining committed work...`);
  if (maintenanceStateRuntime.heartbeatTimer) clearInterval(maintenanceStateRuntime.heartbeatTimer);
  if (maintenanceStateRuntime.assetGcTimer) clearInterval(maintenanceStateRuntime.assetGcTimer);
  if (maintenanceStateRuntime.maintenanceTimer) clearInterval(maintenanceStateRuntime.maintenanceTimer);
  if (maintenanceStateRuntime.boardCacheTimer) clearInterval(maintenanceStateRuntime.boardCacheTimer);
  if (maintenanceStateRuntime.backupTimer) clearInterval(maintenanceStateRuntime.backupTimer);
  if (maintenanceStateRuntime.backupInitialTimer) clearTimeout(maintenanceStateRuntime.backupInitialTimer);
  if (maintenanceStateRuntime.accountCleanupTimer) clearInterval(maintenanceStateRuntime.accountCleanupTimer);
  if (maintenanceStateRuntime.resourceMonitorTimer) clearInterval(maintenanceStateRuntime.resourceMonitorTimer);
  server.close();

  const forcedExit = setTimeout(() => {
    console.error('Shutdown timed out; forcing exit.');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  forcedExit.unref();

  try {
    await Promise.all(Array.from(clients, (client) => client.inboundTail.catch(() => {})));
    await Promise.all(Array.from(boards.values(), (board) => board.tail.catch(() => {})));
    await Promise.all(
      [backupRuntime.backupInFlight, assetMaintenanceRuntime.assetGcInFlight, resourcesRuntime.resourceRefreshInFlight]
        .filter(Boolean)
        .map((task) => task.catch((error) => console.error('Background task failed while shutting down:', error)))
    );
    servicesRuntime.database
      .prepare(
        `
      INSERT INTO runtime_state (key, value, updated_at) VALUES ('clean_shutdown', '1', ?)
      ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = excluded.updated_at
    `
      )
      .run(Date.now());
    servicesRuntime.database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();
    for (const client of Array.from(clients)) {
      client.socket.close(1001, 'Server shutting down');
    }
    await new Promise((resolve) => webSocketServer.close(resolve));
    servicesRuntime.database.close();
    clearTimeout(forcedExit);
    console.log('All committed work drained. Goodbye.');
    process.exit(exitCode);
  } catch (error) {
    console.error('Failed during shutdown:', error);
    clearTimeout(forcedExit);
    process.exit(1);
  }
}

export { shutdown };
