import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import Pagination from './Pagination';
import { useToast } from '../context/ToastContext';

const RESOURCE_LABELS = {
  cpu: 'CPU (cores)',
  ram: 'RAM (MB)',
  storage: 'Storage (MB)',
  projects: 'Max Projects',
  databases: 'Max Databases',
};

const STATUS_BADGE = {
  pending:  { color: 'var(--badge-pending)',  label: 'Pending' },
  approved: { color: 'var(--badge-approved)', label: 'Approved' },
  denied:   { color: 'var(--badge-denied)',   label: 'Denied' },
};

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export default function ResourceRequestList() {
  const { toast } = useToast();
  const [requests, setRequests] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, totalItems: 0, totalPages: 1 });
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reviewingId, setReviewingId] = useState(null);
  const [notes, setNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(null);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (statusFilter) params.status = statusFilter;
      const res = await api.get('/resource-requests', { params });
      const items = (res.data.data.items || []).sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (a.status !== 'pending' && b.status === 'pending') return 1;
        return 0;
      });
      setRequests(items);
      setPagination(res.data.data.pagination);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load resource requests');
    } finally {
      setLoading(false);
    }
  }, [page, limit, statusFilter]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  async function handleReview(requestId, decision) {
    setActionLoading(requestId + '-' + decision);
    try {
      const payload = { status: decision };
      if (notes.trim()) payload.adminNotes = notes.trim();
      const res = await api.put(`/resource-requests/${requestId}`, payload);
      const applied = res.data.data.quotaApplied;
      if (decision === 'approved') {
        toast.success(`Request approved.${applied ? ' Quota updated automatically.' : ''}`);
      } else {
        toast.info('Request denied.');
      }
      setReviewingId(null);
      setNotes('');
      fetchRequests();
    } catch (err) {
      const code = err.response?.data?.error;
      if (code === 'REQUEST_NOT_FOUND') toast.error('Resource request not found.');
      else if (code === 'REQUEST_ALREADY_REVIEWED') toast.warning('This request has already been reviewed.');
      else toast.error(err.response?.data?.message || 'Failed to review request');
    } finally {
      setActionLoading(null);
    }
  }

  return (
      <div className="rrl">
        <div className="rrl-header">
          <h2 className="rrl-title">Resource Requests</h2>
          <span className="rrl-count">{pagination.totalItems} total</span>
        </div>

        <div className="rrl-filters">
          <select
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
              className="rrl-select"
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="denied">Denied</option>
          </select>
          <label className="rrl-page-size">
            <span>Show</span>
            <select
                value={limit}
                onChange={e => { setLimit(parseInt(e.target.value, 10)); setPage(1); }}
                className="rrl-select rrl-select-sm"
            >
              {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span>per page</span>
          </label>
        </div>

        {!loading && !error && (
            <Pagination
                page={pagination.page}
                totalPages={pagination.totalPages}
                onPrev={() => setPage(p => Math.max(1, p - 1))}
                onNext={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                onJump={(p) => setPage(p)}
                totalItems={pagination.totalItems}
                limit={limit}
            />
        )}

        {loading && (
            <div className="rrl-state"><div className="spinner" /> Loading requests…</div>
        )}
        {error && !loading && (
            <div className="rrl-state error">⚠ {error} <button onClick={fetchRequests} className="btn-sm">Retry</button></div>
        )}

        {!loading && !error && (
            <>
              <div className="rrl-list">
                {requests.length === 0 && (
                    <div className="rrl-empty">No resource requests found</div>
                )}
                {requests.map(req => {
                  const badge = STATUS_BADGE[req.status] || { color: 'var(--text-secondary)', label: req.status };
                  const isReviewing = reviewingId === req.id;

                  return (
                      <div key={req.id} className={`rrl-card${req.status === 'pending' ? ' pending' : ''}`}>
                        <div className="rrl-card-top">
                          <div className="rrl-card-meta">
                            <div className="rrl-student">
                              <span className="rrl-student-name">{req.student?.name || '—'}</span>
                              <span className="rrl-student-email">{req.student?.email}</span>
                            </div>
                            <div className="rrl-details">
                              <span className="rrl-resource-type">{RESOURCE_LABELS[req.resourceType] || req.resourceType}</span>
                              <span className="rrl-arrow">→</span>
                              <span className="rrl-requested-value">{req.requestedValue}</span>
                            </div>
                            <p className="rrl-description">{req.description}</p>
                            {req.adminNotes && (
                                <div className="rrl-admin-notes">
                                  <span className="rrl-notes-label">Admin notes:</span> {req.adminNotes}
                                </div>
                            )}
                            <div className="rrl-timestamps">
                              <span>Submitted {new Date(req.createdAt).toLocaleDateString()}</span>
                              {req.reviewedAt && (
                                  <span>· Reviewed {new Date(req.reviewedAt).toLocaleDateString()}</span>
                              )}
                            </div>
                          </div>
                          <div className="rrl-card-right">
                      <span
                          className="rrl-badge"
                          style={{
                            color: badge.color,
                            background: `color-mix(in srgb, ${badge.color} 14%, transparent)`,
                            borderColor: `color-mix(in srgb, ${badge.color} 30%, transparent)`,
                          }}
                      >
                        {badge.label}
                      </span>
                          </div>
                        </div>

                        {req.status === 'pending' && (
                            <div className="rrl-review-panel">
                              {!isReviewing ? (
                                  <button
                                      className="btn-review"
                                      onClick={() => { setReviewingId(req.id); setNotes(''); }}
                                  >
                                    Review Request
                                  </button>
                              ) : (
                                  <div className="rrl-review-form">
                          <textarea
                              className="rrl-notes-input"
                              placeholder="Admin notes (optional, max 1000 chars)…"
                              value={notes}
                              onChange={e => setNotes(e.target.value.slice(0, 1000))}
                              rows={2}
                          />
                                    <div className="rrl-review-actions">
                                      <button
                                          className="btn-approve"
                                          onClick={() => handleReview(req.id, 'approved')}
                                          disabled={!!actionLoading}
                                      >
                                        {actionLoading === req.id + '-approved' ? '…' : '✓ Approve'}
                                      </button>
                                      <button
                                          className="btn-deny"
                                          onClick={() => handleReview(req.id, 'denied')}
                                          disabled={!!actionLoading}
                                      >
                                        {actionLoading === req.id + '-denied' ? '…' : '✗ Deny'}
                                      </button>
                                      <button
                                          className="btn-cancel-review"
                                          onClick={() => setReviewingId(null)}
                                          disabled={!!actionLoading}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                              )}
                            </div>
                        )}
                      </div>
                  );
                })}
              </div>

              <Pagination
                  page={pagination.page}
                  totalPages={pagination.totalPages}
                  onPrev={() => setPage(p => Math.max(1, p - 1))}
                  onNext={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                  onJump={(p) => setPage(p)}
                  totalItems={pagination.totalItems}
                  limit={limit}
              />
            </>
        )}

        <style>{`
        .rrl { font-family: 'Inter','DM Sans','Segoe UI',sans-serif; }
        .rrl-header { display: flex; align-items: baseline; gap: 0.75rem; margin-bottom: 1.25rem; }
        .rrl-title { font-size: 1.25rem; font-weight: 700; color: var(--text-primary); margin: 0; letter-spacing: -0.01em; }
        .rrl-count { font-size: 0.8rem; color: var(--text-secondary); }
        .rrl-filters { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap; }
        .rrl-select {
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--input-border); border-radius: 7px;
          background: var(--input-bg); color: var(--text-primary);
          font-size: 0.85rem; font-family: inherit; cursor: pointer;
        }
        .rrl-select-sm { padding: 0.4rem 0.6rem; }
        .rrl-page-size {
          display: inline-flex; align-items: center; gap: 0.5rem;
          font-size: 0.8rem; color: var(--text-secondary); margin-left: auto;
        }

        .rrl-list { display: flex; flex-direction: column; gap: 0.75rem; }
        .rrl-card {
          background: var(--card-bg); border: 1px solid var(--border);
          border-radius: 10px; padding: 1rem 1.25rem;
          box-shadow: var(--card-shadow);
        }
        .rrl-card.pending { border-left: 3px solid var(--warning); }
        .rrl-card-top { display: flex; gap: 1rem; justify-content: space-between; align-items: flex-start; }
        .rrl-card-meta { flex: 1; display: flex; flex-direction: column; gap: 0.4rem; }
        .rrl-student { display: flex; flex-direction: column; gap: 0.1rem; }
        .rrl-student-name { font-weight: 700; font-size: 0.875rem; color: var(--text-primary); }
        .rrl-student-email { font-size: 0.75rem; color: var(--text-secondary); }
        .rrl-details { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
        .rrl-resource-type { font-size: 0.78rem; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.04em; }
        .rrl-arrow { color: var(--text-muted); }
        .rrl-requested-value { font-size: 1rem; font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums; }
        .rrl-description { font-size: 0.82rem; color: var(--text-primary); margin: 0; line-height: 1.5; }
        .rrl-admin-notes {
          font-size: 0.78rem; color: var(--text-secondary);
          background: var(--bg-tertiary); padding: 0.4rem 0.7rem;
          border-radius: 6px; border-left: 2px solid var(--border-strong);
        }
        .rrl-notes-label { font-weight: 600; color: var(--text-primary); }
        .rrl-timestamps { font-size: 0.72rem; color: var(--text-secondary); display: flex; gap: 0.4rem; flex-wrap: wrap; }
        .rrl-card-right { flex-shrink: 0; }
        .rrl-badge {
          display: inline-flex; padding: 0.25rem 0.7rem;
          border-radius: 12px; font-size: 0.72rem; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.04em;
          border: 1px solid;
        }
        .rrl-review-panel { margin-top: 0.875rem; padding-top: 0.875rem; border-top: 1px solid var(--border); }
        .btn-review {
          background: var(--bg-tertiary); border: 1px solid var(--border);
          color: var(--text-primary); padding: 0.4rem 0.9rem;
          border-radius: 6px; font-size: 0.8rem; font-weight: 600;
          cursor: pointer; font-family: inherit;
        }
        .btn-review:hover { background: var(--border); }
        .rrl-review-form { display: flex; flex-direction: column; gap: 0.6rem; }
        .rrl-notes-input {
          padding: 0.5rem 0.75rem; border: 1px solid var(--input-border);
          border-radius: 7px; background: var(--input-bg);
          color: var(--text-primary); font-size: 0.83rem;
          resize: vertical; font-family: inherit;
          width: 100%; box-sizing: border-box;
        }
        .rrl-notes-input:focus { outline: none; border-color: var(--input-focus); box-shadow: 0 0 0 3px var(--accent-soft); }
        .rrl-review-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
        .btn-approve, .btn-deny, .btn-cancel-review {
          padding: 0.4rem 1rem; border-radius: 6px;
          font-size: 0.8rem; font-weight: 600;
          cursor: pointer; font-family: inherit; border: 1px solid transparent;
          transition: filter 0.15s;
        }
        .btn-approve {
          background: color-mix(in srgb, var(--success) 14%, transparent);
          color: var(--success);
          border-color: color-mix(in srgb, var(--success) 30%, transparent);
        }
        .btn-deny {
          background: color-mix(in srgb, var(--error) 14%, transparent);
          color: var(--error);
          border-color: color-mix(in srgb, var(--error) 30%, transparent);
        }
        .btn-cancel-review {
          background: var(--bg-tertiary); border-color: var(--border);
          color: var(--text-secondary);
        }
        .btn-approve:hover, .btn-deny:hover { filter: brightness(1.08); }
        .btn-approve:disabled, .btn-deny:disabled, .btn-cancel-review:disabled { opacity: 0.5; cursor: not-allowed; }

        .rrl-state { display: flex; align-items: center; justify-content: center; gap: 0.75rem; padding: 3rem 2rem; color: var(--text-secondary); font-size: 0.875rem; }
        .rrl-state.error { color: var(--error); }
        .rrl-empty { text-align: center; padding: 3rem 2rem; color: var(--text-secondary); background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; }
        .btn-sm { background: var(--accent); color: #fff; border: none; padding: 0.3rem 0.85rem; border-radius: 5px; cursor: pointer; font-size: 0.78rem; font-family: inherit; }
        .spinner { width: 16px; height: 16px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.6s linear infinite; display: inline-block; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      </div>
  );
}