import { EnvironmentOutlined } from '@ant-design/icons';
import { Alert, Badge, Card, Empty, Grid, Input, Segmented, Select } from 'antd';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loading, PageTitle } from '../components/common';
import { fold } from '../lib/text';
import { useApi } from '../lib/hooks';
import { useSession } from '../lib/session';

/**
 * Карта объектов: показываются только объекты с координатами (из источника или внесённые вручную).
 * Координаты не придумываются и не определяются автоматически по адресу.
 * Подложка — тайлы 2ГИС (как в исходных картах), при недоступности — OpenStreetMap.
 * Внешним сервисам передаются только запросы тайлов (IP пользователя и участок карты), данные объектов — нет.
 */

const ATYRAU: [number, number] = [47.1065, 51.9165];

/** Периоды постройки и цвета — как в исходной карте жилого фонда. */
const PERIODS = [
  { key: '1', label: 'до 1960 г.', fill: '#8c2d19' },
  { key: '2', label: '1961–1990 гг.', fill: '#e0892b' },
  { key: '3', label: '1991–2010 гг.', fill: '#3b84b5' },
  { key: '4', label: 'с 2011 г.', fill: '#1f8a6a' },
  { key: '0', label: 'год не указан', fill: '#9aa29e' },
];
const periodOf = (year: number | null) => (!year ? '0' : year <= 1960 ? '1' : year <= 1990 ? '2' : year <= 2010 ? '3' : '4');

type Point = {
  uid: string; name: string; category: string; status: string | null; address_raw: string | null;
  lat: number; lon: number; year_built: number | null; attrs: Record<string, any>;
  lifts?: { n: number; bad: number };
  shared?: number;
};

const isEmergencyStatus = (s: string | null) => /аварий|ветх/i.test(s ?? '');

/** Цвет метки: аварийный — красный, ветхий — жёлтый; дома МЖД — по периоду постройки; прочие — тёмно-синий. */
function colorOf(p: Point): { fill: string; label: string } {
  const s = (p.status ?? '').toLowerCase();
  if (s.includes('аварий')) return { fill: '#d32f2f', label: 'Аварийный' };
  if (s.includes('ветх')) return { fill: '#f2b705', label: 'Ветхий' };
  if (p.category === 'mkd') {
    const per = PERIODS.find((x) => x.key === periodOf(p.year_built))!;
    return { fill: per.fill, label: per.label };
  }
  return { fill: '#1f4e79', label: 'Прочие объекты' };
}

function popupHtml(p: Point, catName: string, show: (key: string, v: unknown) => string): HTMLElement {
  const a = p.attrs ?? {};
  const div = document.createElement('div');
  div.style.minWidth = '220px';
  const add = (tag: string, text: string, style = '') => {
    const el = document.createElement(tag);
    el.textContent = text;
    if (style) el.setAttribute('style', style);
    div.appendChild(el);
    return el;
  };
  add('div', p.address_raw ?? p.name, 'font-weight:600;font-size:14px;margin-bottom:2px');
  if (a.address_ru && a.address_ru !== p.address_raw) add('div', a.address_ru, 'color:#52606d;font-size:12px');
  const c = colorOf(p);
  add('div', p.status ?? (p.category === 'mkd' ? `${catName} · ${c.label}` : catName), `margin:6px 0;color:${c.fill === '#f2b705' ? '#8a6500' : c.fill};font-weight:600`);
  const rows: [string, unknown][] = [
    ['Заключение', a.conclusion], ['Год постройки', p.year_built], ['Этажей', a.floors], ['Квартир', a.flats ?? a.apartments],
    ['Площадь, м²', a.area_m2 != null && a.area_m2 !== '' ? Number(a.area_m2).toLocaleString('ru-RU') : null],
    ['Стены', show('wall_material', a.wall_material)], ['Отопление', show('heating', a.heating)],
    ['Управление', a.management && a.management !== '-' ? a.management : null],
    ['Лифты', p.lifts ? `${p.lifts.n} в реестре лифтов${p.lifts.bad ? `, с неработающими: ${p.lifts.bad}` : ''}` : null],
  ];
  for (const [k, v] of rows) if (v != null && v !== '') add('div', `${k}: ${v}`, 'font-size:12px');
  if (p.shared) add('div', `Те же координаты у ${p.shared} домов (точка квартала) — метки разнесены для удобства`, 'font-size:11px;color:#8a6500;margin-top:4px');
  return div;
}

/** Две отдельные карты: жилой фонд (дома реестра МЖД) и аварийные дома (перечень аварийных и ветхих домов). */
const MODES = {
  housing: {
    category: 'mkd', title: 'Карта жилого фонда',
    sub: 'Многоквартирные жилые дома реестра МЖД с координатами из карты жилого фонда г. Атырау. Цвет метки — период постройки.',
  },
  emergency: {
    category: 'mkd_emergency', title: 'Карта аварийных домов',
    sub: 'Аварийные и ветхие многоквартирные дома по карте аварийных домов г. Атырау.',
  },
} as const;

export default function MapPage({ mode }: { mode: keyof typeof MODES }) {
  const M = MODES[mode];
  const { data, error, loading } = useApi<{ points: Point[]; withoutCoords: { category: string; n: number }[] }>('/map');
  const { cat } = useSession();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const screens = Grid.useBreakpoint();
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef<Map<string, L.CircleMarker>>(new Map());

  // точки с одинаковыми координатами немного разносятся, чтобы каждую можно было выбрать (только отображение)
  const points = useMemo(() => {
    const src = (data?.points ?? []).filter((p) => p.category === M.category).map((p) => ({ ...p }));
    const groups = new Map<string, Point[]>();
    for (const p of src) {
      const k = `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
      groups.set(k, [...(groups.get(k) ?? []), p]);
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      g.forEach((p, i) => {
        const a = (i / g.length) * 2 * Math.PI;
        const r = 0.00012 * (1 + Math.floor(i / 8));
        p.shared = g.length;
        p.lat += r * Math.sin(a);
        p.lon += r * 1.47 * Math.cos(a);
      });
    }
    return src;
  }, [data, M.category]);
  const selectedCats = useMemo(() => [M.category as string], [M.category]);

  // выбранные разделы (?category=a,b) — по умолчанию все; ?s — состояние, ?p — период постройки, ?l — лифты
  const periodParam = sp.get('p');
  const statusFilter = sp.get('s') ?? 'all';
  const periodFilter = useMemo(() => (periodParam ? periodParam.split(',') : []), [periodParam]);
  const liftFilter = sp.get('l') ?? 'all';
  const [q, setQ] = useState('');
  const setParam = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v); else n.delete(k);
    setSp(n, { replace: true });
  };

  const base = useMemo(() => points.filter((p) => selectedCats.includes(p.category)), [points, selectedCats]);
  const hasMkd = base.some((p) => p.category === 'mkd');
  const counts = useMemo(() => ({
    all: base.length,
    red: base.filter((p) => colorOf(p).label === 'Аварийный').length,
    yellow: base.filter((p) => colorOf(p).label === 'Ветхий').length,
    periods: Object.fromEntries(PERIODS.map((x) => [x.key, base.filter((p) => p.category === 'mkd' && periodOf(p.year_built) === x.key).length])),
    lifts: base.filter((p) => p.lifts).length,
    liftsBad: base.filter((p) => p.lifts?.bad).length,
  }), [base]);

  const visible = useMemo(() => {
    const fq = fold(q);
    return base.filter((p) => (statusFilter === 'all' || colorOf(p).label === statusFilter)
      && (!periodFilter.length || (p.category === 'mkd' && periodFilter.includes(periodOf(p.year_built))))
      && (liftFilter === 'all' || (liftFilter === 'yes' ? !!p.lifts : !!p.lifts?.bad))
      && (!fq || fold(`${p.address_raw} ${p.name} ${p.attrs?.address_ru ?? ''} ${p.attrs?.management ?? ''}`).includes(fq)));
  }, [base, statusFilter, periodFilter, liftFilter, q]);

  // карта и подложки
  useEffect(() => {
    if (!el.current || !points.length || mapRef.current) return;
    const map = L.map(el.current, { zoomControl: true, preferCanvas: true }).setView(ATYRAU, 13);
    const gis = L.tileLayer('https://tile{s}.maps.2gis.com/tiles?x={x}&y={y}&z={z}&v=1', { subdomains: '0123', maxZoom: 18, attribution: '© 2ГИС' });
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© участники OpenStreetMap' });
    gis.addTo(map);
    // если тайлы 2ГИС не загружаются — автоматически OpenStreetMap
    let errors = 0;
    gis.on('tileerror', () => {
      if (++errors === 6 && map.hasLayer(gis)) {
        map.removeLayer(gis);
        osm.addTo(map);
      }
    });
    L.control.layers({ '2ГИС': gis, OpenStreetMap: osm }, undefined, { position: 'topright' }).addTo(map);
    const legend = new L.Control({ position: 'bottomright' });
    legend.onAdd = () => (legendRef.current = L.DomUtil.create('div', 'map-legend') as HTMLDivElement);
    legend.addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    // пересчёт размера при сворачивании меню/изменении окна
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [points.length]);

  // легенда — по показанным разделам
  useEffect(() => {
    const d = legendRef.current;
    if (!d) return;
    d.replaceChildren();
    const items: [string, string][] = [];
    if (base.some((p) => isEmergencyStatus(p.status))) items.push(['#d32f2f', 'Аварийный — признан, есть заключение'], ['#f2b705', 'Ветхий — заключения нет или капремонт']);
    if (hasMkd) for (const x of PERIODS) items.push([x.fill, `МЖД: ${x.label}`]);
    if (base.some((p) => p.category !== 'mkd' && !isEmergencyStatus(p.status))) items.push(['#1f4e79', 'Прочие объекты']);
    for (const [color, text] of items) {
      const row = L.DomUtil.create('div', '', d);
      const dot = L.DomUtil.create('span', 'dot', row);
      dot.style.background = color;
      row.appendChild(document.createTextNode(text));
    }
  }, [base, hasMkd, points.length]);

  // метки: аварийные поверх остальных; карточка во всплывающем окне строится при открытии
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    markersRef.current.clear();
    const show = (p: Point) => (key: string, v: unknown) => {
      if (v == null || v === '') return '';
      const f = cat(p.category)?.fields.find((x) => x.key === key) as any;
      return String(f?.valueMap?.[String(v)] ?? v);
    };
    const ordered = [...visible].sort((a, b) => Number(isEmergencyStatus(a.status)) - Number(isEmergencyStatus(b.status)));
    for (const p of ordered) {
      const c = colorOf(p);
      const emergency = isEmergencyStatus(p.status);
      const m = L.circleMarker([p.lat, p.lon], { radius: emergency ? 8 : 6, color: '#ffffff', weight: emergency ? 2 : 1, fillColor: c.fill, fillOpacity: 0.95 });
      m.bindPopup(() => {
        const div = popupHtml(p, cat(p.category)?.short_name ?? p.category, show(p));
        const link = document.createElement('a');
        link.textContent = 'Открыть карточку →';
        link.href = `/objects/${p.uid}`;
        link.style.display = 'inline-block';
        link.style.marginTop = '6px';
        link.onclick = (e) => { e.preventDefault(); nav(`/objects/${p.uid}`); };
        div.appendChild(link);
        return div;
      });
      m.bindTooltip(p.address_raw ?? p.name, { direction: 'top', offset: [0, -6] });
      layer.addLayer(m);
      markersRef.current.set(p.uid, m);
    }
    if (visible.length && mapRef.current && !q) {
      mapRef.current.fitBounds(L.latLngBounds(visible.map((p) => [p.lat, p.lon] as [number, number])), { maxZoom: 15, padding: [30, 30] });
    }
  }, [visible, cat, nav, q]);

  const focus = (p: Point) => {
    const m = markersRef.current.get(p.uid);
    if (!m || !mapRef.current) return;
    mapRef.current.flyTo([p.lat, p.lon], Math.max(mapRef.current.getZoom(), 17), { duration: 0.6 });
    setTimeout(() => m.openPopup(), 650);
  };

  const without = (data?.withoutCoords ?? []).filter((r) => r.category === M.category).reduce((s, r) => s + r.n, 0);
  const hasEmergency = counts.red + counts.yellow > 0;

  return (
    <>
      <PageTitle title={M.title} sub={M.sub} />
      <Loading error={error} loading={loading}>
        {data && !points.length && (
          <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`Данные для карты пока не загружены`}
            description={mode === 'housing'
              ? 'Загрузите файл карты жилого фонда (karta-zhilogo-fonda-atyrau.html) в разделе «Администрирование → Импорт Excel» — координаты будут добавлены к домам реестра МЖД.'
              : 'Загрузите файл карты аварийных домов (karta-avariynyh-domov-atyrau.html) или таблицу «АВАР 88 үй.xlsx» в разделе «Администрирование → Импорт Excel».'} />
        )}
        {points.length > 0 && (
          <div style={{ display: 'flex', flexDirection: screens.lg ? 'row' : 'column-reverse', gap: 12, alignItems: 'stretch' }}>
            <Card size="small" style={{ width: screens.lg ? 340 : '100%', flex: 'none' }} styles={{ body: { display: 'flex', flexDirection: 'column', gap: 10, height: screens.lg ? 'calc(100vh - 190px)' : 'auto' } }}>
              {hasEmergency && (
                <Segmented value={statusFilter} style={{ alignSelf: 'flex-start', maxWidth: '100%' }} onChange={(v) => setParam('s', v === 'all' ? null : String(v))}
                  options={[
                    { value: 'all', label: `Все ${counts.all}` },
                    { value: 'Аварийный', label: <Badge color="#d32f2f" text={`Аварийные ${counts.red}`} /> },
                    { value: 'Ветхий', label: <Badge color="#f2b705" text={`Ветхие ${counts.yellow}`} /> },
                  ]} />
              )}
              {hasMkd && (
                <>
                  <Select mode="multiple" allowClear placeholder="МЖД: период постройки" value={periodFilter} onChange={(v: string[]) => setParam('p', v.length ? v.join(',') : null)}
                    options={PERIODS.map((x) => ({ value: x.key, label: <Badge color={x.fill} text={`${x.label} (${counts.periods[x.key]})`} /> }))} />
                  {counts.lifts > 0 && (
                    <Select value={liftFilter} onChange={(v) => setParam('l', v === 'all' ? null : v)}
                      options={[
                        { value: 'all', label: 'Лифты: все дома' },
                        { value: 'yes', label: `Дома с лифтами из реестра (${counts.lifts})` },
                        { value: 'bad', label: `Есть неработающие лифты (${counts.liftsBad})` },
                      ]} />
                  )}
                </>
              )}
              <Input.Search allowClear placeholder="Поиск по адресу или управляющей организации…" value={q} onChange={(e) => setQ(e.target.value)} />
              <div style={{ overflow: 'auto', flex: 1, maxHeight: screens.lg ? undefined : 320 }}>
                {visible.length ? visible.map((p) => {
                  const c = colorOf(p);
                  return (
                    <div key={p.uid} className="map-list-item" onClick={() => focus(p)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') focus(p); }}>
                      <span className="dot" style={{ background: c.fill }} />
                      <div style={{ minWidth: 0 }}>
                        <div className="t">{p.attrs?.address_ru ?? p.address_raw ?? p.name}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {[p.attrs?.address_ru ? p.address_raw : null, p.year_built && `${p.year_built} г.`, p.attrs?.floors && `${p.attrs.floors} эт.`, p.lifts && `лифтов: ${p.lifts.n}${p.lifts.bad ? ' (есть неработающие)' : ''}`, p.attrs?.conclusion].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                    </div>
                  );
                }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Ничего не найдено" />}
              </div>
              <div className="muted" style={{ fontSize: 12 }}><EnvironmentOutlined /> Показано {visible.length} из {points.length}.{without ? ` Без координат: ${without} (на карте не показаны).` : ''}</div>
            </Card>
            <Card size="small" style={{ flex: 1, minWidth: 0 }} styles={{ body: { padding: 0, height: screens.lg ? 'calc(100vh - 170px)' : '60vh' } }}>
              <div ref={el} style={{ height: '100%' }} />
            </Card>
          </div>
        )}
      </Loading>
    </>
  );
}
