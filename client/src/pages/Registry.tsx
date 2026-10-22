import { ClearOutlined, DownloadOutlined, EnvironmentOutlined, FilterOutlined, PlusOutlined, SettingOutlined, WarningOutlined } from '@ant-design/icons';
import { Alert, App, Badge, Button, Card, Checkbox, Empty, Grid, Input, Popover, Select, Space, Switch, Table, Tag, Tooltip } from 'antd';
import type { TableColumnsType } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FieldValue, ObjectLink, PageTitle, StatusTag } from '../components/common';
import { download, qs } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { useApi, useDebounced } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { Category, FieldDef } from '../lib/session';

type Filters = Record<string, any>;

function loadCols(code: string): string[] | null {
  try {
    const v = localStorage.getItem(`zhkh_cols_${code}`);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}
function saveCols(code: string, cols: string[]) {
  try {
    localStorage.setItem(`zhkh_cols_${code}`, JSON.stringify(cols));
  } catch { /* недоступно */ }
}

function rangeLabel(v: any): string {
  if (v.min != null && v.max != null) return `${v.min}–${v.max}`;
  if (v.min != null) return `от ${v.min}`;
  if (v.max != null) return `до ${v.max}`;
  if (v.empty === true) return 'не заполнено';
  if (v.empty === false) return 'заполнено';
  return JSON.stringify(v);
}

export default function Registry() {
  const params = useParams();
  const [sp, setSp] = useSearchParams();
  const { meta, cat, can } = useSession();
  const { message } = App.useApp();
  const nav = useNavigate();
  const screens = Grid.useBreakpoint();
  const [showFilters, setShowFilters] = useState(false);
  const categoryCode = params.category ?? sp.get('category') ?? '';
  const category: Category | undefined = categoryCode ? cat(categoryCode) : undefined;

  const filters: Filters = useMemo(() => {
    try {
      return sp.get('f') ? JSON.parse(sp.get('f')!) : {};
    } catch {
      return {};
    }
  }, [sp]);
  const [qInput, setQInput] = useState(sp.get('q') ?? '');
  const q = useDebounced(qInput, 350);
  const page = Number(sp.get('page') ?? 1);
  const pageSize = Number(sp.get('ps') ?? 50);
  const sort = sp.get('sort') ?? '';
  const order = sp.get('order') ?? 'asc';
  const issues = sp.get('issues') === '1';
  const deleted = sp.get('deleted') === '1';

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSp(next, { replace: true });
  };
  useEffect(() => {
    if ((sp.get('q') ?? '') !== q) update({ q: q || null, page: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  useEffect(() => {
    setQInput(sp.get('q') ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryCode]);

  const listQuery = { category: categoryCode || undefined, q: sp.get('q') || undefined, f: Object.keys(filters).length ? filters : undefined, sort: sort || undefined, order, page, pageSize, issues: issues ? 1 : undefined, deleted: deleted ? 1 : undefined };
  const { data, loading, error } = useApi<{ total: number; items: any[] }>(`/objects${qs(listQuery)}`);
  const { data: facets } = useApi<Record<string, { value: string | null; count: number }[]>>(category ? `/objects/facets${qs({ category: categoryCode, q: sp.get('q') || undefined })}` : null);

  const allFields: FieldDef[] = category?.fields ?? [];
  const defaultCols = category ? allFields.filter((f) => f.table).map((f) => f.key) : ['category', 'address_raw', 'status'];
  const [visible, setVisible] = useState<string[]>(() => loadCols(categoryCode || '_all') ?? defaultCols);
  useEffect(() => {
    setVisible(loadCols(categoryCode || '_all') ?? defaultCols);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryCode]);

  const setFilter = (key: string, value: any) => {
    const next = { ...filters };
    if (value == null || (Array.isArray(value) && !value.length)) delete next[key];
    else next[key] = value;
    update({ f: Object.keys(next).length ? JSON.stringify(next) : null, page: null });
  };

  const cell = (f: FieldDef) => (row: any) => {
    const v = f.core ? row[f.key] : row.attrs?.[f.key];
    if (f.key === 'status') return <StatusTag status={v} />;
    if (f.key === 'name') return <ObjectLink uid={row.uid} name={row.name} />;
    // если колонка наименования скрыта — ссылка на карточку из адреса
    if (f.key === 'address_raw' && !visible.includes('name') && allFields.some((x) => x.key === 'name')) return <ObjectLink uid={row.uid} name={v ?? row.name} />;
    return <FieldValue def={f} value={v} hidden={row.hidden_fields?.includes(f.key)} />;
  };

  const columns: TableColumnsType<any> = [
    { title: 'ID', dataIndex: 'uid', key: 'uid', width: 132, fixed: 'left', sorter: true, sortOrder: sort === 'uid' ? (order === 'desc' ? 'descend' : 'ascend') : null,
      render: (v, r) => <span className="mono">{v}{r.has_import_issues ? <Tooltip title="Есть замечания импорта"><WarningOutlined style={{ color: '#d48806', marginLeft: 4 }} /></Tooltip> : null}</span> },
  ];
  if (!category) {
    columns.push(
      { title: 'Наименование', dataIndex: 'name', key: 'name', sorter: true, width: 280, render: (_, r) => <ObjectLink uid={r.uid} name={r.name} /> },
      { title: 'Категория', dataIndex: 'category', key: 'category', width: 180, render: (c) => cat(c)?.short_name ?? c },
      { title: 'Адрес / местоположение', dataIndex: 'address_raw', key: 'address_raw', sorter: true, width: 220 },
      { title: 'Состояние', dataIndex: 'status', key: 'status', width: 150, render: (s) => <StatusTag status={s} /> },
      { title: 'Обновлено', dataIndex: 'updated_at', key: 'updated_at', sorter: true, width: 150, render: fmtDateTime },
    );
  } else {
    const hasName = allFields.some((f) => f.key === 'name');
    if (!hasName) columns.push({ title: 'Наименование', dataIndex: 'name', key: 'name', sorter: true, width: 240, render: (_, r) => <ObjectLink uid={r.uid} name={r.name} />, sortOrder: sort === 'name' ? (order === 'desc' ? 'descend' : 'ascend') : null });
    for (const f of allFields.filter((x) => visible.includes(x.key))) {
      columns.push({
        title: <Tooltip title={f.source ? `Источник: «${f.source}»` : f.hint}>{f.label}{f.unit ? `, ${f.unit}` : ''}</Tooltip>,
        key: f.key,
        dataIndex: f.key,
        sorter: !f.confidential,
        sortOrder: sort === f.key ? (order === 'desc' ? 'descend' : 'ascend') : null,
        width: f.key === 'name' || f.key === 'address_raw' ? 240 : f.type === 'number' || f.type === 'int' ? 120 : 160,
        align: f.type === 'number' || f.type === 'int' ? 'right' : undefined,
        render: (_, r) => cell(f)(r),
      });
    }
  }
  if (deleted) columns.push({ title: 'Удалено', key: 'deleted_at', width: 200, render: (_, r) => <span>{fmtDateTime(r.deleted_at)}<div className="muted">{r.delete_reason}</div></span> });

  const filterFields = allFields.filter((f) => f.filter && !f.confidential);
  const activeFilters = Object.entries(filters);
  const title = category ? category.name : 'Реестр объектов ЖКХ';

  return (
    <>
      <PageTitle
        title={title}
        sub={category ? category.description : 'Все объекты всех разделов. Выберите категорию, чтобы фильтровать по её характеристикам.'}
        extra={
          <>
            {can('objects.export') && (
              <Button icon={<DownloadOutlined />} onClick={async () => {
                try {
                  await download(`/objects/export${qs({ ...listQuery, page: undefined, pageSize: undefined })}`);
                } catch (e) {
                  message.error((e as Error).message);
                }
              }}>Экспорт в Excel</Button>
            )}
            {(category?.code === 'mkd_emergency' || category?.code === 'mkd') && <Button icon={<EnvironmentOutlined />} onClick={() => nav(category.code === 'mkd' ? '/map/housing' : '/map/emergency')}>Показать на карте</Button>}
            {can('objects.edit') && category && <Button type="primary" icon={<PlusOutlined />} onClick={() => nav(`/objects/new?category=${category.code}`)}>Добавить объект</Button>}
          </>
        }
      />
      <Card size="small">
        <div className="filters-bar">
          <Input.Search allowClear placeholder="Поиск: наименование, адрес, номер, ID…" value={qInput} onChange={(e) => setQInput(e.target.value)} style={{ width: 340, maxWidth: '100%' }} />
          {!params.category && (
            <Select allowClear placeholder="Категория" style={{ width: 260, maxWidth: '100%' }} value={categoryCode || undefined}
              options={meta?.categories.map((c) => ({ value: c.code, label: `${c.short_name} (${c.count})` }))}
              onChange={(v) => { const n = new URLSearchParams(); if (v) n.set('category', v); setSp(n); }} />
          )}
          {!screens.md && filterFields.length > 0 && (
            <Badge count={Object.keys(filters).length} size="small">
              <Button icon={<FilterOutlined />} onClick={() => setShowFilters(!showFilters)}>Фильтры</Button>
            </Badge>
          )}
          {(screens.md || showFilters) && filterFields.map((f) => {
            const opts = facets?.[f.key] ?? [];
            const cur = Array.isArray(filters[f.key]) ? filters[f.key] : undefined;
            return (
              <Select key={f.key} mode="multiple" allowClear maxTagCount={1} placeholder={f.label} style={{ minWidth: 170, maxWidth: 280 }}
                value={cur} onChange={(v) => setFilter(f.key, v)} optionFilterProp="label" popupMatchSelectWidth={false}
                options={opts.map((o) => {
                  const lbl = o.value == null || o.value === '' ? 'Не указано' : f.valueMap?.[o.value] ? `${f.valueMap[o.value]} (${o.value})` : o.value;
                  return { value: o.value ?? '__empty__', label: `${lbl} — ${o.count}` };
                })} />
            );
          })}
          {category && (
            <Popover trigger="click" placement="bottomRight" title="Отображаемые столбцы" content={
              <div style={{ maxHeight: 360, overflow: 'auto' }}>
                <Checkbox.Group value={visible} onChange={(v) => { setVisible(v as string[]); saveCols(categoryCode, v as string[]); }}
                  style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                  options={allFields.filter((f) => !f.confidential || can('objects.confidential')).map((f) => ({ value: f.key, label: f.label }))} />
                <Button size="small" type="link" onClick={() => { setVisible(defaultCols); saveCols(categoryCode, defaultCols); }}>По умолчанию</Button>
              </div>
            }>
              <Button icon={<SettingOutlined />}>Столбцы</Button>
            </Popover>
          )}
          <Space size={4}><Switch size="small" checked={issues} onChange={(v) => update({ issues: v ? '1' : null, page: null })} /> <span>с замечаниями импорта</span></Space>
          {can('objects.delete') && <Space size={4}><Switch size="small" checked={deleted} onChange={(v) => update({ deleted: v ? '1' : null, page: null })} /> <span>удалённые</span></Space>}
        </div>
        {activeFilters.length > 0 && (
          <div className="filters-bar">
            <span className="muted">Фильтры:</span>
            {activeFilters.map(([k, v]) => {
              const f = allFields.find((x) => x.key === k);
              const val = Array.isArray(v) ? v.map((x) => (x === '__empty__' ? 'не указано' : x)).join(', ') : rangeLabel(v);
              return <Tag key={k} closable onClose={() => setFilter(k, null)}>{f?.label ?? k}: {val}</Tag>;
            })}
            <Button size="small" icon={<ClearOutlined />} onClick={() => update({ f: null, page: null })}>Сбросить</Button>
          </div>
        )}
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 8 }} />}
        {category && category.count === 0 && !loading ? (
          <Empty description={<span>В этом разделе пока нет объектов.<br /><span className="muted">{category.description}</span></span>}>
            {can('objects.edit') && <Button type="primary" icon={<PlusOutlined />} onClick={() => nav(`/objects/new?category=${category.code}`)}>Добавить объект</Button>}
            {can('import.manage') && <Button style={{ marginLeft: 8 }} onClick={() => nav('/admin/import')}>Импортировать из Excel</Button>}
          </Empty>
        ) : (
          <Table
            className="registry-table"
            size="small"
            rowKey="uid"
            loading={loading}
            columns={columns}
            dataSource={data?.items ?? []}
            sticky={{ offsetHeader: 56 }}
            scroll={{ x: 'max-content' }}
            onChange={(p, _f, s: any) => {
              const sortKey = s?.order ? String(s.columnKey) : null;
              update({
                page: p.current && p.current > 1 ? String(p.current) : null,
                ps: p.pageSize && p.pageSize !== 50 ? String(p.pageSize) : null,
                sort: sortKey,
                order: s?.order === 'descend' ? 'desc' : null,
              });
            }}
            pagination={{
              current: page, pageSize, total: data?.total ?? 0, showSizeChanger: true, pageSizeOptions: [25, 50, 100, 200, 500],
              showTotal: (t, r) => `${r[0]}–${r[1]} из ${t}`,
            }}
            onRow={(r) => ({ onDoubleClick: () => nav(`/objects/${r.uid}`) })}
          />
        )}
      </Card>
    </>
  );
}
