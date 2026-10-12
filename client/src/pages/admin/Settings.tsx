import { Alert, App, Button, Card, Checkbox, Form, Input, Select, Switch, Table } from 'antd';
import { useEffect, useState } from 'react';
import { Loading, PageTitle } from '../../components/common';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';

export default function Settings() {
  const { data, error, loading, reload } = useApi<any>('/admin/settings');
  const { message } = App.useApp();
  const [state, setState] = useState<any>(null);
  useEffect(() => {
    if (data) setState(structuredClone(data));
  }, [data]);

  const setCat = (code: string, patch: any) => setState({ ...state, categories: state.categories.map((c: any) => (c.code === code ? { ...c, ...patch } : c)) });

  return (
    <>
      <PageTitle title="Настройки системы" />
      <Loading error={error} loading={loading}>
        {state && (
          <>
            <Card size="small" title="Общие">
              <Form layout="vertical" style={{ maxWidth: 600 }}>
                <Form.Item label="Название системы"><Input value={state.system_name} onChange={(e) => setState({ ...state, system_name: e.target.value })} /></Form.Item>
              </Form>
            </Card>
            <Card size="small" title="Публичная версия (без авторизации)" style={{ marginTop: 12 }}>
              <Alert type="warning" showIcon style={{ marginBottom: 12 }}
                message="По умолчанию система работает в закрытом режиме. Публикуйте только сведения, разрешённые к открытому опубликованию. Конфиденциальные поля (контакты, ФИО) опубликовать нельзя." />
              <div style={{ marginBottom: 12 }}><Switch checked={state.public_enabled} onChange={(v) => setState({ ...state, public_enabled: v })} /> Публичная версия включена {state.public_enabled && <a href="/public" target="_blank" rel="noreferrer" style={{ marginLeft: 8 }}>открыть /public</a>}</div>
              <Table size="small" rowKey="code" pagination={false} dataSource={state.categories} scroll={{ x: 700 }}
                columns={[
                  { title: 'Раздел', dataIndex: 'name' },
                  { title: 'Публиковать', width: 120, render: (_, c: any) => <Checkbox checked={c.is_public} onChange={(e) => setCat(c.code, { is_public: e.target.checked })} /> },
                  { title: 'Публикуемые поля', render: (_, c: any) => (
                    <Select mode="multiple" style={{ width: '100%', minWidth: 300 }} disabled={!c.is_public} value={c.public_fields} onChange={(v) => setCat(c.code, { public_fields: v })}
                      options={c.fields.map((f: any) => ({ value: f.key, label: f.label }))} placeholder="Выберите поля" />
                  ) },
                ]} />
            </Card>
            <Button type="primary" style={{ marginTop: 12 }} onClick={async () => {
              try {
                await api.put('/admin/settings', { public_enabled: state.public_enabled, system_name: state.system_name, categories: state.categories.map((c: any) => ({ code: c.code, is_public: c.is_public, public_fields: c.public_fields })) });
                message.success('Настройки сохранены');
                reload();
              } catch (e) {
                message.error((e as Error).message);
              }
            }}>Сохранить</Button>
          </>
        )}
      </Loading>
    </>
  );
}
