import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, roleHelpers } from './auth.jsx';
import { Icon } from './components/Icon.jsx';
import { Loading, initials } from './components/ui.jsx';
import { ROLE_LABELS } from '@domain/constants.js';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import WizardPage from './pages/WizardPage.jsx';
import RequestDetailPage from './pages/RequestDetailPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import HelpPage from './pages/HelpPage.jsx';
import ChangePasswordPage from './pages/ChangePasswordPage.jsx';
import SetPasswordPage from './pages/SetPasswordPage.jsx';
import { useBranding } from './branding.jsx';
import { BrandBlock, ContactMenu } from './components/Brand.jsx';

export default function App() {
  const { loading, user, options } = useAuth();
  const { pathname } = useLocation();
  if (pathname === '/set-password') return <SetPasswordPage />;
  if (loading) return <Loading />;
  if (!user) return <LoginPage />;
  if (user.mustChangePassword) return <ChangePasswordPage forced />;
  const h = roleHelpers(user);
  const home = h.usesRequests ? '/' : '/admin';
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={h.usesRequests ? <DashboardPage /> : <Navigate to="/admin" replace />} />
        <Route path="requests/new" element={h.isClinicStaff ? <WizardPage /> : <Navigate to={home} replace />} />
        <Route path="requests/:id/edit" element={<WizardPage />} />
        <Route path="requests/:id" element={<RequestDetailPage />} />
        <Route path="reports" element={h.usesRequests ? <ReportsPage /> : <Navigate to={home} replace />} />
        <Route path="admin/*" element={h.isAdmin ? <AdminPage /> : <Navigate to={home} replace />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="help" element={<HelpPage />} />
        <Route path="account/password" element={user.hasLocalPassword && options?.local ? <ChangePasswordPage /> : <Navigate to={home} replace />} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}

function Layout() {
  const { user, unread, logout, mode, options } = useAuth();
  const brand = useBranding();
  const h = roleHelpers(user);
  const loc = useLocation();
  const onRequests = loc.pathname === '/' || loc.pathname.startsWith('/requests');
  const nav = [
    ...(h.usesRequests ? [{ to: '/', label: h.isClinicStaff ? 'My Requests' : 'Work Queue', icon: 'list', on: onRequests }] : []),
    ...(h.usesRequests ? [{ to: '/reports', label: 'Reports', icon: 'chart' }] : []),
    ...(h.isAdmin ? [{ to: '/admin', label: 'Admin Settings', icon: 'gear' }] : []),
    { to: '/help', label: 'Help', icon: 'help' },
  ];
  const roleText = user.roles.map((r) => ROLE_LABELS[r]).join(', ');
  const clinicText = user.loginClinic?.name || '';
  return (
    <>
      <header className={`top ${brand.enabled && (brand.logoUrl || brand.companyName) ? 'branded' : ''}`}>
        <div className="wrap top-in">
          <NavLink to={h.usesRequests ? '/' : '/admin'} className="brand" style={{ textDecoration: 'none' }} aria-label={`${brand.enabled && brand.companyName ? `${brand.companyName} — ` : ''}${brand.portalTitle}, home`}>
            <BrandBlock b={brand} />
          </NavLink>
          <nav className="nav" aria-label="Main">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === '/'} style={{ textDecoration: 'none' }} title={n.label}
                className={({ isActive }) => `nav-btn ${isActive || n.on ? 'on' : ''}`}>
                <Icon name={n.icon} /><span>{n.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="top-right">
            <ContactMenu b={brand} />
            <NavLink to="/notifications" className="icon-btn" aria-label={`Notifications, ${unread} unread`}>
              <Icon name="bell" size={20} />{unread > 0 && <span className="dot">{unread}</span>}
            </NavLink>
            <div className="who">
              <span className="av" title={`${user.name} — ${roleText}${clinicText ? ` · ${clinicText}` : ''}`}>{initials(user.name)}</span>
              <span className="who-t"><b>{user.name}</b><small>{roleText}{clinicText ? ` · ${clinicText}` : ''}</small></span>
            </div>
            {user.hasLocalPassword && options?.local && <NavLink to="/account/password" className="btn sm on-dark ghost" style={{ textDecoration: 'none' }}>Password</NavLink>}
            <button className="btn sm on-dark ghost" onClick={logout}>Sign out</button>
          </div>
        </div>
      </header>
      {mode === 'dev' && <div className="proto-bar">Development sign-in is on. Set AUTH_MODE=standard before go-live, after setting up Admin Settings → Sign-in & Directory.</div>}
      <main className="wrap"><Outlet /></main>
    </>
  );
}
