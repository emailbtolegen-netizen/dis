import { createApp } from './app.ts';
import { bootstrap } from './bootstrap.ts';
import { config } from './config.ts';
import { closeDb, scalar } from './db/db.ts';
import { scheduleBackups } from './services/backup.ts';

bootstrap();
scheduleBackups();

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  console.log(`ЦИС ЖКХ г. Атырау: http://${config.host}:${config.port}`);
  console.log(`База данных: ${config.dbFile}`);
  if (scalar<number>('SELECT count(*) FROM users') === 0) {
    console.log('Пользователей нет. Создайте первого администратора: npm run create-admin');
  }
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  });
}
