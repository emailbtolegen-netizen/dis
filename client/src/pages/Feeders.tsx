import { Alert, Card, Input, Table, Tag } from 'antd';
import { useState } from 'react';
import { Loading, ObjectLink, PageTitle } from '../components/common';
import { fmtNum } from '../lib/format';
import { useApi } from '../lib/hooks';
import { useSession } from '../lib/session';

export default function Feeders() {
  const { data, error, loading } = useApi<any>('/feeders');
  const { cat } = useSession();
  const [q, setQ] = useState('');
  const items = (data?.items ?? []).filter((f: any) => !q || f.feeder.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageTitle title="Фидеры и линии электроснабжения" sub="Группировка объектов по номерам фидеров 6/10/35 кВ" />
      {data?.note && <Alert type="info" showIcon message={data.note} style={{ marginBottom: 12 }} />}
      <Loading error={error} loading={loading}>
        <Card size="small">
          <Input.Search allowClear placeholder="Номер фидера, например 207 или 196Ш" style={{ maxWidth: 320, marginBottom: 12 }} onChange={(e) => setQ(e.target.value)} />
          <Table size="small" rowKey="feeder" dataSource={items} scroll={{ x: 700 }} pagination={{ pageSize: 50 }}
            expandable={{
              expandedRowRender: (f: any) => (
                <Table size="small" rowKey="uid" pagination={false} dataSource={f.objects}
                  columns={[
                    { title: 'Объект', render: (_, o: any) => <ObjectLink uid={o.uid} name={o.name} /> },
                    { title: 'Тип', dataIndex: 'category', render: (c) => cat(c)?.short_name },
                    { title: 'Класс', dataIndex: 'voltage_class' },
                    { title: 'Км', dataIndex: 'length_km', align: 'right', render: (v) => fmtNum(v) },
                    { title: 'Место', dataIndex: 'address_raw' },
                  ]} />
              ),
            }}
            columns={[
              { title: 'Фидер', dataIndex: 'feeder', render: (v) => <b>Ф-{v}</b>, sorter: (a: any, b: any) => a.feeder.localeCompare(b.feeder, 'ru', { numeric: true }) },
              { title: 'Линий', dataIndex: 'lines', align: 'right', sorter: (a: any, b: any) => a.lines - b.lines },
              { title: 'Протяжённость, км', dataIndex: 'km', align: 'right', render: (v) => fmtNum(v), sorter: (a: any, b: any) => a.km - b.km },
              { title: 'ТП с этим фидером', dataIndex: 'tps', align: 'right' },
              { title: 'Места', dataIndex: 'areas', render: (a: string[]) => a.map((x) => <Tag key={x}>{x}</Tag>) },
            ]} />
        </Card>
      </Loading>
    </>
  );
}
