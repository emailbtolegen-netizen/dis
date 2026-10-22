import { CheckCircleTwoTone, ExclamationCircleTwoTone, InfoCircleOutlined } from '@ant-design/icons';
import { Card, Col, Row, Table, Tag, Tooltip } from 'antd';
import { useNavigate } from 'react-router-dom';
import BarChartBox from '../components/BarChartBox';
import { Kpi, Loading, PageTitle } from '../components/common';
import { fmtDateTime, fmtMoney, fmtNum } from '../lib/format';
import { useApi } from '../lib/hooks';
import { t } from '../lib/i18n';
import { useSession } from '../lib/session';

export default function Dashboard() {
  const { data: d, error, loading } = useApi<any>('/dashboard');
  const nav = useNavigate();
  const { can } = useSession();
  const f = (code: string, filters: Record<string, unknown>) => nav(`/c/${code}?f=${encodeURIComponent(JSON.stringify(filters))}`);

  return (
    <>
      <PageTitle title={t('appFullName')} sub={`${t('appSubtitle')}. Все показатели рассчитаны по фактическим записям базы.`} />
      <Loading error={error} loading={loading}>
        {d && (
          <>
            <Row gutter={[12, 12]}>
              <Col xs={12} md={8} xl={4}><Kpi label="Объектов в базе" value={fmtNum(d.totals.objects)} hint={`${d.categories.filter((c: any) => c.count).length} категорий`} onClick={() => nav('/registry')} /></Col>
              <Col xs={12} md={8} xl={4}><Kpi label="Электротехнических объектов" value={fmtNum(d.energy?.objects ?? 0)} hint="ПС, РП, ТП/КТП, ВЛ, КЛ" onClick={() => nav('/energy')} /></Col>
              <Col xs={12} md={8} xl={4}><Kpi label="Линий электропередачи (ВЛ+КЛ)" value={fmtNum(d.energy?.lineCount ?? 0)} hint={`${fmtNum(d.energy?.totalKm ?? 0)} км по записям`} onClick={() => nav('/energy')} /></Col>
              <Col xs={12} md={8} xl={4}><Kpi label="С неполными данными" value={fmtNum(d.totals.incomplete)} hint="не заполнены обязательные поля" onClick={can('quality.view') ? () => nav('/quality?type=missing_required') : undefined} /></Col>
              <Col xs={12} md={8} xl={4}><Kpi label="Требуют актуализации" value={fmtNum(d.totals.needsReview)} hint="есть замечания к данным" onClick={can('quality.view') ? () => nav('/quality') : undefined} /></Col>
              <Col xs={12} md={8} xl={4}>
                {d.totals.emergency.available
                  ? <Kpi label="Аварийных домов" value={fmtNum(d.totals.emergency.count)} hint={d.totals.emergency.dilapidated ? `и ${d.totals.emergency.dilapidated} ветхих · на карте →` : 'на карте →'} onClick={() => nav('/map/emergency')} />
                  : <Kpi label="Аварийных объектов" value={<span className="muted" style={{ fontSize: 18 }}>нет данных</span>} hint={d.totals.emergency.note} />}
              </Col>
            </Row>

            <Card size="small" style={{ marginTop: 12 }} title="Разделы базы" extra={<span className="muted">Последнее обновление: {fmtDateTime(d.lastUpdate)}{d.lastImport ? ` · импорт «${d.lastImport.file_name}»` : ''}</span>}>
              <Row gutter={[8, 8]}>
                {d.categories.map((c: any) => (
                  <Col key={c.code} xs={12} sm={8} lg={6} xxl={4}>
                    <Kpi label={c.short_name} value={fmtNum(c.count)} hint={c.count ? c.name : 'нет данных — раздел готов к наполнению'} onClick={() => nav(`/c/${c.code}`)} />
                  </Col>
                ))}
              </Row>
            </Card>

            <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
              {d.energy && (
                <Col xs={24} xl={12}>
                  <Card size="small" title="Протяжённость линий по классам напряжения, км">
                    <BarChartBox horizontal data={d.energy.lines.map((l: any) => ({ ...l, label: `${l.type} ${l.vc ?? ''}` }))} x="label" y="km" valueLabel="Протяжённость" unit="км"
                      onClick={(r) => f(r.category, { voltage_class: [r.vc] })} />
                    <div className="muted" style={{ fontSize: 12 }}>Сумма по строкам перечня. Записей без протяжённости: {d.energy.lines.reduce((s: number, l: any) => s + l.no_len, 0)}.</div>
                  </Card>
                </Col>
              )}
              {d.energy && (
                <Col xs={24} xl={12}>
                  <Card size="small" title="ТП/КТП по мощности трансформатора, шт.">
                    <BarChartBox data={d.energy.tpPower.map((p: any) => ({ ...p, label: `${p.kva} кВА` }))} x="label" y="n" valueLabel="Количество ТП" unit="шт."
                      onClick={(r) => f('el_tp', { transformer_kva: [String(r.kva)] })} />
                  </Card>
                </Col>
              )}
              {d.housing && (
                <>
                  <Col xs={24} xl={12}>
                    <Card size="small" title="МЖД по десятилетию постройки, домов">
                      <BarChartBox data={d.housing.byDecade.map((r: any) => ({ ...r, label: `${r.k}-е` }))} x="label" y="n" valueLabel="Домов"
                        onClick={(r) => f('mkd', { year_built: { min: r.k, max: r.k + 9 } })} />
                    </Card>
                  </Col>
                  <Col xs={24} md={12} xl={6}>
                    <Card size="small" title="МЖД по материалу стен">
                      <BarChartBox horizontal data={d.housing.byWall} x="k" y="n" valueLabel="Домов" onClick={(r) => f('mkd', { wall_material: [r.k] })} />
                    </Card>
                  </Col>
                  <Col xs={24} md={12} xl={6}>
                    <Card size="small" title="МЖД по типу отопления">
                      <BarChartBox horizontal data={d.housing.byHeating} x="k" y="n" valueLabel="Домов" onClick={(r) => f('mkd', { heating: [r.k] })} />
                    </Card>
                  </Col>
                  <Col xs={24} xl={12}>
                    <Card size="small" title="Жилищный фонд — сводка">
                      <Row gutter={[8, 8]}>
                        <Col span={12}><Kpi label="Домов" value={fmtNum(d.housing.count)} /></Col>
                        <Col span={12}><Kpi label="Площадь, м²" value={fmtNum(d.housing.area, 0)} hint={`указана у ${d.housing.areaCoverage} из ${d.housing.count}`} /></Col>
                        <Col span={12}><Kpi label="Квартир" value={fmtNum(d.housing.apartments)} hint={`указано у ${d.housing.apartmentsCoverage} из ${d.housing.count}`} /></Col>
                        <Col span={12}><Kpi label="Лифтов (числом)" value={fmtNum(d.housing.elevators?.lifts ?? 0)} hint={`в ${d.housing.elevators?.houses ?? 0} домах, где указано количество`} /></Col>
                      </Row>
                    </Card>
                  </Col>
                </>
              )}
              {d.lifts && (
                <Col xs={24} xl={12}>
                  <Card size="small" title="Лифты МЖД" extra={<a onClick={() => nav('/c/mkd_lifts')}>Реестр лифтов →</a>}>
                    <Row gutter={[8, 8]}>
                      <Col span={12}><Kpi label="Лифтов по файлу" value={fmtNum(d.lifts.total)} hint={`${d.lifts.records} строк; есть повторы одного дома`} onClick={() => nav('/c/mkd_lifts')} /></Col>
                      <Col span={12}><Kpi label="Не работают" value={fmtNum(d.lifts.broken ?? 0)} hint={`в ${d.lifts.withBroken} записях`} onClick={() => f('mkd_lifts', { lifts_broken: { min: 1 } })} /></Col>
                      <Col span={12}><Kpi label="Привязано к МЖД" value={`${d.lifts.linked} из ${d.lifts.records}`} hint={`${d.lifts.houses} домов`} /></Col>
                      <Col span={12}><Kpi label="Требуют внимания" value={fmtNum(d.lifts.attention.reduce((s: number, a: any) => s + a.n, 0))} hint="кап. ремонт, модернизация, срок эксплуатации" onClick={() => f('mkd_lifts', { attention: { empty: false } })} /></Col>
                    </Row>
                    <div style={{ marginTop: 8 }}>
                      <BarChartBox horizontal data={d.lifts.byStatus} x="s" y="n" valueLabel="Записей" onClick={(r) => f('mkd_lifts', { status: [r.s] })} />
                    </div>
                  </Card>
                </Col>
              )}
              {d.repair && (
                <Col xs={24} xl={12}>
                  <Card size="small" title={`Капитальный ремонт МЖД: план ${d.repair.year ?? ''}`} extra={<a onClick={() => nav('/c/capital_repair')}>Список →</a>}>
                    <Row gutter={[8, 8]}>
                      <Col span={8}><Kpi label="Строк в списке" value={fmtNum(d.repair.records)} hint={`домов МЖД: ${d.repair.houses}`} onClick={() => nav('/c/capital_repair')} /></Col>
                      <Col span={16}><Kpi label="Всего, ₸" value={fmtMoney(d.repair.total)} hint="СМР + авторский + технический надзор" /></Col>
                    </Row>
                    <div style={{ marginTop: 8 }}>
                      <BarChartBox horizontal data={d.repair.byType} x="t" y="s" valueLabel="Сумма" unit="₸" onClick={(r) => f('capital_repair', { work_type: [r.t] })} />
                    </div>
                  </Card>
                </Col>
              )}
              {d.yards && (
                <Col xs={24} xl={12}>
                  <Card size="small" title="Благоустройство дворов" extra={<a onClick={() => nav('/c/yard_contracts')}>Договоры →</a>}>
                    <Row gutter={[8, 8]}>
                      <Col span={8}><Kpi label="Утверждённый перечень" value={fmtNum(d.yards.approved)} hint={`${fmtNum(d.yards.approvedArea, 2)} га`} onClick={() => nav('/c/yards_approved')} /></Col>
                      <Col span={8}><Kpi label="Дворов по договорам" value={fmtNum(d.yards.contractYards)} hint={`${d.yards.contracts} договоров`} onClick={() => nav('/c/yard_contracts')} /></Col>
                      <Col span={8}><Kpi label="Не реализовано" value={fmtNum(d.yards.unrealized)} hint={`из ${d.yards.design} адресов проектировщиков`} onClick={() => f('yards_design', { status: ['Не реализован'] })} /></Col>
                      <Col span={8}><Kpi label="Стоимость, тыс. ₸" value={fmtNum(d.yards.contractsCost, 0)} hint="после корректировки" /></Col>
                      <Col span={8}><Kpi label="Освоено, тыс. ₸" value={fmtNum(d.yards.contractsSpent, 0)} hint="2022–2026, по строкам" /></Col>
                      <Col span={8}><Kpi label="Осталось, тыс. ₸" value={fmtNum(d.yards.contractsRemaining, 0)} hint="необходимо для завершения" /></Col>
                    </Row>
                    <div style={{ marginTop: 8 }}>
                      <BarChartBox data={d.yards.spentByYear} x="year" y="spent" valueLabel="Освоено" unit="тыс. ₸" height={200} />
                    </div>
                  </Card>
                </Col>
              )}
              {d.green && (
                <Col xs={24} xl={12}>
                  <Card size="small" title="Зелёные насаждения (инвентаризация 01.12.2025)" extra={<a onClick={() => nav('/c/green_inventory')}>Реестр →</a>}>
                    <Row gutter={[8, 8]}>
                      {d.green.byType.map((g: any) => (
                        <Col key={g.t} span={12}><Kpi label={g.t} value={fmtNum(g.qty)} hint={`${g.species} пород`} onClick={() => f('green_inventory', { record_type: [g.t] })} /></Col>
                      ))}
                    </Row>
                    <div style={{ marginTop: 8 }}>
                      <BarChartBox horizontal data={d.green.top} x="name" y="qty" valueLabel="Количество" unit="шт." />
                    </div>
                  </Card>
                </Col>
              )}
              {d.roads && (
                <Col xs={24} xl={12}>
                  <Card size="small" title="Дорожная инфраструктура: потребность на 2022 год" extra={<a onClick={() => nav('/c/road_needs')}>Реестр →</a>}>
                    <Row gutter={[8, 8]}>
                      {d.roads.map((r: any) => (
                        <Col key={r.sheet} span={12}><Kpi label={`Лист «${r.sheet}»`} value={`${fmtNum(r.cost, 0)} тыс. ₸`} hint={`${r.n} объектов, в г. Атырау: ${r.in_city}`} onClick={() => f('road_needs', { sheet: [r.sheet] })} /></Col>
                      ))}
                    </Row>
                    <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Две версии таблицы из файла «100 ДВОР…» — показываются отдельно, не суммируются.</div>
                  </Card>
                </Col>
              )}
              {d.thermo && (
                <Col xs={24} xl={12}>
                  <Card size="small" title="Термомодернизация: выделенные средства по годам, ₸">
                    <BarChartBox data={d.thermo.byYear.map((r: any) => ({ ...r, label: String(r.year) }))} x="label" y="amount" valueLabel="Средства" unit="₸"
                      onClick={(r) => f('thermo', { program_year: [String(r.year)] })} />
                    <div className="muted" style={{ fontSize: 12 }}>
                      {d.thermo.byYear.map((r: any) => `${r.year}: ${r.n} дом(ов), ${fmtMoney(r.amount)}`).join(' · ')}. За 2023 г. записей в исходной таблице нет.
                    </div>
                  </Card>
                </Col>
              )}
            </Row>

            {d.controlTotals?.length > 0 && (
              <Card size="small" style={{ marginTop: 12 }} title={<span>Сверка с итогами исходных файлов <Tooltip title="Итоговые строки, указанные в самих Excel-файлах, сравниваются с суммой по фактически импортированным строкам."><InfoCircleOutlined className="muted" /></Tooltip></span>}>
                <Table size="small" rowKey={(r: any) => r.label} pagination={false} scroll={{ x: 700 }} dataSource={d.controlTotals}
                  columns={[
                    { title: 'Показатель', dataIndex: 'label' },
                    { title: 'В файле', dataIndex: 'stated', align: 'right', render: (v, r: any) => <span className="num">{fmtNum(v)} {r.unit}</span> },
                    { title: 'По строкам', dataIndex: 'computed', align: 'right', render: (v, r: any) => <span className="num">{fmtNum(v)} {r.unit}</span> },
                    { title: 'Сверка', dataIndex: 'match', width: 300, render: (m, r: any) => m
                      ? <Tag icon={<CheckCircleTwoTone twoToneColor="#52c41a" />}>совпадает</Tag>
                      : <div><Tag color="orange" icon={<ExclamationCircleTwoTone twoToneColor="#fa8c16" />}>расхождение</Tag>{r.note && <div className="muted" style={{ fontSize: 12 }}>{r.note}</div>}</div> },
                  ]} />
              </Card>
            )}
          </>
        )}
      </Loading>
    </>
  );
}
