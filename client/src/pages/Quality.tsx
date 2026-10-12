import { DownloadOutlined } from '@ant-design/icons';
import { App, Button, Card, Col, Collapse, Progress, Row, Select, Table, Tag } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { Kpi, Loading, ObjectLink, PageTitle, SeverityTag } from '../components/common';
import { download, qs } from '../lib/api';
import { fmtNum } from '../lib/format';
import { useApi } from '../lib/hooks';
import { useSession } from '../lib/session';

export default function Quality() {
  const [sp, setSp] = useSearchParams();
  const { meta, cat } = useSession();
  const { message } = App.useApp();
  const type = sp.get('type') ?? '';
  const category = sp.get('category') ?? '';
  const severity = sp.get('severity') ?? '';
  const page = Number(sp.get('page') ?? 1);
  const { data, error, loading } = useApi<any>(`/quality${qs({ type: type || undefined, category: category || undefined, severity: severity || undefined, page, pageSize: 50 })}`);
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v); else n.delete(k);
    if (k !== 'page') n.delete('page');
    setSp(n, { replace: true });
  };

  return (
    <>
      <PageTitle title="Качество данных" sub="Автоматические проверки: обязательные поля, дубликаты, форматы, подозрительные значения, расхождения с итогами исходных файлов. Исходные значения не изменяются."
        extra={<Button icon={<DownloadOutlined />} onClick={() => download('/quality/export').catch((e) => message.error(e.message))}>Выгрузить отчёт в Excel</Button>} />
      <Loading error={error} loading={loading && !data}>
        {data && (
          <>
            <Row gutter={[12, 12]}>
              <Col xs={12} md={6}><Kpi label="Объектов проверено" value={fmtNum(data.totals.objects)} /></Col>
              <Col xs={12} md={6}><Kpi label="Требуют актуализации" value={fmtNum(data.totals.needsReview)} hint="есть предупреждения" /></Col>
              <Col xs={12} md={6}><Kpi label="Неполные данные" value={fmtNum(data.totals.incomplete)} hint="не заполнены обязательные поля" /></Col>
              <Col xs={12} md={6}><Kpi label="Всего замечаний" value={fmtNum(data.summary.reduce((s: number, x: any) => s + x.count, 0))} /></Col>
            </Row>
            <Card size="small" title="Замечания по типам" style={{ marginTop: 12 }}>
              <Table size="small" rowKey="type" pagination={false} dataSource={data.summary} scroll={{ x: 500 }}
                onRow={(r: any) => ({ onClick: () => set('type', r.type === type ? null : r.type), style: { cursor: 'pointer', background: r.type === type ? '#e6f0fa' : undefined } })}
                columns={[
                  { title: 'Проверка', dataIndex: 'label' },
                  { title: 'Замечаний', dataIndex: 'count', align: 'right', render: (v) => (v ? <b>{v}</b> : <span className="muted">0</span>) },
                  { title: 'Объектов', dataIndex: 'objects', align: 'right' },
                ]} />
            </Card>

            <Collapse style={{ marginTop: 12 }} items={[{
              key: 'c', label: 'Полнота заполнения по разделам',
              children: (
                <Row gutter={[12, 12]}>
                  {data.completeness.map((c: any) => (
                    <Col key={c.category} xs={24} lg={12}>
                      <Card size="small" title={`${c.name}: ${c.complete} из ${c.total} записей с полными обязательными полями`}>
                        {c.fields.map((f: any) => (
                          <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                            <span style={{ flex: '0 0 45%' }}>{f.label}{f.required && <Tag style={{ marginLeft: 4 }} color="blue">обяз.</Tag>}</span>
                            <Progress percent={f.pct} size="small" strokeColor="#1f4e79" style={{ flex: 1, margin: 0 }} format={(p) => `${p}%`} />
                          </div>
                        ))}
                      </Card>
                    </Col>
                  ))}
                </Row>
              ),
            }]} />

            <Card size="small" title={`Список замечаний (${data.issues.total})`} style={{ marginTop: 12 }}>
              <div className="filters-bar">
                <Select allowClear placeholder="Тип проверки" style={{ width: 300 }} value={type || undefined} onChange={(v) => set('type', v ?? null)}
                  options={data.summary.filter((s: any) => s.count).map((s: any) => ({ value: s.type, label: `${s.label} (${s.count})` }))} />
                <Select allowClear placeholder="Раздел" style={{ width: 260 }} value={category || undefined} onChange={(v) => set('category', v ?? null)}
                  options={meta?.categories.filter((c) => c.count).map((c) => ({ value: c.code, label: c.short_name }))} />
                <Select allowClear placeholder="Важность" style={{ width: 180 }} value={severity || undefined} onChange={(v) => set('severity', v ?? null)}
                  options={[{ value: 'error', label: 'Ошибка' }, { value: 'warning', label: 'Предупреждение' }, { value: 'info', label: 'Информация' }]} />
              </div>
              <Table size="small" rowKey={(r: any, i) => `${r.type}-${r.object_id ?? ''}-${i}`} dataSource={data.issues.items} loading={loading} scroll={{ x: 800 }}
                pagination={{ current: page, pageSize: 50, total: data.issues.total, showSizeChanger: false, onChange: (p) => set('page', String(p)) }}
                columns={[
                  { title: 'Важность', dataIndex: 'severity', width: 140, render: (s) => <SeverityTag level={s} /> },
                  { title: 'Объект', width: 260, render: (_, r: any) => (r.uid ? <span><ObjectLink uid={r.uid} name={r.name} /><div className="mono muted">{r.uid}</div></span> : <span className="muted">{r.category ? cat(r.category)?.short_name : 'Файл / раздел целиком'}</span>) },
                  { title: 'Описание', dataIndex: 'message' },
                ]} />
            </Card>
          </>
        )}
      </Loading>
    </>
  );
}
