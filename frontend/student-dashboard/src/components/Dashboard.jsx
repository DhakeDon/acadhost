import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useTheme } from '../context/ThemeContext';
import ProjectCard from './ProjectCard';

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard v2
//
// Single-row metric grid (5 gauges) + full-width project list.
// - Uses all available horizontal space (no narrow column).
// - Each metric is a gauge card with number + bar + remaining text.
// - Metric gauge colour shifts: green → amber (>70%) → red (>90%).
// ─────────────────────────────────────────────────────────────────────────────

const METRICS = [
  { key: 'cpu',       label: 'CPU Cores', icon: '⚡',
    usedKey: 'cpuUsed',      totalKey: 'cpuQuota',       unit: 'cores' },
  { key: 'ram',       label: 'RAM',       icon: '▣',
    usedKey: 'ramUsedMb',    totalKey: 'ramQuotaMb',     unit: 'MB' },
  { key: 'storage',   label: 'Storage',   icon: '◉',
    usedKey: 'storageUsedMb',totalKey: 'storageQuotaMb', unit: 'MB', warnKey: 'storageWarning' },
  { key: 'projects',  label: 'Projects',  icon: '◈',
    usedKey: 'projectCount', totalKey: 'maxProjects',    unit: '' },
  { key: 'databases', label: 'Databases', icon: '⬡',
    usedKey: 'databaseCount',totalKey: 'maxDatabases',   unit: '' },
];

export default function Dashboard() {
  const [profile,  setProfile]  = useState(null);
  const [projects, setProjects] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const { initTheme } = useTheme();
  const navigate = useNavigate();

  const loadData = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [profRes, projRes] = await Promise.all([
        api.get('/student/profile'),
        api.get('/projects'),
      ]);
      const prof = profRes.data.data;
      setProfile(prof);
      setProjects(projRes.data.data.items || []);
      initTheme(prof.darkMode);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  }, [initTheme]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) return <div className="spinner-center"><div className="spinner spinner-lg" /></div>;
  if (error) {
    return (
        <div className="alert alert-error" style={{ marginTop: '2rem' }}>
          {error}
          <button className="btn btn-ghost btn-sm" onClick={loadData} style={{ marginLeft: '1rem' }}>Retry</button>
        </div>
    );
  }

  const activeProjects = projects.filter(p => p.status !== 'deleted');
  const counts = {
    running:  activeProjects.filter(p => p.status === 'running').length,
    stopped:  activeProjects.filter(p => p.status === 'stopped').length,
    building: activeProjects.filter(p => p.status === 'building').length,
    failed:   activeProjects.filter(p => p.status === 'failed').length,
  };

  return (
      <div>
        {/* Header */}
        <div className="section-header">
          <div>
            <h1 className="section-title">Dashboard</h1>
            <p className="section-subtitle">
              Resource usage across your account
              {profile && (
                  <> · <span className="mono" style={{ color: 'var(--text-primary)' }}>{profile.name || profile.email}</span></>
              )}
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={loadData}>↻ Refresh</button>
        </div>

        {/* Metrics row — 5 gauges */}
        {profile && (
            <div className="dash-grid" style={{ marginBottom: '1.75rem' }}>
              {METRICS.map(m => (
                  <MetricCard
                      key={m.key}
                      label={m.label}
                      icon={m.icon}
                      used={profile[m.usedKey] ?? 0}
                      total={profile[m.totalKey] ?? 0}
                      unit={m.unit}
                      warning={m.warnKey ? Boolean(profile[m.warnKey]) : false}
                  />
              ))}
            </div>
        )}

        {/* Projects */}
        <div className="section-header">
          <div>
            <h2 className="section-title" style={{ fontSize: '1rem' }}>Your Projects</h2>
            <p className="section-subtitle">
              {activeProjects.length} of {profile?.maxProjects ?? '—'} active
              {counts.running  > 0 && <> · <span style={{ color: 'var(--success)' }}>{counts.running} running</span></>}
              {counts.stopped  > 0 && <> · <span style={{ color: 'var(--text-muted)' }}>{counts.stopped} stopped</span></>}
              {counts.building > 0 && <> · <span style={{ color: 'var(--info)' }}>{counts.building} building</span></>}
              {counts.failed   > 0 && <> · <span style={{ color: 'var(--error)' }}>{counts.failed} failed</span></>}
            </p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/projects')}>+ New Project</button>
        </div>

        {activeProjects.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">◈</div>
              <div className="empty-state-title">No projects yet</div>
              <div className="empty-state-subtitle">Deploy your first project to get started.</div>
              <button className="btn btn-primary btn-sm" onClick={() => navigate('/projects')} style={{ marginTop: '1rem' }}>
                + Create Project
              </button>
            </div>
        ) : (
            <div className="grid grid-3">
              {activeProjects.map(p => <ProjectCard key={p.id} project={p} />)}
            </div>
        )}

        <style>{`
        .dash-grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 0.75rem;
        }
        @media (max-width: 1100px) {
          .dash-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }
        @media (max-width: 680px) {
          .dash-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 420px) {
          .dash-grid { grid-template-columns: 1fr; }
        }

        .metric-card {
          background: var(--card-bg);
          border: 1px solid var(--card-border);
          padding: 0.85rem 0.95rem;
          border-radius: 2px;
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
          min-width: 0;
        }
        .metric-head {
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }
        .metric-icon {
          color: var(--accent);
          font-size: 0.8rem;
        }
        .metric-label {
          font-size: 0.62rem;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .metric-warn-dot {
          width: 7px; height: 7px;
          background: var(--warning);
          border-radius: 50%;
          margin-left: auto;
          box-shadow: 0 0 6px var(--warning);
        }
        .metric-value {
          display: flex;
          align-items: baseline;
          gap: 0.25rem;
          min-width: 0;
        }
        .metric-num {
          font-size: 1.4rem;
          font-weight: 700;
          color: var(--text-primary);
          font-family: 'JetBrains Mono', monospace;
          line-height: 1;
          letter-spacing: -0.02em;
        }
        .metric-total {
          font-size: 0.78rem;
          color: var(--text-muted);
          font-family: 'JetBrains Mono', monospace;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .metric-remaining {
          font-size: 0.64rem;
          color: var(--text-muted);
          letter-spacing: 0.03em;
        }
      `}</style>
      </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function MetricCard({ label, icon, used, total, unit, warning }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const gaugeCls = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : '';

  const formatted = formatValue(used, unit);
  const totalFmt  = formatValue(total, unit);
  const remaining = Math.max(0, total - used);
  const remFmt    = formatValue(remaining, unit);

  return (
      <div className="metric-card">
        <div className="metric-head">
          <span className="metric-icon">{icon}</span>
          <span className="metric-label">{label}</span>
          {warning && <span className="metric-warn-dot" title="High usage" />}
        </div>

        <div className="metric-value">
          <span className="metric-num">{formatted.value}</span>
          <span className="metric-total">
          {formatted.suffix && <span>{formatted.suffix} </span>}
            / {totalFmt.value}{totalFmt.suffix ? ` ${totalFmt.suffix}` : ''}{unit && unit !== 'MB' && unit !== 'cores' ? '' : ''}
        </span>
        </div>

        <div className="gauge-track">
          <div className={`gauge-fill ${gaugeCls}`} style={{ width: `${pct}%` }} />
        </div>

        <div className="metric-remaining">
          {remFmt.value}{remFmt.suffix ? ` ${remFmt.suffix}` : ''}{unit === 'cores' ? ' cores' : unit === 'MB' ? '' : ''} remaining
        </div>
      </div>
  );
}

// Format helper returning { value, suffix } — lets us render MB as GB when large.
function formatValue(n, unit) {
  if (unit === 'cores') return { value: Number(n).toFixed(2), suffix: '' };
  if (unit === 'MB') {
    if (n >= 1024) return { value: (n / 1024).toFixed(1), suffix: 'GB' };
    return { value: String(Math.round(n)), suffix: 'MB' };
  }
  return { value: String(n), suffix: '' };
}