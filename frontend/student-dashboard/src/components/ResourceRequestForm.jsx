import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';

// ─────────────────────────────────────────────────────────────────────────────
// ResourceRequestForm
//
// Lets the student submit ONE bundle containing 1..N resource rows (cpu, ram,
// storage, projects, databases). The backend model is one row per resource, so
// we POST each row in parallel and group the resulting history by submitted
// timestamp in the UI.
//
// Current quotas are fetched from GET /api/student/profile so we can show
// a delta (current → requested) and highlight it.
// ─────────────────────────────────────────────────────────────────────────────

const RESOURCE_META = {
  cpu:       { label: 'CPU Cores',   unit: 'cores', placeholder: 'e.g. 4',    quotaField: 'cpuQuota' },
  ram:       { label: 'RAM',         unit: 'MB',    placeholder: 'e.g. 2048', quotaField: 'ramQuotaMb' },
  storage:   { label: 'Storage',     unit: 'MB',    placeholder: 'e.g. 5120', quotaField: 'storageQuotaMb' },
  projects:  { label: 'Max Projects',unit: 'count', placeholder: 'e.g. 6',    quotaField: 'maxProjects' },
  databases: { label: 'Max DBs',     unit: 'count', placeholder: 'e.g. 6',    quotaField: 'maxDatabases' },
};

const STATUS_BADGE = {
  pending:  'badge-pending',
  approved: 'badge-approved',
  denied:   'badge-denied',
};

const ALL_TYPES = Object.keys(RESOURCE_META);

function newRow() {
  return { key: Math.random().toString(36).slice(2), type: 'cpu', value: '' };
}

export default function ResourceRequestForm() {
  // ── form state ──
  const [rows,        setRows]        = useState([newRow()]);
  const [description, setDescription] = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [submitErr,   setSubmitErr]   = useState('');
  const [submitOk,    setSubmitOk]    = useState('');

  // ── data ──
  const [currentQuota, setCurrentQuota] = useState(null);
  const [requests,     setRequests]     = useState([]);
  const [reqLoading,   setReqLoading]   = useState(true);
  const [page,         setPage]         = useState(1);
  const [totalPages,   setTotalPages]   = useState(1);

  const loadProfile = useCallback(async () => {
    try {
      const res = await api.get('/student/profile');
      setCurrentQuota(res.data.data || null);
    } catch {
      setCurrentQuota(null);
    }
  }, []);

  const loadRequests = useCallback(async (pg = 1) => {
    setReqLoading(true);
    try {
      const res  = await api.get('/resource-requests', { params: { page: pg, limit: 20 } });
      const data = res.data.data;
      setRequests(data.items || []);
      setTotalPages(data.pagination?.totalPages || 1);
      setPage(pg);
    } catch {
      setRequests([]);
    } finally {
      setReqLoading(false);
    }
  }, []);

  useEffect(() => { loadProfile(); loadRequests(1); }, [loadProfile, loadRequests]);

  // ── row helpers ──
  const addRow    = () => setRows(rs => [...rs, newRow()]);
  const removeRow = (key) => setRows(rs => rs.length > 1 ? rs.filter(r => r.key !== key) : rs);
  const updateRow = (key, patch) => setRows(rs => rs.map(r => r.key === key ? { ...r, ...patch } : r));

  // Types already chosen (to block duplicates in the dropdown).
  const chosenTypes = new Set(rows.map(r => r.type));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitErr(''); setSubmitOk('');

    // Validate
    for (const r of rows) {
      if (!r.value.trim()) { setSubmitErr('Every resource row needs a requested value.'); return; }
      if (isNaN(Number(r.value))) { setSubmitErr(`"${r.value}" is not a number.`); return; }
      if (Number(r.value) <= 0) { setSubmitErr('Requested values must be greater than zero.'); return; }
    }
    // Duplicates
    const typeCounts = rows.reduce((acc, r) => { acc[r.type] = (acc[r.type] || 0) + 1; return acc; }, {});
    const dup = Object.entries(typeCounts).find(([, c]) => c > 1);
    if (dup) { setSubmitErr(`You cannot request "${RESOURCE_META[dup[0]].label}" twice in the same bundle.`); return; }

    if (!description.trim()) { setSubmitErr('Justification is required.'); return; }

    setSubmitting(true);
    try {
      // Submit each row in parallel — backend model is one resource per row.
      const results = await Promise.allSettled(rows.map(r =>
          api.post('/resource-requests', {
            resourceType:   r.type,
            requestedValue: r.value.trim(),
            description:    description.trim(),
          })
      ));

      const failed = results.filter(x => x.status === 'rejected');
      if (failed.length === 0) {
        setSubmitOk(`Submitted ${rows.length} resource request${rows.length > 1 ? 's' : ''}.`);
        setRows([newRow()]);
        setDescription('');
      } else if (failed.length === rows.length) {
        const first = failed[0].reason?.response?.data?.message;
        setSubmitErr(first || 'All requests failed.');
      } else {
        setSubmitOk(`${rows.length - failed.length} of ${rows.length} submitted. ${failed.length} failed.`);
      }
      loadRequests(1);
    } catch (err) {
      setSubmitErr(err.response?.data?.message || 'Failed to submit.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
      <div>
        {/* ── Current quotas snapshot ─────────────────────────────── */}
        {currentQuota && (
            <div className="card" style={{ marginBottom: '1rem' }}>
              <div className="card-body">
                <div className="card-title">Current Quotas</div>
                <div className="grid grid-4">
                  {ALL_TYPES.map(t => {
                    const meta = RESOURCE_META[t];
                    const val  = currentQuota[meta.quotaField];
                    return (
                        <div key={t} className="gauge">
                          <div className="gauge-head">
                            <div className="gauge-label">{meta.label}</div>
                            <div className="gauge-value mono">{val ?? '—'}</div>
                          </div>
                          <div className="gauge-foot">
                            <span>{meta.unit}</span>
                          </div>
                        </div>
                    );
                  })}
                </div>
              </div>
            </div>
        )}

        {/* ── Multi-row bundle form ───────────────────────────────── */}
        <div className="card" style={{ marginBottom: '1.25rem' }}>
          <div className="card-body">
            <div className="card-title">New Resource Request</div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.9rem' }}>
              Add one row per resource you need raised. Each value is the
              <em> new total</em> (not a delta). Your admin reviews all rows
              in the same bundle under one justification.
            </p>

            <form onSubmit={handleSubmit}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                {rows.map((r, idx) => {
                  const meta    = RESOURCE_META[r.type];
                  const current = currentQuota ? currentQuota[meta.quotaField] : null;
                  const reqNum  = Number(r.value);
                  const hasDelta = r.value && !isNaN(reqNum) && current != null;
                  const isIncrease = hasDelta && reqNum > Number(current);
                  const isSameOrLower = hasDelta && reqNum <= Number(current);

                  return (
                      <div key={r.key} style={styles.rowWrap}>
                        <select
                            className="input"
                            value={r.type}
                            onChange={e => updateRow(r.key, { type: e.target.value })}
                            style={styles.typeSel}
                        >
                          {ALL_TYPES.map(t => (
                              <option
                                  key={t}
                                  value={t}
                                  disabled={t !== r.type && chosenTypes.has(t)}
                              >
                                {RESOURCE_META[t].label}
                              </option>
                          ))}
                        </select>

                        <input
                            className="input mono"
                            type="text"
                            value={r.value}
                            onChange={e => updateRow(r.key, { value: e.target.value.replace(/[^\d.]/g, '') })}
                            placeholder={meta.placeholder}
                            maxLength={20}
                            style={styles.valueIn}
                        />

                        <div style={styles.deltaCol} className="mono">
                          {hasDelta ? (
                              <span className={`delta-row ${isSameOrLower ? 'delta-same' : ''}`}>
                          <span className="delta-from">{current}</span>
                          <span className="delta-arrow">→</span>
                          <span className={isIncrease ? 'delta-to' : 'delta-same'}>
                            {r.value}
                          </span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {meta.unit}
                          </span>
                        </span>
                          ) : (
                              <span style={{ color: 'var(--text-faint)', fontSize: '0.75rem' }}>
                          {current != null ? `now: ${current} ${meta.unit}` : meta.unit}
                        </span>
                          )}
                        </div>

                        <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => removeRow(r.key)}
                            disabled={rows.length === 1}
                            title="Remove row"
                            style={{ flexShrink: 0 }}
                        >
                          ×
                        </button>
                      </div>
                  );
                })}
              </div>

              <div style={{ marginTop: '0.65rem', display: 'flex', gap: '0.5rem' }}>
                <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={addRow}
                    disabled={rows.length >= ALL_TYPES.length}
                >
                  + Add resource
                </button>
              </div>

              <div className="form-group" style={{ marginTop: '1rem' }}>
                <label className="form-label">Justification (shared)</label>
                <textarea
                    className="input"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    rows={3}
                    placeholder="Explain why you need these raised…"
                    maxLength={2000}
                />
                <span className="form-hint">Applied to every row in this bundle.</span>
              </div>

              {submitErr && <div className="alert alert-error"   style={{ marginBottom: '0.75rem' }}>{submitErr}</div>}
              {submitOk  && <div className="alert alert-success" style={{ marginBottom: '0.75rem' }}>{submitOk}</div>}

              <button className="btn btn-primary" type="submit" disabled={submitting}>
                {submitting ? <><span className="spinner" />Submitting</> : `Submit ${rows.length > 1 ? `${rows.length} Requests` : 'Request'}`}
              </button>
            </form>
          </div>
        </div>

        {/* ── History ─────────────────────────────────────────────── */}
        <div className="section-header" style={{ marginBottom: '0.85rem' }}>
          <h3 className="card-title" style={{ marginBottom: 0 }}>Request History</h3>
          <button className="btn btn-ghost btn-sm" onClick={() => loadRequests(1)}>↻ Refresh</button>
        </div>

        {reqLoading ? (
            <div className="spinner-center"><div className="spinner" /></div>
        ) : requests.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">↑</div>
              <div className="empty-state-title">No requests yet</div>
              <div className="empty-state-subtitle">Submit your first bundle above.</div>
            </div>
        ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {groupByBundle(requests).map(group => (
                    <BundleCard key={group.key} group={group} currentQuota={currentQuota} />
                ))}
              </div>

              {totalPages > 1 && (
                  <div style={styles.pagination}>
                    <button className="btn btn-ghost btn-sm" disabled={page <= 1}          onClick={() => loadRequests(page - 1)}>← Prev</button>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Page {page} of {totalPages}</span>
                    <button className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => loadRequests(page + 1)}>Next →</button>
                  </div>
              )}
            </>
        )}
      </div>
  );
}

// ── Group rows submitted within the same 2-second window with same description
// ── into one "bundle" card.
function groupByBundle(items) {
  const groups = [];
  for (const it of items) {
    const ts = new Date(it.createdAt).getTime();
    const last = groups[groups.length - 1];
    if (last &&
        last.description === it.description &&
        Math.abs(new Date(last.createdAt).getTime() - ts) <= 3000) {
      last.items.push(it);
    } else {
      groups.push({
        key:         `${it.id}`,
        createdAt:   it.createdAt,
        description: it.description,
        items:       [it],
      });
    }
  }
  return groups;
}

function BundleCard({ group, currentQuota }) {
  return (
      <div className="card">
        <div className="card-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div>
              <div className="card-title" style={{ marginBottom: '0.25rem' }}>
                Bundle · {group.items.length} resource{group.items.length > 1 ? 's' : ''}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }} className="mono">
                {new Date(group.createdAt).toLocaleString()}
              </div>
            </div>
          </div>

          <div className="divider" />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {group.items.map(it => {
              const meta    = RESOURCE_META[it.resourceType] || { label: it.resourceType, unit: '', quotaField: null };
              const current = currentQuota && meta.quotaField ? currentQuota[meta.quotaField] : null;
              const reqNum  = Number(it.requestedValue);
              const hasDelta = current != null && !isNaN(reqNum);
              const isIncrease = hasDelta && reqNum > Number(current);
              return (
                  <div key={it.id} style={styles.histRow}>
                <span className={`badge ${STATUS_BADGE[it.status] || 'badge-stopped'}`}>
                  {it.status}
                </span>
                    <span style={{ fontWeight: 700, fontSize: '0.8rem', minWidth: 120 }}>
                  {meta.label}
                </span>
                    <span className="delta-row mono">
                  {hasDelta ? (
                      <>
                        <span className="delta-from">{current}</span>
                        <span className="delta-arrow">→</span>
                        <span className={isIncrease ? 'delta-to' : 'delta-same'}>
                        {it.requestedValue}
                      </span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{meta.unit}</span>
                      </>
                  ) : (
                      <span className="delta-to">{it.requestedValue} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{meta.unit}</span></span>
                  )}
                </span>
                    {it.reviewedAt && (
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginLeft: 'auto' }} className="mono">
                    {new Date(it.reviewedAt).toLocaleDateString()}
                  </span>
                    )}
                  </div>
              );
            })}
          </div>

          <div className="divider" />

          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          <span style={{ color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.08em', marginRight: '0.4rem' }}>
            Justification:
          </span>
            {group.description}
          </div>

          {group.items.some(i => i.adminNotes) && (
              <div style={styles.adminNote}>
                <div style={{ fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.25rem', color: 'var(--text-muted)' }}>
                  Admin notes
                </div>
                {group.items.filter(i => i.adminNotes).map(i => (
                    <div key={i.id} style={{ fontSize: '0.78rem', marginBottom: '0.2rem' }}>
                      <span className="mono" style={{ color: 'var(--text-muted)' }}>[{RESOURCE_META[i.resourceType]?.label || i.resourceType}]</span>
                      {' '}{i.adminNotes}
                    </div>
                ))}
              </div>
          )}
        </div>
      </div>
  );
}

const styles = {
  rowWrap: {
    display: 'grid',
    gridTemplateColumns: '160px 140px 1fr 36px',
    gap: '0.5rem',
    alignItems: 'center',
  },
  typeSel:  { paddingRight: '0.5rem' },
  valueIn:  { textAlign: 'right' },
  deltaCol: { overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
  histRow: {
    display: 'flex',
    gap: '0.75rem',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  adminNote: {
    marginTop: '0.75rem',
    padding: '0.5rem 0.7rem',
    background: 'var(--bg-secondary)',
    borderLeft: '2px solid var(--border-strong)',
  },
  pagination: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: '1rem', marginTop: '1rem',
  },
};