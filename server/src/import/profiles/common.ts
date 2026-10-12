import { fold } from '../../domain/normalize.ts';
import type { ParsedRecord, Sheet } from '../types.ts';
import { cellText, colLetter } from '../workbook.ts';

/** Найти строку заголовка по фрагменту текста (после нормализации). Возвращает индекс в sheet.rows. */
export function findHeaderRow(sheet: Sheet, needle: string, maxScan = 30): number {
  const n = fold(needle);
  for (let i = 0; i < Math.min(sheet.rows.length, maxScan); i++) {
    if ((sheet.rows[i] || []).some((v) => fold(v).includes(n))) return i;
  }
  return -1;
}

/** Подписи столбцов для сохранения исходной строки: «A: №», «B: Қала» … */
export function headerLabels(header: unknown[], width: number): string[] {
  const out: string[] = [];
  for (let c = 0; c < width; c++) {
    const h = cellText(header[c]);
    out.push(h ? `${colLetter(c)}: ${h}` : `${colLetter(c)}`);
  }
  return out;
}

export function rawRow(labels: string[], row: unknown[]): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  labels.forEach((l, c) => {
    const v = row[c];
    if (v != null && String(v).trim() !== '') raw[l] = v;
  });
  return raw;
}

/**
 * Присвоение ключей сопоставления: при повторе базового ключа в файле добавляется #2, #3…
 * и записи помечаются как возможные дубликаты (они НЕ объединяются автоматически).
 */
export function assignKeys(records: ParsedRecord[]): void {
  const seen = new Map<string, ParsedRecord[]>();
  for (const r of records) {
    if (!r.valid) continue;
    const list = seen.get(r.baseKey) ?? [];
    list.push(r);
    seen.set(r.baseKey, list);
    r.naturalKey = list.length === 1 ? r.baseKey : `${r.baseKey}#${list.length}`;
  }
  for (const [key, list] of seen) {
    if (list.length < 2) continue;
    const rowsList = list.map((r) => r.rowNo).join(', ');
    const sig = (r: ParsedRecord) => JSON.stringify([r.core, r.attrs]);
    const identical = list.every((r) => sig(r) === sig(list[0]));
    for (const r of list) {
      r.dupGroup = key;
      r.messages.push({
        level: identical ? 'warning' : 'info',
        text: identical
          ? `Полный дубликат: одинаковые строки ${rowsList}. Записи не объединены — требуется проверка.`
          : `Совпадает наименование/ключ в строках ${rowsList}, значения различаются. Записи сохранены отдельно — проверьте, не дубликат ли это.`,
      });
    }
  }
}

export function str(v: unknown): string | null {
  const s = cellText(v);
  return s === '' ? null : s;
}

/** Значение для attrs: числа остаются числами, строки очищаются от лишних пробелов. */
export function val(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const s = cellText(v);
  return s === '' ? null : s;
}
