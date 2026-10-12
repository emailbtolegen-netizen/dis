import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { useSession } from '../lib/session';

export default function Login() {
  const { reload } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="login-wrap">
      <Card className="login-card">
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <Typography.Title level={4} style={{ marginBottom: 4 }}>{t('appFullName')}</Typography.Title>
          <div className="muted">{t('appSubtitle')}</div>
        </div>
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
        <Form
          layout="vertical"
          onFinish={async (v) => {
            setBusy(true);
            setError(null);
            try {
              await api.post('/auth/login', v);
              await reload();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Form.Item name="login" label="Логин" rules={[{ required: true, message: 'Введите логин' }]}>
            <Input prefix={<UserOutlined />} autoComplete="username" autoFocus size="large" />
          </Form.Item>
          <Form.Item name="password" label="Пароль" rules={[{ required: true, message: 'Введите пароль' }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={busy}>Войти</Button>
        </Form>
        <div className="muted" style={{ marginTop: 16, fontSize: 12, textAlign: 'center' }}>
          Внутренний портал сотрудников ЖКХ. Доступ — по учётной записи, выданной администратором.
        </div>
      </Card>
    </div>
  );
}
