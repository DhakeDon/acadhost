import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useToast } from '../context/ToastContext';

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

export default function BatchRemoval({ onSuccess }) {
  const { toast } = useToast();
  const [batchYear, setBatchYear] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);

  // Students in that batch + search & exclusion state
  const [preview, setPreview] = useState({ loading: false, students: [], loaded: false });
  const [search, setSearch] = useState('');
  const [excludedIds, setExcludedIds] = useState(() => new Set());

  const fetchBatchStudents = useCallback(async (year) => {
    if (!year) {
      setPreview({ loading: false, students: [], loaded: false });
      return;
    }
    setPreview(p => ({ ...p, loading: true }));
    try {
      const res = await api.get('/admin/students', {
        params: { batchYear: year, limit: 500, page: 1 },
      });
      const allStudents = res.data.data.items.filter(s => s.status !== 'removed');
      setPreview({ loading: false, students: allStudents, loaded: true });
      setExcludedIds(new Set());
    } catch (err) {
      setPreview({ loading: false, students: [], loaded: true });
      toast.error('Failed to load students for this batch.');
    }
  }, [toast]);

  useEffect(() => {
    if (!batchYear) {
      setPreview({ loading: false, students: [], loaded: false });
      return;
    }
    const year = Number(batchYear);
    if (isNaN(year) || year < 2000 || year > 2100) return;
    const timer = setTimeout(() => fetchBatchStudents(year), 400);
    return () => clearTimeout(timer);
  }, [batchYear, fetchBatchStudents]);

  function toggleExclude(studentId) {
    setExcludedIds(prev => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  function excludeAll() {
    setExcludedIds(new Set(preview.students.map(s => s.id)));
  }
  function includeAll() {
    setExcludedIds(new Set());
  }

  const visibleStudents = preview.students.filter(s => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (s.name || '').toLowerCase().includes(q) || (s.email || '').toLowerCase().includes(q);
  });

  const toRemoveCount = preview.students.length - excludedIds.size;

  // Promise-based confirm modal (same pattern as ProjectList)
  function showConfirm(options) {
    return new Promise(resolve => {
      setConfirmDialog({
        ...options,
        onConfirm: () => { setConfirmDialog(null); resolve(true); },
        onCancel:  () => { setConfirmDialog(null); resolve(false); },
      });
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setResult(null);

    const year = Number(batchYear);
    if (!batchYear || isNaN(year)) {
      setError('Please enter a valid batch year.');
      return;
    }
    if (preview.loaded && toRemoveCount === 0) {
      setError('You have excluded every student. Nothing to remove.');
      return;
    }

    const excludedList = Array.from(excludedIds);
    const excludedNames = preview.students
        .filter(s => excludedIds.has(s.id))
        .map(s => s.name || s.email);

    let message = `This will permanently remove ${toRemoveCount} student(s) from batch year ${year}, along with their projects, databases, containers, and files.`;
    if (excludedNames.length > 0) {
      const preview5 = excludedNames.slice(0, 5).join(', ');
      const extra = excludedNames.length > 5 ? ` and ${excludedNames.length - 5} more` : '';
      message += `\n\nExcluded from removal: ${preview5}${extra}.`;
    }
    message += '\n\nThis action CANNOT be undone.';

    const confirmed = await showConfirm({
      title: `⚠ Remove Batch ${year}`,
      message,
      confirmLabel: `Remove ${toRemoveCount} Student${toRemoveCount === 1 ? '' : 's'}`,
      danger: true,
    });
    if (!confirmed) return;

    setLoading(true);
    try {
      const payload = { batchYear: year };
      if (excludedList.length > 0) payload.excludeStudentIds = excludedList;
      const res = await api.post('/admin/students/batch-remove', payload);
      setResult(res.data.data);
      setBatchYear('');
      setExcludedIds(new Set());
      setPreview({ loading: false, students: [], loaded: false });
      toast.success(`Batch ${year}: ${res.data.data.studentsRemoved} student(s) removed.`);
      onSuccess?.();
    } catch (err) {
      const code = err.response?.data?.error;
      const msg = err.response?.data?.message;
      if (code === 'NO_STUDENTS_FOUND') setError(msg || `No students found for batch year ${year}.`);
      else if (code === 'VALIDATION_ERROR') setError(msg || 'Batch year is required.');
      else setError(msg || 'Failed to remove batch.');
    } finally {
      setLoading(false);
    }
  }

  return (
      <div className="batch">
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

        <h3 className="batch-title">Batch Removal</h3>
        <p className="batch-desc">
          Remove all students from a specific enrollment year. All associated projects,
          databases, containers, and source files will be permanently deleted. You can
          optionally exclude specific students from the removal.
        </p>

        <form onSubmit={handleSubmit} className="batch-form">
          <div className="batch-field">
            <label className="batch-label">Enrollment Year</label>
            <input
                type="number"
                className="batch-input"
                value={batchYear}
                onChange={e => { setBatchYear(e.target.value); setError(null); setResult(null); }}
                placeholder="e.g. 2022"
                min="2000"
                max="2100"
            />
          </div>

          {batchYear && preview.loading && (
              <div className="batch-preview-loading">
                <div className="spinner-sm" /> Loading batch {batchYear}…
              </div>
          )}

          {preview.loaded && preview.students.length === 0 && (
              <div className="batch-warning">
                No students found for batch year {batchYear}.
              </div>
          )}

          {preview.loaded && preview.students.length > 0 && (
              <div className="batch-preview">
                <div className="batch-preview-header">
                  <div>
                    <strong>{toRemoveCount}</strong> of {preview.students.length} students will be removed
                    {excludedIds.size > 0 && <> · <span className="batch-excluded">{excludedIds.size} excluded</span></>}
                  </div>
                  <div className="batch-preview-bulk">
                    <button type="button" className="batch-link" onClick={includeAll} disabled={excludedIds.size === 0}>
                      Include all
                    </button>
                    <span className="batch-link-sep">·</span>
                    <button type="button" className="batch-link" onClick={excludeAll} disabled={excludedIds.size === preview.students.length}>
                      Exclude all
                    </button>
                  </div>
                </div>

                <input
                    type="text"
                    className="batch-search"
                    placeholder="Filter by name or email…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />

                <div className="batch-list">
                  {visibleStudents.length === 0 && (
                      <div className="batch-list-empty">No students match your filter.</div>
                  )}
                  {visibleStudents.map(s => {
                    const excluded = excludedIds.has(s.id);
                    return (
                        <div
                            key={s.id}
                            className={`batch-row${excluded ? ' excluded' : ''}`}
                            onClick={() => toggleExclude(s.id)}
                        >
                          <input type="checkbox" checked={!excluded} onChange={() => toggleExclude(s.id)} onClick={e => e.stopPropagation()} />
                          <div className="batch-row-info">
                            <span className="batch-row-name">
                              {s.name || <em>No name</em>}
                            </span>
                            <span className="batch-row-email">{s.email}</span>
                          </div>
                          <span className={`batch-row-tag ${excluded ? 'keep' : 'remove'}`}>
                            {excluded ? 'Keep' : 'Remove'}
                          </span>
                        </div>
                    );
                  })}
                </div>
              </div>
          )}

          {error && <div className="batch-error">{error}</div>}

          <button
              type="submit"
              className="batch-submit"
              disabled={loading || !batchYear || (preview.loaded && toRemoveCount === 0)}
          >
            {loading
                ? <><span className="spinner-sm" /> Removing…</>
                : preview.loaded
                    ? `Remove ${toRemoveCount} student${toRemoveCount === 1 ? '' : 's'} from batch ${batchYear}`
                    : `Remove Batch ${batchYear || '…'}`}
          </button>
        </form>

        {result && (
            <div className="batch-result">
              <div className="batch-result-title">✓ Batch {result.batchYear} removed</div>
              <div className="batch-stats">
                <div className="batch-stat">
                  <span className="batch-stat-num">{result.studentsRemoved}</span>
                  <span className="batch-stat-label">students</span>
                </div>
                <div className="batch-stat">
                  <span className="batch-stat-num">{result.projectsRemoved}</span>
                  <span className="batch-stat-label">projects</span>
                </div>
                <div className="batch-stat">
                  <span className="batch-stat-num">{result.databasesRemoved}</span>
                  <span className="batch-stat-label">databases</span>
                </div>
                {result.excluded > 0 && (
                    <div className="batch-stat">
                      <span className="batch-stat-num">{result.excluded}</span>
                      <span className="batch-stat-label">excluded</span>
                    </div>
                )}
              </div>
              {result.failed?.length > 0 && (
                  <div className="batch-failed">
                    ⚠ Failed to remove {result.failed.length} student(s) — IDs: {result.failed.join(', ')}
                  </div>
              )}
            </div>
        )}

        <style>{`
        .batch {
          font-family: 'Inter','DM Sans','Segoe UI',sans-serif;
          background: var(--card-bg); border: 1px solid var(--border);
          border-radius: 12px; padding: 1.75rem;
          box-shadow: var(--card-shadow);
        }
        .batch-title { font-size: 1.1rem; font-weight: 700; color: var(--text-primary); margin: 0 0 0.35rem; }
        .batch-desc { font-size: 0.85rem; color: var(--text-secondary); margin: 0 0 1.5rem; line-height: 1.5; }
        .batch-form { display: flex; flex-direction: column; gap: 1rem; }
        .batch-field { display: flex; flex-direction: column; gap: 0.3rem; }
        .batch-label {
          font-size: 0.78rem; font-weight: 600; color: var(--text-primary);
          text-transform: uppercase; letter-spacing: 0.04em;
        }
        .batch-input {
          padding: 0.5rem 0.75rem; border: 1px solid var(--input-border);
          border-radius: 7px; background: var(--input-bg);
          color: var(--text-primary); font-size: 0.875rem;
          max-width: 200px; font-family: inherit;
        }
        .batch-input:focus { outline: none; border-color: var(--input-focus); box-shadow: 0 0 0 3px var(--accent-soft); }

        .batch-preview-loading {
          display: inline-flex; align-items: center; gap: 0.5rem;
          font-size: 0.82rem; color: var(--text-secondary);
        }
        .batch-warning {
          background: color-mix(in srgb, var(--warning) 10%, transparent);
          color: var(--warning); padding: 0.55rem 0.85rem;
          border-radius: 7px; font-size: 0.85rem;
          border-left: 3px solid var(--warning);
        }
        .batch-preview {
          display: flex; flex-direction: column; gap: 0.75rem;
          background: var(--bg-tertiary); border: 1px solid var(--border);
          border-radius: 10px; padding: 1rem;
        }
        .batch-preview-header {
          display: flex; justify-content: space-between; align-items: center;
          flex-wrap: wrap; gap: 0.5rem; font-size: 0.85rem;
          color: var(--text-primary);
        }
        .batch-excluded { color: var(--success); }
        .batch-preview-bulk { display: inline-flex; gap: 0.5rem; font-size: 0.8rem; }
        .batch-link-sep { color: var(--text-muted); }
        .batch-link {
          background: none; border: none; padding: 0;
          color: var(--accent); cursor: pointer;
          font-size: 0.8rem; font-family: inherit;
          text-decoration: underline;
        }
        .batch-link:disabled { opacity: 0.4; cursor: not-allowed; text-decoration: none; }

        .batch-search {
          padding: 0.5rem 0.75rem; border: 1px solid var(--input-border);
          border-radius: 7px; background: var(--input-bg);
          color: var(--text-primary); font-size: 0.85rem;
          font-family: inherit; width: 100%; box-sizing: border-box;
        }
        .batch-search:focus { outline: none; border-color: var(--input-focus); box-shadow: 0 0 0 3px var(--accent-soft); }

        .batch-list {
          max-height: 320px; overflow-y: auto;
          border: 1px solid var(--border); border-radius: 8px;
          background: var(--card-bg);
        }
        .batch-list-empty { padding: 1.5rem; text-align: center; color: var(--text-secondary); font-size: 0.82rem; }
        .batch-row {
          display: flex; align-items: center; gap: 0.75rem;
          padding: 0.55rem 0.9rem; border-bottom: 1px solid var(--border);
          cursor: pointer; transition: background 0.1s;
        }
        .batch-row:last-child { border-bottom: none; }
        .batch-row:hover { background: var(--bg-tertiary); }
        .batch-row.excluded { opacity: 0.6; }
        .batch-row input[type="checkbox"] { flex-shrink: 0; cursor: pointer; }
        .batch-row-info { flex: 1; display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
        .batch-row-name { font-weight: 600; font-size: 0.85rem; color: var(--text-primary); }
        .batch-row-name em { font-style: italic; color: var(--text-secondary); font-weight: 400; }
        .batch-row-email { font-size: 0.72rem; color: var(--text-secondary); }
        .batch-row-tag {
          flex-shrink: 0; padding: 0.15rem 0.55rem; border-radius: 10px;
          font-size: 0.68rem; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.04em;
          border: 1px solid;
        }
        .batch-row-tag.remove {
          color: var(--error);
          background: color-mix(in srgb, var(--error) 12%, transparent);
          border-color: color-mix(in srgb, var(--error) 30%, transparent);
        }
        .batch-row-tag.keep {
          color: var(--success);
          background: color-mix(in srgb, var(--success) 12%, transparent);
          border-color: color-mix(in srgb, var(--success) 30%, transparent);
        }

        .batch-error {
          background: color-mix(in srgb, var(--error) 10%, transparent);
          border: 1px solid color-mix(in srgb, var(--error) 25%, transparent);
          color: var(--error);
          padding: 0.55rem 0.85rem; border-radius: 7px; font-size: 0.82rem;
        }
        .batch-submit {
          background: var(--error); border: none; color: #fff;
          padding: 0.6rem 1.4rem; border-radius: 8px;
          font-size: 0.875rem; font-weight: 600;
          cursor: pointer; display: inline-flex; align-items: center; gap: 0.5rem;
          align-self: flex-start; font-family: inherit;
          transition: filter 0.15s;
        }
        .batch-submit:hover:not(:disabled) { filter: brightness(1.1); }
        .batch-submit:disabled { opacity: 0.5; cursor: not-allowed; }
        .spinner-sm {
          width: 13px; height: 13px;
          border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff;
          border-radius: 50%; animation: spin 0.6s linear infinite;
          display: inline-block;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .batch-result {
          margin-top: 1.5rem; padding: 1.1rem 1.25rem;
          background: color-mix(in srgb, var(--success) 8%, transparent);
          border: 1px solid color-mix(in srgb, var(--success) 25%, transparent);
          border-radius: 10px;
        }
        .batch-result-title { font-size: 0.9rem; font-weight: 700; color: var(--success); margin-bottom: 0.75rem; }
        .batch-stats { display: flex; gap: 2rem; flex-wrap: wrap; }
        .batch-stat { display: flex; flex-direction: column; align-items: center; gap: 0.1rem; }
        .batch-stat-num { font-size: 1.5rem; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; }
        .batch-stat-label { font-size: 0.72rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.04em; }
        .batch-failed {
          margin-top: 0.75rem; font-size: 0.8rem; color: var(--warning);
          background: color-mix(in srgb, var(--warning) 8%, transparent);
          border: 1px solid color-mix(in srgb, var(--warning) 22%, transparent);
          padding: 0.5rem 0.85rem; border-radius: 7px;
        }

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