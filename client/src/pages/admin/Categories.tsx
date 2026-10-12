import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Card, Checkbox, Collapse, Form, Input, Modal, Select, Space, Table, Tag } from 'antd';
import { useState } from 'react';
import { PageTitle } from '../../components/common';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';

const TYPES = [{ value: 'text', label: 'Текст' }, { value: 'number', label: 'Число' }, { value: 'int', label: 'Целое число' }, { value: 'enum', label: 'Значение из списка' }, { value: 'yesno', label: 'Есть / нет' }];

export default function Categories() {
  const { meta, reloadMeta } = useSession();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  return (
    <>
      <PageTitle title="Справочники и категории" sub="Разделы системы и описание их полей. Новые категории позволяют подключать дополнительные источники данных (например, реестр сетей водоснабжения)."
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setOpen(true); }}>Новая категория</Button>} />
      <Card size="small">
        <Collapse items={(meta?.categories ?? []).map((c) => ({
          key: c.code,
          label: <span><b>{c.name}</b> <Tag>{c.code}</Tag> <Tag color="blue">ATR-{c.uid_prefix}-…</Tag> <span className="muted">{meta?.domains.find((d) => d.code === c.domain)?.name} · объектов: {c.count}</span></span>,
          children: (
            <>
              <div className="muted" style={{ marginBottom: 8 }}>{c.description}</div>
              <Table size="small" rowKey="key" pagination={false} dataSource={c.fields} scroll={{ x: 800 }}
                columns={[
                  { title: 'Поле', dataIndex: 'label' },
                  { title: 'Ключ', dataIndex: 'key', render: (k) => <span className="mono">{k}</span> },
                  { title: 'Тип', dataIndex: 'type', render: (t) => TYPES.find((x) => x.value === t)?.label },
                  { title: 'Исходный столбец', dataIndex: 'source' },
                  { title: 'Признаки', render: (_, f: any) => <>{f.required && <Tag color="blue">обязательное</Tag>}{f.filter && <Tag>фильтр</Tag>}{f.confidential && <Tag color="red">конфиденциальное</Tag>}{f.core && <Tag>общее</Tag>}</> },
                ]} />
            </>
          ),
        }))} />
      </Card>
      <Modal open={open} width={820} title="Новая категория объектов" onCancel={() => setOpen(false)} okText="Создать" cancelText="Отмена"
        onOk={async () => {
          const v = await form.validateFields();
          try {
            await api.post('/admin/categories', v);
            message.success('Категория создана');
            setOpen(false);
            reloadMeta();
          } catch (e) {
            message.error((e as Error).message);
          }
        }}>
        <Form form={form} layout="vertical" initialValues={{ domain: 'utilities', fields: [] }}>
          <Space wrap>
            <Form.Item name="code" label="Код (латиница)" rules={[{ required: true, pattern: /^[a-z][a-z0-9_]{1,30}$/ }]}><Input placeholder="water_wells" /></Form.Item>
            <Form.Item name="uid_prefix" label="Префикс ID" rules={[{ required: true, pattern: /^[A-Z]{2,5}$/, message: '2–5 заглавных латинских букв' }]}><Input placeholder="WW" /></Form.Item>
            <Form.Item name="domain" label="Направление" rules={[{ required: true }]}><Select style={{ width: 280 }} options={meta?.domains.map((d) => ({ value: d.code, label: d.name }))} /></Form.Item>
          </Space>
          <Form.Item name="name" label="Полное название" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="short_name" label="Краткое название (для меню)" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="Описание"><Input.TextArea rows={2} /></Form.Item>
          <div className="muted" style={{ marginBottom: 8 }}>Общие поля (наименование, номер, адрес, статус, балансодержатель, год, координаты, примечания) добавляются автоматически. Дополнительные поля:</div>
          <Form.List name="fields">
            {(fields, { add, remove }) => (
              <>
                {fields.map((f) => (
                  <Space key={f.key} wrap align="baseline">
                    <Form.Item name={[f.name, 'label']} rules={[{ required: true }]}><Input placeholder="Название поля" /></Form.Item>
                    <Form.Item name={[f.name, 'key']} rules={[{ required: true, pattern: /^[a-z][a-z0-9_]{0,40}$/ }]}><Input placeholder="ключ_латиницей" /></Form.Item>
                    <Form.Item name={[f.name, 'type']} initialValue="text"><Select style={{ width: 170 }} options={TYPES} /></Form.Item>
                    <Form.Item name={[f.name, 'unit']}><Input placeholder="ед. изм." style={{ width: 90 }} /></Form.Item>
                    <Form.Item name={[f.name, 'filter']} valuePropName="checked"><Checkbox>фильтр</Checkbox></Form.Item>
                    <Form.Item name={[f.name, 'table']} valuePropName="checked" initialValue><Checkbox>в таблице</Checkbox></Form.Item>
                    <MinusCircleOutlined onClick={() => remove(f.name)} />
                  </Space>
                ))}
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add()}>Добавить поле</Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
    </>
  );
}
