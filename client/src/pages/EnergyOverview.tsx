import { Card, Col, Row, Table, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import BarChartBox from '../components/BarChartBox';
import { Kpi, Loading, PageTitle } from '../components/common';
import { fmtNum } from '../lib/format';
import { useApi } from '../lib/hooks';
import { useSession } from '../lib/session';

const CAP_LABEL: Record<string, string> = { el_ps: 'ПС 35–110 кВ', el_rp: 'РП 6/10 кВ', el_tp: 'ТП/КТП' };

export default function EnergyOverview() {
  const { data: d, error, loading } = useApi<any>('/dashboard');
  const { cat } = useSession();
  const nav = useNavigate();
  const go = (code: string, f?: Record<string, unknown>) => nav(`/c/${code}${f ? `?f=${encodeURIComponent(JSON.stringify(f))}` : ''}`);
  const e = d?.energy;
  return (
    <>
      <PageTitle title="Электрические сети и электрохозяйство" sub="Источник: «Перечень энергообъектов за 2026 год, находящихся на балансе ГУ «ГО ЖКХ и ЖИ»». Показатели — по импортированным строкам." />
      <Loading error={error} loading={loading}>
        {e && (
          <>
            <Row gutter={[12, 12]}>
              {['el_ps', 'el_rp', 'el_tp', 'el_vl', 'el_kl'].map((c) => (
                <Col key={c} xs={12} md={8} xl={4}>
                  <Kpi label={cat(c)?.short_name} value={fmtNum(cat(c)?.count ?? 0)} hint={cat(c)?.name} onClick={() => go(c)} />
                </Col>
              ))}
              <Col xs={12} md={8} xl={4}><Kpi label="Фидеры" value="→" hint="по номерам в наименованиях" onClick={() => nav('/energy/feeders')} /></Col>
            </Row>
            <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
              <Col xs={24} xl={14}>
                <Card size="small" title="Линии по классам напряжения">
                  <Table size="small" rowKey={(r: any) => r.category + r.vc} pagination={false} dataSource={e.lines} scroll={{ x: 500 }}
                    onRow={(r: any) => ({ onClick: () => go(r.category, { voltage_class: [r.vc] }), style: { cursor: 'pointer' } })}
                    columns={[
                      { title: 'Тип', dataIndex: 'type', render: (t) => <Tag>{t}</Tag> },
                      { title: 'Класс напряжения', dataIndex: 'vc' },
                      { title: 'Записей', dataIndex: 'n', align: 'right' },
                      { title: 'Протяжённость, км', dataIndex: 'km', align: 'right', render: (v) => <span className="num">{fmtNum(v)}</span> },
                      { title: 'Без протяжённости', dataIndex: 'no_len', align: 'right', render: (v) => (v ? <Tag color="orange">{v}</Tag> : 0) },
                    ]}
                    summary={() => (
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0} colSpan={2}><b>Итого</b></Table.Summary.Cell>
                        <Table.Summary.Cell index={2} align="right"><b>{e.lineCount}</b></Table.Summary.Cell>
                        <Table.Summary.Cell index={3} align="right"><b className="num">{fmtNum(e.totalKm)}</b></Table.Summary.Cell>
                        <Table.Summary.Cell index={4} />
                      </Table.Summary.Row>
                    )} />
                </Card>
              </Col>
              <Col xs={24} xl={10}>
                <Card size="small" title="Установленная мощность трансформаторов (по распознанным записям)">
                  <Table size="small" rowKey="category" pagination={false} dataSource={e.capacity}
                    columns={[
                      { title: 'Объекты', dataIndex: 'category', render: (c) => CAP_LABEL[c] ?? c },
                      { title: 'Мощность, кВА', dataIndex: 'kva', align: 'right', render: (v) => <span className="num">{fmtNum(v, 0)}</span> },
                      { title: 'Учтено', align: 'right', render: (_, r: any) => `${r.with_power} из ${r.n}` },
                    ]} />
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Суммарная мощность = количество × мощность одного трансформатора из столбца «Мощность Тр-р». Записи без мощности или с неоднозначной записью не учитываются.</div>
                </Card>
                <Card size="small" title="РП по состоянию" style={{ marginTop: 12 }}>
                  <BarChartBox horizontal data={e.rpStatus} x="s" y="n" valueLabel="РП" onClick={(r) => go('el_rp', { status: [r.s] })} />
                </Card>
              </Col>
              <Col xs={24} xl={12}>
                <Card size="small" title="ТП/КТП по типу оборудования">
                  <BarChartBox horizontal data={e.tpTypes} x="t" y="n" valueLabel="Количество" onClick={(r) => go('el_tp', { equipment_type: [r.t] })} />
                </Card>
              </Col>
              <Col xs={24} xl={12}>
                <Card size="small" title="ТП/КТП по мощности трансформатора">
                  <BarChartBox data={e.tpPower.map((p: any) => ({ ...p, label: `${p.kva}` }))} x="label" y="n" valueLabel="Количество" onClick={(r) => go('el_tp', { transformer_kva: [String(r.kva)] })} />
                  <div className="muted" style={{ fontSize: 12 }}>По оси — мощность одного трансформатора, кВА.</div>
                </Card>
              </Col>
            </Row>
          </>
        )}
      </Loading>
    </>
  );
}
