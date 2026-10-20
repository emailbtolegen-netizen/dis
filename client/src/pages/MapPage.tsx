import { EnvironmentOutlined } from '@ant-design/icons';
import { Alert, Badge, Card, Checkbox, Empty, Grid, Input, Segmented, Table } from 'antd';
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
 * Подложка — тайлы 2ГИС (как в исходной карте аварийных домов), при недоступности — OpenStreetMap.
 * Внешним сервисам передаются только запросы тайлов (IP пользователя и участок карты), данные объектов — нет.
 */

const ATYRAU: [number, number] = [47.1065, 51.9165];

/** Цвет метки по состоянию: аварийный — красный, ветхий — жёлтый, прочие — тёмно-синий. */
function colorOf(status: string | null): { fill: string; label: string } {
  const s = (status ?? '').toLowerCase();
  if (s.includes('аварий')) return { fill: '#d32f2f', label: 'Аварийный' };
  if (s.includes('ветх')) return { fill: '#f2b705', label: 'Ветхий' };
  return { fill: '#1f4e79', label: 'Прочие объекты' };
}

type Point = {
  uid: string; name: string; category: string; status: string | null; address_raw: string | null;
  lat: number; lon: number; year_built: number | null; attrs: Record<string, any>;
};

function popupHtml(p: Point, catName: string): HTMLElement {
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
  const c = colorOf(p.status);
  add('div', p.status ?? catName, `margin:6px 0;color:${c.fill === '#f2b705' ? '#8a6500' : c.fill};font-weight:600`);
  const rows: [string, unknown][] = [
    ['Заключение', a.conclusion], ['Год постройки', p.year_built], ['Этажей', a.floors], ['Квартир', a.flats],
    ['Площадь, м²', a.area_m2 != null ? Number(a.area_m2).toLocaleString('ru-RU') : null], ['Раздел', catName],
  ];
  for (const [k, v] of rows) if (v != null && v !== '') add('div', `${k}: ${v}`, 'font-size:12px');
  return div;
}

export default function MapPage() {
  const { data, error, loading } = useApi<{ points: Point[]; withoutCoords: { category: string; n: number }[] }>('/map');
  const { cat } = useSession();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const screens = Grid.useBreakpoint();
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Map<string, L.CircleMarker>>(new Map());
  const points = useMemo(() => data?.points ?? [], [data]);
  const categories = useMemo(() => [...new Set(points.map((p) => p.category))], [points]);

  // выбранные разделы (?category=a,b) — по умолчанию все
  const selectedCats = sp.get('category') ? sp.get('category')!.split(',') : categories;
  const statusFilter = sp.get('s') ?? 'all';
  const [q, setQ] = useState('');
  const setParam = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v); else n.delete(k);
    setSp(n, { replace: true });
  };

  const visible = useMemo(() => {
    const fq = fold(q);
    return points.filter((p) => selectedCats.includes(p.category)
      && (statusFilter === 'all' || colorOf(p.status).label === statusFilter)
      && (!fq || fold(`${p.address_raw} ${p.name} ${p.attrs?.address_ru ?? ''}`).includes(fq)));
  }, [points, selectedCats, statusFilter, q]);

  const counts = useMemo(() => {
    const base = points.filter((p) => selectedCats.includes(p.category));
    return {
      all: base.length,
      red: base.filter((p) => colorOf(p.status).label === 'Аварийный').length,
      yellow: base.filter((p) => colorOf(p.status).label === 'Ветхий').length,
    };
  }, [points, selectedCats]);

  // карта и подложки
  useEffect(() => {
    if (!el.current || !points.length || mapRef.current) return;
    const map = L.map(el.current, { zoomControl: true }).setView(ATYRAU, 13);
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
    legend.onAdd = () => {
      const d = L.DomUtil.create('div', 'map-legend');
      for (const [color, text] of [['#d32f2f', 'Аварийный — признан, есть заключение'], ['#f2b705', 'Ветхий — заключения нет или капремонт'], ['#1f4e79', 'Прочие объекты']]) {
        const row = L.DomUtil.create('div', '', d);
        const dot = L.DomUtil.create('span', 'dot', row);
        dot.style.background = color;
        row.appendChild(document.createTextNode(text));
      }
      return d;
    };
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

  // метки
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    markersRef.current.clear();
    for (const p of visible) {
      const c = colorOf(p.status);
      const m = L.circleMarker([p.lat, p.lon], { radius: 8, color: '#ffffff', weight: 2, fillColor: c.fill, fillOpacity: 0.95 });
      const div = popupHtml(p, cat(p.category)?.short_name ?? p.category);
      const link = document.createElement('a');
      link.textContent = 'Открыть карточку →';
      link.href = `/objects/${p.uid}`;
      link.style.display = 'inline-block';
      link.style.marginTop = '6px';
      link.onclick = (e) => { e.preventDefault(); nav(`/objects/${p.uid}`); };
      div.appendChild(link);
      m.bindPopup(div);
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
    mapRef.current.flyTo([p.lat, p.lon], Math.max(mapRef.current.getZoom(), 16), { duration: 0.6 });
    setTimeout(() => m.openPopup(), 650);
  };

  const without = (data?.withoutCoords ?? []).reduce((s, r) => s + r.n, 0);
  const hasEmergency = counts.red + counts.yellow > 0;

  return (
    <>
      <PageTitle title="Карта объектов" sub="Объекты с достоверными координатами. Аварийные и ветхие дома — по данным карты аварийных домов г. Атырау." />
      <Loading error={error} loading={loading}>
        {data && !points.length && (
          <Alert type="info" showIcon style={{ marginBottom: 12 }} message="В базе пока нет объектов с координатами"
            description={`Координаты можно добавить в карточке объекта или импортировать из файла. Объектов без координат: ${without}.`} />
        )}
        {points.length > 0 && (
          <div style={{ display: 'flex', flexDirection: screens.lg ? 'row' : 'column-reverse', gap: 12, alignItems: 'stretch' }}>
            <Card size="small" style={{ width: screens.lg ? 340 : '100%', flex: 'none' }} styles={{ body: { display: 'flex', flexDirection: 'column', gap: 10, height: screens.lg ? 'calc(100vh - 190px)' : 'auto' } }}>
              {categories.length > 1 && (
                <Checkbox.Group value={selectedCats} onChange={(v) => setParam('category', (v as string[]).length === categories.length ? null : (v as string[]).join(',') || 'none')}
                  style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
                  options={categories.map((c) => ({ value: c, label: `${cat(c)?.short_name ?? c} (${points.filter((p) => p.category === c).length})` }))} />
              )}
              {hasEmergency && (
                <Segmented value={statusFilter} style={{ alignSelf: 'flex-start', maxWidth: '100%' }} onChange={(v) => setParam('s', v === 'all' ? null : String(v))}
                  options={[
                    { value: 'all', label: `Все ${counts.all}` },
                    { value: 'Аварийный', label: <Badge color="#d32f2f" text={`Аварийные ${counts.red}`} /> },
                    { value: 'Ветхий', label: <Badge color="#f2b705" text={`Ветхие ${counts.yellow}`} /> },
                  ]} />
              )}
              <Input.Search allowClear placeholder="Поиск по адресу…" value={q} onChange={(e) => setQ(e.target.value)} />
              <div style={{ overflow: 'auto', flex: 1, maxHeight: screens.lg ? undefined : 320 }}>
                {visible.length ? visible.map((p) => {
                  const c = colorOf(p.status);
                  return (
                    <div key={p.uid} className="map-list-item" onClick={() => focus(p)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') focus(p); }}>
                      <span className="dot" style={{ background: c.fill }} />
                      <div style={{ minWidth: 0 }}>
                        <div className="t">{p.attrs?.address_ru ?? p.address_raw ?? p.name}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {[p.attrs?.address_ru ? p.address_raw : null, p.year_built && `${p.year_built} г.`, p.attrs?.floors && `${p.attrs.floors} эт.`, p.attrs?.conclusion].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                    </div>
                  );
                }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Ничего не найдено" />}
              </div>
              <div className="muted" style={{ fontSize: 12 }}><EnvironmentOutlined /> Показано {visible.length} из {points.length}. Без координат: {without}.</div>
            </Card>
            <Card size="small" style={{ flex: 1, minWidth: 0 }} styles={{ body: { padding: 0, height: screens.lg ? 'calc(100vh - 170px)' : '60vh' } }}>
              <div ref={el} style={{ height: '100%' }} />
            </Card>
          </div>
        )}
        <Card size="small" title="Объекты без координат по разделам" style={{ marginTop: 12 }}>
          <Table size="small" rowKey="category" pagination={false} dataSource={data?.withoutCoords ?? []}
            columns={[{ title: 'Раздел', dataIndex: 'category', render: (c) => cat(c)?.name ?? c }, { title: 'Без координат', dataIndex: 'n', align: 'right' }]} />
        </Card>
      </Loading>
    </>
  );
}
