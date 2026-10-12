import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, X } from 'lucide-react';
import { api, isUpcoming, longDate, money, parseIso } from '../api.js';

const SUB_LABEL = { demo: 'demonstrativo', pending: 'pendente', active: 'ativo', cancelled: 'cancelado' };
const WEEKDAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const HALF_HOURS = Array.from({ length: 48 }, (_, i) =>
  `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`,
);

const PROFESSIONAL_FIELDS = [
  { name: 'name', label: 'Nome' },
  { name: 'specialty', label: 'Especialidade' },
  { name: 'initials', label: 'Iniciais', maxLength: 3 },
  { name: 'color', label: 'Cor', type: 'color', initial: '#356859' },
];
const SERVICE_FIELDS = [
  { name: 'name', label: 'Nome' },
  { name: 'duration', label: 'Duração (min)', type: 'number', min: 10, max: 240 },
  { name: 'price', label: 'Preço (R$)', type: 'number', min: 0, step: '0.01' },
  { name: 'description', label: 'Descrição', optional: true },
];

export default function AdminPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    api('/admin/overview').then(setData).catch((err) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  async function cancelBooking(b) {
    if (!window.confirm(`Cancelar a reserva de ${b.user_name} em ${longDate(b.date)} às ${b.time}?`)) return;
    try {
      await api(`/bookings/${b.id}`, { method: 'PATCH', body: { status: 'cancelled' } });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

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

      {error && <p className="alert alert-error" role="alert">{error}</p>}

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
                    {b.status === 'cancelled' ? (
                      'cancelada'
                    ) : (
                      <span className="row-actions">
                        {money(b.price)}
                        {isUpcoming(b) && (
                          <button type="button" className="link-button" onClick={() => cancelBooking(b)}>
                            Cancelar
                          </button>
                        )}
                      </span>
                    )}
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

      <HoursEditor initial={data.hours} onSaved={load} />

      <div className="admin-columns">
        <CatalogSection
          title="Profissionais"
          noun="profissional"
          endpoint="/admin/professionals"
          items={data.professionals}
          fields={PROFESSIONAL_FIELDS}
          onChange={load}
          render={(p) => (
            <>
              <span className="pro-initials pro-initials-sm" style={{ background: p.color }}>{p.initials}</span>
              <span className="item-text">
                <strong>{p.name}</strong>
                <small>{p.specialty}</small>
              </span>
            </>
          )}
        />
        <CatalogSection
          title="Serviços"
          noun="serviço"
          endpoint="/admin/services"
          items={data.services}
          fields={SERVICE_FIELDS}
          onChange={load}
          render={(s) => (
            <span className="item-text">
              <strong>{s.name} · {money(s.price)}</strong>
              <small>{s.duration} min{s.description ? ` · ${s.description}` : ''}</small>
            </span>
          )}
        />
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

function CatalogSection({ title, noun, endpoint, items, fields, render, onChange }) {
  const [editing, setEditing] = useState(null); // id do item em edição, 'new' ou null
  const [error, setError] = useState('');

  async function toggle(item) {
    const deactivating = item.active !== false;
    if (deactivating && !window.confirm(
      `Desativar ${item.name}? Some das opções de reserva; as reservas já feitas continuam valendo.`,
    )) return;
    setError('');
    try {
      await api(`${endpoint}/${item.id}`, { method: 'PATCH', body: { active: !deactivating } });
      onChange();
    } catch (err) {
      setError(err.message);
    }
  }

  const done = () => {
    setEditing(null);
    onChange();
  };

  return (
    <section className="section">
      <h3 className="section-title">{title}</h3>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <ul className="plain-list">
        {items.map((item) =>
          editing === item.id ? (
            <li key={item.id}>
              <EntityForm
                fields={fields}
                initial={item}
                method="PATCH"
                url={`${endpoint}/${item.id}`}
                onDone={done}
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : (
            <li key={item.id} className={item.active === false ? 'is-inactive' : ''}>
              {render(item)}
              <span className="item-actions">
                {item.active === false && <span className="tag tag-muted">inativo</span>}
                <button
                  type="button"
                  className="icon-button icon-button-sm"
                  onClick={() => setEditing(item.id)}
                  aria-label={`Editar ${item.name}`}
                  title="Editar"
                >
                  <Pencil size={14} />
                </button>
                <button type="button" className="link-button link-small" onClick={() => toggle(item)}>
                  {item.active === false ? 'Reativar' : 'Desativar'}
                </button>
              </span>
            </li>
          ),
        )}
      </ul>
      {editing === 'new' ? (
        <EntityForm fields={fields} method="POST" url={endpoint} onDone={done} onCancel={() => setEditing(null)} />
      ) : (
        <button type="button" className="button button-outline" onClick={() => setEditing('new')}>
          <Plus size={16} aria-hidden="true" /> Adicionar {noun}
        </button>
      )}
    </section>
  );
}

function EntityForm({ fields, initial, method, url, onDone, onCancel }) {
  const [form, setForm] = useState(() =>
    Object.fromEntries(fields.map((f) => [f.name, String(initial?.[f.name] ?? f.initial ?? '')])),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const body = Object.fromEntries(
      fields.map((f) => [f.name, f.type === 'number' ? Number(form[f.name]) : form[f.name].trim()]),
    );
    try {
      await api(url, { method, body });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
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
      {method === 'PATCH' && fields.some((f) => f.name === 'price') && (
        <small className="hint">Preço e duração novos valem para as próximas reservas.</small>
      )}
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <div className="add-form-actions">
        <button className="button button-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
        <button type="button" className="link-button" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

function HoursEditor({ initial, onSaved }) {
  const [weekdays, setWeekdays] = useState(initial.weekdays);
  const [closed, setClosed] = useState(initial.closed_dates);
  const [newDate, setNewDate] = useState('');
  const [status, setStatus] = useState({ error: '', saved: false });
  const [busy, setBusy] = useState(false);

  const setDay = (i, value) => {
    setWeekdays((list) => list.map((d, j) => (j === i ? value : d)));
    setStatus({ error: '', saved: false });
  };

  function addDate() {
    if (newDate && !closed.includes(newDate)) setClosed([...closed, newDate].sort());
    setNewDate('');
    setStatus({ error: '', saved: false });
  }

  async function save() {
    setBusy(true);
    try {
      const saved = await api('/admin/hours', { method: 'PUT', body: { weekdays, closed_dates: closed } });
      setWeekdays(saved.weekdays);
      setClosed(saved.closed_dates);
      setStatus({ error: '', saved: true });
      onSaved();
    } catch (err) {
      setStatus({ error: err.message, saved: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section">
      <h3 className="section-title">Horário de funcionamento</h3>
      <div className="hours">
        {WEEKDAYS.map((label, i) => {
          const period = weekdays[i];
          return (
            <div key={label} className="hours-row">
              <label className="toggle hours-day">
                <input
                  type="checkbox"
                  checked={Boolean(period)}
                  onChange={(e) => setDay(i, e.target.checked ? { open: '09:00', close: '19:00' } : null)}
                />
                {label}
              </label>
              {period ? (
                <span className="hours-times">
                  <TimeSelect label={`Abertura de ${label}`} value={period.open} onChange={(v) => setDay(i, { ...period, open: v })} />
                  <span className="muted">às</span>
                  <TimeSelect label={`Fechamento de ${label}`} value={period.close} onChange={(v) => setDay(i, { ...period, close: v })} />
                </span>
              ) : (
                <span className="muted">fechado</span>
              )}
            </div>
          );
        })}
      </div>

      <h4 className="subsection-title">Folgas e feriados</h4>
      <div className="closed-dates">
        {closed.length === 0 && <p className="muted">Nenhuma data fechada.</p>}
        {closed.map((d) => (
          <span key={d} className="chip">
            {parseIso(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
            <button type="button" onClick={() => setClosed(closed.filter((x) => x !== d))} aria-label={`Remover ${d}`}>
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="closed-add">
        <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} aria-label="Data fechada" />
        <button type="button" className="button button-outline" onClick={addDate} disabled={!newDate}>
          <Plus size={16} aria-hidden="true" /> Fechar esta data
        </button>
      </div>

      {status.error && <p className="alert alert-error" role="alert">{status.error}</p>}
      {status.saved && <p className="alert alert-success" role="status">Horários salvos.</p>}
      <button type="button" className="button button-primary" onClick={save} disabled={busy}>
        {busy ? 'Salvando…' : 'Salvar horários'}
      </button>
      <p className="hint hours-note">Reservas já feitas continuam valendo mesmo fora do novo horário.</p>
    </section>
  );
}

function TimeSelect({ label, value, onChange }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {HALF_HOURS.map((t) => (
        <option key={t} value={t}>{t}</option>
      ))}
    </select>
  );
}
