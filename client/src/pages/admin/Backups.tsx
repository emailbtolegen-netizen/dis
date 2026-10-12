import { CloudDownloadOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Input, Modal, Table } from 'antd';
import { useState } from 'react';
import { Loading, PageTitle } from '../../components/common';
import { api } from '../../lib/api';
import { fmtBytes, fmtDateTime } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';

const KIND: [RegExp, string][] = [
  [/-manual/, 'вручную'], [/-scheduled/, 'плановая'], [/before-import/, 'перед импортом'], [/before-rollback/, 'перед откатом'],
  [/before-restore/, 'перед восстановлением'], [/-cli/, 'из командной строки'],
];

export default function Backups() {
  const { data, error, loading, reload } = useApi<any>('/admin/backups');
  const { reloadMeta } = useSession();
  const { message } = App.useApp();
  const [restore, setRestore] = useState<string | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <PageTitle title="Резервные копии базы данных" sub={data ? `Плановое копирование: каждые ${data.intervalHours} ч; хранится автоматических копий: ${data.keep}. Каталог на сервере: ${data.dir}.` : ''}
        extra={<Button type="primary" icon={<PlusOutlined />} loading={busy} onClick={async () => { setBusy(true); try { const r = await api.post('/admin/backups'); message.success(`Создана копия ${r.name}`); reload(); } catch (e) { message.error((e as Error).message); } finally { setBusy(false); } }}>Создать копию сейчас</Button>} />
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Копия содержит всю базу: объекты, историю, пользователей, журнал. Загруженные документы и фото (папка data/attachments) и исходные Excel-файлы (data/uploads) копируются отдельно средствами сервера — см. инструкцию BACKUP.md." />
      <Loading error={error} loading={loading}>
        <Card size="small">
          <Table size="small" rowKey="name" dataSource={data?.items ?? []} scroll={{ x: 800 }} pagination={{ pageSize: 30 }}
            columns={[
              { title: 'Файл', dataIndex: 'name', render: (v) => <span className="mono">{v}</span> },
              { title: 'Тип', dataIndex: 'name', width: 190, render: (v: string) => KIND.find(([re]) => re.test(v))?.[1] ?? '' },
              { title: 'Создана', dataIndex: 'created_at', width: 170, render: fmtDateTime },
              { title: 'Размер', dataIndex: 'size', width: 100, align: 'right', render: fmtBytes },
              { title: '', width: 230, render: (_, r: any) => (
                <>
                  <Button size="small" icon={<CloudDownloadOutlined />} href={`/api/admin/backups/${encodeURIComponent(r.name)}`}>Скачать</Button>
                  <Button size="small" danger style={{ marginLeft: 6 }} onClick={() => { setRestore(r.name); setConfirm(''); }}>Восстановить</Button>
                </>
              ) },
            ]} />
        </Card>
      </Loading>
      <Modal open={!!restore} title="Восстановление базы из резервной копии" okText="Восстановить" okButtonProps={{ danger: true, disabled: confirm !== 'ВОССТАНОВИТЬ', loading: busy }} cancelText="Отмена" onCancel={() => setRestore(null)}
        onOk={async () => {
          setBusy(true);
          try {
            const r = await api.post(`/admin/backups/${encodeURIComponent(restore!)}/restore`, { confirm });
            message.success(`База восстановлена. Текущее состояние перед восстановлением сохранено в копии ${r.safetyCopy}`, 8);
            setRestore(null);
            reloadMeta();
            reload();
          } catch (e) {
            message.error((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}>
        <Alert type="warning" showIcon message={`Все данные будут заменены состоянием из копии «${restore}». Изменения, сделанные после её создания, пропадут (текущее состояние автоматически сохраняется отдельной копией).`} />
        <p style={{ marginTop: 12 }}>Для подтверждения введите слово <b>ВОССТАНОВИТЬ</b>:</p>
        <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Modal>
    </>
  );
}
