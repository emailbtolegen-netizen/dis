import {
  ArrowLeftOutlined, CheckOutlined, CloseOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, FileOutlined, LinkOutlined, RollbackOutlined, UploadOutlined,
} from '@ant-design/icons';
import { Alert, App, Button, Card, Descriptions, Empty, Form, Input, List, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Timeline, Tooltip, Upload } from 'antd';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FieldValue, Loading, ObjectLink, PageTitle, SeverityTag, StatusTag } from '../components/common';
import { formToPayload, ObjectFormFields } from '../components/ObjectForm';
import { api, qs } from '../lib/api';
import { fmtBytes, fmtDateTime } from '../lib/format';
import { useApi } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { FieldDef } from '../lib/session';

const ACTIONS: Record<string, string> = {
  create: 'Создание вручную', update: 'Изменение', delete: 'Удаление', restore: 'Восстановление',
  import_create: 'Создано при импорте', import_update: 'Обновлено при импорте', rollback: 'Откат импорта',
};
const LINK_STATUS: Record<string, { color: string; label: string }> = {
  suggested: { color: 'gold', label: 'предложена автоматически' },
  confirmed: { color: 'green', label: 'подтверждена' },
  rejected: { color: 'default', label: 'отклонена' },
};

function show(v: unknown): string {
  if (v == null || v === '') return '—';
  return typeof v === 'number' ? v.toLocaleString('ru-RU') : String(v);
}

export default function ObjectCard() {
  const { uid } = useParams();
  const { data, error, loading, reload } = useApi<any>(`/objects/${uid}`);
  const { can, meta, reloadMeta } = useSession();
  const { message, modal } = App.useApp();
  const nav = useNavigate();
  const [editing, setEditing] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [form] = Form.useForm();
  const [linkForm] = Form.useForm();
  const { data: facets } = useApi<any>(editing && data ? `/objects/facets${qs({ category: data.object.category })}` : null);

  if (!data) return <Loading error={error} loading={loading} />;
  const o = data.object;
  const cat = data.category;
  const fields: FieldDef[] = cat.fields;
  const value = (f: FieldDef) => (f.core ? o[f.key] : o.attrs?.[f.key]);
  const shown = fields.filter((f) => !['name'].includes(f.key));
  const extraAttrs = Object.keys(o.attrs ?? {}).filter((k) => !fields.some((f) => f.key === k) && o.attrs[k] != null);

  const startEdit = () => {
    const core: Record<string, unknown> = {};
    const attrs: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.confidential && !can('objects.confidential')) continue;
      if (f.core) core[f.key] = o[f.key];
      else attrs[f.key] = o.attrs?.[f.key];
    }
    if (!fields.some((f) => f.key === 'name')) core.name = o.name;
    form.setFieldsValue({ core, attrs, reason: '' });
    setEditing(true);
  };

  const save = async () => {
    await form.validateFields();
    const payload = formToPayload(form);
    // отправляются только изменённые поля
    const core: Record<string, unknown> = {};
    const attrs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload.core)) if ((v ?? null) !== (o[k] ?? null)) core[k] = v ?? null;
    for (const [k, v] of Object.entries(payload.attrs)) if ((v ?? null) !== (o.attrs?.[k] ?? null)) attrs[k] = v ?? null;
    if (!Object.keys(core).length && !Object.keys(attrs).length) {
      message.info('Изменений нет');
      setEditing(false);
      return;
    }
    try {
      const r = await api.patch(`/objects/${o.uid}`, { core, attrs, reason: form.getFieldValue('reason'), expectedUpdatedAt: o.updated_at });
      message.success(`Сохранено, изменено полей: ${r.changes}`);
      setEditing(false);
      reload();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const remove = () => {
    let reason = '';
    modal.confirm({
      title: 'Удалить объект?',
      content: (
        <div>
          <p>Запись будет помечена как удалённая и скрыта из реестров. Администратор может восстановить её.</p>
          <Input.TextArea placeholder="Причина удаления (обязательно)" onChange={(e) => { reason = e.target.value; }} />
        </div>
      ),
      okText: 'Удалить', okButtonProps: { danger: true }, cancelText: 'Отмена',
      onOk: async () => {
        try {
          await api.del(`/objects/${o.uid}`, { reason });
          message.success('Объект удалён');
          reloadMeta();
          reload();
        } catch (e) {
          message.error((e as Error).message);
          throw e;
        }
      },
    });
  };

  const reviewLink = async (id: number, status: string) => {
    try {
      await api.patch(`/links/${id}`, { status });
      reload();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const tabs = [
    {
      key: 'info', label: 'Сведения',
      children: (
        <>
          <Descriptions bordered size="small" column={{ xs: 1, sm: 1, md: 2, lg: 2, xl: 2, xxl: 2 }} labelStyle={{ width: '18%', minWidth: 140, color: '#52606d' }}>
            <Descriptions.Item label="Идентификатор"><span className="mono">{o.uid}</span></Descriptions.Item>
            <Descriptions.Item label="Категория"><Link to={`/c/${cat.code}`}>{cat.name}</Link></Descriptions.Item>
            {shown.map((f) => (
              <Descriptions.Item key={f.key} label={<Tooltip title={f.source ? `Исходный столбец: «${f.source}»` : f.hint}>{f.label}{f.unit ? `, ${f.unit}` : ''}</Tooltip>}>
                {f.key === 'status' ? <StatusTag status={o.status} /> : <FieldValue def={f} value={value(f)} hidden={o.hidden_fields?.includes(f.key)} />}
              </Descriptions.Item>
            ))}
            {extraAttrs.map((k) => <Descriptions.Item key={k} label={k}>{show(o.attrs[k])}</Descriptions.Item>)}
            <Descriptions.Item label="Адресный справочник">
              {data.address ? <Link to={`/addresses/${data.address.id}`}>{data.address.display} ({data.address.kind === 'building' ? 'здание' : 'территория'})</Link> : <span className="muted">не привязан</span>}
              {data.area && <> · <Link to={`/addresses/${data.area.id}`}>{data.area.display}</Link></>}
            </Descriptions.Item>
            <Descriptions.Item label="Последнее обновление">{fmtDateTime(o.updated_at)} <span className="muted">({o.updated_via === 'manual' ? 'вручную' : o.updated_via === 'rollback' ? 'откат импорта' : 'импорт'})</span></Descriptions.Item>
          </Descriptions>
          {data.sameAddress.length > 0 && (
            <Card size="small" title="Другие объекты по этому адресу" style={{ marginTop: 12 }}>
              <List size="small" dataSource={data.sameAddress} renderItem={(x: any) => (
                <List.Item><ObjectLink uid={x.uid} name={x.name} /> <span className="muted">{meta?.categories.find((c) => c.code === x.category)?.short_name}</span></List.Item>
              )} />
            </Card>
          )}
        </>
      ),
    },
    {
      key: 'links', label: `Связи (${data.links.length})`,
      children: (
        <>
          <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Автоматические связи построены по номерам ТП/ПС/РП в наименованиях и по совпадению адресов. Они требуют проверки: подтвердите или отклоните их." />
          {can('links.manage') && <Button icon={<LinkOutlined />} style={{ marginBottom: 12 }} onClick={() => setLinkOpen(true)}>Добавить связь вручную</Button>}
          <Table size="small" rowKey="id" dataSource={data.links} pagination={data.links.length > 20 ? { pageSize: 20 } : false} scroll={{ x: 800 }}
            columns={[
              { title: 'Связь', dataIndex: 'relation_label', width: 260 },
              { title: 'Объект', render: (_, l: any) => <span><ObjectLink uid={l.uid} name={l.name} /><div className="muted">{l.uid} · {l.address_raw ?? ''}</div></span> },
              { title: 'Статус', width: 200, render: (_, l: any) => <Tooltip title={l.note}><Tag color={LINK_STATUS[l.status]?.color}>{LINK_STATUS[l.status]?.label}</Tag>{l.confidence != null && l.method !== 'manual' && <span className="muted">{Math.round(l.confidence * 100)}%</span>}</Tooltip> },
              { title: 'Основание', dataIndex: 'note', render: (n) => <span className="muted" style={{ fontSize: 12 }}>{n}</span> },
              ...(can('links.manage') ? [{
                title: '', width: 120, render: (_: unknown, l: any) => (
                  <Space size={4}>
                    {l.status !== 'confirmed' && <Tooltip title="Подтвердить"><Button size="small" icon={<CheckOutlined />} onClick={() => reviewLink(l.id, 'confirmed')} /></Tooltip>}
                    {l.status !== 'rejected' && <Tooltip title="Отклонить"><Button size="small" icon={<CloseOutlined />} onClick={() => reviewLink(l.id, 'rejected')} /></Tooltip>}
                    {l.method === 'manual' && <Popconfirm title="Удалить связь?" onConfirm={async () => { await api.del(`/links/${l.id}`); reload(); }}><Button size="small" danger icon={<DeleteOutlined />} /></Popconfirm>}
                  </Space>
                ),
              }] : []),
            ]} />
        </>
      ),
    },
    {
      key: 'history', label: `История (${data.history.length})`,
      children: data.history.length ? (
        <Timeline items={data.history.map((h: any) => ({
          color: h.action === 'delete' ? 'red' : h.action.startsWith('import') ? 'blue' : 'green',
          children: (
            <div>
              <b>{ACTIONS[h.action] ?? h.action}</b> · {fmtDateTime(h.at)} · {h.user_name ?? (h.import_id ? 'системный импорт' : '—')}
              {h.import_id && <> · <Link to={`/admin/imports/${h.import_id}`}>импорт №{h.import_id}</Link></>}
              {h.reason && <div className="muted">Причина: {h.reason}</div>}
              {h.changes?.length > 0 && (
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {h.changes.map((c: any, i: number) => <li key={i}>{c.label}: <span className="diff-old">{show(c.old)}</span> → <span className="diff-new">{show(c.new)}</span></li>)}
                </ul>
              )}
            </div>
          ),
        }))} />
      ) : <Empty description="Изменений нет" />,
    },
    {
      key: 'files', label: `Документы и фото (${data.attachments.length})`,
      children: (
        <>
          {can('attachments.upload') && (
            <Upload
              accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.doc,.xls"
              showUploadList={false}
              customRequest={async ({ file, onSuccess, onError }) => {
                const fd = new FormData();
                fd.append('file', file as Blob);
                try {
                  await api.upload(`/objects/${o.uid}/attachments`, fd);
                  message.success('Файл загружен');
                  onSuccess?.({});
                  reload();
                } catch (e) {
                  message.error((e as Error).message);
                  onError?.(e as Error);
                }
              }}
            >
              <Button icon={<UploadOutlined />}>Загрузить файл (PDF, фото, Word, Excel; до 20 МБ)</Button>
            </Upload>
          )}
          <List style={{ marginTop: 12 }} dataSource={data.attachments} locale={{ emptyText: 'Файлов нет' }} renderItem={(a: any) => (
            <List.Item actions={[
              <a key="d" href={`/api/attachments/${a.id}`}><DownloadOutlined /> Скачать</a>,
              ...(can('attachments.upload') ? [<Popconfirm key="x" title="Удалить файл?" onConfirm={async () => { await api.del(`/attachments/${a.id}`); reload(); }}><a style={{ color: '#cf1322' }}>Удалить</a></Popconfirm>] : []),
            ]}>
              <List.Item.Meta
                avatar={a.mime.startsWith('image/') ? <img src={`/api/attachments/${a.id}?inline=1`} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 4 }} /> : <FileOutlined style={{ fontSize: 28 }} />}
                title={a.original_name}
                description={`${fmtBytes(a.size)} · ${fmtDateTime(a.uploaded_at)}`}
              />
            </List.Item>
          )} />
        </>
      ),
    },
    {
      key: 'source', label: 'Источник данных',
      children: (
        <>
          {data.source ? (
            <Descriptions bordered size="small" column={1} labelStyle={{ width: 220 }}>
              <Descriptions.Item label="Файл">{data.source.file_name}</Descriptions.Item>
              <Descriptions.Item label="Лист">{o.source_sheet}</Descriptions.Item>
              <Descriptions.Item label="Строка Excel">{o.source_row}</Descriptions.Item>
              <Descriptions.Item label="Импорт">{o.source_import_id ? <Link to={`/admin/imports/${o.source_import_id}`}>№{o.source_import_id}</Link> : '—'}</Descriptions.Item>
              <Descriptions.Item label="Контрольная сумма файла (SHA-256)"><span className="mono" style={{ wordBreak: 'break-all' }}>{data.source.sha256}</span></Descriptions.Item>
            </Descriptions>
          ) : <Alert type="info" showIcon message="Объект создан вручную через сайт — исходного файла нет." />}
          {o.raw && (
            <Card size="small" title="Исходная строка Excel (без изменений)" style={{ marginTop: 12 }}>
              <table className="raw-table" style={{ width: '100%' }}><tbody>
                {Object.entries(o.raw).map(([k, v]) => <tr key={k}><td>{k}</td><td>{show(v)}</td></tr>)}
              </tbody></table>
            </Card>
          )}
        </>
      ),
    },
    {
      key: 'issues', label: `Замечания (${data.issues.length})`,
      children: data.issues.length ? (
        <List dataSource={data.issues} renderItem={(i: any) => <List.Item><Space align="start"><SeverityTag level={i.severity} /><span>{i.message}</span></Space></List.Item>} />
      ) : <Empty description="Замечаний нет" />,
    },
  ];

  return (
    <>
      <PageTitle
        title={o.name}
        sub={<Space wrap size={6}><span className="mono">{o.uid}</span><Tag>{cat.short_name}</Tag>{o.status && <StatusTag status={o.status} />}{o.deleted_at && <Tag color="red">Удалён: {o.delete_reason}</Tag>}</Space>}
        extra={
          <>
            <Button icon={<ArrowLeftOutlined />} onClick={() => nav(-1)}>Назад</Button>
            {can('objects.edit') && !o.deleted_at && <Button type="primary" icon={<EditOutlined />} onClick={startEdit}>Редактировать</Button>}
            {can('objects.delete') && !o.deleted_at && <Button danger icon={<DeleteOutlined />} onClick={remove}>Удалить</Button>}
            {can('objects.delete') && o.deleted_at && <Button icon={<RollbackOutlined />} onClick={async () => { await api.post(`/objects/${o.uid}/restore`); reloadMeta(); reload(); }}>Восстановить</Button>}
          </>
        }
      />
      {data.issues.some((i: any) => i.severity !== 'info') && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`Есть замечания к данным (${data.issues.length}). См. вкладку «Замечания».`} />
      )}
      <Card size="small"><Tabs items={tabs} /></Card>

      <Modal open={editing} title={`Редактирование: ${o.name}`} width={860} onCancel={() => setEditing(false)} onOk={save} okText="Сохранить" cancelText="Отмена" destroyOnClose>
        <Form form={form} layout="vertical">
          <ObjectFormFields category={cat} canConfidential={can('objects.confidential')} facets={facets ?? undefined} />
          <Form.Item name="reason" label="Причина изменения" rules={[{ required: true, min: 3, message: 'Укажите причину (не менее 3 символов)' }]}>
            <Input.TextArea rows={2} maxLength={500} placeholder="Например: уточнено по акту обследования от 01.10.2026" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={linkOpen} title="Добавить связь" onCancel={() => setLinkOpen(false)} okText="Добавить" cancelText="Отмена"
        onOk={async () => {
          const v = await linkForm.validateFields();
          try {
            await api.post(`/objects/${o.uid}/links`, v);
            setLinkOpen(false);
            linkForm.resetFields();
            reload();
          } catch (e) {
            message.error((e as Error).message);
          }
        }}>
        <Form form={linkForm} layout="vertical" initialValues={{ relation: 'related' }}>
          <Form.Item name="to" label="Идентификатор связанного объекта" rules={[{ required: true }]} extra="Например, ATR-TP-00059 (можно найти через поиск)"><Input /></Form.Item>
          <Form.Item name="relation" label="Тип связи"><Select options={Object.entries(meta?.relations ?? {}).map(([k, r]) => ({ value: k, label: r.label }))} /></Form.Item>
          <Form.Item name="note" label="Примечание"><Input maxLength={500} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
