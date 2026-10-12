import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { CalendarDays, CalendarPlus, Crown, LayoutDashboard, LogOut, Scissors } from 'lucide-react';
import { api } from './api.js';
import AuthPage from './pages/AuthPage.jsx';
import AgendaPage from './pages/AgendaPage.jsx';
import BookingPage from './pages/BookingPage.jsx';
import PlansPage from './pages/PlansPage.jsx';
import AdminPage from './pages/AdminPage.jsx';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser(await api('/auth/me'));
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="splash" aria-busy="true">
        <Brand />
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, setUser, refresh }}>
      {user ? <Shell /> : <AuthPage />}
    </AuthContext.Provider>
  );
}

function Brand() {
  return (
    <span className="brand">
      <Scissors size={18} strokeWidth={2.2} aria-hidden="true" />
      Barbera
    </span>
  );
}

function Shell() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user.role === 'admin';

  const links = [
    { to: '/', label: 'Minha agenda', short: 'Agenda', icon: CalendarDays },
    { to: '/reservar', label: 'Reservar horário', short: 'Reservar', icon: CalendarPlus },
    { to: '/planos', label: 'Planos mensais', short: 'Planos', icon: Crown },
    ...(isAdmin ? [{ to: '/equipe', label: 'Visão da equipe', short: 'Equipe', icon: LayoutDashboard }] : []),
  ];

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      navigate('/');
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand />
        <p className="sidebar-quote">“Um bom corte é um compromisso consigo mesmo.”</p>
        <nav className="nav" aria-label="Principal">
          {links.map(({ to, label, short, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className="nav-link">
              <Icon size={18} aria-hidden="true" />
              <span className="nav-long">{label}</span>
              <span className="nav-short">{short}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-user">
          <span className="avatar" aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span>
          <span className="sidebar-user-text">
            <strong>{user.name}</strong>
            <small className="mono">{isAdmin ? 'equipe' : user.subscription?.plan_name || 'cliente'}</small>
          </span>
          <button type="button" className="icon-button" onClick={logout} aria-label="Sair" title="Sair">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className="content">
        <Routes>
          <Route path="/" element={<AgendaPage />} />
          <Route path="/reservar" element={<BookingPage />} />
          <Route path="/planos" element={<PlansPage />} />
          <Route path="/equipe" element={isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
