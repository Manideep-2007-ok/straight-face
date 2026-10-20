import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import {
  requestId,
  generalLimiter,
  notFound,
  errorHandler,
  ok,
} from './middleware/index.js';
import authRoutes from './routes/auth.js';
import roomRoutes from './routes/rooms.js';
import rtcRoutes from './routes/rtc.js';
import sessionRoutes from './routes/sessions.js';

export function createApp(config, registry) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(requestId);
  app.use(helmet());
  app.use(cors({ origin: config.allowedOrigins, credentials: true }));
  app.use(express.json({ limit: '50kb' }));
  app.use(cookieParser());

  app.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

  app.use('/api', generalLimiter);
  app.use('/api/auth', authRoutes(config));
  app.use('/api/rooms', roomRoutes(config, registry));
  app.use('/api/rtc', rtcRoutes(config));
  app.use('/api/sessions', sessionRoutes(config));
  app.get('/api/ping', (req, res) => ok(req, res, { pong: true }));

  app.use(notFound);
  app.use(errorHandler(config.isProd));
  return app;
}
