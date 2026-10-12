import { Router } from 'express';
import { requirePerm } from '../auth/auth.ts';
import { all, get } from '../db/db.ts';
import type { Row } from '../db/db.ts';
import { categories } from '../domain/categories.ts';
import { fold } from '../domain/normalize.ts';
import { audit } from '../services/audit.ts';
import { dashboard } from '../services/dashboard.ts';
import { computeQuality, ISSUE_TYPES } from '../services/quality.ts';
import { buildWhere, sheetBuffer } from '../services/query.ts';
import { allowedFor } from './objects.ts';

export const exploreRouter = Router();

const inList = (a: unknown[]) => (a.length ? a.map(() => '?').join(',') : "''");

// ─────────────────────────── Глобальный поиск ───────────────────────────

exploreRouter.get('/search', (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 200);
  const limit = Math.min(Number(req.query.limit) || 6, 50);
  if (q.length < 2) {
    res.json({ q, groups: [], addresses: [], total: 0 });
    return;
  }
  const allowed = allowedFor(req);
  const { where, args } = buildWhere({ q }, allowed);
  const counts = all(`SELECT o.category, count(*) n FROM objects o WHERE ${where} GROUP BY o.category ORDER BY n DESC`, ...args);
  const cats = categories();
  const f = fold(q);
  const groups = counts.map((c) => {
    const { where: w2, args: a2 } = buildWhere({ q, category: c.category }, allowed);
    // точные совпадения номера/идентификатора — выше
    const items = all(
      `SELECT o.uid, o.name, o.code, o.address_raw, o.status, o.category FROM objects o WHERE ${w2}
        ORDER BY (lower(o.uid) = ?) DESC, (o.code = ?) DESC, length(o.name) LIMIT ?`, ...a2, f, q, limit);
    return { category: c.category, name: cats.get(c.category)?.name, short_name: cats.get(c.category)?.short_name, count: c.n, items };
  });
  const tokens = f.split(/\s+/).filter(Boolean);
  const addresses = all(`SELECT id, kind, display, norm_key, is_settlement FROM addresses`)
    .filter((a) => tokens.every((t) => fold(a.display).includes(t) || a.norm_key.includes(t)))
    .slice(0, 300);
  const addrCounts = addressCounts(addresses.map((a) => a.id), allowed);
  res.json({
    q,
    total: counts.reduce((s, c) => s + c.n, 0),
    groups,
    addresses: addresses.map((a) => ({ ...a, count: addrCounts.get(a.id) ?? 0 })).filter((a) => a.count > 0).slice(0, limit),
  });
});

// ─────────────────────────── Адресный справочник ───────────────────────────

function addressCounts(ids: number[], allowed: string[]): Map<number, number> {
  const m = new Map<number, number>();
  if (!ids.length) return m;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const r of all(
      `SELECT address_id id, count(*) n FROM objects WHERE deleted_at IS NULL AND address_id IN (${inList(chunk)}) AND category IN (${inList(allowed)}) GROUP BY address_id`,
      ...chunk, ...allowed)) m.set(r.id, r.n);
  }
  return m;
}

exploreRouter.get('/addresses', (req, res) => {
  const allowed = allowedFor(req);
  const q = fold(String(req.query.q ?? '')).slice(0, 100);
  const kind = req.query.kind === 'building' || req.query.kind === 'area' ? String(req.query.kind) : null;
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Number(req.query.pageSize) || 50, 200);
  const rows = all(`SELECT * FROM addresses ${kind ? 'WHERE kind = ?' : ''} ORDER BY display`, ...(kind ? [kind] : []));
  const direct = addressCounts(rows.map((r) => r.id), allowed);
  // для территорий — число объектов в зданиях этой улицы/микрорайона
  const inBuildings = new Map<string, number>();
  for (const r of all(
    `SELECT a.area_key k, count(*) n FROM objects o JOIN addresses a ON a.id = o.address_id
      WHERE o.deleted_at IS NULL AND a.kind = 'building' AND o.category IN (${inList(allowed)}) GROUP BY a.area_key`, ...allowed)) inBuildings.set(r.k, r.n);
  const tokens = q.split(/\s+/).filter(Boolean);
  const list = rows
    .map((r): Row => ({
      ...r,
      objects: direct.get(r.id) ?? 0,
      objects_in_buildings: r.kind === 'area' ? inBuildings.get(r.norm_key.slice(2)) ?? 0 : 0,
    }))
    .filter((r) => r.objects + r.objects_in_buildings > 0)
    .filter((r) => !tokens.length || tokens.every((t) => fold(r.display).includes(t) || r.norm_key.includes(t)))
    .filter((r) => req.query.settlement !== '1' || r.is_settlement);
  res.json({ total: list.length, page, pageSize, items: list.slice((page - 1) * pageSize, page * pageSize) });
});

exploreRouter.get('/addresses/:id', (req, res) => {
  const allowed = allowedFor(req);
  const a = get('SELECT * FROM addresses WHERE id = ?', Number(req.params.id));
  if (!a) {
    res.status(404).json({ error: 'Адрес не найден' });
    return;
  }
  const cols = 'o.uid, o.name, o.category, o.code, o.address_raw, o.status, o.year_built, o.power_kva, o.length_km, o.address_id';
  const objects = all(`SELECT ${cols} FROM objects o WHERE o.address_id = ? AND o.deleted_at IS NULL AND o.category IN (${inList(allowed)}) ORDER BY o.category, o.name`, a.id, ...allowed);
  const buildings = a.kind === 'area'
    ? all(`SELECT ${cols}, b.display address_display FROM objects o JOIN addresses b ON b.id = o.address_id
            WHERE b.kind = 'building' AND b.area_key = ? AND o.deleted_at IS NULL AND o.category IN (${inList(allowed)}) ORDER BY b.display`, a.norm_key.slice(2), ...allowed)
    : [];
  const area = a.kind === 'building' && a.area_key ? get('SELECT * FROM addresses WHERE norm_key = ?', 'a:' + a.area_key) : null;
  // варианты написания этого адреса в разных источниках — для проверки совпадений
  const variants = all(`SELECT DISTINCT o.address_raw v, o.category FROM objects o WHERE o.address_id = ? AND o.deleted_at IS NULL`, a.id);
  res.json({ address: a, area, objects, buildings, variants });
});

// ─────────────────────────── Фидеры ───────────────────────────

exploreRouter.get('/feeders', (req, res) => {
  const allowed = allowedFor(req).filter((c) => ['el_vl', 'el_kl', 'el_tp'].includes(c));
  const rows = all(`SELECT uid, name, category, length_km, address_raw, json_extract(attrs, '$.feeders') feeders, json_extract(attrs, '$.voltage_class') vc
                      FROM objects WHERE deleted_at IS NULL AND category IN (${inList(allowed)}) AND json_extract(attrs, '$.feeders') IS NOT NULL`, ...allowed);
  const map = new Map<string, any>();
  for (const r of rows) {
    for (const f of String(r.feeders).split(/,\s*/)) {
      const e = map.get(f) ?? { feeder: f, lines: 0, tps: 0, km: 0, areas: new Set<string>(), objects: [] as any[] };
      if (r.category === 'el_tp') e.tps++;
      else { e.lines++; e.km += r.length_km ?? 0; }
      if (r.address_raw) e.areas.add(r.address_raw.trim());
      e.objects.push({ uid: r.uid, name: r.name, category: r.category, length_km: r.length_km, voltage_class: r.vc, address_raw: r.address_raw });
      map.set(f, e);
    }
  }
  res.json({
    note: 'Номера фидеров извлечены из наименований объектов («Ф№196Ш», «Фидер №207 Д», «ф.190»). Отдельного реестра фидеров в исходных данных нет.',
    items: [...map.values()]
      .map((e) => ({ ...e, km: Math.round(e.km * 1000) / 1000, areas: [...e.areas].slice(0, 10) }))
      .sort((a, b) => a.feeder.localeCompare(b.feeder, 'ru', { numeric: true })),
  });
});

// ─────────────────────────── Карта ───────────────────────────

exploreRouter.get('/map', (req, res) => {
  const allowed = allowedFor(req);
  const points = all(`SELECT uid, name, category, status, address_raw, lat, lon FROM objects WHERE deleted_at IS NULL AND lat IS NOT NULL AND lon IS NOT NULL AND category IN (${inList(allowed)}) LIMIT 20000`, ...allowed);
  const withoutCoords = all(`SELECT category, count(*) n FROM objects WHERE deleted_at IS NULL AND (lat IS NULL OR lon IS NULL) AND category IN (${inList(allowed)}) GROUP BY category`, ...allowed);
  res.json({ points, withoutCoords });
});

// ─────────────────────────── Главная панель ───────────────────────────

exploreRouter.get('/status', (req, res) => {
  const allowed = allowedFor(req);
  res.json({
    lastUpdate: get(`SELECT max(updated_at) t FROM objects WHERE category IN (${inList(allowed)})`, ...allowed)?.t ?? null,
    lastImport: get(`SELECT max(applied_at) t FROM imports WHERE status = 'applied'`)?.t ?? null,
  });
});

exploreRouter.get('/dashboard', (req, res) => {
  res.json(dashboard(allowedFor(req)));
});

// ─────────────────────────── Качество данных ───────────────────────────

exploreRouter.get('/quality', requirePerm('quality.view'), (req, res) => {
  const q = computeQuality(allowedFor(req));
  let issues = q.issues;
  if (req.query.type) issues = issues.filter((i) => i.type === req.query.type);
  if (req.query.category) issues = issues.filter((i) => i.category === req.query.category);
  if (req.query.severity) issues = issues.filter((i) => i.severity === req.query.severity);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Number(req.query.pageSize) || 50, 500);
  res.json({
    summary: q.summary,
    totals: q.totals,
    completeness: q.completeness,
    controlTotals: q.controlTotals,
    issues: { total: issues.length, page, pageSize, items: issues.slice((page - 1) * pageSize, page * pageSize) },
  });
});

exploreRouter.get('/quality/export', requirePerm('quality.view'), (req, res) => {
  const q = computeQuality(allowedFor(req));
  const cats = categories();
  const sev: Record<string, string> = { error: 'Ошибка', warning: 'Предупреждение', info: 'Информация' };
  const buf = sheetBuffer('Замечания', ['Тип', 'Важность', 'Категория', 'Идентификатор', 'Наименование', 'Поле', 'Описание'],
    q.issues.map((i) => [ISSUE_TYPES[i.type] ?? i.type, sev[i.severity], i.category ? cats.get(i.category)?.name ?? i.category : '', i.uid ?? '', i.name ?? '', i.field ? q.fieldLabel(i.category ?? '', i.field) : '', i.message]));
  audit(req, 'export.quality', 'quality', null, { issues: q.issues.length });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="zhkh-quality-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.send(buf);
});

