import { Card, Col, Empty, Input, List, Row, Tag } from 'antd';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loading, PageTitle } from '../components/common';
import { useApi } from '../lib/hooks';

export default function SearchPage() {
  const [sp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const nav = useNavigate();
  const { data, error, loading } = useApi<any>(q.length >= 2 ? `/search?limit=20&q=${encodeURIComponent(q)}` : null);
  return (
    <>
      <PageTitle title="Результаты поиска" sub={q ? `Запрос: «${q}»${data ? ` — найдено объектов: ${data.total}` : ''}` : 'Введите запрос'} />
      <Input.Search defaultValue={q} key={q} enterButton="Найти" style={{ maxWidth: 560, marginBottom: 12 }} onSearch={(v) => v.trim().length >= 2 && nav(`/search?q=${encodeURIComponent(v.trim())}`)} />
      <Loading error={error} loading={loading}>
        {data && !data.total && !data.addresses.length && <Empty description="Ничего не найдено. Попробуйте часть названия, номер ТП (например, 84/8) или улицу." />}
        <Row gutter={[12, 12]}>
          {data?.addresses.length > 0 && (
            <Col xs={24} lg={12}>
              <Card size="small" title="Адреса">
                <List size="small" dataSource={data.addresses} renderItem={(a: any) => (
                  <List.Item><Link to={`/addresses/${a.id}`}>{a.display}</Link> <Tag>{a.kind === 'building' ? 'здание' : 'территория'}</Tag> <span className="muted">объектов: {a.count}</span></List.Item>
                )} />
              </Card>
            </Col>
          )}
          {data?.groups.map((g: any) => (
            <Col key={g.category} xs={24} lg={12}>
              <Card size="small" title={`${g.name} — ${g.count}`} extra={g.count > g.items.length && <Link to={`/c/${g.category}?q=${encodeURIComponent(q)}`}>Все {g.count} в реестре →</Link>}>
                <List size="small" dataSource={g.items} renderItem={(i: any) => (
                  <List.Item>
                    <div>
                      <Link to={`/objects/${i.uid}`}>{i.name}</Link>
                      <div className="muted" style={{ fontSize: 12 }}><span className="mono">{i.uid}</span>{i.address_raw ? ` · ${i.address_raw}` : ''}{i.status ? ` · ${i.status}` : ''}</div>
                    </div>
                  </List.Item>
                )} />
              </Card>
            </Col>
          ))}
        </Row>
      </Loading>
    </>
  );
}
