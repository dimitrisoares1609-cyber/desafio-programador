import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { api, isoDate, longDate, money } from '../api.js';

const DAYS_AHEAD = 14;

function nextDays() {
  const today = new Date();
  const days = [];
  for (let i = 0; days.length < DAYS_AHEAD; i += 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    if (d.getDay() !== 0) days.push(d); // domingo fechado
  }
  return days;
}

export default function BookingPage() {
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState(null);
  const [choice, setChoice] = useState({ professional: null, service: null, date: null, time: null });
  const [slots, setSlots] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const days = useMemo(nextDays, []);

  useEffect(() => {
    api('/catalog').then(setCatalog).catch((err) => setError(err.message));
  }, []);

  const { professional, service, date, time } = choice;

  useEffect(() => {
    if (!professional || !service || !date) return;
    let alive = true;
    setSlots(null);
    api('/slots', { params: { date, professional_id: professional.id, service_id: service.id } })
      .then((data) => alive && setSlots(data.slots))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [professional, service, date, reload]);

  // Qualquer escolha anterior que mude invalida o horário já escolhido.
  const pick = (field, value) =>
    setChoice((c) => ({ ...c, [field]: value, ...(field !== 'time' && { time: null }) }));

  async function confirm() {
    setError('');
    setBusy(true);
    try {
      await api('/bookings', {
        method: 'POST',
        body: { professional_id: professional.id, service_id: service.id, date, time },
      });
      navigate('/');
    } catch (err) {
      setError(err.message);
      if (err.status === 409) {
        pick('time', null);
        setReload((n) => n + 1); // alguém pegou o horário antes: busca os livres de novo
      }
    } finally {
      setBusy(false);
    }
  }

  if (!catalog) {
    return (
      <div className="page">
        {error ? <p className="alert alert-error">{error}</p> : <p className="muted">Carregando…</p>}
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow mono">reservar horário</p>
          <h1>Monte seu horário.</h1>
        </div>
      </header>

      <div className="booking">
        <div className="booking-steps">
          <Step n="01" title="Profissional">
            <div className="pro-grid">
              {catalog.professionals.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`pro-card${professional?.id === p.id ? ' is-selected' : ''}`}
                  onClick={() => pick('professional', p)}
                  aria-pressed={professional?.id === p.id}
                >
                  <span className="pro-initials" style={{ background: p.color }}>{p.initials}</span>
                  <strong>{p.name}</strong>
                  <small>{p.specialty}</small>
                </button>
              ))}
            </div>
          </Step>

          <Step n="02" title="Serviço">
            <div className="service-list">
              {catalog.services.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`service-row${service?.id === s.id ? ' is-selected' : ''}`}
                  onClick={() => pick('service', s)}
                  aria-pressed={service?.id === s.id}
                >
                  <span>
                    <strong>{s.name}</strong>
                    <small>{s.description}</small>
                  </span>
                  <span className="service-meta mono">
                    {s.duration} min
                    <b>{money(s.price)}</b>
                  </span>
                </button>
              ))}
            </div>
          </Step>

          <Step n="03" title="Data">
            <div className="day-strip">
              {days.map((d) => {
                const iso = isoDate(d);
                return (
                  <button
                    key={iso}
                    type="button"
                    className={`day-chip${date === iso ? ' is-selected' : ''}`}
                    onClick={() => pick('date', iso)}
                    aria-pressed={date === iso}
                  >
                    <small className="mono">{d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}</small>
                    <strong>{d.getDate()}</strong>
                  </button>
                );
              })}
            </div>
          </Step>

          <Step n="04" title="Horário">
            {!(professional && service && date) && (
              <p className="muted">Escolha profissional, serviço e data para ver os horários livres.</p>
            )}
            {professional && service && date && slots === null && <p className="muted">Buscando horários…</p>}
            {slots?.length === 0 && <p className="muted">Sem horários livres nesse dia. Tente outra data.</p>}
            {slots?.length > 0 && (
              <div className="slot-grid">
                {slots.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`slot${time === t ? ' is-selected' : ''}`}
                    onClick={() => pick('time', t)}
                    aria-pressed={time === t}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </Step>
        </div>

        <aside className="summary">
          <p className="eyebrow mono">resumo</p>
          <dl>
            <dt>Profissional</dt>
            <dd>{professional?.name || '—'}</dd>
            <dt>Serviço</dt>
            <dd>{service ? `${service.name} · ${service.duration} min` : '—'}</dd>
            <dt>Quando</dt>
            <dd>{date ? `${longDate(date)}${time ? ` às ${time}` : ''}` : '—'}</dd>
          </dl>
          <p className="summary-total">
            <span>Total</span>
            <strong>{service ? money(service.price) : '—'}</strong>
          </p>
          {error && <p className="alert alert-error" role="alert">{error}</p>}
          <button
            type="button"
            className="button button-primary button-block"
            disabled={!time || busy}
            onClick={confirm}
          >
            <Check size={18} aria-hidden="true" /> {busy ? 'Reservando…' : 'Confirmar reserva'}
          </button>
        </aside>
      </div>
    </div>
  );
}

function Step({ n, title, children }) {
  return (
    <section className="step">
      <h2 className="step-title">
        <span className="mono">{n}</span> {title}
      </h2>
      {children}
    </section>
  );
}
