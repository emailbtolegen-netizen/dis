import { CheckCircleOutlined, CloseCircleOutlined, RollbackOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Checkbox, Col, Descriptions, List, Row, Space, Table, Tabs, Tag } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Kpi, Loading, ObjectLink, PageTitle, SeverityTag } from '../../components/common';
import { api, qs } from '../../lib/api';
import { fmtDateTime, fmtNum } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';

const STATUS: Record<string, { color: string; label: string }> = {
  preview: { color: 'gold', label: 'Ожидает подтверждения' },
  applied: { color: 'green', label: 'Применён' },
  rolled_back: { color: 'default', label: 'Откатан' },
  discarded: { color: 'default', label: 'Отменён' },
};
const ACTIONS: Record<string, string> = { new: 'Новые', changed: 'Изменённые', unchanged: 'Без изменений', invalid: 'Не прошли проверку', missing: 'Отсутствуют в файле' };

function show(v: unknown) {
  if (v == null || v === '') return '—';
  return typeof v === 'number' ? v.toLocaleString('ru-RU') : String(v);
}

function Rows({ importId, action, editable, onChanged }: { importId: number; action: string; editable: boolean; onChanged: () => void }) {
  const { cat } = useSession();
  const { message } = App.useApp();
  const [page, setPage] = useState(1);
  const [flt, setFlt] = useState<{ dup?: boolean; warn?: boolean; manual?: boolean }>({});
  const { data, loading, reload } = useApi<any>(`/admin/imports/${importId}/rows${qs({ action, page, pageSize: 50, dup: flt.dup ? 1 : undefined, warn: flt.warn ? 1 : undefined, manual: flt.manual ? 1 : undefined })}`);
  const decide = async (body: any) => {
    try {
      const r = await api.post(`/admin/imports/${importId}/decisions`, body);
      message.success(`Изменено решений: ${r.changed}`);
      reload();
      onChanged();
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  return (
    <>
      <Space wrap style={{ marginBottom: 8 }}>
        <Checkbox checked={flt.warn} onChange={(e) => { setFlt({ ...flt, warn: e.target.checked }); setPage(1); }}>с предупреждениями</Checkbox>
        <Checkbox checked={flt.dup} onChange={(e) => { setFlt({ ...flt, dup: e.target.checked }); setPage(1); }}>возможные дубликаты</Checkbox>
        {action === 'changed' && <Checkbox checked={flt.manual} onChange={(e) => { setFlt({ ...flt, manual: e.target.checked }); setPage(1); }}>изменены вручную после импорта</Checkbox>}
        {editable && ['new', 'changed'].includes(action) && (
          <>
            <Button size="small" onClick={() => decide({ decision: 'apply', action })}>Применять все</Button>
            <Button size="small" onClick={() => decide({ decision: 'skip', action })}>Пропустить все</Button>
            {action === 'new' && <Button size="small" onClick={() => decide({ decision: 'skip', action, dupOnly: true })}>Пропустить возможные дубликаты</Button>}
          </>
        )}
      </Space>
      <Table size="small" rowKey="id" loading={loading} dataSource={data?.items ?? []} scroll={{ x: 900 }}
        pagination={{ current: page, pageSize: 50, total: data?.total ?? 0, showSizeChanger: false, onChange: setPage }}
        columns={[
          { title: 'Строка', dataIndex: 'row_no', width: 70, render: (v) => v ?? '—' },
          ...(editable && ['new', 'changed', 'unchanged'].includes(action) ? [{
            title: 'Применить', dataIndex: 'decision', width: 100,
            render: (d: string, r: any) => <Checkbox checked={d === 'apply'} onChange={(e) => decide({ decision: e.target.checked ? 'apply' : 'skip', rowIds: [r.id] })} />,
          }] : [{ title: 'Решение', dataIndex: 'decision', width: 100, render: (d: string, r: any) => (r.applied ? <Tag color="green">применено</Tag> : d === 'skip' ? <Tag>пропуск</Tag> : <Tag color="blue">применить</Tag>) }]),
          { title: 'Раздел', dataIndex: 'category', width: 110, render: (c) => cat(c)?.short_name ?? c ?? '—' },
          {
            title: 'Запись', render: (_, r: any) => (
              <div>
                {r.uid ? <ObjectLink uid={r.uid} name={r.object_name} /> : <b>{r.data?.core?.name ?? '—'}</b>}
                {r.data?.core?.address_raw && <div className="muted" style={{ fontSize: 12 }}>{r.data.core.address_raw}</div>}
                {r.diff?.length > 0 && (
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12 }}>
                    {r.diff.map((d: any, i: number) => <li key={i}>{d.label}: <span className="diff-old">{show(d.old)}</span> → <span className="diff-new">{show(d.new)}</span></li>)}
                  </ul>
                )}
              </div>
            ),
          },
          {
            title: 'Замечания', width: 380, render: (_, r: any) => (
              <div style={{ fontSize: 12 }}>
                {r.manual_edit ? <Tag color="red">изменена вручную</Tag> : null}
                {r.messages.map((m: any, i: number) => <div key={i}><SeverityTag level={m.level} />{m.text}</div>)}
              </div>
            ),
          },
        ]} />
    </>
  );
}

export default function ImportDetail() {
  const { id } = useParams();
  const importId = Number(id);
  const { data: imp, error, loading, reload } = useApi<any>(`/admin/imports/${importId}`);
  const { message, modal } = App.useApp();
  const { reloadMeta, cat } = useSession();
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('new');

  if (!imp) return <Loading error={error} loading={loading} />;
  const s = imp.summary;
  const editable = imp.status === 'preview';

  const act = (path: string, title: string, content: string, danger = false) => modal.confirm({
    title, content, okText: 'Подтвердить', cancelText: 'Отмена', okButtonProps: { danger },
    onOk: async () => {
      setBusy(true);
      try {
        const r = await api.post(`/admin/imports/${importId}/${path}`);
        if (path === 'apply') message.success(`Импорт применён: создано ${r.created}, обновлено ${r.updated}, подтверждено ${r.refreshed}, пропущено ${r.skipped}. Резервная копия: ${r.backupName}`, 8);
        if (path === 'rollback') message.success(`Откат выполнен: удалено ${r.deleted}, восстановлено ${r.restored}${r.conflicts.length ? `, не затронуто (изменены позже): ${r.conflicts.length}` : ''}`, 8);
        if (path === 'discard') message.success('Импорт отменён');
        reload();
        reloadMeta();
      } catch (e) {
        message.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
  });

  return (
    <>
      <PageTitle
        title={`Импорт №${imp.id}: ${imp.file_name}`}
        sub={<Space wrap><span>Лист «{imp.sheet_name}» · {s.profileName}</span><Tag color={STATUS[imp.status]?.color}>{STATUS[imp.status]?.label}</Tag></Space>}
        extra={
          <>
            {editable && <Button type="primary" icon={<CheckCircleOutlined />} loading={busy} onClick={() => act('apply', 'Применить импорт?', `Будут созданы и обновлены записи с отметкой «Применить». Перед применением автоматически создаётся резервная копия базы. Объекты, отсутствующие в файле, не удаляются.`)}>Применить импорт</Button>}
            {editable && <Button icon={<CloseCircleOutlined />} onClick={() => act('discard', 'Отменить импорт?', 'Отчёт будет удалён, база не изменится.')}>Отменить</Button>}
            {imp.status === 'applied' && <Button danger icon={<RollbackOutlined />} loading={busy} onClick={() => act('rollback', 'Откатить импорт?', 'Созданные этим импортом записи будут удалены (с возможностью восстановления), изменённые — возвращены к прежним значениям. Записи, изменённые после импорта, не затрагиваются. Перед откатом создаётся резервная копия.', true)}>Откатить импорт</Button>}
          </>
        }
      />
      {imp.status === 'rolled_back' && imp.rollback_report && (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`Откат ${fmtDateTime(imp.rolled_back_at)}: удалено ${imp.rollback_report.deleted}, восстановлено ${imp.rollback_report.restored}`}
          description={imp.rollback_report.conflicts?.length ? `Не затронуто: ${imp.rollback_report.conflicts.join('; ')}` : undefined} />
      )}
      <Row gutter={[12, 12]}>
        {Object.entries(ACTIONS).map(([k, label]) => (
          <Col key={k} xs={12} md={8} xl={4}><Kpi label={label} value={fmtNum(s[k] ?? 0)} onClick={() => setTab(k)} /></Col>
        ))}
        <Col xs={12} md={8} xl={4}><Kpi label="Возможные дубликаты" value={fmtNum(s.duplicates ?? 0)} hint={`с предупреждениями: ${s.warnings ?? 0}`} /></Col>
      </Row>
      <Descriptions size="small" style={{ marginTop: 12 }} column={{ xs: 1, md: 3 }}>
        <Descriptions.Item label="Создан">{fmtDateTime(imp.created_at)}</Descriptions.Item>
        <Descriptions.Item label="Применён">{fmtDateTime(imp.applied_at)}</Descriptions.Item>
        <Descriptions.Item label="Резервная копия перед применением">{imp.backup_name ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="По разделам">{Object.entries(s.byCategory ?? {}).map(([c, n]) => `${cat(c)?.short_name ?? c}: ${n}`).join(', ')}</Descriptions.Item>
        <Descriptions.Item label="Изменены вручную после импорта">{s.manualConflicts ?? 0} {s.manualConflicts ? '(по умолчанию не применяются)' : ''}</Descriptions.Item>
      </Descriptions>
      {(imp.file_issues.length > 0 || imp.control_totals.length > 0) && (
        <Row gutter={[12, 12]} style={{ marginTop: 4 }}>
          {imp.file_issues.length > 0 && (
            <Col xs={24} xl={12}>
              <Card size="small" title="Замечания к структуре файла">
                <List size="small" dataSource={imp.file_issues} renderItem={(m: any) => <List.Item><Space align="start"><SeverityTag level={m.level} /><span>{m.text}</span></Space></List.Item>} />
              </Card>
            </Col>
          )}
          {imp.control_totals.length > 0 && (
            <Col xs={24} xl={12}>
              <Card size="small" title="Сверка с итогами в файле">
                <Table size="small" rowKey="label" pagination={false} dataSource={imp.control_totals} scroll={{ x: 500 }}
                  columns={[
                    { title: 'Итог', dataIndex: 'label' },
                    { title: 'В файле', dataIndex: 'stated', align: 'right', render: (v, r: any) => `${fmtNum(v)} ${r.unit}` },
                    { title: 'По строкам', dataIndex: 'computed', align: 'right', render: (v, r: any) => `${fmtNum(v)} ${r.unit}` },
                    { title: '', dataIndex: 'match', render: (m, r: any) => (m ? <Tag color="green">совпадает</Tag> : <div><Tag color="orange">расхождение</Tag>{r.note && <div className="muted" style={{ fontSize: 12 }}>{r.note}</div>}</div>) },
                  ]} />
              </Card>
            </Col>
          )}
        </Row>
      )}
      <Card size="small" style={{ marginTop: 12 }}>
        <Tabs activeKey={tab} onChange={setTab} destroyInactiveTabPane
          items={Object.entries(ACTIONS).map(([k, label]) => ({ key: k, label: `${label} (${s[k] ?? 0})`, children: <Rows importId={importId} action={k} editable={editable} onChanged={reload} /> }))} />
      </Card>
      <div className="muted" style={{ marginTop: 8 }}><Link to="/admin/imports">← История импорта</Link></div>
    </>
  );
}
