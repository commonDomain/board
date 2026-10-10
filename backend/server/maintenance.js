import { collectOrphanedAssets } from './asset-maintenance.js';
import { backfillStoredImageAssets } from './asset-references.js';
import { createOnlineBackup } from './backup.js';
import { evictBoardCache } from './board-cache.js';
import {
  ACCOUNT_CLEANUP_INTERVAL_MS,
  ASSET_GC_ENABLED,
  ASSET_GC_INTERVAL_MS,
  AUTOMATIC_BACKUPS_ENABLED,
  BACKUP_INITIAL_DELAY_MS,
  BACKUP_INTERVAL_MS,
  BOARD_CACHE_SWEEP_MS,
  MAINTENANCE_INTERVAL_MS,
  OPERATION_MAINTENANCE_ENABLED,
  RESOURCE_MONITOR_INTERVAL_MS
} from './config.js';
import { pruneOperationHistory } from './recovery.js';
import { recoveryStatus } from './recovery-state.js';
import { refreshResourceStatus } from './resources.js';
import { assetMaintenanceRuntime } from './runtime/asset-maintenance.js';
import { maintenanceStateRuntime } from './runtime/maintenance-state.js';
import { servicesRuntime } from './runtime/services.js';
import { prunePlanningSnapshots } from './planning-schema.js';

function startMaintenance() {
  maintenanceStateRuntime.boardCacheTimer = setInterval(evictBoardCache, BOARD_CACHE_SWEEP_MS);
  maintenanceStateRuntime.boardCacheTimer.unref?.();
  maintenanceStateRuntime.resourceMonitorTimer = setInterval(() => {
    refreshResourceStatus({ force: true }).catch((error) => console.error('Resource monitoring failed:', error));
  }, RESOURCE_MONITOR_INTERVAL_MS);
  maintenanceStateRuntime.resourceMonitorTimer.unref?.();
  maintenanceStateRuntime.accountCleanupTimer = setInterval(() => {
    try {
      servicesRuntime.accountService.cleanup();
      prunePlanningSnapshots(servicesRuntime.database);
      servicesRuntime.amapService.prune();
    } catch (error) {
      console.error('Account or map cleanup failed:', error);
    }
  }, ACCOUNT_CLEANUP_INTERVAL_MS);
  maintenanceStateRuntime.accountCleanupTimer.unref?.();
  if (OPERATION_MAINTENANCE_ENABLED) {
    maintenanceStateRuntime.maintenanceTimer = setInterval(() => {
      try {
        pruneOperationHistory();
      } catch (error) {
        console.error('Operation history maintenance failed:', error);
      }
    }, MAINTENANCE_INTERVAL_MS);
    maintenanceStateRuntime.maintenanceTimer.unref?.();
  }
  if (ASSET_GC_ENABLED) {
    maintenanceStateRuntime.assetGcTimer = setInterval(() => {
      if (assetMaintenanceRuntime.assetGcInFlight) return;
      assetMaintenanceRuntime.assetGcInFlight = collectOrphanedAssets()
        .catch((error) => console.error('Asset GC failed:', error))
        .finally(() => {
          assetMaintenanceRuntime.assetGcInFlight = null;
        });
    }, ASSET_GC_INTERVAL_MS);
    maintenanceStateRuntime.assetGcTimer.unref?.();
  }
  if (!AUTOMATIC_BACKUPS_ENABLED) return;
  maintenanceStateRuntime.backupTimer = setInterval(() => {
    createOnlineBackup().catch((error) => console.error('Online backup failed:', error));
  }, BACKUP_INTERVAL_MS);
  maintenanceStateRuntime.backupTimer.unref?.();
  const lastBackupTime = Date.parse(recoveryStatus.lastBackupAt || '');
  if (!Number.isFinite(lastBackupTime) || Date.now() - lastBackupTime >= BACKUP_INTERVAL_MS) {
    maintenanceStateRuntime.backupInitialTimer = setTimeout(() => {
      maintenanceStateRuntime.backupInitialTimer = null;
      createOnlineBackup().catch((error) => console.error('Initial online backup failed:', error));
    }, BACKUP_INITIAL_DELAY_MS);
    maintenanceStateRuntime.backupInitialTimer.unref?.();
  }
}

async function runInitialAssetMaintenance() {
  try {
    await refreshResourceStatus({ force: true });
  } catch (error) {
    console.error('Initial resource scan failed:', error);
  }
  try {
    await backfillStoredImageAssets();
  } catch (error) {
    console.error('Initial image derivative backfill failed:', error);
  }
  if (!ASSET_GC_ENABLED || assetMaintenanceRuntime.assetGcInFlight) return;
  assetMaintenanceRuntime.assetGcInFlight = collectOrphanedAssets();
  try {
    const assetGc = await assetMaintenanceRuntime.assetGcInFlight;
    if (assetGc.removedFiles) {
      console.log(`Asset GC removed ${assetGc.removedFiles} orphaned file(s) (${assetGc.removedBytes} bytes).`);
    }
  } catch (error) {
    console.error('Initial asset GC failed:', error);
  } finally {
    assetMaintenanceRuntime.assetGcInFlight = null;
  }
}

export { runInitialAssetMaintenance, startMaintenance };
