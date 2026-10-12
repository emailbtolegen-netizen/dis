import {
  AlertOutlined, ApartmentOutlined, AuditOutlined, BarChartOutlined, CloudUploadOutlined, DashboardOutlined, DatabaseOutlined,
  EnvironmentOutlined, HistoryOutlined, HomeOutlined, KeyOutlined, LogoutOutlined, MenuOutlined, SafetyOutlined, SettingOutlined,
  TableOutlined, TeamOutlined, ThunderboltOutlined, ToolOutlined, UserOutlined,
} from '@ant-design/icons';
import { Button, Drawer, Dropdown, Grid, Layout, Menu } from 'antd';
import type { MenuProps } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { useApi } from '../lib/hooks';
import { getLang, setLang, t } from '../lib/i18n';
import { useSession } from '../lib/session';
import GlobalSearch from './GlobalSearch';

const { Sider, Header, Content } = Layout;

function useMenuItems(): MenuProps['items'] {
  const { meta, can } = useSession();
  return useMemo(() => {
    const cats = meta?.categories ?? [];
    const byDomain = (d: string) => cats.filter((c) => c.domain === d);
    const catItem = (c: (typeof cats)[number]) => ({ key: `/c/${c.code}`, label: `${c.short_name}${c.count ? ` (${c.count})` : ''}` });
    const items: MenuProps['items'] = [
      { key: '/', icon: <DashboardOutlined />, label: t('menu.dashboard') },
      { key: '/registry', icon: <TableOutlined />, label: t('menu.registry') },
    ];
    if (byDomain('housing').length) items.push({ key: 'g-housing', icon: <HomeOutlined />, label: t('menu.housing'), children: byDomain('housing').map(catItem) });
    if (byDomain('energy').length) {
      items.push({
        key: 'g-energy', icon: <ThunderboltOutlined />, label: t('menu.energy'),
        children: [{ key: '/energy', label: t('menu.energyOverview') }, ...byDomain('energy').map(catItem), { key: '/energy/feeders', label: t('menu.feeders') }],
      });
    }
    if (byDomain('utilities').length) items.push({ key: 'g-utilities', icon: <ToolOutlined />, label: t('menu.utilities'), children: byDomain('utilities').map(catItem) });
    if (byDomain('other').length) items.push({ key: 'g-other', icon: <DatabaseOutlined />, label: 'Прочие объекты', children: byDomain('other').map(catItem) });
    items.push(
      { key: '/addresses', icon: <EnvironmentOutlined />, label: t('menu.addresses') },
      { key: '/map', icon: <ApartmentOutlined />, label: t('menu.map') },
    );
    if (can('quality.view')) items.push({ key: '/quality', icon: <AlertOutlined />, label: t('menu.quality') });
    const admin: NonNullable<MenuProps['items']> = [];
    if (can('import.manage')) admin.push({ key: '/admin/import', icon: <CloudUploadOutlined />, label: t('menu.import') }, { key: '/admin/imports', icon: <HistoryOutlined />, label: t('menu.imports') });
    if (can('users.manage')) admin.push({ key: '/admin/users', icon: <TeamOutlined />, label: t('menu.users') }, { key: '/admin/roles', icon: <SafetyOutlined />, label: t('menu.roles') });
    if (can('categories.manage')) admin.push({ key: '/admin/categories', icon: <BarChartOutlined />, label: t('menu.categories') });
    if (can('audit.view')) admin.push({ key: '/admin/audit', icon: <AuditOutlined />, label: t('menu.audit') });
    if (can('backup.manage')) admin.push({ key: '/admin/backups', icon: <DatabaseOutlined />, label: t('menu.backups') });
    if (can('settings.manage')) admin.push({ key: '/admin/settings', icon: <SettingOutlined />, label: t('menu.settings') });
    if (admin.length) items.push({ key: 'g-admin', icon: <SettingOutlined />, label: t('menu.admin'), children: admin });
    return items;
  }, [meta, can]);
}

function SideMenu({ onNavigate }: { onNavigate?: () => void }) {
  const items = useMenuItems();
  const nav = useNavigate();
  const loc = useLocation();
  const selected = loc.pathname.startsWith('/admin/imports') ? '/admin/imports' : loc.pathname;
  const group = loc.pathname.startsWith('/c/el_') || loc.pathname.startsWith('/energy') ? 'g-energy'
    : loc.pathname.startsWith('/admin') ? 'g-admin' : loc.pathname.startsWith('/c/') ? null : null;
  const [open, setOpen] = useState<string[]>(group ? [group] : []);
  const { cat } = useSession();
  useEffect(() => {
    const code = loc.pathname.startsWith('/c/') ? loc.pathname.slice(3) : null;
    const d = code ? cat(code)?.domain : null;
    const g = d ? `g-${d}` : group;
    if (g) setOpen((o) => (o.includes(g) ? o : [...o, g]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname]);
  return (
    <>
      <div className="app-logo">
        <div className="mark"><HomeOutlined style={{ color: '#fff' }} /></div>
        <div>
          <div className="t1">{t('appName')}</div>
          <div className="t2">Единая база объектов ЖКХ</div>
        </div>
      </div>
      <Menu
        theme="dark"
        mode="inline"
        items={items}
        selectedKeys={[selected]}
        openKeys={open}
        onOpenChange={(k) => setOpen(k as string[])}
        onClick={(e) => {
          nav(e.key);
          onNavigate?.();
        }}
      />
    </>
  );
}

export default function AppLayout() {
  const { user, reload } = useSession();
  const screens = Grid.useBreakpoint();
  const mobile = !screens.lg;
  const [drawer, setDrawer] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const { data: dash, reload: reloadStatus } = useApi<{ lastUpdate: string | null }>('/status');

  useEffect(() => {
    window.scrollTo(0, 0);
    reloadStatus();
  }, [loc.pathname, reloadStatus]);

  const userMenu: MenuProps['items'] = [
    { key: 'info', label: <div><b>{user?.full_name}</b><div className="muted">{user?.role_name} · {user?.login}</div></div>, disabled: true },
    { type: 'divider' },
    { key: 'pwd', icon: <KeyOutlined />, label: t('user.changePassword') },
    {
      key: 'lang', label: `${t('user.language')}: ${getLang() === 'ru' ? 'Русский' : 'Қазақша'}`,
      children: [{ key: 'lang-ru', label: 'Русский' }, { key: 'lang-kk', label: 'Қазақша (частично)' }],
    },
    { key: 'logout', icon: <LogoutOutlined />, label: t('user.logout'), danger: true },
  ];

  return (
    <Layout style={{ minHeight: '100%' }}>
      {!mobile && (
        <Sider width={256} style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}>
          <SideMenu />
        </Sider>
      )}
      <Drawer open={mobile && drawer} onClose={() => setDrawer(false)} placement="left" width={280} styles={{ body: { padding: 0, background: '#1b2a3a' }, header: { display: 'none' } }}>
        <SideMenu onNavigate={() => setDrawer(false)} />
      </Drawer>
      <Layout style={{ minWidth: 0 }}>
        <Header className="app-header">
          {mobile && <Button type="text" icon={<MenuOutlined />} onClick={() => setDrawer(true)} aria-label="Меню" />}
          <div className="search"><GlobalSearch /></div>
          <div style={{ flex: 'none', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="meta">{t('header.updated')}: {fmtDateTime(dash?.lastUpdate)}</span>
            <Dropdown
              menu={{
                items: userMenu,
                onClick: async ({ key }) => {
                  if (key === 'pwd') nav('/account/password');
                  if (key === 'lang-ru' || key === 'lang-kk') {
                    setLang(key === 'lang-ru' ? 'ru' : 'kk');
                    window.location.reload();
                  }
                  if (key === 'logout') {
                    await api.post('/auth/logout');
                    await reload();
                    nav('/');
                  }
                },
              }}
              trigger={['click']}
            >
              <Button icon={<UserOutlined />}>{screens.md ? user?.full_name : null}</Button>
            </Dropdown>
          </div>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
