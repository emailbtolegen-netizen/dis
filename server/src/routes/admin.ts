import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { destroyUserSessions, hashPassword, passwordProblem, PERMISSIONS, requirePerm, roleList } from '../auth/auth.ts';
import { config } from '../config.ts';
import { all, get, getSetting, json, run, setSetting, tx } from '../db/db.ts';
import { categories, category, CORE_FIELDS, DOMAINS, invalidateCategories } from '../domain/categories.ts';
import type { FieldDef } from '../domain/categories.ts';
import { applyImport, createPreview, discardImport, inspectSourceFile, rollbackImport, storeSourceFile } from '../import/service.ts';
import { audit, AUDIT_ACTIONS } from '../services/audit.ts';
import { backupPath, createBackup, listBackups, restoreBackup } from '../services/backup.ts';
import { sheetBuffer } from '../services/query.ts';
import { ValidationError } from './objects.ts';

export const adminRouter = Router();

// ─────────────────────────── Импорт ───────────────────────────

const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxImportMb * 1024 * 1024, files: 1 } });

adminRouter.post('/imports/upload', requirePerm('import.manage'), importUpload.single('file'), (req, res) => {
  if (!req.file) throw new ValidationError('Файл не передан');
  const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const id = storeSourceFile(req.file.buffer, name, req.user!.id);
  audit(req, 'import.upload', 'source_file', id, { file: name, size: req.file.size });
  res.status(201).json(inspectSourceFile(id));
});

adminRouter.get('/imports/files/:id', requirePerm('import.manage'), (req, res) => {
  res.json(inspectSourceFile(Number(req.params.id)));
});

adminRouter.post('/imports/preview', requirePerm('import.manage'), (req, res) => {
  const body = z.object({
    sourceFileId: z.number().int(),
    sheet: z.string().min(1),
    profile: z.string().nullable().optional(),
    options: z.any().optional(),
  }).parse(req.body);
  const id = createPreview(body.sourceFileId, body.sheet, body.profile ?? null, body.options, req.user!.id);
  audit(req, 'import.preview', 'import', id, { sheet: body.sheet, profile: body.profile });
  res.status(201).json({ id });
});

adminRouter.get('/imports', requirePerm('import.manage'), (_req, res) => {
  res.json(all(
    `SELECT i.id, i.sheet_name, i.profile, i.status, i.summary, i.created_at, i.applied_at, i.rolled_back_at, i.backup_name,
            s.file_name, s.sha256, cu.full_name created_by_name, au.full_name applied_by_name
       FROM imports i JOIN source_files s ON s.id = i.source_file_id
       LEFT JOIN users cu ON cu.id = i.created_by LEFT JOIN users au ON au.id = i.applied_by
      ORDER BY i.id DESC LIMIT 500`).map((r) => ({ ...r, summary: json(r.summary, {}) })));
});

adminRouter.get('/imports/:id', requirePerm('import.manage'), (req, res) => {
  const imp = get(`SELECT i.*, s.file_name, s.sha256, s.size FROM imports i JOIN source_files s ON s.id = i.source_file_id WHERE i.id = ?`, Number(req.params.id));
  if (!imp) {
    res.status(404).json({ error: 'Импорт не найден' });
    return;
  }
  res.json({
    ...imp,
    options: json(imp.options, {}),
    summary: json(imp.summary, {}),
    file_issues: json(imp.file_issues, []),
    control_totals: json(imp.control_totals, []),
    rollback_report: json(imp.rollback_report, null),
  });
});

adminRouter.get('/imports/:id/rows', requirePerm('import.manage'), (req, res) => {
  const id = Number(req.params.id);
  const conds = ['r.import_id = ?'];
  const args: any[] = [id];
  if (req.query.action) { conds.push('r.action = ?'); args.push(String(req.query.action)); }
  if (req.query.category) { conds.push('r.category = ?'); args.push(String(req.query.category)); }
  if (req.query.dup === '1') conds.push('r.dup_group IS NOT NULL');
  if (req.query.warn === '1') conds.push(`r.messages LIKE '%"warning"%'`);
  if (req.query.manual === '1') conds.push('r.manual_edit = 1');
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Number(req.query.pageSize) || 50, 500);
  const where = conds.join(' AND ');
  const total = get(`SELECT count(*) n FROM import_rows r WHERE ${where}`, ...args)!.n;
  const items = all(
    `SELECT r.*, o.uid, o.name object_name FROM import_rows r LEFT JOIN objects o ON o.id = r.object_id WHERE ${where} ORDER BY r.row_no IS NULL, r.row_no, r.id LIMIT ? OFFSET ?`,
    ...args, pageSize, (page - 1) * pageSize,
  ).map((r) => {
    const data = json<any>(r.data, null);
    return { ...r, data: data ? { core: data.core, attrs: data.attrs } : null, raw: data?.raw ?? null, before: undefined, diff: json(r.diff, null), messages: json(r.messages, []) };
  });
  res.json({ total, page, pageSize, items });
});

adminRouter.post('/imports/:id/decisions', requirePerm('import.manage'), (req, res) => {
  const body = z.object({
    decision: z.enum(['apply', 'skip']),
    rowIds: z.array(z.number().int()).max(100000).optional(),
    action: z.enum(['new', 'changed', 'unchanged']).optional(),
    dupOnly: z.boolean().optional(),
  }).parse(req.body);
  const imp = get('SELECT status FROM imports WHERE id = ?', Number(req.params.id));
  if (imp?.status !== 'preview') throw new ValidationError('Решения можно менять только до применения импорта');
  let changed = 0;
  tx(() => {
    if (body.rowIds?.length) {
      for (const rid of body.rowIds) changed += run(`UPDATE import_rows SET decision = ? WHERE id = ? AND import_id = ? AND action IN ('new','changed','unchanged')`, body.decision, rid, Number(req.params.id)).changes;
    } else if (body.action) {
      changed = run(`UPDATE import_rows SET decision = ? WHERE import_id = ? AND action = ? ${body.dupOnly ? 'AND dup_group IS NOT NULL' : ''}`, body.decision, Number(req.params.id), body.action).changes;
    }
  });
  res.json({ changed });
});

adminRouter.post('/imports/:id/apply', requirePerm('import.manage'), (req, res) => {
  const report = applyImport(Number(req.params.id), req.user!.id);
  audit(req, 'import.apply', 'import', String(req.params.id), report);
  res.json(report);
});

adminRouter.post('/imports/:id/rollback', requirePerm('import.manage'), (req, res) => {
  const report = rollbackImport(Number(req.params.id), req.user!.id);
  audit(req, 'import.rollback', 'import', String(req.params.id), report);
  res.json(report);
});

adminRouter.post('/imports/:id/discard', requirePerm('import.manage'), (req, res) => {
  discardImport(Number(req.params.id));
  audit(req, 'import.discard', 'import', String(req.params.id));
  res.json({ ok: true });
});

// ─────────────────────────── Пользователи ───────────────────────────

const userSchema = z.object({
  login: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/, 'Логин: латинские буквы, цифры, точка, дефис, подчёркивание'),
  full_name: z.string().trim().min(3).max(200),
  position: z.string().trim().max(200).nullable().optional(),
  role_id: z.number().int(),
  is_active: z.boolean().optional(),
  password: z.string().max(200).optional(),
});

function adminCount(excludeUserId?: number): number {
  return get(`SELECT count(*) n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'admin' AND u.is_active = 1 ${excludeUserId ? 'AND u.id != ?' : ''}`, ...(excludeUserId ? [excludeUserId] : []))!.n;
}

adminRouter.get('/users', requirePerm('users.manage'), (_req, res) => {
  res.json(all(`SELECT u.id, u.login, u.full_name, u.position, u.role_id, r.name role_name, r.code role_code, u.is_active, u.must_change_password,
                       u.last_login_at, u.created_at, u.locked_until FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.full_name`));
});

adminRouter.post('/users', requirePerm('users.manage'), (req, res) => {
  const body = userSchema.parse(req.body);
  if (!get('SELECT id FROM roles WHERE id = ?', body.role_id)) throw new ValidationError('Роль не найдена');
  if (get('SELECT id FROM users WHERE login = ?', body.login)) throw new ValidationError('Пользователь с таким логином уже существует');
  const problem = passwordProblem(body.password ?? '');
  if (problem) throw new ValidationError(problem);
  const id = run('INSERT INTO users(login, full_name, position, password_hash, role_id, is_active, must_change_password) VALUES(?,?,?,?,?,?,1)',
    body.login, body.full_name, body.position ?? null, hashPassword(body.password!), body.role_id, body.is_active === false ? 0 : 1).lastId;
  audit(req, 'user.create', 'user', id, { login: body.login, role_id: body.role_id });
  res.status(201).json({ id });
});

adminRouter.patch('/users/:id', requirePerm('users.manage'), (req, res) => {
  const id = Number(req.params.id);
  const user = get('SELECT u.*, r.code role_code FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', id);
  if (!user) {
    res.status(404).json({ error: 'Пользователь не найден' });
    return;
  }
  const body = userSchema.partial().parse(req.body);
  const newRole = body.role_id != null ? get('SELECT * FROM roles WHERE id = ?', body.role_id) : null;
  if (body.role_id != null && !newRole) throw new ValidationError('Роль не найдена');
  const losesAdmin = user.role_code === 'admin' && ((newRole && newRole.code !== 'admin') || body.is_active === false);
  if (losesAdmin && adminCount(id) === 0) throw new ValidationError('Нельзя отключить или понизить последнего администратора');
  tx(() => {
    if (body.full_name) run('UPDATE users SET full_name = ? WHERE id = ?', body.full_name, id);
    if (body.position !== undefined) run('UPDATE users SET position = ? WHERE id = ?', body.position, id);
    if (body.role_id != null) run('UPDATE users SET role_id = ? WHERE id = ?', body.role_id, id);
    if (body.is_active !== undefined) run('UPDATE users SET is_active = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?', body.is_active ? 1 : 0, id);
    if (body.password) {
      const problem = passwordProblem(body.password);
      if (problem) throw new ValidationError(problem);
      run('UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?', hashPassword(body.password), id);
    }
  });
  if (body.password || body.is_active === false || body.role_id != null) destroyUserSessions(id);
  audit(req, body.password ? 'user.password_reset' : 'user.update', 'user', id, { ...body, password: body.password ? '***' : undefined });
  res.json({ ok: true });
});

// ─────────────────────────── Роли ───────────────────────────

const roleSchema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[a-z0-9_-]+$/, 'Код роли: латинские строчные буквы, цифры, «_» и «-»'),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  permissions: z.array(z.string()).max(50),
  sections: z.array(z.string()).min(1).max(20),
});

function checkRole(body: { permissions?: string[]; sections?: string[] }) {
  for (const p of body.permissions ?? []) if (!PERMISSIONS[p]) throw new ValidationError(`Неизвестное право: ${p}`);
  for (const s of body.sections ?? []) if (s !== '*' && !DOMAINS[s]) throw new ValidationError(`Неизвестный раздел: ${s}`);
}

adminRouter.get('/roles', requirePerm('users.manage'), (_req, res) => {
  const counts = new Map(all('SELECT role_id, count(*) n FROM users GROUP BY role_id').map((r) => [r.role_id, r.n]));
  res.json({ roles: roleList().map((r) => ({ ...r, users: counts.get(r.id) ?? 0 })), permissions: PERMISSIONS, domains: DOMAINS });
});

adminRouter.post('/roles', requirePerm('roles.manage'), (req, res) => {
  const body = roleSchema.parse(req.body);
  checkRole(body);
  if (get('SELECT id FROM roles WHERE code = ?', body.code)) throw new ValidationError('Роль с таким кодом уже существует');
  const id = run('INSERT INTO roles(code, name, description, permissions, sections) VALUES(?,?,?,?,?)',
    body.code, body.name, body.description ?? null, JSON.stringify(body.permissions), JSON.stringify(body.sections)).lastId;
  audit(req, 'role.create', 'role', id, body);
  res.status(201).json({ id });
});

adminRouter.patch('/roles/:id', requirePerm('roles.manage'), (req, res) => {
  const role = get('SELECT * FROM roles WHERE id = ?', Number(req.params.id));
  if (!role) {
    res.status(404).json({ error: 'Роль не найдена' });
    return;
  }
  if (role.code === 'admin') throw new ValidationError('Роль «Администратор» не редактируется: у неё всегда полный доступ');
  const body = roleSchema.omit({ code: true }).partial().parse(req.body);
  checkRole(body);
  if (body.name) run('UPDATE roles SET name = ? WHERE id = ?', body.name, role.id);
  if (body.description !== undefined) run('UPDATE roles SET description = ? WHERE id = ?', body.description, role.id);
  if (body.permissions) run('UPDATE roles SET permissions = ? WHERE id = ?', JSON.stringify(body.permissions), role.id);
  if (body.sections) run('UPDATE roles SET sections = ? WHERE id = ?', JSON.stringify(body.sections), role.id);
  audit(req, 'role.update', 'role', role.id, body);
  res.json({ ok: true });
});

adminRouter.delete('/roles/:id', requirePerm('roles.manage'), (req, res) => {
  const role = get('SELECT * FROM roles WHERE id = ?', Number(req.params.id));
  if (!role || role.is_system) throw new ValidationError('Системные роли удалить нельзя');
  if (get('SELECT count(*) n FROM users WHERE role_id = ?', role.id)!.n > 0) throw new ValidationError('Роль назначена пользователям — сначала смените им роль');
  run('DELETE FROM roles WHERE id = ?', role.id);
  audit(req, 'role.delete', 'role', role.id, { code: role.code });
  res.json({ ok: true });
});

// ─────────────────────────── Справочники (категории) ───────────────────────────

const fieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/),
  label: z.string().trim().min(1).max(200),
  type: z.enum(['text', 'number', 'int', 'enum', 'yesno']),
  unit: z.string().max(20).optional(),
  filter: z.boolean().optional(),
  required: z.boolean().optional(),
  table: z.boolean().optional(),
  confidential: z.boolean().optional(),
});

adminRouter.post('/categories', requirePerm('categories.manage'), (req, res) => {
  const body = z.object({
    code: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/, 'Код: латинские строчные буквы, цифры и «_»'),
    domain: z.string(),
    name: z.string().trim().min(3).max(200),
    short_name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(1000).optional(),
    uid_prefix: z.string().regex(/^[A-Z]{2,5}$/, 'Префикс идентификатора: 2–5 латинских заглавных букв'),
    fields: z.array(fieldSchema).max(100).default([]),
  }).parse(req.body);
  if (!DOMAINS[body.domain]) throw new ValidationError('Неизвестное направление');
  if (category(body.code)) throw new ValidationError('Категория с таким кодом уже существует');
  if (get('SELECT code FROM categories WHERE uid_prefix = ?', body.uid_prefix)) throw new ValidationError('Такой префикс идентификатора уже используется');
  const base: FieldDef[] = [
    { key: 'name', label: 'Наименование', type: 'text', core: true, required: true, table: true },
    { key: 'code', label: 'Номер / код', type: 'text', core: true, table: true },
    { key: 'address_raw', label: 'Адрес / местоположение', type: 'text', core: true, table: true, filter: true },
    { key: 'status', label: 'Состояние / статус', type: 'text', core: true, table: true, filter: true },
    { key: 'balance_holder', label: 'Балансовая принадлежность', type: 'text', core: true, filter: true },
    { key: 'year_built', label: 'Год постройки', type: 'int', core: true },
    { key: 'lat', label: 'Широта', type: 'number', core: true },
    { key: 'lon', label: 'Долгота', type: 'number', core: true },
    { key: 'notes', label: 'Примечания', type: 'text', core: true },
  ];
  const fields = [...base, ...body.fields.filter((f) => !(CORE_FIELDS as readonly string[]).includes(f.key))];
  run('INSERT INTO categories(code, domain, name, short_name, description, uid_prefix, fields, sort) VALUES(?,?,?,?,?,?,?,?)',
    body.code, body.domain, body.name, body.short_name, body.description ?? null, body.uid_prefix, JSON.stringify(fields), 200);
  invalidateCategories();
  audit(req, 'category.create', 'category', body.code, { name: body.name });
  res.status(201).json({ code: body.code });
});

adminRouter.patch('/categories/:code', requirePerm('categories.manage'), (req, res) => {
  const cat = category(String(req.params.code));
  if (!cat) {
    res.status(404).json({ error: 'Категория не найдена' });
    return;
  }
  const body = z.object({
    name: z.string().trim().min(3).max(200).optional(),
    name_kk: z.string().trim().max(200).nullable().optional(),
    description: z.string().trim().max(1000).optional(),
    addFields: z.array(fieldSchema).max(50).optional(),
  }).parse(req.body);
  const fields = [...cat.fields];
  for (const f of body.addFields ?? []) {
    if (fields.some((x) => x.key === f.key)) throw new ValidationError(`Поле «${f.key}» уже существует`);
    fields.push(f);
  }
  run('UPDATE categories SET name = coalesce(?, name), name_kk = ?, description = coalesce(?, description), fields = ? WHERE code = ?',
    cat.is_system ? null : body.name ?? null, body.name_kk ?? cat.name_kk ?? null, body.description ?? null, JSON.stringify(fields), cat.code);
  invalidateCategories();
  audit(req, 'category.update', 'category', cat.code, body);
  res.json({ ok: true });
});

// ─────────────────────────── Журнал ───────────────────────────

function auditQuery(q: Record<string, any>) {
  const conds: string[] = ['1'];
  const args: any[] = [];
  if (q.action) { conds.push('a.action = ?'); args.push(String(q.action)); }
  if (q.user) { conds.push('a.user_login = ?'); args.push(String(q.user)); }
  if (q.from) { conds.push('a.at >= ?'); args.push(String(q.from)); }
  if (q.to) { conds.push('a.at <= ?'); args.push(String(q.to) + ' 23:59:59'); }
  return { where: conds.join(' AND '), args };
}

adminRouter.get('/audit', requirePerm('audit.view'), (req, res) => {
  const { where, args } = auditQuery(req.query);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Number(req.query.pageSize) || 50, 500);
  const total = get(`SELECT count(*) n FROM audit_log a WHERE ${where}`, ...args)!.n;
  const items = all(`SELECT a.*, u.full_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`, ...args, pageSize, (page - 1) * pageSize)
    .map((r) => ({ ...r, details: json(r.details, null), action_label: AUDIT_ACTIONS[r.action] ?? r.action }));
  res.json({ total, page, pageSize, items, actions: AUDIT_ACTIONS });
});

adminRouter.get('/audit/export', requirePerm('audit.view'), (req, res) => {
  const { where, args } = auditQuery(req.query);
  const rows = all(`SELECT a.*, u.full_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE ${where} ORDER BY a.id DESC LIMIT 100000`, ...args);
  audit(req, 'export.audit', 'audit', null, { rows: rows.length });
  const buf = sheetBuffer('Журнал', ['Дата и время (UTC)', 'Пользователь', 'Логин', 'Действие', 'Объект', 'ID', 'Подробности', 'IP'],
    rows.map((r) => [r.at, r.full_name, r.user_login, AUDIT_ACTIONS[r.action] ?? r.action, r.entity, r.entity_id, r.details, r.ip]));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="zhkh-audit-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.send(buf);
});

// ─────────────────────────── Резервные копии ───────────────────────────

adminRouter.get('/backups', requirePerm('backup.manage'), (_req, res) => {
  res.json({ items: listBackups(), intervalHours: config.backupIntervalHours, keep: config.backupKeep, dir: 'data/backups' });
});

adminRouter.post('/backups', requirePerm('backup.manage'), (req, res) => {
  const name = createBackup('manual');
  audit(req, 'backup.create', 'backup', name);
  res.status(201).json({ name });
});

adminRouter.get('/backups/:name', requirePerm('backup.manage'), (req, res) => {
  const p = backupPath(String(req.params.name));
  audit(req, 'backup.download', 'backup', String(req.params.name));
  res.download(p);
});

adminRouter.post('/backups/:name/restore', requirePerm('backup.manage'), (req, res) => {
  z.object({ confirm: z.literal('ВОССТАНОВИТЬ') }).parse(req.body);
  const name = String(req.params.name);
  const safety = restoreBackup(name);
  invalidateCategories();
  audit(req, 'backup.restore', 'backup', name, { safetyCopy: safety });
  res.json({ ok: true, safetyCopy: safety });
});

// ─────────────────────────── Настройки ───────────────────────────

adminRouter.get('/settings', requirePerm('settings.manage'), (_req, res) => {
  res.json({
    public_enabled: getSetting('public_enabled', false),
    system_name: getSetting('system_name', 'Цифровая информационная система ЖКХ города Атырау'),
    categories: [...categories().values()].map((c) => ({
      code: c.code, name: c.name, is_public: !!c.is_public, public_fields: c.public_fields,
      fields: c.fields.filter((f) => !f.confidential).map((f) => ({ key: f.key, label: f.label })),
    })),
  });
});

adminRouter.put('/settings', requirePerm('settings.manage'), (req, res) => {
  const body = z.object({
    public_enabled: z.boolean().optional(),
    system_name: z.string().trim().min(3).max(200).optional(),
    categories: z.array(z.object({ code: z.string(), is_public: z.boolean(), public_fields: z.array(z.string()).max(100) })).optional(),
  }).parse(req.body);
  tx(() => {
    if (body.public_enabled !== undefined) setSetting('public_enabled', body.public_enabled);
    if (body.system_name) setSetting('system_name', body.system_name);
    for (const c of body.categories ?? []) {
      const cat = category(c.code);
      if (!cat) continue;
      // конфиденциальные поля опубликовать нельзя
      const allowedKeys = new Set(cat.fields.filter((f) => !f.confidential).map((f) => f.key));
      run('UPDATE categories SET is_public = ?, public_fields = ? WHERE code = ?', c.is_public ? 1 : 0, JSON.stringify(c.public_fields.filter((k) => allowedKeys.has(k))), c.code);
    }
  });
  invalidateCategories();
  audit(req, 'settings.update', 'settings', null, body);
  res.json({ ok: true });
});
