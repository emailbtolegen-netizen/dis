import XLSX from 'xlsx';
import type { Sheet } from './types.ts';

/** Чтение книги Excel/CSV из буфера. Формулы не вычисляются, макросы не выполняются. */
export function readWorkbook(buf: Buffer): XLSX.WorkBook {
  return XLSX.read(buf, { type: 'buffer', cellDates: true, cellFormula: false, cellHTML: false, bookVBA: false, dense: false });
}

export function readSheet(wb: XLSX.WorkBook, name: string): Sheet {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Лист «${name}» не найден`);
  const ref = ws['!ref'];
  if (!ref) return { name, rows: [], firstRow: 1 };
  const range = XLSX.utils.decode_range(ref);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
  const trimmed = rows.map((r) => r.map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)));
  return { name, rows: trimmed, firstRow: range.s.r + 1 };
}

/** Буква столбца Excel по индексу (0 → A). */
export function colLetter(i: number): string {
  return XLSX.utils.encode_col(i);
}

export function cellText(v: unknown): string {
  if (v == null) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

/** Строка полностью пустая. */
export function isEmptyRow(r: unknown[] | undefined): boolean {
  return !r || r.every((v) => v == null || String(v).trim() === '');
}
