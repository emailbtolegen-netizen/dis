import { App, Button, Card, Form, Input, Select } from 'antd';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageTitle } from '../components/common';
import { formToPayload, ObjectFormFields } from '../components/ObjectForm';
import { api, qs } from '../lib/api';
import { useApi } from '../lib/hooks';
import { useSession } from '../lib/session';

export default function ObjectNew() {
  const [sp, setSp] = useSearchParams();
  const { meta, cat, can, reloadMeta } = useSession();
  const { message } = App.useApp();
  const nav = useNavigate();
  const [form] = Form.useForm();
  const code = sp.get('category') ?? '';
  const category = cat(code);
  const { data: facets } = useApi<any>(category ? `/objects/facets${qs({ category: code })}` : null);

  return (
    <>
      <PageTitle title="Новый объект" sub="Запись создаётся вручную; источник данных — «создано через сайт». Изменение фиксируется в истории." />
      <Card size="small" style={{ maxWidth: 900 }}>
        <Form.Item label="Категория" layout="vertical">
          <Select style={{ maxWidth: 480 }} value={code || undefined} placeholder="Выберите категорию" onChange={(v) => setSp({ category: v })}
            options={meta?.categories.map((c) => ({ value: c.code, label: c.name }))} />
        </Form.Item>
        {category && (
          <Form form={form} layout="vertical" onFinish={async () => {
            try {
              const r = await api.post('/objects', { category: code, ...formToPayload(form), reason: form.getFieldValue('reason') });
              message.success(`Объект создан: ${r.uid}`);
              reloadMeta();
              nav(`/objects/${r.uid}`);
            } catch (e) {
              message.error((e as Error).message);
            }
          }}>
            <ObjectFormFields category={category} canConfidential={can('objects.confidential')} facets={facets ?? undefined} />
            <Form.Item name="reason" label="Основание (документ, обследование)"><Input maxLength={500} /></Form.Item>
            <Button type="primary" htmlType="submit">Создать</Button>
          </Form>
        )}
      </Card>
    </>
  );
}
