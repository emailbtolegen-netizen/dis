import XLSX from 'xlsx';
import { all, get, json } from '../db/db.ts';
import type { Param } from '../db/db.ts';
import { categories, category, CORE_FIELDS, CORE_LABELS } from '../domain/categories.ts';
import type { Category, FieldDef } from '../domain/categories.ts';
import { fold } from '../domain/normalize.ts';

const META_COLUMNS = new Set(['uid', 'category', 'created_at', 'updated_at', 'source_row', 'deleted_at']);
const KEY_RE = /^[a-z][a-z0-9_]{0,40}$/;

/** SQL-выражение для поля (ключи проверяются по белому списку / шаблону — защита от SQL-инъекций). */
export function fieldExpr(key: string): string | null {
  if ((CORE_FIELDS as readonly string[]).includes(key) || META_COLUMNS.has(key)) return `o.${key}`;
  if (KEY_RE.test(key)) return `json_extract(o.attrs, '$.${key}')`;
  return null;
}

export interface ListParams {
  category?: string;
  domain?: string;
  q?: string;
  filters?: Record<string, unknown>;
  sort?: string;
  order?: string;
  page?: number;
  pageSize?: number;
  deleted?: boolean;
  withIssues?: boolean;
  addressId?: number;
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

export function buildWhere(p: ListParams, allowed: string[]): { where: string; args: Param[] } {
  const conds: string[] = [];
  const args: Param[] = [];
  let cats = allowed;
  if (p.category) cats = cats.filter((c) => c === p.category);
  if (p.domain) cats = cats.filter((c) => category(c)?.domain === p.domain);
  conds.push(cats.length ? `o.category IN (${cats.map(() => '?').join(',')})` : '0');
  args.push(...cats);
  conds.push(p.deleted ? 'o.deleted_at IS NOT NULL' : 'o.deleted_at IS NULL');
  if (p.addressId) {
    conds.push('o.address_id = ?');
    args.push(p.addressId);
  }
  if (p.withIssues) conds.push(`o.issues != '[]'`);
  if (p.q && p.q.trim()) {
    const tokens = fold(p.q).split(/\s+/).filter(Boolean).slice(0, 8);
    for (const t of tokens) {
      conds.push(`o.search_text LIKE ? ESCAPE '\\'`);
      args.push(`%${likeEscape(t)}%`);
    }
  }
  for (const [key, raw] of Object.entries(p.filters ?? {})) {
    const expr = fieldExpr(key);
    if (!expr || raw == null) continue;
    if (Array.isArray(raw)) {
      if (!raw.length) continue;
      const parts: string[] = [];
      const vals = raw.filter((v) => v !== '__empty__');
      if (vals.length) {
        parts.push(`CAST(${expr} AS TEXT) IN (${vals.map(() => '?').join(',')})`);
        args.push(...vals.map((v) => String(v)));
      }
      if (raw.includes('__empty__')) parts.push(`(${expr} IS NULL OR ${expr} = '')`);
      conds.push(`(${parts.join(' OR ')})`);
    } else if (typeof raw === 'object') {
      const r = raw as { min?: number; max?: number; contains?: string; empty?: boolean };
      if (r.min != null && Number.isFinite(Number(r.min))) { conds.push(`${expr} >= ?`); args.push(Number(r.min)); }
      if (r.max != null && Number.isFinite(Number(r.max))) { conds.push(`${expr} <= ?`); args.push(Number(r.max)); }
      if (r.contains) { conds.push(`lower(CAST(${expr} AS TEXT)) LIKE ? ESCAPE '\\'`); args.push(`%${likeEscape(String(r.contains).toLowerCase())}%`); }
      if (r.empty === true) conds.push(`(${expr} IS NULL OR ${expr} = '')`);
      if (r.empty === false) conds.push(`(${expr} IS NOT NULL AND ${expr} != '')`);
    } else {
      conds.push(`CAST(${expr} AS TEXT) = ?`);
      args.push(String(raw));
    }
  }
  return { where: conds.join(' AND '), args };
}

export function listObjects(p: ListParams, allowed: string[]) {
  const { where, args } = buildWhere(p, allowed);
  const pageSize = Math.min(Math.max(Number(p.pageSize) || 50, 1), 500);
  const page = Math.max(Number(p.page) || 1, 1);
  const sortExpr = (p.sort && fieldExpr(p.sort)) || 'o.category, o.id';
  const dir = p.order === 'desc' ? 'DESC' : 'ASC';
  const orderBy = p.sort && fieldExpr(p.sort) ? `(${sortExpr} IS NULL) ASC, ${sortExpr} ${dir}, o.id` : 'o.category, o.id';
  const total = get(`SELECT count(*) n FROM objects o WHERE ${where}`, ...args)!.n as number;
  const items = all(
    `SELECT o.id, o.uid, o.category, o.name, o.code, o.address_raw, o.address_id, o.status, o.balance_holder, o.year_built, o.voltage,
            o.power_kva, o.length_km, o.lat, o.lon, o.attrs, o.notes, o.updated_at, o.deleted_at, o.delete_reason,
            o.source_file_id, o.source_sheet, o.source_row, (o.issues != '[]') has_import_issues
       FROM objects o WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    ...args, pageSize, (page - 1) * pageSize,
  );
  return { total, page, pageSize, items };
}

/** Значения для фильтров (с количеством) по полям категории. */
export function facets(categoryCode: string, allowed: string[], p: ListParams = {}) {
  const cat = category(categoryCode);
  if (!cat || !allowed.includes(cat.code)) return {};
  const { where, args } = buildWhere({ ...p, category: cat.code, filters: {} }, allowed);
  const out: Record<string, { value: string | null; count: number }[]> = {};
  for (const f of cat.fields.filter((x) => x.filter && !x.confidential)) {
    const expr = fieldExpr(f.key)!;
    out[f.key] = all(
      `SELECT CAST(${expr} AS TEXT) v, count(*) n FROM objects o WHERE ${where} GROUP BY v ORDER BY n DESC, v LIMIT 300`, ...args,
    ).map((r) => ({ value: r.v, count: r.n }));
  }
  return out;
}

// ─────────────────────────── Экспорт ───────────────────────────

function displayValue(f: FieldDef | undefined, v: unknown): unknown {
  if (v == null) return null;
  if (f?.valueMap && typeof v === 'string' && f.valueMap[v]) return `${f.valueMap[v]} (${v})`;
  return v;
}

/** Выгрузка отфильтрованных объектов в XLSX. Конфиденциальные поля — только при наличии права. */
export function exportObjects(p: ListParams, allowed: string[], canConfidential: boolean): Buffer {
  const { where, args } = buildWhere(p, allowed);
  const rows = all(
    `SELECT o.*, s.file_name FROM objects o LEFT JOIN source_files s ON s.id = o.source_file_id WHERE ${where} ORDER BY o.category, o.id LIMIT 100000`, ...args,
  );
  const cats = categories();
  const catCodes = [...new Set(rows.map((r) => r.category))];
  // столбцы: общие + поля всех категорий в выборке (без дублей)
  const columns: { key: string; label: string; core: boolean; def?: FieldDef }[] = [];
  const seen = new Set<string>();
  const add = (key: string, label: string, core: boolean, def?: FieldDef) => {
    if (seen.has(key)) return;
    seen.add(key);
    columns.push({ key, label, core, def });
  };
  add('name', CORE_LABELS.name, true);
  for (const c of catCodes) {
    for (const f of (cats.get(c) as Category).fields) {
      if (f.confidential && !canConfidential) continue;
      add(f.core ? f.key : `attrs.${f.key}`, f.label + (f.unit ? `, ${f.unit}` : ''), !!f.core, f);
    }
  }
  const header = ['Идентификатор', 'Категория', ...columns.map((c) => c.label), 'Источник: файл', 'Источник: лист', 'Источник: строка', 'Обновлено (UTC)'];
  const aoa: unknown[][] = [header];
  for (const r of rows) {
    const attrs = json<Record<string, unknown>>(r.attrs, {});
    const cat = cats.get(r.category);
    aoa.push([
      r.uid, cat?.name ?? r.category,
      ...columns.map((c) => {
        const ownDef = cat?.fields.find((f) => (f.core ? f.key : `attrs.${f.key}`) === c.key);
        if (!ownDef && c.key !== 'name') return null;
        if (ownDef?.confidential && !canConfidential) return null;
        return displayValue(ownDef, c.core ? r[c.key] : attrs[c.key.slice(6)]);
      }),
      r.file_name ?? null, r.source_sheet ?? null, r.source_row ?? null, r.updated_at,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = header.map((h, i) => ({ wch: Math.min(60, Math.max(10, h.length + 2, i === 2 ? 40 : 0)) }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: header.length - 1 } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Объекты');
  const info = XLSX.utils.aoa_to_sheet([
    ['Цифровая информационная система ЖКХ г. Атырау'],
    ['Выгрузка сформирована', new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Atyrau' })],
    ['Записей', rows.length],
    ['Условия отбора', JSON.stringify({ category: p.category, domain: p.domain, q: p.q, filters: p.filters })],
    ['Конфиденциальные поля', canConfidential ? 'включены' : 'исключены'],
  ]);
  XLSX.utils.book_append_sheet(wb, info, 'О выгрузке');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Простая выгрузка таблицы в XLSX. */
export function sheetBuffer(name: string, header: string[], rows: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = header.map((h) => ({ wch: Math.min(80, Math.max(12, h.length + 2)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
