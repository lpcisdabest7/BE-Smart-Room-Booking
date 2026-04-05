import express from 'express';
import cors from 'cors';
import { config } from './config';
import authRouter from './routes/auth';
import chatRouter from './routes/chat';
import bookingRouter from './routes/booking';
import roomsRouter from './routes/rooms';
import bookingsRouter from './routes/bookings';
import integrationsRouter from './routes/integrations';
import syncRouter from './routes/sync';
import { seedRoomCatalog } from './services/room-catalog.service';
import { getDatabase } from './services/database.service';
import { startReconcileLoop } from './services/reconcile.service';

const app = express();

getDatabase();
seedRoomCatalog();

app.use(
  cors({
    origin: config.frontendUrl,
    credentials: true,
  })
);
app.use(
  express.json({
    verify: (req, _res, buffer) => {
      (req as typeof req & { rawBody?: string }).rawBody = buffer.toString('utf-8');
    },
  })
);

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    rooms: config.rooms.length,
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/auth', authRouter);
app.use('/api/chat', chatRouter);
app.use('/api/book', bookingRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/sync', syncRouter);

startReconcileLoop();

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
  console.log(`Loaded ${config.rooms.length} room(s)`);
  if (!config.openaiApiKey) {
    console.warn('WARNING: OPENAI_API_KEY is not set');
  }
});

export default app;

