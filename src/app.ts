import express from 'express';
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

app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  const requestedHeaders = req.headers['access-control-request-headers'];

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    typeof requestedHeaders === 'string' && requestedHeaders.trim()
      ? requestedHeaders
      : 'Origin, X-Requested-With, Content-Type, Accept, Authorization, ngrok-skip-browser-warning'
  );
  res.setHeader('Access-Control-Expose-Headers', '*');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
});

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
  } else {
    console.log(`AI model in use: ${config.aiModel}`);
  }
});

export default app;
