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
  const trimmed = rows.map((r) => r.map((v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : v)));
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

const decodeEntities = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const htmlText = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * Данные из HTML-страницы (например, самостоятельной карты): встроенные массивы вида
 * `const ИМЯ = [{…}, …];` разбираются как JSON (код страницы НЕ выполняется), каждый массив — отдельный лист.
 * Над шапкой листа — заголовок страницы и строки легенды (для документирования источника).
 * Если массивов нет — читаются HTML-таблицы.
 */
export function readHtmlWorkbook(buf: Buffer): XLSX.WorkBook {
  const html = buf.toString('utf8');
  const title = htmlText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const legend = [...(html.match(/<div class="legend">([\s\S]*?)<\/div>\s*<\/header>/i)?.[1] ?? '').matchAll(/<div>([\s\S]*?)<\/div>/g)].map((m) => htmlText(m[1])).filter(Boolean);
  const wb = XLSX.utils.book_new();
  for (const m of html.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(\[\s*\{[\s\S]*?\}\s*\])\s*;/g)) {
    let data: unknown;
    try {
      data = JSON.parse(m[2]);
    } catch {
      continue; // не JSON (код) — пропускаем
    }
    if (!Array.isArray(data) || !data.length || !data.every((x) => x && typeof x === 'object' && !Array.isArray(x))) continue;
    const keys = [...new Set((data as Record<string, unknown>[]).flatMap((o) => Object.keys(o)))];
    const caption: unknown[][] = [[`Источник: HTML-страница «${title}», массив ${m[1]}`], ...legend.map((l) => [`Легенда: ${l}`]), []];
    const rows = (data as Record<string, unknown>[]).map((o) => keys.map((k) => {
      const v = o[k];
      return v == null || typeof v !== 'object' ? v ?? null : JSON.stringify(v);
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([...caption, keys, ...rows]), m[1].slice(0, 31));
    // вложенные записи (например, HOUSES[].avar — сведения из списка аварийных домов) — отдельным листом
    // «МАССИВ.поле» с указанием дома, к которому они относятся
    for (const k of keys) {
      const nested = (data as Record<string, any>[]).map((o) => {
        let v = o[k];
        if (typeof v === 'string' && v.startsWith('{')) try { v = JSON.parse(v); } catch { /* не объект */ }
        return v && typeof v === 'object' && !Array.isArray(v) ? { parent: o, v } : null;
      }).filter((x): x is { parent: Record<string, any>; v: Record<string, unknown> } => !!x);
      if (!nested.length) continue;
      const nk = [...new Set(nested.flatMap((x) => Object.keys(x.v)))];
      const ctx = ['n', 'addr', 'lat', 'lon'].filter((c) => keys.includes(c));
      const head = [...nk, ...ctx.map((c) => `house_${c}`)];
      const body = nested.map((x) => [...nk.map((c) => { const v = x.v[c]; return v == null || typeof v !== 'object' ? v ?? null : JSON.stringify(v); }), ...ctx.map((c) => x.parent[c] ?? null)]);
      const cap: unknown[][] = [[`Источник: HTML-страница «${title}», массив ${m[1]}, вложенное поле «${k}»`], ...legend.map((l) => [`Легенда: ${l}`]), []];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([...cap, head, ...body]), `${m[1]}.${k}`.slice(0, 31));
    }
  }
  if (wb.SheetNames.length) return wb;
  const tables = XLSX.read(buf, { type: 'buffer', cellFormula: false, cellHTML: false });
  if (!tables.SheetNames.length) throw new Error('В HTML-файле не найдено ни встроенных данных, ни таблиц');
  return tables;
}
