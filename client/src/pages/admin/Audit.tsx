import { DownloadOutlined } from '@ant-design/icons';
import { App, Button, Card, DatePicker, Input, Select, Table } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { PageTitle } from '../../components/common';
import { download, qs } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useApi } from '../../lib/hooks';

export default function Audit() {
  const [sp, setSp] = useSearchParams();
  const { message } = App.useApp();
  const params = { action: sp.get('action') || undefined, user: sp.get('user') || undefined, from: sp.get('from') || undefined, to: sp.get('to') || undefined };
  const page = Number(sp.get('page') ?? 1);
  const { data, loading } = useApi<any>(`/admin/audit${qs({ ...params, page, pageSize: 50 })}`);
  const set = (k: string, v: string | null | undefined) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v); else n.delete(k);
    if (k !== 'page') n.delete('page');
    setSp(n, { replace: true });
  };
  return (
    <>
      <PageTitle title="Журнал действий пользователей" sub="Вход и выход, импорт и откат, экспорт, изменения объектов, пользователей, ролей, настроек, резервные копии. Время — по Атырау."
        extra={<Button icon={<DownloadOutlined />} onClick={() => download(`/admin/audit/export${qs(params)}`).catch((e) => message.error(e.message))}>Экспорт в Excel</Button>} />
      <Card size="small">
        <div className="filters-bar">
          <Select allowClear placeholder="Действие" style={{ width: 280 }} value={params.action} onChange={(v) => set('action', v)}
            options={Object.entries(data?.actions ?? {}).map(([k, l]) => ({ value: k, label: l as string }))} />
          <Input.Search allowClear placeholder="Логин" style={{ width: 180 }} defaultValue={params.user} onSearch={(v) => set('user', v)} />
          <DatePicker.RangePicker onChange={(d) => { set('from', d?.[0]?.format('YYYY-MM-DD')); set('to', d?.[1]?.format('YYYY-MM-DD')); }} />
        </div>
        <Table size="small" rowKey="id" loading={loading} dataSource={data?.items ?? []} scroll={{ x: 1000 }}
          pagination={{ current: page, pageSize: 50, total: data?.total ?? 0, showSizeChanger: false, onChange: (p) => set('page', String(p)) }}
          columns={[
            { title: 'Время', dataIndex: 'at', width: 160, render: fmtDateTime },
            { title: 'Пользователь', width: 200, render: (_, r: any) => <div>{r.full_name ?? '—'}<div className="muted mono">{r.user_login ?? ''}</div></div> },
            { title: 'Действие', dataIndex: 'action_label', width: 240 },
            { title: 'Объект', width: 160, render: (_, r: any) => <span className="mono">{r.entity ? `${r.entity} ${r.entity_id ?? ''}` : ''}</span> },
            { title: 'Подробности', dataIndex: 'details', render: (d) => (d ? <span className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{JSON.stringify(d).slice(0, 400)}</span> : '') },
            { title: 'IP', dataIndex: 'ip', width: 120 },
          ]} />
      </Card>
    </>
  );
}
