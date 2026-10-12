import { PlusOutlined } from '@ant-design/icons';
import { Button, Card, Table, Tag } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { Loading, PageTitle } from '../../components/common';
import { fmtDateTime } from '../../lib/format';
import { useApi } from '../../lib/hooks';

const STATUS: Record<string, { color: string; label: string }> = {
  preview: { color: 'gold', label: 'Ожидает подтверждения' },
  applied: { color: 'green', label: 'Применён' },
  rolled_back: { color: 'default', label: 'Откатан' },
  discarded: { color: 'default', label: 'Отменён' },
};

export default function ImportList() {
  const { data, error, loading } = useApi<any[]>('/admin/imports');
  const nav = useNavigate();
  return (
    <>
      <PageTitle title="История импорта" sub="Каждый импорт хранит отчёт, исходный файл, решения по строкам и состояние записей до применения (для отката)."
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/admin/import')}>Новый импорт</Button>} />
      <Loading error={error} loading={loading}>
        <Card size="small">
          <Table size="small" rowKey="id" dataSource={data ?? []} scroll={{ x: 1000 }} pagination={{ pageSize: 50 }}
            columns={[
              { title: '№', dataIndex: 'id', width: 60, render: (v) => <Link to={`/admin/imports/${v}`}>{v}</Link> },
              { title: 'Файл / лист', render: (_, r: any) => <div><Link to={`/admin/imports/${r.id}`}>{r.file_name}</Link><div className="muted">«{r.sheet_name}» · {r.summary.profileName}</div></div> },
              { title: 'Статус', dataIndex: 'status', width: 190, render: (s) => <Tag color={STATUS[s]?.color}>{STATUS[s]?.label}</Tag> },
              { title: 'Новых / изм. / без изм. / ошибок / нет в файле', width: 300, render: (_, r: any) => `${r.summary.new ?? 0} / ${r.summary.changed ?? 0} / ${r.summary.unchanged ?? 0} / ${r.summary.invalid ?? 0} / ${r.summary.missing ?? 0}` },
              { title: 'Создан', width: 200, render: (_, r: any) => <div>{fmtDateTime(r.created_at)}<div className="muted">{r.created_by_name ?? 'системный скрипт'}</div></div> },
              { title: 'Применён', width: 200, render: (_, r: any) => (r.applied_at ? <div>{fmtDateTime(r.applied_at)}<div className="muted">{r.applied_by_name ?? 'системный скрипт'}</div></div> : '—') },
            ]} />
        </Card>
      </Loading>
    </>
  );
}
