import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/Icon.jsx';
import { useLoad, Loading, ErrorBox } from '../components/ui.jsx';
import { fmtTS } from '../lib/format.js';

export default function NotificationsPage() {
  const { setUnread } = useAuth();
  const nav = useNavigate();
  const data = useLoad(() => api.get('/notifications'), []);
  const items = data.data?.items || [];
  const open = async (n) => {
    if (!n.read_at) { await api.post(`/notifications/${n.id}/read`).catch(() => {}); setUnread(Math.max(0, (data.data?.unread || 1) - 1)); }
    if (n.request_id) nav(`/requests/${n.request_id}`); else data.reload();
  };
  return (
    <>
      <div className="page-head">
        <div><h1>Notifications</h1><p>Status changes and reminders for requests you’re involved in. Copies are also sent by email.</p></div>
        {items.some((n) => !n.read_at) && <button className="btn" onClick={async () => { await api.post('/notifications/read-all'); setUnread(0); data.reload(); }}><Icon name="check" />Mark all as read</button>}
      </div>
      <ErrorBox error={data.error} />
      {data.loading && !data.data ? <Loading /> : (
        <div className="card notes">
          {items.length ? items.map((n) => (
            <button key={n.id} className={`note ${n.read_at ? '' : 'unread'}`} onClick={() => open(n)}>
              <span className="u" /><span><b>{n.title}</b><p>{n.message}</p></span><small>{fmtTS(n.created_at)}</small>
            </button>
          )) : <div className="empty">No notifications yet.</div>}
        </div>
      )}
    </>
  );
}
