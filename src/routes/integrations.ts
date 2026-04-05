import { Router, Request, Response } from 'express';
import { syncRoomProjectionFromRecallWebhook } from '../services/calendar-sync.service';
import { createRecallSyncDelivery, markRecallSyncDeliveryStatus } from '../services/sync-delivery.service';
import { listRoomCatalogEntries, seedRoomCatalog } from '../services/room-catalog.service';
import {
  parseRecallCalendarSyncWebhook,
  processRecallWebhook,
  verifyRecallRequest,
  verifyRecallWebhook,
} from '../services/recall.service';

const router = Router();

function findRoomByCalendarId(calendarId: string): { id: string; calendarId: string } | null {
  seedRoomCatalog();
  const room = listRoomCatalogEntries().find(
    (entry) => entry.calendarId === calendarId || entry.calendarId.toLowerCase() === calendarId.toLowerCase()
  );
  return room ? { id: room.id, calendarId: room.calendarId } : null;
}

router.post('/recall/webhook', async (req: Request, res: Response): Promise<void> => {
  const rawBody = req.rawBody || JSON.stringify(req.body ?? {});
  const signature =
    req.header('x-recall-signature') ??
    req.header('x-recall-signature-sha256') ??
    req.header('x-signature');

  const webhookSecret = process.env.RECALL_WEBHOOK_SECRET || '';
  if (webhookSecret) {
    try {
      if (webhookSecret.startsWith('whsec_')) {
        const headers = Object.entries(req.headers).reduce<Record<string, string>>((acc, [key, value]) => {
          if (typeof value === 'string') {
            acc[key] = value;
          } else if (Array.isArray(value) && typeof value[0] === 'string') {
            acc[key] = value[0];
          }
          return acc;
        }, {});

        verifyRecallRequest({
          secret: webhookSecret,
          headers,
          payload: rawBody,
        });
      } else if (!verifyRecallWebhook(rawBody, signature)) {
        res.status(401).json({ error: 'Invalid webhook signature' });
        return;
      }
    } catch {
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }
  }

  const webhookId =
    req.header('webhook-id') ??
    req.header('svix-id') ??
    req.header('x-request-id') ??
    null;

  try {
    const parsed = parseRecallCalendarSyncWebhook(req.body);
    const calendarId = parsed.data.calendar_id;

    const delivery = createRecallSyncDelivery({
      eventType: parsed.event,
      calendarId,
      webhookId,
      payloadJson: rawBody,
    });

    const room = findRoomByCalendarId(calendarId);
    if (!room) {
      markRecallSyncDeliveryStatus({
        webhookId: delivery.webhookId,
        status: 'ignored',
        error: `No room mapped for calendarId=${calendarId}`,
      });
      res.status(202).json({
        ok: true,
        ignored: true,
        reason: 'No room mapped for this calendarId',
        calendarId,
      });
      return;
    }

    if (!process.env.RECALL_API_KEY) {
      markRecallSyncDeliveryStatus({
        webhookId: delivery.webhookId,
        status: 'ignored',
        error: 'RECALL_API_KEY is not configured',
      });
      res.status(202).json({
        ok: true,
        ignored: true,
        reason: 'RECALL_API_KEY is not configured',
        calendarId,
        roomId: room.id,
      });
      return;
    }

    const syncResult = await syncRoomProjectionFromRecallWebhook({
      roomId: room.id,
      calendarId: room.calendarId,
      lastUpdatedTs: parsed.data.last_updated_ts ?? undefined,
    });

    markRecallSyncDeliveryStatus({
      webhookId: delivery.webhookId,
      status: 'processed',
    });

    res.status(200).json({
      ok: true,
      event: parsed.event,
      calendarId,
      roomId: room.id,
      sync: syncResult,
    });
  } catch (error) {
    try {
      await processRecallWebhook(req.body, rawBody);
    } catch {
      // Intentional fallback: we still want to return stable response and delivery error.
    }

    markRecallSyncDeliveryStatus({
      webhookId,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    });

    console.error('Recall webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
