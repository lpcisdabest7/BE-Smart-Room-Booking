import { config } from '../config';
import { bootstrapRoomProjection } from './calendar-sync.service';
import { listRoomCatalogEntries, seedRoomCatalog } from './room-catalog.service';
import { markReconcileRun } from './sync-status.service';

let timer: NodeJS.Timeout | null = null;

export async function runReconcileCycle(): Promise<void> {
  seedRoomCatalog();
  const rooms = listRoomCatalogEntries();

  for (const room of rooms) {
    try {
      await bootstrapRoomProjection(room.id);
    } catch (error) {
      console.error(`Reconcile failed for room ${room.id}:`, error);
    }
  }

  markReconcileRun();
}

export function startReconcileLoop(): void {
  if (timer) {
    return;
  }

  void runReconcileCycle().catch((error) => {
    console.error('Initial reconcile failed:', error);
  });

  timer = setInterval(() => {
    void runReconcileCycle().catch((error) => {
      console.error('Reconcile cycle failed:', error);
    });
  }, config.reconcileIntervalMs);
}

