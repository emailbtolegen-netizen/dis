import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { requireAuth, requirePerm, sessionMiddleware } from './auth/auth.ts';
import { config } from './config.ts';
import { ImportError } from './import/service.ts';
import { adminRouter } from './routes/admin.ts';
import { authRouter } from './routes/auth.ts';
import { exploreRouter } from './routes/explore.ts';
import { objectsRouter, ValidationError } from './routes/objects.ts';
import { publicRouter } from './routes/public.ts';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // карта OpenStreetMap — только если в данных есть координаты
        'img-src': ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org'],
        'style-src': ["'self'", "'unsafe-inline'"],
        'upgrade-insecure-requests': config.cookieSecure ? [] : null,
      },
    },
    strictTransportSecurity: config.cookieSecure,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(express.json({ limit: '2mb' }));

  // защита от CSRF: для изменяющих запросов источник должен совпадать с сайтом
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] ?? req.headers.host;
    if (origin) {
      let ok = false;
      try {
        ok = new URL(origin).host === host || config.allowedOrigins.includes(origin);
      } catch {
        ok = false;
      }
      if (!ok) {
        res.status(403).json({ error: 'Запрос отклонён: недопустимый источник' });
        return;
      }
    }
    if (req.headers['x-requested-with'] !== 'zhkh') {
      res.status(403).json({ error: 'Запрос отклонён: отсутствует заголовок X-Requested-With' });
      return;
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api', sessionMiddleware);
  app.use('/api/public', publicRouter);
  app.use('/api/auth', authRouter);
  app.use('/api', requireAuth, requirePerm('objects.view'), objectsRouter);
  app.use('/api', requireAuth, requirePerm('objects.view'), exploreRouter);
  app.use('/api/admin', requireAuth, adminRouter);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Не найдено' });
  });

  // собранный интерфейс (client/dist)
  if (fs.existsSync(config.clientDist)) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.clientDist, 'index.html'));
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: err.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ` : '') + i.message).join('; ') });
      return;
    }
    if (err instanceof ValidationError || err instanceof ImportError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof MulterError) {
      res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Файл превышает допустимый размер' : 'Ошибка загрузки файла' });
      return;
    }
    if ((err as any)?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Некорректный JSON' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера. Подробности записаны в журнал сервера.' });
  });
  return app;
}
