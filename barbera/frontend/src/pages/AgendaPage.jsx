import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarClock, CalendarPlus, Clock, X } from 'lucide-react';
import { api, isUpcoming, longDate, money, shortDate } from '../api.js';
import { useAuth } from '../App.jsx';

export default function AgendaPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/bookings').then(setBookings).catch((err) => setError(err.message));
  }, []);

  async function cancel(booking) {
    if (!window.confirm(`Cancelar ${booking.service_name} em ${longDate(booking.date)} às ${booking.time}?`)) return;
    try {
      const updated = await api(`/bookings/${booking.id}`, { method: 'PATCH', body: { status: 'cancelled' } });
      setBookings((list) => list.map((b) => (b.id === updated.id ? updated : b)));
    } catch (err) {
      setError(err.message);
    }
  }

  const reschedule = (booking) => navigate('/reservar', { state: { reschedule: booking } });

  const upcoming = (bookings || []).filter(isUpcoming).reverse();
  const history = (bookings || []).filter((b) => !isUpcoming(b));
  const [next, ...later] = upcoming;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow mono">minha agenda</p>
          <h1>Olá, {user.name.split(' ')[0]}.</h1>
        </div>
        <Link to="/reservar" className="button button-primary">
          <CalendarPlus size={18} aria-hidden="true" /> Reservar horário
        </Link>
      </header>

      {user.subscription && (
        <p className="alert alert-info">
          Plano <strong>{user.subscription.plan_name}</strong>
          {user.subscription.status === 'demo' && ' (demonstrativo)'}
          {user.subscription.status === 'pending' && ' · aguardando confirmação do pagamento'}
        </p>
      )}
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {bookings === null && !error && <p className="muted">Carregando reservas…</p>}

      {bookings && !next && (
        <section className="empty">
          <p className="serif">Nenhum horário marcado por enquanto.</p>
          <Link to="/reservar" className="link-button">Escolher profissional e horário →</Link>
        </section>
      )}

      {next && (
        <section className="next-card">
          <p className="eyebrow mono">próximo horário</p>
          <div className="next-main">
            <span className="next-time">{next.time}</span>
            <div>
              <h2>{next.service_name}</h2>
              <p className="next-meta">
                {longDate(next.date)} · com {next.professional_name}
              </p>
            </div>
          </div>
          <div className="next-footer">
            <span className="mono">{next.duration} min · {money(next.price)}</span>
            <span className="next-actions">
              <button type="button" className="button button-ghost-light" onClick={() => reschedule(next)}>
                <CalendarClock size={16} aria-hidden="true" /> Remarcar
              </button>
              <button type="button" className="button button-ghost-light" onClick={() => cancel(next)}>
                <X size={16} aria-hidden="true" /> Cancelar
              </button>
            </span>
          </div>
        </section>
      )}

      {later.length > 0 && (
        <section className="section">
          <h3 className="section-title">Próximas reservas</h3>
          <ul className="timeline">
            {later.map((b) => (
              <BookingRow key={b.id} booking={b} onCancel={() => cancel(b)} onReschedule={() => reschedule(b)} />
            ))}
          </ul>
        </section>
      )}

      {history.length > 0 && (
        <section className="section">
          <h3 className="section-title">Histórico</h3>
          <ul className="timeline">
            {history.map((b) => (
              <BookingRow key={b.id} booking={b} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function BookingRow({ booking, onCancel, onReschedule }) {
  const cancelled = booking.status === 'cancelled';
  return (
    <li className={`timeline-row${cancelled ? ' is-cancelled' : ''}`}>
      <span className="timeline-date mono">{shortDate(booking.date)}</span>
      <span className="timeline-time">
        <Clock size={14} aria-hidden="true" /> {booking.time}
      </span>
      <span className="timeline-body">
        <strong>{booking.service_name}</strong>
        <small>{booking.professional_name}</small>
      </span>
      <span className="timeline-end">
        {cancelled ? (
          <span className="tag tag-muted">cancelada</span>
        ) : onCancel ? (
          <span className="row-actions">
            <button type="button" className="link-button" onClick={onReschedule}>Remarcar</button>
            <button type="button" className="link-button" onClick={onCancel}>Cancelar</button>
          </span>
        ) : (
          <span className="tag">concluída</span>
        )}
      </span>
    </li>
  );
}
