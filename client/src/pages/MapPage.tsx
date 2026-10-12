import { Alert, Card, Checkbox, Table } from 'antd';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loading, PageTitle } from '../components/common';
import { useApi } from '../lib/hooks';
import { useSession } from '../lib/session';

/**
 * Карта показывает только объекты с координатами, внесёнными пользователями или импортом.
 * Координаты не придумываются и не определяются автоматически по адресу.
 * Подложка — OpenStreetMap (браузер запрашивает тайлы у tile.openstreetmap.org; данные объектов туда не передаются).
 */
export default function MapPage() {
  const { data, error, loading } = useApi<any>('/map');
  const { cat } = useSession();
  const nav = useNavigate();
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const categories = useMemo(() => [...new Set<string>((data?.points ?? []).map((p: any) => p.category))], [data]);
  const [enabled, setEnabled] = useState<string[] | null>(null);
  const active = enabled ?? categories;

  useEffect(() => {
    if (!el.current || !data?.points.length || mapRef.current) return;
    const map = L.map(el.current).setView([47.1, 51.9], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; участники OpenStreetMap' }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [data]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !data) return;
    layer.clearLayers();
    const pts = data.points.filter((p: any) => active.includes(p.category));
    for (const p of pts) {
      const m = L.circleMarker([p.lat, p.lon], { radius: 6, color: '#ffffff', weight: 2, fillColor: '#1f4e79', fillOpacity: 0.9 });
      const div = document.createElement('div');
      const title = document.createElement('b');
      title.textContent = p.name;
      const info = document.createElement('div');
      info.textContent = `${cat(p.category)?.short_name ?? ''}${p.address_raw ? ' · ' + p.address_raw : ''}${p.status ? ' · ' + p.status : ''}`;
      const link = document.createElement('a');
      link.textContent = 'Открыть карточку →';
      link.href = `/objects/${p.uid}`;
      link.onclick = (e) => { e.preventDefault(); nav(`/objects/${p.uid}`); };
      div.append(title, info, link);
      m.bindPopup(div);
      layer.addLayer(m);
    }
    if (pts.length && mapRef.current) mapRef.current.fitBounds(L.latLngBounds(pts.map((p: any) => [p.lat, p.lon])), { maxZoom: 15, padding: [24, 24] });
  }, [data, active, cat, nav]);

  const without = (data?.withoutCoords ?? []).reduce((s: number, r: any) => s + r.n, 0);
  return (
    <>
      <PageTitle title="Карта объектов" sub="Отображаются только объекты с достоверными координатами" />
      <Loading error={error} loading={loading}>
        {data && !data.points.length && (
          <Alert type="info" showIcon style={{ marginBottom: 12 }} message="В базе пока нет объектов с координатами"
            description={<>В загруженных Excel-файлах координаты отсутствуют, поэтому объекты на карте не размещаются (выдуманные координаты не используются). Координаты можно добавить в карточке объекта («Редактировать» → «Широта» / «Долгота») или импортировать из файла со столбцами широты и долготы. Объектов без координат: {without}.</>} />
        )}
        {data?.points.length > 0 && (
          <Card size="small" style={{ marginBottom: 12 }}>
            <Checkbox.Group value={active} onChange={(v) => setEnabled(v as string[])} options={categories.map((c) => ({ value: c, label: cat(c)?.short_name ?? c }))} />
            <div style={{ height: 'min(70vh, 640px)', marginTop: 8 }}><div ref={el} style={{ height: '100%' }} /></div>
          </Card>
        )}
        <Card size="small" title="Объекты без координат по разделам">
          <Table size="small" rowKey="category" pagination={false} dataSource={data?.withoutCoords ?? []}
            columns={[{ title: 'Раздел', dataIndex: 'category', render: (c) => cat(c)?.name ?? c }, { title: 'Без координат', dataIndex: 'n', align: 'right' }]} />
        </Card>
      </Loading>
    </>
  );
}
