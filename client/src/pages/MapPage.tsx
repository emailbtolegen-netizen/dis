import { EnvironmentOutlined } from '@ant-design/icons';
import { Alert, Badge, Card, Empty, Grid, Input, Select } from 'antd';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loading, PageTitle } from '../components/common';
import { fold } from '../lib/text';
import { useApi } from '../lib/hooks';
import { useSession } from '../lib/session';

/**
 * Карта жилого фонда г. Атырау (по образцу карты karta-zhilogo-fonda-atyrau):
 * дома реестра МЖД — точки по периоду постройки; аварийные и ветхие дома — метки красного/жёлтого цвета поверх;
 * красное кольцо — в доме есть неработающие лифты (реестр лифтов).
 * Показываются только объекты с координатами из источников; координаты не придумываются.
 * Подложка — тайлы 2ГИС, при недоступности — OpenStreetMap. Данные объектов внешним сервисам не передаются.
 */

const ATYRAU: [number, number] = [47.1065, 51.9165];
const PERIODS = [
  { key: '1', label: 'до 1960 г.', fill: '#8c2d19' },
  { key: '2', label: '1961–1990 гг.', fill: '#e0892b' },
  { key: '3', label: '1991–2010 гг.', fill: '#3b84b5' },
  { key: '4', label: 'с 2011 г.', fill: '#1f8a6a' },
  { key: '0', label: 'год не указан', fill: '#9aa29e' },
];
const RED = '#d32f2f';
const YELLOW = '#f2b705';
const RING = '#d7263d';
const periodOf = (year: number | null | undefined) => (!year ? '0' : year <= 1960 ? '1' : year <= 1990 ? '2' : year <= 2010 ? '3' : '4');

type Point = {
  uid: string; name: string; category: string; status: string | null; address_raw: string | null;
  lat: number; lon: number; year_built: number | null; attrs: Record<string, any>;
  lifts?: { n: number; bad: number }; mkd_uid?: string;
};
type House = {
  key: string; mkd?: Point; em?: Point; lat: number; lon: number; shared?: number;
  addr: string; year: number | null; period: string; red: boolean; yellow: boolean; liftsBad: boolean; search: string;
};

const emKind = (p?: Point) => (!p ? null : /аварий/i.test(p.status ?? '') ? 'red' : /ветх/i.test(p.status ?? '') ? 'yellow' : null);
const hasLift = (v: unknown) => v != null && v !== '' && !['жоқ', 'жок', 'нет', '0', '-'].includes(String(v).trim().toLowerCase());

function popupHtml(h: House, show: (key: string, v: unknown) => string, open: (uid: string) => void): HTMLElement {
  const div = document.createElement('div');
  div.style.minWidth = '230px';
  const add = (tag: string, text: string, style = '', parent: HTMLElement = div) => {
    const el = document.createElement(tag);
    el.textContent = text;
    if (style) el.setAttribute('style', style);
    parent.appendChild(el);
    return el;
  };
  const a = h.mkd?.attrs ?? {};
  const e = h.em?.attrs ?? {};
  add('div', h.addr, 'font-weight:600;font-size:14px;margin-bottom:2px');
  if (e.address_ru && e.address_ru !== h.addr) add('div', e.address_ru, 'color:#52606d;font-size:12px');
  const per = PERIODS.find((x) => x.key === h.period)!;
  add('div', h.mkd ? `Реестр МЖД · ${per.label}` : 'Нет в реестре МЖД (только в списке аварийных домов)', `margin:4px 0;font-size:12px;color:${h.mkd ? per.fill : '#8a6500'};font-weight:600`);
  if (h.em) {
    const k = emKind(h.em);
    const box = add('div', '', `margin:6px 0;padding:6px 8px;border-radius:6px;font-size:12px;background:${k === 'red' ? '#fdecea' : '#fff7d6'};border-left:3px solid ${k === 'red' ? RED : YELLOW}`);
    add('div', `${k === 'red' ? 'Аварийный дом' : k === 'yellow' ? 'Ветхий дом' : 'Дом из списка аварийных'}${e.no_in_list ? ` · №${e.no_in_list} в списке аварийных` : ''}`, 'font-weight:600', box);
    if (e.conclusion) add('div', `Заключение: ${e.conclusion}`, '', box);
  }
  const rows: [string, unknown][] = [
    ['Год постройки', h.year], ['Этажей', a.floors ?? e.floors], ['Квартир', a.apartments ?? e.flats],
    ['Площадь, м²', (a.area_m2 ?? e.area_m2) != null ? Number(a.area_m2 ?? e.area_m2).toLocaleString('ru-RU') : null],
    ['Стены', show('wall_material', a.wall_material)], ['Отопление', show('heating', a.heating)],
    ['Управление', a.management && a.management !== '-' ? a.management : null],
    ['Лифты', h.mkd?.lifts ? `${h.mkd.lifts.n} в реестре лифтов${h.mkd.lifts.bad ? `, не работают: ${h.mkd.lifts.bad}` : ''}` : null],
  ];
  for (const [k, v] of rows) if (v != null && v !== '') add('div', `${k}: ${v}`, 'font-size:12px');
  if (h.shared) add('div', `Те же координаты у ${h.shared} домов (точка квартала) — метки разнесены для удобства`, 'font-size:11px;color:#8a6500;margin-top:4px');
  const links = add('div', '', 'margin-top:6px;display:flex;gap:12px;flex-wrap:wrap');
  const link = (text: string, uid: string) => {
    const l = add('a', text, '', links) as HTMLAnchorElement;
    l.href = `/objects/${uid}`;
    l.onclick = (ev) => { ev.preventDefault(); open(uid); };
  };
  if (h.mkd) link('Карточка дома →', h.mkd.uid);
  if (h.em) link(h.mkd ? 'Аварийность →' : 'Карточка →', h.em.uid);
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

  const show = useMemo(() => (key: string, v: unknown) => {
    if (v == null || v === '') return '';
    const f = cat('mkd')?.fields.find((x) => x.key === key) as any;
    return String(f?.valueMap?.[String(v)] ?? v);
  }, [cat]);

  // дома: запись реестра МЖД и (если есть) запись из списка аварийных — одной меткой
  const houses = useMemo(() => {
    const pts = data?.points ?? [];
    const mkd = new Map<string, House>();
    const out: House[] = [];
    const make = (m: Point | undefined, em: Point | undefined): House => {
      const p = (m ?? em)!;
      const year = m?.year_built ?? em?.year_built ?? null;
      const k = emKind(em);
      return {
        key: p.uid, mkd: m, em, lat: p.lat, lon: p.lon, addr: m?.address_raw ?? em?.address_raw ?? p.name, year, period: periodOf(year),
        red: k === 'red', yellow: k === 'yellow', liftsBad: !!m?.lifts?.bad,
        search: fold(`${m?.address_raw ?? ''} ${em?.address_raw ?? ''} ${em?.attrs?.address_ru ?? ''} ${m?.attrs?.management ?? ''}`),
      };
    };
    for (const p of pts) if (p.category === 'mkd') { const h = make(p, undefined); mkd.set(p.uid, h); out.push(h); }
    for (const p of pts) {
      if (p.category !== 'mkd_emergency') continue;
      const h = p.mkd_uid ? mkd.get(p.mkd_uid) : undefined;
      if (h && !h.em) Object.assign(h, make(h.mkd, p), { key: h.key, lat: h.lat, lon: h.lon });
      else out.push(make(undefined, p));
    }
    // одинаковые координаты — метки немного разносятся (только отображение)
    const groups = new Map<string, House[]>();
    for (const h of out) { const k = `${h.lat.toFixed(6)},${h.lon.toFixed(6)}`; groups.set(k, [...(groups.get(k) ?? []), h]); }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      g.forEach((h, i) => {
        const ang = (i / g.length) * 2 * Math.PI;
        const r = 0.00012 * (1 + Math.floor(i / 8));
        h.shared = g.length;
        h.lat += r * Math.sin(ang);
        h.lon += r * 1.47 * Math.cos(ang);
      });
    }
    return out;
  }, [data]);

  // фильтры в адресе страницы: p — периоды, av — аварийность, w — стены, ht — отопление, l — лифты
  const pParam = sp.get('p');
  const periods = useMemo(() => (pParam ? pParam.split(',') : []), [pParam]);
  const av = sp.get('av') ?? 'all';
  const wall = sp.get('w') ?? '';
  const heat = sp.get('ht') ?? '';
  const lift = sp.get('l') ?? 'all';
  const [q, setQ] = useState('');
  const setParam = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v); else n.delete(k);
    setSp(n, { replace: true });
  };

  const options = useMemo(() => {
    const uniq = (key: string) => [...new Set(houses.map((h) => h.mkd?.attrs?.[key]).filter((v) => v != null && v !== '' && v !== '-').map((v) => show(key, v)))].sort();
    return { walls: uniq('wall_material'), heats: uniq('heating') };
  }, [houses, show]);

  const counts = useMemo(() => ({
    red: houses.filter((h) => h.red).length,
    yellow: houses.filter((h) => h.yellow).length,
    liftsBad: houses.filter((h) => h.liftsBad).length,
    periods: Object.fromEntries(PERIODS.map((x) => [x.key, houses.filter((h) => h.period === x.key).length])),
  }), [houses]);

  const visible = useMemo(() => {
    const fq = fold(q);
    return houses.filter((h) => (!periods.length || periods.includes(h.period))
      && (av === 'all' || (av === 'any' ? h.red || h.yellow : av === 'red' ? h.red : h.yellow))
      && (!wall || show('wall_material', h.mkd?.attrs?.wall_material) === wall)
      && (!heat || show('heating', h.mkd?.attrs?.heating) === heat)
      && (lift === 'all' || (lift === 'with' ? hasLift(h.mkd?.attrs?.elevators) : lift === 'without' ? !!h.mkd && !hasLift(h.mkd.attrs?.elevators) : lift === 'registry' ? !!h.mkd?.lifts : h.liftsBad))
      && (!fq || h.search.includes(fq)));
  }, [houses, periods, av, wall, heat, lift, q, show]);

  const totals = useMemo(() => ({
    flats: visible.reduce((s, h) => s + (Number(h.mkd?.attrs?.apartments ?? h.em?.attrs?.flats) || 0), 0),
    area: visible.reduce((s, h) => s + (Number(h.mkd?.attrs?.area_m2 ?? h.em?.attrs?.area_m2) || 0), 0),
  }), [visible]);

  // карта, подложки и легенда
  useEffect(() => {
    if (!el.current || !houses.length || mapRef.current) return;
    const map = L.map(el.current, { zoomControl: true, preferCanvas: true }).setView(ATYRAU, 13);
    const gis = L.tileLayer('https://tile{s}.maps.2gis.com/tiles?x={x}&y={y}&z={z}&v=1', { subdomains: '0123', maxZoom: 18, attribution: '© 2ГИС' });
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© участники OpenStreetMap' });
    gis.addTo(map);
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
      const row = (style: Partial<CSSStyleDeclaration>, text: string) => {
        const r = L.DomUtil.create('div', '', d);
        const dot = L.DomUtil.create('span', 'dot', r);
        Object.assign(dot.style, style);
        r.appendChild(document.createTextNode(text));
      };
      for (const x of PERIODS) row({ background: x.fill }, x.label);
      row({ background: RED, border: '2px solid #fff', boxShadow: '0 0 0 1px #999' }, 'аварийный — есть заключение');
      row({ background: YELLOW, border: '2px solid #fff', boxShadow: '0 0 0 1px #999' }, 'ветхий — заключения нет или к капремонту');
      row({ background: '#fff', border: `3px solid ${RING}` }, 'красное кольцо — есть неработающие лифты');
      return d;
    };
    legend.addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [houses.length]);

  // метки: аварийные и ветхие — поверх; карточка во всплывающем окне строится при открытии
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    markersRef.current.clear();
    const ordered = [...visible].sort((a, b) => Number(a.red || a.yellow) - Number(b.red || b.yellow));
    for (const h of ordered) {
      const em = h.red || h.yellow;
      const fill = h.red ? RED : h.yellow ? YELLOW : PERIODS.find((x) => x.key === h.period)!.fill;
      const m = L.circleMarker([h.lat, h.lon], {
        radius: em ? 8 : 6, fillColor: fill, fillOpacity: 0.95,
        color: h.liftsBad ? RING : '#ffffff', weight: h.liftsBad ? 3 : em ? 2 : 1,
      });
      m.bindPopup(() => popupHtml(h, show, (uid) => nav(`/objects/${uid}`)));
      m.bindTooltip(h.addr, { direction: 'top', offset: [0, -6] });
      layer.addLayer(m);
      markersRef.current.set(h.key, m);
    }
    if (visible.length && mapRef.current && !q) {
      mapRef.current.fitBounds(L.latLngBounds(visible.map((h) => [h.lat, h.lon] as [number, number])), { maxZoom: 15, padding: [30, 30] });
    }
  }, [visible, nav, q, show]);

  const focus = (h: House) => {
    const m = markersRef.current.get(h.key);
    if (!m || !mapRef.current) return;
    mapRef.current.flyTo([h.lat, h.lon], Math.max(mapRef.current.getZoom(), 17), { duration: 0.6 });
    setTimeout(() => m.openPopup(), 650);
  };

  const without = (data?.withoutCoords ?? []).filter((r) => r.category === 'mkd').reduce((s, r) => s + r.n, 0);

  return (
    <>
      <PageTitle title="Карта жилого фонда" sub="Многоквартирные дома г. Атырау: цвет точки — период постройки, красные и жёлтые метки — аварийные и ветхие дома, красное кольцо — есть неработающие лифты." />
      <Loading error={error} loading={loading}>
        {data && !houses.length && (
          <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Данные для карты пока не загружены"
            description="Загрузите файл карты жилого фонда (karta-zhilogo-fonda-atyrau.html) в разделе «Администрирование → Импорт Excel»: координаты будут добавлены к домам реестра МЖД, а список аварийных домов — в раздел «Аварийные дома»." />
        )}
        {houses.length > 0 && (
          <div style={{ display: 'flex', flexDirection: screens.lg ? 'row' : 'column-reverse', gap: 12, alignItems: 'stretch' }}>
            <Card size="small" style={{ width: screens.lg ? 360 : '100%', flex: 'none' }} styles={{ body: { display: 'flex', flexDirection: 'column', gap: 8, height: screens.lg ? 'calc(100vh - 190px)' : 'auto' } }}>
              <div className="map-stats">
                <div><b>{visible.length.toLocaleString('ru-RU')}</b><span>домов</span></div>
                <div><b>{totals.flats.toLocaleString('ru-RU')}</b><span>квартир</span></div>
                <div><b>{Math.round(totals.area / 1000).toLocaleString('ru-RU')}</b><span>тыс. м²</span></div>
              </div>
              <Select mode="multiple" allowClear placeholder="Период постройки: все" value={periods} onChange={(v: string[]) => setParam('p', v.length ? v.join(',') : null)}
                options={PERIODS.map((x) => ({ value: x.key, label: <Badge color={x.fill} text={`${x.label} (${counts.periods[x.key]})`} /> }))} />
              <Select value={av} onChange={(v) => setParam('av', v === 'all' ? null : v)}
                options={[
                  { value: 'all', label: 'Все дома' },
                  { value: 'any', label: `Аварийные и ветхие (${counts.red + counts.yellow})` },
                  { value: 'red', label: <Badge color={RED} text={`Только аварийные (${counts.red})`} /> },
                  { value: 'yellow', label: <Badge color={YELLOW} text={`Только ветхие (${counts.yellow})`} /> },
                ]} />
              <div style={{ display: 'flex', gap: 8 }}>
                <Select style={{ flex: 1, minWidth: 0 }} allowClear placeholder="Стены: все" value={wall || undefined} onChange={(v) => setParam('w', v ?? null)} options={options.walls.map((v) => ({ value: v, label: v }))} />
                <Select style={{ flex: 1, minWidth: 0 }} allowClear placeholder="Отопление: все" value={heat || undefined} onChange={(v) => setParam('ht', v ?? null)} options={options.heats.map((v) => ({ value: v, label: v }))} />
              </div>
              <Select value={lift} onChange={(v) => setParam('l', v === 'all' ? null : v)}
                options={[
                  { value: 'all', label: 'Лифт: все' },
                  { value: 'with', label: 'С лифтом' },
                  { value: 'without', label: 'Без лифта' },
                  { value: 'registry', label: 'В реестре лифтов' },
                  { value: 'bad', label: `Лифты не работают (${counts.liftsBad})` },
                ]} />
              <Input.Search allowClear placeholder="Поиск по адресу или управляющей организации…" value={q} onChange={(e) => setQ(e.target.value)} />
              <div style={{ overflow: 'auto', flex: 1, maxHeight: screens.lg ? undefined : 320 }}>
                {visible.length ? visible.map((h) => {
                  const fill = h.red ? RED : h.yellow ? YELLOW : PERIODS.find((x) => x.key === h.period)!.fill;
                  const e = h.em?.attrs;
                  return (
                    <div key={h.key} className="map-list-item" onClick={() => focus(h)} role="button" tabIndex={0} onKeyDown={(ev) => { if (ev.key === 'Enter') focus(h); }}>
                      <span className="dot" style={{ background: fill, boxShadow: h.liftsBad ? `0 0 0 2px ${RING}` : undefined }} />
                      <div style={{ minWidth: 0 }}>
                        <div className="t">{h.addr}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {[h.year && `${h.year} г.`, (h.mkd?.attrs?.floors ?? e?.floors) && `${h.mkd?.attrs?.floors ?? e?.floors} эт.`, h.mkd?.lifts && `лифтов: ${h.mkd.lifts.n}${h.mkd.lifts.bad ? ' (есть неработающие)' : ''}`, !h.mkd && 'нет в реестре МЖД'].filter(Boolean).join(' · ')}
                        </div>
                        {h.em && <div style={{ fontSize: 12, color: h.red ? RED : '#8a6500' }}>{h.red ? 'аварийный' : h.yellow ? 'ветхий' : 'в списке аварийных'}{e?.conclusion ? ` · ${e.conclusion}` : ''}</div>}
                      </div>
                    </div>
                  );
                }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Ничего не найдено" />}
              </div>
              <div className="muted" style={{ fontSize: 12 }}><EnvironmentOutlined /> Показано {visible.length} из {houses.length}.{without ? ` Домов реестра без координат: ${without} (на карте не показаны).` : ''}</div>
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
