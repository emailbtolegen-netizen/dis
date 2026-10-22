/**
 * Карта жилого фонда (HTML, массив HOUSES: n, addr, year, area, flats, floors, wall, …, lat, lon).
 * Это копия реестра МЖД с проставленными координатами. Профиль только дополняет существующие дома
 * реестра координатами: новых домов не создаёт, данные реестра не перезаписывает,
 * а расхождения карты с реестром выводит предупреждениями.
 */
import { all } from '../../db/db.ts';
import { looseBuildingKey } from '../../domain/addressMatch.ts';
import { fold, parseAddress, parseNumber } from '../../domain/normalize.ts';
import type { Msg, ParsedRecord, ParseResult, Profile, Sheet } from '../types.ts';
import { cellText, isEmptyRow } from '../workbook.ts';
import { headerLabels, rawRow, str } from './common.ts';

const SOURCE = 'Карта жилого фонда (HTML)';

function headerIndex(sheet: Sheet): number {
  for (let i = 0; i < Math.min(sheet.rows.length, 30); i++) {
    const f = (sheet.rows[i] ?? []).map((v) => fold(v));
    if (['addr', 'lat', 'lon', 'flats', 'floors', 'wall'].every((k) => f.includes(k)) && !f.includes('status')) return i;
  }
  return -1;
}

type Mkd = { id: number; uid: string; natural_key: string; address_raw: string; year_built: number | null; lat: number | null; lon: number | null; a: Record<string, any> };

export const mkdGeoProfile: Profile = {
  code: 'mkd_geo',
  name: 'Координаты домов реестра МЖД (карта жилого фонда)',
  enrich: true,
  detect: (sheet) => headerIndex(sheet) >= 0,
  parse(sheet: Sheet): ParseResult {
    const h = headerIndex(sheet);
    if (h < 0) throw new Error('Не найдены столбцы addr / lat / lon / flats / floors / wall');
    const fileIssues: Msg[] = [];
    for (const r of sheet.rows.slice(0, h)) {
      const t = (r ?? []).map(cellText).filter(Boolean).join(' ');
      if (t) fileIssues.push({ level: 'info', text: t });
    }
    const f = sheet.rows[h].map((v) => fold(v));
    const col = (k: string) => f.indexOf(k);
    const width = Math.max(...sheet.rows.map((r) => r?.length ?? 0));
    const labels = headerLabels(sheet.rows[h], width);

    // дома реестра: по точному ключу адреса (без суффикса #2 у повторяющихся адресов) и по свободному ключу
    const mkd = all<any>(`SELECT id, uid, natural_key, address_raw, year_built, lat, lon, attrs FROM objects WHERE category = 'mkd' AND deleted_at IS NULL AND natural_key IS NOT NULL`)
      .map((o) => ({ ...o, a: JSON.parse(o.attrs || '{}') }) as Mkd);
    if (!mkd.length) throw new Error('В базе нет реестра МЖД — сначала импортируйте файл «МЖД 1240»');
    const exact = new Map<string, Mkd[]>();
    const loose = new Map<string, Mkd[]>();
    const push = (m: Map<string, Mkd[]>, k: string | null, o: Mkd) => { if (k) m.set(k, [...(m.get(k) ?? []), o]); };
    for (const o of mkd) {
      push(exact, o.natural_key.replace(/^mkd:/, '').replace(/#\d+$/, ''), o);
      push(loose, looseBuildingKey(o.address_raw), o);
    }

    type Row = { rowNo: number; row: unknown[]; addr: string; n: string | null; year: number | null; area: number | null; flats: number | null; floors: number | null; wall: string | null; lat: number | null; lon: number | null; cands: Mkd[]; how: string };
    const rows: Row[] = [];
    for (let i = h + 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i] ?? [];
      if (isEmptyRow(row)) continue;
      const v = (k: string) => (col(k) >= 0 ? row[col(k)] : null);
      const addr = str(v('addr'));
      if (!addr) { fileIssues.push({ level: 'warning', text: `Строка ${sheet.firstRow + i}: нет адреса — пропущена` }); continue; }
      const k1 = parseAddress(addr).buildingKey;
      const k2 = looseBuildingKey(addr);
      const byExact = (k1 && exact.get(k1)) || [];
      const cands = byExact.length ? byExact : (k2 && loose.get(k2)) || [];
      rows.push({
        rowNo: sheet.firstRow + i, row, addr, n: v('n') == null ? null : cellText(v('n')),
        year: parseNumber(v('year')), area: parseNumber(v('area')), flats: parseNumber(v('flats')), floors: parseNumber(v('floors')), wall: str(v('wall')),
        lat: parseNumber(v('lat')), lon: parseNumber(v('lon')), cands, how: byExact.length ? 'адрес' : 'адрес (нестрогое совпадение)',
      });
    }

    // при повторяющемся адресе — дом реестра с наиболее близкими площадью, квартирами и годом; каждый дом реестра используется один раз
    const score = (r: Row, o: Mkd) => (r.area != null && Math.abs(r.area - (o.a.area_m2 ?? NaN)) < 0.06 ? 2 : 0) + (r.flats === o.a.apartments ? 1 : 0) + (r.year === o.year_built ? 1 : 0);
    const pairs = rows.flatMap((r, ri) => r.cands.map((o) => ({ ri, o, s: score(r, o) }))).sort((a, b) => b.s - a.s);
    const target = new Map<number, Mkd>();
    const taken = new Set<number>();
    for (const p of pairs) {
      if (target.has(p.ri) || taken.has(p.o.id)) continue;
      target.set(p.ri, p.o);
      taken.add(p.o.id);
    }

    const records: ParsedRecord[] = [];
    const coordUse = new Map<string, number>();
    for (const r of rows) if (r.lat != null && r.lon != null) coordUse.set(`${r.lat},${r.lon}`, (coordUse.get(`${r.lat},${r.lon}`) ?? 0) + 1);
    let noCoords = 0, mismatched = 0;
    rows.forEach((r, ri) => {
      const o = target.get(ri);
      const messages: Msg[] = [];
      const raw = rawRow(labels, r.row);
      if (!o) {
        messages.push({ level: 'warning', text: r.cands.length
          ? `Дом «${r.addr}» уже сопоставлен с другой строкой карты (повтор адреса) — координаты не перенесены`
          : `Дом «${r.addr}» не найден в реестре МЖД — новый дом не создаётся, координаты не перенесены` });
        records.push({ rowNo: r.rowNo, category: 'mkd', baseKey: `mkd_geo:${r.addr}`, naturalKey: `mkd_geo:${r.addr}`, core: { name: r.addr, address_raw: r.addr }, attrs: {}, raw, messages, valid: false });
        return;
      }
      // расхождения с реестром — только для сведения, реестр не меняется
      const diffs: string[] = [];
      if (r.year != null && o.year_built != null && r.year !== o.year_built) diffs.push(`год постройки ${r.year} (в реестре ${o.year_built})`);
      if (r.area != null && typeof o.a.area_m2 === 'number' && Math.abs(r.area - o.a.area_m2) >= 0.06) diffs.push(`площадь ${r.area} (в реестре ${o.a.area_m2})`);
      if (r.flats != null && o.a.apartments != null && r.flats !== Number(o.a.apartments)) diffs.push(`квартир ${r.flats} (в реестре ${o.a.apartments})`);
      if (r.floors != null && o.a.floors != null && String(r.floors) !== String(o.a.floors)) diffs.push(`этажей ${r.floors} (в реестре ${o.a.floors})`);
      if (r.wall && o.a.wall_material && fold(r.wall).slice(0, 4) !== fold(o.a.wall_material).slice(0, 4)) diffs.push(`стены «${r.wall}» (в реестре «${o.a.wall_material}»)`);
      if (diffs.length) {
        mismatched++;
        messages.push({ level: 'warning', text: `Карта расходится с реестром МЖД (${o.uid}): ${diffs.join('; ')}. Реестр не изменён — проверьте.` });
      }
      if (r.addr !== o.address_raw) messages.push({ level: 'info', text: `Сопоставлено по адресу: «${r.addr}» → ${o.uid} «${o.address_raw}»` });
      const core: Record<string, unknown> = {};
      const attrs: Record<string, unknown> = {};
      if (r.lat == null || r.lon == null) {
        noCoords++;
        messages.push({ level: 'warning', text: 'На карте у дома нет координат — нечего переносить' });
      } else {
        if (r.lat < 46.9 || r.lat > 47.3 || r.lon < 51.6 || r.lon > 52.2) messages.push({ level: 'warning', field: 'lat', text: `Координаты ${r.lat}, ${r.lon} за пределами г. Атырау — проверьте` });
        const same = coordUse.get(`${r.lat},${r.lon}`)!;
        if (same > 1) messages.push({ level: 'info', field: 'lat', text: `Те же координаты указаны ещё у ${same - 1} дом(ов) — вероятно, точка квартала, а не дома` });
        Object.assign(core, { lat: r.lat, lon: r.lon });
        attrs.coord_source = SOURCE;
      }
      records.push({ rowNo: r.rowNo, category: 'mkd', baseKey: o.natural_key, naturalKey: o.natural_key, core, attrs, raw, messages, valid: true });
    });

    const matched = records.filter((r) => r.valid).length;
    fileIssues.push({ level: 'info', text: `Из файла переносятся только координаты домов: остальные сведения карты (год, площадь, квартиры, стены, отопление, лифты, управление) — копия реестра МЖД и реестра лифтов, они уже есть в системе и не перезаписываются.` });
    fileIssues.push({ level: 'info', text: `Домов на карте: ${rows.length}; найдено в реестре МЖД: ${matched} из ${mkd.length}; с координатами: ${matched - noCoords}; без координат: ${noCoords}; расходятся с реестром по характеристикам: ${mismatched}; не найдено: ${rows.length - matched}.` });
    return { profile: 'mkd_geo', profileName: this.name, sheet: sheet.name, records, fileIssues, controlTotals: [] };
  },
};
