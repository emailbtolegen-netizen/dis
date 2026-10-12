import { Col, Form, Input, InputNumber, Row, Select, Tooltip } from 'antd';
import type { FormInstance } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import type { Category, FieldDef } from '../lib/session';

/** Поля формы объекта, построенные по описанию полей категории. */
export function ObjectFormFields({ category, canConfidential, facets }: { category: Category; canConfidential: boolean; facets?: Record<string, { value: string | null }[]> }) {
  const fields = category.fields.filter((f) => !f.confidential || canConfidential);
  const hasName = fields.some((f) => f.key === 'name');
  const label = (f: FieldDef) => (
    <span>
      {f.label}{f.unit ? `, ${f.unit}` : ''}
      {(f.hint || f.source) && <Tooltip title={[f.hint, f.source ? `Исходный столбец: «${f.source}»` : ''].filter(Boolean).join('. ')}> <InfoCircleOutlined className="muted" /></Tooltip>}
    </span>
  );
  const input = (f: FieldDef) => {
    if (f.type === 'number' || f.type === 'int') return <InputNumber style={{ width: '100%' }} decimalSeparator="," precision={f.type === 'int' ? 0 : undefined} />;
    if (f.key === 'notes') return <Input.TextArea rows={3} maxLength={2000} />;
    return <Input maxLength={2000} />;
  };
  return (
    <Row gutter={12}>
      {!hasName && (
        <Col xs={24}>
          <Form.Item name={['core', 'name']} label="Наименование" extra="Если не заполнено — используется адрес">
            <Input maxLength={500} />
          </Form.Item>
        </Col>
      )}
      {fields.map((f) => (
        <Col key={f.key} xs={24} md={f.key === 'name' || f.key === 'notes' || f.key === 'address_raw' ? 24 : 12}>
          <Form.Item name={[f.core ? 'core' : 'attrs', f.key]} label={label(f)} rules={f.required ? [{ required: true, message: 'Обязательное поле' }] : undefined}>
            {f.type === 'enum' || f.type === 'yesno' ? <EnumInput f={f} facets={facets} /> : input(f)}
          </Form.Item>
        </Col>
      ))}
    </Row>
  );
}

/** Значение из списка существующих либо новое значение. */
function EnumInput({ f, facets, value, onChange }: { f: FieldDef; facets?: Record<string, { value: string | null }[]>; value?: string; onChange?: (v: string | null) => void }) {
  const opts = (facets?.[f.key] ?? []).filter((o) => o.value).map((o) => ({ value: o.value!, label: f.valueMap?.[o.value!] ? `${f.valueMap[o.value!]} (${o.value})` : o.value! }));
  if (value && !opts.some((o) => o.value === value)) opts.unshift({ value, label: value });
  return (
    <Select allowClear showSearch value={value ?? undefined} onChange={(v) => onChange?.(v ?? null)} options={opts}
      onSearch={(s) => { if (s && !opts.some((o) => o.value === s)) onChange?.(s); }} placeholder="Выберите или введите новое значение" />
  );
}

export function formToPayload(form: FormInstance) {
  const v = form.getFieldsValue(true);
  return { core: v.core ?? {}, attrs: v.attrs ?? {} };
}
