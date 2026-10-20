/**
 * Аварийные и ветхие дома. Два формата одного перечня:
 *  A) данные HTML-карты (массив HOUSES: addr, status red/yellow, note, lat, lon, …);
 *  B) таблица Excel «Апатты және тозығы жеткен көппәтерлік тұрғын үйлер тізімі»
 *     (№ | Мекен жайы | Салынған жылы | Пәтер саны | Қабаттылығы | Ауданы | Ескерме | координаты).
 * Ключ записи — нормализованный адрес, поэтому оба файла обновляют одни и те же записи (без дублей).
 */
import { looseBuildingKey } from '../../domain/addressMatch.ts';
import { fold, parseNumber } from '../../domain/normalize.ts';
import type { ControlTotal, Msg, ParsedRecord, ParseResult, Profile, Sheet } from '../types.ts';
import { cellText, isEmptyRow } from '../workbook.ts';
import { assignKeys, headerLabels, rawRow, str } from './common.ts';

export const EMERGENCY = 'Аварийный (признан, есть заключение)';
export const DILAPIDATED = 'Ветхий (заключения нет или назначен капремонт)';
const STATUS: Record<string, string> = { red: EMERGENCY, yellow: DILAPIDATED };

/**
 * Категория по примечанию — правило легенды исходной карты:
 * «Красный — признан аварийным (есть дата заключения); Жёлтый — заключения нет или назначен капремонт».
 */
export function statusFromNote(note: string | null): string | null {
  const t = fold(note);
  if (!t) return null;
  if (/жок|нет|жондеу|капремонт|кап\.?\s*ремонт/.test(t)) return DILAPIDATED;
  if (/(19|20)\d{2}/.test(t)) return EMERGENCY;
  return null;
}

/** ISO-дата из ячейки Excel → «дд.мм.гггг». */
const isoToRu = (s: string) => s.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3.$2.$1');

type Layout = { kind: 'html' | 'excel'; h: number; col: Record<string, number>; dataStart: number };

function detectLayout(sheet: Sheet): Layout | null {
  for (let i = 0; i < Math.min(sheet.rows.length, 30); i++) {
    const f = (sheet.rows[i] ?? []).map((v) => fold(v));
    if (f.includes('addr') && f.includes('lat') && f.includes('lon')) {
      const col: Record<string, number> = {};
      f.forEach((k, c) => { if (k) col[k] = c; });
      return { kind: 'html', h: i, col, dataStart: i + 1 };
    }
    if (f.some((v) => v.includes('мекен жай')) && f.some((v) => v.includes('ескерме'))) {
      const next = (sheet.rows[i + 1] ?? []).map((v) => fold(v));
      const col: Record<string, number> = {};
      const both = f.map((v, c) => `${v} ${next[c] ?? ''}`);
      both.forEach((v, c) => {
        if (/^№/.test(v)) col.n = c;
        else if (v.includes('мекен жай')) col.addr = c;
        else if (v.includes('салынган')) col.year = c;
        else if (v.includes('патер')) col.flats = c;
        else if (v.includes('кабат')) col.floors = c;
        else if (v.includes('ауданы')) col.area = c;
        else if (v.includes('ескерме')) col.note = c;
        else if (v.includes('координат')) col.coords = c;
      });
      if (col.addr == null) return null;
      return { kind: 'excel', h: i, col, dataStart: next.some(Boolean) ? i + 2 : i + 1 };
    }
  }
  return null;
}

export const emergencyProfile: Profile = {
  code: 'mkd_emergency',
  name: 'Аварийные и ветхие дома (карта или таблица «апатты үйлер тізімі»)',
  detect: (sheet) => detectLayout(sheet) != null,
  parse(sheet: Sheet): ParseResult {
    const fileIssues: Msg[] = [];
    const controlTotals: ControlTotal[] = [];
    const L = detectLayout(sheet);
    if (!L) throw new Error('Не найдены столбцы адреса и координат (addr/lat/lon или «Мекен жайы»/«координаты»)');
    for (const r of sheet.rows.slice(0, L.h)) {
      const t = (r ?? []).map(cellText).filter(Boolean).join(' ');
      if (t) fileIssues.push({ level: 'info', text: t });
    }
    const width = Math.max(...sheet.rows.map((r) => r?.length ?? 0));
    const headerCells = sheet.rows[L.h].map((v, c) => [cellText(v), cellText(sheet.rows[L.h + 1]?.[c])].filter(Boolean).join(' '));
    const labels = headerLabels(L.kind === 'excel' ? headerCells : sheet.rows[L.h], width);
    const records: ParsedRecord[] = [];
    let derived = 0;

    for (let i = L.dataStart; i < sheet.rows.length; i++) {
      const row = sheet.rows[i] ?? [];
      if (isEmptyRow(row)) continue;
      const rowNo = sheet.firstRow + i;
      const v = (k: string) => (L.col[k] != null ? row[L.col[k]] : null);
      const addr = str(v('addr'));
      // строка итога «Барлығы:» / «Итого»
      if (addr && /^(барлыгы|итого|всего)/.test(fold(addr))) {
        for (const [field, label, unit] of [['flats', 'количество квартир', 'кв.'], ['area_m2', 'площадь', 'м²']] as const) {
          const s0 = parseNumber(v(field === 'area_m2' ? 'area' : field));
          const stated = s0 == null ? null : Math.round(s0 * 100) / 100;
          if (stated == null) continue;
          const all = Math.round(records.reduce((s, r) => s + ((r.attrs[field] as number) ?? 0), 0) * 100) / 100;
          controlTotals.push({ label: `Строка «${addr}»: ${label}`, category: 'mkd_emergency', measure: 'sum', field, stated, statedRaw: cellText(v(field === 'area_m2' ? 'area' : field)), computed: null, unit, rowNo, match: null, note: `__above:${all}` });
        }
        continue;
      }
      if (!addr) {
        fileIssues.push({ level: 'warning', text: `Строка ${rowNo}: нет адреса — пропущена` });
        continue;
      }
      const messages: Msg[] = [];
      // примечание: дата ячейки Excel → дд.мм.гггг
      const noteCell = v('note');
      const note = noteCell == null ? null : isoToRu(cellText(noteCell));
      // категория: из цвета метки (HTML) или по правилу легенды (Excel)
      const statusRaw = L.kind === 'html' ? str(v('status')) : null;
      let status: string | null;
      if (statusRaw) {
        status = STATUS[statusRaw.toLowerCase()] ?? statusRaw;
        if (!STATUS[statusRaw.toLowerCase()]) messages.push({ level: 'warning', field: 'status', text: `Неизвестное значение статуса «${statusRaw}» — сохранено как есть` });
        const byRule = statusFromNote(note);
        if (byRule && byRule !== status) messages.push({ level: 'warning', field: 'status', text: `Цвет метки («${statusRaw}») не соответствует примечанию «${note}» по правилу легенды — проверьте` });
      } else {
        status = statusFromNote(note);
        if (status) derived++;
        else messages.push({ level: 'warning', field: 'status', text: `Категорию не удалось определить по примечанию «${note ?? ''}» — укажите вручную` });
      }
      // координаты: отдельные lat/lon или одна ячейка «47.09, 51.92»
      let lat: number | null = null;
      let lon: number | null = null;
      if (L.kind === 'html') {
        lat = parseNumber(v('lat'));
        lon = parseNumber(v('lon'));
      } else {
        const c = cellText(v('coords')).match(/(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)/);
        if (c) { lat = Number(c[1]); lon = Number(c[2]); }
        else if (v('coords') != null) messages.push({ level: 'warning', field: 'lat', text: `Координаты не распознаны: «${cellText(v('coords'))}»` });
      }
      if (lat == null || lon == null) messages.push({ level: 'warning', field: 'lat', text: 'Нет координат — дом не будет показан на карте' });
      else if (lat < 46.9 || lat > 47.3 || lon < 51.6 || lon > 52.2) messages.push({ level: 'warning', field: 'lat', text: `Координаты ${lat}, ${lon} за пределами г. Атырау — проверьте` });

      const attrs: Record<string, unknown> = {
        conclusion: note,
        floors: parseNumber(v('floors')),
        flats: parseNumber(v('flats')),
        area_m2: parseNumber(v('area')),
        no_in_list: v('n') == null ? null : cellText(v('n')),
      };
      // поля, которые есть только в данных карты, — без перезаписи при загрузке таблицы
      if (L.kind === 'html') {
        const streetRu = str(v('street_ru'));
        const house = str(v('house'));
        Object.assign(attrs, {
          address_ru: streetRu && house ? `${streetRu}, ${house}` : null,
          coord_source: str(v('acc')), map_status: statusRaw, street_kz: str(v('street_kz')), street_ru: streetRu, house,
        });
      }
      const shortStatus = status === EMERGENCY ? 'Аварийный' : status === DILAPIDATED ? 'Ветхий' : 'Дом';
      const key = looseBuildingKey(addr) ?? fold(addr).replace(/[\s,.]+/g, ' ').trim();
      const baseKey = `mkd_emergency:${key}`;
      records.push({
        rowNo, category: 'mkd_emergency', baseKey, naturalKey: baseKey,
        core: { name: `${shortStatus}: ${(attrs.address_ru as string) ?? addr}`, address_raw: addr, status, year_built: parseNumber(v('year')), lat, lon },
        attrs, raw: rawRow(labels, row), messages, valid: true,
      });
    }
    // строка итога: сравнение со всеми строками и со строками выше неё
    for (const t of controlTotals) {
      const above = Number(String(t.note).replace('__above:', ''));
      const all = Math.round(records.reduce((s, r) => s + ((r.attrs[t.field!] as number) ?? 0), 0) * 100) / 100;
      t.computed = all;
      t.match = t.stated != null && Math.abs(t.stated - all) < 0.05;
      t.note = !t.match && t.stated != null && Math.abs(t.stated - above) < 0.05
        ? `Итог совпадает с суммой только строк выше него (${above}); по всему перечню — ${all}. Вероятно, список пересортирован после подсчёта.`
        : undefined;
    }
    const red = records.filter((r) => r.core.status === EMERGENCY).length;
    const yellow = records.filter((r) => r.core.status === DILAPIDATED).length;
    if (derived) fileIssues.push({ level: 'info', text: `Категория определена по столбцу «Ескерме» по правилу легенды карты аварийных домов: есть дата заключения — аварийный; «жоқ» (нет) или «жөндеу» (ремонт) — ветхий. Определено для ${derived} домов.` });
    fileIssues.push({ level: 'info', text: `Записей: ${records.length}; аварийных: ${red}; ветхих: ${yellow}; без категории: ${records.length - red - yellow}; с координатами: ${records.filter((r) => r.core.lat != null && r.core.lon != null).length}.` });
    assignKeys(records);
    return { profile: 'mkd_emergency', profileName: this.name, sheet: sheet.name, records, fileIssues, controlTotals };
  },
};
