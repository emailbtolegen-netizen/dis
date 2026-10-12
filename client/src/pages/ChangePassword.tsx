import { Alert, App, Button, Card, Form, Input } from 'antd';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { PageTitle } from '../components/common';

export default function ChangePassword({ forced }: { forced?: boolean }) {
  const { reload } = useSession();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const body = (
    <Card style={{ maxWidth: 480, width: '100%' }}>
      {forced && <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="Необходимо сменить временный пароль" description="Пароль был выдан администратором. Задайте собственный пароль, чтобы продолжить работу." />}
      <Form
        form={form}
        layout="vertical"
        onFinish={async (v) => {
          try {
            await api.post('/auth/change-password', { current: v.current, next: v.next });
            message.success('Пароль изменён');
            form.resetFields();
            await reload();
          } catch (e) {
            message.error((e as Error).message);
          }
        }}
      >
        <Form.Item name="current" label="Текущий пароль" rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>
        <Form.Item name="next" label="Новый пароль" extra="Не менее 10 символов, буквы и цифры" rules={[{ required: true }, { min: 10, message: 'Не менее 10 символов' }]}><Input.Password autoComplete="new-password" /></Form.Item>
        <Form.Item name="repeat" label="Повторите новый пароль" dependencies={['next']}
          rules={[{ required: true }, ({ getFieldValue }) => ({ validator: (_, v) => (v === getFieldValue('next') ? Promise.resolve() : Promise.reject(new Error('Пароли не совпадают'))) })]}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit">Сменить пароль</Button>
        {forced && <Button type="link" onClick={async () => { await api.post('/auth/logout'); await reload(); }}>Выйти</Button>}
      </Form>
    </Card>
  );
  if (forced) return <div className="login-wrap">{body}</div>;
  return (
    <>
      <PageTitle title="Смена пароля" />
      {body}
    </>
  );
}
