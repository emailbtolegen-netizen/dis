import { Alert, Card, Descriptions, Table, Tag } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { Loading, ObjectLink, PageTitle, StatusTag } from '../components/common';
import { fmtNum } from '../lib/format';
import { useApi } from '../lib/hooks';
import { useSession } from '../lib/session';

export default function AddressCard() {
  const { id } = useParams();
  const { data, error, loading } = useApi<any>(`/addresses/${id}`);
  const { cat } = useSession();
  const cols = [
    { title: 'Объект', render: (_: unknown, o: any) => <ObjectLink uid={o.uid} name={o.name} /> },
    { title: 'Раздел', dataIndex: 'category', render: (c: string) => cat(c)?.short_name ?? c },
    { title: 'Номер', dataIndex: 'code' },
    { title: 'Состояние', dataIndex: 'status', render: (s: string) => <StatusTag status={s} /> },
    { title: 'Год', dataIndex: 'year_built' },
    { title: 'Мощность, кВА', dataIndex: 'power_kva', align: 'right' as const, render: (v: number) => (v ? fmtNum(v) : '') },
    { title: 'Км', dataIndex: 'length_km', align: 'right' as const, render: (v: number) => (v ? fmtNum(v) : '') },
  ];
  if (!data) return <Loading error={error} loading={loading} />;
  const a = data.address;
  return (
    <>
      <PageTitle title={a.display} sub={a.kind === 'building' ? 'Здание' : 'Территория (улица, микрорайон, посёлок или ориентир)'} />
      <Card size="small">
        <Descriptions size="small" column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label="Тип">{a.kind === 'building' ? <Tag color="blue">здание</Tag> : <Tag>территория</Tag>}{a.is_settlement ? <Tag color="green">населённый пункт</Tag> : null}</Descriptions.Item>
          <Descriptions.Item label="Ключ сопоставления"><span className="mono">{a.norm_key}</span></Descriptions.Item>
          {data.area && <Descriptions.Item label="Улица / микрорайон"><Link to={`/addresses/${data.area.id}`}>{data.area.display}</Link></Descriptions.Item>}
          {data.variants.length > 1 && (
            <Descriptions.Item label="Варианты написания в источниках" span={2}>
              {data.variants.map((v: any, i: number) => <Tag key={i}>{v.v} <span className="muted">({cat(v.category)?.short_name})</span></Tag>)}
            </Descriptions.Item>
          )}
        </Descriptions>
        {data.variants.length > 1 && <Alert type="info" showIcon style={{ marginTop: 8 }} message="Записи из разных файлов связаны по нормализованному адресу. Проверьте совпадение, если написание существенно отличается." />}
      </Card>
      <Card size="small" title={`Объекты по этому адресу (${data.objects.length})`} style={{ marginTop: 12 }}>
        <Table size="small" rowKey="uid" dataSource={data.objects} columns={cols} pagination={data.objects.length > 50 ? { pageSize: 50 } : false} scroll={{ x: 700 }} />
      </Card>
      {a.kind === 'area' && data.buildings.length > 0 && (
        <Card size="small" title={`Объекты в зданиях этой улицы / микрорайона (${data.buildings.length})`} style={{ marginTop: 12 }}>
          <Table size="small" rowKey="uid" dataSource={data.buildings} pagination={{ pageSize: 50 }} scroll={{ x: 700 }}
            columns={[{ title: 'Адрес', dataIndex: 'address_display', render: (v: string, o: any) => <Link to={`/addresses/${o.address_id}`}>{v}</Link> }, ...cols]} />
        </Card>
      )}
    </>
  );
}
