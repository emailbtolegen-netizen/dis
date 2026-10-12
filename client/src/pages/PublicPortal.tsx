import { Card, Input, Result, Select, Table, Typography } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { qs } from '../lib/api';
import { useApi, useDebounced } from '../lib/hooks';

/** Публичная версия: только сведения, разрешённые администратором к публикации. */
export default function PublicPortal() {
  const { data: info, error } = useApi<any>('/public/info');
  const [code, setCode] = useState<string | undefined>();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [page, setPage] = useState(1);
  const category = info?.categories.find((c: any) => c.code === (code ?? info?.categories[0]?.code));
  const { data, loading } = useApi<any>(category ? `/public/objects${qs({ category: category.code, q: dq || undefined, page })}` : null);

  if (error) return <Result status="404" title="Публичная версия отключена" subTitle="Сведения доступны только сотрудникам после входа в систему." extra={<Link to="/">Вход для сотрудников</Link>} />;
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 16 }}>
      <Typography.Title level={3}>{info?.systemName}</Typography.Title>
      <div className="muted" style={{ marginBottom: 12 }}>Открытые сведения. <Link to="/">Вход для сотрудников</Link></div>
      {info && !info.categories.length && <Result status="info" title="Нет опубликованных разделов" />}
      {category && (
        <Card size="small">
          <div className="filters-bar">
            <Select style={{ width: 320 }} value={category.code} onChange={(v) => { setCode(v); setPage(1); }} options={info.categories.map((c: any) => ({ value: c.code, label: c.name }))} />
            <Input.Search allowClear placeholder="Поиск" style={{ width: 300 }} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <Table size="small" rowKey="uid" loading={loading} dataSource={data?.items ?? []} scroll={{ x: 'max-content' }}
            pagination={{ current: page, pageSize: 50, total: data?.total ?? 0, showSizeChanger: false, onChange: setPage }}
            columns={category.fields.map((f: any) => ({ title: f.label + (f.unit ? `, ${f.unit}` : ''), dataIndex: f.key, render: (v: any) => (v == null ? '—' : f.valueMap?.[v] ?? String(v)) }))} />
        </Card>
      )}
    </div>
  );
}
