import { isMultiAddress } from '../../domain/addressMatch.ts';
import { fold, parseAddress, parseNumber } from '../../domain/normalize.ts';
import type { ControlTotal, Msg, ParsedRecord, ParseResult, Profile, Sheet } from '../types.ts';
import { cellText, colLetter, isEmptyRow } from '../workbook.ts';
import { assignKeys, findHeaderRow, headerLabels, rawRow, str, val } from './common.ts';

/** Название организации из текста «КСК "Габит НК" Искалиева … 8701…»: кавычки → до скобки → до первой цифры. */
export function orgName(raw: string | null): string | null {
  if (!raw || /^\s*-\s*$/.test(raw)) return null;
  const s = raw.trim().replace(/^\(/, '');
  const q = s.match(/^(.*?(?:"[^"]*"|«[^»]*»|“[^”]*”))/);
  if (q) return q[1].replace(/\s+/g, ' ').trim();
  const cut = s.split(/\(|\d/)[0].replace(/[\s,;:]+$/, '').replace(/\s+/g, ' ').trim();
  return cut || null;
}

/** Обобщённое состояние по исходному тексту и числу нерабочих лифтов (исходный текст сохраняется отдельно). */
export function liftStatus(cond: string | null, total: number | null, broken: number | null): string {
  const c = fold(cond);
  if (/демонтаж|лифта нет/.test(c)) return 'Лифт отсутствует (демонтирован)';
  if (broken != null && broken > 0) return total != null && broken >= total ? 'Все лифты не работают' : 'Часть лифтов не работает';
  if (!c) return 'Состояние не указано';
  if (/не работа|закрыт/.test(c)) return 'Есть неработающие лифты (по описанию)';
  if (/работа/.test(c)) return 'Лифты работают';
  return 'Иное (см. исходный текст)';
}

/** Признаки, требующие внимания, выделенные из исходных формулировок. */
export function liftAttention(cond: string | null, note: string | null): string | null {
  const t = fold(`${cond ?? ''} ${note ?? ''}`);
  const out: string[] = [];
  if (/кап\.?\s*ремонт/.test(t)) out.push('Требуется кап. ремонт');
  if (/на модернизацию/.test(t)) out.push('Направлены на модернизацию (имеется ПСД)');
  if (/истекш|истекл/.test(t)) out.push('Истёк срок эксплуатации');
  else if (/истекает/.test(t)) out.push('Истекает срок эксплуатации');
  if (/демонтаж/.test(t)) out.push('Лифт демонтирован');
  return out.length ? out.join('; ') : null;
}

const COLS: [string, string][] = [
  ['адрес дома', 'address'],
  ['состояние лифтов', 'condition_raw'],
  ['примечание', 'note'],
  ['кол-во этажей', 'floors'],
  ['кол-во подъездов', 'entrances'],
  ['общее кол-во лифтов', 'lifts_total'],
  ['нерабочем', 'lifts_broken'],
  ['орган управления', 'management_raw'],
  ['обслуживающие лифты', 'service_raw'],
];

const SUMS: [string, string][] = [
  ['lifts_total', 'Общее количество лифтов'],
  ['lifts_passenger', 'Пассажирских'],
  ['lifts_freight', 'Грузопассажирских'],
  ['lifts_broken', 'Лифтов в нерабочем состоянии'],
  ['broken_passenger', 'Нерабочих пассажирских'],
  ['broken_freight', 'Нерабочих грузопассажирских'],
];

export const liftsProfile: Profile = {
  code: 'lifts',
  name: 'Лифты многоквартирных жилых домов',
  detect: (sheet) => findHeaderRow(sheet, 'Состояние лифтов') >= 0 && findHeaderRow(sheet, 'кол-во лифтов') >= 0,
  parse(sheet: Sheet): ParseResult {
    const fileIssues: Msg[] = [];
    const controlTotals: ControlTotal[] = [];
    const h = findHeaderRow(sheet, 'Состояние лифтов');
    if (h < 0) throw new Error('Не найдена строка заголовков («Состояние лифтов»)');
    const header = sheet.rows[h];
    const width = Math.max(...sheet.rows.map((r) => r?.length ?? 0));
    const labels = headerLabels(header, width);
    const col = new Map<string, number>();
    header.forEach((v, c) => {
      const f = fold(v);
      if (f === '№') col.set('no', c);
      for (const [needle, key] of COLS) if (f.includes(fold(needle)) && !col.has(key)) col.set(key, c);
    });
    for (const req of ['address', 'lifts_total', 'lifts_broken']) if (!col.has(req)) throw new Error(`Не найден обязательный столбец (${req})`);
    // «Пассажирских / Грузопассажирских» — два столбца после общего количества и два после нерабочих
    const t = col.get('lifts_total')!;
    const b = col.get('lifts_broken')!;
    col.set('lifts_passenger', t + 1).set('lifts_freight', t + 2).set('broken_passenger', b + 1).set('broken_freight', b + 2);
    if (!fold(header[t + 1]).startsWith('пассаж') || !fold(header[b + 1]).startsWith('пассаж')) {
      fileIssues.push({ level: 'warning', text: 'Порядок столбцов «Пассажирских / Грузопассажирских» отличается от ожидаемого — проверьте отчёт.' });
    }
    const known = new Set(col.values());
    const extra: number[] = [];
    for (let c = 0; c < width; c++) {
      if (!known.has(c) && sheet.rows.slice(h + 1).some((r) => r?.[c] != null && String(r[c]).trim() !== '')) extra.push(c);
    }
    for (const c of extra) fileIssues.push({ level: 'warning', text: `Столбец ${colLetter(c)} («${cellText(header[c]) || 'без заголовка'}») не сопоставлен с полями — значения сохранены в исходной строке записи.` });

    const records: ParsedRecord[] = [];
    const nos: number[] = [];
    const yearOnlyNotes: number[] = [];
    for (let i = h + 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i] ?? [];
      if (isEmptyRow(row)) continue;
      const rowNo = sheet.firstRow + i;
      const get = (k: string) => (col.has(k) ? row[col.get(k)!] : null);
      const address = str(get('address'));
      if (address && /^всего/i.test(address)) {
        for (const [key, label] of SUMS) {
          const v = parseNumber(get(key));
          controlTotals.push({ label: `Итог «Всего»: ${label}`, category: 'mkd_lifts', measure: 'sum', field: key, stated: v, statedRaw: String(get(key) ?? '—'), computed: null, unit: 'шт.', rowNo, match: null });
        }
        continue;
      }
      if (!address) {
        records.push({ rowNo, category: 'mkd_lifts', baseKey: '', naturalKey: '', core: {}, attrs: {}, raw: rawRow(labels, row), messages: [{ level: 'error', text: 'Не указан адрес дома' }], valid: false });
        continue;
      }
      const messages: Msg[] = [];
      const num = (k: string): number | null => {
        const v = get(k);
        if (v == null || String(v).trim() === '') return null;
        const n = parseNumber(v);
        if (n == null) messages.push({ level: 'warning', field: k, text: `Значение не распознано как число: «${cellText(v)}»` });
        return n;
      };
      const total = num('lifts_total');
      const pass = num('lifts_passenger');
      const freight = num('lifts_freight');
      const broken = num('lifts_broken');
      const bPass = num('broken_passenger');
      const bFreight = num('broken_freight');
      const entrances = num('entrances');
      const cond = str(get('condition_raw'));
      const noteVal = val(get('note'));
      const note = noteVal == null ? null : String(noteVal);
      const floorsRaw = val(get('floors'));
      const management = str(get('management_raw'));
      const service = str(get('service_raw'));

      if (total == null) messages.push({ level: 'warning', field: 'lifts_total', text: 'Не указано общее количество лифтов' });
      if (total != null && (pass != null || freight != null) && (pass ?? 0) + (freight ?? 0) !== total) {
        messages.push({ level: 'warning', field: 'lifts_total', text: `Общее количество (${total}) не равно сумме пассажирских (${pass ?? '—'}) и грузопассажирских (${freight ?? '—'})` });
      }
      if (total != null && pass == null && freight == null) messages.push({ level: 'info', field: 'lifts_passenger', text: 'Не указано распределение на пассажирские и грузопассажирские' });
      if (broken != null && total != null && broken > total) messages.push({ level: 'warning', field: 'lifts_broken', text: `Нерабочих (${broken}) больше, чем всего лифтов (${total})` });
      if (broken != null && (bPass != null || bFreight != null) && (bPass ?? 0) + (bFreight ?? 0) !== broken) {
        messages.push({ level: 'warning', field: 'lifts_broken', text: `Нерабочих всего (${broken}) не равно сумме по типам (${bPass ?? '—'} + ${bFreight ?? '—'})` });
      }
      const c = fold(cond);
      if (!cond) messages.push({ level: 'warning', field: 'condition_raw', text: 'Не указано состояние лифтов' });
      if (/не работа|закрыт/.test(c) && !broken) messages.push({ level: 'warning', field: 'lifts_broken', text: 'В описании указано, что лифты не работают/закрыты, но количество нерабочих лифтов не заполнено' });
      if (broken && /^лифты? работа/.test(c) && !/не работа/.test(c)) messages.push({ level: 'warning', field: 'lifts_broken', text: `В описании «${cond}», но указано нерабочих лифтов: ${broken}` });
      if (typeof noteVal === 'number' || /^\s*(19|20)\d{2}\s*$/.test(note ?? '')) {
        yearOnlyNotes.push(rowNo);
        messages.push({ level: 'info', field: 'note', text: `В «Примечании» указан только год (${note}); его значение (установка, ввод, договор?) в файле не пояснено — сохранено как есть` });
      }
      const multi = isMultiAddress(address);
      if (multi) messages.push({ level: 'warning', field: 'address_raw', text: 'В строке указано несколько домов/блоков — автоматическая привязка к МЖД не выполняется, требуется ручная проверка' });
      const mod = (note ?? '').match(/модернизац\S*\s+в\s+((?:19|20)\d{2})/i);
      const noCell = get('no');
      if (typeof noCell === 'number') nos.push(noCell);

      const baseKey = `mkd_lifts:${fold(address).replace(/[\s,.]+/g, ' ').trim()}`;
      records.push({
        rowNo,
        category: 'mkd_lifts',
        baseKey,
        naturalKey: baseKey,
        core: { name: `Лифты: ${address}`, address_raw: address, status: liftStatus(cond, total, broken) },
        attrs: {
          condition_raw: cond,
          note: noteVal,
          attention: liftAttention(cond, note),
          lifts_total: total,
          lifts_passenger: pass,
          lifts_freight: freight,
          lifts_broken: broken,
          broken_passenger: bPass,
          broken_freight: bFreight,
          floors: typeof floorsRaw === 'number' ? floorsRaw : floorsRaw == null ? null : String(floorsRaw),
          entrances,
          ramp: /пандус/.test(c) ? 'есть' : null,
          modernization_year: mod ? Number(mod[1]) : null,
          management_org: orgName(management),
          management_raw: management,
          service_company: orgName(service),
          service_raw: service,
          multi_address: multi ? 'да' : null,
          no_in_list: noCell == null ? null : cellText(noCell),
        },
        raw: rawRow(labels, row),
        messages,
        valid: true,
      });
    }

    // пропуски нумерации
    const gaps: string[] = [];
    for (let i = 1; i < nos.length; i++) if (nos[i] > nos[i - 1] + 1) gaps.push(`${nos[i - 1]} → ${nos[i]}`);
    if (gaps.length) fileIssues.push({ level: 'warning', text: `Пропуски в нумерации: ${gaps.join('; ')}. Строк с домами: ${records.filter((r) => r.valid).length}, последний № = ${nos[nos.length - 1]}.` });
    if (yearOnlyNotes.length) {
      fileIssues.push({ level: 'info', text: `В строках ${yearOnlyNotes[0]}–${yearOnlyNotes[yearOnlyNotes.length - 1]} (${yearOnlyNotes.length} шт.) в «Примечании» указан только год; по составу (другие обслуживающие организации) это, вероятно, более поздний дополнительный перечень. Значение года не пояснено — сохранено как есть.` });
    }

    // один дом в нескольких строках (разные формулировки адреса) — не объединяется
    const byBuilding = new Map<string, ParsedRecord[]>();
    for (const r of records) {
      if (!r.valid || r.attrs.multi_address) continue;
      const k = parseAddress(String(r.core.address_raw).replace(/[«"][^»"]*[»"]/g, ' ')).buildingKey;
      if (k) byBuilding.set(k, [...(byBuilding.get(k) ?? []), r]);
    }
    let sameHouse = 0;
    for (const list of byBuilding.values()) {
      if (list.length < 2) continue;
      sameHouse++;
      for (const r of list) {
        r.messages.push({ level: 'info', text: `По этому дому в файле ${list.length} строки (${list.map((x) => x.rowNo).join(', ')}) — возможно, обновлённые сведения. Записи сохранены отдельно, итоговые суммы файла их учитывают повторно.` });
      }
    }
    if (sameHouse) fileIssues.push({ level: 'warning', text: `${sameHouse} дом(ов) встречаются в файле более одного раза (разные строки, иногда с разным состоянием). Записи не объединены; итог «Всего» в файле считает такие лифты повторно.` });

    assignKeys(records);
    const valid = records.filter((r) => r.valid);
    for (const ct of controlTotals) {
      ct.computed = valid.reduce((s, r) => s + (typeof r.attrs[ct.field!] === 'number' ? (r.attrs[ct.field!] as number) : 0), 0);
      ct.match = ct.stated == null ? null : ct.computed === ct.stated;
    }
    return { profile: 'lifts', profileName: this.name, sheet: sheet.name, records, fileIssues, controlTotals };
  },
};
