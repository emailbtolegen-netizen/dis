import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';
import { all, get, json, nowIso, run, tx } from '../db/db.ts';
import { category } from '../domain/categories.ts';
import { createBackup } from '../services/backup.ts';
import { rebuildAutoLinks } from '../services/links.ts';
import { diffData, insertObject, logChange, objectData, updateObject } from '../services/objects.ts';
import { detectProfile, profileByCode, PROFILES } from './profiles/index.ts';
import type { ParsedRecord, ParseResult } from './types.ts';
import { cellText, readSheet, readWorkbook } from './workbook.ts';

const ALLOWED_EXT = new Set(['.xlsx', '.xls', '.csv', '.xlsm']);

export class ImportError extends Error {}

// ─────────────────────────── Загрузка файла ───────────────────────────

/** Сохранение загруженного файла (имя на диске — случайное, вне публичных каталогов). */
export function storeSourceFile(buf: Buffer, originalName: string, userId: number | null): number {
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw new ImportError('Допустимы только файлы .xlsx, .xls, .xlsm, .csv');
  // сигнатуры: xlsx/xlsm — ZIP (PK), xls — OLE2 (D0 CF 11 E0), csv — текст
  const sig = buf.subarray(0, 4).toString('hex');
  if ((ext === '.xlsx' || ext === '.xlsm') && !sig.startsWith('504b')) throw new ImportError('Файл не является книгой Excel (.xlsx)');
  if (ext === '.xls' && sig !== 'd0cf11e0' && !sig.startsWith('504b')) throw new ImportError('Файл не является книгой Excel (.xls)');
  if (ext === '.csv' && buf.subarray(0, 4096).includes(0)) throw new ImportError('CSV-файл содержит двоичные данные');
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const stored = `${sha256.slice(0, 16)}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(config.uploadsDir, stored), buf);
  return run('INSERT INTO source_files(file_name, sha256, size, stored_name, uploaded_by) VALUES(?,?,?,?,?)',
    path.basename(originalName).slice(0, 255), sha256, buf.length, stored, userId).lastId;
}

function loadWorkbook(sourceFileId: number) {
  const sf = get('SELECT * FROM source_files WHERE id = ?', sourceFileId);
  if (!sf) throw new ImportError('Файл не найден');
  const buf = fs.readFileSync(path.join(config.uploadsDir, sf.stored_name));
  return { sf, wb: readWorkbook(buf) };
}

/** Состав книги: листы, первые строки, определённый формат. */
export function inspectSourceFile(sourceFileId: number) {
  const { sf, wb } = loadWorkbook(sourceFileId);
  const previous = all(
    `SELECT i.id, i.sheet_name, i.status, i.applied_at, s.file_name FROM imports i JOIN source_files s ON s.id = i.source_file_id
      WHERE s.sha256 = ? AND i.status = 'applied' ORDER BY i.id DESC`, sf.sha256);
  return {
    sourceFile: { id: sf.id, file_name: sf.file_name, size: sf.size, sha256: sf.sha256, uploaded_at: sf.uploaded_at },
    sameFileImported: previous,
    profiles: PROFILES.map((p) => ({ code: p.code, name: p.name })),
    sheets: wb.SheetNames.map((name) => {
      const sheet = readSheet(wb, name);
      const detected = detectProfile(sheet);
      const width = Math.min(30, Math.max(0, ...sheet.rows.slice(0, 200).map((r) => r?.length ?? 0)));
      return {
        name,
        rowCount: sheet.rows.length,
        firstRow: sheet.firstRow,
        width,
        detected: { code: detected.code, name: detected.name },
        preview: sheet.rows.slice(0, 40).map((r, i) => ({ rowNo: sheet.firstRow + i, cells: Array.from({ length: width }, (_, c) => cellText(r?.[c]) || null) })),
      };
    }),
  };
}

// ─────────────────────────── Предпросмотр ───────────────────────────

/** Разбор листа и сравнение с текущей базой. Ничего не меняет в данных — создаёт черновик импорта. */
export function createPreview(sourceFileId: number, sheetName: string, profileCode: string | null, options: unknown, userId: number | null) {
  const { wb } = loadWorkbook(sourceFileId);
  const sheet = readSheet(wb, sheetName);
  const profile = profileCode ? profileByCode(profileCode) : detectProfile(sheet);
  if (!profile) throw new ImportError('Неизвестный формат файла');
  let result: ParseResult;
  try {
    result = profile.parse(sheet, options);
  } catch (e) {
    throw new ImportError(`Не удалось разобрать лист «${sheetName}»: ${(e as Error).message}`);
  }

  return tx(() => {
    const importId = run('INSERT INTO imports(source_file_id, sheet_name, profile, options, created_by) VALUES(?,?,?,?,?)',
      sourceFileId, sheetName, profile.code, JSON.stringify(options ?? {}), userId).lastId;
    const cats = [...new Set(result.records.filter((r) => r.valid && r.category).map((r) => r.category!))];
    const existing = new Map<string, any>();
    for (const c of cats) {
      for (const o of all('SELECT * FROM objects WHERE category = ? AND natural_key IS NOT NULL AND deleted_at IS NULL', c)) existing.set(`${c}|${o.natural_key}`, o);
    }
    const seenKeys = new Set<string>();
    const counts: Record<string, number> = { new: 0, changed: 0, unchanged: 0, invalid: 0, missing: 0 };
    const insertRow = (r: Omit<Partial<ParsedRecord>, 'rowNo'> & { rowNo: number | null }, action: string, extra: { objectId?: number; before?: unknown; diff?: unknown; manual?: boolean; decision?: string } = {}) => {
      counts[action]++;
      run(
        `INSERT INTO import_rows(import_id, row_no, category, natural_key, action, decision, object_id, data, before, diff, messages, dup_group, manual_edit)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        importId, r.rowNo, r.category ?? null, r.naturalKey ?? null, action, extra.decision ?? (action === 'invalid' || action === 'missing' ? 'skip' : 'apply'),
        extra.objectId ?? null, r.core ? JSON.stringify({ core: r.core, attrs: r.attrs, raw: r.raw }) : null,
        extra.before === undefined ? null : JSON.stringify(extra.before), extra.diff ? JSON.stringify(extra.diff) : null,
        JSON.stringify(r.messages ?? []), r.dupGroup ?? null, extra.manual ? 1 : 0,
      );
    };

    for (const r of result.records) {
      if (!r.valid || !r.category) {
        insertRow(r, 'invalid');
        continue;
      }
      const key = `${r.category}|${r.naturalKey}`;
      seenKeys.add(key);
      const obj = existing.get(key);
      if (!obj) {
        insertRow(r, 'new');
        continue;
      }
      const cur = objectData(obj);
      const diff = diffData(category(r.category), cur, { core: r.core, attrs: r.attrs });
      const before = { ...cur, raw: json(obj.raw, null), issues: json(obj.issues, []), source: { fileId: obj.source_file_id, sheet: obj.source_sheet, row: obj.source_row, importId: obj.source_import_id }, updated_at: obj.updated_at };
      const manual = obj.updated_via === 'manual';
      if (diff.length) {
        if (manual) r.messages.push({ level: 'warning', text: 'Запись изменялась вручную через сайт после последнего импорта. Применение перезапишет поля, указанные в различиях.' });
        insertRow(r, 'changed', { objectId: obj.id, before, diff, manual, decision: manual ? 'skip' : 'apply' });
      } else {
        insertRow(r, 'unchanged', { objectId: obj.id, before });
      }
    }
    // объекты, импортированные ранее этим же форматом, но отсутствующие в новом файле
    if (cats.length) {
      const missing = all(
        `SELECT o.* FROM objects o JOIN imports i ON i.id = o.source_import_id
          WHERE o.deleted_at IS NULL AND o.natural_key IS NOT NULL AND i.profile = ? AND i.sheet_name = ? AND o.category IN (${cats.map(() => '?').join(',')})`,
        profile.code, sheetName, ...cats);
      for (const o of missing) {
        if (seenKeys.has(`${o.category}|${o.natural_key}`)) continue;
        insertRow({ rowNo: null, category: o.category, naturalKey: o.natural_key, messages: [{ level: 'warning', text: `Объект ${o.uid} «${o.name}» есть в базе, но отсутствует в новом файле. Автоматически не удаляется.` }] }, 'missing', { objectId: o.id });
      }
    }
    const summary = {
      ...counts,
      total: result.records.length,
      duplicates: result.records.filter((r) => r.dupGroup).length,
      warnings: result.records.filter((r) => r.messages.some((m) => m.level === 'warning')).length,
      manualConflicts: Number(get(`SELECT count(*) n FROM import_rows WHERE import_id = ? AND manual_edit = 1`, importId)!.n),
      byCategory: Object.fromEntries(cats.map((c) => [c, result.records.filter((r) => r.valid && r.category === c).length])),
      profileName: result.profileName,
    };
    run('UPDATE imports SET summary = ?, file_issues = ?, control_totals = ? WHERE id = ?',
      JSON.stringify(summary), JSON.stringify(result.fileIssues), JSON.stringify(result.controlTotals), importId);
    return importId;
  });
}

// ─────────────────────────── Применение ───────────────────────────

export function applyImport(importId: number, userId: number | null) {
  const imp = get('SELECT * FROM imports WHERE id = ?', importId);
  if (!imp) throw new ImportError('Импорт не найден');
  if (imp.status !== 'preview') throw new ImportError('Импорт уже применён или отменён');
  const backupName = createBackup(`before-import-${importId}`);
  const stamp = nowIso();
  const report = { created: 0, updated: 0, refreshed: 0, skipped: 0, conflicts: [] as string[] };

  tx(() => {
    const rows = all(`SELECT * FROM import_rows WHERE import_id = ? AND action IN ('new','changed','unchanged') ORDER BY id`, importId);
    for (const r of rows) {
      if (r.decision !== 'apply') { report.skipped++; continue; }
      const data = json<{ core: any; attrs: any; raw: any }>(r.data, { core: {}, attrs: {}, raw: null });
      const messages = json<any[]>(r.messages, []).filter((m) => !/вручную через сайт/.test(m.text));
      const source = { fileId: imp.source_file_id, sheet: imp.sheet_name, row: r.row_no, importId };
      if (r.action === 'new') {
        const { id } = insertObject({ category: r.category, core: data.core, attrs: data.attrs, raw: data.raw, issues: messages, naturalKey: r.natural_key, source }, userId, 'import', stamp);
        logChange(id, 'import_create', [], userId, { importId, at: stamp, reason: `Импорт №${importId}` });
        run('UPDATE import_rows SET object_id = ?, applied = 1 WHERE id = ?', id, r.id);
        report.created++;
        continue;
      }
      const obj = get('SELECT * FROM objects WHERE id = ? AND deleted_at IS NULL', r.object_id);
      const before = json<any>(r.before, null);
      if (!obj || obj.updated_at !== before?.updated_at) {
        report.conflicts.push(`Строка ${r.row_no}: объект изменился после предпросмотра — пропущено`);
        report.skipped++;
        continue;
      }
      if (r.action === 'changed') {
        const changes = updateObject(obj.id, { core: data.core, attrs: data.attrs }, userId, { via: 'import', stamp, raw: data.raw, issues: messages, naturalKey: r.natural_key, source });
        logChange(obj.id, 'import_update', changes, userId, { importId, at: stamp, reason: `Импорт №${importId}` });
        report.updated++;
      } else {
        updateObject(obj.id, { core: {}, attrs: {} }, userId, { via: 'import', stamp, raw: data.raw, issues: messages, source });
        report.refreshed++;
      }
      run('UPDATE import_rows SET applied = 1 WHERE id = ?', r.id);
    }
    run(`UPDATE imports SET status = 'applied', applied_by = ?, applied_at = ?, backup_name = ? WHERE id = ?`, userId, stamp, backupName, importId);
  });
  rebuildAutoLinks();
  return { ...report, backupName };
}

// ─────────────────────────── Откат ───────────────────────────

/** Откат применённого импорта. Объекты, изменённые после импорта (вручную или другим импортом), не затрагиваются. */
export function rollbackImport(importId: number, userId: number | null) {
  const imp = get('SELECT * FROM imports WHERE id = ?', importId);
  if (!imp) throw new ImportError('Импорт не найден');
  if (imp.status !== 'applied') throw new ImportError('Откатить можно только применённый импорт');
  const backupName = createBackup(`before-rollback-${importId}`);
  const stamp = nowIso();
  const report = { deleted: 0, restored: 0, conflicts: [] as string[], backupName };
  tx(() => {
    const rows = all('SELECT * FROM import_rows WHERE import_id = ? AND applied = 1', importId);
    for (const r of rows) {
      const obj = get('SELECT * FROM objects WHERE id = ?', r.object_id);
      if (!obj || obj.deleted_at) continue;
      const untouched = obj.source_import_id === importId && obj.updated_at === imp.applied_at;
      if (!untouched) {
        report.conflicts.push(`${obj.uid} «${obj.name}» изменён после импорта — оставлен без изменений`);
        continue;
      }
      if (r.action === 'new') {
        run('UPDATE objects SET deleted_at = ?, deleted_by = ?, delete_reason = ? WHERE id = ?', stamp, userId, `Откат импорта №${importId}`, obj.id);
        logChange(obj.id, 'rollback', [], userId, { importId, at: stamp, reason: `Откат импорта №${importId}: запись удалена` });
        report.deleted++;
      } else {
        const before = json<any>(r.before, null);
        if (!before) continue;
        const changes = updateObject(obj.id, { core: before.core, attrs: before.attrs }, userId, {
          via: 'rollback', stamp, raw: before.raw, issues: before.issues, source: before.source,
        });
        if (changes.length) logChange(obj.id, 'rollback', changes, userId, { importId, at: stamp, reason: `Откат импорта №${importId}` });
        report.restored++;
      }
    }
    run(`UPDATE imports SET status = 'rolled_back', rolled_back_by = ?, rolled_back_at = ?, rollback_report = ? WHERE id = ?`, userId, stamp, JSON.stringify(report), importId);
  });
  rebuildAutoLinks();
  return report;
}

export function discardImport(importId: number) {
  const imp = get('SELECT status FROM imports WHERE id = ?', importId);
  if (!imp) throw new ImportError('Импорт не найден');
  if (imp.status !== 'preview') throw new ImportError('Отменить можно только неприменённый импорт');
  tx(() => {
    run('DELETE FROM import_rows WHERE import_id = ?', importId);
    run(`UPDATE imports SET status = 'discarded' WHERE id = ?`, importId);
  });
}
