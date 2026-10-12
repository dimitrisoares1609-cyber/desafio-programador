import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, isUpcoming, longDate, money } from '../api.js';

const SUB_LABEL = { demo: 'demonstrativo', pending: 'pendente', active: 'ativo', cancelled: 'cancelado' };

export default function AdminPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    api('/admin/overview').then(setData).catch((err) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  if (!data) {
    return (
      <div className="page">
        {error ? <p className="alert alert-error">{error}</p> : <p className="muted">Carregando…</p>}
      </div>
    );
  }

  const bookings = showAll ? data.bookings : data.bookings.filter(isUpcoming);
  const byDate = bookings.reduce((acc, b) => ({ ...acc, [b.date]: [...(acc[b.date] || []), b] }), {});

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow mono">visão da equipe</p>
          <h1>A casa hoje.</h1>
        </div>
      </header>

      <div className="stats">
        <Stat label="Clientes" value={data.stats.clients} />
        <Stat label="Reservas ativas" value={data.stats.bookings} />
        <Stat label="Profissionais" value={data.stats.professionals} />
        <Stat label="Receita reservada" value={money(data.stats.revenue)} />
      </div>

      <section className="section">
        <div className="section-head">
          <h3 className="section-title">Agenda geral</h3>
          <label className="toggle">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            incluir passadas e canceladas
          </label>
        </div>
        {bookings.length === 0 && <p className="muted">Nenhuma reserva para mostrar.</p>}
        {Object.entries(byDate).map(([date, list]) => (
          <div key={date} className="agenda-day">
            <h4 className="agenda-date">{longDate(date)}</h4>
            <ul className="timeline">
              {list.map((b) => (
                <li key={b.id} className={`timeline-row${b.status === 'cancelled' ? ' is-cancelled' : ''}`}>
                  <span className="timeline-date mono">{b.time}</span>
                  <span className="timeline-body">
                    <strong>{b.user_name}</strong>
                    <small>{b.service_name} · {b.professional_name}</small>
                  </span>
                  <span className="timeline-end mono">
                    {b.status === 'cancelled' ? 'cancelada' : money(b.price)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="section">
        <h3 className="section-title">Assinaturas</h3>
        {data.subscriptions.length === 0 ? (
          <p className="muted">Nenhum cliente assinou ainda.</p>
        ) : (
          <ul className="timeline">
            {data.subscriptions.map((s) => (
              <li key={s.id} className="timeline-row">
                <span className="timeline-body">
                  <strong>{s.name}</strong>
                  <small>{s.email}</small>
                </span>
                <span className="timeline-end">
                  {s.subscription.plan_name}{' '}
                  <span className="tag">{SUB_LABEL[s.subscription.status] || s.subscription.status}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="admin-columns">
        <section className="section">
          <h3 className="section-title">Profissionais</h3>
          <ul className="plain-list">
            {data.professionals.map((p) => (
              <li key={p.id}>
                <span className="pro-initials pro-initials-sm" style={{ background: p.color }}>{p.initials}</span>
                <span>
                  <strong>{p.name}</strong>
                  <small>{p.specialty}</small>
                </span>
              </li>
            ))}
          </ul>
          <AddForm
            title="Adicionar profissional"
            endpoint="/admin/professionals"
            onDone={load}
            fields={[
              { name: 'name', label: 'Nome' },
              { name: 'specialty', label: 'Especialidade' },
              { name: 'initials', label: 'Iniciais', maxLength: 3 },
              { name: 'color', label: 'Cor', type: 'color', initial: '#356859' },
            ]}
          />
        </section>

        <section className="section">
          <h3 className="section-title">Serviços</h3>
          <ul className="plain-list">
            {data.services.map((s) => (
              <li key={s.id}>
                <span>
                  <strong>{s.name}</strong>
                  <small>{s.duration} min · {s.description}</small>
                </span>
                <span className="mono">{money(s.price)}</span>
              </li>
            ))}
          </ul>
          <AddForm
            title="Adicionar serviço"
            endpoint="/admin/services"
            onDone={load}
            fields={[
              { name: 'name', label: 'Nome' },
              { name: 'duration', label: 'Duração (min)', type: 'number', min: 10, max: 240 },
              { name: 'price', label: 'Preço (R$)', type: 'number', min: 0, step: '0.01' },
              { name: 'description', label: 'Descrição', optional: true },
            ]}
          />
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span className="mono">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AddForm({ title, endpoint, fields, onDone }) {
  const blank = Object.fromEntries(fields.map((f) => [f.name, f.initial ?? '']));
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    const body = Object.fromEntries(
      fields.map((f) => [f.name, f.type === 'number' ? Number(form[f.name]) : form[f.name].trim()]),
    );
    try {
      await api(endpoint, { method: 'POST', body });
      setForm(blank);
      setOpen(false);
      onDone();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!open) {
    return (
      <button type="button" className="button button-outline" onClick={() => setOpen(true)}>
        <Plus size={16} aria-hidden="true" /> {title}
      </button>
    );
  }

  return (
    <form className="add-form" onSubmit={submit}>
      {fields.map((f) => (
        <label key={f.name} className="field">
          <span>{f.label}</span>
          <input
            type={f.type || 'text'}
            value={form[f.name]}
            onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
            required={!f.optional}
            min={f.min}
            max={f.max}
            step={f.step}
            maxLength={f.maxLength}
          />
        </label>
      ))}
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <div className="add-form-actions">
        <button className="button button-primary">Salvar</button>
        <button type="button" className="link-button" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </form>
  );
}
