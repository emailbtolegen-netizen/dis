import { InboxOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Form, InputNumber, Radio, Select, Space, Steps, Tag, Upload } from 'antd';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageTitle } from '../../components/common';
import { api } from '../../lib/api';
import { fmtBytes, fmtDateTime } from '../../lib/format';
import { useSession } from '../../lib/session';

const CORE_TARGETS = [
  ['name', 'Наименование'], ['address_raw', 'Адрес / местоположение'], ['code', 'Номер / код'], ['status', 'Состояние / статус'],
  ['balance_holder', 'Балансовая принадлежность'], ['year_built', 'Год постройки'], ['voltage', 'Напряжение, кВ'], ['power_kva', 'Мощность, кВА'],
  ['length_km', 'Протяжённость, км'], ['lat', 'Широта'], ['lon', 'Долгота'], ['notes', 'Примечания'],
];

/** Транслитерация заголовка в ключ поля (латиница, для новых атрибутов). */
function toKey(s: string): string {
  const map: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ы: 'y', э: 'e', ю: 'yu', я: 'ya', ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i' };
  const k = s.toLowerCase().split('').map((c) => map[c] ?? (/[a-z0-9]/.test(c) ? c : '_')).join('').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return (/^[a-z]/.test(k) ? k : 'f_' + k).slice(0, 40) || 'field';
}

export default function ImportWizard() {
  const { meta, cat } = useSession();
  const { message } = App.useApp();
  const nav = useNavigate();
  const [info, setInfo] = useState<any>(null);
  const [sheet, setSheet] = useState<string>('');
  const [profile, setProfile] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [headerRow, setHeaderRow] = useState<number>(1);
  const [category, setCategory] = useState<string>('');
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const sh = info?.sheets.find((s: any) => s.name === sheet);
  const header = useMemo(() => sh?.preview.find((r: any) => r.rowNo === headerRow)?.cells ?? [], [sh, headerRow]);
  const step = !info ? 0 : profile === 'generic' ? 2 : 1;

  const createPreview = async () => {
    setBusy(true);
    try {
      let options: any = {};
      if (profile === 'generic') {
        if (!category) throw new Error('Выберите категорию');
        const map: Record<string, string> = {};
        for (const [col, target] of Object.entries(mapping)) if (target && target !== 'skip') map[col] = target === 'attr:new' ? `attr:${toKey(header[Number(col)] ?? `col_${col}`)}` : target;
        options = { headerRow, category, mapping: map };
      }
      const r = await api.post('/admin/imports/preview', { sourceFileId: info.sourceFile.id, sheet, profile, options });
      nav(`/admin/imports/${r.id}`);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const targetOptions = (code: string) => {
    const c = cat(code);
    const attrs = (c?.fields ?? []).filter((f) => !f.core).map((f) => ({ value: `attr:${f.key}`, label: `Поле: ${f.label}` }));
    return [
      { value: 'skip', label: '— не импортировать —' },
      ...CORE_TARGETS.map(([v, l]) => ({ value: v, label: l })),
      ...attrs,
      { value: 'attr:new', label: '+ Дополнительное поле (по заголовку)' },
    ];
  };

  return (
    <>
      <PageTitle title="Импорт Excel" sub="Файл не меняет базу до подтверждения: сначала формируется отчёт о новых, изменённых, ошибочных и возможных дубликатах записях." extra={<Link to="/admin/imports">История импорта</Link>} />
      <Steps size="small" current={step} style={{ marginBottom: 16, maxWidth: 800 }} items={[{ title: 'Загрузка файла' }, { title: 'Выбор листа и формата' }, { title: 'Сопоставление столбцов' }, { title: 'Проверка и подтверждение' }]} />
      {!info && (
        <Card size="small" style={{ maxWidth: 800 }}>
          <Upload.Dragger
            accept=".xlsx,.xls,.xlsm,.csv"
            showUploadList={false}
            disabled={busy}
            customRequest={async ({ file }) => {
              setBusy(true);
              const fd = new FormData();
              fd.append('file', file as Blob);
              try {
                const r = await api.upload('/admin/imports/upload', fd);
                setInfo(r);
                const first = r.sheets.find((s: any) => s.detected.code !== 'generic') ?? r.sheets[0];
                setSheet(first.name);
                setProfile(first.detected.code);
              } catch (e) {
                message.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">Перетащите файл сюда или нажмите для выбора</p>
            <p className="ant-upload-hint">.xlsx, .xls, .xlsm, .csv — до 25 МБ. Формулы и макросы не выполняются.</p>
          </Upload.Dragger>
        </Card>
      )}
      {info && (
        <Card size="small" title={`Файл: ${info.sourceFile.file_name} (${fmtBytes(info.sourceFile.size)})`} extra={<Button onClick={() => { setInfo(null); setMapping({}); }}>Другой файл</Button>}>
          {info.sameFileImported.length > 0 && (
            <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Этот файл (по контрольной сумме) уже импортировался"
              description={info.sameFileImported.map((p: any) => `№${p.id}, лист «${p.sheet_name}», ${fmtDateTime(p.applied_at)}`).join('; ') + '. Повторный импорт не создаст дубликатов: записи будут отмечены как «без изменений».'} />
          )}
          <Form layout="vertical">
            <Form.Item label="Лист">
              <Radio.Group value={sheet} onChange={(e) => { setSheet(e.target.value); setProfile(info.sheets.find((s: any) => s.name === e.target.value).detected.code); setMapping({}); }}>
                <Space direction="vertical">
                  {info.sheets.map((s: any) => (
                    <Radio key={s.name} value={s.name}>«{s.name}» — {s.rowCount} строк · определён формат: <Tag color={s.detected.code === 'generic' ? 'default' : 'blue'}>{s.detected.name}</Tag></Radio>
                  ))}
                </Space>
              </Radio.Group>
            </Form.Item>
            <Form.Item label="Формат разбора">
              <Select style={{ maxWidth: 520 }} value={profile} onChange={setProfile} options={info.profiles.map((p: any) => ({ value: p.code, label: p.name }))} />
            </Form.Item>
          </Form>
          {sh && (
            <>
              <div className="muted" style={{ marginBottom: 4 }}>Первые строки листа (номера строк как в Excel){profile === 'generic' ? '; строка заголовков выделена' : ''}:</div>
              <div className="preview-grid">
                <table>
                  <thead><tr><th>#</th>{Array.from({ length: sh.width }, (_, i) => <th key={i}>{String.fromCharCode(65 + (i % 26))}{i >= 26 ? Math.floor(i / 26) : ''}</th>)}</tr></thead>
                  <tbody>
                    {sh.preview.map((r: any) => (
                      <tr key={r.rowNo} className={profile === 'generic' && r.rowNo === headerRow ? 'header-row' : ''}>
                        <th>{r.rowNo}</th>
                        {r.cells.map((c: any, i: number) => <td key={i} title={c ?? ''}>{c ?? ''}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {profile === 'generic' && sh && (
            <Card size="small" type="inner" title="Сопоставление столбцов" style={{ marginTop: 12 }}>
              <Space wrap style={{ marginBottom: 12 }}>
                <span>Строка заголовков:</span>
                <InputNumber min={sh.firstRow} max={sh.firstRow + sh.preview.length - 1} value={headerRow} onChange={(v) => { setHeaderRow(Number(v)); setMapping({}); }} />
                <span>Категория:</span>
                <Select style={{ width: 320 }} value={category || undefined} placeholder="В какой раздел импортировать" onChange={(v) => { setCategory(v); setMapping({}); }}
                  options={meta?.categories.map((c) => ({ value: c.code, label: c.name }))} />
                <Link to="/admin/categories">Создать новую категорию</Link>
              </Space>
              {category && header.map((h: string | null, i: number) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{ width: 260 }}><Tag>{String.fromCharCode(65 + (i % 26))}</Tag>{h ?? <span className="muted">(без заголовка)</span>}</span>
                  <Select style={{ width: 320 }} value={mapping[i] ?? 'skip'} onChange={(v) => setMapping({ ...mapping, [i]: v })} options={targetOptions(category)} showSearch optionFilterProp="label" />
                </div>
              ))}
              <Alert type="info" showIcon style={{ marginTop: 8 }} message="Ключ сопоставления при повторном импорте: наименование + адрес. Исходная строка сохраняется полностью, включая несопоставленные столбцы." />
            </Card>
          )}
          <Button type="primary" style={{ marginTop: 16 }} loading={busy} disabled={!sheet || !profile} onClick={createPreview}>Проверить и сформировать отчёт</Button>
        </Card>
      )}
    </>
  );
}
