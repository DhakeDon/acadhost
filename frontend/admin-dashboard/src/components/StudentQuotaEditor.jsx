import { useState } from 'react';
import api from '../services/api';

/**
 * StudentQuotaEditor
 * Props:
 *   student — full student object from GET /api/admin/students item
 *   onClose — called when editor should be closed
 *   onSuccess — called after a successful quota update
 */
export default function StudentQuotaEditor({ student, onClose, onSuccess }) {
  const [form, setForm] = useState({
    cpuQuota: student.cpuQuota ?? '',
    ramQuotaMb: student.ramQuotaMb ?? '',
    storageQuotaMb: student.storageQuotaMb ?? '',
    maxProjects: student.maxProjects ?? '',
    maxDatabases: student.maxDatabases ?? '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // Client-side below-usage warnings (Section 14.10.5)
  const warnings = {};
  if (Number(form.cpuQuota) < Number(student.cpuUsed || 0)) {
    warnings.cpuQuota = `Below current usage (${student.cpuUsed} cores in use)`;
  }
  if (Number(form.ramQuotaMb) < Number(student.ramUsedMb || 0)) {
    warnings.ramQuotaMb = `Below current usage (${student.ramUsedMb} MB in use)`;
  }
  if (Number(form.maxProjects) < Number(student.projectCount || 0)) {
    warnings.maxProjects = `Below current usage (${student.projectCount} active projects)`;
  }
  if (Number(form.maxDatabases) < Number(student.databaseCount || 0)) {
    warnings.maxDatabases = `Below current usage (${student.databaseCount} databases)`;
  }

  function handleChange(field, value) {
    setForm(f => ({ ...f, [field]: value }));
    setError(null);
    setSuccess(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    // Build payload — only send defined positive values (all fields optional, Section 6.4.3)
    const payload = {};
    if (form.cpuQuota !== '' && form.cpuQuota !== null) payload.cpuQuota = Number(form.cpuQuota);
    if (form.ramQuotaMb !== '') payload.ramQuotaMb = Number(form.ramQuotaMb);
    if (form.storageQuotaMb !== '') payload.storageQuotaMb = Number(form.storageQuotaMb);
    if (form.maxProjects !== '') payload.maxProjects = Number(form.maxProjects);
    if (form.maxDatabases !== '') payload.maxDatabases = Number(form.maxDatabases);

    if (Object.keys(payload).length === 0) {
      setError('At least one quota field is required.');
      setLoading(false);
      return;
    }

    try {
      await api.put(`/admin/students/${student.id}/quota`, payload);
      setSuccess(true);
      onSuccess?.();
    } catch (err) {
      const code = err.response?.data?.error;
      const msg = err.response?.data?.message;
      if (code === 'QUOTA_BELOW_USAGE') {
        setError(msg || 'Cannot set quota below current usage.');
      } else if (code === 'STUDENT_NOT_FOUND') {
        setError('Student not found.');
      } else {
        setError(msg || 'Failed to update quota.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="sqe-overlay" onClick={onClose}>
      <div className="sqe-modal" onClick={e => e.stopPropagation()}>
        <div className="sqe-header">
          <div>
            <h3 className="sqe-title">Edit Quota</h3>
            <p className="sqe-student">{student.name || '—'} · {student.email}</p>
          </div>
          <button className="sqe-close" onClick={onClose}>✕</button>
        </div>

        {success && (
          <div className="sqe-success">✓ Quota updated successfully</div>
        )}
        {error && (
          <div className="sqe-error">⚠ {error}</div>
        )}

        <form onSubmit={handleSubmit} className="sqe-form">
          <QuotaField
            label="CPU Quota"
            field="cpuQuota"
            value={form.cpuQuota}
            used={student.cpuUsed}
            unit="cores"
            step="0.5"
            min="0.5"
            warning={warnings.cpuQuota}
            onChange={handleChange}
          />
          <QuotaField
            label="RAM Quota"
            field="ramQuotaMb"
            value={form.ramQuotaMb}
            used={student.ramUsedMb}
            unit="MB"
            step="256"
            min="256"
            warning={warnings.ramQuotaMb}
            onChange={handleChange}
          />
          <QuotaField
            label="Storage Quota"
            field="storageQuotaMb"
            value={form.storageQuotaMb}
            used={null}
            unit="MB"
            step="512"
            min="256"
            warning={null}
            onChange={handleChange}
          />
          <QuotaField
            label="Max Projects"
            field="maxProjects"
            value={form.maxProjects}
            used={student.projectCount}
            unit=""
            step="1"
            min="1"
            warning={warnings.maxProjects}
            onChange={handleChange}
          />
          <QuotaField
            label="Max Databases"
            field="maxDatabases"
            value={form.maxDatabases}
            used={student.databaseCount}
            unit=""
            step="1"
            min="1"
            warning={warnings.maxDatabases}
            onChange={handleChange}
          />

          <div className="sqe-footer">
            <button type="button" className="btn-cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-save" disabled={loading}>
              {loading ? <><span className="spinner-sm" /> Saving…</> : 'Save Changes'}
            </button>
          </div>
        </form>

        <style>{`
          .sqe-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.5);
            z-index: 200;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .sqe-modal {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 1.75rem;
            width: 100%;
            max-width: 480px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.2);
            font-family: 'DM Sans', 'Segoe UI', sans-serif;
          }
          .sqe-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            margin-bottom: 1.25rem;
          }
          .sqe-title { font-size: 1.1rem; font-weight: 700; color: var(--text-primary); margin: 0 0 0.2rem; }
          .sqe-student { font-size: 0.8rem; color: var(--text-secondary); margin: 0; }
          .sqe-close {
            background: none;
            border: none;
            font-size: 1rem;
            color: var(--text-secondary);
            cursor: pointer;
            padding: 2px 6px;
          }
          .sqe-success {
            background: rgba(76,175,80,0.1);
            border: 1px solid rgba(76,175,80,0.3);
            color: var(--success);
            padding: 0.6rem 0.875rem;
            border-radius: 6px;
            font-size: 0.85rem;
            margin-bottom: 1rem;
          }
          .sqe-error {
            background: rgba(244,67,54,0.1);
            border: 1px solid rgba(244,67,54,0.3);
            color: var(--error);
            padding: 0.6rem 0.875rem;
            border-radius: 6px;
            font-size: 0.85rem;
            margin-bottom: 1rem;
          }
          .sqe-form { display: flex; flex-direction: column; gap: 1rem; }
          .sqe-footer { display: flex; gap: 0.75rem; justify-content: flex-end; padding-top: 0.5rem; }
          .btn-cancel {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            color: var(--text-primary);
            padding: 0.5rem 1.25rem;
            border-radius: 7px;
            font-size: 0.875rem;
            cursor: pointer;
          }
          .btn-save {
            background: var(--accent);
            border: none;
            color: #fff;
            padding: 0.5rem 1.5rem;
            border-radius: 7px;
            font-size: 0.875rem;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 0.4rem;
          }
          .btn-save:disabled { opacity: 0.6; cursor: not-allowed; }
          .spinner-sm {
            width: 12px; height: 12px;
            border: 2px solid rgba(255,255,255,0.4);
            border-top-color: #fff;
            border-radius: 50%;
            animation: spin 0.6s linear infinite;
            display: inline-block;
          }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    </div>
  );
}

function QuotaField({ label, field, value, used, unit, step, min, warning, onChange }) {
  return (
    <div className="qf-row">
      <div className="qf-meta">
        <label className="qf-label">{label}</label>
        {used != null && (
          <span className="qf-usage">Currently using: {used} {unit}</span>
        )}
      </div>
      <input
        type="number"
        className={`qf-input${warning ? ' qf-warn' : ''}`}
        value={value}
        min={min}
        step={step}
        onChange={e => onChange(field, e.target.value)}
      />
      {warning && <div className="qf-warning">⚠ {warning}</div>}
      <style>{`
        .qf-row { display: flex; flex-direction: column; gap: 0.3rem; }
        .qf-meta { display: flex; justify-content: space-between; align-items: baseline; }
        .qf-label { font-size: 0.8rem; font-weight: 600; color: var(--text-primary); }
        .qf-usage { font-size: 0.72rem; color: var(--text-secondary); }
        .qf-input {
          padding: 0.45rem 0.75rem;
          border: 1px solid var(--input-border);
          border-radius: 6px;
          background: var(--input-bg);
          color: var(--text-primary);
          font-size: 0.875rem;
          width: 100%;
          box-sizing: border-box;
        }
        .qf-input.qf-warn { border-color: var(--warning); }
        .qf-warning { font-size: 0.72rem; color: var(--warning); }
      `}</style>
    </div>
  );
}
