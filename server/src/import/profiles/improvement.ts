/**
 * Благоустройство и озеленение:
 *  - yard_contracts  — «Сводная таблица по объектам благоустройства дворовых территорий» (лоты, договоры, освоение);
 *  - yards_approved  — утверждённый перечень дворов (адрес, площадь, согласования);
 *  - yards_design    — перечни адресов проектных организаций и лист «НЕ РЕАЛИЗОВАННЫЕ ДВОРА»;
 *  - green_inventory — инвентаризация зелёных насаждений.
 */
import { expandHouses } from '../../domain/addressList.ts';
import { clean, fold, parseNumber } from '../../domain/normalize.ts';
import type { ControlTotal, Msg, ParsedRecord, ParseResult, Profile, Sheet } from '../types.ts';
import { cellText, isEmptyRow } from '../workbook.ts';
import { assignKeys, findHeaderRow, headerLabels, rawRow, str } from './common.ts';

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const near = (a: number | null, b: number | null, eps = 0.01) => a != null && b != null && Math.abs(a - b) <= eps;

/** Итог по полю attrs для подмножества записей. */
function sumTotal(label: string, category: string, field: string, stated: unknown, recs: ParsedRecord[], unit: string, rowNo: number, filter?: Record<string, string>): ControlTotal {
  const s = parseNumber(stated);
  const computed = round(recs.reduce((acc, r) => acc + (typeof r.attrs[field] === 'number' ? (r.attrs[field] as number) : 0), 0), 3);
  return { label, category, field, filter, measure: 'sum', stated: s, statedRaw: String(stated ?? '—'), computed, unit, rowNo, match: s == null ? null : near(s, computed, 0.05) };
}

// ───────────────────────────── Договоры благоустройства дворов ─────────────────────────────

const ROLES = ['Подрядчик', 'Технический надзор', 'Авторский надзор'];

export const yardContractsProfile: Profile = {
  code: 'yard_contracts',
  name: 'Благоустройство дворов: сводная таблица договоров и освоения',
  detect: (sheet) => findHeaderRow(sheet, 'благоустройства дворовых территорий', 3) >= 0 && findHeaderRow(sheet, 'Подрядчик', 5) >= 0,
  parse(sheet: Sheet): ParseResult {
    const fileIssues: Msg[] = [];
    const controlTotals: ControlTotal[] = [];
    const h = findHeaderRow(sheet, 'Наименование объектов');
    if (h < 0) throw new Error('Не найдена строка заголовков («Наименование объектов»)');
    const header = sheet.rows[h];
    const sub = sheet.rows[h + 1] ?? [];
    const width = Math.max(...sheet.rows.map((r) => r?.length ?? 0));
    const labels = headerLabels(header.map((v, c) => v ?? sub[c]), width);
    const col: Record<string, number> = {};
    header.forEach((v, c) => {
      const f = fold(v);
      if (f.includes('наименование объектов')) col.name = c;
      else if (f.includes('договор')) col.contract = c;
      else if (f.includes('подрядчик')) col.company = c;
      else if (f.includes('до корректировки')) col.cost_before = c;
      else if (f.includes('после корректировки')) col.cost_after = c;
      else if (/2022-2026/.test(f)) col.spent_total = c;
      else if (f.includes('освоено')) {
        const y = f.match(/(20\d{2})\s*год/);
        if (y) col[`spent_${y[1]}`] = c;
      } else if (f.includes('необходимо')) col.remaining = c;
      else if (f.includes('кол-во дворов')) col.yards_count = c;
      else if (f.includes('адреса домов')) col.addresses = c;
    });
    sub.forEach((v, c) => {
      if (fold(v) === 'домов') col.houses_count = c;
    });
    for (const req of ['name', 'company', 'cost_after', 'addresses']) if (col[req] == null) throw new Error(`Не найден столбец: ${req}`);
    const title = sheet.rows.slice(0, h).flat().map(cellText).filter(Boolean).join(' ');
    if (title) fileIssues.push({ level: 'info', text: `Заголовок листа: «${title}»` });
    const yearCols = Object.keys(col).filter((k) => /^spent_20\d{2}$/.test(k));
    const numFields = ['cost_before', 'cost_after', ...yearCols, 'spent_total', 'remaining'];

    const records: ParsedRecord[] = [];
    let lot: { no: string; name: string; status: string | null; rows: ParsedRecord[] } | null = null;
    let groupStart = 0;
    const lotsByContract = new Map<string, string[]>();

    for (let i = h + 2; i < sheet.rows.length; i++) {
      const row = sheet.rows[i] ?? [];
      if (isEmptyRow(row)) continue;
      const rowNo = sheet.firstRow + i;
      const name = str(row[col.name]);
      const company = str(row[col.company]);
      // строки итогов: «ИТОГО, ТОО "…":», «ВСЕГО:»
      if (name && /^(итого|всего)/i.test(name)) {
        const isGrand = /^всего/i.test(name);
        const groupName = isGrand ? null : name.replace(/^итого,?\s*/i, '').replace(/:$/, '').trim();
        const scope = isGrand ? records : records.slice(groupStart);
        if (groupName) for (const r of scope) r.attrs.group = groupName;
        for (const f of numFields) {
          const stated = row[col[f]];
          if (stated == null) continue;
          const ct = sumTotal(`${isGrand ? 'ВСЕГО' : name.replace(/:$/, '')}: ${labelOf(f)}`, 'yard_contracts', f, stated, scope, 'тыс. ₸', rowNo);
          if (ct.match === false && f === 'spent_total') {
            const byYears = round(scope.reduce((a, r) => a + yearCols.reduce((s, y) => s + ((r.attrs[y] as number) ?? 0), 0), 0), 3);
            ct.note = `Сумма освоения по годам 2022–2026 по строкам = ${byYears} тыс. ₸.`;
          }
          controlTotals.push(ct);
        }
        if (col.yards_count != null && row[col.yards_count] != null) {
          const stated = parseNumber(row[col.yards_count]);
          const computed = scope.filter((r) => r.attrs.role === 'Подрядчик').reduce((a, r) => a + ((r.attrs.yards_count as number) ?? 0), 0);
          controlTotals.push({ label: `${isGrand ? 'ВСЕГО' : name.replace(/:$/, '')}: количество дворов`, category: 'yard_contracts', measure: 'sum', field: 'yards_count', stated, statedRaw: String(row[col.yards_count]), computed, unit: 'дв.', rowNo, match: stated == null ? null : stated === computed });
        }
        if (!isGrand) groupStart = records.length;
        lot = null;
        continue;
      }
      const noCell = cellText(row[0]);
      if (/^\d+$/.test(noCell) && name) {
        const status = name.match(/\(([^)]*ПСД[^)]*)\)/i)?.[1]?.trim() ?? null;
        lot = { no: noCell, name: clean(name.replace(/\([^)]*ПСД[^)]*\)/i, ''))!, status, rows: [] };
      }
      if (!lot || !company) {
        fileIssues.push({ level: 'warning', text: `Строка ${rowNo}: не удалось отнести к лоту — пропущена («${row.map(cellText).filter(Boolean).join(' | ').slice(0, 120)}»)` });
        continue;
      }
      const role = ROLES[lot.rows.length] ?? 'Прочее';
      const messages: Msg[] = [];
      const attrs: Record<string, unknown> = {
        role, company, contract: str(row[col.contract]), project_status: lot.status, lot_no: lot.no, group: null,
      };
      for (const f of numFields) {
        const v = row[col[f]];
        const n = parseNumber(v);
        if (v != null && n == null) messages.push({ level: 'warning', field: f, text: `Значение не распознано как число: «${cellText(v)}»` });
        attrs[f] = n == null ? null : round(n, 5);
      }
      if (role === 'Подрядчик') {
        attrs.yards_count = col.yards_count != null ? parseNumber(row[col.yards_count]) : null;
        attrs.houses_count = col.houses_count != null ? parseNumber(row[col.houses_count]) : null;
        const addr = row[col.addresses] == null ? null : String(row[col.addresses]);
        attrs.addresses = addr;
        // улица по умолчанию из наименования лота: «(дома в проспекте Азаттык)», «(дома в мкр.Алмагуль)»
        const def = lot.name.match(/дома в (проспекте\s+[\p{L}-]+|мкр\.?\s*[\p{L}-]+)(?=\)|$)/u)?.[1]?.replace(/^проспекте/i, 'проспект') ?? null;
        let street: string | null = def;
        const houses: string[] = [];
        const lines = (addr ?? '').split(/\n|(?<=\))\s+(?=дома)/).map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          const r = expandHouses(line, street);
          street = r.street ?? street;
          for (const x of r.houses) if (!houses.includes(x)) houses.push(x);
        }
        attrs.houses_list = houses.length ? houses.join('; ') : null;
        if (attrs.yards_count != null && lines.length && lines.length !== attrs.yards_count) {
          messages.push({ level: 'info', field: 'yards_count', text: `В графе «Кол-во дворов» указано ${attrs.yards_count}, в адресах перечислено строк: ${lines.length}` });
        }
        if (!addr) messages.push({ level: 'warning', field: 'addresses', text: 'Не указаны адреса домов по проекту' });
      } else {
        attrs.yards_count = null;
        attrs.addresses = null;
        attrs.houses_list = null;
      }
      // проверки сумм в строке
      const years = yearCols.reduce((s, y) => s + ((attrs[y] as number) ?? 0), 0);
      if (attrs.spent_total != null && !near(years, attrs.spent_total as number, 0.05)) {
        messages.push({ level: 'warning', field: 'spent_total', text: `«Освоено 2022–2026» (${attrs.spent_total}) не равно сумме по годам (${round(years, 3)})` });
      }
      if (attrs.remaining != null && attrs.cost_after != null && attrs.spent_total != null && !near((attrs.cost_after as number) - (attrs.spent_total as number), attrs.remaining as number, 0.05)) {
        messages.push({ level: 'warning', field: 'remaining', text: `«Необходимо для завершения» (${attrs.remaining}) не равно «стоимость после корректировки − освоено» (${round((attrs.cost_after as number) - (attrs.spent_total as number), 3)})` });
      }
      if (attrs.contract) lotsByContract.set(String(attrs.contract), [...(lotsByContract.get(String(attrs.contract)) ?? []), `${lot.name} — ${company}`]);
      const baseKey = `yard_contracts:${fold(lot.name).slice(0, 80)}:${fold(role)}:${fold(company)}`;
      const rec: ParsedRecord = {
        rowNo, category: 'yard_contracts', baseKey, naturalKey: baseKey,
        core: { name: lot.name },
        attrs, raw: rawRow(labels, row), messages, valid: true,
      };
      if (role !== 'Подрядчик') rec.messages.push({ level: 'info', field: 'role', text: `Роль «${role}» определена по порядку строк в лоте (заголовок: «Подрядчик, технадзор, авторский надзор»)` });
      lot.rows.push(rec);
      records.push(rec);
    }
    for (const [contract, users] of lotsByContract) {
      if (users.length > 1) {
        fileIssues.push({ level: 'warning', text: `Один и тот же № договора «${contract}» указан у разных лотов/организаций: ${users.join('; ')}` });
        for (const r of records) if (r.attrs.contract === contract) r.messages.push({ level: 'warning', field: 'contract', text: `№ договора «${contract}» указан также у: ${users.filter((u) => !u.endsWith(String(r.attrs.company))).join('; ')}` });
      }
    }
    assignKeys(records);
    return { profile: 'yard_contracts', profileName: this.name, sheet: sheet.name, records, fileIssues, controlTotals };
  },
};

function labelOf(f: string): string {
  const m: Record<string, string> = {
    cost_before: 'стоимость до корректировки', cost_after: 'стоимость после корректировки', spent_total: 'освоено 2022–2026', remaining: 'необходимо для завершения',
  };
  const y = f.match(/^spent_(20\d{2})$/);
  return y ? `освоено ${y[1]}` : m[f] ?? f;
}

// ───────────────────────────── Утверждённый перечень дворов ─────────────────────────────

export const yardsApprovedProfile: Profile = {
  code: 'yards_approved',
  name: 'Дворы: утверждённый перечень (адрес, площадь, согласования)',
  detect: (sheet) => findHeaderRow(sheet, 'Мекен-жайы') >= 0 && findHeaderRow(sheet, 'көлемі') >= 0,
  parse(sheet: Sheet): ParseResult {
    const fileIssues: Msg[] = [];
    const h = findHeaderRow(sheet, 'Мекен-жайы');
    const header = sheet.rows[h];
    const labels = headerLabels(header, Math.max(...sheet.rows.map((r) => r?.length ?? 0)));
    const records: ParsedRecord[] = [];
    let fractions = 0;
    for (let i = h + 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i] ?? [];
      if (isEmptyRow(row)) continue;
      const rowNo = sheet.firstRow + i;
      const address = str(row[1]);
      if (!address) {
        fileIssues.push({ level: 'info', text: `Строка ${rowNo}: нет адреса — пропущена` });
        continue;
      }
      const messages: Msg[] = [];
      const areaRaw = str(row[2]);
      const area = areaRaw == null ? null : parseNumber(areaRaw.replace(/\s*га\s*$/i, ''));
      if (areaRaw && area == null) messages.push({ level: 'warning', field: 'area_ha', text: `Площадь не распознана: «${areaRaw}»` });
      if (areaRaw && !/га/i.test(areaRaw)) messages.push({ level: 'info', field: 'area_ha', text: `Площадь указана без единиц («${areaRaw}»), принято: гектары (как в остальных строках)` });
      if (!areaRaw) messages.push({ level: 'warning', field: 'area_ha', text: 'Не указана площадь' });
      const mark = (v: unknown, field: string, label: string): string | null => {
        if (v == null || String(v).trim() === '') return null;
        if (typeof v === 'number') {
          fractions++;
          messages.push({ level: 'warning', field, text: `«${label}»: вместо отметки указано число ${v} — вероятно, ошибка ввода; значение сохранено как есть` });
          return String(v);
        }
        return cellText(v);
      };
      const { houses } = expandHouses(address);
      if (!houses.length) messages.push({ level: 'warning', field: 'address_raw', text: 'Не удалось выделить номера домов — привязка к МЖД не выполняется' });
      const baseKey = `yards_approved:${fold(address).replace(/[\s,.]+/g, ' ').trim()}`;
      records.push({
        rowNo, category: 'yards_approved', baseKey, naturalKey: baseKey,
        core: { name: `Двор: ${address}`, address_raw: address },
        attrs: {
          area_raw: areaRaw, area_ha: area,
          npc_zem: mark(row[3], 'npc_zem', 'НПЦзем'),
          land_relations: mark(row[4], 'land_relations', 'Городские земельные отношения'),
          housing_inspection: mark(row[5], 'housing_inspection', 'Городская жилищная инспекция'),
          houses_list: houses.length ? houses.join('; ') : null, houses_count: houses.length || null,
          no_in_list: row[0] == null ? null : cellText(row[0]),
        },
        raw: rawRow(labels, row), messages, valid: true,
      });
    }
    fileIssues.push({ level: 'info', text: `В листе «${sheet.name}» ${records.length} записей (в названии файла — «150 дворов»).` });
    if (fractions) fileIssues.push({ level: 'warning', text: `В ${fractions} ячейках отметок согласования вместо «+» стоят дробные числа (например, 0,6578…) — вероятно, ошибка ввода; сохранены как есть.` });
    assignKeys(records);
    return { profile: 'yards_approved', profileName: this.name, sheet: sheet.name, records, fileIssues, controlTotals: [] };
  },
};

// ───────────────────────────── Перечни проектных организаций ─────────────────────────────

export const yardsDesignProfile: Profile = {
  code: 'yards_design',
  name: 'Дворы: перечень адресов проектной организации',
  detect: (sheet) => findHeaderRow(sheet, 'Перечень адресов по благоустр', 5) >= 0 || (/реализ/i.test(sheet.name) && findHeaderRow(sheet, 'Наименование', 10) >= 0),
  parse(sheet: Sheet): ParseResult {
    const fileIssues: Msg[] = [];
    const width = Math.max(...sheet.rows.map((r) => r?.length ?? 0));
    const labels = headerLabels(['№', 'Наименование', 'Примечание'], width);
    const unrealized = /не\s*реализ/i.test(fold(sheet.name));
    const records: ParsedRecord[] = [];
    let org: string | null = null;
    let part = 0;
    const emptyNos: number[] = [];
    for (let i = 0; i < sheet.rows.length; i++) {
      const row = sheet.rows[i] ?? [];
      if (isEmptyRow(row)) continue;
      const rowNo = sheet.firstRow + i;
      const a = cellText(row[0]);
      const b = str(row[1]);
      if (/^перечень адресов/i.test(fold(a))) continue;
      if (/^№/.test(a) && fold(b) === 'наименование') continue;
      if (a && !/^\d+$/.test(a) && !b) {
        org = clean(a.replace(/\s+/g, ' '));
        part++;
        continue;
      }
      if (/^\d+$/.test(a) && !b) {
        emptyNos.push(rowNo);
        continue;
      }
      if (!b) continue;
      const messages: Msg[] = [];
      if (!org) messages.push({ level: 'warning', field: 'design_org', text: 'Строка до заголовка организации — организация не определена' });
      const { houses } = expandHouses(b);
      if (!houses.length) messages.push({ level: 'warning', field: 'address_raw', text: 'Не удалось выделить номера домов — привязка к МЖД не выполняется' });
      const baseKey = `yards_design:${fold(sheet.name)}:${fold(org)}:${fold(b).replace(/[\s,.]+/g, ' ').trim()}`;
      records.push({
        rowNo, category: 'yards_design', baseKey, naturalKey: baseKey,
        core: { name: `Двор: ${b}`, address_raw: b, status: unrealized ? 'Не реализован' : null },
        attrs: {
          design_org: org, list_part: part ? `часть ${part}` : null, remark: str(row[2]), sheet: sheet.name.trim(),
          houses_list: houses.length ? houses.join('; ') : null, houses_count: houses.length || null, no_in_list: a,
        },
        raw: rawRow(labels, row), messages, valid: true,
      });
    }
    if (part > 1) fileIssues.push({ level: 'info', text: `Перечень разбит на ${part} части повторяющимся заголовком организации; номер части сохранён в поле «Часть перечня».` });
    if (emptyNos.length) fileIssues.push({ level: 'info', text: `${emptyNos.length} пронумерованных строк без адреса (строки ${emptyNos[0]}–${emptyNos[emptyNos.length - 1]}) — не являются записями.` });
    if (unrealized) fileIssues.push({ level: 'info', text: 'Адреса этого листа отмечены статусом «Не реализован».' });
    assignKeys(records);
    return { profile: 'yards_design', profileName: this.name, sheet: sheet.name, records, fileIssues, controlTotals: [] };
  },
};

// ───────────────────────────── Инвентаризация зелёных насаждений ─────────────────────────────

/** Растения, которые обычно относят к кустарникам (для подсказки при виде «дерево»). */
const SHRUBS = /барбарис|малина|смородин|шиповник|сирень|спирея|жимолость|самшит|кизильник|пузыреплодник|чубушник|скумпия|дерен|бузина|айва японская|кустарник/i;

export const greenProfile: Profile = {
  code: 'green_inventory',
  name: 'Инвентаризация зелёных насаждений',
  detect: (sheet) => findHeaderRow(sheet, 'инвентаризации зеленых насаждений', 3) >= 0,
  parse(sheet: Sheet): ParseResult {
    const fileIssues: Msg[] = [];
    const controlTotals: ControlTotal[] = [];
    const h = findHeaderRow(sheet, 'Существующие насаждения');
    if (h < 0) throw new Error('Не найдена строка заголовков («Существующие насаждения»)');
    const top = sheet.rows[h];
    const sub = sheet.rows[h + 1] ?? [];
    const width = Math.max(...sheet.rows.map((r) => r?.length ?? 0));
    const labels = headerLabels(sub.map((v, c) => `${cellText(top[c]) ? cellText(top[c]) + ' / ' : ''}${cellText(v) || cellText(top[c])}`), width);
    // начала двух блоков: «Существующие насаждения» и «Новая посадка за 2025 год»
    const newCol = top.findIndex((v) => /новая посадка/i.test(cellText(v)));
    const existCol = top.findIndex((v) => /существующие/i.test(cellText(v)));
    const newYear = cellText(top[newCol]).match(/(20\d{2})/)?.[1] ?? null;
    const blocks = [
      { type: 'Существующие насаждения', start: existCol, end: newCol },
      { type: `Новая посадка${newYear ? ` за ${newYear} год` : ''}`, start: newCol, end: width },
    ];
    const colIn = (b: { start: number; end: number }, needle: string) => {
      for (let c = b.start; c < b.end; c++) if (fold(sub[c]).includes(needle)) return c;
      return -1;
    };
    const title = sheet.rows.slice(0, h).flat().map(cellText).filter(Boolean).join(' ');
    if (title) fileIssues.push({ level: 'info', text: `Заголовок: «${title}»` });
    const records: ParsedRecord[] = [];
    let locality: string | null = null;
    for (let i = h + 2; i < sheet.rows.length; i++) {
      const row = sheet.rows[i] ?? [];
      if (isEmptyRow(row)) continue;
      const rowNo = sheet.firstRow + i;
      if (str(row[1])) locality = str(row[1]);
      if (/^итого/i.test(cellText(row[1]))) {
        for (const b of blocks) {
          const qc = colIn(b, 'количество');
          if (qc >= 0 && row[qc] != null) controlTotals.push(sumTotal(`Итого: ${b.type.toLowerCase()}, шт.`, 'green_inventory', 'quantity', row[qc], records.filter((r) => r.attrs.record_type === b.type), 'шт.', rowNo, { record_type: b.type }));
        }
        locality = null;
        continue;
      }
      if (!/^\d+$/.test(cellText(row[0]))) {
        const t = row.map(cellText).filter(Boolean).join(' ');
        if (t) fileIssues.push({ level: 'info', text: `Строка ${rowNo}: «${t}» — подпись/примечание, не запись о насаждениях` });
        continue;
      }
      for (const b of blocks) {
        const sp = colIn(b, 'порода');
        const species = sp >= 0 ? str(row[sp]) : null;
        if (!species) continue;
        const qc = colIn(b, 'количество');
        const kc = colIn(b, 'вид');
        const sc = colIn(b, 'состояние');
        const pc = colIn(b, 'приживаемость');
        const nc = colIn(b, 'примечани');
        const messages: Msg[] = [];
        const qty = parseNumber(row[qc]);
        if (row[qc] != null && qty == null) messages.push({ level: 'warning', field: 'quantity', text: `Количество не распознано: «${cellText(row[qc])}»` });
        if (row[qc] == null) messages.push({ level: 'warning', field: 'quantity', text: 'Не указано количество' });
        const kind = kc >= 0 ? str(row[kc]) : null;
        if (kind && fold(kind) === 'дерево' && SHRUBS.test(species)) messages.push({ level: 'info', field: 'kind', text: `Вид «${kind}» указан для «${species}», которое обычно относят к кустарникам — проверьте` });
        let survival: number | null = pc >= 0 ? parseNumber(row[pc]) : null;
        if (survival != null && survival <= 1) {
          messages.push({ level: 'info', field: 'survival_pct', text: `Приживаемость записана долей (${survival}), пересчитано в проценты: ${round(survival * 100, 1)}%` });
          survival = round(survival * 100, 1);
        }
        const baseKey = `green_inventory:${fold(b.type)}:${fold(locality)}:${fold(species)}`;
        // исходная строка — только столбцы своего блока (+ № и город)
        const raw = rawRow(labels, row.map((v, c) => (c < 2 || (c >= b.start && c < b.end) ? v : null)));
        records.push({
          rowNo, category: 'green_inventory', baseKey, naturalKey: baseKey,
          core: { name: species, status: sc >= 0 ? str(row[sc]) : null },
          attrs: {
            record_type: b.type, quantity: qty, kind, survival_pct: survival, remark: nc >= 0 ? str(row[nc]) : null,
            locality, no_in_list: cellText(row[0]),
          },
          raw, messages, valid: true,
        });
      }
    }
    fileIssues.push({ level: 'info', text: 'В отчёте в одних строках расположены две независимые таблицы (существующие насаждения и новая посадка); они импортированы как отдельные записи с полем «Раздел отчёта». Номер строки в новой посадке совпадает с номером строки существующих насаждений и не означает связи между ними.' });
    assignKeys(records);
    return { profile: 'green_inventory', profileName: this.name, sheet: sheet.name, records, fileIssues, controlTotals };
  },
};
