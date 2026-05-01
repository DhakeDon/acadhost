import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import Pagination from './Pagination';
import { useToast } from '../context/ToastContext';

const STATUS_COLORS = {
  running:  'var(--badge-running)',
  stopped:  'var(--badge-stopped)',
  building: 'var(--badge-building)',
  failed:   'var(--badge-failed)',
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

export default function ProjectList() {
  const { toast } = useToast();

  const [projects, setProjects] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, totalItems: 0, totalPages: 1 });
  const [filters, setFilters] = useState({ status: '', search: '' });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (filters.status) params.status = filters.status;
      if (filters.search) params.search = filters.search;
      const res = await api.get('/admin/projects', { params });
      setProjects(res.data.data.items);
      setPagination(res.data.data.pagination);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, [page, limit, filters]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  function showConfirm(options) {
    return new Promise(resolve => {
      setConfirmDialog({
        ...options,
        onConfirm: () => { setConfirmDialog(null); resolve(true); },
        onCancel:  () => { setConfirmDialog(null); resolve(false); },
      });
    });
  }

  async function handleStop(project) {
    const confirmed = await showConfirm({
      title: 'Stop Project',
      message: `Stop project "${project.title}"? The student will be notified by email.`,
      confirmLabel: 'Stop Project',
      danger: false,
    });
    if (!confirmed) return;

    setActionLoading(project.id + '-stop');
    try {
      const res = await api.post(`/admin/projects/${project.id}/stop`);
      toast.success(`Project stopped. Student notified at ${res.data.data.notifiedStudent}.`);
      fetchProjects();
    } catch (err) {
      toast.error(humanizeError(err.response?.data?.error) || err.response?.data?.message || 'Failed to stop project');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleTerminate(project) {
    const confirmed = await showConfirm({
      title: '⚠ Terminate Project',
      message: `Permanently terminate "${project.title}"? This will remove the container, source files, Nginx config, and subdomain. The student will be notified. This action CANNOT be undone.`,
      confirmLabel: 'Terminate',
      danger: true,
    });
    if (!confirmed) return;

    setActionLoading(project.id + '-terminate');
    try {
      const res = await api.post(`/admin/projects/${project.id}/terminate`);
      toast.success(`Project terminated. Student notified at ${res.data.data.notifiedStudent}.`);
      fetchProjects();
    } catch (err) {
      toast.error(humanizeError(err.response?.data?.error) || err.response?.data?.message || 'Failed to terminate project');
    } finally {
      setActionLoading(null);
    }
  }

  function humanizeError(code) {
    const map = {
      PROJECT_NOT_FOUND: 'Project not found.',
      PROJECT_ALREADY_STOPPED: 'Project is already stopped.',
      PROJECT_DELETED: 'Cannot act on a deleted project.',
      PROJECT_BUILDING: 'Cannot stop a project that is currently building.',
      PROJECT_ALREADY_DELETED: 'Project has already been terminated.',
    };
    return map[code] || null;
  }

  function formatRuntime(item) {
    if (!item.runtime) return '—';
    const name = item.runtime === 'node' ? 'Node.js' : 'Python';
    return `${name} ${item.runtimeVersion || ''}`.trim();
  }

  function handleLimitChange(newLimit) {
    setLimit(newLimit);
    setPage(1);
  }

  const safeTotalPages = Math.max(pagination.totalPages, 1);

  return (
      <div className="project-list">
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

        <div className="pl-header">
          <div>
            <h2 className="pl-title">All Projects</h2>
            <p className="pl-subtitle">
              Active deployments across every student account
            </p>
          </div>
          <div className="pl-header-meta">
            <span className="pl-count-pill">{pagination.totalItems} total</span>
            <button className="pl-refresh-btn" onClick={fetchProjects} disabled={loading}>
              <span className={loading ? 'rotating' : ''}>↻</span> Refresh
            </button>
          </div>
        </div>

        {/* Filters row */}
        <div className="pl-toolbar">
          <div className="pl-search-wrap">
            <span className="pl-search-icon">⌕</span>
            <input
                type="text"
                placeholder="Search by title, subdomain, student name or email…"
                value={filters.search}
                onChange={e => { setFilters(f => ({ ...f, search: e.target.value })); setPage(1); }}
                className="pl-search-input"
            />
          </div>
          <select
              value={filters.status}
              onChange={e => { setFilters(f => ({ ...f, status: e.target.value })); setPage(1); }}
              className="pl-select"
          >
            <option value="">All statuses</option>
            <option value="building">Building</option>
            <option value="running">Running</option>
            <option value="stopped">Stopped</option>
            <option value="failed">Failed</option>
          </select>

          <div className="pl-toolbar-right">
            <label className="pl-page-size">
              <span>Show</span>
              <select
                  value={limit}
                  onChange={e => handleLimitChange(parseInt(e.target.value, 10))}
                  className="pl-select pl-select-sm"
              >
                {PAGE_SIZE_OPTIONS.map(n => (
                    <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <span>per page</span>
            </label>
          </div>
        </div>

        {/* Top pagination */}
        {!loading && !error && pagination.totalItems > 0 && (
            <Pagination
                page={pagination.page}
                totalPages={safeTotalPages}
                onPrev={() => setPage(p => Math.max(1, p - 1))}
                onNext={() => setPage(p => Math.min(safeTotalPages, p + 1))}
                onJump={(p) => setPage(p)}
                totalItems={pagination.totalItems}
                limit={limit}
            />
        )}

        {loading && (
            <div className="pl-state"><div className="spinner" /> Loading projects…</div>
        )}
        {error && !loading && (
            <div className="pl-state error">
              ⚠ {error}
              <button onClick={fetchProjects} className="btn-sm">Retry</button>
            </div>
        )}

        {!loading && !error && (
            <>
              <div className="pl-table-wrap">
                <table className="pl-table">
                  <thead>
                  <tr>
                    <th>Title / Subdomain</th>
                    <th>Type</th>
                    <th>Runtime</th>
                    <th>Status</th>
                    <th>Resources</th>
                    <th>Student</th>
                    <th>Created</th>
                    <th className="pl-th-actions">Actions</th>
                  </tr>
                  </thead>
                  <tbody>
                  {projects.length === 0 && (
                      <tr>
                        <td colSpan={8} className="pl-empty">
                          <div className="pl-empty-inner">
                            <div className="pl-empty-icon">∅</div>
                            <div>No projects match your filters.</div>
                          </div>
                        </td>
                      </tr>
                  )}
                  {projects.map(p => (
                      <tr key={p.id}>
                        <td>
                          <div className="pl-title-cell">
                            <span className="pl-project-title">{p.title}</span>
                            <a
                                href={p.liveUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="pl-url"
                            >
                              {p.subdomain}.acadhost.com ↗
                            </a>
                          </div>
                        </td>
                        <td><span className="pl-type">{p.projectType}</span></td>
                        <td className="pl-runtime">{formatRuntime(p)}</td>
                        <td>
                        <span
                            className="pl-badge"
                            style={{
                              color: STATUS_COLORS[p.status] || 'var(--text-secondary)',
                              background: `color-mix(in srgb, ${STATUS_COLORS[p.status] || 'var(--text-secondary)'} 14%, transparent)`,
                              borderColor: `color-mix(in srgb, ${STATUS_COLORS[p.status] || 'var(--text-secondary)'} 30%, transparent)`,
                            }}
                        >
                          <span
                              className="pl-badge-dot"
                              style={{ background: STATUS_COLORS[p.status] || 'var(--text-secondary)' }}
                          />
                          {p.status}
                        </span>
                        </td>
                        <td className="pl-resources">
                          <span>{p.cpuLimit} CPU</span>
                          <span className="pl-resources-sub">{p.ramLimitMb} MB</span>
                        </td>
                        <td>
                          <div className="pl-student">
                            <span className="pl-student-name">{p.student?.name || '—'}</span>
                            <span className="pl-student-email">{p.student?.email}</span>
                          </div>
                        </td>
                        <td className="pl-date">{new Date(p.createdAt).toLocaleDateString()}</td>
                        <td>
                          <div className="pl-actions">
                            {p.status === 'running' && (
                                <button
                                    className="btn-action btn-stop"
                                    onClick={() => handleStop(p)}
                                    disabled={actionLoading === p.id + '-stop'}
                                >
                                  {actionLoading === p.id + '-stop' ? '…' : 'Stop'}
                                </button>
                            )}
                            <button
                                className="btn-action btn-terminate"
                                onClick={() => handleTerminate(p)}
                                disabled={actionLoading === p.id + '-terminate'}
                            >
                              {actionLoading === p.id + '-terminate' ? '…' : 'Terminate'}
                            </button>
                          </div>
                        </td>
                      </tr>
                  ))}
                  </tbody>
                </table>
              </div>

              {/* Bottom pagination */}
              {pagination.totalItems > 0 && (
                  <Pagination
                      page={pagination.page}
                      totalPages={safeTotalPages}
                      onPrev={() => setPage(p => Math.max(1, p - 1))}
                      onNext={() => setPage(p => Math.min(safeTotalPages, p + 1))}
                      onJump={(p) => setPage(p)}
                      totalItems={pagination.totalItems}
                      limit={limit}
                  />
              )}
            </>
        )}

        <style>{`
          .project-list {
            font-family: 'Inter', 'DM Sans', 'Segoe UI', sans-serif;
          }

          /* ── Confirm Modal ── */
          .cm-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.45);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            backdrop-filter: blur(2px);
          }
          .cm-dialog {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 1.5rem;
            max-width: 420px;
            width: 90%;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          }
          .cm-header { margin-bottom: 0.75rem; }
          .cm-title {
            font-size: 1rem;
            font-weight: 700;
            color: var(--text-primary);
          }
          .cm-message {
            font-size: 0.875rem;
            color: var(--text-secondary);
            margin: 0 0 1.25rem;
            line-height: 1.55;
          }
          .cm-actions {
            display: flex;
            gap: 0.6rem;
            justify-content: flex-end;
          }
          .cm-btn {
            padding: 0.45rem 1rem;
            border-radius: 7px;
            font-size: 0.82rem;
            font-weight: 600;
            cursor: pointer;
            border: 1px solid transparent;
            font-family: inherit;
            transition: filter 0.15s;
          }
          .cm-btn:hover { filter: brightness(1.08); }
          .cm-btn-cancel {
            background: var(--bg-tertiary);
            color: var(--text-primary);
            border-color: var(--border);
          }
          .cm-btn-confirm {
            background: var(--accent);
            color: #fff;
          }
          .cm-btn-danger {
            background: var(--error);
            color: #fff;
          }

          .pl-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 1rem;
            margin-bottom: 1.5rem;
            flex-wrap: wrap;
          }
          .pl-title {
            font-size: 1.5rem;
            font-weight: 700;
            color: var(--text-primary);
            margin: 0 0 0.25rem;
            letter-spacing: -0.02em;
          }
          .pl-subtitle {
            font-size: 0.85rem;
            color: var(--text-secondary);
            margin: 0;
          }
          .pl-header-meta {
            display: flex;
            align-items: center;
            gap: 0.75rem;
          }
          .pl-count-pill {
            font-size: 0.75rem;
            color: var(--text-secondary);
            background: var(--bg-tertiary);
            padding: 0.35rem 0.75rem;
            border-radius: 999px;
            font-weight: 600;
          }
          .pl-refresh-btn {
            background: var(--card-bg);
            border: 1px solid var(--border);
            color: var(--text-primary);
            padding: 0.4rem 0.85rem;
            border-radius: 6px;
            font-size: 0.82rem;
            font-family: inherit;
            cursor: pointer;
            transition: background 0.15s, border-color 0.15s;
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
          }
          .pl-refresh-btn:hover:not(:disabled) {
            background: var(--bg-tertiary);
            border-color: var(--border-strong);
          }
          .pl-refresh-btn:disabled {
            opacity: 0.6;
            cursor: wait;
          }
          .rotating {
            display: inline-block;
            animation: spin 0.8s linear infinite;
          }

          .pl-toolbar {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            margin-bottom: 1rem;
            flex-wrap: wrap;
          }
          .pl-search-wrap {
            position: relative;
            flex: 1 1 260px;
            min-width: 240px;
          }
          .pl-search-icon {
            position: absolute;
            left: 0.75rem;
            top: 50%;
            transform: translateY(-50%);
            color: var(--text-muted);
            pointer-events: none;
            font-size: 0.95rem;
          }
          .pl-search-input {
            width: 100%;
            padding: 0.55rem 0.85rem 0.55rem 2.15rem;
            border: 1px solid var(--input-border);
            border-radius: 7px;
            background: var(--input-bg);
            color: var(--text-primary);
            font-size: 0.85rem;
            font-family: inherit;
            transition: border-color 0.15s, box-shadow 0.15s;
          }
          .pl-search-input:focus {
            outline: none;
            border-color: var(--input-focus);
            box-shadow: 0 0 0 3px var(--accent-soft);
          }
          .pl-search-input::placeholder {
            color: var(--text-muted);
          }
          .pl-select {
            padding: 0.55rem 0.85rem;
            border: 1px solid var(--input-border);
            border-radius: 7px;
            background: var(--input-bg);
            color: var(--text-primary);
            font-size: 0.85rem;
            font-family: inherit;
            cursor: pointer;
            min-width: 150px;
          }
          .pl-select:focus {
            outline: none;
            border-color: var(--input-focus);
            box-shadow: 0 0 0 3px var(--accent-soft);
          }
          .pl-select-sm {
            min-width: 70px;
            padding: 0.4rem 0.6rem;
          }
          .pl-toolbar-right {
            margin-left: auto;
          }
          .pl-page-size {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.8rem;
            color: var(--text-secondary);
          }

          .pl-table-wrap {
            overflow-x: auto;
            border-radius: 10px;
            border: 1px solid var(--border);
            background: var(--card-bg);
            box-shadow: var(--card-shadow);
          }
          .pl-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.85rem;
          }
          .pl-table thead th {
            background: var(--bg-tertiary);
            color: var(--text-secondary);
            font-weight: 600;
            font-size: 0.72rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            padding: 0.75rem 0.95rem;
            text-align: left;
            border-bottom: 1px solid var(--border);
            white-space: nowrap;
          }
          .pl-th-actions {
            text-align: right !important;
          }
          .pl-table tbody tr {
            border-bottom: 1px solid var(--border);
            transition: background 0.1s;
          }
          .pl-table tbody tr:last-child { border-bottom: none; }
          .pl-table tbody tr:hover {
            background: var(--bg-tertiary);
          }
          .pl-table td {
            padding: 0.75rem 0.95rem;
            color: var(--text-primary);
            vertical-align: middle;
          }
          .pl-title-cell { display: flex; flex-direction: column; gap: 0.2rem; }
          .pl-project-title {
            font-weight: 600;
            color: var(--text-primary);
          }
          .pl-url {
            font-size: 0.75rem;
            color: var(--accent);
            text-decoration: none;
            font-family: 'DM Mono', 'Consolas', monospace;
          }
          .pl-url:hover { text-decoration: underline; }
          .pl-type {
            font-size: 0.72rem;
            background: var(--bg-tertiary);
            padding: 0.2rem 0.55rem;
            border-radius: 4px;
            color: var(--text-secondary);
            text-transform: capitalize;
            font-weight: 500;
            border: 1px solid var(--border);
          }
          .pl-runtime {
            font-size: 0.82rem;
            color: var(--text-secondary);
          }
          .pl-badge {
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
            padding: 0.2rem 0.65rem;
            border-radius: 12px;
            font-size: 0.72rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            border: 1px solid;
          }
          .pl-badge-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            display: inline-block;
          }
          .pl-resources {
            display: flex;
            flex-direction: column;
            gap: 0.1rem;
            font-size: 0.8rem;
            color: var(--text-primary);
            font-variant-numeric: tabular-nums;
          }
          .pl-resources-sub {
            color: var(--text-secondary);
            font-size: 0.75rem;
          }
          .pl-student {
            display: flex;
            flex-direction: column;
            gap: 0.1rem;
          }
          .pl-student-name {
            color: var(--text-primary);
            font-weight: 500;
          }
          .pl-student-email {
            font-size: 0.72rem;
            color: var(--text-secondary);
          }
          .pl-date {
            font-size: 0.78rem;
            color: var(--text-secondary);
            white-space: nowrap;
            font-variant-numeric: tabular-nums;
          }
          .pl-actions {
            display: flex;
            gap: 0.4rem;
            justify-content: flex-end;
          }
          .btn-action {
            padding: 0.3rem 0.75rem;
            border-radius: 5px;
            font-size: 0.75rem;
            font-weight: 600;
            cursor: pointer;
            border: 1px solid transparent;
            font-family: inherit;
            transition: filter 0.15s, transform 0.08s;
          }
          .btn-action:active:not(:disabled) { transform: translateY(1px); }
          .btn-action:hover:not(:disabled) { filter: brightness(1.08); }
          .btn-action:disabled { opacity: 0.5; cursor: not-allowed; }
          .btn-stop {
            background: color-mix(in srgb, var(--warning) 12%, transparent);
            color: var(--warning);
            border-color: color-mix(in srgb, var(--warning) 30%, transparent);
          }
          .btn-terminate {
            background: color-mix(in srgb, var(--error) 12%, transparent);
            color: var(--error);
            border-color: color-mix(in srgb, var(--error) 30%, transparent);
          }

          .pl-state {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.75rem;
            padding: 3rem 2rem;
            color: var(--text-secondary);
            font-size: 0.875rem;
          }
          .pl-state.error { color: var(--error); }
          .pl-empty {
            text-align: center;
            padding: 3rem 2rem !important;
            color: var(--text-secondary);
          }
          .pl-empty-inner {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.5rem;
          }
          .pl-empty-icon {
            font-size: 2rem;
            color: var(--text-muted);
          }

          .btn-sm {
            background: var(--accent);
            color: #fff;
            border: none;
            padding: 0.3rem 0.85rem;
            border-radius: 5px;
            cursor: pointer;
            font-size: 0.78rem;
            font-family: inherit;
            font-weight: 500;
          }
          .spinner {
            width: 16px;
            height: 16px;
            border: 2px solid var(--border);
            border-top-color: var(--accent);
            border-radius: 50%;
            animation: spin 0.6s linear infinite;
            display: inline-block;
          }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
  );
}