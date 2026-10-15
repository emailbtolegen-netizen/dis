/** Капитальный ремонт МЖД (список на год) и потребность на развитие дорожной инфраструктуры. */
import { fold, parseNumber } from '../../domain/normalize.ts';
import type { ControlTotal, Msg, ParsedRecord, ParseResult, Profile, Sheet } from '../types.ts';
import { cellText, isEmptyRow } from '../workbook.ts';
import { assignKeys, findHeaderRow, headerLabels, rawRow, str } from './common.ts';

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Вид работ из пояснения в адресе: «( 3-лифта)», «(кап ремонт)», «СМР (кровля)», «(СМР)». */
export function workType(address: string): string {
  const f = fold(address);
  if (/лифт/.test(f)) return 'Лифт';
  if (/кровл/.test(f)) return 'Кровля';
  if (/кап\.?\s*ремонт|капремонт/.test(f)) return 'Капитальный ремонт';
  if (/(?<![\p{L}])смр(?![\p{L}])/u.test(f)) return 'СМР';
  return 'Не указан';
}

/** Номер подъезда: «2-й подъезд», «подъезд №3», «1 подьезд», «(подьезд№3)», «(подъезды 1, 2)». */
export function entranceOf(address: string): string | null {
  const f = fold(address);
  const many = f.match(/под[ъь]езды\s*([\d,\s]+)/);
  if (many) return many[1].replace(/\s+/g, '').replace(/,$/, '');
  const a = f.match(/(\d+)\s*-?\s*(?:й|ой)?\s*-?\s*под[ъь]езд/);
  if (a) return a[1];
  const b = f.match(/под[ъь]езд\S*\s*№?\s*(\d+)/);
  return b ? b[1] : null;
}

export const repairProfile: Profile = {
  code: 'capital_repair',
  name: 'Список домов на капитальный ремонт',
  detect: (sheet) => findHeaderRow(sheet, 'подлежащих капитальному ремонту', 3) >= 0,
  parse(sheet: Sheet): ParseResult {
    const fileIssues: Msg[] = [];
    const controlTotals: ControlTotal[] = [];
    const title = sheet.rows.slice(0, 3).flat().map(cellText).filter(Boolean).join(' ');
    const year = Number(title.match(/на\s*(20\d{2})\s*год/)?.[1] ?? NaN);
    if (title) fileIssues.push({ level: 'info', text: `Заголовок: «${title}»` });
    const h = findHeaderRow(sheet, 'Сметный расчет');
    if (h < 0) throw new Error('Не найдена строка заголовков («Сметный расчет»)');
    const header = sheet.rows[h];
    const labels = headerLabels(header, Math.max(...sheet.rows.map((r) => r?.length ?? 0)));
    const col: Record<string, number> = {};
    header.forEach((v, c) => {
      const f = fold(v);
      if (f === 'адрес') col.address = c;
      else if (f.includes('сметный')) col.smr = c;
      else if (f.includes('авторский')) col.author = c;
      else if (f.includes('технический')) col.tech = c;
      else if (f === 'всего') col.total = c;
    });
    for (const k of ['address', 'smr', 'author', 'tech', 'total']) if (col[k] == null) throw new Error(`Не найден столбец: ${k}`);
    const fields: [string, string][] = [['smr', 'smr_kzt'], ['author', 'author_kzt'], ['tech', 'tech_kzt'], ['total', 'total_kzt']];
    const records: ParsedRecord[] = [];
    const nos: number[] = [];
    for (let i = h + 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i] ?? [];
      if (isEmptyRow(row)) continue;
      const rowNo = sheet.firstRow + i;
      const address = str(row[col.address]);
      if (address && /^итого/i.test(address)) {
        for (const [c, f] of fields) {
          const stated = parseNumber(row[col[c]]);
          const computed = round(records.reduce((s, r) => s + ((r.attrs[f] as number) ?? 0), 0));
          controlTotals.push({ label: `Итого: ${labelOf(f)}`, category: 'capital_repair', measure: 'sum', field: f, stated, statedRaw: String(row[col[c]] ?? '—'), computed, unit: '₸', rowNo, match: stated == null ? null : Math.abs(stated - computed) < 1 });
        }
        continue;
      }
      // подписи под таблицей: «67 лифт», «45 СМР»
      const footer = address?.match(/^(\d+)\s*(лифт|смр)/i);
      if (row[0] == null && footer) {
        const stated = Number(footer[1]);
        const isLift = /лифт/i.test(footer[2]);
        const computed = records.filter((r) => (r.attrs.work_type === 'Лифт') === isLift).length;
        controlTotals.push({ label: `Подпись «${address}»: ${isLift ? 'строк с лифтами' : 'строк с СМР (капремонт, кровля и др.)'}`, category: 'capital_repair', measure: 'count', stated, statedRaw: address!, computed, unit: 'стр.', rowNo, match: stated === computed });
        continue;
      }
      if (!address) {
        fileIssues.push({ level: 'warning', text: `Строка ${rowNo}: нет адреса — пропущена` });
        continue;
      }
      const messages: Msg[] = [];
      const attrs: Record<string, unknown> = {};
      for (const [c, f] of fields) {
        const v = row[col[c]];
        const n = parseNumber(v);
        if (v != null && n == null) messages.push({ level: 'warning', field: f, text: `Сумма не распознана: «${cellText(v)}»` });
        if (v == null) messages.push({ level: 'warning', field: f, text: `Не указано: ${labelOf(f)}` });
        attrs[f] = n == null ? null : round(n);
      }
      const parts = ['smr_kzt', 'author_kzt', 'tech_kzt'].reduce((s, f) => s + ((attrs[f] as number) ?? 0), 0);
      if (attrs.total_kzt != null && Math.abs(parts - (attrs.total_kzt as number)) >= 1) {
        messages.push({ level: 'warning', field: 'total_kzt', text: `«Всего» (${attrs.total_kzt}) отличается от суммы СМР + авторский + технический надзор (${round(parts)}) на ${round((attrs.total_kzt as number) - parts)} ₸` });
      }
      attrs.work_type = workType(address);
      attrs.entrance = entranceOf(address);
      attrs.program_year = Number.isFinite(year) ? year : null;
      const no = row[0];
      attrs.no_in_list = no == null ? null : cellText(no);
      if (typeof no === 'number') nos.push(no);
      const baseKey = `capital_repair:${attrs.program_year ?? ''}:${fold(address).replace(/[\s,.]+/g, ' ').trim()}`;
      records.push({
        rowNo, category: 'capital_repair', baseKey, naturalKey: baseKey,
        core: { name: `Капремонт ${attrs.program_year ?? ''}: ${address}`.replace('  ', ' '), address_raw: address },
        attrs, raw: rawRow(labels, row), messages, valid: true,
      });
    }
    const gaps: string[] = [];
    for (let i = 1; i < nos.length; i++) if (nos[i] !== nos[i - 1] + 1) gaps.push(`${nos[i - 1]} → ${nos[i]}`);
    if (gaps.length) fileIssues.push({ level: 'warning', text: `Нарушение порядковой нумерации: ${gaps.join('; ')}` });
    assignKeys(records);
    return { profile: 'capital_repair', profileName: this.name, sheet: sheet.name, records, fileIssues, controlTotals };
  },
};

function labelOf(f: string): string {
  return ({ smr_kzt: 'СМР', author_kzt: 'авторский надзор', tech_kzt: 'технический надзор', total_kzt: 'всего' } as Record<string, string>)[f] ?? f;
}

// ───────────────────────────── Дорожная инфраструктура ─────────────────────────────

export const roadsProfile: Profile = {
  code: 'road_needs',
  name: 'Потребность на развитие дорожной инфраструктуры',
  detect: (sheet) => findHeaderRow(sheet, 'Наименование трансфертов', 6) >= 0,
  parse(sheet: Sheet): ParseResult {
    const fileIssues: Msg[] = [];
    const controlTotals: ControlTotal[] = [];
    const h = findHeaderRow(sheet, 'Наименование трансфертов');
    const header = sheet.rows[h];
    const sub = sheet.rows[h + 2] ?? [];
    const width = Math.max(...sheet.rows.map((r) => r?.length ?? 0));
    const title = sheet.rows.slice(0, h).flat().map(cellText).filter(Boolean).join(' ');
    if (title) fileIssues.push({ level: 'info', text: `Заголовок листа «${sheet.name}»: «${title}»` });
    const col: Record<string, number> = {};
    header.forEach((v, c) => {
      const f = fold(v);
      if (f.includes('наименование')) col.name = c;
      else if (f.includes('общая стоимость')) col.total_cost = c;
      else if (f.startsWith('до ')) { col.before_rb = c; col.before_mb = c + 1; }
      else if (f.includes('выделено')) { col.alloc_2022_rb = c; col.alloc_2022_mb = c + 1; }
      else if (f.includes('дополнительно')) col.additional_rb_2022 = c;
      else if (f.includes('отработано')) col.prelim_done = c;
      else if (/^20\d{2} год$/.test(f)) col.y2022 = c;
    });
    if (col.name == null || col.total_cost == null) throw new Error('Не найдены столбцы «Наименование трансфертов» / «Общая стоимость»');
    const labels = headerLabels(header.map((v, c) => [cellText(v) || cellText(header[c - 1]), cellText(sub[c])].filter(Boolean).join(' — ')), width);
    const numFields = Object.keys(col).filter((k) => k !== 'name');
    const records: ParsedRecord[] = [];
    let ministry: string | null = null;
    let groupStart = 0;
    const groupTotals: { name: string; row: unknown[]; rowNo: number; start: number }[] = [];
    let grand: { row: unknown[]; rowNo: number } | null = null;
    const nos: number[] = [];
    const dupNos: string[] = [];
    for (let i = h + 3; i < sheet.rows.length; i++) {
      const row = sheet.rows[i] ?? [];
      if (isEmptyRow(row)) continue;
      const rowNo = sheet.firstRow + i;
      const a = cellText(row[0]);
      const name = str(row[col.name]);
      if (/^итого/i.test(fold(name))) { grand = { row, rowNo }; continue; }
      if (a && !/^\d+$/.test(a)) {
        // строка администратора программы (министерства) с подытогом
        if (groupTotals.length) groupTotals[groupTotals.length - 1].start = groupStart;
        ministry = a;
        nos.length = 0;
        groupStart = records.length;
        groupTotals.push({ name: a, row, rowNo, start: groupStart });
        continue;
      }
      if (!name) continue;
      const messages: Msg[] = [];
      const attrs: Record<string, unknown> = { sheet: sheet.name, ministry, no_in_list: a };
      for (const f of numFields) {
        const v = row[col[f]];
        const n = parseNumber(v);
        if (v != null && n == null) messages.push({ level: 'warning', field: f, text: `Значение не распознано: «${cellText(v)}»` });
        attrs[f] = n == null ? null : round(n, 3);
      }
      attrs.in_city = /г\.?\s*атырау|городе атырау/i.test(name) ? 'да' : 'нет';
      if (/^\d+$/.test(a)) {
        if (nos.includes(Number(a))) dupNos.push(`${a} (${ministry ?? 'без раздела'})`);
        nos.push(Number(a));
      }
      const baseKey = `road_needs:${fold(sheet.name)}:${fold(name).replace(/\s+/g, ' ')}`;
      records.push({ rowNo, category: 'road_needs', baseKey, naturalKey: baseKey, core: { name }, attrs, raw: rawRow(labels, row), messages, valid: true });
    }
    // подытоги по министерствам и общий итог
    groupTotals.forEach((g, idx) => {
      const end = idx + 1 < groupTotals.length ? groupTotals[idx + 1].start : records.length;
      const scope = records.slice(g.start, end);
      for (const f of numFields) {
        const stated = parseNumber(g.row[col[f]]);
        if (stated == null) continue;
        const computed = round(scope.reduce((s, r) => s + ((r.attrs[f] as number) ?? 0), 0), 3);
        controlTotals.push({ label: `«${sheet.name}», ${g.name}: ${labels[col[f]]?.replace(/^[A-Z]+: /, '')}`, category: 'road_needs', measure: 'sum', field: f, filter: { sheet: sheet.name, ministry: g.name }, stated, statedRaw: cellText(g.row[col[f]]), computed, unit: 'тыс. ₸', rowNo: g.rowNo, match: Math.abs(stated - computed) < 0.5 });
      }
    });
    if (grand) {
      for (const f of numFields) {
        const stated = parseNumber(grand.row[col[f]]);
        if (stated == null) continue;
        const computed = round(records.reduce((s, r) => s + ((r.attrs[f] as number) ?? 0), 0), 3);
        const sameAsGroup = groupTotals.find((g) => Math.abs((parseNumber(g.row[col[f]]) ?? NaN) - stated) < 0.5);
        const note = Math.abs(stated - computed) >= 0.5 && sameAsGroup && groupTotals.length > 1
          ? `Итог в файле равен подытогу раздела «${sameAsGroup.name}»: остальные разделы в «ИТОГО» не включены.` : undefined;
        controlTotals.push({ note, label: `«${sheet.name}», ИТОГО: ${labels[col[f]]?.replace(/^[A-Z]+: /, '')}`, category: 'road_needs', measure: 'sum', field: f, filter: { sheet: sheet.name }, stated, statedRaw: cellText(grand.row[col[f]]), computed, unit: 'тыс. ₸', rowNo: grand.rowNo, match: Math.abs(stated - computed) < 0.5 });
      }
    }
    if (dupNos.length) fileIssues.push({ level: 'warning', text: `В листе «${sheet.name}» повторяются порядковые номера внутри раздела: ${dupNos.join(', ')}` });
    fileIssues.push({ level: 'info', text: `Лист «${sheet.name}» относится к дорожной инфраструктуре области (не к дворам), импортирован в раздел «Дорожная инфраструктура». Объектов за пределами г. Атырау: ${records.filter((r) => r.attrs.in_city === 'нет').length}.` });
    assignKeys(records);
    return { profile: 'road_needs', profileName: this.name, sheet: sheet.name, records, fileIssues, controlTotals };
  },
};
