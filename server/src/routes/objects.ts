import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import type { Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { can, requirePerm } from '../auth/auth.ts';
import { config } from '../config.ts';
import { all, get, json, nowIso, run, tx } from '../db/db.ts';
import { categories, category, CORE_FIELDS, DOMAINS } from '../domain/categories.ts';
import type { Category, CoreField } from '../domain/categories.ts';
import { parseNumber } from '../domain/normalize.ts';
import { audit } from '../services/audit.ts';
import { linksFor, rebuildAutoLinks, RELATIONS } from '../services/links.ts';
import { allowedCategories, insertObject, logChange, presentObject, updateObject } from '../services/objects.ts';
import { exportObjects, facets, listObjects } from '../services/query.ts';
import type { ListParams } from '../services/query.ts';
import { objectIssues } from '../services/quality.ts';

export const objectsRouter = Router();

export class ValidationError extends Error {}

export const allowedFor = (req: Request) => allowedCategories(req.user!.sections);

function listParams(q: Record<string, any>): ListParams {
  let filters: Record<string, unknown> = {};
  if (q.f) {
    try {
      filters = JSON.parse(String(q.f));
    } catch {
      throw new ValidationError('Некорректный параметр фильтра');
    }
  }
  return {
    category: q.category ? String(q.category) : undefined,
    domain: q.domain ? String(q.domain) : undefined,
    q: q.q ? String(q.q).slice(0, 200) : undefined,
    filters,
    sort: q.sort ? String(q.sort) : undefined,
    order: q.order === 'desc' ? 'desc' : 'asc',
    page: Number(q.page) || 1,
    pageSize: Number(q.pageSize) || 50,
    withIssues: q.issues === '1',
    deleted: q.deleted === '1',
    addressId: q.address ? Number(q.address) : undefined,
  };
}

// ─────────────────────────── Категории ───────────────────────────

objectsRouter.get('/categories', (req, res) => {
  const allowed = allowedFor(req);
  const counts = new Map(all('SELECT category, count(*) n FROM objects WHERE deleted_at IS NULL GROUP BY category').map((r) => [r.category, r.n]));
  res.json({
    domains: Object.entries(DOMAINS).map(([code, d]) => ({ code, ...d })),
    categories: [...categories().values()].filter((c) => allowed.includes(c.code)).map((c) => ({ ...c, count: counts.get(c.code) ?? 0 })),
    relations: RELATIONS,
  });
});

// ─────────────────────────── Список ───────────────────────────

objectsRouter.get('/objects', (req, res) => {
  const p = listParams(req.query);
  if (p.deleted && !can(req, 'objects.delete')) p.deleted = false;
  const result = listObjects(p, allowedFor(req));
  const conf = can(req, 'objects.confidential');
  res.json({ ...result, items: result.items.map((r) => presentObject(r, conf)) });
});

objectsRouter.get('/objects/facets', (req, res) => {
  const p = listParams(req.query);
  if (!p.category) throw new ValidationError('Не указана категория');
  res.json(facets(p.category, allowedFor(req), p));
});

objectsRouter.get('/objects/export', requirePerm('objects.export'), (req, res) => {
  const p = listParams(req.query);
  if (p.deleted && !can(req, 'objects.delete')) p.deleted = false;
  const buf = exportObjects(p, allowedFor(req), can(req, 'objects.confidential'));
  audit(req, 'export.objects', 'objects', null, { category: p.category, q: p.q, filters: p.filters });
  const name = `zhkh-export-${p.category ?? p.domain ?? 'all'}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(buf);
});

// ─────────────────────────── Карточка ───────────────────────────

function loadObject(req: Request, uid: string, includeDeleted = false) {
  const row = get('SELECT * FROM objects WHERE uid = ?', uid);
  if (!row || !allowedFor(req).includes(row.category)) return null;
  if (row.deleted_at && !(includeDeleted && can(req, 'objects.delete'))) return null;
  return row;
}

objectsRouter.get('/objects/:uid', (req, res) => {
  const row = loadObject(req, String(req.params.uid), true);
  if (!row) {
    res.status(404).json({ error: 'Объект не найден' });
    return;
  }
  const conf = can(req, 'objects.confidential');
  const cat = category(row.category)!;
  const address = row.address_id ? get('SELECT * FROM addresses WHERE id = ?', row.address_id) : null;
  const area = address?.area_key ? get(`SELECT * FROM addresses WHERE norm_key = ?`, 'a:' + address.area_key) : null;
  const source = row.source_file_id ? get('SELECT id, file_name, sha256, uploaded_at FROM source_files WHERE id = ?', row.source_file_id) : null;
  const history = all(
    `SELECT c.id, c.action, c.changes, c.reason, c.at, c.import_id, u.full_name user_name, u.login
       FROM change_log c LEFT JOIN users u ON u.id = c.user_id WHERE c.object_id = ? ORDER BY c.at DESC, c.id DESC`, row.id,
  ).map((h) => ({ ...h, changes: conf ? json(h.changes, []) : json<any[]>(h.changes, []).map((c) => (cat.fields.find((f) => `attrs.${f.key}` === c.field)?.confidential ? { ...c, old: '•••', new: '•••' } : c)) }));
  const attachments = all('SELECT id, original_name, mime, size, description, uploaded_at, uploaded_by FROM attachments WHERE object_id = ? AND deleted_at IS NULL ORDER BY uploaded_at DESC', row.id);
  const sameAddress = row.address_id
    ? all(`SELECT uid, name, category FROM objects WHERE address_id = ? AND id != ? AND deleted_at IS NULL AND category IN (${allowedFor(req).map(() => '?').join(',')}) LIMIT 50`, row.address_id, row.id, ...allowedFor(req))
    : [];
  // для дома МЖД — сведения о лифтах (из привязанных записей «Лифты МЖД»)
  const lifts = row.category === 'mkd' && allowedFor(req).includes('mkd_lifts')
    ? all(`SELECT o.*, l.id link_id, l.status link_status, l.confidence link_confidence, l.note link_note FROM object_links l JOIN objects o ON o.id = l.from_id
            WHERE l.to_id = ? AND l.relation = 'lift_building' AND l.status != 'rejected' AND o.deleted_at IS NULL ORDER BY o.source_row`, row.id)
        .map((o) => ({ ...presentObject(o, conf), link: { id: o.link_id, status: o.link_status, confidence: o.link_confidence, note: o.link_note } }))
    : [];
  // программы по дому МЖД: термомодернизация, капремонт, благоустройство двора
  const programs = row.category === 'mkd'
    ? all(`SELECT o.*, l.relation, l.id link_id, l.status link_status, l.note link_note FROM object_links l JOIN objects o ON o.id = l.from_id
            WHERE l.to_id = ? AND l.relation IN ('thermo_building','repair_building','yard_building') AND l.status != 'rejected' AND o.deleted_at IS NULL
              AND o.category IN (${allowedFor(req).map(() => '?').join(',')}) ORDER BY l.relation, o.category, o.source_row`, row.id, ...allowedFor(req))
        .map((o) => ({ ...presentObject(o, conf), relation: o.relation, link: { id: o.link_id, status: o.link_status, note: o.link_note } }))
    : [];
  res.json({
    object: presentObject(row, conf, cat),
    lifts,
    programs,
    category: cat,
    address,
    area,
    source,
    links: linksFor(row.id).filter((l) => allowedFor(req).includes(l.category)),
    history,
    attachments,
    sameAddress,
    issues: objectIssues(row.id, row.category),
  });
});

// ─────────────────────────── Изменение ───────────────────────────

const MAX_TEXT = 2000;

/** Проверка и приведение значений к типам полей категории. */
function validateInput(cat: Category, body: any, existingAttrs: Record<string, unknown> | null, canConf: boolean) {
  const core: Partial<Record<CoreField, any>> = {};
  const attrs: Record<string, unknown> = {};
  const errors: string[] = [];
  const coerce = (label: string, type: string, v: unknown) => {
    if (v === undefined) return undefined;
    if (v === null || (typeof v === 'string' && v.trim() === '')) return null;
    if (type === 'number' || type === 'int') {
      const n = parseNumber(v);
      if (n == null) { errors.push(`«${label}»: требуется число`); return undefined; }
      if (type === 'int' && !Number.isInteger(n)) { errors.push(`«${label}»: требуется целое число`); return undefined; }
      return n;
    }
    const s = String(v).trim();
    if (s.length > MAX_TEXT) { errors.push(`«${label}»: слишком длинное значение`); return undefined; }
    return s;
  };
  const coreIn = body?.core ?? {};
  for (const k of Object.keys(coreIn)) {
    if (!(CORE_FIELDS as readonly string[]).includes(k)) { errors.push(`Неизвестное поле: ${k}`); continue; }
    const def = cat.fields.find((f) => f.key === k);
    const type = def?.type ?? (['year_built'].includes(k) ? 'int' : ['power_kva', 'length_km', 'lat', 'lon'].includes(k) ? 'number' : 'text');
    const v = coerce(def?.label ?? k, type, coreIn[k]);
    if (v !== undefined) core[k as CoreField] = v;
  }
  if (core.lat != null && (core.lat < 40 || core.lat > 56)) errors.push('Широта вне территории Казахстана (40–56)');
  if (core.lon != null && (core.lon < 46 || core.lon > 88)) errors.push('Долгота вне территории Казахстана (46–88)');
  if ((core.lat == null) !== (core.lon == null) && ('lat' in core || 'lon' in core)) errors.push('Укажите обе координаты: широту и долготу');
  if (core.year_built != null && (core.year_built < 1800 || core.year_built > new Date().getFullYear() + 5)) errors.push('Год постройки вне допустимого диапазона');
  const attrsIn = body?.attrs ?? {};
  for (const k of Object.keys(attrsIn)) {
    const def = cat.fields.find((f) => f.key === k && !f.core);
    if (!def && !(existingAttrs && k in existingAttrs)) { errors.push(`Поле «${k}» не предусмотрено для категории`); continue; }
    if (def?.confidential && !canConf) continue;
    const v = coerce(def?.label ?? k, def?.type ?? 'text', attrsIn[k]);
    if (v !== undefined) attrs[k] = v;
  }
  if (errors.length) throw new ValidationError(errors.join('; '));
  return { core, attrs };
}

objectsRouter.post('/objects', requirePerm('objects.edit'), (req, res) => {
  const cat = category(String(req.body?.category ?? ''));
  if (!cat || !allowedFor(req).includes(cat.code)) throw new ValidationError('Категория не найдена или недоступна');
  const { core, attrs } = validateInput(cat, req.body, null, can(req, 'objects.confidential'));
  if (!core.name && !core.address_raw) throw new ValidationError('Укажите наименование или адрес');
  for (const f of cat.fields.filter((x) => x.required)) {
    const v = f.core ? core[f.key as CoreField] : attrs[f.key];
    if (v == null) throw new ValidationError(`Заполните обязательное поле «${f.label}»`);
  }
  const created = tx(() => {
    const r = insertObject({ category: cat.code, core, attrs, isPublic: false }, req.user!.id, 'manual');
    logChange(r.id, 'create', [], req.user!.id, { reason: String(req.body?.reason ?? 'Создано вручную').slice(0, 500) });
    return r;
  });
  rebuildAutoLinks();
  audit(req, 'object.create', 'object', created.uid, { category: cat.code });
  res.status(201).json(created);
});

objectsRouter.patch('/objects/:uid', requirePerm('objects.edit'), (req, res) => {
  const row = loadObject(req, String(req.params.uid));
  if (!row) {
    res.status(404).json({ error: 'Объект не найден' });
    return;
  }
  const reason = z.string().trim().min(3, 'Укажите причину изменения (не менее 3 символов)').max(500).parse(req.body?.reason ?? '');
  const cat = category(row.category)!;
  const existingAttrs = json<Record<string, unknown>>(row.attrs, {});
  const input = validateInput(cat, req.body, existingAttrs, can(req, 'objects.confidential'));
  if ('name' in input.core && !input.core.name) throw new ValidationError('Наименование не может быть пустым');
  if (req.body?.expectedUpdatedAt && req.body.expectedUpdatedAt !== row.updated_at) {
    res.status(409).json({ error: 'Запись была изменена другим пользователем. Обновите страницу и повторите.' });
    return;
  }
  const changes = tx(() => {
    const ch = updateObject(row.id, input, req.user!.id, { via: 'manual' });
    if (ch.length) logChange(row.id, 'update', ch, req.user!.id, { reason });
    if (typeof req.body?.is_public === 'boolean' && can(req, 'settings.manage')) run('UPDATE objects SET is_public = ? WHERE id = ?', req.body.is_public ? 1 : 0, row.id);
    return ch;
  });
  if (changes.length) {
    rebuildAutoLinks();
    audit(req, 'object.update', 'object', row.uid, { fields: changes.map((c) => c.field), reason });
  }
  res.json({ changes: changes.length });
});

objectsRouter.delete('/objects/:uid', requirePerm('objects.delete'), (req, res) => {
  const row = loadObject(req, String(req.params.uid));
  if (!row) {
    res.status(404).json({ error: 'Объект не найден' });
    return;
  }
  const reason = z.string().trim().min(3, 'Укажите причину удаления').max(500).parse(req.body?.reason ?? '');
  tx(() => {
    run('UPDATE objects SET deleted_at = ?, deleted_by = ?, delete_reason = ? WHERE id = ?', nowIso(), req.user!.id, reason, row.id);
    logChange(row.id, 'delete', [], req.user!.id, { reason });
  });
  rebuildAutoLinks();
  audit(req, 'object.delete', 'object', row.uid, { reason });
  res.json({ ok: true });
});

objectsRouter.post('/objects/:uid/restore', requirePerm('objects.delete'), (req, res) => {
  const row = loadObject(req, String(req.params.uid), true);
  if (!row?.deleted_at) {
    res.status(404).json({ error: 'Удалённый объект не найден' });
    return;
  }
  tx(() => {
    run('UPDATE objects SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL, updated_at = ?, updated_by = ?, updated_via = ? WHERE id = ?', nowIso(), req.user!.id, 'manual', row.id);
    logChange(row.id, 'restore', [], req.user!.id, { reason: String(req.body?.reason ?? 'Восстановлено').slice(0, 500) });
  });
  rebuildAutoLinks();
  audit(req, 'object.restore', 'object', row.uid);
  res.json({ ok: true });
});

// ─────────────────────────── Связи ───────────────────────────

objectsRouter.post('/objects/:uid/links', requirePerm('links.manage'), (req, res) => {
  const row = loadObject(req, String(req.params.uid));
  const body = z.object({ to: z.string().min(3).max(40), relation: z.string().max(40).default('related'), note: z.string().max(500).optional() }).parse(req.body);
  const target = loadObject(req, body.to);
  if (!row || !target) {
    res.status(404).json({ error: 'Объект не найден' });
    return;
  }
  if (row.id === target.id) throw new ValidationError('Нельзя связать объект с самим собой');
  if (!RELATIONS[body.relation]) throw new ValidationError('Неизвестный тип связи');
  run(`INSERT INTO object_links(from_id, to_id, relation, method, confidence, status, note, created_by, reviewed_by, reviewed_at)
       VALUES(?,?,?,?,1,'confirmed',?,?,?,datetime('now'))
       ON CONFLICT(from_id, to_id, relation) DO UPDATE SET status = 'confirmed', reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at`,
  row.id, target.id, body.relation, 'manual', body.note ?? null, req.user!.id, req.user!.id);
  audit(req, 'link.create', 'object', row.uid, { to: target.uid, relation: body.relation });
  res.status(201).json({ ok: true });
});

objectsRouter.patch('/links/:id', requirePerm('links.manage'), (req, res) => {
  const body = z.object({ status: z.enum(['confirmed', 'rejected', 'suggested']) }).parse(req.body);
  const link = get('SELECT l.*, o.category c1, t.category c2 FROM object_links l JOIN objects o ON o.id = l.from_id JOIN objects t ON t.id = l.to_id WHERE l.id = ?', Number(req.params.id));
  if (!link || !allowedFor(req).includes(link.c1) || !allowedFor(req).includes(link.c2)) {
    res.status(404).json({ error: 'Связь не найдена' });
    return;
  }
  run(`UPDATE object_links SET status = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`, body.status, req.user!.id, link.id);
  audit(req, 'link.review', 'link', link.id, { status: body.status });
  res.json({ ok: true });
});

objectsRouter.delete('/links/:id', requirePerm('links.manage'), (req, res) => {
  const link = get('SELECT * FROM object_links WHERE id = ?', Number(req.params.id));
  if (!link || link.method !== 'manual') {
    res.status(400).json({ error: 'Удалить можно только связь, созданную вручную (автоматические — отклоняются)' });
    return;
  }
  run('DELETE FROM object_links WHERE id = ?', link.id);
  audit(req, 'link.delete', 'link', link.id);
  res.json({ ok: true });
});

// ─────────────────────────── Вложения ───────────────────────────

const ATTACH_TYPES: Record<string, { mime: string; magic?: (b: Buffer) => boolean }> = {
  '.pdf': { mime: 'application/pdf', magic: (b) => b.subarray(0, 5).toString() === '%PDF-' },
  '.jpg': { mime: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  '.jpeg': { mime: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  '.png': { mime: 'image/png', magic: (b) => b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' },
  '.webp': { mime: 'image/webp', magic: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  '.xlsx': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  '.doc': { mime: 'application/msword', magic: (b) => b.subarray(0, 4).toString('hex') === 'd0cf11e0' },
  '.xls': { mime: 'application/vnd.ms-excel', magic: (b) => b.subarray(0, 4).toString('hex') === 'd0cf11e0' },
};

const attachUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxAttachmentMb * 1024 * 1024, files: 1 } });

objectsRouter.post('/objects/:uid/attachments', requirePerm('attachments.upload'), attachUpload.single('file'), (req, res) => {
  const row = loadObject(req, String(req.params.uid));
  if (!row || !req.file) {
    res.status(400).json({ error: row ? 'Файл не передан' : 'Объект не найден' });
    return;
  }
  // multer декодирует имя как latin1 — восстанавливаем UTF-8
  const original = Buffer.from(req.file.originalname, 'latin1').toString('utf8').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 200);
  const ext = path.extname(original).toLowerCase();
  const t = ATTACH_TYPES[ext];
  if (!t) throw new ValidationError(`Недопустимый тип файла. Разрешены: ${Object.keys(ATTACH_TYPES).join(', ')}`);
  if (t.magic && !t.magic(req.file.buffer)) throw new ValidationError('Содержимое файла не соответствует расширению');
  const stored = crypto.randomBytes(16).toString('hex') + ext;
  fs.writeFileSync(path.join(config.attachmentsDir, stored), req.file.buffer);
  const sha = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  const id = run('INSERT INTO attachments(object_id, original_name, stored_name, mime, size, sha256, description, uploaded_by) VALUES(?,?,?,?,?,?,?,?)',
    row.id, original, stored, t.mime, req.file.size, sha, String(req.body?.description ?? '').slice(0, 500) || null, req.user!.id).lastId;
  logChange(row.id, 'update', [{ field: 'attachment', label: 'Вложение', old: null, new: original }], req.user!.id, { reason: 'Загружен файл' });
  audit(req, 'attachment.upload', 'object', row.uid, { file: original, size: req.file.size });
  res.status(201).json({ id });
});

objectsRouter.get('/attachments/:id', (req, res) => {
  const a = get('SELECT a.*, o.category, o.uid FROM attachments a JOIN objects o ON o.id = a.object_id WHERE a.id = ? AND a.deleted_at IS NULL', Number(req.params.id));
  if (!a || !allowedFor(req).includes(a.category)) {
    res.status(404).json({ error: 'Файл не найден' });
    return;
  }
  const inline = req.query.inline === '1' && a.mime.startsWith('image/');
  res.setHeader('Content-Type', a.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.original_name)}`);
  res.sendFile(path.join(config.attachmentsDir, a.stored_name));
});

objectsRouter.delete('/attachments/:id', requirePerm('attachments.upload'), (req, res) => {
  const a = get('SELECT a.*, o.category, o.uid FROM attachments a JOIN objects o ON o.id = a.object_id WHERE a.id = ? AND a.deleted_at IS NULL', Number(req.params.id));
  if (!a || !allowedFor(req).includes(a.category)) {
    res.status(404).json({ error: 'Файл не найден' });
    return;
  }
  // файл на диске сохраняется (восстановимо администратором), запись помечается удалённой
  run(`UPDATE attachments SET deleted_at = datetime('now') WHERE id = ?`, a.id);
  logChange(a.object_id, 'update', [{ field: 'attachment', label: 'Вложение', old: a.original_name, new: null }], req.user!.id, { reason: 'Удалён файл' });
  audit(req, 'attachment.delete', 'object', a.uid, { file: a.original_name });
  res.json({ ok: true });
});
