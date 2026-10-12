import path from 'node:path';
import fs from 'node:fs';

/** Корень проекта (zhkh-portal/). */
export const projectRoot = path.resolve(import.meta.dirname, '..', '..');

// Переменные окружения из .env (если файл есть). Секреты никогда не попадают в клиентский код.
for (const candidate of [path.join(projectRoot, '.env'), path.join(projectRoot, 'server', '.env')]) {
  if (fs.existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

function num(name: string, def: number): number {
  const v = process.env[name];
  if (v == null || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Переменная ${name} должна быть числом`);
  return n;
}

const dataDir = path.resolve(projectRoot, process.env.DATA_DIR || 'data');

export const config = {
  env: process.env.NODE_ENV || 'development',
  host: process.env.HOST || '127.0.0.1',
  port: num('PORT', 3000),
  dataDir,
  dbFile: path.join(dataDir, 'zhkh.sqlite'),
  uploadsDir: path.join(dataDir, 'uploads'),
  attachmentsDir: path.join(dataDir, 'attachments'),
  backupsDir: path.join(dataDir, 'backups'),
  clientDist: path.join(projectRoot, 'client', 'dist'),
  /** Включать только при работе через HTTPS (на продакшене — обязательно). */
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  /** Если сайт стоит за nginx/обратным прокси. */
  trustProxy: process.env.TRUST_PROXY === 'true',
  sessionTtlHours: num('SESSION_TTL_HOURS', 12),
  maxImportMb: num('MAX_IMPORT_MB', 25),
  maxAttachmentMb: num('MAX_ATTACHMENT_MB', 20),
  backupIntervalHours: num('BACKUP_INTERVAL_HOURS', 24),
  backupKeep: num('BACKUP_KEEP', 30),
  /** Разрешённые источники запросов (для проверки Origin). Пусто — только тот же хост. */
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
};

for (const dir of [config.dataDir, config.uploadsDir, config.attachmentsDir, config.backupsDir]) {
  fs.mkdirSync(dir, { recursive: true });
}
