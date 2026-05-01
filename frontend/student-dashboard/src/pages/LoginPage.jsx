import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

const ERROR_MESSAGES = {
  INVALID_CREDENTIALS:     'Invalid email or password.',
  REGISTRATION_INCOMPLETE: 'Complete registration via your invitation link.',
  ACCOUNT_REMOVED:         'This account has been deactivated.',
  ACCOUNT_SUSPENDED:       'This account has been suspended. Contact your administrator.',
  VALIDATION_ERROR:        null,
};

export default function LoginPage() {
  const { login }  = useAuth();
  const { darkMode, toggleDarkMode } = useTheme();
  const navigate   = useNavigate();
  const location   = useLocation();
  const returnTo   = location.state?.from?.pathname || '/home';

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const [showForgot, setShowForgot] = useState(false);
  const [fpEmail,    setFpEmail]    = useState('');
  const [fpLoading,  setFpLoading]  = useState(false);
  const [fpMsg,      setFpMsg]      = useState('');
  const [fpError,    setFpError]    = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const data = await login(email, password);
      if (data.user.role !== 'student') {
        setError('This dashboard is for students only. Use admin.acadhost.com.');
        return;
      }
      navigate(returnTo, { replace: true });
    } catch (err) {
      const code = err.code;
      setError(
          ERROR_MESSAGES[code] !== undefined
              ? (ERROR_MESSAGES[code] || err.message)
              : err.message || 'Login failed.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setFpError(''); setFpMsg('');
    if (!fpEmail.trim()) { setFpError('Email is required.'); return; }
    setFpLoading(true);
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: fpEmail.trim() }),
      });
      setFpMsg('If an account exists for that email, a reset link has been sent.');
    } catch {
      setFpMsg('If an account exists for that email, a reset link has been sent.');
    } finally {
      setFpLoading(false);
    }
  };

  return (
      <div style={S.page}>
        {/* Background grid */}
        <div style={S.grid} aria-hidden="true" />
        {/* Accent glow */}
        <div style={S.glow} aria-hidden="true" />

        {/* Theme toggle — top right corner */}
        <button
            onClick={() => toggleDarkMode()}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            style={S.themeBtn}
            aria-label="Toggle theme"
        >
          {darkMode ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"/>
                <line x1="12" y1="1" x2="12" y2="3"/>
                <line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/>
                <line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
          ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
          )}
          <span style={{ fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.04em' }}>
            {darkMode ? 'LIGHT' : 'DARK'}
          </span>
        </button>

        <div style={S.wrap}>
          {/* Wordmark */}
          <div style={S.wordmark}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
              <rect x="2" y="2" width="7" height="7" fill="var(--accent)" />
              <rect x="11" y="2" width="7" height="7" fill="var(--accent)" opacity="0.4" />
              <rect x="2" y="11" width="7" height="7" fill="var(--accent)" opacity="0.4" />
              <rect x="11" y="11" width="7" height="7" fill="var(--accent)" />
            </svg>
            <span style={S.wordmarkText}>AcadHost</span>
          </div>

          <div style={S.card} className="card">
            {!showForgot ? (
                <>
                  <div style={S.cardHead}>
                    <h1 style={S.title}>Welcome back</h1>
                    <p style={S.subtitle}>Sign in to your student dashboard</p>
                  </div>

                  {error && <div style={S.errorBox}><span style={S.errorIcon}>!</span>{error}</div>}

                  <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div>
                      <label style={S.label}>Email address</label>
                      <input
                          style={S.input}
                          className="input"
                          type="email"
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          required
                          autoComplete="email"
                          autoFocus
                          placeholder="you@institution.edu"
                      />
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.4rem' }}>
                        <label style={S.label}>Password</label>
                        <button type="button" style={S.forgotBtn} onClick={() => setShowForgot(true)}>
                          Forgot password?
                        </button>
                      </div>
                      <div style={{ position: 'relative' }}>
                        <input
                            style={S.input}
                            className="input"
                            type={showPw ? 'text' : 'password'}
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            autoComplete="current-password"
                            placeholder="••••••••••••"
                        />
                        <button
                            type="button"
                            onClick={() => setShowPw(v => !v)}
                            style={S.eyeBtn}
                            tabIndex={-1}
                            title={showPw ? 'Hide password' : 'Show password'}
                        >
                          {showPw ? (
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                                <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                                <line x1="1" y1="1" x2="23" y2="23"/>
                              </svg>
                          ) : (
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                <circle cx="12" cy="12" r="3"/>
                              </svg>
                          )}
                        </button>
                      </div>
                    </div>

                    <button
                        style={{ ...S.submitBtn, opacity: loading ? 0.7 : 1 }}
                        type="submit"
                        disabled={loading}
                    >
                      {loading ? (
                          <><span className="spinner" style={{ borderTopColor: '#000', width: 14, height: 14 }} />Signing in…</>
                      ) : (
                          <>Sign in <span style={{ marginLeft: 4 }}>→</span></>
                      )}
                    </button>
                  </form>

                  <p style={S.footerNote}>
                    No account? Ask your administrator to send you an invitation.
                  </p>
                </>
            ) : (
                <>
                  <div style={S.cardHead}>
                    <h1 style={S.title}>Reset password</h1>
                    <p style={S.subtitle}>We'll send a reset link to your email.</p>
                  </div>

                  {fpMsg ? (
                      <>
                        <div style={S.successBox}>
                          <span style={S.successIcon}>✓</span>
                          {fpMsg}
                        </div>
                        <button
                            style={S.ghostBtn}
                            onClick={() => { setShowForgot(false); setFpMsg(''); setFpEmail(''); }}
                        >
                          ← Back to sign in
                        </button>
                      </>
                  ) : (
                      <form onSubmit={handleForgotPassword} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div>
                          <label style={S.label}>Email address</label>
                          <input
                              style={S.input}
                              className="input"
                              type="email"
                              value={fpEmail}
                              onChange={e => setFpEmail(e.target.value)}
                              required
                              autoFocus
                              placeholder="you@institution.edu"
                          />
                        </div>

                        {fpError && <div style={S.errorBox}><span style={S.errorIcon}>!</span>{fpError}</div>}

                        <button
                            style={{ ...S.submitBtn, opacity: fpLoading ? 0.7 : 1 }}
                            type="submit"
                            disabled={fpLoading}
                        >
                          {fpLoading ? <><span className="spinner" style={{ borderTopColor: '#000', width: 14, height: 14 }} />Sending…</> : 'Send reset link →'}
                        </button>

                        <button
                            type="button"
                            style={S.ghostBtn}
                            onClick={() => { setShowForgot(false); setFpError(''); }}
                        >
                          ← Back to sign in
                        </button>
                      </form>
                  )}
                </>
            )}
          </div>

          <p style={S.legal}>AcadHost · Student Portal · {new Date().getFullYear()}</p>
        </div>

        <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600&display=swap');

        :root {
          --font-display: 'Instrument Serif', Georgia, serif;
          --font-body: 'DM Sans', system-ui, sans-serif;
          --font-mono: 'DM Mono', monospace;
        }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes glowPulse {
          0%, 100% { opacity: 0.18; transform: scale(1); }
          50%       { opacity: 0.28; transform: scale(1.05); }
        }
      `}</style>
      </div>
  );
}

const S = {
  page: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: '1.5rem',
    background: 'var(--bg-primary)',
    fontFamily: "'DM Sans', system-ui, sans-serif",
    overflow: 'hidden',
  },
  grid: {
    position: 'absolute', inset: 0, zIndex: 0,
    backgroundImage: `linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)`,
    backgroundSize: '40px 40px',
    opacity: 0.35,
  },
  glow: {
    position: 'absolute', top: '20%', left: '50%',
    transform: 'translateX(-50%)',
    width: 520, height: 320,
    background: 'radial-gradient(ellipse, var(--accent) 0%, transparent 70%)',
    opacity: 0.08,
    filter: 'blur(40px)',
    zIndex: 0,
    animation: 'glowPulse 6s ease-in-out infinite',
  },
  // Theme toggle button — fixed top-right
  themeBtn: {
    position: 'fixed',
    top: '1rem',
    right: '1rem',
    zIndex: 200,
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    background: 'var(--card-bg)',
    border: '1px solid var(--border)',
    borderRadius: '3px',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    padding: '0.4rem 0.7rem',
    fontSize: '0.72rem',
    fontFamily: "'DM Mono', monospace",
    height: '30px',
    backdropFilter: 'blur(8px)',
    transition: 'color 0.15s, border-color 0.15s',
  },
  wrap: {
    position: 'relative', zIndex: 1,
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: '1.5rem',
    width: '100%', maxWidth: 420,
    animation: 'fadeUp 0.4s ease both',
  },
  wordmark: {
    display: 'flex', alignItems: 'center', gap: '0.6rem',
  },
  wordmarkText: {
    fontFamily: "'Instrument Serif', Georgia, serif",
    fontSize: '1.35rem',
    fontWeight: 400,
    color: 'var(--text-primary)',
    letterSpacing: '-0.01em',
  },
  card: {
    width: '100%',
    padding: '2rem 2rem 1.75rem',
    border: '1px solid var(--border)',
    background: 'var(--card-bg)',
    backdropFilter: 'blur(12px)',
    borderRadius: 6,
    boxShadow: '0 4px 40px rgba(0,0,0,0.18)',
  },
  cardHead: {
    marginBottom: '1.5rem',
  },
  title: {
    fontFamily: "'Instrument Serif', Georgia, serif",
    fontSize: '1.75rem',
    fontWeight: 400,
    fontStyle: 'italic',
    color: 'var(--text-primary)',
    letterSpacing: '-0.02em',
    margin: 0,
    marginBottom: '0.3rem',
    lineHeight: 1.1,
  },
  subtitle: {
    fontFamily: "'DM Sans', system-ui, sans-serif",
    fontSize: '0.82rem',
    color: 'var(--text-muted)',
    margin: 0,
  },
  label: {
    display: 'block',
    fontSize: '0.74rem',
    fontWeight: 500,
    color: 'var(--text-secondary)',
    marginBottom: '0.4rem',
    letterSpacing: '0.02em',
    fontFamily: "'DM Sans', system-ui, sans-serif",
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
  },
  eyeBtn: {
    position: 'absolute', right: 10, top: '50%',
    transform: 'translateY(-50%)',
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
    padding: 2,
  },
  forgotBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--accent)', fontSize: '0.75rem',
    fontFamily: "'DM Sans', system-ui, sans-serif",
    padding: 0, textDecoration: 'none',
  },
  submitBtn: {
    width: '100%',
    padding: '0.7rem',
    background: 'var(--accent)',
    color: '#000',
    border: 'none',
    borderRadius: 3,
    fontSize: '0.84rem',
    fontWeight: 600,
    fontFamily: "'DM Sans', system-ui, sans-serif",
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.4rem',
    letterSpacing: '0.01em',
    transition: 'opacity 0.15s',
  },
  ghostBtn: {
    width: '100%',
    padding: '0.6rem',
    background: 'none',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 3,
    fontSize: '0.82rem',
    fontFamily: "'DM Sans', system-ui, sans-serif",
    cursor: 'pointer',
    letterSpacing: '0.01em',
  },
  errorBox: {
    display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 3,
    padding: '0.6rem 0.75rem',
    fontSize: '0.8rem',
    color: 'var(--error)',
    marginBottom: '0.5rem',
    fontFamily: "'DM Sans', system-ui, sans-serif",
  },
  errorIcon: {
    flexShrink: 0,
    width: 16, height: 16,
    background: 'var(--error)',
    color: '#fff',
    borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '0.68rem', fontWeight: 700,
    marginTop: 1,
  },
  successBox: {
    display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
    background: 'rgba(34,197,94,0.08)',
    border: '1px solid rgba(34,197,94,0.3)',
    borderRadius: 3,
    padding: '0.65rem 0.75rem',
    fontSize: '0.8rem',
    color: 'var(--success)',
    marginBottom: '1rem',
    fontFamily: "'DM Sans', system-ui, sans-serif",
  },
  successIcon: {
    flexShrink: 0,
    width: 16, height: 16,
    background: 'var(--success)',
    color: '#fff',
    borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '0.68rem', fontWeight: 700,
    marginTop: 1,
  },
  footerNote: {
    textAlign: 'center',
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    marginTop: '1.25rem',
    paddingTop: '1rem',
    borderTop: '1px solid var(--border)',
    fontFamily: "'DM Sans', system-ui, sans-serif",
    lineHeight: 1.5,
  },
  legal: {
    fontSize: '0.68rem',
    color: 'var(--text-muted)',
    fontFamily: "'DM Mono', monospace",
    opacity: 0.6,
  },
};