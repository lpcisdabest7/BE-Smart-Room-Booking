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

const defaultCorsPatterns = [
  /^https?:\/\/localhost(?::\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/i,
  /^https:\/\/[a-z0-9-]+\.ngrok-free\.app$/i,
];

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  if (config.frontendOrigins.some((allowed) => allowed.toLowerCase() === origin.toLowerCase())) {
    return true;
  }

  return defaultCorsPatterns.some((pattern) => pattern.test(origin));
}

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin not allowed by CORS: ${origin || 'unknown'}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

app.use(
  cors(corsOptions)
);
app.options(/.*/, cors(corsOptions));
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
