import { fold, parseAddress, parseInt0, parseNumber } from '../../domain/normalize.ts';
import type { ControlTotal, Msg, ParsedRecord, ParseResult, Profile, Sheet } from '../types.ts';
import { colLetter, isEmptyRow } from '../workbook.ts';
import { assignKeys, findHeaderRow, headerLabels, rawRow, str, val } from './common.ts';

/** Сопоставление заголовков (казахский язык, после нормализации) с полями категории «МЖД». */
const HEADER_MAP: [string, string][] = [
  ['патерлер саны', 'apartments'],
  ['кабаттар саны', 'floors'],
  ['квадрат метр', 'area_m2'],
  ['домофон', 'intercom'],
  ['кабырга', 'wall_material'],
  ['су кубыры', 'water_plastic'],
  ['жылыту', 'heating'],
  ['кариз', 'sewer'],
  ['ыстык су', 'hot_water'],
  ['жондеуден', 'repair_year'],
  ['электр плита', 'electric_stove'],
  ['лифт', 'elevators'],
  ['баскару', 'management'],
  ['газ', 'gas'],
  ['кала', '@address'],
  ['жылы', '@year'],
  ['№', '@no'],
];

export const mkdProfile: Profile = {
  code: 'mkd',
  name: 'Реестр многоквартирных жилых домов (МЖД)',
  detect: (sheet) => findHeaderRow(sheet, 'Пәтерлер саны') >= 0 && findHeaderRow(sheet, 'Қабаттар саны') >= 0,
  parse(sheet: Sheet): ParseResult {
    const fileIssues: Msg[] = [];
    const controlTotals: ControlTotal[] = [];
    const h = findHeaderRow(sheet, 'Пәтерлер саны');
    if (h < 0) throw new Error('Не найдена строка заголовков (столбец «Пәтерлер саны»)');
    const header = sheet.rows[h];
    const width = Math.max(...sheet.rows.map((r) => r?.length ?? 0));
    const labels = headerLabels(header, width);

    const colOf = new Map<string, number>();
    for (let c = 0; c < width; c++) {
      const hv = fold(header[c]);
      if (!hv) continue;
      const hit = HEADER_MAP.find(([needle]) => (needle === 'жылы' ? hv === 'жылы' : hv.includes(needle)));
      if (hit && !colOf.has(hit[1])) colOf.set(hit[1], c);
    }
    for (const req of ['@address', 'apartments', 'area_m2']) {
      if (!colOf.has(req)) throw new Error(`Не найден обязательный столбец (${req})`);
    }
    // столбцы без заголовка, содержащие данные
    const unnamed: number[] = [];
    for (let c = 0; c < width; c++) {
      if (header[c] == null && sheet.rows.slice(h + 1).some((r) => r?.[c] != null && String(r[c]).trim() !== '')) unnamed.push(c);
    }
    for (const c of unnamed) {
      fileIssues.push({ level: 'warning', text: `Столбец ${colLetter(c)} не имеет заголовка, но содержит значения — сохранены как «Столбец ${colLetter(c)} (без заголовка)», требуют уточнения.` });
    }
    // строки над заголовком (например, «Атырау қаласы») — описание листа
    const caption = sheet.rows.slice(0, h).flat().filter((v) => v != null && String(v).trim() !== '').map(String).join('; ');

    const records: ParsedRecord[] = [];
    for (let i = h + 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i];
      if (isEmptyRow(row)) continue;
      const rowNo = sheet.firstRow + i;
      const get = (k: string) => (colOf.has(k) ? row[colOf.get(k)!] : null);
      const address = str(get('@address'));
      const no = get('@no');

      if (!address && (no == null || String(no).trim() === '')) {
        // итоговая строка (например, сумма площадей)
        const area = parseNumber(get('area_m2'));
        if (area != null) {
          controlTotals.push({ label: 'Итоговая площадь МЖД (строка итога в файле)', category: 'mkd', measure: 'area_m2', stated: area, statedRaw: String(get('area_m2')), computed: null, unit: 'м²', rowNo, match: null });
        } else {
          fileIssues.push({ level: 'warning', text: `Строка ${rowNo}: нет адреса и номера, строка пропущена.` });
        }
        continue;
      }

      const messages: Msg[] = [];
      const attrs: Record<string, unknown> = {};
      for (const [, key] of HEADER_MAP) {
        if (key.startsWith('@') || !colOf.has(key)) continue;
        attrs[key] = val(get(key));
      }
      for (const c of unnamed) attrs[c === 17 ? 'col_r' : `col_${colLetter(c).toLowerCase()}`] = val(row[c]);

      const yearRaw = get('@year');
      const year = parseInt0(yearRaw);
      if (yearRaw != null && year == null) messages.push({ level: 'warning', field: 'year_built', text: `Год постройки не распознан: «${yearRaw}»` });
      if (yearRaw == null) messages.push({ level: 'warning', field: 'year_built', text: 'Не указан год постройки' });
      if (attrs.area_m2 != null && typeof attrs.area_m2 !== 'number') {
        const n = parseNumber(attrs.area_m2);
        if (n != null) attrs.area_m2 = n;
        else messages.push({ level: 'warning', field: 'area_m2', text: `Площадь не распознана как число: «${attrs.area_m2}»` });
      }
      if (attrs.area_m2 == null) messages.push({ level: 'warning', field: 'area_m2', text: 'Не указана площадь' });
      if (attrs.apartments == null) messages.push({ level: 'warning', field: 'apartments', text: 'Не указано количество квартир' });
      if (attrs.floors == null) messages.push({ level: 'warning', field: 'floors', text: 'Не указана этажность' });
      else if (typeof attrs.floors !== 'number') messages.push({ level: 'info', field: 'floors', text: `Этажность указана текстом: «${attrs.floors}»` });
      if (no == null) messages.push({ level: 'info', text: 'В строке не заполнен порядковый номер (столбец №)' });

      const p = parseAddress(address);
      if (!p.buildingKey) messages.push({ level: 'warning', field: 'address_raw', text: 'В адресе не удалось выделить номер дома' });
      const baseKey = 'mkd:' + (p.buildingKey ?? fold(address));

      records.push({
        rowNo,
        category: 'mkd',
        baseKey,
        naturalKey: baseKey,
        core: { name: address, address_raw: address, year_built: year },
        attrs,
        raw: rawRow(labels, row),
        messages,
        valid: true,
      });
    }
    if (caption) fileIssues.push({ level: 'info', text: `Подпись листа над таблицей: «${caption}»` });
    // пропуски в порядковой нумерации (объясняют расхождение «номер последней строки ≠ число домов»)
    const nos = records.map((r) => Object.entries(r.raw).find(([k]) => k.startsWith('A'))?.[1]).filter((v): v is number => typeof v === 'number');
    const gaps: string[] = [];
    for (let i = 1; i < nos.length; i++) if (nos[i] > nos[i - 1] + 1) gaps.push(`${nos[i - 1]} → ${nos[i]}`);
    if (gaps.length) {
      fileIssues.push({ level: 'warning', text: `Пропуски в порядковой нумерации: ${gaps.join('; ')}. Последний № = ${nos[nos.length - 1]}, фактически строк с домами: ${records.length}.` });
    }
    assignKeys(records);
    // контрольная сумма площади
    for (const t of controlTotals) {
      const sum = records.reduce((s, r) => s + (typeof r.attrs.area_m2 === 'number' ? (r.attrs.area_m2 as number) : 0), 0);
      t.computed = Math.round(sum * 10000) / 10000;
      t.match = t.stated != null && Math.abs(t.stated - sum) < 0.01;
    }
    return { profile: 'mkd', profileName: this.name, sheet: sheet.name, records, fileIssues, controlTotals };
  },
};
