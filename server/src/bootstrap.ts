import { seedRoles } from './auth/auth.ts';
import { openDb } from './db/db.ts';
import { invalidateCategories, seedCategories } from './domain/categories.ts';

/** Открытие БД, миграции, системные роли и категории. */
export function bootstrap(dbFile?: string): void {
  openDb(dbFile);
  seedRoles();
  seedCategories();
  invalidateCategories();
}
