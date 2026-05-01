import { useRef, useState } from 'react';
import api from '../services/api';

// ============================================================================
// StudentInvite.jsx — Section 14.11
//
// Two input modes (both backed by POST /api/admin/students/invite):
//   1. Manual entry   → req.body.students = JSON.stringify([{email, name, batchYear}, ...])
//   2. Excel upload   → req.file + optional global req.body.batchYear fallback
//
// Backend accepts both modes simultaneously but this component keeps them as
// tabs for clarity. The spec (Section 5.9.1) makes name optional — email and
// batchYear are both required.
// ============================================================================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BATCH_YEAR_MIN = 2000;
const BATCH_YEAR_MAX = 2100;

function isValidBatchYear(val) {
  const y = parseInt(val, 10);
  return !isNaN(y) && y >= BATCH_YEAR_MIN && y <= BATCH_YEAR_MAX;
}

export default function StudentInvite({ onSuccess }) {
  const [mode, setMode] = useState('manual'); // 'manual' | 'excel'

  // Shared
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Manual mode state
  const [rows, setRows] = useState([{ id: rid(), email: '', name: '', batchYear: '' }]);
  const [sameBatchForAll, setSameBatchForAll] = useState(true);
  const [globalBatchYear, setGlobalBatchYear] = useState('');

  // Excel mode state
  const [file, setFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [excelBatchYear, setExcelBatchYear] = useState('');
  const fileInputRef = useRef(null);

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────
  function rid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function resetAll() {
    setRows([{ id: rid(), email: '', name: '', batchYear: '' }]);
    setSameBatchForAll(true);
    setGlobalBatchYear('');
    setFile(null);
    setExcelBatchYear('');
    setError(null);
  }

  // ─────────────────────────────────────────────────────────────
  // Manual mode — row management
  // ─────────────────────────────────────────────────────────────
  function updateRow(id, field, value) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { id: rid(), email: '', name: '', batchYear: '' }]);
  }

  function removeRow(id) {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.id !== id)));
  }

  /**
   * Paste handler on the first empty email cell — if the admin pastes a
   * multi-line list, split into rows. Each line can be "email" or
   * "email,name" or "email,name,batchYear".
   */
  function handleEmailPaste(e, rowId) {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\n') && !text.includes(',')) return;
    e.preventDefault();

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;

    const parsed = lines.map((line) => {
      const parts = line.split(/[,\t]/).map((p) => p.trim());
      return {
        id: rid(),
        email: parts[0] || '',
        name: parts[1] || '',
        batchYear: parts[2] || '',
      };
    });

    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === rowId);
      if (idx === -1) return [...prev, ...parsed];
      const before = prev.slice(0, idx);
      const after = prev.slice(idx + 1);
      return [...before, ...parsed, ...after];
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Excel mode — drag & drop + template download
  // ─────────────────────────────────────────────────────────────
  function handleDrag(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) acceptFile(dropped);
  }

  function acceptFile(f) {
    const name = f.name.toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
      setError('File must be an Excel file (.xlsx or .xls).');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError('File exceeds the 5 MB maximum size.');
      return;
    }
    setError(null);
    setFile(f);
  }

  function downloadTemplate() {
    const csv = [
      'email,name,batchYear',
      'student1@institution.edu,Jane Doe,2024',
      'student2@institution.edu,John Smith,2024',
      'student3@institution.edu,,2024',
    ].join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'acadhost-invite-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─────────────────────────────────────────────────────────────
  // Submit
  // ─────────────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setResult(null);

    const formData = new FormData();

    if (mode === 'manual') {
      // Validate: at least one row with a non-empty email
      const activeRows = rows.filter((r) => (r.email || '').trim());

      if (activeRows.length === 0) {
        setError('Please enter at least one email address.');
        return;
      }

      // ── Batch year validation ──────────────────────────────────
      if (sameBatchForAll) {
        if (!globalBatchYear || !isValidBatchYear(globalBatchYear)) {
          setError(`Batch year is required and must be between ${BATCH_YEAR_MIN} and ${BATCH_YEAR_MAX}.`);
          return;
        }
      } else {
        const missingBatch = activeRows.filter((r) => !isValidBatchYear(r.batchYear));
        if (missingBatch.length > 0) {
          setError(
              `Batch year is required for every student. Missing or invalid for: ${missingBatch
                  .map((r) => r.email.trim() || '(empty email)')
                  .join(', ')}`
          );
          return;
        }
      }
      // ──────────────────────────────────────────────────────────

      // Client-side email format check
      const cleaned = activeRows.map((r) => ({
        email: r.email.trim().toLowerCase(),
        name: (r.name || '').trim(),
        batchYear: sameBatchForAll ? globalBatchYear : (r.batchYear || '').trim(),
      }));

      const badRows = cleaned.filter((r) => !EMAIL_REGEX.test(r.email));
      if (badRows.length > 0) {
        setError(`Invalid email format: ${badRows.map((r) => r.email).join(', ')}`);
        return;
      }

      const studentsPayload = cleaned.map((r) => ({
        email: r.email,
        name: r.name || null,
        batchYear: parseInt(r.batchYear, 10),
      }));

      formData.append('students', JSON.stringify(studentsPayload));
      formData.append('batchYear', sameBatchForAll ? globalBatchYear : '');
    } else {
      // Excel mode
      if (!file) {
        setError('Please select an Excel file to upload.');
        return;
      }

      // ── Batch year required for Excel mode too ─────────────────
      if (!excelBatchYear || !isValidBatchYear(excelBatchYear)) {
        setError(
            `Batch year is required. It will be applied to all rows where column C is empty. Must be between ${BATCH_YEAR_MIN} and ${BATCH_YEAR_MAX}.`
        );
        return;
      }
      // ──────────────────────────────────────────────────────────

      formData.append('file', file);
      formData.append('batchYear', excelBatchYear);
    }

    setLoading(true);
    try {
      const res = await api.post('/admin/students/invite', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(res.data.data);
      resetAll();
      onSuccess?.();
    } catch (err) {
      const code = err.response?.data?.error;
      const msg = err.response?.data?.message;
      if (code === 'VALIDATION_ERROR') {
        setError(msg || 'Either email addresses or an Excel file must be provided.');
      } else if (code === 'INVALID_FILE_FORMAT') {
        setError('File must be an Excel file (.xlsx or .xls).');
      } else if (code === 'NO_VALID_EMAILS') {
        setError('No valid email addresses found in the provided input.');
      } else {
        setError(msg || 'Failed to send invitations.');
      }
    } finally {
      setLoading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Derived
  // ─────────────────────────────────────────────────────────────
  const totalManualRows = rows.filter((r) => r.email.trim()).length;

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
      <div className="invite">
        <div className="invite-header">
          <div>
            <h3 className="invite-title">Invite Students</h3>
            <p className="invite-desc">
              Send invitation emails containing a registration link. Invitations expire
              after 2 hours. Students set their own name and password on registration.
            </p>
          </div>
        </div>

        {/* Mode tabs */}
        <div className="invite-tabs" role="tablist">
          <button
              type="button"
              role="tab"
              aria-selected={mode === 'manual'}
              className={`invite-tab${mode === 'manual' ? ' active' : ''}`}
              onClick={() => { setMode('manual'); setError(null); }}
          >
            <span className="invite-tab-icon">✎</span>
            Manual entry
          </button>
          <button
              type="button"
              role="tab"
              aria-selected={mode === 'excel'}
              className={`invite-tab${mode === 'excel' ? ' active' : ''}`}
              onClick={() => { setMode('excel'); setError(null); }}
          >
            <span className="invite-tab-icon">⊞</span>
            Upload Excel
          </button>
        </div>

        <form onSubmit={handleSubmit} className="invite-form" noValidate>
          {/* ───────── Manual entry ───────── */}
          {mode === 'manual' && (
              <>
                <div className="invite-batch-panel">
                  <label className="invite-switch">
                    <input
                        type="checkbox"
                        checked={sameBatchForAll}
                        onChange={(e) => setSameBatchForAll(e.target.checked)}
                    />
                    <span className="invite-switch-track">
                  <span className="invite-switch-thumb" />
                </span>
                    <span className="invite-switch-label">
                  Same batch year for all students
                </span>
                  </label>

                  {sameBatchForAll && (
                      <div className="invite-batch-input-wrap">
                        <label className="invite-label-inline">
                          Batch year <span className="invite-req-star">*</span>
                        </label>
                        <input
                            type="number"
                            className={`invite-input-sm${
                                sameBatchForAll && globalBatchYear && !isValidBatchYear(globalBatchYear)
                                    ? ' input-error'
                                    : ''
                            }`}
                            value={globalBatchYear}
                            onChange={(e) => setGlobalBatchYear(e.target.value)}
                            placeholder="e.g. 2024"
                            min={BATCH_YEAR_MIN}
                            max={BATCH_YEAR_MAX}
                        />
                      </div>
                  )}
                </div>

                <div className="invite-table">
                  <div className={`invite-trow invite-thead${sameBatchForAll ? '' : ' with-year'}`}>
                    <div className="invite-tcell">#</div>
                    <div className="invite-tcell">Email *</div>
                    <div className="invite-tcell">Name (optional)</div>
                    {!sameBatchForAll && (
                        <div className="invite-tcell">
                          Batch year <span className="invite-req-star">*</span>
                        </div>
                    )}
                    <div className="invite-tcell invite-tcell-action" />
                  </div>

                  {rows.map((row, idx) => (
                      <div
                          key={row.id}
                          className={`invite-trow${sameBatchForAll ? '' : ' with-year'}`}
                      >
                        <div className="invite-tcell invite-tcell-index">{idx + 1}</div>
                        <div className="invite-tcell">
                          <input
                              type="email"
                              className="invite-input"
                              value={row.email}
                              onChange={(e) => updateRow(row.id, 'email', e.target.value)}
                              onPaste={(e) => handleEmailPaste(e, row.id)}
                              placeholder="student@institution.edu"
                              autoComplete="off"
                          />
                        </div>
                        <div className="invite-tcell">
                          <input
                              type="text"
                              className="invite-input"
                              value={row.name}
                              onChange={(e) => updateRow(row.id, 'name', e.target.value)}
                              placeholder="Jane Doe"
                              autoComplete="off"
                          />
                        </div>
                        {!sameBatchForAll && (
                            <div className="invite-tcell">
                              <input
                                  type="number"
                                  className={`invite-input${
                                      row.email.trim() && row.batchYear && !isValidBatchYear(row.batchYear)
                                          ? ' input-error'
                                          : ''
                                  }`}
                                  value={row.batchYear || ''}
                                  onChange={(e) => updateRow(row.id, 'batchYear', e.target.value)}
                                  placeholder="2024 *"
                                  min={BATCH_YEAR_MIN}
                                  max={BATCH_YEAR_MAX}
                              />
                            </div>
                        )}
                        <div className="invite-tcell invite-tcell-action">
                          <button
                              type="button"
                              className="invite-row-remove"
                              onClick={() => removeRow(row.id)}
                              disabled={rows.length === 1}
                              aria-label="Remove row"
                              title="Remove row"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                  ))}
                </div>

                <div className="invite-row-actions">
                  <button type="button" className="invite-btn-secondary" onClick={addRow}>
                    + Add row
                  </button>
                  <span className="invite-tip">
                💡 Tip: paste a list (<code>email,name,year</code> per line) into the first
                email cell to auto-fill multiple rows.
              </span>
                </div>
              </>
          )}

          {/* ───────── Excel upload ───────── */}
          {mode === 'excel' && (
              <>
                <div className="invite-format-card">
                  <div className="invite-format-header">
                    <span className="invite-format-icon">ℹ</span>
                    <strong>Excel format</strong>
                    <button
                        type="button"
                        className="invite-link-btn"
                        onClick={downloadTemplate}
                    >
                      ⬇ Download template
                    </button>
                  </div>
                  <div className="invite-format-body">
                    <p className="invite-format-intro">
                      Row 1 is treated as a header and skipped. Required columns:
                    </p>
                    <table className="invite-format-table">
                      <thead>
                      <tr>
                        <th>Column</th>
                        <th>Field</th>
                        <th>Required</th>
                        <th>Example</th>
                      </tr>
                      </thead>
                      <tbody>
                      <tr>
                        <td><code>A</code></td>
                        <td>Email</td>
                        <td><span className="invite-req">Yes</span></td>
                        <td><code>akshit.dhake@mitaoe.ac.in</code></td>
                      </tr>
                      <tr>
                        <td><code>B</code></td>
                        <td>Name</td>
                        <td><span className="invite-opt-tag">Optional</span></td>
                        <td><code>Akshit Dhake</code></td>
                      </tr>
                      <tr>
                        <td><code>C</code></td>
                        <td>Batch year</td>
                        <td><span className="invite-req">Yes</span></td>
                        <td><code>2022</code></td>
                      </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Drag & drop zone */}
                <div
                    className={`invite-dropzone${dragActive ? ' drag-active' : ''}${file ? ' has-file' : ''}`}
                    onDragEnter={handleDrag}
                    onDragOver={handleDrag}
                    onDragLeave={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => !file && fileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                >
                  <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={(e) => e.target.files?.[0] && acceptFile(e.target.files[0])}
                      style={{ display: 'none' }}
                  />
                  {!file ? (
                      <>
                        <div className="invite-dropzone-icon">⬆</div>
                        <div className="invite-dropzone-primary">
                          Drag &amp; drop your Excel file here
                        </div>
                        <div className="invite-dropzone-secondary">
                          or <span className="invite-link-inline">click to browse</span>
                          &nbsp;·&nbsp;.xlsx or .xls · max 5 MB
                        </div>
                      </>
                  ) : (
                      <div className="invite-file-card">
                        <div className="invite-file-icon">📄</div>
                        <div className="invite-file-meta">
                          <div className="invite-file-name">{file.name}</div>
                          <div className="invite-file-size">
                            {(file.size / 1024).toFixed(1)} KB
                          </div>
                        </div>
                        <button
                            type="button"
                            className="invite-file-remove"
                            onClick={(e) => { e.stopPropagation(); setFile(null); }}
                        >
                          Remove
                        </button>
                      </div>
                  )}
                </div>

                {/* Batch year is now required in Excel mode too */}
                <div className="invite-batch-input-wrap">
                  <label className="invite-label-inline">
                    Batch year <span className="invite-req-star">*</span>
                  </label>
                  <input
                      type="number"
                      className={`invite-input-sm${
                          excelBatchYear && !isValidBatchYear(excelBatchYear) ? ' input-error' : ''
                      }`}
                      value={excelBatchYear}
                      onChange={(e) => setExcelBatchYear(e.target.value)}
                      placeholder="e.g. 2024"
                      min={BATCH_YEAR_MIN}
                      max={BATCH_YEAR_MAX}
                  />
                  <span className="invite-hint">
                Required. Applied to rows where column C is empty.
              </span>
                </div>
              </>
          )}

          {error && <div className="invite-error">⚠ {error}</div>}

          <div className="invite-submit-row">
            <button
                type="submit"
                className="invite-submit"
                disabled={loading || (mode === 'manual' ? totalManualRows === 0 : !file)}
            >
              {loading ? (
                  <>
                    <span className="spinner-sm" /> Sending invitations…
                  </>
              ) : (
                  <>
                    Send{' '}
                    {mode === 'manual' && totalManualRows > 0
                        ? `${totalManualRows} invitation${totalManualRows === 1 ? '' : 's'}`
                        : 'invitations'}
                  </>
              )}
            </button>
          </div>
        </form>

        {/* ───────── Results ───────── */}
        {result && (
            <div className="invite-results">
              <div className="invite-summary">
                <div className="invite-stat-card success">
                  <div className="invite-stat-num">{result.totalInvited}</div>
                  <div className="invite-stat-label">Invited</div>
                </div>
                <div className="invite-stat-card warn">
                  <div className="invite-stat-num">{result.totalSkipped}</div>
                  <div className="invite-stat-label">Skipped</div>
                </div>
                <div className="invite-stat-card error">
                  <div className="invite-stat-num">{result.totalInvalid}</div>
                  <div className="invite-stat-label">Invalid</div>
                </div>
              </div>

              {result.invited?.length > 0 && (
                  <div className="invite-section">
                    <h4 className="invite-section-title success">
                      ✓ Invited ({result.totalInvited})
                    </h4>
                    <ul className="invite-list">
                      {result.invited.map((entry) => {
                        const email = typeof entry === 'string' ? entry : entry.email;
                        return (
                            <li key={email} className="invite-item success">
                              {email}
                            </li>
                        );
                      })}
                    </ul>
                  </div>
              )}

              {result.skipped?.length > 0 && (
                  <div className="invite-section">
                    <h4 className="invite-section-title warn">
                      ⚠ Skipped ({result.totalSkipped})
                    </h4>
                    <ul className="invite-list">
                      {result.skipped.map(({ email, reason }) => (
                          <li key={email} className="invite-item warn">
                            <span>{email}</span>
                            <span className="invite-reason">— {reason}</span>
                          </li>
                      ))}
                    </ul>
                  </div>
              )}

              {result.invalid?.length > 0 && (
                  <div className="invite-section">
                    <h4 className="invite-section-title error">
                      ✗ Invalid ({result.totalInvalid})
                    </h4>
                    <ul className="invite-list">
                      {result.invalid.map(({ email, reason }) => (
                          <li key={email} className="invite-item error">
                            <span>{email}</span>
                            <span className="invite-reason">— {reason}</span>
                          </li>
                      ))}
                    </ul>
                  </div>
              )}
            </div>
        )}

        <style>{`
        /*
         * Color vars (--accent, --card-bg, --border, --text-primary, etc.)
         * are set on :root by Navbar.jsx / ThemeContext and toggled by the
         * navbar pill toggle. StudentInvite just consumes them.
         */
        .invite {
          font-family: 'DM Sans', 'Segoe UI', sans-serif;
          background: var(--card-bg);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 1.75rem;
          box-shadow: 0 1px 3px rgba(0,0,0,0.06);
          color: var(--text-primary);
          transition: background 0.25s, border-color 0.25s, color 0.25s;
        }

        /* ── Header ── */
        .invite-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 1rem;
          margin-bottom: 1.25rem;
        }
        .invite-title {
          font-size: 1.125rem;
          font-weight: 800;
          color: var(--heading-color, var(--text-primary));
          margin: 0 0 0.35rem;
          letter-spacing: -0.02em;
        }
        .invite-desc {
          font-size: 0.82rem;
          color: var(--text-secondary);
          margin: 0;
          line-height: 1.5;
          max-width: 640px;
        }

        /* ── Tabs ── */
        .invite-tabs {
          display: flex;
          gap: 0.25rem;
          padding: 0.25rem;
          background: var(--input-bg);
          border-radius: 9px;
          margin-bottom: 1.25rem;
          width: fit-content;
        }
        .invite-tab {
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
          padding: 0.5rem 1rem;
          border: none;
          background: transparent;
          color: var(--text-secondary);
          font-size: 0.85rem;
          font-weight: 500;
          font-family: inherit;
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.15s, color 0.15s, box-shadow 0.15s;
        }
        .invite-tab:hover { color: var(--text-primary); }
        .invite-tab.active {
          background: var(--card-bg);
          color: var(--text-primary);
          font-weight: 600;
          box-shadow: 0 1px 3px rgba(0,0,0,0.12);
        }
        .invite-tab-icon { font-size: 0.95rem; opacity: 0.85; }

        .invite-form {
          display: flex;
          flex-direction: column;
          gap: 1.1rem;
        }

        /* ── Batch panel + switch ── */
        .invite-batch-panel {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          padding: 0.85rem 1rem;
          background: var(--input-bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          flex-wrap: wrap;
        }
        .invite-switch {
          display: inline-flex;
          align-items: center;
          gap: 0.65rem;
          cursor: pointer;
          user-select: none;
        }
        .invite-switch input {
          position: absolute;
          opacity: 0;
          pointer-events: none;
        }
        .invite-switch-track {
          position: relative;
          width: 34px;
          height: 20px;
          background: rgba(128,128,128,0.35);
          border-radius: 10px;
          transition: background 0.18s;
          flex-shrink: 0;
        }
        .invite-switch-thumb {
          position: absolute;
          top: 2px;
          left: 2px;
          width: 16px;
          height: 16px;
          background: #fff;
          border-radius: 50%;
          transition: transform 0.18s;
          box-shadow: 0 1px 3px rgba(0,0,0,0.25);
        }
        .invite-switch input:checked + .invite-switch-track { background: var(--accent); }
        .invite-switch input:checked + .invite-switch-track .invite-switch-thumb {
          transform: translateX(14px);
        }
        .invite-switch-label {
          font-size: 0.85rem;
          color: var(--text-primary);
          font-weight: 500;
        }

        .invite-batch-input-wrap {
          display: inline-flex;
          align-items: center;
          gap: 0.6rem;
          flex-wrap: wrap;
        }
        .invite-label-inline {
          font-size: 0.78rem;
          color: var(--text-secondary);
          font-weight: 500;
        }
        .invite-req-star {
          color: var(--error);
          font-weight: 700;
          margin-left: 1px;
        }

        /* ── Table ── */
        .invite-table {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 0.5rem;
          background: var(--input-bg);
        }
        .invite-trow {
          display: grid;
          grid-template-columns: 36px 1fr 1fr 40px;
          gap: 0.5rem;
          align-items: center;
        }
        .invite-trow.with-year {
          grid-template-columns: 36px 1.4fr 1.2fr 100px 40px;
        }
        .invite-thead {
          font-size: 0.72rem;
          color: var(--text-secondary);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 0.3rem 0.25rem;
        }
        .invite-tcell { display: flex; align-items: center; }
        .invite-tcell-index {
          font-size: 0.8rem;
          color: var(--text-secondary);
          justify-content: center;
          font-variant-numeric: tabular-nums;
        }
        .invite-tcell-action { justify-content: center; }

        /* ── Inputs ── */
        .invite-input,
        .invite-input-sm {
          width: 100%;
          padding: 0.5rem 0.7rem;
          border: 1px solid var(--input-border);
          border-radius: 6px;
          background: var(--card-bg);
          color: var(--text-primary);
          font-size: 0.85rem;
          font-family: inherit;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .invite-input-sm {
          padding: 0.4rem 0.65rem;
          width: 110px;
        }
        .invite-input:focus,
        .invite-input-sm:focus {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 3px rgba(99,102,241,0.18);
        }
        /* Error state highlight */
        .invite-input.input-error,
        .invite-input-sm.input-error {
          border-color: var(--error);
          box-shadow: 0 0 0 2px rgba(220,38,38,0.15);
        }

        /* Placeholder color in dark mode */
        .invite-input::placeholder,
        .invite-input-sm::placeholder {
          color: var(--text-secondary);
          opacity: 0.6;
        }

        .invite-row-remove {
          width: 28px; height: 28px;
          display: inline-flex; align-items: center; justify-content: center;
          background: transparent;
          border: 1px solid transparent;
          color: var(--text-secondary);
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.85rem;
          transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .invite-row-remove:hover:not(:disabled) {
          background: rgba(220,38,38,0.1);
          color: var(--error);
          border-color: rgba(220,38,38,0.25);
        }
        .invite-row-remove:disabled { opacity: 0.3; cursor: not-allowed; }

        .invite-row-actions {
          display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
        }
        .invite-btn-secondary {
          padding: 0.45rem 0.9rem;
          background: transparent;
          border: 1px dashed var(--border);
          color: var(--text-primary);
          border-radius: 6px;
          font-size: 0.82rem; font-family: inherit; font-weight: 500;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
        }
        .invite-btn-secondary:hover {
          background: var(--input-bg);
          border-color: var(--accent);
          border-style: solid;
        }
        .invite-tip {
          font-size: 0.75rem;
          color: var(--text-secondary);
          line-height: 1.5;
        }
        .invite-tip code {
          background: var(--input-bg);
          border: 1px solid var(--border);
          padding: 1px 5px;
          border-radius: 3px;
          font-size: 0.72rem;
          font-family: 'DM Mono', 'Consolas', monospace;
          color: var(--text-primary);
        }

        /* ── Format card (Excel mode) ── */
        .invite-format-card {
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--card-bg);
          overflow: hidden;
        }
        .invite-format-header {
          display: flex; align-items: center; gap: 0.6rem;
          padding: 0.65rem 1rem;
          background: var(--input-bg);
          border-bottom: 1px solid var(--border);
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--text-primary);
        }
        .invite-format-icon { color: var(--accent); font-weight: 700; }
        .invite-link-btn {
          margin-left: auto;
          background: transparent;
          border: 1px solid var(--border);
          color: var(--accent);
          padding: 0.3rem 0.7rem;
          border-radius: 5px;
          font-size: 0.78rem; font-weight: 500; font-family: inherit;
          cursor: pointer;
          transition: background 0.15s;
        }
        .invite-link-btn:hover { background: rgba(99,102,241,0.1); }
        .invite-format-body { padding: 0.85rem 1rem 1rem; }
        .invite-format-intro { margin: 0 0 0.65rem; font-size: 0.8rem; color: var(--text-secondary); }
        .invite-format-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
        .invite-format-table thead tr {
          background: var(--input-bg);
        }
        .invite-format-table th {
          text-align: left;
          padding: 0.5rem 0.75rem;
          font-weight: 700;
          color: var(--text-secondary);
          border-bottom: 1px solid var(--border);
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          background: transparent;
        }
        .invite-format-table tbody tr {
          background: var(--card-bg);
          transition: background 0.12s;
        }
        .invite-format-table tbody tr:hover {
          background: var(--input-bg);
        }
        .invite-format-table td {
          padding: 0.5rem 0.75rem;
          color: var(--text-primary);
          border-bottom: 1px solid var(--border);
          background: transparent;
          font-size: 0.82rem;
        }
        .invite-format-table tr:last-child td { border-bottom: none; }
        .invite-format-table code {
          background: var(--input-bg);
          border: 1px solid var(--border);
          padding: 1px 5px; border-radius: 3px;
          font-size: 0.75rem;
          font-family: 'DM Mono', 'Consolas', monospace;
          color: var(--text-primary);
        }
        .invite-req { color: var(--error); font-weight: 600; }
        .invite-opt-tag { color: var(--text-secondary); }

        /* ── Drop zone ── */
        .invite-dropzone {
          border: 2px dashed var(--border);
          border-radius: 10px;
          padding: 2rem 1.5rem;
          text-align: center;
          cursor: pointer;
          transition: border-color 0.18s, background 0.18s;
          background: var(--input-bg);
        }
        .invite-dropzone:hover { border-color: var(--accent); background: rgba(99,102,241,0.05); }
        .invite-dropzone.drag-active {
          border-color: var(--accent);
          background: rgba(99,102,241,0.09);
          border-style: solid;
        }
        .invite-dropzone.has-file { padding: 1rem; cursor: default; }
        .invite-dropzone-icon { font-size: 2rem; color: var(--accent); margin-bottom: 0.5rem; }
        .invite-dropzone-primary { font-size: 0.95rem; color: var(--text-primary); font-weight: 600; margin-bottom: 0.25rem; }
        .invite-dropzone-secondary { font-size: 0.78rem; color: var(--text-secondary); }
        .invite-link-inline { color: var(--accent); text-decoration: underline; }
        .invite-file-card {
          display: flex; align-items: center; gap: 0.85rem;
          padding: 0.75rem 1rem;
          background: var(--card-bg);
          border: 1px solid var(--border);
          border-radius: 8px;
        }
        .invite-file-icon { font-size: 1.5rem; }
        .invite-file-meta { flex: 1; text-align: left; overflow: hidden; }
        .invite-file-name {
          font-size: 0.85rem; color: var(--text-primary); font-weight: 500;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .invite-file-size { font-size: 0.72rem; color: var(--text-secondary); }
        .invite-file-remove {
          background: transparent; border: 1px solid var(--border);
          color: var(--error); padding: 0.3rem 0.7rem; border-radius: 5px;
          font-size: 0.78rem; cursor: pointer; font-family: inherit;
          transition: background 0.15s;
        }
        .invite-file-remove:hover { background: rgba(220,38,38,0.08); }
        .invite-hint { font-size: 0.72rem; color: var(--text-secondary); }

        /* ── Error banner ── */
        .invite-error {
          background: rgba(220,38,38,0.09);
          border: 1px solid rgba(220,38,38,0.28);
          color: var(--error);
          padding: 0.6rem 0.85rem;
          border-radius: 7px;
          font-size: 0.82rem;
          line-height: 1.5;
        }

        /* ── Submit ── */
        .invite-submit-row { display: flex; justify-content: flex-end; padding-top: 0.25rem; }
        .invite-submit {
          background: var(--accent);
          border: none; color: #fff;
          padding: 0.6rem 1.75rem;
          border-radius: 7px;
          font-size: 0.875rem; font-weight: 600; font-family: inherit;
          cursor: pointer;
          display: inline-flex; align-items: center; gap: 0.5rem;
          transition: filter 0.15s, transform 0.08s;
          box-shadow: 0 1px 3px rgba(0,0,0,0.15);
        }
        .invite-submit:hover:not(:disabled) { filter: brightness(1.1); }
        .invite-submit:active:not(:disabled) { transform: translateY(1px); }
        .invite-submit:disabled { opacity: 0.5; cursor: not-allowed; }
        .spinner-sm {
          width: 13px; height: 13px;
          border: 2px solid rgba(255,255,255,0.4);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
          display: inline-block;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* ── Results ── */
        .invite-results {
          margin-top: 1.5rem; padding-top: 1.25rem;
          border-top: 1px solid var(--border);
          display: flex; flex-direction: column; gap: 1rem;
        }
        .invite-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; }
        .invite-stat-card { padding: 0.85rem 1rem; border-radius: 8px; text-align: center; }
        .invite-stat-card.success { background: rgba(22,163,74,0.1); color: var(--success); }
        .invite-stat-card.warn    { background: rgba(217,119,6,0.1); color: var(--warning); }
        .invite-stat-card.error   { background: rgba(220,38,38,0.1); color: var(--error); }
        .invite-stat-num {
          font-size: 1.75rem; font-weight: 700; line-height: 1;
          margin-bottom: 0.2rem; font-variant-numeric: tabular-nums;
        }
        .invite-stat-label { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; }
        .invite-section { display: flex; flex-direction: column; gap: 0.4rem; }
        .invite-section-title { font-size: 0.82rem; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
        .invite-section-title.success { color: var(--success); }
        .invite-section-title.warn    { color: var(--warning); }
        .invite-section-title.error   { color: var(--error); }
        .invite-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.25rem; }
        .invite-item {
          font-size: 0.8rem; display: flex; gap: 0.4rem; flex-wrap: wrap;
          padding: 0.3rem 0.6rem; border-radius: 5px;
        }
        .invite-item.success { color: var(--success); background: rgba(22,163,74,0.06); }
        .invite-item.warn    { color: var(--warning); background: rgba(217,119,6,0.06); }
        .invite-item.error   { color: var(--error);   background: rgba(220,38,38,0.06); }
        .invite-reason { color: var(--text-secondary); }

        /* ── Mobile ── */
        @media (max-width: 640px) {
          .invite { padding: 1.25rem; }
          .invite-trow {
            grid-template-columns: 30px 1fr 34px;
            row-gap: 0.35rem;
          }
          .invite-trow.with-year { grid-template-columns: 30px 1fr 34px; }
          .invite-trow .invite-tcell:nth-child(3),
          .invite-trow.with-year .invite-tcell:nth-child(3),
          .invite-trow.with-year .invite-tcell:nth-child(4) { grid-column: 2 / 3; }
          .invite-thead { display: none; }
          .invite-summary { grid-template-columns: 1fr; }
          .invite-batch-panel { flex-direction: column; align-items: flex-start; }
        }
      `}</style>
      </div>
  );
}