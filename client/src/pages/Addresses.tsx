import { Card, Input, Radio, Switch, Table, Tag } from 'antd';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageTitle } from '../components/common';
import { qs } from '../lib/api';
import { useApi, useDebounced } from '../lib/hooks';

export default function Addresses() {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const dq = useDebounced(q, 300);
  const kind = sp.get('kind') ?? '';
  const settlement = sp.get('settlement') === '1';
  const page = Number(sp.get('page') ?? 1);
  const { data, loading } = useApi<any>(`/addresses${qs({ q: dq || undefined, kind: kind || undefined, settlement: settlement ? 1 : undefined, page, pageSize: 50 })}`);
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v); else n.delete(k);
    if (k !== 'page') n.delete('page');
    setSp(n, { replace: true });
  };
  return (
    <>
      <PageTitle title="Адресный справочник" sub="Здания (улица/микрорайон + номер дома) и территории (микрорайоны, посёлки, ориентиры) из всех загруженных файлов. Варианты написания одного адреса объединяются по нормализованному ключу." />
      <Card size="small">
        <div className="filters-bar">
          <Input.Search allowClear placeholder="Улица, номер дома, микрорайон, посёлок…" value={q} onChange={(e) => { setQ(e.target.value); set('page', null); }} style={{ width: 360, maxWidth: '100%' }} />
          <Radio.Group value={kind} onChange={(e) => set('kind', e.target.value || null)} optionType="button"
            options={[{ value: '', label: 'Все' }, { value: 'building', label: 'Здания' }, { value: 'area', label: 'Территории' }]} />
          <span><Switch size="small" checked={settlement} onChange={(v) => set('settlement', v ? '1' : null)} /> только населённые пункты (п., с., село)</span>
        </div>
        <Table size="small" rowKey="id" loading={loading} dataSource={data?.items ?? []} scroll={{ x: 600 }}
          pagination={{ current: page, pageSize: 50, total: data?.total ?? 0, showSizeChanger: false, showTotal: (t) => `Всего: ${t}`, onChange: (p) => set('page', String(p)) }}
          columns={[
            { title: 'Адрес / территория', dataIndex: 'display', render: (v, r: any) => <Link to={`/addresses/${r.id}`}>{v}</Link> },
            { title: 'Тип', dataIndex: 'kind', width: 130, render: (k, r: any) => <>{k === 'building' ? <Tag color="blue">здание</Tag> : <Tag>территория</Tag>}{r.is_settlement ? <Tag color="green">нас. пункт</Tag> : null}</> },
            { title: 'Объектов', dataIndex: 'objects', width: 110, align: 'right' },
            { title: 'В зданиях территории', dataIndex: 'objects_in_buildings', width: 170, align: 'right', render: (v) => v || '' },
            { title: 'Ключ сопоставления', dataIndex: 'norm_key', width: 220, render: (v) => <span className="mono muted">{v}</span> },
          ]} />
      </Card>
    </>
  );
}
