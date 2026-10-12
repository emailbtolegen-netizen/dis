import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.ts';
import { all, get, json, run } from '../db/db.ts';
import type { Row } from '../db/db.ts';

export const PERMISSIONS: Record<string, string> = {
  'objects.view': 'Просмотр объектов и поиск',
  'objects.edit': 'Создание и изменение записей',
  'objects.delete': 'Удаление и восстановление записей',
  'objects.export': 'Экспорт в Excel',
  'objects.confidential': 'Просмотр конфиденциальных полей (контакты, ФИО)',
  'attachments.upload': 'Загрузка документов и фотографий',
  'links.manage': 'Подтверждение и изменение связей между объектами',
  'quality.view': 'Отчёты о качестве данных',
  'import.manage': 'Импорт Excel, откат импорта',
  'audit.view': 'Журнал действий пользователей',
  'users.manage': 'Управление пользователями',
  'roles.manage': 'Управление ролями',
  'categories.manage': 'Настройка справочников и категорий',
  'backup.manage': 'Резервное копирование и восстановление',
  'settings.manage': 'Настройки системы и публичного режима',
};

export const SYSTEM_ROLES = [
  { code: 'admin', name: 'Администратор', description: 'Полный доступ к системе', permissions: Object.keys(PERMISSIONS) },
  {
    code: 'editor', name: 'Редактор', description: 'Просмотр, создание и изменение записей, загрузка документов',
    permissions: ['objects.view', 'objects.edit', 'objects.export', 'objects.confidential', 'attachments.upload', 'links.manage', 'quality.view'],
  },
  { code: 'viewer', name: 'Пользователь', description: 'Просмотр разрешённых разделов, поиск и фильтрация', permissions: ['objects.view'] },
];

export function seedRoles(): void {
  for (const r of SYSTEM_ROLES) {
    if (!get('SELECT id FROM roles WHERE code = ?', r.code)) {
      run('INSERT INTO roles(code, name, description, permissions, sections, is_system) VALUES(?,?,?,?,?,1)', r.code, r.name, r.description, JSON.stringify(r.permissions), '["*"]');
    }
  }
  // у администратора всегда полный набор прав (включая новые, появившиеся при обновлении)
  run(`UPDATE roles SET permissions = ?, sections = '["*"]' WHERE code = 'admin'`, JSON.stringify(Object.keys(PERMISSIONS)));
}

// ─────────────────────────── Пароли ───────────────────────────

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, N, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(expected, actual);
}

/** Требования к паролю: не короче 10 символов, буквы и цифры. */
export function passwordProblem(password: string): string | null {
  if (typeof password !== 'string' || password.length < 10) return 'Пароль должен содержать не менее 10 символов';
  if (!/\d/.test(password) || !/\p{L}/u.test(password)) return 'Пароль должен содержать буквы и цифры';
  if (password.length > 200) return 'Слишком длинный пароль';
  return null;
}

// ─────────────────────────── Сессии ───────────────────────────

export const COOKIE = 'zhkh_sid';

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(userId: number, ip: string | undefined, ua: string | undefined): string {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionTtlHours * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
  run('INSERT INTO sessions(id, user_id, expires_at, ip, user_agent) VALUES(?,?,?,?,?)', sha(token), userId, expires, ip ?? null, (ua ?? '').slice(0, 300));
  run(`DELETE FROM sessions WHERE expires_at < datetime('now')`);
  return token;
}

export function destroySession(token: string | undefined): void {
  if (token) run('DELETE FROM sessions WHERE id = ?', sha(token));
}

export function destroyUserSessions(userId: number, exceptToken?: string): void {
  if (exceptToken) run('DELETE FROM sessions WHERE user_id = ? AND id != ?', userId, sha(exceptToken));
  else run('DELETE FROM sessions WHERE user_id = ?', userId);
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    path: '/',
    maxAge: config.sessionTtlHours * 3600_000,
  });
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export interface SessionUser {
  id: number;
  login: string;
  full_name: string;
  position: string | null;
  role_code: string;
  role_name: string;
  permissions: string[];
  sections: string[];
  must_change_password: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
    sessionToken?: string;
  }
}

function loadUser(token: string): SessionUser | null {
  const row = get(
    `SELECT u.id, u.login, u.full_name, u.position, u.is_active, u.must_change_password, r.code role_code, r.name role_name, r.permissions, r.sections, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN roles r ON r.id = u.role_id
      WHERE s.id = ?`, sha(token));
  if (!row || !row.is_active || row.expires_at < new Date().toISOString().replace('T', ' ').slice(0, 19)) return null;
  run(`UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?`, sha(token));
  return {
    id: row.id, login: row.login, full_name: row.full_name, position: row.position, role_code: row.role_code, role_name: row.role_name,
    permissions: json(row.permissions, []), sections: json(row.sections, ['*']), must_change_password: !!row.must_change_password,
  };
}

/** Определение пользователя по cookie (без требования входа). */
export function sessionMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const token = readCookie(req, COOKIE);
  if (token) {
    const user = loadUser(token);
    if (user) {
      req.user = user;
      req.sessionToken = token;
    }
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Требуется вход в систему' });
    return;
  }
  // до смены временного пароля доступны только операции с собственной учётной записью
  if (req.user.must_change_password && !req.path.startsWith('/auth/')) {
    res.status(403).json({ error: 'Необходимо сменить временный пароль', code: 'MUST_CHANGE_PASSWORD' });
    return;
  }
  next();
}

export function can(req: Request, permission: string): boolean {
  return !!req.user?.permissions.includes(permission);
}

export function requirePerm(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Требуется вход в систему' });
      return;
    }
    if (!permissions.every((p) => req.user!.permissions.includes(p))) {
      res.status(403).json({ error: 'Недостаточно прав для этого действия' });
      return;
    }
    next();
  };
}

export function roleList() {
  return all('SELECT * FROM roles ORDER BY is_system DESC, id').map((r): Row => ({ ...r, permissions: json(r.permissions, []), sections: json(r.sections, ['*']) }));
}

// ─────────────────── Защита от подбора пароля ───────────────────

const ipAttempts = new Map<string, { count: number; until: number }>();

export function ipBlocked(ip: string): boolean {
  const a = ipAttempts.get(ip);
  return !!a && a.count >= 20 && a.until > Date.now();
}

export function registerIpFailure(ip: string): void {
  const a = ipAttempts.get(ip);
  if (!a || a.until < Date.now()) ipAttempts.set(ip, { count: 1, until: Date.now() + 15 * 60_000 });
  else a.count++;
}

export function clearIpFailures(ip: string): void {
  ipAttempts.delete(ip);
}
