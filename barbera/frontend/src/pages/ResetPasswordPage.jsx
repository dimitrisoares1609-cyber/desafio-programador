import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { AuthLayout } from './AuthPage.jsx';

// Página aberta pelo link do e-mail: funciona com ou sem sessão ativa.
export default function ResetPasswordPage() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 6) return setError('A senha precisa ter pelo menos 6 caracteres.');
    if (password !== confirm) return setError('As duas senhas não são iguais.');
    setBusy(true);
    try {
      const user = await api('/auth/reset-password', { method: 'POST', body: { token, password } });
      setUser(user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={submit} noValidate>
        <p className="eyebrow mono">redefinir senha</p>
        <h2>Crie uma nova senha</h2>
        {!token && <p className="alert alert-error">Link incompleto. Abra o link do e-mail novamente.</p>}
        <label className="field">
          <span>Nova senha</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={6}
            required
          />
        </label>
        <small className="hint field-hint">Mínimo de 6 caracteres. Você sairá dos outros aparelhos.</small>
        <label className="field">
          <span>Repita a nova senha</span>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        {error && <p className="alert alert-error" role="alert">{error}</p>}
        <button className="button button-primary button-block" disabled={busy || !token}>
          {busy ? 'Salvando…' : 'Salvar e entrar'}
          <ArrowRight size={18} aria-hidden="true" />
        </button>
        <p className="auth-switch">
          <a className="link-button" href="/">Voltar para o início</a>
        </p>
      </form>
    </AuthLayout>
  );
}
