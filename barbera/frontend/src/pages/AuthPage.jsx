import { useState } from 'react';
import { ArrowRight, Scissors } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';

const TITLES = {
  login: { eyebrow: 'bem-vindo de volta', title: 'Entrar', submit: 'Entrar' },
  register: { eyebrow: 'nova conta', title: 'Criar conta', submit: 'Criar conta' },
  forgot: { eyebrow: 'esqueci a senha', title: 'Nova senha', submit: 'Enviar link' },
};

export default function AuthPage() {
  return (
    <AuthLayout>
      <AuthForm />
    </AuthLayout>
  );
}

export function AuthLayout({ children }) {
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
          <li>profissionais dedicados</li>
          <li>reserva em poucos toques</li>
          <li>planos a partir de R$ 49</li>
        </ul>
      </section>
      <section className="auth-panel">{children}</section>
    </div>
  );
}

function AuthForm() {
  const { setUser } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const text = TITLES[mode];

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (mode === 'forgot') {
        const { message } = await api('/auth/forgot-password', { method: 'POST', body: { email: form.email } });
        setNotice(message);
      } else {
        const body = mode === 'login' ? { email: form.email, password: form.password } : form;
        setUser(await api(mode === 'login' ? '/auth/login' : '/auth/register', { method: 'POST', body }));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function switchTo(next) {
    setMode(next);
    setError('');
    setNotice('');
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <p className="eyebrow mono">{text.eyebrow}</p>
      <h2>{text.title}</h2>
      {mode === 'forgot' && (
        <p className="muted">Informe o e-mail da sua conta e enviaremos um link para criar uma nova senha.</p>
      )}

      {mode === 'register' && (
        <label className="field">
          <span>Nome</span>
          <input value={form.name} onChange={update('name')} autoComplete="name" required minLength={2} />
        </label>
      )}
      <label className="field">
        <span>E-mail</span>
        <input type="email" value={form.email} onChange={update('email')} autoComplete="email" required />
      </label>
      {mode !== 'forgot' && (
        <label className="field">
          <span>Senha</span>
          <input
            type="password"
            value={form.password}
            onChange={update('password')}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={6}
          />
        </label>
      )}
      {mode === 'register' && <small className="hint field-hint">Mínimo de 6 caracteres.</small>}
      {mode === 'login' && (
        <button type="button" className="link-button link-small forgot-link" onClick={() => switchTo('forgot')}>
          Esqueci minha senha
        </button>
      )}

      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {notice && <p className="alert alert-success" role="status">{notice}</p>}

      <button className="button button-primary button-block" disabled={busy}>
        {busy ? 'Aguarde…' : text.submit}
        <ArrowRight size={18} aria-hidden="true" />
      </button>

      <p className="auth-switch">
        {mode === 'login' && (
          <>
            Ainda não tem conta?{' '}
            <button type="button" className="link-button" onClick={() => switchTo('register')}>Cadastre-se</button>
          </>
        )}
        {mode === 'register' && (
          <>
            Já tem conta?{' '}
            <button type="button" className="link-button" onClick={() => switchTo('login')}>Entrar</button>
          </>
        )}
        {mode === 'forgot' && (
          <button type="button" className="link-button" onClick={() => switchTo('login')}>Voltar para o login</button>
        )}
      </p>
    </form>
  );
}
