import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

// ─────────────────────────────────────────────────────────────────────────────
// Profile v2
//
// Responsive 2-column layout:
//   Left col  → account summary + password change
//   Right col → appearance + display name edit + quota snapshot
//
// No narrow 560px cap — uses the available space like every other page.
// ─────────────────────────────────────────────────────────────────────────────

export default function Profile() {
  const { user, clearMustChangePassword } = useAuth();
  const { darkMode, toggleDarkMode }      = useTheme();

  // Password form
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd,     setNewPwd]     = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdStatus,  setPwdStatus]  = useState('idle');
  const [pwdError,   setPwdError]   = useState('');

  // Name form
  const [profile,      setProfile]      = useState(null);
  const [nameEdit,     setNameEdit]     = useState('');
  const [nameSaving,   setNameSaving]   = useState(false);
  const [nameMsg,      setNameMsg]      = useState('');

  const isForcedChange = user?.mustChangePassword;

  const loadProfile = useCallback(async () => {
    try {
      const res = await api.get('/student/profile');
      setProfile(res.data.data);
      setNameEdit(res.data.data.name || '');
    } catch {}
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwdError('');

    if (newPwd !== confirmPwd)  { setPwdError('New passwords do not match.'); return; }
    if (newPwd.length < 8)      { setPwdError('Password must be at least 8 characters.'); return; }
    if (newPwd.length > 128)    { setPwdError('Password must not exceed 128 characters.'); return; }

    setPwdStatus('loading');
    try {
      await api.put('/auth/password', {
        currentPassword: currentPwd,
        newPassword:     newPwd,
      });
      setPwdStatus('success');
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd('');
      if (isForcedChange) clearMustChangePassword();
    } catch (err) {
      const code = err.response?.data?.error;
      const msgs = {
        CURRENT_PASSWORD_INCORRECT: 'Current password is incorrect.',
        PASSWORD_TOO_SHORT:         'Password must be at least 8 characters.',
        PASSWORD_TOO_LONG:          'Password must not exceed 128 characters.',
      };
      setPwdError(msgs[code] || err.response?.data?.message || 'Password change failed.');
      setPwdStatus('error');
    }
  };

  const handleSaveName = async (e) => {
    e.preventDefault();
    setNameMsg('');
    if (!nameEdit.trim()) { setNameMsg('Name cannot be empty.'); return; }
    setNameSaving(true);
    try {
      await api.put('/student/profile/name', { name: nameEdit.trim() });
      setNameMsg('Name updated.');
      loadProfile();
    } catch (err) {
      setNameMsg(err.response?.data?.message || 'Failed to update name.');
    } finally {
      setNameSaving(false);
    }
  };

  return (
      <div>
        {/* Header */}
        <div className="section-header">
          <div>
            <h1 className="section-title">Profile</h1>
            <p className="section-subtitle">{user?.email}</p>
          </div>
        </div>

        {isForcedChange && (
            <div className="alert alert-warning" style={{ marginBottom: '1.25rem' }}>
              <strong>Action required:</strong> change your default password before continuing.
            </div>
        )}

        <div className="profile-grid">
          {/* ─── LEFT COLUMN ─── */}
          <div className="profile-col">
            {/* Account summary */}
            {profile && (
                <div className="card">
                  <div className="card-body">
                    <SectionTitle accent="var(--accent)">Account</SectionTitle>
                    <div className="kv">
                      <span className="kv-k">Email</span>
                      <span className="kv-v mono">{profile.email}</span>
                      <span className="kv-k">Role</span>
                      <span className="kv-v">{profile.role}</span>
                      {profile.batchYear && (<>
                        <span className="kv-k">Batch</span>
                        <span className="kv-v mono">{profile.batchYear}</span>
                      </>)}
                      <span className="kv-k">User ID</span>
                      <span className="kv-v mono" style={{ color: 'var(--text-muted)' }}>#{profile.id}</span>
                    </div>
                  </div>
                </div>
            )}

            {/* Password change */}
            <div className="card">
              <div className="card-body">
                <SectionTitle accent="var(--error)">Change Password</SectionTitle>

                {pwdStatus === 'success' && (
                    <div className="alert alert-success" style={{ marginBottom: '0.75rem' }}>
                      Password changed successfully.
                    </div>
                )}

                <form onSubmit={handleChangePassword}>
                  <div className="form-group">
                    <label className="form-label">Current Password</label>
                    <input
                        className={`input${pwdError ? ' input-error' : ''}`}
                        type="password" value={currentPwd}
                        onChange={e => setCurrentPwd(e.target.value)}
                        required autoComplete="current-password"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">New Password</label>
                    <input
                        className="input" type="password" value={newPwd}
                        onChange={e => setNewPwd(e.target.value)}
                        required minLength={8} maxLength={128}
                        autoComplete="new-password" placeholder="8–128 characters"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Confirm New Password</label>
                    <input
                        className="input" type="password" value={confirmPwd}
                        onChange={e => setConfirmPwd(e.target.value)}
                        required autoComplete="new-password"
                        placeholder="Repeat new password"
                    />
                  </div>

                  {pwdError && (
                      <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>{pwdError}</div>
                  )}

                  <button className="btn btn-primary btn-sm" type="submit" disabled={pwdStatus === 'loading'}>
                    {pwdStatus === 'loading' ? <><span className="spinner" />Saving</> : 'Update Password'}
                  </button>
                </form>
              </div>
            </div>
          </div>

          {/* ─── RIGHT COLUMN ─── */}
          <div className="profile-col">
            {/* Display name */}
            <div className="card">
              <div className="card-body">
                <SectionTitle accent="var(--info)">Display Name</SectionTitle>
                <form onSubmit={handleSaveName}>
                  <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                    <label className="form-label">Name</label>
                    <input
                        className="input" type="text" value={nameEdit}
                        onChange={e => setNameEdit(e.target.value)}
                        maxLength={255} placeholder="Your full name"
                    />
                  </div>
                  {nameMsg && (
                      <div className="form-hint" style={{ color: 'var(--success)', marginBottom: '0.5rem' }}>
                        {nameMsg}
                      </div>
                  )}
                  <button className="btn btn-secondary btn-sm" type="submit" disabled={nameSaving}>
                    {nameSaving ? <><span className="spinner" />Saving</> : 'Save Name'}
                  </button>
                </form>
              </div>
            </div>

            {/* Appearance */}
            {!isForcedChange && (
                <div className="card">
                  <div className="card-body">
                    <SectionTitle accent="var(--warning)">Appearance</SectionTitle>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: '1rem',
                    }}>
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Dark Mode</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                          {darkMode ? 'Currently using matte black theme.' : 'Currently using warm light theme.'}
                        </div>
                      </div>
                      <button
                          className={`toggle-track${darkMode ? ' on' : ''}`}
                          onClick={() => toggleDarkMode(api)}
                          aria-checked={darkMode}
                          role="switch"
                          aria-label="Toggle dark mode"
                      >
                        <span className="toggle-thumb" />
                      </button>
                    </div>
                  </div>
                </div>
            )}

            {/* Quota snapshot */}
            {profile && (
                <div className="card">
                  <div className="card-body">
                    <SectionTitle accent="var(--success)">Your Quotas</SectionTitle>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                      <QuotaTile label="CPU"    value={`${profile.cpuQuota} cores`} />
                      <QuotaTile label="RAM"    value={`${profile.ramQuotaMb} MB`} />
                      <QuotaTile label="Disk"   value={`${profile.storageQuotaMb} MB`} />
                      <QuotaTile label="Projects" value={profile.maxProjects} />
                      <QuotaTile label="DBs"   value={profile.maxDatabases} />
                    </div>
                    <div className="form-hint" style={{ marginTop: '0.6rem' }}>
                      Need more?{' '}
                      <a href="/resource-requests" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                        Submit a resource request →
                      </a>
                    </div>
                  </div>
                </div>
            )}
          </div>
        </div>

        <style>{`
        .profile-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.85rem;
          align-items: start;
        }
        .profile-col { display: flex; flex-direction: column; gap: 0.85rem; min-width: 0; }
        @media (max-width: 900px) { .profile-grid { grid-template-columns: 1fr; } }
      `}</style>
      </div>
  );
}

function SectionTitle({ children, accent }) {
  return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.65rem' }}>
        <span style={{ width: 3, height: 13, background: accent, display: 'inline-block' }} />
        <span style={{
          fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.1em', color: 'var(--text-primary)',
        }}>{children}</span>
      </div>
  );
}

function QuotaTile({ label, value }) {
  return (
      <div style={{ border: '1px solid var(--border)', padding: '0.55rem 0.7rem' }}>
        <div style={{
          fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.08em', color: 'var(--text-muted)',
        }}>{label}</div>
        <div className="mono" style={{
          fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)',
          marginTop: '0.15rem',
        }}>{value}</div>
      </div>
  );
}