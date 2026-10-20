import { all, get, json, run, tx } from '../db/db.ts';
import type { Row } from '../db/db.ts';
import { buildingMatchKeys, looseBuildingKey } from '../domain/addressMatch.ts';
import { findRpRefs, parseAddress } from '../domain/normalize.ts';

/** Типы связей между объектами. */
export const RELATIONS: Record<string, { label: string; reverse: string }> = {
  line_tp: { label: 'Линия связана с ТП (по наименованию)', reverse: 'Линии, связанные с этой ТП' },
  line_ps: { label: 'Линия связана с ПС (по наименованию)', reverse: 'Линии, связанные с этой ПС' },
  line_rp: { label: 'Линия связана с РП (по наименованию)', reverse: 'Линии, связанные с этим РП' },
  tp_rp: { label: 'Питание ТП от РП (по наименованию)', reverse: 'ТП, запитанные от этого РП' },
  line_building: { label: 'Кабель к жилому дому (по наименованию и улице)', reverse: 'Кабельные линии к дому' },
  thermo_building: { label: 'Термомодернизация этого дома (совпадение адреса)', reverse: 'Термомодернизация дома' },
  lift_building: { label: 'Лифты этого дома МЖД', reverse: 'Сведения о лифтах дома' },
  emergency_building: { label: 'Аварийный / ветхий: этот дом МЖД', reverse: 'Признание дома аварийным / ветхим' },
  repair_building: { label: 'Капитальный ремонт этого дома МЖД', reverse: 'Капитальный ремонт дома (план)' },
  yard_building: { label: 'Благоустройство двора у дома МЖД', reverse: 'Благоустройство двора дома' },
  related: { label: 'Связанный объект', reverse: 'Связанный объект' },
};

interface AutoLink {
  from: number;
  to: number;
  relation: string;
  method: string;
  confidence: number;
  note: string;
}

const splitRefs = (v: unknown): string[] => (v == null ? [] : String(v).split(/,\s*/).filter(Boolean));

/**
 * Пересчёт автоматических связей. Связи создаются со статусом «suggested» (предложена) —
 * их подтверждает или отклоняет пользователь. Подтверждённые и отклонённые решения сохраняются.
 */
export function rebuildAutoLinks(): { created: number; total: number } {
  return tx(() => {
    run(`DELETE FROM object_links WHERE method LIKE 'auto:%' AND status = 'suggested'`);
    const objs = all(`SELECT id, category, code, name, address_raw, address_id, attrs FROM objects WHERE deleted_at IS NULL`);
    const index = (cat: string) => {
      const m = new Map<string, number[]>();
      for (const o of objs) if (o.category === cat && o.code) m.set(o.code, [...(m.get(o.code) ?? []), o.id]);
      return m;
    };
    const tp = index('el_tp');
    const ps = index('el_ps');
    const rp = index('el_rp');
    const mkdByAddress = new Map<number, number[]>();
    for (const o of objs) if (o.category === 'mkd' && o.address_id) mkdByAddress.set(o.address_id, [...(mkdByAddress.get(o.address_id) ?? []), o.id]);
    const buildingAddresses = all(`SELECT id, norm_key FROM addresses WHERE kind = 'building'`);
    const addressByKey = new Map<string, number>(buildingAddresses.map((a) => [a.norm_key, a.id]));
    const buildingKeyById = new Map<number, string>(buildingAddresses.map((a) => [a.id, a.norm_key]));
    // свободные ключи домов МЖД (та же очистка, что и для адресов из других файлов)
    const mkdByLooseKey = new Map<string, number[]>();
    const mkdBlocksByBase = new Map<string, number[]>(); // дома МЖД, учтённые по блокам: «74/1 блок 1…12»
    for (const o of objs) {
      if (o.category !== 'mkd') continue;
      const k = looseBuildingKey(o.address_raw);
      if (k) mkdByLooseKey.set(k, [...(mkdByLooseKey.get(k) ?? []), o.id]);
      if (k?.includes(' блок ')) {
        const base = k.split(' блок ')[0];
        mkdBlocksByBase.set(base, [...(mkdBlocksByBase.get(base) ?? []), o.id]);
      }
    }

    /**
     * Поиск дома МЖД по адресу: точный ключ → «свободный» ключ → дом целиком ↔ его блоки.
     * Новые дома не создаются; если ничего не найдено — null.
     */
    const findMkd = (addr: string | null | undefined): { targets: number[]; confidence: number; note: string } | null => {
      const cands = buildingMatchKeys(addr);
      for (const cand of cands) {
        const addrId = cand.kind === 'exact' ? addressByKey.get('b:' + cand.key) : undefined;
        const targets = cand.kind === 'exact' ? (addrId && mkdByAddress.get(addrId)) || [] : mkdByLooseKey.get(cand.key) ?? [];
        if (!targets.length) continue;
        return {
          targets,
          confidence: targets.length === 1 ? cand.confidence : Math.min(cand.confidence, 0.5),
          note: targets.length === 1 ? cand.note : `${cand.note}; в реестре МЖД ${targets.length} записи с этим адресом`,
        };
      }
      const loose = cands.find((c) => c.kind === 'loose');
      const blocks = loose && !loose.key.includes(' блок ') ? mkdBlocksByBase.get(loose.key) ?? [] : [];
      if (blocks.length) return { targets: blocks, confidence: 0.5, note: 'Запись относится к дому целиком, в реестре МЖД дом учтён по блокам — связь со всеми блоками, требует проверки' };
      return null;
    };

    const links: AutoLink[] = [];
    const byCode = (from: number, refs: string[], idx: Map<string, number[]>, relation: string, what: string) => {
      for (const code of refs) {
        const targets = idx.get(code) ?? [];
        for (const to of targets) {
          if (to === from) continue;
          links.push({
            from, to, relation, method: 'auto:code',
            confidence: targets.length === 1 ? 0.9 : 0.5,
            note: targets.length === 1 ? `${what} №${code} найден в наименовании` : `${what} №${code}: в реестре ${targets.length} записи с этим номером — требуется выбор`,
          });
        }
      }
    };

    for (const o of objs) {
      const attrs = json<Record<string, unknown>>(o.attrs, {});
      if (o.category === 'el_vl' || o.category === 'el_kl') {
        byCode(o.id, splitRefs(attrs.tp_refs), tp, 'line_tp', 'ТП');
        byCode(o.id, splitRefs(attrs.ps_refs), ps, 'line_ps', 'ПС');
        byCode(o.id, splitRefs(attrs.rp_refs), rp, 'line_rp', 'РП');
        const houses = splitRefs(attrs.house_refs);
        const street = (attrs.subgroup as string) || o.address_raw;
        if (houses.length && street) {
          for (const h of houses) {
            const key = parseAddress(`${street} ${h}`).buildingKey;
            const addrId = key ? addressByKey.get('b:' + key) : undefined;
            for (const to of (addrId && mkdByAddress.get(addrId)) || []) {
              links.push({ from: o.id, to, relation: 'line_building', method: 'auto:address', confidence: 0.6, note: `Дом №${h} по «${street}» — сопоставлено по наименованию кабеля; требует проверки` });
            }
          }
        }
      }
      if (o.category === 'el_tp') byCode(o.id, findRpRefs(o.name), rp, 'tp_rp', 'РП');
      if (o.category === 'mkd_lifts' && !attrs.multi_address) {
        const found = findMkd(o.address_raw);
        for (const to of found?.targets ?? []) links.push({ from: o.id, to, relation: 'lift_building', method: 'auto:address', confidence: found!.confidence, note: found!.note });
      }
      if (o.category === 'mkd_emergency') {
        // сначала русский вариант адреса из источника («улица Ауэзова, 18»), затем исходный
        const found = findMkd(attrs.address_ru as string) ?? findMkd(o.address_raw);
        for (const to of found?.targets ?? []) links.push({ from: o.id, to, relation: 'emergency_building', method: 'auto:address', confidence: found!.confidence, note: found!.note });
      }
      if (o.category === 'capital_repair') {
        const found = findMkd(o.address_raw);
        for (const to of found?.targets ?? []) links.push({ from: o.id, to, relation: 'repair_building', method: 'auto:address', confidence: found!.confidence, note: found!.note });
      }
      if (['yards_approved', 'yards_design', 'yard_contracts'].includes(o.category) && attrs.houses_list) {
        // двор относится к нескольким домам: связь с каждым найденным домом из разобранного списка
        for (const house of String(attrs.houses_list).split('; ')) {
          // «Авангард-2, 21» → «Авангард-2 21»: запятая перед номером не должна читаться как список домов
          const found = findMkd(house.replace(/,\s*(?=[^,]*$)/, ' '));
          for (const to of found?.targets ?? []) {
            links.push({ from: o.id, to, relation: 'yard_building', method: 'auto:address', confidence: Math.min(found!.confidence, 0.7),
              note: `Дом «${house}» выделен из списка адресов двора; ${found!.note.charAt(0).toLowerCase()}${found!.note.slice(1)}` });
          }
        }
      }
      if (o.category === 'thermo' && o.address_id) {
        const targets = mkdByAddress.get(o.address_id) ?? [];
        for (const to of targets) {
          links.push({ from: o.id, to, relation: 'thermo_building', method: 'auto:address', confidence: targets.length === 1 ? 0.85 : 0.5, note: 'Совпадение нормализованного адреса (улица/микрорайон + номер дома)' });
        }
        // запасной вариант: «Курмангазы 1а, блок 6» → дом «Курмангазы, 1а»
        const key = buildingKeyById.get(o.address_id);
        if (!targets.length && key?.includes(' блок ')) {
          const baseId = addressByKey.get(key.split(' блок ')[0]);
          for (const to of (baseId && mkdByAddress.get(baseId)) || []) {
            links.push({ from: o.id, to, relation: 'thermo_building', method: 'auto:address', confidence: 0.5, note: 'Совпадение адреса без учёта номера блока — требует проверки' });
          }
        }
      }
    }
    let created = 0;
    for (const l of links) {
      created += run(
        `INSERT INTO object_links(from_id, to_id, relation, method, confidence, note) VALUES(?,?,?,?,?,?)
         ON CONFLICT(from_id, to_id, relation) DO NOTHING`,
        l.from, l.to, l.relation, l.method, l.confidence, l.note,
      ).changes;
    }
    return { created, total: get('SELECT count(*) n FROM object_links')!.n };
  });
}

export function linksFor(objectId: number) {
  return all(
    `SELECT l.*, CASE WHEN l.from_id = ? THEN 'out' ELSE 'in' END AS direction,
            o.uid, o.name, o.category, o.address_raw, o.deleted_at
       FROM object_links l
       JOIN objects o ON o.id = CASE WHEN l.from_id = ? THEN l.to_id ELSE l.from_id END
      WHERE (l.from_id = ? OR l.to_id = ?) AND o.deleted_at IS NULL
      ORDER BY l.status = 'rejected', l.relation, o.name`,
    objectId, objectId, objectId, objectId,
  ).map((l): Row => ({
    ...l,
    relation_label: l.direction === 'out' ? RELATIONS[l.relation]?.label ?? l.relation : RELATIONS[l.relation]?.reverse ?? l.relation,
  }));
}
