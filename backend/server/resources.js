import path from 'node:path';
import fsp from 'node:fs/promises';
import { evictBoardCache } from './board-cache.js';
import {
  DATA_DIR,
  MAX_DATA_DIR_BYTES,
  MAX_PROCESS_RSS_BYTES,
  MIN_FREE_DISK_BYTES,
  RESOURCE_MONITOR_INTERVAL_MS
} from './config.js';
import { ProtocolError } from './protocol-error.js';
import { resourceStatus } from './resource-state.js';
import { resourcesRuntime } from './runtime/resources.js';

async function directorySize(root) {
  let total = 0;
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    let entries;
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile()) {
        try {
          total += (await fsp.stat(target)).size;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
    }
  }
  return total;
}

function refreshMemoryStatus() {
  let memory = process.memoryUsage();
  if (memory.rss > MAX_PROCESS_RSS_BYTES) {
    evictBoardCache({ aggressive: true });
    memory = process.memoryUsage();
  }
  resourceStatus.rssBytes = memory.rss;
  resourceStatus.heapUsedBytes = memory.heapUsed;
  resourceStatus.externalBytes = memory.external;
  resourceStatus.memoryWritable = memory.rss <= MAX_PROCESS_RSS_BYTES;
  if (!resourceStatus.memoryWritable) resourceStatus.reason = 'memory-pressure';
  return memory;
}

async function refreshResourceStatus(options = {}) {
  refreshMemoryStatus();
  const fresh = Date.now() - resourceStatus.checkedAt < RESOURCE_MONITOR_INTERVAL_MS;
  if (!options.force && fresh) return resourceStatus;
  if (resourcesRuntime.resourceRefreshInFlight) return resourcesRuntime.resourceRefreshInFlight;
  resourcesRuntime.resourceRefreshInFlight = (async () => {
    const [dataDirectoryBytes, filesystem] = await Promise.all([
      directorySize(DATA_DIR),
      fsp.statfs(DATA_DIR).catch(() => null)
    ]);
    const freeDiskBytes = filesystem ? Number(filesystem.bavail ?? filesystem.bfree) * Number(filesystem.bsize) : null;
    resourceStatus.checkedAt = Date.now();
    resourceStatus.dataDirectoryBytes = dataDirectoryBytes;
    resourceStatus.freeDiskBytes = Number.isFinite(freeDiskBytes) ? freeDiskBytes : null;
    resourceStatus.storageWritable =
      dataDirectoryBytes < MAX_DATA_DIR_BYTES &&
      (resourceStatus.freeDiskBytes == null || resourceStatus.freeDiskBytes > MIN_FREE_DISK_BYTES);
    resourceStatus.reason = !resourceStatus.storageWritable
      ? dataDirectoryBytes >= MAX_DATA_DIR_BYTES
        ? 'data-directory-limit'
        : 'low-disk-space'
      : !resourceStatus.memoryWritable
        ? 'memory-pressure'
        : null;
    return resourceStatus;
  })().finally(() => {
    resourcesRuntime.resourceRefreshInFlight = null;
  });
  return resourcesRuntime.resourceRefreshInFlight;
}

async function assertWriteCapacity(additionalBytes = 0) {
  const extra = Math.max(0, Number(additionalBytes) || 0);
  const status = await refreshResourceStatus();
  if (!status.memoryWritable) {
    const error = new ProtocolError(
      'MEMORY_PRESSURE',
      'Server memory is under pressure; retry after current work drains.'
    );
    error.statusCode = 503;
    error.expose = true;
    error.retryAfter = 5;
    throw error;
  }
  if (
    !status.storageWritable ||
    status.dataDirectoryBytes + extra > MAX_DATA_DIR_BYTES ||
    (status.freeDiskBytes != null && status.freeDiskBytes - extra < MIN_FREE_DISK_BYTES)
  ) {
    const error = new ProtocolError(
      'STORAGE_LIMIT',
      'Server storage capacity has reached its configured safety limit.'
    );
    error.statusCode = 507;
    error.expose = true;
    error.retryAfter = 60;
    throw error;
  }
  // Reserve pessimistically until the next exact scan so concurrent writes
  // cannot all pass against the same stale free-space snapshot.
  status.dataDirectoryBytes += extra;
  if (status.freeDiskBytes != null) status.freeDiskBytes = Math.max(0, status.freeDiskBytes - extra);
}

export { assertWriteCapacity, directorySize, refreshMemoryStatus, refreshResourceStatus };
