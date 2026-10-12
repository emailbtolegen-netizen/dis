import { PlusOutlined } from '@ant-design/icons';
import { App, Button, Card, Checkbox, Form, Input, Modal, Popconfirm, Table, Tag } from 'antd';
import { useState } from 'react';
import { Loading, PageTitle } from '../../components/common';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';

export default function Roles() {
  const { data, error, loading, reload } = useApi<any>('/admin/roles');
  const { can } = useSession();
  const { message } = App.useApp();
  const [edit, setEdit] = useState<any | null>(null);
  const [form] = Form.useForm();
  const perms: Record<string, string> = data?.permissions ?? {};
  const domains: Record<string, { name: string }> = data?.domains ?? {};

  const open = (r: any | null) => {
    setEdit(r ?? {});
    form.setFieldsValue(r ? { ...r, all: r.sections.includes('*'), sections: r.sections.filter((s: string) => s !== '*') } : { permissions: ['objects.view'], all: true, sections: [] });
  };
  const save = async () => {
    const v = await form.validateFields();
    const body = { name: v.name, description: v.description, permissions: v.permissions, sections: v.all ? ['*'] : v.sections };
    try {
      if (edit?.id) await api.patch(`/admin/roles/${edit.id}`, body);
      else await api.post('/admin/roles', { ...body, code: v.code });
      message.success('Сохранено');
      setEdit(null);
      reload();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <>
      <PageTitle title="Роли и права доступа" sub="Права проверяются на сервере при каждом запросе. Можно создавать дополнительные роли, например «Просмотр электрохозяйства»."
        extra={can('roles.manage') && <Button type="primary" icon={<PlusOutlined />} onClick={() => open(null)}>Новая роль</Button>} />
      <Loading error={error} loading={loading}>
        <Card size="small">
          <Table size="small" rowKey="id" dataSource={data?.roles ?? []} pagination={false} scroll={{ x: 900 }}
            columns={[
              { title: 'Роль', render: (_, r: any) => <div><b>{r.name}</b> {r.is_system ? <Tag>системная</Tag> : null}<div className="muted">{r.description}</div></div> },
              { title: 'Права', dataIndex: 'permissions', render: (p: string[]) => p.map((x) => <Tag key={x} style={{ marginBottom: 2 }}>{perms[x] ?? x}</Tag>) },
              { title: 'Разделы', dataIndex: 'sections', width: 200, render: (s: string[]) => (s.includes('*') ? 'Все разделы' : s.map((x) => domains[x]?.name ?? x).join(', ')) },
              { title: 'Пользователей', dataIndex: 'users', width: 120, align: 'right' },
              {
                title: '', width: 160, render: (_, r: any) => can('roles.manage') && r.code !== 'admin' && (
                  <>
                    <Button size="small" onClick={() => open(r)}>Изменить</Button>
                    {!r.is_system && <Popconfirm title="Удалить роль?" onConfirm={async () => { try { await api.del(`/admin/roles/${r.id}`); reload(); } catch (e) { message.error((e as Error).message); } }}><Button size="small" danger style={{ marginLeft: 4 }}>Удалить</Button></Popconfirm>}
                  </>
                ),
              },
            ]} />
        </Card>
      </Loading>
      <Modal open={!!edit} width={720} title={edit?.id ? `Роль: ${edit.name}` : 'Новая роль'} onCancel={() => setEdit(null)} onOk={save} okText="Сохранить" cancelText="Отмена" destroyOnClose>
        <Form form={form} layout="vertical">
          {!edit?.id && <Form.Item name="code" label="Код роли (латиница)" rules={[{ required: true, pattern: /^[a-z0-9_-]{2,40}$/ }]}><Input /></Form.Item>}
          <Form.Item name="name" label="Название" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="Описание"><Input /></Form.Item>
          <Form.Item name="permissions" label="Права">
            <Checkbox.Group style={{ display: 'flex', flexDirection: 'column', gap: 4 }} options={Object.entries(perms).map(([k, l]) => ({ value: k, label: l }))} />
          </Form.Item>
          <Form.Item name="all" valuePropName="checked"><Checkbox>Доступ ко всем разделам</Checkbox></Form.Item>
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) => !getFieldValue('all') && (
              <Form.Item name="sections" label="Доступные разделы" rules={[{ required: true, message: 'Выберите хотя бы один раздел' }]}>
                <Checkbox.Group options={Object.entries(domains).map(([k, d]) => ({ value: k, label: d.name }))} />
              </Form.Item>
            )}
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
