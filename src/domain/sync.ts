export type SyncDeliveryStatus = 'received' | 'processed' | 'ignored' | 'failed';

export interface SyncDeliveryRecord {
  id: string;
  provider: string;
  deliveryKey: string;
  roomId: string | null;
  externalEventId: string | null;
  payload: Record<string, unknown>;
  receivedAt: string;
  processedAt: string | null;
  status: SyncDeliveryStatus;
  attemptCount: number;
  errorMessage: string | null;
}
