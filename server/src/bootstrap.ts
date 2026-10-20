import { seedRoles } from './auth/auth.ts';
import { all, openDb, run } from './db/db.ts';
import { invalidateCategories, seedCategories } from './domain/categories.ts';
import { looseBuildingKey } from './domain/addressMatch.ts';
import { fold } from './domain/normalize.ts';

/** Открытие БД, миграции, системные роли и категории. */
export function bootstrap(dbFile?: string): void {
  openDb(dbFile);
  seedRoles();
  seedCategories();
  invalidateCategories();
  rekeyEmergency();
}

/**
 * Ключ аварийных домов — нормализованный адрес (общий для карты HTML и таблицы Excel).
 * Записи, загруженные с ключом прежнего вида, получают новый ключ; идемпотентно.
 */
function rekeyEmergency(): void {
  const rows = all<{ id: number; natural_key: string; address_raw: string | null }>(
    "SELECT id, natural_key, address_raw FROM objects WHERE category = 'mkd_emergency' AND deleted_at IS NULL AND address_raw IS NOT NULL",
  );
  const used = new Set(rows.map((r) => r.natural_key));
  for (const r of rows) {
    const addr = r.address_raw!;
    const key = `mkd_emergency:${looseBuildingKey(addr) ?? fold(addr).replace(/[\s,.]+/g, ' ').trim()}`;
    if (key === r.natural_key || used.has(key)) continue;
    run('UPDATE objects SET natural_key = ? WHERE id = ?', key, r.id);
    used.add(key);
  }
}
