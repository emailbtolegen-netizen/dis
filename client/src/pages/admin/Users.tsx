import { PlusOutlined } from '@ant-design/icons';
import { App, Button, Card, Form, Input, Modal, Select, Switch, Table, Tag } from 'antd';
import { useState } from 'react';
import { Loading, PageTitle } from '../../components/common';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';

export default function Users() {
  const { data, error, loading, reload } = useApi<any[]>('/admin/users');
  const { data: roles } = useApi<any>('/admin/roles');
  const { user: me } = useSession();
  const { message } = App.useApp();
  const [edit, setEdit] = useState<any | null>(null);
  const [form] = Form.useForm();

  const open = (u: any | null) => {
    setEdit(u ?? {});
    form.setFieldsValue(u ? { ...u, is_active: !!u.is_active, password: '' } : { is_active: true, role_id: roles?.roles.find((r: any) => r.code === 'viewer')?.id });
  };
  const save = async () => {
    const v = await form.validateFields();
    try {
      if (edit?.id) {
        const body: any = { full_name: v.full_name, position: v.position ?? null, role_id: v.role_id, is_active: v.is_active };
        if (v.password) body.password = v.password;
        await api.patch(`/admin/users/${edit.id}`, body);
      } else {
        await api.post('/admin/users', { ...v, position: v.position ?? null });
      }
      message.success('Сохранено');
      setEdit(null);
      reload();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <>
      <PageTitle title="Пользователи" sub="Новый пользователь получает временный пароль и обязан сменить его при первом входе." extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => open(null)}>Добавить пользователя</Button>} />
      <Loading error={error} loading={loading}>
        <Card size="small">
          <Table size="small" rowKey="id" dataSource={data ?? []} scroll={{ x: 900 }} pagination={false}
            onRow={(r) => ({ onClick: () => open(r), style: { cursor: 'pointer' } })}
            columns={[
              { title: 'ФИО', dataIndex: 'full_name', render: (v, r: any) => <div>{v}{r.id === me?.id && <Tag style={{ marginLeft: 6 }}>вы</Tag>}<div className="muted">{r.position}</div></div> },
              { title: 'Логин', dataIndex: 'login', render: (v) => <span className="mono">{v}</span> },
              { title: 'Роль', dataIndex: 'role_name', render: (v, r: any) => <Tag color={r.role_code === 'admin' ? 'red' : r.role_code === 'editor' ? 'blue' : 'default'}>{v}</Tag> },
              { title: 'Статус', render: (_, r: any) => (!r.is_active ? <Tag>отключён</Tag> : r.locked_until ? <Tag color="orange">временно заблокирован</Tag> : r.must_change_password ? <Tag color="gold">ожидает смены пароля</Tag> : <Tag color="green">активен</Tag>) },
              { title: 'Последний вход', dataIndex: 'last_login_at', render: fmtDateTime },
            ]} />
        </Card>
      </Loading>
      <Modal open={!!edit} title={edit?.id ? `Пользователь: ${edit.login}` : 'Новый пользователь'} onCancel={() => setEdit(null)} onOk={save} okText="Сохранить" cancelText="Отмена" destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="login" label="Логин" rules={[{ required: true, pattern: /^[a-zA-Z0-9._-]{3,50}$/, message: '3–50 символов: латиница, цифры, . _ -' }]}><Input disabled={!!edit?.id} /></Form.Item>
          <Form.Item name="full_name" label="ФИО" rules={[{ required: true, min: 3 }]}><Input /></Form.Item>
          <Form.Item name="position" label="Должность / отдел"><Input /></Form.Item>
          <Form.Item name="role_id" label="Роль" rules={[{ required: true }]}>
            <Select options={roles?.roles.map((r: any) => ({ value: r.id, label: `${r.name} — ${r.description ?? ''}` }))} />
          </Form.Item>
          <Form.Item name="password" label={edit?.id ? 'Новый временный пароль (оставьте пустым, чтобы не менять)' : 'Временный пароль'}
            rules={edit?.id ? [{ min: 10, message: 'Не менее 10 символов' }] : [{ required: true, min: 10, message: 'Не менее 10 символов, буквы и цифры' }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="is_active" label="Учётная запись активна" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
