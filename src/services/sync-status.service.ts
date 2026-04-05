import { all } from './database.service';
import type { SyncState } from './sync.types';

export type SyncHealth = 'healthy' | 'degraded' | 'offline' | 'unknown';

export interface SyncStatusView {
  state: SyncHealth;
  lastSuccessfulSyncAt: string | null;
  lastAttemptAt: string | null;
  pendingChanges: number;
  roomsSynced: number;
  message: string | null;
}

let lastReconcileAt: string | null = null;

export function markReconcileRun(): void {
  lastReconcileAt = new Date().toISOString();
}

function countPendingDeliveries(): number {
  return 0;
}

function getDeliveryFailures(): number {
  return 0;
}

function getRoomSyncRows(): Array<{
  roomId: string;
  syncState: SyncState;
  lastSyncedAt: string | null;
  updatedAt: string;
}> {
  return all<{
    roomId: string;
    syncState: SyncState;
    lastSyncedAt: string | null;
    updatedAt: string;
  }>(
    `
      SELECT roomId, syncState, lastSyncedAt, updatedAt
      FROM room_sync_state
    `
  );
}

function resolveSyncHealth(args: {
  roomCount: number;
  syncedCount: number;
  pendingChanges: number;
  failureCount: number;
}): SyncHealth {
  if (args.roomCount === 0) {
    return 'unknown';
  }

  if (args.syncedCount === 0) {
    return 'offline';
  }

  if (args.failureCount > 0 || args.pendingChanges > 0 || args.syncedCount < args.roomCount) {
    return 'degraded';
  }

  return 'healthy';
}

function resolveSyncMessage(state: SyncHealth, pendingChanges: number, failureCount: number): string {
  if (state === 'healthy') {
    return 'Đồng bộ lịch phòng đang ổn định.';
  }
  if (state === 'offline') {
    return 'Chưa có dữ liệu đồng bộ từ lịch phòng.';
  }
  if (failureCount > 0) {
    return `Có ${failureCount} lần đồng bộ lỗi, cần kiểm tra webhook hoặc quyền Calendar.`;
  }
  if (pendingChanges > 0) {
    return `Đang có ${pendingChanges} thay đổi lịch chờ xử lý.`;
  }
  return 'Trạng thái đồng bộ đang suy giảm, dữ liệu có thể chậm.';
}

export function getSyncStatus(): SyncStatusView {
  const roomRows = getRoomSyncRows();
  const pendingDeliveries = countPendingDeliveries();
  const deliveryFailures = getDeliveryFailures();

  const pendingRooms = roomRows.filter((row) => row.syncState === 'pending' || row.syncState === 'error').length;
  const pendingChanges = pendingDeliveries + pendingRooms;
  const roomsSynced = roomRows.filter((row) => row.lastSyncedAt !== null).length;

  const successfulSyncCandidates = roomRows
    .map((row) => row.lastSyncedAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  const latestSuccessfulSync = successfulSyncCandidates[successfulSyncCandidates.length - 1] ?? null;

  const lastAttemptCandidates = [
    lastReconcileAt,
    ...roomRows.map((row) => row.updatedAt),
    ...all<{ processedAt: string | null; receivedAt: string }>(
      'SELECT processedAt, receivedAt FROM sync_deliveries ORDER BY receivedAt DESC LIMIT 20'
    ).map((row) => row.processedAt ?? row.receivedAt),
  ].filter((value): value is string => Boolean(value));
  const sortedAttempts = lastAttemptCandidates.sort();
  const lastAttemptAt = sortedAttempts[sortedAttempts.length - 1] ?? null;

  const state = resolveSyncHealth({
    roomCount: roomRows.length,
    syncedCount: roomsSynced,
    pendingChanges,
    failureCount: deliveryFailures,
  });

  return {
    state,
    lastSuccessfulSyncAt: latestSuccessfulSync,
    lastAttemptAt,
    pendingChanges,
    roomsSynced,
    message: resolveSyncMessage(state, pendingChanges, deliveryFailures),
  };
}
