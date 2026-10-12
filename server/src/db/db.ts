import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import { config } from '../config.ts';
import { migrations } from './schema.ts';

export type Row = Record<string, any>;
export type Param = SQLInputValue;

let db: DatabaseSync;
let txDepth = 0;

export function openDb(file: string = config.dbFile): void {
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  migrate();
}

export function closeDb(): void {
  if (db?.isOpen) db.close();
}

export function getDb(): DatabaseSync {
  return db;
}

function migrate(): void {
  const current = (db.prepare('PRAGMA user_version').get() as Row).user_version as number;
  for (let v = current; v < migrations.length; v++) {
    tx(() => {
      db.exec(migrations[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Плоская копия строки (node:sqlite отдаёт объекты без прототипа). */
function plain<T extends Row>(r: unknown): T {
  return r == null ? (r as unknown as T) : ({ ...(r as object) } as T);
}

export function all<T extends Row = Row>(sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...params).map((r) => plain<T>(r));
}

export function get<T extends Row = Row>(sql: string, ...params: Param[]): T | undefined {
  const r = db.prepare(sql).get(...params);
  return r ? plain<T>(r) : undefined;
}

export function run(sql: string, ...params: Param[]): { changes: number; lastId: number } {
  const r = db.prepare(sql).run(...params);
  return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
}

export function scalar<T = any>(sql: string, ...params: Param[]): T {
  const r = db.prepare(sql).get(...params) as Row | undefined;
  return (r ? Object.values(r)[0] : undefined) as T;
}

/** Транзакция; вложенные вызовы выполняются в рамках внешней. */
export function tx<T>(fn: () => T): T {
  if (txDepth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  txDepth++;
  try {
    const result = fn();
    txDepth--;
    db.exec('COMMIT');
    return result;
  } catch (e) {
    txDepth--;
    db.exec('ROLLBACK');
    throw e;
  }
}

export function json<T = any>(s: string | null | undefined, def: T): T {
  if (s == null || s === '') return def;
  try {
    return JSON.parse(s) as T;
  } catch {
    return def;
  }
}

export function getMeta(key: string): string | null {
  return get('SELECT value FROM meta WHERE key = ?', key)?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  run('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

export function getSetting<T>(key: string, def: T): T {
  const v = get('SELECT value FROM settings WHERE key = ?', key)?.value;
  return v == null ? def : json<T>(v, def);
}

export function setSetting(key: string, value: unknown): void {
  run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

export function nowIso(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}
