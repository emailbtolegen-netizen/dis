import { fold, parseAddress, parseNumber } from '../../domain/normalize.ts';
import type { Msg, ParsedRecord, ParseResult, Profile, Sheet } from '../types.ts';
import { cellText, isEmptyRow } from '../workbook.ts';
import { assignKeys, findHeaderRow, headerLabels, rawRow, str } from './common.ts';

/** Таблица КСК/ПИК по программе термомодернизации (2020–2024). */
export const thermoProfile: Profile = {
  code: 'thermo',
  name: 'Термомодернизация МЖД (таблица КСК/ПИК)',
  detect: (sheet) => findHeaderRow(sheet, 'терможаңғырт', 5) >= 0,
  parse(sheet: Sheet): ParseResult {
    const fileIssues: Msg[] = [];
    const h = findHeaderRow(sheet, 'терможаңғырт', 5);
    if (h < 0) throw new Error('Не найдена строка заголовков таблицы термомодернизации');
    const header = sheet.rows[h];
    const labels = headerLabels(header, 7);
    const hf = header.map(fold);

    // проверка соответствия заголовков содержимому (выявлено при аудите)
    if (hf[3]?.includes('жсн') ) {
      const sample = sheet.rows.slice(h + 1).map((r) => cellText(r?.[3])).filter(Boolean);
      const phoneLike = sample.filter((s) => /^8\d{9,10}$/.test(s.replace(/\D/g, ''))).length;
      if (sample.length && phoneLike / sample.length > 0.8) {
        fileIssues.push({ level: 'warning', text: 'Столбец D озаглавлен «ЖСН/БСН, ФИО руководителя, юридический адрес», но фактически содержит номера телефонов. Значения сохранены как «Контакт» (конфиденциальное поле).' });
      }
    }
    if (hf[6]?.includes('шагым')) {
      fileIssues.push({ level: 'warning', text: 'Столбец G озаглавлен как «сведения о жалобах жителей», но содержит статус работ («Жөндеу жұмыстары аяқталды / аяқталған жоқ»). Значения импортированы как статус работ.' });
    }

    const records: ParsedRecord[] = [];
    let year: number | null = null;
    const years = new Set<number>();
    for (let i = h + 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i] ?? [];
      if (isEmptyRow(row)) continue;
      const rowNo = sheet.firstRow + i;
      const yCell = str(row[0]);
      if (yCell) {
        const m = yCell.match(/(20\d{2})/);
        if (m) year = Number(m[1]);
      }
      const address = str(row[4]);
      const no = row[1];
      if (!address) {
        const t = row.map(cellText).filter(Boolean).join(' ');
        if (t) fileIssues.push({ level: 'info', text: `Строка ${rowNo}: текстовое примечание, не является записью об объекте: «${t.slice(0, 300)}${t.length > 300 ? '…' : ''}»` });
        continue;
      }
      const messages: Msg[] = [];
      if (year == null) messages.push({ level: 'error', text: 'Не определён год программы' });
      else years.add(year);
      const org = str(row[2]);
      if (!org) messages.push({ level: 'warning', field: 'org_name', text: 'Не указан КСК/ПИК' });
      const amountRaw = row[5];
      const amount = parseNumber(amountRaw);
      if (amountRaw != null && amount == null) messages.push({ level: 'warning', field: 'amount_kzt', text: `Сумма не распознана как число: «${amountRaw}»` });
      if (amountRaw == null) messages.push({ level: 'warning', field: 'amount_kzt', text: 'Не указана сумма средств' });
      if (typeof amountRaw === 'string') messages.push({ level: 'info', field: 'amount_kzt', text: `Сумма записана текстом «${cellText(amountRaw)}», распознана как ${amount?.toLocaleString('ru-RU')} ₸` });
      const st = str(row[6]);
      const fs = fold(st);
      const status = !st ? null : /аяктал\S*\s+жок/.test(fs) ? 'Работы не завершены' : /аяктал/.test(fs) ? 'Работы завершены' : st;
      const p = parseAddress(address);
      if (!p.buildingKey) messages.push({ level: 'warning', field: 'address_raw', text: 'В адресе не удалось выделить номер дома' });
      if (/\(|лифт|подъезд|жеделсат|кап\.?\s*ремонт/i.test(address)) {
        messages.push({ level: 'info', field: 'address_raw', text: 'Адрес содержит пояснение о виде работ (лифт, подъезд, капремонт) — сохранено в исходном виде' });
      }
      const baseKey = `thermo:${year ?? '?'}:${fold(address)}`;
      records.push({
        rowNo,
        category: 'thermo',
        baseKey,
        naturalKey: baseKey,
        core: { name: `Термомодернизация ${year ?? ''}: ${address}`.replace('  ', ' '), address_raw: address, status },
        attrs: {
          program_year: year,
          org_name: org,
          contact: str(row[3]),
          amount_kzt: amount,
          amount_raw: amountRaw == null ? null : cellText(amountRaw),
          work_status_raw: st,
          row_in_year: typeof no === 'number' ? no : parseNumber(no),
        },
        raw: { 'A: Жылы (с учётом объединённой ячейки)': year, ...rawRow(labels, row) },
        messages,
        valid: year != null,
      });
    }
    const ys = [...years].sort();
    if (ys.length) {
      const missing: number[] = [];
      for (let y = ys[0]; y <= ys[ys.length - 1]; y++) if (!years.has(y)) missing.push(y);
      if (missing.length) fileIssues.push({ level: 'warning', text: `В таблице нет записей за ${missing.join(', ')} г. (название файла: 2020–2024).` });
    }
    assignKeys(records);
    return { profile: 'thermo', profileName: this.name, sheet: sheet.name, records, fileIssues, controlTotals: [] };
  },
};
