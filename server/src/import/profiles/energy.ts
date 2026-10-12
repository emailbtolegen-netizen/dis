import {
  extractVoltage, findFeeders, findHouseRefs, findPsRefs, findRpRefs, findTpRefs, fold, parseNumber, parsePower, parseTpName, parseUnitCode,
} from '../../domain/normalize.ts';
import type { ControlTotal, Msg, ParsedRecord, ParseResult, Profile, Sheet } from '../types.ts';
import { cellText, isEmptyRow } from '../workbook.ts';
import { assignKeys, findHeaderRow, headerLabels, rawRow, str } from './common.ts';

interface Section {
  title: string;
  category: string | null;
  voltageClass: string | null;
  rowNo: number;
}

/** Определение раздела перечня по его заголовку. */
function classifySection(title: string): Omit<Section, 'title' | 'rowNo'> {
  const t = fold(title).replace(/\s+/g, '');
  const vc = (re: RegExp, label: string) => (re.test(t) ? label : null);
  if (/^пс/.test(t)) return { category: 'el_ps', voltageClass: '35–110 кВ' };
  if (/^рп/.test(t)) return { category: 'el_rp', voltageClass: '6/10 кВ' };
  if (/^(тп|ктп)/.test(t)) return { category: 'el_tp', voltageClass: '6/10/0,4 кВ' };
  if (/^вл/.test(t)) {
    return { category: 'el_vl', voltageClass: vc(/вл-?0[,.]4/, '0,4 кВ') ?? vc(/вл-?6\/10/, '6/10 кВ') ?? vc(/вл-?35/, '35 кВ') ?? vc(/вл-?110/, '110 кВ') };
  }
  if (/^кл/.test(t)) {
    return { category: 'el_kl', voltageClass: vc(/кл-?0[,.]4/, '0,4 кВ') ?? vc(/кл-?6\/10/, '6/10 кВ') ?? vc(/кл-?35/, '35 кВ') ?? vc(/кл-?110/, '110 кВ') };
  }
  return { category: null, voltageClass: null };
}

const isNumbering = (v: unknown) => v != null && /^\s*\.?\d+\.?\s*$/.test(String(v));

export const energyProfile: Profile = {
  code: 'energy',
  name: 'Перечень энергообъектов (ПС, РП, ТП/КТП, ВЛ, КЛ)',
  detect: (sheet) => findHeaderRow(sheet, 'Наименование энергообъекта') >= 0,
  parse(sheet: Sheet): ParseResult {
    const fileIssues: Msg[] = [];
    const controlTotals: ControlTotal[] = [];
    const h = findHeaderRow(sheet, 'Наименование энергообъекта');
    if (h < 0) throw new Error('Не найдена строка заголовков («Наименование энергообъекта»)');
    const header = sheet.rows[h];
    const width = 5;
    const labels = headerLabels(header, width);

    // Балансодержатель из заголовка перечня: «… находящихся на балансе ГУ "ГО ЖКХ и ЖИ"»
    const title = sheet.rows.slice(0, h).flat().map(cellText).filter(Boolean).join(' ');
    const holderMatch = title.match(/на\s+балансе\s+(.+)$/i);
    const titleHolder = holderMatch ? holderMatch[1].trim() : null;
    if (title) fileIssues.push({ level: 'info', text: `Заголовок перечня: «${title}»` });
    if (titleHolder) fileIssues.push({ level: 'info', text: `Балансовая принадлежность всех объектов принята по заголовку перечня: ${titleHolder}` });

    const records: ParsedRecord[] = [];
    let section: Section | null = null;
    let inSummary = false;
    let groupIndex = 0;
    let prevNo = 0;
    let subgroup: string | null = null;
    const summaryLines: { rowNo: number; text: string }[] = [];

    for (let i = h + 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i] ?? [];
      if (isEmptyRow(row)) continue;
      const rowNo = sheet.firstRow + i;
      const a = row[0];
      const texts = row.slice(0, 6).map(cellText);
      const joined = texts.filter(Boolean).join(' ');

      if (inSummary) {
        summaryLines.push({ rowNo, text: joined });
        continue;
      }

      // строка итога раздела: «итого 569 ед», «итого: 980,336 км»
      if (!isNumbering(a) && /итого/i.test(joined)) {
        if (/^итого:?$/i.test(joined.trim())) {
          inSummary = true;
          continue;
        }
        const m = joined.replace(/итого:?/i, '').match(/([\d\s.,]+)\s*(ед|км)/i);
        if (section && m) {
          const stated = parseNumber(m[1]);
          const isCount = /ед/i.test(m[2]);
          controlTotals.push({
            label: `Итог раздела «${section.title}»`,
            category: section.category,
            filter: section.voltageClass && section.category && ['el_vl', 'el_kl'].includes(section.category) ? { voltage_class: section.voltageClass } : undefined,
            measure: isCount ? 'count' : 'length_km',
            stated,
            statedRaw: joined,
            computed: null,
            unit: isCount ? 'ед.' : 'км',
            rowNo,
            match: null,
          });
        } else {
          fileIssues.push({ level: 'warning', text: `Строка ${rowNo}: итоговая строка не распознана: «${joined}»` });
        }
        continue;
      }

      // заголовок раздела: текст в столбце A, остальные пустые
      if (!isNumbering(a) && a != null && texts.slice(1).every((t) => !t)) {
        const cls = classifySection(String(a));
        section = { title: cellText(a), rowNo, ...cls };
        groupIndex = 0;
        prevNo = 0;
        if (!cls.category) fileIssues.push({ level: 'error', text: `Строка ${rowNo}: раздел «${cellText(a)}» не распознан — его строки не будут импортированы автоматически.` });
        continue;
      }

      const name = str(row[1]);
      const messages: Msg[] = [];
      if (!section) {
        fileIssues.push({ level: 'error', text: `Строка ${rowNo}: данные до первого заголовка раздела — пропущены.` });
        continue;
      }
      // подзаголовок внутри раздела (например, «ул. Досмухамбетова»): только наименование, без ед. изм., значения и места
      if (name && !texts[2] && !texts[3] && !texts[4] && !/(кл|вл|тп|ктп|пс|рп|ф\.?\s*\d)/i.test(fold(name))) {
        subgroup = name;
        fileIssues.push({ level: 'info', text: `Строка ${rowNo}: «${name}» — подзаголовок внутри раздела «${section.title}» (не объект). Указан как «Подзаголовок перечня» у следующих строк с «ж/д».` });
        if (isNumbering(a)) prevNo = Number(String(a).replace(/[^\d]/g, ''));
        continue;
      }
      if (subgroup && !(name && /ж\/д/i.test(name))) subgroup = null;
      const no = isNumbering(a) ? Number(String(a).replace(/[^\d]/g, '')) : null;
      if (no != null) {
        if (no <= prevNo || groupIndex === 0) groupIndex++;
        else if (no > prevNo + 1) messages.push({ level: 'info', text: `Пропуск в нумерации раздела: после № ${prevNo} идёт № ${no}` });
        prevNo = no;
      }
      if (!name) {
        records.push({ rowNo, category: section.category, baseKey: '', naturalKey: '', core: {}, attrs: {}, raw: rawRow(labels, row), messages: [{ level: 'error', text: 'Не указано наименование энергообъекта' }], valid: false });
        continue;
      }

      const unitRaw = row[2];
      const valueRaw = row[3];
      const location = str(row[4]);
      const cat = section.category;
      const attrs: Record<string, unknown> = { section: section.title, unit: str(unitRaw), no_in_list: a == null ? null : cellText(a) };
      const core: ParsedRecord['core'] = { name, address_raw: location, balance_holder: titleHolder };
      const voltageInName = extractVoltage(name);

      // примечание о балансе в самом наименовании («… на балансе управления Энергетика.»)
      const nameHolder = name.match(/на\s+балансе\s+(.+?)\.?\s*$/i);
      if (nameHolder) {
        core.balance_holder = nameHolder[1].trim();
        messages.push({ level: 'warning', field: 'balance_holder', text: `Балансовая принадлежность указана в наименовании («${nameHolder[1].trim()}») и отличается от заголовка перечня (${titleHolder ?? '—'}). Требуется проверка.` });
      }

      if (cat === 'el_ps' || cat === 'el_rp' || cat === 'el_tp') {
        const pw = parsePower(valueRaw);
        attrs.power_raw = valueRaw == null ? null : cellText(valueRaw);
        attrs.transformers = pw.count;
        attrs.transformer_kva = pw.unitKva;
        core.power_kva = pw.totalKva;
        if (pw.ambiguous) messages.push({ level: 'warning', field: 'power_kva', text: `Мощность не удалось однозначно разобрать: «${cellText(valueRaw)}». Суммарная мощность не рассчитана.` });
        if (valueRaw == null) messages.push({ level: 'warning', field: 'power_kva', text: 'Не указана мощность трансформаторов' });
        else if (!/к?ва|кв/i.test(fold(valueRaw)) && !pw.ambiguous) messages.push({ level: 'info', field: 'power_kva', text: `Мощность указана без единиц («${cellText(valueRaw)}»), принято кВА` });
        core.voltage = voltageInName ?? section.voltageClass?.replace(' кВ', '') ?? null;

        if (cat === 'el_ps') core.code = parseUnitCode(name, 'ПС');
        if (cat === 'el_rp') {
          core.code = parseUnitCode(name, 'РП');
          const f = fold(name) + ' ' + fold(location);
          if (/недейств/.test(f)) core.status = 'Недействующий';
          if (location && /запитан/.test(fold(location))) {
            core.status = 'Используется как ТП 10/0,4 кВ';
            core.notes = location;
            core.address_raw = null;
            messages.push({ level: 'info', text: `В столбце «Место нахождение» указано примечание («${location}»), а не адрес — перенесено в примечания.` });
          }
          attrs.list_group = groupIndex;
        }
        if (cat === 'el_tp') {
          const tp = parseTpName(name);
          attrs.equipment_type = tp.equipmentType;
          core.code = tp.code;
          if (!tp.code) messages.push({ level: 'warning', field: 'code', text: 'Не удалось определить номер ТП из наименования' });
          const fd = findFeeders(name);
          attrs.feeders = fd.length ? fd.join(', ') : null;
        }
      } else if (cat === 'el_vl' || cat === 'el_kl') {
        const len = typeof valueRaw === 'string' ? parseNumber(valueRaw.replace(/\s*км\.?\s*$/i, '')) : parseNumber(valueRaw);
        core.length_km = len;
        attrs.length_as_text = typeof valueRaw === 'string' ? true : null;
        if (valueRaw != null && len == null) messages.push({ level: 'warning', field: 'length_km', text: `Протяжённость не распознана как число: «${cellText(valueRaw)}»` });
        else if (typeof valueRaw === 'string') messages.push({ level: 'warning', field: 'length_km', text: `Протяжённость записана в Excel текстом («${cellText(valueRaw)}»), распознано ${len} км. Такие значения не входят в формулы-итоги Excel.` });
        if (valueRaw == null) messages.push({ level: 'warning', field: 'length_km', text: 'Не указана протяжённость' });
        if (subgroup) attrs.subgroup = subgroup;
        const houses = findHouseRefs(name);
        attrs.house_refs = houses.length ? houses.join(', ') : null;
        const unit = cellText(unitRaw);
        if (unit && unit !== 'км') messages.push({ level: 'info', field: 'unit', text: `Единица измерения записана как «${unitRaw}» (нормализовано: км)` });
        attrs.voltage_class = section.voltageClass;
        core.voltage = voltageInName ?? section.voltageClass?.replace(' кВ', '') ?? null;
        const tps = findTpRefs(name);
        attrs.tp_refs = tps.length ? tps.join(', ') : null;
        const ps = findPsRefs(name);
        attrs.ps_refs = ps.length ? ps.join(', ') : null;
        const rp = findRpRefs(name);
        attrs.rp_refs = rp.length ? rp.join(', ') : null;
        const fd = section.voltageClass === '0,4 кВ' ? [] : findFeeders(name);
        attrs.feeders = fd.length ? fd.join(', ') : null;
        // КЛ-110 кВ: наименование — это питающая подстанция
        if (cat === 'el_kl' && section.voltageClass === '110 кВ' && !ps.length) {
          const code = parseUnitCode(name, 'ПС');
          if (code) attrs.ps_refs = code;
        }
      }
      if (!location && !core.notes) messages.push({ level: 'warning', field: 'address_raw', text: 'Не указано место нахождения' });

      const baseKey = `${cat}:${section.voltageClass ?? ''}:${fold(name).replace(/\s+/g, ' ')}`;
      records.push({ rowNo, category: cat, baseKey, naturalKey: baseKey, core, attrs, raw: { 'Раздел': section.title, ...rawRow(labels, row) }, messages, valid: !!cat });
      if (!cat) records[records.length - 1].messages.push({ level: 'error', text: 'Раздел перечня не распознан' });
    }

    // РП: статус «В работе» по итоговой справке перечня (если число совпадает)
    const rpWorking = summaryLines.map((l) => l.text.match(/в\s+работе\s+(\d+)/i)).find(Boolean);
    const rpRecords = records.filter((r) => r.valid && r.category === 'el_rp');
    const rpNoStatus = rpRecords.filter((r) => !r.core.status);
    if (rpWorking && Number(rpWorking[1]) === rpNoStatus.length) {
      for (const r of rpNoStatus) {
        r.core.status = 'В работе';
        r.messages.push({ level: 'info', field: 'status', text: `Статус «В работе» установлен по итоговой справке перечня («в работе ${rpWorking[1]} ед.»)` });
      }
    } else if (rpWorking) {
      fileIssues.push({ level: 'warning', text: `Итоговая справка указывает «в работе ${rpWorking[1]} ед.», а РП без отметки о недействии — ${rpNoStatus.length}. Статус не присвоен автоматически.` });
    }

    // итоговая справка в конце перечня
    for (const l of summaryLines) {
      const t = l.text;
      const def = (label: string, category: string, measure: ControlTotal['measure'], unit: string, filter?: Record<string, string>) => {
        const m = t.match(/[–—-]?\s*([\d\s]+(?:[.,]\d+)?)\s*(ед|км)/i);
        controlTotals.push({ label: `Итоговая справка: ${label}`, category, filter, measure, stated: m ? parseNumber(m[1]) : null, statedRaw: t, computed: null, unit, rowNo: l.rowNo, match: null });
      };
      const f = fold(t).replace(/\s+/g, '');
      if (/^пс/.test(f)) def('ПС 35/110 кВ', 'el_ps', 'count', 'ед.');
      else if (/^рп/.test(f)) def('РП 6/10 кВ всего', 'el_rp', 'count', 'ед.');
      else if (/^(тп|ктп)/.test(f)) def('ТП/КТП 6/10/0,4 кВ', 'el_tp', 'count', 'ед.');
      else if (/^вл-?0[,.]4/.test(f)) def('ВЛ-0,4 кВ', 'el_vl', 'length_km', 'км', { voltage_class: '0,4 кВ' });
      else if (/^вл-?6\/10/.test(f)) def('ВЛ-6/10 кВ', 'el_vl', 'length_km', 'км', { voltage_class: '6/10 кВ' });
      else if (/^кл-?0[,.]4/.test(f)) def('КЛ-0,4 кВ', 'el_kl', 'length_km', 'км', { voltage_class: '0,4 кВ' });
      else if (/^кл-?6\/10/.test(f)) def('КЛ-6/10 кВ', 'el_kl', 'length_km', 'км', { voltage_class: '6/10 кВ' });
      else if (/^кл-?110/.test(f)) def('КЛ-110 кВ', 'el_kl', 'length_km', 'км', { voltage_class: '110 кВ' });
      else if (t) fileIssues.push({ level: 'info', text: `Итоговая справка, строка ${l.rowNo}: «${t}»` });
    }
    if (!summaryLines.length && !controlTotals.length) fileIssues.push({ level: 'info', text: 'Итоговые строки в перечне не найдены.' });

    assignKeys(records);

    // расчёт контрольных итогов по фактическим строкам файла
    for (const t of controlTotals) {
      const rs = records.filter((r) => r.valid && r.category === t.category && (!t.filter || Object.entries(t.filter).every(([k, v]) => r.attrs[k] === v)));
      if (t.measure === 'count') t.computed = rs.length;
      else t.computed = Math.round(rs.reduce((s, r) => s + (typeof r.core.length_km === 'number' ? r.core.length_km : 0), 0) * 1000) / 1000;
      t.match = t.stated == null ? null : Math.abs((t.computed ?? 0) - t.stated) < 0.0015;
      if (t.measure === 'length_km' && t.match === false) {
        const textRows = rs.filter((r) => r.attrs.length_as_text && typeof r.core.length_km === 'number');
        const numericOnly = Math.round(rs.reduce((s, r) => s + (!r.attrs.length_as_text && typeof r.core.length_km === 'number' ? r.core.length_km : 0), 0) * 1000) / 1000;
        if (textRows.length && Math.abs(numericOnly - (t.stated ?? 0)) < 0.0015) {
          t.note = `Расхождение объясняется значениями, записанными в Excel текстом (строки ${textRows.map((r) => r.rowNo).join(', ')}; сумма ${Math.round(textRows.reduce((s, r) => s + (r.core.length_km as number), 0) * 1000) / 1000} км): итог в файле их не учитывает. Без них сумма = ${numericOnly} км.`;
        } else if (textRows.length) {
          t.note = `В разделе есть значения, записанные текстом (строки ${textRows.map((r) => r.rowNo).join(', ')}). Сумма только числовых ячеек = ${numericOnly} км.`;
        }
      }
    }
    return { profile: 'energy', profileName: this.name, sheet: sheet.name, records, fileIssues, controlTotals };
  },
};
