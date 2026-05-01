import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';

export default function LoginPage() {
  const { login } = useAuthContext();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const ERROR_MESSAGES = {
    INVALID_CREDENTIALS: 'Invalid email or password.',
    REGISTRATION_INCOMPLETE: 'Please complete registration using your invitation link.',
    ACCOUNT_REMOVED: 'This account has been deactivated.',
    VALIDATION_ERROR: null, // use message from response
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError('Email and password are required.');
      return;
    }

    setLoading(true);
    try {
      const userData = await login(email, password);

      // Student logged into admin dashboard — reject (Section 14.7.3)
      if (userData.role !== 'admin') {
        setError('This dashboard is for administrators only. Please use acadhost.com.');
        return;
      }

      // mustChangePassword is handled by AdminLayout overlay (Section 14.2.3)
      navigate('/');
    } catch (err) {
      const code = err.response?.data?.error;
      const msg = err.response?.data?.message;
      if (code && ERROR_MESSAGES[code] !== undefined) {
        setError(ERROR_MESSAGES[code] || msg || 'Login failed.');
      } else {
        setError(msg || 'Login failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-logo">⬡</span>
          <span className="login-app-name">AcadHost</span>
          <span className="login-role-badge">Admin</span>
        </div>

        <h1 className="login-title">Sign in</h1>
        <p className="login-subtitle">Administrator access only</p>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label className="login-label">Email</label>
            <input
              type="email"
              className="login-input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              required
            />
          </div>

          <div className="login-field">
            <label className="login-label">Password</label>
            <input
              type="password"
              className="login-input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <button type="submit" className="login-submit" disabled={loading}>
            {loading ? <><span className="spinner-sm" /> Signing in…</> : 'Sign in'}
          </button>
        </form>
      </div>

      <style>{`
        .login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-primary);
          font-family: 'DM Sans', 'Segoe UI', sans-serif;
          padding: 1rem;
        }
        .login-card {
          background: var(--card-bg);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 2.5rem;
          width: 100%;
          max-width: 380px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.08);
        }
        .login-brand {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 2rem;
        }
        .login-logo { font-size: 1.5rem; color: var(--accent); }
        .login-app-name { font-size: 1.1rem; font-weight: 700; color: var(--text-primary); }
        .login-role-badge {
          background: var(--accent);
          color: #fff;
          font-size: 0.6rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          padding: 2px 7px;
          border-radius: 3px;
        }
        .login-title { font-size: 1.4rem; font-weight: 700; color: var(--text-primary); margin: 0 0 0.25rem; }
        .login-subtitle { font-size: 0.85rem; color: var(--text-secondary); margin: 0 0 1.75rem; }
        .login-error {
          background: rgba(220,38,38,0.08);
          border: 1px solid rgba(220,38,38,0.25);
          color: var(--error);
          padding: 0.6rem 0.875rem;
          border-radius: 7px;
          font-size: 0.85rem;
          margin-bottom: 1.25rem;
        }
        .login-form { display: flex; flex-direction: column; gap: 1rem; }
        .login-field { display: flex; flex-direction: column; gap: 0.35rem; }
        .login-label { font-size: 0.78rem; font-weight: 600; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.05em; }
        .login-input {
          padding: 0.55rem 0.875rem;
          border: 1.5px solid var(--input-border);
          border-radius: 7px;
          background: var(--input-bg);
          color: var(--text-primary);
          font-size: 0.9rem;
          transition: border-color 0.15s;
        }
        .login-input:focus { outline: none; border-color: var(--accent); }
        .login-submit {
          background: var(--accent);
          border: none;
          color: #fff;
          padding: 0.6rem;
          border-radius: 7px;
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.4rem;
          margin-top: 0.5rem;
          transition: background 0.15s;
        }
        .login-submit:hover { background: var(--accent-hover); }
        .login-submit:disabled { opacity: 0.6; cursor: not-allowed; }
        .spinner-sm {
          width: 14px; height: 14px;
          border: 2px solid rgba(255,255,255,0.4);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
          display: inline-block;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
