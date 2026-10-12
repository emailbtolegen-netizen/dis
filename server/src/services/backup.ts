import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';
import { closeDb, getDb, openDb } from '../db/db.ts';

const NAME_RE = /^zhkh-\d{8}-\d{6}(?:-[a-z0-9-]+)?\.sqlite$/;

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Согласованная копия базы данных (VACUUM INTO — безопасно при работающем сервере). */
export function createBackup(reason = 'manual'): string {
  const tag = reason.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 30);
  let name = `zhkh-${stamp()}-${tag}.sqlite`;
  let i = 1;
  while (fs.existsSync(path.join(config.backupsDir, name))) name = `zhkh-${stamp()}-${tag}-${++i}.sqlite`;
  const target = path.join(config.backupsDir, name);
  getDb().exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  prune();
  return name;
}

export function listBackups() {
  return fs.readdirSync(config.backupsDir)
    .filter((f) => NAME_RE.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(config.backupsDir, f));
      return { name: f, size: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function backupPath(name: string): string {
  if (!NAME_RE.test(name)) throw new Error('Недопустимое имя резервной копии');
  const p = path.join(config.backupsDir, name);
  if (!fs.existsSync(p)) throw new Error('Резервная копия не найдена');
  return p;
}

/** Удаление старых автоматических копий сверх лимита (ручные копии не удаляются). */
function prune(): void {
  const auto = listBackups().filter((b) => !b.name.includes('-manual'));
  for (const b of auto.slice(config.backupKeep)) fs.rmSync(path.join(config.backupsDir, b.name), { force: true });
}

/** Восстановление базы из копии. Перед восстановлением автоматически создаётся копия текущего состояния. */
export function restoreBackup(name: string): string {
  const src = backupPath(name);
  const safety = createBackup('before-restore');
  closeDb();
  try {
    for (const ext of ['-wal', '-shm']) fs.rmSync(config.dbFile + ext, { force: true });
    fs.copyFileSync(src, config.dbFile);
  } finally {
    openDb();
  }
  return safety;
}

let timer: NodeJS.Timeout | null = null;

/** Плановое резервное копирование (по умолчанию раз в сутки). */
export function scheduleBackups(): void {
  if (config.backupIntervalHours <= 0 || timer) return;
  const check = () => {
    const last = listBackups().find((b) => b.name.includes('-scheduled'));
    const due = !last || Date.now() - new Date(last.created_at).getTime() >= config.backupIntervalHours * 3600_000;
    if (due) {
      try {
        createBackup('scheduled');
      } catch (e) {
        console.error('Ошибка планового резервного копирования:', e);
      }
    }
  };
  check();
  timer = setInterval(check, 15 * 60_000);
  timer.unref();
}
