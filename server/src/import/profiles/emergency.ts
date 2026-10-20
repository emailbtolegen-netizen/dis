/** Аварийные и ветхие дома — данные карты (массив HOUSES из HTML-страницы или такая же таблица Excel). */
import { fold, parseNumber } from '../../domain/normalize.ts';
import type { Msg, ParsedRecord, ParseResult, Profile, Sheet } from '../types.ts';
import { cellText, isEmptyRow } from '../workbook.ts';
import { assignKeys, headerLabels, rawRow, str } from './common.ts';

const STATUS: Record<string, string> = {
  red: 'Аварийный (признан, есть заключение)',
  yellow: 'Ветхий (заключения нет или назначен капремонт)',
};

function headerRow(sheet: Sheet): number {
  for (let i = 0; i < Math.min(sheet.rows.length, 30); i++) {
    const f = (sheet.rows[i] ?? []).map((v) => fold(v));
    if (f.includes('addr') && f.includes('status') && f.includes('lat') && f.includes('lon')) return i;
  }
  return -1;
}

export const emergencyProfile: Profile = {
  code: 'mkd_emergency',
  name: 'Аварийные и ветхие дома (данные карты)',
  detect: (sheet) => headerRow(sheet) >= 0,
  parse(sheet: Sheet): ParseResult {
    const fileIssues: Msg[] = [];
    const h = headerRow(sheet);
    if (h < 0) throw new Error('Не найдены столбцы addr / status / lat / lon');
    for (const r of sheet.rows.slice(0, h)) {
      const t = (r ?? []).map(cellText).filter(Boolean).join(' ');
      if (t) fileIssues.push({ level: 'info', text: t });
    }
    const header = sheet.rows[h].map((v) => cellText(v));
    const labels = headerLabels(header, header.length);
    const idx = (k: string) => header.indexOf(k);
    const records: ParsedRecord[] = [];
    for (let i = h + 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i] ?? [];
      if (isEmptyRow(row)) continue;
      const rowNo = sheet.firstRow + i;
      const v = (k: string) => (idx(k) >= 0 ? row[idx(k)] : null);
      const addr = str(v('addr'));
      if (!addr) {
        fileIssues.push({ level: 'warning', text: `Запись ${rowNo - h - sheet.firstRow + 1}: нет адреса — пропущена` });
        continue;
      }
      const messages: Msg[] = [];
      const statusRaw = str(v('status'));
      const status = statusRaw ? STATUS[statusRaw.toLowerCase()] ?? statusRaw : null;
      if (!statusRaw) messages.push({ level: 'warning', field: 'status', text: 'Не указана категория (цвет метки)' });
      else if (!STATUS[statusRaw.toLowerCase()]) messages.push({ level: 'warning', field: 'status', text: `Неизвестное значение статуса «${statusRaw}» — сохранено как есть` });
      const lat = parseNumber(v('lat'));
      const lon = parseNumber(v('lon'));
      if (lat == null || lon == null) messages.push({ level: 'warning', field: 'lat', text: 'Нет координат — дом не будет показан на карте' });
      else if (lat < 46.9 || lat > 47.3 || lon < 51.6 || lon > 52.2) messages.push({ level: 'warning', field: 'lat', text: `Координаты ${lat}, ${lon} за пределами г. Атырау — проверьте` });
      const note = v('note') == null ? null : cellText(v('note'));
      if (statusRaw === 'red' && note && /заключения нет/i.test(note)) messages.push({ level: 'warning', field: 'conclusion', text: 'Метка «аварийный», но в примечании «заключения нет» — проверьте' });
      const streetRu = str(v('street_ru'));
      const house = str(v('house'));
      const year = parseNumber(v('year'));
      const baseKey = `mkd_emergency:${fold(addr).replace(/[\s,.]+/g, ' ').trim()}`;
      records.push({
        rowNo, category: 'mkd_emergency', baseKey, naturalKey: baseKey,
        core: { name: `${status?.startsWith('Аварийный') ? 'Аварийный' : status?.startsWith('Ветхий') ? 'Ветхий' : 'Дом'}: ${streetRu && house ? `${streetRu}, ${house}` : addr}`, address_raw: addr, status, year_built: year, lat, lon },
        attrs: {
          address_ru: streetRu && house ? `${streetRu}, ${house}` : null,
          conclusion: note,
          floors: parseNumber(v('floors')),
          flats: parseNumber(v('flats')),
          area_m2: parseNumber(v('area')),
          coord_source: str(v('acc')),
          map_status: statusRaw,
          street_kz: str(v('street_kz')),
          street_ru: streetRu,
          house,
          no_in_list: v('n') == null ? null : cellText(v('n')),
        },
        raw: rawRow(labels, row),
        messages,
        valid: true,
      });
    }
    const red = records.filter((r) => r.attrs.map_status === 'red').length;
    fileIssues.push({ level: 'info', text: `Записей: ${records.length}; аварийных (красных): ${red}; ветхих (жёлтых): ${records.filter((r) => r.attrs.map_status === 'yellow').length}; с координатами: ${records.filter((r) => r.core.lat != null && r.core.lon != null).length}.` });
    assignKeys(records);
    return { profile: 'mkd_emergency', profileName: this.name, sheet: sheet.name, records, fileIssues, controlTotals: [] };
  },
};
