import { Spin } from 'antd';
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import { useSession } from './lib/session';
import AddressCard from './pages/AddressCard';
import Addresses from './pages/Addresses';
import ChangePassword from './pages/ChangePassword';
import Dashboard from './pages/Dashboard';
import EnergyOverview from './pages/EnergyOverview';
import Feeders from './pages/Feeders';
import Login from './pages/Login';
import MapPage from './pages/MapPage';
import NotFound from './pages/NotFound';
import ObjectCard from './pages/ObjectCard';
import ObjectNew from './pages/ObjectNew';
import PublicPortal from './pages/PublicPortal';
import Quality from './pages/Quality';
import Registry from './pages/Registry';
import SearchPage from './pages/SearchPage';
import Audit from './pages/admin/Audit';
import Backups from './pages/admin/Backups';
import Categories from './pages/admin/Categories';
import ImportDetail from './pages/admin/ImportDetail';
import ImportList from './pages/admin/ImportList';
import ImportWizard from './pages/admin/ImportWizard';
import Roles from './pages/admin/Roles';
import Settings from './pages/admin/Settings';
import Users from './pages/admin/Users';

function Guard({ perm, children }: { perm: string; children: React.ReactNode }) {
  const { can } = useSession();
  return can(perm) ? <>{children}</> : <NotFound forbidden />;
}

export default function App() {
  const { user, loading, meta } = useSession();
  if (loading) return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><Spin size="large" /></div>;
  return (
    <Routes>
      <Route path="/public" element={<PublicPortal />} />
      {!user ? (
        <Route path="*" element={<Login />} />
      ) : user.must_change_password ? (
        <Route path="*" element={<ChangePassword forced />} />
      ) : !meta ? (
        <Route path="*" element={<div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><Spin size="large" /></div>} />
      ) : (
        <Route element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="registry" element={<Registry />} />
          <Route path="c/:category" element={<Registry />} />
          <Route path="objects/new" element={<Guard perm="objects.edit"><ObjectNew /></Guard>} />
          <Route path="objects/:uid" element={<ObjectCard />} />
          <Route path="energy" element={<EnergyOverview />} />
          <Route path="energy/feeders" element={<Feeders />} />
          <Route path="addresses" element={<Addresses />} />
          <Route path="addresses/:id" element={<AddressCard />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="map/housing" element={<MapPage key="housing" mode="housing" />} />
          <Route path="map/emergency" element={<MapPage key="emergency" mode="emergency" />} />
          <Route path="map" element={<MapRedirect />} />
          <Route path="quality" element={<Guard perm="quality.view"><Quality /></Guard>} />
          <Route path="account/password" element={<ChangePassword />} />
          <Route path="admin/import" element={<Guard perm="import.manage"><ImportWizard /></Guard>} />
          <Route path="admin/imports" element={<Guard perm="import.manage"><ImportList /></Guard>} />
          <Route path="admin/imports/:id" element={<Guard perm="import.manage"><ImportDetail /></Guard>} />
          <Route path="admin/users" element={<Guard perm="users.manage"><Users /></Guard>} />
          <Route path="admin/roles" element={<Guard perm="users.manage"><Roles /></Guard>} />
          <Route path="admin/categories" element={<Guard perm="categories.manage"><Categories /></Guard>} />
          <Route path="admin/audit" element={<Guard perm="audit.view"><Audit /></Guard>} />
          <Route path="admin/backups" element={<Guard perm="backup.manage"><Backups /></Guard>} />
          <Route path="admin/settings" element={<Guard perm="settings.manage"><Settings /></Guard>} />
          <Route path="login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      )}
    </Routes>
  );
}

/** Старые ссылки /map?category=… ведут на соответствующую карту. */
function MapRedirect() {
  const [sp] = useSearchParams();
  return <Navigate replace to={sp.get('category') === 'mkd_emergency' ? '/map/emergency' : '/map/housing'} />;
}
