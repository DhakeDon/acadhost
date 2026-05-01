import React, { useState, useCallback } from 'react';
import api from '../services/api';

// ─────────────────────────────────────────────────────────────────────────────
// DatabaseSection
// - Gauge for quota usage (not a pill)
// - Grid-based DB cards
// - Delete button + confirmation modal
// - "Open phpMyAdmin" always opens the RIGHT database (see launch.php/signon.php)
// ─────────────────────────────────────────────────────────────────────────────

export default function DatabaseSection({ databases, quota, onRefresh }) {
  const [newDbName, setNewDbName] = useState('');
  const [creating,  setCreating]  = useState(false);
  const [createErr, setCreateErr] = useState('');
  const [createOk,  setCreateOk]  = useState('');

  const atLimit = quota && quota.used >= quota.total;
  const usedPct = quota ? Math.min(100, Math.round((quota.used / Math.max(1, quota.total)) * 100)) : 0;
  const gaugeCls = usedPct >= 90 ? 'danger' : usedPct >= 70 ? 'warn' : '';

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreateErr(''); setCreateOk('');

    const name = newDbName.trim();
    if (!name) { setCreateErr('Database name is required.'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(name)) {
      setCreateErr('Alphanumeric and underscores only.'); return;
    }
    if (name.length > 64) {
      setCreateErr('Name must be 64 characters or fewer.'); return;
    }

    setCreating(true);
    try {
      const res = await api.post('/databases', { dbName: name });
      setCreateOk(`Database "${res.data.data.dbName}" created.`);
      setNewDbName('');
      onRefresh?.();
    } catch (err) {
      const code = err.response?.data?.error;
      const msgs = {
        VALIDATION_ERROR:         err.response?.data?.message || 'Invalid database name.',
        DATABASE_NAME_DUPLICATE:  `You already have a database named '${name}'.`,
        DATABASE_QUOTA_EXCEEDED:  "You've reached your database limit.",
      };
      setCreateErr(msgs[code] || err.response?.data?.message || 'Failed to create database.');
    } finally {
      setCreating(false);
    }
  };

  return (
      <div>
        {/* ── Quota gauge card ─────────────────────────────────── */}
        {quota && (
            <div className="card" style={{ marginBottom: '1rem' }}>
              <div className="card-body">
                <div className="gauge">
                  <div className="gauge-head">
                    <div className="gauge-label">Database Quota</div>
                    <div className="gauge-value">
                      {quota.used}<span className="gauge-total">/{quota.total}</span>
                    </div>
                  </div>
                  <div className="gauge-track">
                    <div className={`gauge-fill ${gaugeCls}`} style={{ width: `${usedPct}%` }} />
                  </div>
                  <div className="gauge-foot">
                    <span>{usedPct}% used</span>
                    <span>{quota.total - quota.used} remaining</span>
                  </div>
                </div>
              </div>
            </div>
        )}

        {/* ── Create form ─────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: '1.25rem' }}>
          <div className="card-body">
            <div className="card-title">Create Database</div>

            {atLimit ? (
                <div className="alert alert-warning">
                  Database limit reached ({quota.used}/{quota.total}).
                  Submit a resource request to raise your quota.
                </div>
            ) : (
                <form onSubmit={handleCreate} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div className="form-group" style={{ flex: 1, marginBottom: 0, minWidth: 180 }}>
                    <label className="form-label">Database Name</label>
                    <input
                        className={`input${createErr ? ' input-error' : ''}`}
                        type="text"
                        value={newDbName}
                        onChange={e => { setNewDbName(e.target.value); setCreateErr(''); setCreateOk(''); }}
                        maxLength={64}
                        placeholder="my_database"
                        pattern="[a-zA-Z0-9_]+"
                        title="Alphanumeric and underscores only"
                    />
                  </div>
                  <button className="btn btn-primary" type="submit" disabled={creating}>
                    {creating ? <><span className="spinner" />Creating</> : '+ Create'}
                  </button>
                </form>
            )}

            {createErr && <div className="form-error" style={{ marginTop: '0.5rem' }}>{createErr}</div>}
            {createOk  && <div className="alert alert-success" style={{ marginTop: '0.6rem' }}>{createOk}</div>}
          </div>
        </div>

        {/* ── Database grid ──────────────────────────────────── */}
        {databases.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">⬡</div>
              <div className="empty-state-title">No databases</div>
              <div className="empty-state-subtitle">Create your first database above.</div>
            </div>
        ) : (
            <div className="grid grid-2">
              {databases.map(db => (
                  <DbCard key={db.id} db={db} onDeleted={onRefresh} />
              ))}
            </div>
        )}
      </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function DbCard({ db, onDeleted }) {
  const [opening, setOpening] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');

  const handleOpen = async () => {
    setOpening(true);
    try {
      const res = await api.get(`/databases/${db.id}/phpmyadmin`);
      // window.open keeps each click independent; the launcher now forces a
      // fresh signon for the current databaseId.
      window.open(res.data.data.phpMyAdminUrl, '_blank', 'noopener,noreferrer');
    } catch {
      alert('Failed to open phpMyAdmin. Please try again.');
    } finally {
      setOpening(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true); setDeleteErr('');
    try {
      await api.delete(`/databases/${db.id}`);
      setConfirmOpen(false);
      onDeleted?.();
    } catch (err) {
      const code = err.response?.data?.error;
      const msgs = {
        DATABASE_NOT_FOUND: 'Database not found.',
        DATABASE_IN_USE:    err.response?.data?.message || 'Detach it from every project first.',
      };
      setDeleteErr(msgs[code] || err.response?.data?.message || 'Failed to delete.');
    } finally {
      setDeleting(false);
    }
  };

  return (
      <>
        <div className="card">
          <div className="card-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
              <div style={{ minWidth: 0 }}>
                <div className="card-heading" style={{ wordBreak: 'break-word' }}>{db.dbName}</div>
                <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.15rem', wordBreak: 'break-all' }}>
                  {db.mysqlSchemaName}
                </div>
              </div>
              <span className="badge badge-running">MYSQL</span>
            </div>

            <div className="divider" />

            <div className="kv" style={{ marginBottom: '0.85rem' }}>
              <span className="kv-k">Created</span>
              <span className="kv-v mono">
              {db.createdAt ? new Date(db.createdAt).toLocaleString() : '—'}
            </span>
            </div>

            <div
                style={{
                  display: 'flex',
                  gap: '0.6rem',
                  flexWrap: 'wrap',
                  alignItems: 'center'
                }}
            >
              <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleOpen}
                  disabled={opening}
                  style={{
                    flex: '0 0 auto', // prevents ugly stretching
                    minWidth: '180px',
                    maxWidth: '220px',
                    padding: '0.65rem 1rem',
                    fontWeight: '600',
                    letterSpacing: '0.4px',
                    color: '#4ade80', // green text
                    border: '1px solid #22c55e',
                    background: 'rgba(34,197,94,0.08)',
                    borderRadius: '8px'
                  }}
              >
                {opening ? (
                    <>
                      <span className="spinner" /> Opening
                    </>
                ) : (
                    'Open phpMyAdmin ↗'
                )}
              </button>

              <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setConfirmOpen(true);
                    setDeleteErr('');
                  }}
                  disabled={deleting}
                  title="Delete database"
                  style={{
                    flex: '0 0 auto',
                    padding: '0.65rem 1rem',
                    color: '#ef4444',
                    border: '1px solid #ef4444',
                    background: 'rgba(239,68,68,0.06)',
                    borderRadius: '8px',
                    fontWeight: '600'
                  }}
              >
                {deleting ? <span className="spinner" /> : '× Delete'}
              </button>
            </div>
          </div>
        </div>

        {confirmOpen && (
            <div className="modal-overlay" onClick={() => !deleting && setConfirmOpen(false)}>
              <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-title">Delete Database</div>
                <div className="modal-body">
                  <p style={{ marginBottom: '0.65rem' }}>
                    Delete <strong className="mono">{db.dbName}</strong>? This drops
                    the MySQL schema, its user, and <strong>cannot be undone</strong>.
                  </p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Detach it from every project first, or the server will refuse.
                  </p>
                  {deleteErr && (
                      <div className="alert alert-error" style={{ marginTop: '0.75rem' }}>{deleteErr}</div>
                  )}
                </div>
                <div className="modal-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirmOpen(false)} disabled={deleting}>
                    Cancel
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={handleDelete} disabled={deleting}>
                    {deleting ? <><span className="spinner" />Deleting</> : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
        )}
      </>
  );
}