import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';

export default function AuthPage({ mode }) {
  const isSignup = mode === 'signup';
  const { login, signup, notice } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (isSignup) await signup(form);
      else await login({ email: form.email, password: form.password });
      navigate(location.state?.from || '/home', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center-screen">
      <form className="card glass" onSubmit={submit} noValidate>
        <h1 style={{ fontSize: '2rem', marginBottom: 'var(--s6)' }}>{isSignup ? 'Create your account' : 'Log in'}</h1>
        {isSignup && (
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" value={form.name} onChange={set('name')} autoComplete="name" maxLength={40} required />
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
        </div>
        <div className="field">
          <label htmlFor="password">Password {isSignup && '(8 or more characters)'}</label>
          <input id="password" type="password" value={form.password} onChange={set('password')} autoComplete={isSignup ? 'new-password' : 'current-password'} required />
        </div>
        {notice && !error && <p className="error-text" role="alert">{notice}</p>}
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Please wait…' : isSignup ? 'Create account' : 'Log in'}
        </button>
        <p className="muted" style={{ marginTop: 'var(--s4)' }}>
          {isSignup ? <>Already have an account? <Link to="/login">Log in</Link></> : <>New here? <Link to="/signup">Create an account</Link></>}
        </p>
      </form>
    </main>
  );
}
