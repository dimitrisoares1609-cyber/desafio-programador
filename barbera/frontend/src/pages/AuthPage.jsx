import { useState } from 'react';
import { ArrowRight, Scissors } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';

export default function AuthPage() {
  const { setUser } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isLogin = mode === 'login';

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = isLogin ? { email: form.email, password: form.password } : form;
      setUser(await api(isLogin ? '/auth/login' : '/auth/register', { method: 'POST', body }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function switchMode() {
    setMode(isLogin ? 'register' : 'login');
    setError('');
  }

  return (
    <div className="auth">
      <section className="auth-hero">
        <span className="brand brand-light">
          <Scissors size={18} aria-hidden="true" /> Barbera
        </span>
        <h1 className="auth-title">
          Seu tempo.
          <br />
          <em>Bem cuidado.</em>
        </h1>
        <p className="auth-lead">
          Reserve com o profissional que conhece seu estilo, acompanhe sua agenda e faça parte do
          clube com planos mensais.
        </p>
        <ul className="auth-facts mono">
          <li>3 profissionais</li>
          <li>seg — sáb · 09h às 19h</li>
          <li>planos a partir de R$ 49</li>
        </ul>
      </section>

      <section className="auth-panel">
        <form className="auth-form" onSubmit={submit} noValidate>
          <p className="eyebrow mono">{isLogin ? 'bem-vindo de volta' : 'nova conta'}</p>
          <h2>{isLogin ? 'Entrar' : 'Criar conta'}</h2>

          {!isLogin && (
            <label className="field">
              <span>Nome</span>
              <input value={form.name} onChange={update('name')} autoComplete="name" required minLength={2} />
            </label>
          )}
          <label className="field">
            <span>E-mail</span>
            <input type="email" value={form.email} onChange={update('email')} autoComplete="email" required />
          </label>
          <label className="field">
            <span>Senha</span>
            <input
              type="password"
              value={form.password}
              onChange={update('password')}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              required
              minLength={6}
            />
            {!isLogin && <small className="hint">Mínimo de 6 caracteres.</small>}
          </label>

          {error && <p className="alert alert-error" role="alert">{error}</p>}

          <button className="button button-primary button-block" disabled={busy}>
            {busy ? 'Aguarde…' : isLogin ? 'Entrar' : 'Criar conta'}
            <ArrowRight size={18} aria-hidden="true" />
          </button>

          <p className="auth-switch">
            {isLogin ? 'Ainda não tem conta?' : 'Já tem conta?'}{' '}
            <button type="button" className="link-button" onClick={switchMode}>
              {isLogin ? 'Cadastre-se' : 'Entrar'}
            </button>
          </p>
        </form>
      </section>
    </div>
  );
}
