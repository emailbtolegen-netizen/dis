import { all, get } from '../db/db.ts';
import { categories, DOMAINS } from '../domain/categories.ts';
import { computeQuality } from './quality.ts';

const inList = (codes: string[]) => (codes.length ? codes.map(() => '?').join(',') : "''");

/** Все показатели рассчитываются по фактическим записям базы; при отсутствии данных показатель не выводится. */
export function dashboard(allowed: string[]) {
  const cats = categories();
  const byCategory = all(
    `SELECT category, count(*) n FROM objects WHERE deleted_at IS NULL AND category IN (${inList(allowed)}) GROUP BY category`, ...allowed,
  );
  const count = (c: string) => byCategory.find((r) => r.category === c)?.n ?? 0;
  const total = byCategory.reduce((s, r) => s + r.n, 0);
  const domains = Object.entries(DOMAINS).map(([code, d]) => ({
    code, name: d.name,
    count: byCategory.filter((r) => cats.get(r.category)?.domain === code).reduce((s, r) => s + r.n, 0),
  })).filter((d) => d.count > 0 || d.code !== 'other');

  const q = computeQuality(allowed);
  const lastUpdate = get(`SELECT max(updated_at) t FROM objects WHERE category IN (${inList(allowed)})`, ...allowed)?.t ?? null;
  const lastImport = get(`SELECT i.id, i.applied_at, s.file_name FROM imports i JOIN source_files s ON s.id = i.source_file_id WHERE i.status = 'applied' ORDER BY i.applied_at DESC LIMIT 1`) ?? null;

  // аварийность: показатель доступен, только если такой статус есть в данных
  const emergencyRows = all(
    `SELECT count(*) n FROM objects WHERE deleted_at IS NULL AND category IN (${inList(allowed)})
       AND (lower(status) LIKE '%авар%' OR lower(attrs) LIKE '%авар%')`, ...allowed);
  const emergencyCount = emergencyRows[0]?.n ?? 0;

  const res: any = {
    lastUpdate,
    lastImport,
    totals: {
      objects: total,
      incomplete: q.totals.incomplete,
      needsReview: q.totals.needsReview,
      emergency: emergencyCount > 0 ? { available: true, count: emergencyCount } : { available: false, note: 'В исходных данных нет признака аварийности объектов' },
    },
    domains,
    categories: [...cats.values()].filter((c) => allowed.includes(c.code)).map((c) => ({ code: c.code, name: c.name, short_name: c.short_name, domain: c.domain, count: count(c.code) })),
  };

  // электрохозяйство
  const energyCats = ['el_ps', 'el_rp', 'el_tp', 'el_vl', 'el_kl'].filter((c) => allowed.includes(c));
  if (energyCats.length) {
    const lines = all(
      `SELECT category, json_extract(attrs, '$.voltage_class') vc, count(*) n, round(sum(length_km), 3) km, sum(length_km IS NULL) no_len
         FROM objects WHERE deleted_at IS NULL AND category IN ('el_vl','el_kl') AND category IN (${inList(allowed)})
        GROUP BY category, vc ORDER BY category, vc`, ...allowed);
    const tpTypes = all(`SELECT coalesce(json_extract(attrs, '$.equipment_type'), 'не определён') t, count(*) n FROM objects WHERE deleted_at IS NULL AND category = 'el_tp' GROUP BY t ORDER BY n DESC`);
    const tpPower = all(`SELECT json_extract(attrs, '$.transformer_kva') kva, count(*) n FROM objects WHERE deleted_at IS NULL AND category = 'el_tp' AND json_extract(attrs, '$.transformer_kva') IS NOT NULL GROUP BY kva ORDER BY kva`);
    const capacity = all(`SELECT category, round(sum(power_kva)) kva, count(power_kva) with_power, count(*) n FROM objects WHERE deleted_at IS NULL AND category IN ('el_ps','el_rp','el_tp') GROUP BY category`);
    const rpStatus = all(`SELECT coalesce(status, 'Не указано') s, count(*) n FROM objects WHERE deleted_at IS NULL AND category = 'el_rp' GROUP BY s ORDER BY n DESC`);
    res.energy = {
      objects: energyCats.reduce((s, c) => s + count(c), 0),
      lineCount: count('el_vl') + count('el_kl'),
      lines: lines.map((l) => ({ ...l, type: l.category === 'el_vl' ? 'ВЛ' : 'КЛ' })),
      totalKm: Math.round(lines.reduce((s, l) => s + (l.km ?? 0), 0) * 1000) / 1000,
      tpTypes, tpPower, capacity, rpStatus,
    };
  }

  // жилищный фонд
  if (allowed.includes('mkd') && count('mkd')) {
    const agg = get(`SELECT count(*) n, round(sum(json_extract(attrs, '$.area_m2')), 2) area, sum(json_extract(attrs, '$.apartments')) apts,
                            count(json_extract(attrs, '$.area_m2')) with_area, count(json_extract(attrs, '$.apartments')) with_apts
                       FROM objects WHERE deleted_at IS NULL AND category = 'mkd'`)!;
    const group = (expr: string) => all(`SELECT ${expr} k, count(*) n FROM objects WHERE deleted_at IS NULL AND category = 'mkd' GROUP BY k ORDER BY n DESC`);
    const decades = all(`SELECT (year_built / 10) * 10 k, count(*) n FROM objects WHERE deleted_at IS NULL AND category = 'mkd' AND year_built IS NOT NULL GROUP BY k ORDER BY k`);
    res.housing = {
      count: agg.n,
      area: agg.area, areaCoverage: agg.with_area,
      apartments: agg.apts, apartmentsCoverage: agg.with_apts,
      byDecade: decades,
      byWall: group(`coalesce(json_extract(attrs, '$.wall_material'), 'Не указано')`),
      byHeating: group(`coalesce(json_extract(attrs, '$.heating'), 'Не указано')`),
      byFloors: all(`SELECT json_extract(attrs, '$.floors') k, count(*) n FROM objects WHERE deleted_at IS NULL AND category = 'mkd' AND json_type(attrs, '$.floors') = 'integer' GROUP BY k ORDER BY k`),
      gas: group(`coalesce(json_extract(attrs, '$.gas'), 'Не указано')`),
      elevators: get(`SELECT sum(CASE WHEN json_type(attrs, '$.elevators') = 'integer' THEN json_extract(attrs, '$.elevators') ELSE 0 END) lifts,
                             sum(json_type(attrs, '$.elevators') = 'integer') houses FROM objects WHERE deleted_at IS NULL AND category = 'mkd'`),
    };
  }
  if (allowed.includes('mkd_lifts') && count('mkd_lifts')) {
    const where = `deleted_at IS NULL AND category = 'mkd_lifts'`;
    const agg = get(`SELECT count(*) n, sum(json_extract(attrs, '$.lifts_total')) total, sum(json_extract(attrs, '$.lifts_broken')) broken,
                            sum(coalesce(json_extract(attrs, '$.lifts_broken'), 0) > 0) with_broken FROM objects WHERE ${where}`)!;
    const linked = get(`SELECT count(DISTINCT from_id) n, count(DISTINCT to_id) houses FROM object_links WHERE relation = 'lift_building' AND status != 'rejected'
                         AND from_id IN (SELECT id FROM objects WHERE ${where})`)!;
    res.lifts = {
      records: agg.n, total: agg.total, broken: agg.broken, withBroken: agg.with_broken,
      linked: linked.n, houses: linked.houses,
      byStatus: all(`SELECT coalesce(status, 'Не указано') s, count(*) n FROM objects WHERE ${where} GROUP BY s ORDER BY n DESC`),
      attention: all(`SELECT json_extract(attrs, '$.attention') a, count(*) n FROM objects WHERE ${where} AND json_extract(attrs, '$.attention') IS NOT NULL GROUP BY a ORDER BY n DESC`),
    };
  }
  if (allowed.includes('thermo') && count('thermo')) {
    res.thermo = {
      count: count('thermo'),
      byYear: all(`SELECT json_extract(attrs, '$.program_year') year, count(*) n, round(sum(json_extract(attrs, '$.amount_kzt')), 2) amount
                     FROM objects WHERE deleted_at IS NULL AND category = 'thermo' GROUP BY year ORDER BY year`),
      byStatus: all(`SELECT coalesce(status, 'Не указано') s, count(*) n FROM objects WHERE deleted_at IS NULL AND category = 'thermo' GROUP BY s`),
    };
  }
  res.quality = q.summary.filter((s) => s.count > 0);
  res.controlTotals = q.controlTotals.map((t: any) => ({ label: t.label, stated: t.stated, computed: t.computed, unit: t.unit, match: t.match, note: t.note ?? null }));
  return res;
}
