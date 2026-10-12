import { SearchOutlined } from '@ant-design/icons';
import { AutoComplete, Input } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useDebounced } from '../lib/hooks';
import { t } from '../lib/i18n';

interface SearchResult {
  total: number;
  groups: { category: string; short_name: string; name: string; count: number; items: { uid: string; name: string; address_raw: string | null; code: string | null }[] }[];
  addresses: { id: number; display: string; kind: string; count: number }[];
}

/** Поиск по всей системе: подсказки по разделам, Enter — полная страница результатов. */
export default function GlobalSearch() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const [res, setRes] = useState<SearchResult | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    if (dq.length < 2) {
      setRes(null);
      return;
    }
    let alive = true;
    api.get<SearchResult>(`/search?limit=5&q=${encodeURIComponent(dq)}`).then((r) => alive && setRes(r)).catch(() => alive && setRes(null));
    return () => {
      alive = false;
    };
  }, [dq]);

  const options = !res ? [] : [
    ...res.groups.map((g) => ({
      label: <span><b>{g.short_name}</b> <span className="muted">— найдено {g.count}</span></span>,
      options: g.items.map((i) => ({
        value: `obj:${i.uid}`,
        label: (
          <div style={{ whiteSpace: 'normal', lineHeight: 1.3 }}>
            <div>{i.name}</div>
            <div className="muted" style={{ fontSize: 12 }}>{i.uid}{i.address_raw ? ` · ${i.address_raw}` : ''}</div>
          </div>
        ),
      })),
    })),
    ...(res.addresses.length ? [{
      label: <b>Адреса</b>,
      options: res.addresses.map((a) => ({ value: `addr:${a.id}`, label: <span>{a.display} <span className="muted">({a.kind === 'building' ? 'здание' : 'территория'}, объектов: {a.count})</span></span> })),
    }] : []),
    ...(res.total ? [{ label: <span />, options: [{ value: `all:${dq}`, label: <span><SearchOutlined /> Все результаты ({res.total})</span> }] }] : []),
  ];

  return (
    <AutoComplete
      style={{ width: '100%' }}
      options={options}
      value={q}
      onChange={setQ}
      popupMatchSelectWidth={Math.min(560, window.innerWidth - 24)}
      notFoundContent={dq.length >= 2 && res && !res.total && !res.addresses.length ? 'Ничего не найдено' : null}
      onSelect={(v: string) => {
        if (v.startsWith('obj:')) nav(`/objects/${v.slice(4)}`);
        else if (v.startsWith('addr:')) nav(`/addresses/${v.slice(5)}`);
        else nav(`/search?q=${encodeURIComponent(v.slice(4))}`);
        setQ('');
      }}
    >
      <Input
        prefix={<SearchOutlined className="muted" />}
        placeholder={t('header.search')}
        allowClear
        onPressEnter={() => q.trim().length >= 2 && nav(`/search?q=${encodeURIComponent(q.trim())}`)}
        aria-label="Глобальный поиск"
      />
    </AutoComplete>
  );
}
