import { all, json } from '../db/db.ts';
import { categories, fieldLabel } from '../domain/categories.ts';
import type { Category } from '../domain/categories.ts';
import { fold } from '../domain/normalize.ts';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  type: string;
  severity: Severity;
  category: string | null;
  object_id?: number;
  uid?: string;
  name?: string;
  field?: string;
  message: string;
}

export const ISSUE_TYPES: Record<string, string> = {
  missing_required: 'Не заполнены обязательные поля',
  import_warning: 'Замечания, выявленные при импорте',
  duplicate: 'Возможные дубликаты',
  code_conflict: 'Одинаковый номер у разных объектов',
  suspicious_value: 'Подозрительные значения',
  address_format: 'Формат адреса',
  unlinked: 'Нет связи со связанным реестром',
  cross_check: 'Расхождения между файлами',
  value_variants: 'Разные написания одного значения',
  control_total: 'Расхождение с итогами исходного файла',
  file_issue: 'Замечания к структуре исходного файла',
};

const isEmpty = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '');

function value(o: any, attrs: Record<string, unknown>, key: string, core?: boolean): unknown {
  return core ? o[key] : attrs[key];
}

/** Полный расчёт качества данных по разрешённым категориям. */
export function computeQuality(allowed: string[]) {
  const cats = categories();
  const objs = all(
    `SELECT o.id, o.uid, o.category, o.name, o.code, o.address_raw, o.address_id, o.status, o.balance_holder, o.year_built, o.voltage,
            o.power_kva, o.length_km, o.lat, o.lon, o.notes, o.attrs, o.issues, o.natural_key, a.kind AS address_kind
       FROM objects o LEFT JOIN addresses a ON a.id = o.address_id
      WHERE o.deleted_at IS NULL AND o.category IN (${allowed.map(() => '?').join(',') || "''"})`,
    ...allowed,
  );
  const issues: Issue[] = [];
  const push = (o: any, type: string, severity: Severity, message: string, field?: string) =>
    issues.push({ type, severity, category: o.category, object_id: o.id, uid: o.uid, name: o.name, field, message });

  const completeness = new Map<string, { total: number; complete: number; fields: Map<string, { label: string; filled: number; required: boolean }> }>();
  const year = new Date().getFullYear();
  const dupGroups = new Map<string, any[]>();
  const codeGroups = new Map<string, any[]>();

  for (const o of objs) {
    const cat = cats.get(o.category) as Category;
    const attrs = json<Record<string, unknown>>(o.attrs, {});
    o._attrs = attrs;
    let comp = completeness.get(o.category);
    if (!comp) {
      comp = { total: 0, complete: 0, fields: new Map() };
      for (const f of cat.fields) if (!['lat', 'lon', 'notes'].includes(f.key)) comp.fields.set(f.key, { label: f.label, filled: 0, required: !!f.required });
      completeness.set(o.category, comp);
    }
    comp.total++;
    const missing: string[] = [];
    for (const f of cat.fields) {
      const v = value(o, attrs, f.key, f.core);
      const st = comp.fields.get(f.key);
      if (st && !isEmpty(v)) st.filled++;
      if (f.required && isEmpty(v)) missing.push(f.label);
    }
    if (missing.length) push(o, 'missing_required', 'warning', `Не заполнено: ${missing.join(', ')}`);
    else comp.complete++;

    for (const m of json<any[]>(o.issues, [])) {
      if (m.level === 'info' || /дубликат|Совпадает наименование/.test(m.text)) continue;
      if (/^Не указан/.test(m.text) && m.field && cat.fields.find((f) => f.key === m.field)?.required) continue; // уже учтено выше
      push(o, 'import_warning', m.level === 'error' ? 'error' : 'warning', m.text, m.field);
    }

    if (o.natural_key) {
      const base = `${o.category}|${String(o.natural_key).replace(/#\d+$/, '')}`;
      dupGroups.set(base, [...(dupGroups.get(base) ?? []), o]);
    }
    if (o.code && ['el_tp', 'el_rp', 'el_ps'].includes(o.category)) {
      const k = `${o.category}|${o.code}`;
      codeGroups.set(k, [...(codeGroups.get(k) ?? []), o]);
    }

    // подозрительные значения
    if (o.year_built != null && (o.year_built > year || o.year_built < 1850)) push(o, 'suspicious_value', 'warning', `Год постройки вне допустимого диапазона: ${o.year_built}`, 'year_built');
    if (o.category === 'mkd') {
      const area = attrs.area_m2 as number, apts = attrs.apartments as number;
      if (typeof area === 'number' && typeof apts === 'number' && apts > 0 && area / apts < 10) {
        push(o, 'suspicious_value', 'warning', `Площадь ${+area.toFixed(2)} м² на ${apts} кв. (${(area / apts).toFixed(1)} м² на квартиру) — вероятна ошибка ввода`, 'area_m2');
      }
      if (typeof attrs.floors === 'number' && (attrs.floors as number) > 40) push(o, 'suspicious_value', 'warning', `Этажность ${attrs.floors}`, 'floors');
      if (o.address_kind !== 'building') push(o, 'address_format', 'warning', 'В адресе не выделен номер дома — адрес не связан с адресным справочником как здание', 'address_raw');
    }
    if (o.length_km != null && (o.length_km <= 0 || o.length_km > 50)) push(o, 'suspicious_value', 'warning', `Протяжённость ${o.length_km} км — проверьте единицы измерения`, 'length_km');
    if (o.power_kva != null && o.power_kva <= 0) push(o, 'suspicious_value', 'warning', `Мощность ${o.power_kva} кВА`, 'power_kva');
  }

  for (const list of dupGroups.values()) {
    if (list.length < 2) continue;
    const sig = (o: any) => JSON.stringify([o.name, o.code, o.address_raw, o.power_kva, o.length_km, o.year_built, { ...o._attrs, no_in_list: undefined }]);
    const identical = list.every((o) => sig(o) === sig(list[0]));
    for (const o of list) {
      push(o, 'duplicate', identical ? 'warning' : 'info',
        identical
          ? `Полный дубликат: ${list.length} одинаковые записи (${list.map((x) => x.uid).join(', ')})`
          : `Совпадает наименование/ключ у ${list.length} записей (${list.map((x) => x.uid).join(', ')}), значения различаются`);
    }
  }
  for (const list of codeGroups.values()) {
    if (list.length < 2) continue;
    for (const o of list) {
      push(o, 'code_conflict', 'warning', `Номер ${o.code} указан у ${list.length} записей: ${list.map((x) => `${x.uid} (${x.name}; ${x.address_raw ?? 'место не указано'})`).join('; ')}`, 'code');
    }
  }

  // лифты: привязка к МЖД, несколько записей по дому, сверка количества с реестром МЖД
  if (allowed.includes('mkd_lifts')) {
    const liftLinks = all(`SELECT l.from_id, l.to_id, o.attrs mkd_attrs, o.uid mkd_uid, o.name mkd_name FROM object_links l JOIN objects o ON o.id = l.to_id
                            WHERE l.relation = 'lift_building' AND l.status != 'rejected' AND o.deleted_at IS NULL`);
    const byLift = new Map<number, any[]>();
    const byHouse = new Map<number, number[]>();
    for (const l of liftLinks) {
      byLift.set(l.from_id, [...(byLift.get(l.from_id) ?? []), l]);
      byHouse.set(l.to_id, [...(byHouse.get(l.to_id) ?? []), l.from_id]);
    }
    const liftObjs = objs.filter((o) => o.category === 'mkd_lifts');
    const uidById = new Map(liftObjs.map((o) => [o.id, o.uid]));
    for (const o of liftObjs) {
      const ls = byLift.get(o.id) ?? [];
      if (!ls.length) {
        push(o, 'unlinked', 'warning', o._attrs.multi_address
          ? 'В строке указано несколько домов — привяжите запись к нужным карточкам МЖД вручную (вкладка «Связи»)'
          : 'Дом с таким адресом не найден в реестре МЖД — требуется проверка адреса и ручная привязка (новая карточка МЖД автоматически не создаётся)', 'address_raw');
        continue;
      }
      for (const l of ls) {
        const others = (byHouse.get(l.to_id) ?? []).filter((id) => id !== o.id);
        if (others.length) push(o, 'duplicate', 'info', `К дому ${l.mkd_name} (${l.mkd_uid}) привязано несколько записей о лифтах: ${[o.id, ...others].map((id) => uidById.get(id)).join(', ')} — сведения могут относиться к разным датам`);
        const mkdLifts = json<Record<string, unknown>>(l.mkd_attrs, {}).elevators;
        const total = o._attrs.lifts_total;
        if (ls.length === 1 && !others.length && typeof total === 'number') {
          if (typeof mkdLifts === 'number' && mkdLifts !== total) push(o, 'cross_check', 'info', `В реестре МЖД (${l.mkd_uid}) указано лифтов: ${mkdLifts}, в файле лифтов: ${total}`, 'lifts_total');
          if (typeof mkdLifts === 'string' && /жо[кқ]/i.test(mkdLifts) && total > 0) push(o, 'cross_check', 'info', `В реестре МЖД (${l.mkd_uid}) указано «${mkdLifts}» (лифтов нет), в файле лифтов: ${total}`, 'lifts_total');
        }
      }
    }
  }

  // капремонт и дворы: привязка к домам МЖД (новые дома не создаются)
  const houseRelations: [string, string, string][] = [
    ['capital_repair', 'repair_building', 'Дом не найден в реестре МЖД — проверьте адрес и привяжите вручную (вкладка «Связи»)'],
    ['yards_approved', 'yard_building', ''],
    ['yards_design', 'yard_building', ''],
    ['yard_contracts', 'yard_building', ''],
  ];
  for (const [cat, relation, unlinkedText] of houseRelations) {
    if (!allowed.includes(cat)) continue;
    const linkedHouses = new Map<number, number>();
    for (const r of all(`SELECT from_id, count(DISTINCT to_id) n FROM object_links WHERE relation = ? AND status != 'rejected' GROUP BY from_id`, relation)) linkedHouses.set(r.from_id, r.n);
    for (const o of objs) {
      if (o.category !== cat) continue;
      if (cat === 'yard_contracts' && o._attrs.role !== 'Подрядчик') continue; // адреса указаны только у строки подрядчика
      const linked = linkedHouses.get(o.id) ?? 0;
      const expected = typeof o._attrs.houses_count === 'number' ? (o._attrs.houses_count as number) : String(o._attrs.houses_list ?? '').split('; ').filter(Boolean).length;
      if (!linked) {
        push(o, 'unlinked', 'warning', unlinkedText || (expected
          ? `Ни один из домов (${o._attrs.houses_list}) не найден в реестре МЖД — проверьте адреса и привяжите вручную`
          : 'Из адреса не удалось выделить номера домов — привяжите вручную'), 'address_raw');
      } else if (cat !== 'capital_repair' && expected && linked < expected) {
        push(o, 'unlinked', 'info', `Привязано к МЖД ${linked} из ${expected} домов адреса; остальные не найдены в реестре МЖД`, 'address_raw');
      }
    }
  }

  // термомодернизация без найденного дома в реестре МЖД
  if (allowed.includes('thermo')) {
    const linked = new Set(all(`SELECT from_id FROM object_links WHERE relation = 'thermo_building' AND status != 'rejected'`).map((r) => r.from_id));
    for (const o of objs) if (o.category === 'thermo' && !linked.has(o.id)) push(o, 'unlinked', 'info', 'Дом по этому адресу не найден в реестре МЖД — требуется ручное сопоставление', 'address_raw');
  }

  // разные написания одного значения (тэц / ТЭЦ, панелный / панельный, жок / жоқ)
  const variants: Issue[] = [];
  for (const [code, cat] of cats) {
    if (!allowed.includes(code)) continue;
    for (const f of cat.fields) {
      if (f.core || !['enum', 'yesno', 'text'].includes(f.type) || !f.filter) continue;
      const groups = new Map<string, Map<string, number>>();
      for (const o of objs) {
        if (o.category !== code) continue;
        const v = o._attrs[f.key];
        if (typeof v !== 'string') continue;
        const k = fold(v).replace(/[ьъ\s"«».-]/g, '');
        const g = groups.get(k) ?? new Map<string, number>();
        g.set(v, (g.get(v) ?? 0) + 1);
        groups.set(k, g);
      }
      for (const g of groups.values()) {
        if (g.size < 2) continue;
        variants.push({ type: 'value_variants', severity: 'info', category: code, field: f.key,
          message: `«${f.label}»: одно значение записано по-разному — ${[...g.entries()].map(([v, n]) => `«${v}» (${n})`).join(', ')}. Исходные значения не изменялись.` });
      }
    }
  }
  issues.push(...variants);

  // итоги и замечания из последних применённых импортов каждого формата
  const lastImports = all(
    `SELECT i.*, s.file_name FROM imports i JOIN source_files s ON s.id = i.source_file_id
      WHERE i.status = 'applied' AND i.id IN (SELECT max(id) FROM imports WHERE status = 'applied' GROUP BY profile, sheet_name)`);
  const controlTotals: any[] = [];
  for (const imp of lastImports) {
    for (const t of json<any[]>(imp.control_totals, [])) {
      if (t.category && !allowed.includes(t.category)) continue;
      controlTotals.push({ ...t, file_name: imp.file_name, sheet: imp.sheet_name, import_id: imp.id });
      if (t.match === false) {
        issues.push({ type: 'control_total', severity: 'warning', category: t.category,
          message: `${t.label}: в файле ${t.statedRaw.trim()}, по строкам файла ${t.computed} ${t.unit}.${t.note ? ' ' + t.note : ''} (файл «${imp.file_name}», строка ${t.rowNo})` });
      }
    }
    for (const m of json<any[]>(imp.file_issues, [])) {
      if (m.level === 'info') continue;
      issues.push({ type: 'file_issue', severity: m.level, category: null, message: `«${imp.file_name}»: ${m.text}` });
    }
  }

  const summary = Object.entries(ISSUE_TYPES).map(([type, label]) => ({
    type, label,
    count: issues.filter((i) => i.type === type).length,
    objects: new Set(issues.filter((i) => i.type === type && i.object_id).map((i) => i.object_id)).size,
  }));
  const objectsWithIssues = new Set(issues.filter((i) => i.object_id && i.severity !== 'info').map((i) => i.object_id));
  const incomplete = new Set(issues.filter((i) => i.type === 'missing_required').map((i) => i.object_id));

  return {
    issues,
    summary,
    totals: { objects: objs.length, needsReview: objectsWithIssues.size, incomplete: incomplete.size },
    completeness: [...completeness.entries()].map(([code, c]) => ({
      category: code,
      name: cats.get(code)?.name,
      total: c.total,
      complete: c.complete,
      fields: [...c.fields.entries()].map(([key, f]) => ({ key, label: f.label, required: f.required, filled: f.filled, pct: c.total ? Math.round((f.filled / c.total) * 1000) / 10 : 0 })),
    })),
    controlTotals,
    fieldLabel: (cat: string, key: string) => fieldLabel(cats.get(cat), key),
  };
}

/** Замечания по одному объекту (для карточки). */
export function objectIssues(objectId: number, categoryCode: string): Issue[] {
  return computeQuality([categoryCode]).issues.filter((i) => i.object_id === objectId);
}
