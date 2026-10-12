/**
 * Резервная копия базы из командной строки (для планировщика задач / cron):
 *   npm run backup
 * Копия создаётся в data/backups. Можно запускать при работающем сервере.
 */
import { bootstrap } from '../src/bootstrap.ts';
import { createBackup } from '../src/services/backup.ts';

bootstrap();
console.log('Создана резервная копия:', createBackup('cli'));
