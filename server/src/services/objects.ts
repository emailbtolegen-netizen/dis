import { all, get, getMeta, json, nowIso, run, setMeta } from '../db/db.ts';
import type { Row } from '../db/db.ts';
import { category, CORE_FIELDS, DOMAINS, fieldLabel } from '../domain/categories.ts';
import type { Category, CoreField } from '../domain/categories.ts';
import { fold, parseAddress, parseArea, searchText, streetDisplay } from '../domain/normalize.ts';
import type { Msg } from '../import/types.ts';

export interface ObjectData {
  core: Partial<Record<CoreField, any>>;
  attrs: Record<string, unknown>;
}

export interface FieldChange {
  field: string;
  label: string;
  old: unknown;
  new: unknown;
}

// ───────────────────────────── UID ─────────────────────────────

export function allocateUid(prefix: string): string {
  const key = `uid_seq:${prefix}`;
  const n = Number(getMeta(key) ?? '0') + 1;
  setMeta(key, String(n));
  return `ATR-${prefix}-${String(n).padStart(5, '0')}`;
}

// ─────────────────────────── Адреса ───────────────────────────

function upsertAddress(normKey: string, kind: 'building' | 'area', display: string, extra: { area_key?: string | null; street?: string | null; house?: string | null; is_settlement?: boolean } = {}): number {
  const existing = get('SELECT id FROM addresses WHERE norm_key = ?', normKey);
  if (existing) return existing.id;
  return run(
    'INSERT INTO addresses(norm_key, kind, display, area_key, street, house, is_settlement) VALUES(?,?,?,?,?,?,?)',
    normKey, kind, display, extra.area_key ?? null, extra.street ?? null, extra.house ?? null, extra.is_settlement ? 1 : 0,
  ).lastId;
}

/** Привязка объекта к адресному справочнику. Для энергообъектов «место нахождения» — территория (микрорайон/посёлок). */
export function resolveAddress(cat: Category, addressRaw: string | null | undefined): number | null {
  if (!addressRaw || !String(addressRaw).trim()) return null;
  const raw = String(addressRaw).trim();
  if (cat.domain === 'energy') {
    const a = parseArea(raw);
    return a.areaKey ? upsertAddress('a:' + a.areaKey, 'area', raw, { is_settlement: a.isSettlement }) : null;
  }
  const p = parseAddress(raw);
  if (p.buildingKey) {
    upsertAddress('a:' + p.areaKey, 'area', streetDisplay(raw), { is_settlement: p.isSettlement });
    return upsertAddress('b:' + p.buildingKey, 'building', raw, { area_key: p.areaKey, street: p.street, house: p.house, is_settlement: p.isSettlement });
  }
  return p.areaKey ? upsertAddress('a:' + p.areaKey, 'area', raw, { is_settlement: p.isSettlement }) : null;
}

// ─────────────────────────── Поиск ───────────────────────────

export function buildSearchText(cat: Category, uid: string, core: Record<string, any>, attrs: Record<string, unknown>): string {
  const confidential = new Set(cat.fields.filter((f) => f.confidential).map((f) => f.key));
  const parts: unknown[] = [uid, cat.short_name, core.name, core.code, core.address_raw, core.status, core.balance_holder, core.voltage, core.notes];
  if (core.code && cat.code === 'el_tp') parts.push(`тп ${core.code}`);
  if (core.code && cat.code === 'el_rp') parts.push(`рп ${core.code} рп-${core.code}`);
  if (core.code && cat.code === 'el_ps') parts.push(`пс ${core.code} пс-${core.code}`);
  for (const [k, v] of Object.entries(attrs)) {
    if (confidential.has(k) || v == null || typeof v === 'boolean') continue;
    if (k === 'feeders' && v) parts.push(String(v).split(/,\s*/).map((f) => `фидер ${f} ф-${f}`).join(' '));
    parts.push(v);
  }
  return searchText(parts);
}

// ─────────────────────── Чтение и сравнение ───────────────────────

export function objectData(row: Row): ObjectData {
  const core: Record<string, any> = {};
  for (const k of CORE_FIELDS) core[k] = row[k] ?? null;
  return { core, attrs: json(row.attrs, {}) };
}

function same(a: unknown, b: unknown): boolean {
  const na = a === '' || a === undefined ? null : a;
  const nb = b === '' || b === undefined ? null : b;
  if (typeof na === 'number' && typeof nb === 'number') return Math.abs(na - nb) < 1e-9;
  return JSON.stringify(na) === JSON.stringify(nb);
}

/** Различия между текущим объектом и новыми значениями (только по переданным полям). */
export function diffData(cat: Category | undefined, current: ObjectData, next: ObjectData): FieldChange[] {
  const out: FieldChange[] = [];
  const cur = current.core as Record<string, any>;
  for (const [k, v] of Object.entries(next.core)) {
    if (!same(cur[k], v)) out.push({ field: k, label: fieldLabel(cat, k), old: cur[k] ?? null, new: v ?? null });
  }
  for (const [k, v] of Object.entries(next.attrs)) {
    if (!same(current.attrs[k], v)) out.push({ field: `attrs.${k}`, label: fieldLabel(cat, k), old: current.attrs[k] ?? null, new: v ?? null });
  }
  return out;
}

// ─────────────────────────── Запись ───────────────────────────

export interface InsertInput extends ObjectData {
  category: string;
  raw?: Record<string, unknown> | null;
  issues?: Msg[];
  naturalKey?: string | null;
  source?: { fileId: number; sheet: string; row: number; importId: number } | null;
  isPublic?: boolean;
}

export function insertObject(input: InsertInput, userId: number | null, via: 'import' | 'manual', stamp = nowIso()): { id: number; uid: string } {
  const cat = category(input.category);
  if (!cat) throw new Error(`Категория ${input.category} не найдена`);
  const uid = allocateUid(cat.uid_prefix);
  const core = { ...input.core } as Record<string, any>;
  if (!core.name) core.name = core.address_raw ?? 'Без наименования';
  const addressId = resolveAddress(cat, core.address_raw);
  const r = run(
    `INSERT INTO objects(uid, category, name, code, address_raw, address_id, status, balance_holder, year_built, voltage, power_kva, length_km,
      lat, lon, attrs, raw, issues, notes, is_public, natural_key, source_file_id, source_sheet, source_row, source_import_id, search_text,
      created_at, created_by, updated_at, updated_by, updated_via)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    uid, cat.code, core.name, core.code ?? null, core.address_raw ?? null, addressId, core.status ?? null, core.balance_holder ?? null,
    core.year_built ?? null, core.voltage ?? null, core.power_kva ?? null, core.length_km ?? null, core.lat ?? null, core.lon ?? null,
    JSON.stringify(input.attrs ?? {}), input.raw ? JSON.stringify(input.raw) : null, JSON.stringify(input.issues ?? []), core.notes ?? null,
    input.isPublic ? 1 : 0, input.naturalKey ?? null, input.source?.fileId ?? null, input.source?.sheet ?? null, input.source?.row ?? null,
    input.source?.importId ?? null, buildSearchText(cat, uid, core, input.attrs ?? {}), stamp, userId, stamp, userId, via,
  );
  return { id: r.lastId, uid };
}

export interface UpdateOptions {
  via: 'import' | 'manual' | 'rollback';
  stamp?: string;
  raw?: Record<string, unknown> | null;
  issues?: Msg[];
  naturalKey?: string | null;
  source?: { fileId: number | null; sheet: string | null; row: number | null; importId: number | null } | null;
}

/** Обновление объекта: только переданные поля; attrs объединяются. Возвращает список изменений. */
export function updateObject(id: number, next: ObjectData, userId: number | null, opts: UpdateOptions): FieldChange[] {
  const row = get('SELECT * FROM objects WHERE id = ?', id);
  if (!row) throw new Error('Объект не найден');
  const cat = category(row.category)!;
  const current = objectData(row);
  const changes = diffData(cat, current, next);
  const core = { ...current.core, ...next.core };
  const attrs = { ...current.attrs, ...next.attrs };
  const stamp = opts.stamp ?? nowIso();
  const addressId = 'address_raw' in next.core ? resolveAddress(cat, core.address_raw) : row.address_id;
  const sets: string[] = [];
  const params: any[] = [];
  const set = (col: string, v: any) => { sets.push(`${col} = ?`); params.push(v); };
  for (const k of CORE_FIELDS) if (k in next.core) set(k, core[k] ?? null);
  set('attrs', JSON.stringify(attrs));
  set('address_id', addressId);
  set('search_text', buildSearchText(cat, row.uid, core, attrs));
  if (opts.raw !== undefined) set('raw', opts.raw ? JSON.stringify(opts.raw) : null);
  if (opts.issues !== undefined) set('issues', JSON.stringify(opts.issues));
  if (opts.naturalKey !== undefined) set('natural_key', opts.naturalKey);
  if (opts.source) {
    set('source_file_id', opts.source.fileId);
    set('source_sheet', opts.source.sheet);
    set('source_row', opts.source.row);
    set('source_import_id', opts.source.importId);
  }
  if (changes.length || opts.via !== 'manual') {
    set('updated_at', stamp);
    set('updated_by', userId);
    set('updated_via', opts.via);
  }
  params.push(id);
  run(`UPDATE objects SET ${sets.join(', ')} WHERE id = ?`, ...params);
  return changes;
}

export function logChange(objectId: number, action: string, changes: FieldChange[] | unknown[], userId: number | null, opts: { reason?: string | null; importId?: number | null; at?: string } = {}): void {
  run('INSERT INTO change_log(object_id, import_id, user_id, action, changes, reason, at) VALUES(?,?,?,?,?,?,?)',
    objectId, opts.importId ?? null, userId, action, JSON.stringify(changes), opts.reason ?? null, opts.at ?? nowIso());
}

// ─────────────────────── Права на разделы ───────────────────────

export function allowedCategories(sections: string[]): string[] {
  const out: string[] = [];
  for (const r of all('SELECT code, domain FROM categories')) {
    if (sections.includes('*') || sections.includes(r.domain)) out.push(r.code);
  }
  return out;
}

export function domainName(code: string): string {
  return DOMAINS[code]?.name ?? code;
}

/** Представление объекта для API: скрытие конфиденциальных полей, если нет права. */
export function presentObject(row: Row, canConfidential: boolean, cat = category(row.category)): Row {
  const attrs = json<Record<string, unknown>>(row.attrs, {});
  const hidden: string[] = [];
  if (!canConfidential && cat) {
    for (const f of cat.fields) {
      if (f.confidential && attrs[f.key] != null) {
        attrs[f.key] = null;
        hidden.push(f.key);
      }
    }
  }
  const { search_text: _s, raw, issues, ...rest } = row;
  return { ...rest, attrs, hidden_fields: hidden, issues: json(issues, []), raw: raw === undefined ? undefined : canConfidential ? json(raw, null) : redactRaw(json(raw, null), cat) };
}

/** В исходной строке скрываются столбцы, соответствующие конфиденциальным полям. */
function redactRaw(raw: Record<string, unknown> | null, cat: Category | undefined): Record<string, unknown> | null {
  if (!raw || !cat) return raw;
  const sources = cat.fields.filter((f) => f.confidential && f.source).map((f) => fold(f.source!.split(',')[0]));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = sources.some((s) => s && fold(k).includes(s)) ? '••• скрыто' : v;
  return out;
}
