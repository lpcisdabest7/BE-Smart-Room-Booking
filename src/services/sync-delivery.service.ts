import { all, get, nowIso, run } from './database.service';
import type { SyncDeliveryRecord } from './sync.types';

export function createRecallSyncDelivery(input: {
  eventType: string;
  payloadJson: string;
  calendarId?: string | null;
  deliveryId?: string | null;
  webhookId?: string | null;
}): SyncDeliveryRecord {
  const record: SyncDeliveryRecord = {
    provider: 'recall',
    eventType: input.eventType,
    calendarId: input.calendarId ?? null,
    deliveryId: input.deliveryId ?? null,
    webhookId: input.webhookId ?? null,
    payloadJson: input.payloadJson,
    receivedAt: nowIso(),
    processedAt: null,
    status: 'received',
    error: null,
  };

  run(
    `
      INSERT INTO sync_deliveries (
        provider, eventType, calendarId, deliveryId, webhookId, payloadJson,
        receivedAt, processedAt, status, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      record.provider,
      record.eventType,
      record.calendarId,
      record.deliveryId,
      record.webhookId,
      record.payloadJson,
      record.receivedAt,
      record.processedAt,
      record.status,
      record.error,
    ]
  );

  return record;
}

export function markRecallSyncDeliveryStatus(args: {
  webhookId?: string | null;
  deliveryId?: string | null;
  status: SyncDeliveryRecord['status'];
  error?: string | null;
}): SyncDeliveryRecord | undefined {
  const row = get<{
    id: number;
    provider: string;
    eventType: string;
    calendarId: string | null;
    deliveryId: string | null;
    webhookId: string | null;
    payloadJson: string;
    receivedAt: string;
    processedAt: string | null;
    status: SyncDeliveryRecord['status'];
    error: string | null;
  }>(
    `
      SELECT *
      FROM sync_deliveries
      WHERE provider = 'recall'
        AND (
          (? IS NOT NULL AND webhookId = ?)
          OR (? IS NOT NULL AND deliveryId = ?)
        )
      ORDER BY receivedAt DESC
      LIMIT 1
    `,
    [
      args.webhookId ?? null,
      args.webhookId ?? null,
      args.deliveryId ?? null,
      args.deliveryId ?? null,
    ]
  );

  if (!row) {
    return undefined;
  }

  const processedAt = nowIso();
  run(
    `
      UPDATE sync_deliveries
      SET processedAt = ?, status = ?, error = ?
      WHERE id = ?
    `,
    [processedAt, args.status, args.error ?? null, row.id]
  );

  return {
    provider: 'recall',
    eventType: row.eventType,
    calendarId: row.calendarId,
    deliveryId: row.deliveryId,
    webhookId: row.webhookId,
    payloadJson: row.payloadJson,
    receivedAt: row.receivedAt,
    processedAt,
    status: args.status,
    error: args.error ?? null,
  };
}

export function listRecallSyncDeliveries(limit = 100): SyncDeliveryRecord[] {
  return all<{
    provider: string;
    eventType: string;
    calendarId: string | null;
    deliveryId: string | null;
    webhookId: string | null;
    payloadJson: string;
    receivedAt: string;
    processedAt: string | null;
    status: SyncDeliveryRecord['status'];
    error: string | null;
  }>(
    `
      SELECT provider, eventType, calendarId, deliveryId, webhookId, payloadJson,
             receivedAt, processedAt, status, error
      FROM sync_deliveries
      WHERE provider = 'recall'
      ORDER BY receivedAt DESC
      LIMIT ?
    `,
    [limit]
  ).map((row) => ({
    provider: 'recall',
    eventType: row.eventType,
    calendarId: row.calendarId,
    deliveryId: row.deliveryId,
    webhookId: row.webhookId,
    payloadJson: row.payloadJson,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt,
    status: row.status,
    error: row.error,
  }));
}

