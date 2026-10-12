import { Router } from 'express';
import { all, get, getSetting, json } from '../db/db.ts';
import { categories } from '../domain/categories.ts';
import { buildWhere } from '../services/query.ts';

/**
 * Публичная версия: доступна, только если администратор включил её в настройках.
 * Отдаются только категории и поля, явно разрешённые к публикации; конфиденциальные поля исключены всегда.
 */
export const publicRouter = Router();

function publicCategories() {
  return [...categories().values()].filter((c) => c.is_public && c.public_fields.length);
}

publicRouter.use((_req, res, next) => {
  if (!getSetting('public_enabled', false)) {
    res.status(404).json({ error: 'Публичная версия отключена' });
    return;
  }
  next();
});

publicRouter.get('/info', (_req, res) => {
  res.json({
    systemName: getSetting('system_name', 'Цифровая информационная система ЖКХ города Атырау'),
    categories: publicCategories().map((c) => ({
      code: c.code, name: c.name,
      fields: c.public_fields.map((k) => c.fields.find((f) => f.key === k && !f.confidential)).filter(Boolean).map((f) => ({ key: f!.key, label: f!.label, unit: f!.unit, valueMap: f!.valueMap })),
    })),
  });
});

publicRouter.get('/objects', (req, res) => {
  const cat = publicCategories().find((c) => c.code === req.query.category);
  if (!cat) {
    res.status(404).json({ error: 'Категория не опубликована' });
    return;
  }
  const { where, args } = buildWhere({ category: cat.code, q: req.query.q ? String(req.query.q).slice(0, 100) : undefined }, [cat.code]);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Number(req.query.pageSize) || 50, 200);
  const total = get(`SELECT count(*) n FROM objects o WHERE ${where}`, ...args)!.n;
  const fields = cat.public_fields.map((k) => cat.fields.find((f) => f.key === k && !f.confidential)).filter((f) => !!f);
  const rows = all(`SELECT o.* FROM objects o WHERE ${where} ORDER BY o.name LIMIT ? OFFSET ?`, ...args, pageSize, (page - 1) * pageSize);
  res.json({
    total, page, pageSize,
    items: rows.map((r) => {
      const attrs = json<Record<string, unknown>>(r.attrs, {});
      const out: Record<string, unknown> = { uid: r.uid };
      for (const f of fields) out[f!.key] = f!.core ? r[f!.key] : attrs[f!.key] ?? null;
      return out;
    }),
  });
});
