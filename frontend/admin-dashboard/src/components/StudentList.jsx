import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import StudentQuotaEditor from './StudentQuotaEditor';
import Pagination from './Pagination';
import { useToast } from '../context/ToastContext';

const STATUS_BADGE = {
  invited:   { color: 'var(--badge-invited)',   label: 'Invited' },
  active:    { color: 'var(--badge-active)',    label: 'Active' },
  suspended: { color: 'var(--badge-suspended)', label: 'Suspended' },
  removed:   { color: 'var(--badge-removed)',   label: 'Removed' },
};

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function ConfirmModal({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }) {
  return (
      <div className="cm-overlay" onClick={onCancel}>
        <div className="cm-dialog" onClick={e => e.stopPropagation()}>
          <div className="cm-header">
            <span className="cm-title">{title}</span>
          </div>
          <p className="cm-message">{message}</p>
          <div className="cm-actions">
            <button className="cm-btn cm-btn-cancel" onClick={onCancel}>Cancel</button>
            <button className={`cm-btn ${danger ? 'cm-btn-danger' : 'cm-btn-confirm'}`} onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
  );
}

export default function StudentList() {
  const { toast } = useToast();
  const [students, setStudents] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, totalItems: 0, totalPages: 1 });
  const [filters, setFilters] = useState({ status: '', batchYear: '', search: '' });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingStudent, setEditingStudent] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (filters.status) params.status = filters.status;
      if (filters.batchYear) params.batchYear = filters.batchYear;
      if (filters.search) params.search = filters.search;
      const res = await api.get('/admin/students', { params });
      setStudents(res.data.data.items);
      setPagination(res.data.data.pagination);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load students');
    } finally {
      setLoading(false);
    }
  }, [page, limit, filters]);

  useEffect(() => { fetchStudents(); }, [fetchStudents]);

  function showConfirm(options) {
    return new Promise(resolve => {
      setConfirmDialog({
        ...options,
        onConfirm: () => { setConfirmDialog(null); resolve(true); },
        onCancel:  () => { setConfirmDialog(null); resolve(false); },
      });
    });
  }

  async function handleRemove(student) {
    const confirmed = await showConfirm({
      title: 'Remove Student',
      message: `Remove "${student.name || student.email}"?\n\nThis will permanently delete all their projects, databases, containers, and source files.\n\nThis action CANNOT be undone.`,
      confirmLabel: 'Remove Student',
      danger: true,
    });
    if (!confirmed) return;

    setActionLoading(student.id + '-remove');
    try {
      await api.delete(`/admin/students/${student.id}`);
      toast.success(`Student "${student.name || student.email}" removed.`);
      fetchStudents();
    } catch (err) {
      const code = err.response?.data?.error;
      if (code === 'CANNOT_DELETE_ADMIN') toast.error('Cannot delete the admin account.');
      else if (code === 'STUDENT_NOT_FOUND') toast.error('Student not found.');
      else toast.error(err.response?.data?.message || 'Failed to remove student');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleResendInvite(student) {
    setActionLoading(student.id + '-resend');
    try {
      const res = await api.post(`/admin/students/${student.id}/resend-invite`);
      toast.success(`Invitation resent to ${res.data.data.email}.`);
    } catch (err) {
      const code = err.response?.data?.error;
      if (code === 'ALREADY_REGISTERED') toast.warning('Student has already completed registration.');
      else toast.error(err.response?.data?.message || 'Failed to resend invite');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSuspend(student) {
    const confirmed = await showConfirm({
      title: 'Suspend Student',
      message: `Suspend "${student.name || student.email}"?\n\nThey will be logged out and unable to sign in until reactivated. Their data, containers, and running projects are preserved.`,
      confirmLabel: 'Suspend',
      danger: false,
    });
    if (!confirmed) return;

    setActionLoading(student.id + '-suspend');
    try {
      await api.post(`/admin/students/${student.id}/suspend`);
      toast.warning(`${student.name || student.email} suspended. Notification emailed.`);
      fetchStudents();
    } catch (err) {
      const code = err.response?.data?.error;
      if (code === 'CANNOT_SUSPEND_ADMIN') toast.error('Cannot suspend the admin account.');
      else if (code === 'ALREADY_SUSPENDED') toast.info('Student is already suspended.');
      else if (code === 'CANNOT_SUSPEND_INVITED') toast.warning('Student has not registered yet — cannot suspend.');
      else if (code === 'CANNOT_SUSPEND_REMOVED') toast.error('Cannot suspend a removed student.');
      else if (code === 'STUDENT_NOT_FOUND') toast.error('Student not found.');
      else toast.error(err.response?.data?.message || 'Failed to suspend student');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleUnsuspend(student) {
    setActionLoading(student.id + '-unsuspend');
    try {
      await api.post(`/admin/students/${student.id}/unsuspend`);
      toast.success(`${student.name || student.email} reactivated. Notification emailed.`);
      fetchStudents();
    } catch (err) {
      const code = err.response?.data?.error;
      if (code === 'NOT_SUSPENDED') toast.info('Student is not suspended.');
      else if (code === 'STUDENT_NOT_FOUND') toast.error('Student not found.');
      else toast.error(err.response?.data?.message || 'Failed to unsuspend student');
    } finally {
      setActionLoading(null);
    }
  }

  function handleFilterChange(field, value) {
    setFilters(f => ({ ...f, [field]: value }));
    setPage(1);
  }

  return (
      <div className="student-list">
        {confirmDialog && (
            <ConfirmModal
                title={confirmDialog.title}
                message={confirmDialog.message}
                confirmLabel={confirmDialog.confirmLabel}
                danger={confirmDialog.danger}
                onConfirm={confirmDialog.onConfirm}
                onCancel={confirmDialog.onCancel}
            />
        )}

        <div className="sl-header">
          <h2 className="sl-title">Students</h2>
          <span className="sl-count">{pagination.totalItems} total</span>
        </div>

        <div className="sl-filters">
          <input
              type="text"
              placeholder="Search name or email…"
              value={filters.search}
              onChange={e => handleFilterChange('search', e.target.value)}
              className="sl-input"
          />
          <select
              value={filters.status}
              onChange={e => handleFilterChange('status', e.target.value)}
              className="sl-select"
          >
            <option value="">All statuses</option>
            <option value="invited">Invited</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
          <input
              type="number"
              placeholder="Batch year…"
              value={filters.batchYear}
              onChange={e => handleFilterChange('batchYear', e.target.value)}
              className="sl-input sl-input-sm"
          />
          <label className="sl-page-size">
            <span>Show</span>
            <select
                value={limit}
                onChange={e => { setLimit(parseInt(e.target.value, 10)); setPage(1); }}
                className="sl-select sl-select-sm"
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
            <div className="sl-state"><div className="spinner" /> Loading students…</div>
        )}
        {error && !loading && (
            <div className="sl-state error">
              ⚠ {error}
              <button onClick={fetchStudents} className="btn-sm">Retry</button>
            </div>
        )}

        {!loading && !error && (
            <>
              <div className="sl-table-wrap">
                <table className="sl-table">
                  <thead>
                  <tr>
                    <th>Student</th>
                    <th>Batch</th>
                    <th>Status</th>
                    <th>CPU</th>
                    <th>RAM</th>
                    <th>Projects</th>
                    <th>Databases</th>
                    <th className="sl-th-actions">Actions</th>
                  </tr>
                  </thead>
                  <tbody>
                  {students.length === 0 && (
                      <tr><td colSpan={8} className="sl-empty">No students found</td></tr>
                  )}
                  {students.map(s => {
                    const badge = STATUS_BADGE[s.status] || { color: 'var(--text-secondary)', label: s.status };
                    return (
                        <tr key={s.id}>
                          <td>
                            <div className="sl-student-cell">
                              <span className="sl-name">{s.name || <em>Not registered</em>}</span>
                              <span className="sl-email">{s.email}</span>
                            </div>
                          </td>
                          <td className="sl-batch">{s.batchYear || '—'}</td>
                          <td>
                        <span
                            className="sl-badge"
                            style={{
                              color: badge.color,
                              background: `color-mix(in srgb, ${badge.color} 14%, transparent)`,
                              borderColor: `color-mix(in srgb, ${badge.color} 30%, transparent)`,
                            }}
                        >
                          <span className="sl-badge-dot" style={{ background: badge.color }} />
                          {badge.label}
                        </span>
                          </td>
                          <td className="sl-resource">
                            <span className="sl-used">{Number(s.cpuUsed || 0).toFixed(2)}</span>
                            <span className="sl-sep">/</span>
                            <span className="sl-quota">{Number(s.cpuQuota).toFixed(2)}</span>
                            <span className="sl-unit"> cores</span>
                          </td>
                          <td className="sl-resource">
                            <span className="sl-used">{s.ramUsedMb || 0}</span>
                            <span className="sl-sep">/</span>
                            <span className="sl-quota">{s.ramQuotaMb}</span>
                            <span className="sl-unit"> MB</span>
                          </td>
                          <td className="sl-resource">
                            <span className="sl-used">{s.projectCount}</span>
                            <span className="sl-sep">/</span>
                            <span className="sl-quota">{s.maxProjects}</span>
                          </td>
                          <td className="sl-resource">
                            <span className="sl-used">{s.databaseCount}</span>
                            <span className="sl-sep">/</span>
                            <span className="sl-quota">{s.maxDatabases}</span>
                          </td>
                          <td>
                            <div className="sl-actions">
                              {(s.status === 'active' || s.status === 'suspended') && (
                                  <button
                                      className="btn-action btn-quota"
                                      onClick={() => setEditingStudent(s)}
                                  >
                                    Edit Quota
                                  </button>
                              )}
                              {s.status === 'active' && (
                                  <button
                                      className="btn-action btn-suspend"
                                      onClick={() => handleSuspend(s)}
                                      disabled={actionLoading === s.id + '-suspend'}
                                  >
                                    {actionLoading === s.id + '-suspend' ? '…' : 'Suspend'}
                                  </button>
                              )}
                              {s.status === 'suspended' && (
                                  <button
                                      className="btn-action btn-unsuspend"
                                      onClick={() => handleUnsuspend(s)}
                                      disabled={actionLoading === s.id + '-unsuspend'}
                                  >
                                    {actionLoading === s.id + '-unsuspend' ? '…' : 'Unsuspend'}
                                  </button>
                              )}
                              {s.status === 'invited' && (
                                  <button
                                      className="btn-action btn-resend"
                                      onClick={() => handleResendInvite(s)}
                                      disabled={actionLoading === s.id + '-resend'}
                                  >
                                    {actionLoading === s.id + '-resend' ? '…' : 'Resend'}
                                  </button>
                              )}
                              {(s.status === 'active' || s.status === 'invited' || s.status === 'suspended') && (
                                  <button
                                      className="btn-action btn-remove"
                                      onClick={() => handleRemove(s)}
                                      disabled={actionLoading === s.id + '-remove'}
                                  >
                                    {actionLoading === s.id + '-remove' ? '…' : 'Remove'}
                                  </button>
                              )}
                            </div>
                          </td>
                        </tr>
                    );
                  })}
                  </tbody>
                </table>
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

        {editingStudent && (
            <StudentQuotaEditor
                student={editingStudent}
                onClose={() => setEditingStudent(null)}
                onSuccess={() => {
                  setEditingStudent(null);
                  fetchStudents();
                  toast.success('Quota updated.');
                }}
            />
        )}

        <style>{`
        .student-list { font-family: 'Inter','DM Sans','Segoe UI',sans-serif; }
        .sl-header { display: flex; align-items: baseline; gap: 0.75rem; margin-bottom: 1.25rem; }
        .sl-title { font-size: 1.25rem; font-weight: 700; color: var(--text-primary); margin: 0; letter-spacing: -0.01em; }
        .sl-count { font-size: 0.8rem; color: var(--text-secondary); }
        .sl-filters { display: flex; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap; align-items: center; }
        .sl-input {
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--input-border); border-radius: 7px;
          background: var(--input-bg); color: var(--text-primary);
          font-size: 0.85rem; min-width: 200px; font-family: inherit;
        }
        .sl-input:focus { outline: none; border-color: var(--input-focus); box-shadow: 0 0 0 3px var(--accent-soft); }
        .sl-input-sm { min-width: 120px; }
        .sl-select {
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--input-border); border-radius: 7px;
          background: var(--input-bg); color: var(--text-primary);
          font-size: 0.85rem; font-family: inherit; cursor: pointer;
        }
        .sl-select-sm { padding: 0.4rem 0.6rem; }
        .sl-page-size {
          display: inline-flex; align-items: center; gap: 0.5rem;
          font-size: 0.8rem; color: var(--text-secondary); margin-left: auto;
        }

        .sl-table-wrap {
          overflow-x: auto; border-radius: 10px;
          border: 1px solid var(--border); background: var(--card-bg);
          box-shadow: var(--card-shadow);
        }
        .sl-table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
        .sl-table thead th {
          background: var(--bg-tertiary); color: var(--text-secondary);
          font-weight: 600; font-size: 0.72rem;
          text-transform: uppercase; letter-spacing: 0.04em;
          padding: 0.75rem 0.95rem; text-align: left;
          border-bottom: 1px solid var(--border); white-space: nowrap;
        }
        .sl-th-actions { text-align: right !important; }
        .sl-table tbody tr { border-bottom: 1px solid var(--border); transition: background 0.1s; }
        .sl-table tbody tr:last-child { border-bottom: none; }
        .sl-table tbody tr:hover { background: var(--bg-tertiary); }
        .sl-table td { padding: 0.75rem 0.95rem; color: var(--text-primary); vertical-align: middle; }

        .sl-student-cell { display: flex; flex-direction: column; gap: 0.15rem; }
        .sl-name { font-weight: 600; font-size: 0.85rem; color: var(--text-primary); }
        .sl-name em { font-style: italic; color: var(--text-secondary); font-weight: 400; }
        .sl-email { font-size: 0.75rem; color: var(--text-secondary); }
        .sl-batch { font-size: 0.8rem; color: var(--text-secondary); font-variant-numeric: tabular-nums; }

        .sl-badge {
          display: inline-flex; align-items: center; gap: 0.4rem;
          padding: 0.2rem 0.65rem; border-radius: 12px;
          font-size: 0.72rem; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.04em;
          border: 1px solid;
        }
        .sl-badge-dot { width: 6px; height: 6px; border-radius: 50%; }

        .sl-resource { white-space: nowrap; font-size: 0.8rem; font-variant-numeric: tabular-nums; }
        .sl-used { font-weight: 600; color: var(--text-primary); }
        .sl-sep { color: var(--text-muted); margin: 0 2px; }
        .sl-quota { color: var(--text-secondary); }
        .sl-unit { color: var(--text-secondary); font-size: 0.72rem; }

        .sl-actions { display: flex; gap: 0.35rem; flex-wrap: wrap; justify-content: flex-end; }
        .btn-action {
          padding: 0.3rem 0.7rem; border-radius: 5px;
          font-size: 0.72rem; font-weight: 600; cursor: pointer;
          border: 1px solid transparent; white-space: nowrap;
          font-family: inherit; transition: filter 0.15s, transform 0.08s;
        }
        .btn-action:hover:not(:disabled) { filter: brightness(1.08); }
        .btn-action:active:not(:disabled) { transform: translateY(1px); }
        .btn-action:disabled { opacity: 0.5; cursor: not-allowed; }

        .btn-quota {
          background: color-mix(in srgb, var(--accent) 14%, transparent);
          color: var(--accent);
          border-color: color-mix(in srgb, var(--accent) 30%, transparent);
        }
        .btn-resend {
          background: color-mix(in srgb, var(--warning) 14%, transparent);
          color: var(--warning);
          border-color: color-mix(in srgb, var(--warning) 30%, transparent);
        }
        .btn-suspend {
          background: color-mix(in srgb, var(--warning) 14%, transparent);
          color: var(--warning);
          border-color: color-mix(in srgb, var(--warning) 30%, transparent);
        }
        .btn-unsuspend {
          background: color-mix(in srgb, var(--success) 14%, transparent);
          color: var(--success);
          border-color: color-mix(in srgb, var(--success) 30%, transparent);
        }
        .btn-remove {
          background: color-mix(in srgb, var(--error) 14%, transparent);
          color: var(--error);
          border-color: color-mix(in srgb, var(--error) 30%, transparent);
        }

        .sl-state { display: flex; align-items: center; justify-content: center; gap: 0.75rem; padding: 3rem 2rem; color: var(--text-secondary); font-size: 0.875rem; }
        .sl-state.error { color: var(--error); }
        .sl-empty { text-align: center; padding: 3rem 2rem !important; color: var(--text-secondary); }
        .btn-sm { background: var(--accent); color: #fff; border: none; padding: 0.3rem 0.85rem; border-radius: 5px; cursor: pointer; font-size: 0.78rem; font-family: inherit; }
        .spinner { width: 16px; height: 16px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.6s linear infinite; display: inline-block; }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* ── Confirm Modal ── */
        .cm-overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.45);
          display: flex; align-items: center; justify-content: center;
          z-index: 1000; backdrop-filter: blur(2px);
        }
        .cm-dialog {
          background: var(--card-bg); border: 1px solid var(--border);
          border-radius: 12px; padding: 1.5rem;
          max-width: 420px; width: 90%;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          white-space: pre-line;
        }
        .cm-header { margin-bottom: 0.75rem; }
        .cm-title { font-size: 1rem; font-weight: 700; color: var(--text-primary); }
        .cm-message {
          font-size: 0.875rem; color: var(--text-secondary);
          margin: 0 0 1.25rem; line-height: 1.55;
        }
        .cm-actions { display: flex; gap: 0.6rem; justify-content: flex-end; }
        .cm-btn {
          padding: 0.45rem 1rem; border-radius: 7px;
          font-size: 0.82rem; font-weight: 600;
          cursor: pointer; border: 1px solid transparent;
          font-family: inherit; transition: filter 0.15s;
        }
        .cm-btn:hover { filter: brightness(1.08); }
        .cm-btn-cancel { background: var(--bg-tertiary); color: var(--text-primary); border-color: var(--border); }
        .cm-btn-confirm { background: var(--accent); color: #fff; }
        .cm-btn-danger { background: var(--error); color: #fff; }
      `}</style>
      </div>
  );
}