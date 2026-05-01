import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Maps API error codes to user-facing messages.
const REG_ERRORS = {
  INVITE_INVALID:      'This invitation link is invalid.',
  INVITE_ALREADY_USED: 'This invitation has already been used.',
  NAME_REQUIRED:       'Name is required.',
  PASSWORD_TOO_SHORT:  'Password must be at least 8 characters.',
  PASSWORD_TOO_LONG:   'Password must not exceed 128 characters.',
};

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate     = useNavigate();

  const tokenFromUrl = new URLSearchParams(window.location.search).get('token') || '';

  const [validating,      setValidating]      = useState(true);
  const [tokenValid,      setTokenValid]      = useState(false);
  const [expired,         setExpired]         = useState(false);
  const [inviteEmail,     setInviteEmail]     = useState('');
  const [batchYear,       setBatchYear]       = useState(null);
  const [tokenError,      setTokenError]      = useState('');

  const [name,            setName]            = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword,    setShowPassword]    = useState(false);
  const [submitting,      setSubmitting]      = useState(false);
  const [formError,       setFormError]       = useState('');

  // Theme state — reads from <html> class on mount
  const [theme, setTheme] = useState(
      document.documentElement.classList.contains('light') ? 'light' : 'dark'
  );

  const toggleTheme = () => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.remove('dark');
      root.classList.add('light');
      setTheme('light');
    } else {
      root.classList.remove('light');
      root.classList.add('dark');
      setTheme('dark');
    }
  };

  // Password strength 0–4
  const passwordStrength = (() => {
    if (!password) return 0;
    let score = 0;
    if (password.length >= 8)  score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
    if (/\d/.test(password))   score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return Math.min(score, 4);
  })();

  const strengthLabel = ['', 'Weak', 'Fair', 'Good', 'Strong'][passwordStrength];
  const strengthColor = ['', '#e05c5c', '#f0a05c', '#7cc0c0', '#5cbf7c'][passwordStrength];

  // ── Validate token on mount ─────────────────────────────
  useEffect(() => {
    if (!tokenFromUrl) {
      setTokenError('No invitation token found in this link.');
      setValidating(false);
      return;
    }

    async function validate() {
      try {
        const res  = await fetch(
            `/api/auth/invite/validate?token=${encodeURIComponent(tokenFromUrl)}`,
            { credentials: 'include' }
        );
        const body = await res.json();

        if (res.status === 410) {
          setExpired(true);
          setValidating(false);
          return;
        }

        if (!res.ok || !body.success) {
          const msgs = {
            INVITE_INVALID:      'This invitation link is invalid.',
            INVITE_ALREADY_USED: 'This invitation has already been used. Please sign in.',
          };
          setTokenError(msgs[body.error] || body.message || 'Invalid invitation.');
          setValidating(false);
          return;
        }

        setInviteEmail(body.data.email);
        setBatchYear(body.data.batchYear);
        setTokenValid(true);
      } catch {
        setTokenError('Unable to validate invitation. Please try again.');
      } finally {
        setValidating(false);
      }
    }

    validate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Registration submit ─────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!name.trim())              { setFormError('Name is required.'); return; }
    if (password.length < 8)       { setFormError('Password must be at least 8 characters.'); return; }
    if (password.length > 128)     { setFormError('Password must not exceed 128 characters.'); return; }
    if (password !== confirmPassword) { setFormError('Passwords do not match.'); return; }

    setSubmitting(true);
    try {
      await register(tokenFromUrl, name.trim(), password);
      navigate('/home', { replace: true });
    } catch (err) {
      const code = err.code;
      setFormError(REG_ERRORS[code] || err.message || 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
      <div style={s.page}>
        <style>{`
        /* ─────────────────────────────────────────────
           CSS Variables — dark (default) & light modes
        ───────────────────────────────────────────── */
        :root, html.dark {
          --bg-primary:    #0c0c0e;
          --bg-elevated:   rgba(232,201,74,0.05);
          --card-bg:       rgba(17,17,20,0.88);
          --card-border:   rgba(255,255,255,0.08);
          --input-bg:      rgba(255,255,255,0.04);
          --input-border:  rgba(255,255,255,0.10);
          --text-primary:  #f0f0f2;
          --text-secondary:rgba(255,255,255,0.70);
          --text-muted:    rgba(255,255,255,0.38);
          --accent:        #e8c94a;
          --accent-hover:  #d4b63c;
          --accent-text:   #0c0c0e;
          --accent-soft:   rgba(232,201,74,0.10);
          --border:        rgba(232,201,74,0.20);
          --glow-1:        rgba(232,201,74,0.12);
          --glow-2:        rgba(232,201,74,0.08);
          --shadow:        rgba(0,0,0,0.60);
          --label-color:   rgba(255,255,255,0.45);
          --placeholder:   rgba(255,255,255,0.20);
          --divider:       rgba(255,255,255,0.07);
          --hint-color:    rgba(255,255,255,0.28);
          --brand-color:   #e8e8e8;
          --toggle-track:  rgba(255,255,255,0.10);
          --toggle-thumb:  rgba(255,255,255,0.55);
        }

        html.light {
          --bg-primary:    #f5f0e8;
          --bg-elevated:   rgba(232,201,74,0.08);
          --card-bg:       rgba(255,253,245,0.95);
          --card-border:   rgba(0,0,0,0.08);
          --input-bg:      rgba(0,0,0,0.03);
          --input-border:  rgba(0,0,0,0.12);
          --text-primary:  #1a1810;
          --text-secondary:rgba(0,0,0,0.70);
          --text-muted:    rgba(0,0,0,0.42);
          --accent:        #c9a800;
          --accent-hover:  #b89800;
          --accent-text:   #fff;
          --accent-soft:   rgba(201,168,0,0.10);
          --border:        rgba(201,168,0,0.25);
          --glow-1:        rgba(232,201,74,0.15);
          --glow-2:        rgba(232,201,74,0.10);
          --shadow:        rgba(0,0,0,0.12);
          --label-color:   rgba(0,0,0,0.45);
          --placeholder:   rgba(0,0,0,0.22);
          --divider:       rgba(0,0,0,0.08);
          --hint-color:    rgba(0,0,0,0.32);
          --brand-color:   #1a1810;
          --toggle-track:  rgba(0,0,0,0.10);
          --toggle-thumb:  rgba(0,0,0,0.40);
        }

        /* ── Grid background ── */
        .reg-bg-grid {
          position: fixed;
          inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
          background-size: 40px 40px;
          pointer-events: none;
          z-index: 0;
          transition: opacity 0.3s;
        }
        html.light .reg-bg-grid {
          background-image:
            linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px);
        }
        .reg-bg-glow {
          position: fixed;
          width: 600px;
          height: 600px;
          border-radius: 50%;
          background: radial-gradient(circle, var(--glow-1) 0%, transparent 70%);
          top: -200px;
          right: -100px;
          pointer-events: none;
          z-index: 0;
        }
        .reg-bg-glow-2 {
          position: fixed;
          width: 400px;
          height: 400px;
          border-radius: 50%;
          background: radial-gradient(circle, var(--glow-2) 0%, transparent 70%);
          bottom: -100px;
          left: -100px;
          pointer-events: none;
          z-index: 0;
        }

        /* ── Card ── */
        .reg-card {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 420px;
          background: var(--card-bg);
          border: 1px solid var(--card-border);
          border-radius: 10px;
          padding: 2.2rem 2rem;
          box-shadow:
            0 0 0 1px rgba(232,201,74,0.07),
            0 24px 64px var(--shadow);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          animation: regFadeIn 0.35s ease both;
          transition: background 0.25s, border-color 0.25s, box-shadow 0.25s;
        }
        @keyframes regFadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* ── Brand row ── */
        .reg-brand-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 1.8rem;
        }
        .reg-brand {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-weight: 800;
          font-size: 0.88rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--brand-color);
        }
        .reg-brand-dot {
          width: 8px;
          height: 8px;
          background: var(--accent);
          border-radius: 50%;
          box-shadow: 0 0 8px rgba(232,201,74,0.55);
          transition: background 0.25s, box-shadow 0.25s;
        }

        /* ── Theme toggle ── */
        .reg-theme-toggle {
          position: relative;
          width: 38px;
          height: 20px;
          cursor: pointer;
          flex-shrink: 0;
        }
        .toggle-track {
          width: 38px;
          height: 20px;
          border-radius: 20px;
          background: var(--toggle-track);
          border: 1px solid var(--card-border);
          cursor: pointer;
          position: relative;
          transition: background 0.2s, border-color 0.2s;
          display: flex;
          align-items: center;
          padding: 0 3px;
        }
        .toggle-track.on {
          background: rgba(232,201,74,0.18);
          border-color: rgba(232,201,74,0.30);
        }
        .toggle-thumb {
          width: 13px;
          height: 13px;
          border-radius: 50%;
          background: var(--toggle-thumb);
          transition: transform 0.22s cubic-bezier(.4,0,.2,1), background 0.2s;
          flex-shrink: 0;
        }
        .toggle-track.on .toggle-thumb {
          transform: translateX(17px);
          background: var(--accent);
        }
        .toggle-icon {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          pointer-events: none;
          font-size: 9px;
          line-height: 1;
          transition: opacity 0.2s;
        }
        .toggle-icon-moon { left: 4px; opacity: 1; }
        .toggle-icon-sun  { right: 3px; opacity: 0; }
        .toggle-track.on .toggle-icon-moon { opacity: 0; }
        .toggle-track.on .toggle-icon-sun  { opacity: 1; }

        /* ── Headings ── */
        .reg-title {
          font-size: 1.45rem;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: var(--text-primary);
          margin: 0 0 0.3rem;
          transition: color 0.25s;
        }
        .reg-subtitle {
          font-size: 0.81rem;
          color: var(--text-muted);
          margin: 0 0 1.6rem;
          line-height: 1.5;
          transition: color 0.25s;
        }

        /* ── Form groups ── */
        .reg-form-group {
          margin-bottom: 1rem;
        }
        .reg-label {
          display: block;
          font-size: 0.72rem;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--label-color);
          margin-bottom: 0.4rem;
          transition: color 0.25s;
        }
        .reg-input-wrap {
          position: relative;
        }
        .reg-input {
          width: 100%;
          padding: 0.6rem 0.85rem;
          background: var(--input-bg);
          border: 1px solid var(--input-border);
          border-radius: 5px;
          color: var(--text-primary);
          font-size: 0.85rem;
          font-family: inherit;
          transition: border-color 0.15s, background 0.15s, color 0.25s;
          outline: none;
          box-sizing: border-box;
        }
        .reg-input:focus {
          border-color: var(--accent);
          background: var(--bg-elevated);
        }
        .reg-input:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .reg-input::placeholder { color: var(--placeholder); }
        .reg-hint {
          font-size: 0.7rem;
          color: var(--hint-color);
          margin-top: 0.3rem;
        }

        /* ── Eye toggle ── */
        .reg-eye-btn {
          position: absolute;
          right: 0.7rem;
          top: 50%;
          transform: translateY(-50%);
          background: transparent;
          border: none;
          cursor: pointer;
          color: var(--label-color);
          padding: 0.2rem;
          display: flex;
          align-items: center;
          transition: color 0.15s;
        }
        .reg-eye-btn:hover { color: var(--text-primary); }
        .reg-input-has-eye { padding-right: 2.4rem; }

        /* ── Strength bar ── */
        .reg-strength-bar {
          display: flex;
          gap: 3px;
          margin-top: 0.45rem;
        }
        .reg-strength-seg {
          height: 3px;
          flex: 1;
          border-radius: 2px;
          background: var(--input-border);
          transition: background 0.3s;
        }

        /* ── Error / Alert ── */
        .reg-alert {
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;
          padding: 0.7rem 0.9rem;
          border-radius: 5px;
          font-size: 0.8rem;
          line-height: 1.45;
          margin-bottom: 1rem;
        }
        .reg-alert-error {
          background: rgba(224,92,92,0.10);
          border: 1px solid rgba(224,92,92,0.25);
          color: #e08e8e;
        }
        html.light .reg-alert-error {
          background: rgba(224,92,92,0.07);
          color: #b94040;
        }
        .reg-alert-warning {
          background: rgba(240,160,92,0.10);
          border: 1px solid rgba(240,160,92,0.25);
          color: #f0c08e;
        }
        html.light .reg-alert-warning {
          background: rgba(240,160,92,0.07);
          color: #a05c1a;
        }

        /* ── Submit button ── */
        .reg-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          width: 100%;
          padding: 0.72rem;
          background: var(--accent);
          color: var(--accent-text);
          font-size: 0.82rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          transition: background 0.15s, opacity 0.15s, transform 0.1s;
          margin-top: 0.5rem;
          font-family: inherit;
        }
        .reg-btn:hover:not(:disabled) {
          background: var(--accent-hover);
          transform: translateY(-1px);
        }
        .reg-btn:active:not(:disabled) {
          transform: translateY(0);
        }
        .reg-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* ── Mini spinner ── */
        .reg-spinner {
          width: 13px;
          height: 13px;
          border: 2px solid rgba(0,0,0,0.2);
          border-top-color: var(--accent-text);
          border-radius: 50%;
          animation: regSpin 0.7s linear infinite;
          flex-shrink: 0;
        }
        @keyframes regSpin { to { transform: rotate(360deg); } }

        /* ── Status pages (expired / invalid) ── */
        .reg-status-icon {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 1rem;
        }
        .reg-divider {
          height: 1px;
          background: var(--divider);
          margin: 1.2rem 0;
        }
        .reg-email-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.3rem 0.7rem;
          background: var(--accent-soft);
          border: 1px solid var(--border);
          border-radius: 20px;
          font-size: 0.78rem;
          color: var(--text-secondary);
          margin-bottom: 1.4rem;
          transition: background 0.25s, border-color 0.25s, color 0.25s;
        }

        /* ── Validating spinner (full card) ── */
        .reg-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.8rem;
          padding: 1rem 0 0.5rem;
          color: var(--text-muted);
          font-size: 0.78rem;
          letter-spacing: 0.05em;
        }
        .reg-loading-ring {
          width: 32px;
          height: 32px;
          border: 2px solid rgba(232,201,74,0.15);
          border-top-color: var(--accent);
          border-radius: 50%;
          animation: regSpin 0.8s linear infinite;
        }
      `}</style>

        {/* Background decorations */}
        <div className="reg-bg-grid" />
        <div className="reg-bg-glow" />
        <div className="reg-bg-glow-2" />

        <div className="reg-card">

          {/* ── Brand row with theme toggle ── */}
          <div className="reg-brand-row">
            <div className="reg-brand">
              <span className="reg-brand-dot" />
              AcadHost
            </div>

            {/* Theme toggle */}
            <div
                className={`toggle-track ${theme === 'light' ? 'on' : ''}`}
                onClick={toggleTheme}
                role="switch"
                aria-checked={theme === 'light'}
                aria-label="Toggle light/dark mode"
                tabIndex={0}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggleTheme()}
            >
              <span className="toggle-icon toggle-icon-moon">🌙</span>
              <div className="toggle-thumb" />
              <span className="toggle-icon toggle-icon-sun">☀️</span>
            </div>
          </div>

          {/* ── States ── */}
          {validating ? (
              <div className="reg-loading">
                <div className="reg-loading-ring" />
                Validating invitation…
              </div>

          ) : expired ? (
              <>
                <div className="reg-status-icon" style={{ background: 'rgba(240,160,92,0.12)' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f0a05c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                </div>
                <h1 className="reg-title">Link Expired</h1>
                <p className="reg-subtitle" style={{ marginBottom: 0 }}>
                  Your invitation link has expired. Contact your administrator to request a new one.
                </p>
              </>

          ) : tokenError ? (
              <>
                <div className="reg-status-icon" style={{ background: 'rgba(224,92,92,0.12)' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#e05c5c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="15" y1="9" x2="9" y2="15"/>
                    <line x1="9" y1="9" x2="15" y2="15"/>
                  </svg>
                </div>
                <h1 className="reg-title">Invalid Link</h1>
                <p className="reg-subtitle" style={{ marginBottom: 0 }}>{tokenError}</p>
              </>

          ) : tokenValid ? (
              <>
                <h1 className="reg-title">Create Account</h1>

                {/* Email badge */}
                <div className="reg-email-badge">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                    <polyline points="22,6 12,13 2,6"/>
                  </svg>
                  {inviteEmail}
                  {batchYear && <>&nbsp;·&nbsp;Batch {batchYear}</>}
                </div>

                {formError && (
                    <div className="reg-alert reg-alert-error">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '0.05rem' }}>
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                      {formError}
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                  {/* Full Name */}
                  <div className="reg-form-group">
                    <label className="reg-label">Full Name</label>
                    <input
                        className="reg-input"
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        required
                        maxLength={255}
                        autoFocus
                        placeholder="Jane Smith"
                        autoComplete="name"
                    />
                  </div>

                  {/* Password */}
                  <div className="reg-form-group">
                    <label className="reg-label">Password</label>
                    <div className="reg-input-wrap">
                      <input
                          className="reg-input reg-input-has-eye"
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          required
                          minLength={8}
                          maxLength={128}
                          autoComplete="new-password"
                          placeholder="8–128 characters"
                      />
                      <button
                          type="button"
                          className="reg-eye-btn"
                          onClick={() => setShowPassword(v => !v)}
                          tabIndex={-1}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                              <line x1="1" y1="1" x2="23" y2="23"/>
                            </svg>
                        ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                              <circle cx="12" cy="12" r="3"/>
                            </svg>
                        )}
                      </button>
                    </div>

                    {/* Strength bar */}
                    {password && (
                        <>
                          <div className="reg-strength-bar">
                            {[1, 2, 3, 4].map(i => (
                                <div
                                    key={i}
                                    className="reg-strength-seg"
                                    style={{ background: i <= passwordStrength ? strengthColor : undefined }}
                                />
                            ))}
                          </div>
                          <div className="reg-hint" style={{ color: strengthColor }}>
                            {strengthLabel}
                          </div>
                        </>
                    )}
                  </div>

                  {/* Confirm password */}
                  <div className="reg-form-group">
                    <label className="reg-label">Confirm Password</label>
                    <div className="reg-input-wrap">
                      <input
                          className="reg-input reg-input-has-eye"
                          type={showPassword ? 'text' : 'password'}
                          value={confirmPassword}
                          onChange={e => setConfirmPassword(e.target.value)}
                          required
                          autoComplete="new-password"
                          placeholder="Repeat your password"
                      />
                      {confirmPassword && password !== confirmPassword && (
                          <svg
                              style={{ position: 'absolute', right: '0.7rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
                              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e05c5c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                          >
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                      )}
                      {confirmPassword && password === confirmPassword && (
                          <svg
                              style={{ position: 'absolute', right: '0.7rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
                              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5cbf7c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                      )}
                    </div>
                  </div>

                  <button
                      className="reg-btn"
                      type="submit"
                      disabled={submitting}
                  >
                    {submitting ? (
                        <><div className="reg-spinner" />Creating account…</>
                    ) : (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                          Create Account
                        </>
                    )}
                  </button>
                </form>
              </>
          ) : null}
        </div>
      </div>
  );
}

const s = {
  page: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    minHeight:      '100vh',
    padding:        '1.5rem',
    background:     'var(--bg-primary)',
    transition:     'background 0.25s',
  },
};
