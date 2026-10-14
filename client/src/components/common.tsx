import { LockOutlined } from '@ant-design/icons';
import { Alert, Empty, Spin, Tag, Tooltip } from 'antd';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { fmtNum } from '../lib/format';
import type { FieldDef } from '../lib/session';

export function PageTitle({ title, sub, extra }: { title: ReactNode; sub?: ReactNode; extra?: ReactNode }) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {extra && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{extra}</div>}
    </div>
  );
}

export function Loading({ error, loading, children }: { error?: string | null; loading?: boolean; children?: ReactNode }) {
  if (error) return <Alert type="error" showIcon message="Не удалось загрузить данные" description={error} />;
  if (loading && !children) return <div style={{ padding: 48, textAlign: 'center' }}><Spin /></div>;
  return <>{children}</>;
}

export function NoData({ text = 'Нет данных' }: { text?: string }) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={text} />;
}

/** Значение поля с учётом типа, единиц и расшифровки исходного значения. */
export function FieldValue({ def, value, hidden }: { def?: FieldDef; value: unknown; hidden?: boolean }) {
  if (hidden) return <Tooltip title="Конфиденциальное поле: недостаточно прав для просмотра"><span className="muted"><LockOutlined /> скрыто</span></Tooltip>;
  if (value == null || value === '') return <span className="muted">Не указано</span>;
  if (typeof value === 'number') {
    const unit = def?.unit ? ` ${def.unit}` : '';
    const isYear = def?.key === 'year_built' || def?.key === 'program_year';
    return <span className="num">{isYear ? value : def?.unit === '₸' ? value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : fmtNum(value)}{unit}</span>;
  }
  const s = String(value);
  const mapped = def?.valueMap?.[s];
  if (mapped && mapped !== s) return <Tooltip title={`Исходное значение: «${s}»`}><span>{mapped}</span></Tooltip>;
  return <span style={{ whiteSpace: 'pre-wrap' }}>{s}</span>;
}

export function ObjectLink({ uid, name }: { uid: string; name?: string | null }) {
  return <Link to={`/objects/${uid}`}>{name || uid}</Link>;
}

const STATUS_COLORS: Record<string, string> = {
  'Лифты работают': 'green',
  'Часть лифтов не работает': 'orange',
  'Есть неработающие лифты (по описанию)': 'orange',
  'Все лифты не работают': 'red',
  'Лифт отсутствует (демонтирован)': 'red',
  'Состояние не указано': 'default',
  'В работе': 'green',
  'Недействующий': 'default',
  'Работы завершены': 'green',
  'Работы не завершены': 'orange',
};

export function StatusTag({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="muted">Не указано</span>;
  return <Tag color={STATUS_COLORS[status] ?? 'blue'} style={{ whiteSpace: 'normal' }}>{status}</Tag>;
}

export const SEVERITY: Record<string, { color: string; label: string }> = {
  error: { color: 'red', label: 'Ошибка' },
  warning: { color: 'orange', label: 'Предупреждение' },
  info: { color: 'blue', label: 'Информация' },
};

export function SeverityTag({ level }: { level: string }) {
  const s = SEVERITY[level] ?? SEVERITY.info;
  return <Tag color={s.color}>{s.label}</Tag>;
}

export function Kpi({ label, value, hint, onClick }: { label: ReactNode; value: ReactNode; hint?: ReactNode; onClick?: () => void }) {
  return (
    <div className={`ant-card ant-card-bordered kpi${onClick ? ' clickable' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => { if (onClick && (e.key === 'Enter' || e.key === ' ')) onClick(); }}>
      <div className="ant-card-body">
        <div className="label">{label}</div>
        <div className="value">{value}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
    </div>
  );
}
