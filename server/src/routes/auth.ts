import { Router } from 'express';
import { z } from 'zod';
import {
  clearIpFailures, COOKIE, createSession, destroySession, destroyUserSessions, hashPassword, ipBlocked, PERMISSIONS, passwordProblem,
  registerIpFailure, setSessionCookie, verifyPassword,
} from '../auth/auth.ts';
import { get, getSetting, run } from '../db/db.ts';
import { audit } from '../services/audit.ts';

export const authRouter = Router();

const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;

authRouter.post('/login', (req, res) => {
  const body = z.object({ login: z.string().min(1).max(100), password: z.string().min(1).max(200) }).parse(req.body);
  const ip = req.ip ?? 'unknown';
  if (ipBlocked(ip)) {
    res.status(429).json({ error: 'Слишком много попыток входа. Повторите через 15 минут.' });
    return;
  }
  const user = get('SELECT * FROM users WHERE login = ?', body.login.trim());
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  if (user?.locked_until && user.locked_until > now) {
    res.status(423).json({ error: 'Учётная запись временно заблокирована после неудачных попыток входа. Повторите позже.' });
    return;
  }
  // проверка выполняется и для несуществующего пользователя — одинаковое время ответа
  const ok = verifyPassword(body.password, user?.password_hash ?? hashPassword('timing-equalizer-1'));
  if (!user || !ok || !user.is_active) {
    registerIpFailure(ip);
    if (user) {
      const attempts = user.failed_attempts + 1;
      const lock = attempts >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString().replace('T', ' ').slice(0, 19) : null;
      run('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?', lock ? 0 : attempts, lock, user.id);
    }
    req.user = undefined;
    audit(req, 'auth.login_failed', 'user', user?.id ?? null, { login: body.login.slice(0, 100) });
    res.status(401).json({ error: 'Неверный логин или пароль' });
    return;
  }
  clearIpFailures(ip);
  run(`UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?`, user.id);
  const token = createSession(user.id, req.ip, req.headers['user-agent']);
  setSessionCookie(res, token);
  req.user = { id: user.id, login: user.login } as any;
  audit(req, 'auth.login', 'user', user.id);
  res.json({ ok: true, mustChangePassword: !!user.must_change_password });
});

authRouter.post('/logout', (req, res) => {
  if (req.user) audit(req, 'auth.logout', 'user', req.user.id);
  destroySession(req.sessionToken);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Требуется вход в систему', publicPortal: getSetting('public_enabled', false) });
    return;
  }
  res.json({ user: req.user, permissionLabels: PERMISSIONS, systemName: getSetting('system_name', 'Цифровая информационная система ЖКХ города Атырау') });
});

authRouter.post('/change-password', (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Требуется вход в систему' });
    return;
  }
  const body = z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) }).parse(req.body);
  const user = get('SELECT * FROM users WHERE id = ?', req.user.id)!;
  if (!verifyPassword(body.current, user.password_hash)) {
    res.status(400).json({ error: 'Текущий пароль указан неверно' });
    return;
  }
  const problem = passwordProblem(body.next);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  if (body.next === body.current) {
    res.status(400).json({ error: 'Новый пароль должен отличаться от текущего' });
    return;
  }
  run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', hashPassword(body.next), user.id);
  destroyUserSessions(user.id, req.sessionToken);
  audit(req, 'auth.password_changed', 'user', user.id);
  res.json({ ok: true });
});
