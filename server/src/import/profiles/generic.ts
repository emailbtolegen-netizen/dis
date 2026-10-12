import { category, CORE_FIELDS } from '../../domain/categories.ts';
import type { CoreField } from '../../domain/categories.ts';
import { fold, parseAddress, parseInt0, parseNumber } from '../../domain/normalize.ts';
import type { GenericOptions, Msg, ParsedRecord, ParseResult, Profile, Sheet } from '../types.ts';
import { isEmptyRow } from '../workbook.ts';
import { assignKeys, headerLabels, rawRow, str, val } from './common.ts';

const NUMERIC_CORE = new Set<string>(['power_kva', 'length_km', 'lat', 'lon']);

/** Универсальный импорт произвольной таблицы с ручным сопоставлением столбцов. */
export const genericProfile: Profile = {
  code: 'generic',
  name: 'Произвольная таблица (ручное сопоставление столбцов)',
  detect: () => true,
  parse(sheet: Sheet, options: GenericOptions): ParseResult {
    if (!options?.category) throw new Error('Не выбрана категория для импорта');
    const cat = category(options.category);
    if (!cat) throw new Error(`Категория «${options.category}» не найдена`);
    const hIdx = (options.headerRow ?? 1) - sheet.firstRow;
    if (hIdx < 0 || hIdx >= sheet.rows.length) throw new Error('Неверный номер строки заголовков');
    const header = sheet.rows[hIdx] ?? [];
    const width = Math.max(...sheet.rows.map((r) => r?.length ?? 0));
    const labels = headerLabels(header, width);
    const mapping = Object.entries(options.mapping ?? {}).filter(([, t]) => t && t !== 'skip');
    const targets = mapping.map(([, t]) => t);
    if (!targets.includes('name') && !targets.includes('address_raw')) throw new Error('Сопоставьте хотя бы один столбец с «Наименованием» или «Адресом»');
    const keyFields = options.keyFields?.length ? options.keyFields : ['name', 'address_raw'].filter((k) => targets.includes(k));
    const fileIssues: Msg[] = [];
    const records: ParsedRecord[] = [];

    for (let i = hIdx + 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i] ?? [];
      if (isEmptyRow(row)) continue;
      const rowNo = sheet.firstRow + i;
      const core: ParsedRecord['core'] = {};
      const attrs: Record<string, unknown> = {};
      const messages: Msg[] = [];
      for (const [colStr, target] of mapping) {
        const v = row[Number(colStr)];
        if (target.startsWith('attr:')) {
          attrs[target.slice(5)] = val(v);
        } else if ((CORE_FIELDS as readonly string[]).includes(target)) {
          const t = target as CoreField;
          if (t === 'year_built') {
            const y = parseInt0(v);
            if (v != null && y == null) messages.push({ level: 'warning', field: t, text: `Год не распознан: «${v}»` });
            core[t] = y;
          } else if (NUMERIC_CORE.has(t)) {
            const n = parseNumber(v);
            if (v != null && String(v).trim() !== '' && n == null) messages.push({ level: 'warning', field: t, text: `Значение не распознано как число: «${v}»` });
            core[t] = n;
          } else {
            core[t] = str(v);
          }
        }
      }
      if (!core.name) core.name = (core.address_raw as string) ?? null;
      const valid = !!core.name;
      if (!valid) messages.push({ level: 'error', text: 'Пустое наименование и адрес' });
      // числовые поля категории
      for (const f of cat.fields) {
        if (f.core || attrs[f.key] == null) continue;
        if (f.type === 'number' || f.type === 'int') {
          const n = parseNumber(attrs[f.key]);
          if (n == null) messages.push({ level: 'warning', field: f.key, text: `«${f.label}»: значение не распознано как число: «${attrs[f.key]}»` });
          else attrs[f.key] = n;
        }
      }
      const keyParts = keyFields.map((k) => {
        const v = k.startsWith('attr:') ? attrs[k.slice(5)] : core[k as CoreField];
        if (k === 'address_raw') return parseAddress(v).buildingKey ?? fold(v);
        return fold(v);
      });
      const baseKey = `${cat.code}:g:${keyParts.join('|')}`;
      records.push({ rowNo, category: cat.code, baseKey, naturalKey: baseKey, core, attrs, raw: rawRow(labels, row), messages, valid });
    }
    assignKeys(records);
    return { profile: 'generic', profileName: this.name, sheet: sheet.name, records, fileIssues, controlTotals: [] };
  },
};
