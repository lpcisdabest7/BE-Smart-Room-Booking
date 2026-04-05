import { setInterval, clearInterval } from 'timers';
import { reconcileAllRooms, reconcileRoomAvailability } from './calendar-sync.service';

export interface SyncSchedulerHandle {
  start(): Promise<void>;
  stop(): void;
  runOnce(): Promise<void>;
  isRunning(): boolean;
}

export interface SyncSchedulerOptions {
  intervalMs?: number;
  initialDelayMs?: number;
  runOnStart?: boolean;
}

export function createSyncScheduler(options: SyncSchedulerOptions = {}): SyncSchedulerHandle {
  const intervalMs = options.intervalMs ?? Number(process.env.ROOM_SYNC_INTERVAL_MS || 15 * 60 * 1000);
  const initialDelayMs = options.initialDelayMs ?? 0;
  const runOnStart = options.runOnStart ?? true;

  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function runOnce(): Promise<void> {
    await reconcileAllRooms();
  }

  async function start(): Promise<void> {
    if (timer) {
      return;
    }

    running = true;

    if (runOnStart) {
      if (initialDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, initialDelayMs));
      }
      await runOnce();
    }

    timer = setInterval(() => {
      void runOnce().catch((error) => {
        console.error('Room sync scheduler error:', error);
      });
    }, intervalMs);
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    running = false;
  }

  return {
    start,
    stop,
    runOnce,
    isRunning: () => running,
  };
}

export async function syncSingleRoom(roomId: string) {
  return reconcileRoomAvailability(roomId);
}

