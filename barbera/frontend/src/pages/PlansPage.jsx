import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check } from 'lucide-react';
import { api, money } from '../api.js';
import { useAuth } from '../App.jsx';

export default function PlansPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [plans, setPlans] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const result = params.get('subscription');
  const current = user.subscription?.plan_id;

  useEffect(() => {
    api('/plans').then(setPlans).catch((err) => setError(err.message));
  }, []);

  async function subscribe(plan) {
    setError('');
    setBusy(plan.id);
    try {
      const { url } = await api('/subscriptions/checkout', { method: 'POST', params: { plan_id: plan.id } });
      window.location.assign(url);
    } catch (err) {
      setError(err.message);
      setBusy(null);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow mono">clube barbera</p>
          <h1>Planos mensais.</h1>
          <p className="lead">Assine e mantenha o visual em dia sem pensar no preço de cada visita.</p>
        </div>
      </header>

      {result === 'success' && (
        <p className="alert alert-success">
          Assinatura registrada.
          {params.get('demo') && ' Modo demonstrativo: nenhuma cobrança foi feita (Stripe não configurado).'}
        </p>
      )}
      {result === 'cancelled' && <p className="alert alert-info">Checkout cancelado. Nenhuma cobrança foi feita.</p>}
      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <div className="plans">
        {plans.map((plan) => (
          <article key={plan.id} className={`plan${plan.featured ? ' plan-featured' : ''}`}>
            {plan.featured && <span className="plan-badge mono">mais escolhido</span>}
            <h2>{plan.name}</h2>
            <p className="plan-price">
              <strong>{money(plan.price)}</strong>
              <span>/mês</span>
            </p>
            <ul>
              {plan.perks.map((perk) => (
                <li key={perk}>
                  <Check size={16} aria-hidden="true" /> {perk}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className={`button button-block ${plan.featured ? 'button-accent' : 'button-outline'}`}
              disabled={busy !== null || current === plan.id}
              onClick={() => subscribe(plan)}
            >
              {current === plan.id ? 'Seu plano atual' : busy === plan.id ? 'Abrindo checkout…' : 'Assinar'}
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
