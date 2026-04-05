import crypto from 'crypto';
import { getDb } from '../db/database';

type DeliveryStatus = 'received' | 'processed' | 'ignored' | 'failed';

export interface SyncDeliveryRecord {
  id: string;
  provider: string;
  eventType: string;
  deliveryKey: string;
  payload: string;
  status: DeliveryStatus;
  createdAt: string;
  updatedAt: string;
  errorMessage: string | null;
}

type SyncDeliveryRow = {
  id: string;
  provider: string;
  event_type: string;
  delivery_key: string;
  payload: string;
  status: DeliveryStatus;
  created_at: string;
  updated_at: string;
  error_message: string | null;
};

function mapRow(row: SyncDeliveryRow): SyncDeliveryRecord {
  return {
    id: row.id,
    provider: row.provider,
    eventType: row.event_type,
    deliveryKey: row.delivery_key,
    payload: row.payload,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    errorMessage: row.error_message,
  };
}

export function createSyncDelivery(input: {
  provider: string;
  eventType: string;
  deliveryKey: string;
  payload: string;
}) {
  const existing = getSyncDeliveryByKey(input.deliveryKey);
  if (existing) {
    return existing;
  }

  const nowIso = new Date().toISOString();
  const id = crypto.randomUUID();

  getDb()
    .prepare(`
      INSERT INTO sync_deliveries (
        id, provider, event_type, delivery_key, payload, status, created_at, updated_at, error_message
      ) VALUES (?, ?, ?, ?, ?, 'received', ?, ?, NULL)
    `)
    .run(id, input.provider, input.eventType, input.deliveryKey, input.payload, nowIso, nowIso);

  return getSyncDeliveryByKey(input.deliveryKey)!;
}

export function getSyncDeliveryByKey(deliveryKey: string) {
  const row = getDb()
    .prepare('SELECT * FROM sync_deliveries WHERE delivery_key = ?')
    .get(deliveryKey) as SyncDeliveryRow | undefined;
  return row ? mapRow(row) : null;
}

export function markSyncDelivery(
  deliveryKey: string,
  status: DeliveryStatus,
  errorMessage?: string | null
) {
  getDb()
    .prepare(`
      UPDATE sync_deliveries
      SET status = ?, updated_at = ?, error_message = ?
      WHERE delivery_key = ?
    `)
    .run(status, new Date().toISOString(), errorMessage ?? null, deliveryKey);

  return getSyncDeliveryByKey(deliveryKey);
}

export function getSyncDeliveryStats() {
  const pending = getDb()
    .prepare("SELECT COUNT(*) AS count FROM sync_deliveries WHERE status = 'received'")
    .get() as { count: number };
  const failed = getDb()
    .prepare("SELECT COUNT(*) AS count FROM sync_deliveries WHERE status = 'failed'")
    .get() as { count: number };
  const lastWebhook = getDb()
    .prepare(`
      SELECT updated_at AS updatedAt
      FROM sync_deliveries
      ORDER BY updated_at DESC
      LIMIT 1
    `)
    .get() as { updatedAt: string } | undefined;

  return {
    pendingDeliveries: pending.count,
    failedDeliveries: failed.count,
    lastWebhookAt: lastWebhook?.updatedAt ?? null,
  };
}
