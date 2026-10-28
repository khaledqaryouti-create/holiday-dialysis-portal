// "Requests | Patients" switch shown at the top of My Requests and the Patients page.
import { NavLink } from 'react-router-dom';
import { Icon } from './Icon.jsx';
import { t } from '../terms.jsx';

export default function RequestsTabs() {
  return (
    <nav className="subnav" aria-label="My Requests sections">
      <NavLink to="/" end className={({ isActive }) => (isActive ? 'on' : '')}><Icon name="list" size={16} />{t('nav.requestsTab')}</NavLink>
      <NavLink to="/patients" className={({ isActive }) => (isActive ? 'on' : '')}><Icon name="users" size={16} />{t('nav.patients')}</NavLink>
    </nav>
  );
}
