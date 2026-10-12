import { hashPassword, passwordProblem } from './auth/auth.ts';
import { createApp } from './app.ts';
import { bootstrap } from './bootstrap.ts';
import { config } from './config.ts';
import { closeDb, get, run, scalar } from './db/db.ts';
import { scheduleBackups } from './services/backup.ts';

bootstrap();
scheduleBackups();

/**
 * Первый администратор на хостинге без консоли (Railway и т.п.):
 * если пользователей ещё нет и заданы ADMIN_LOGIN и ADMIN_PASSWORD, создаётся администратор
 * с обязательной сменой пароля при первом входе. Существующих пользователей это не затрагивает.
 */
function ensureFirstAdmin(): void {
  if (scalar<number>('SELECT count(*) FROM users') > 0) return;
  const login = process.env.ADMIN_LOGIN?.trim();
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (!login || !password) {
    console.log('Пользователей нет. Создайте первого администратора: npm run create-admin (или задайте ADMIN_LOGIN и ADMIN_PASSWORD)');
    return;
  }
  const problem = passwordProblem(password);
  if (problem) {
    console.error(`ADMIN_PASSWORD не подходит: ${problem}. Администратор не создан.`);
    return;
  }
  const role = get(`SELECT id FROM roles WHERE code = 'admin'`)!;
  run('INSERT INTO users(login, full_name, password_hash, role_id, must_change_password) VALUES(?,?,?,?,1)',
    login, process.env.ADMIN_NAME?.trim() || 'Администратор системы', hashPassword(password), role.id);
  run(`INSERT INTO audit_log(action, entity, entity_id, details) VALUES('user.create', 'user', ?, '{"via":"ADMIN_LOGIN env"}')`, login);
  console.log(`Создан первый администратор «${login}» (пароль из ADMIN_PASSWORD; при первом входе потребуется сменить).`);
}
ensureFirstAdmin();

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  console.log(`ЦИС ЖКХ г. Атырау: http://${config.host}:${config.port}`);
  console.log(`База данных: ${config.dbFile}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  });
}
