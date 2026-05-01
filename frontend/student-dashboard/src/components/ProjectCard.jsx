import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

// ─────────────────────────────────────────────────────────────────────────────
// ProjectCard
//
// Shows the status, runtime, live URL, and live CPU / RAM utilisation for a
// project. Live stats come from GET /api/projects/:id/stats and are polled
// every 5 s while the card is mounted AND the project is in the `running`
// state. Non-running projects skip polling entirely.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_META = {
  running:  { label: 'RUNNING',  cls: 'badge-running',  dot: 'var(--success)' },
  stopped:  { label: 'STOPPED',  cls: 'badge-stopped',  dot: 'var(--text-muted)' },
  building: { label: 'BUILDING', cls: 'badge-building', dot: 'var(--info)' },
  failed:   { label: 'FAILED',   cls: 'badge-failed',   dot: 'var(--error)' },
  deploying:{ label: 'DEPLOYING',cls: 'badge-building', dot: 'var(--info)' },
};

export default function ProjectCard({ project }) {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const timerRef = useRef(null);

  const status = STATUS_META[project.status] || { label: String(project.status).toUpperCase(), cls: 'badge-stopped', dot: 'var(--text-muted)' };

  // ── Poll live stats every 5 s while running ─────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const sample = async () => {
      try {
        const res = await api.get(`/projects/${project.id}/stats`);
        if (!cancelled) setStats(res.data.data);
      } catch {
        if (!cancelled) setStats({ running: false, reason: 'CONTAINER_NOT_RUNNING' });
      }
    };

    if (project.status === 'running') {
      sample();
      timerRef.current = setInterval(sample, 5000);
    } else {
      setStats(null);
    }

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [project.id, project.status]);

  const handleSettings = () => navigate(`/projects/${project.id}/settings`);

  const live = stats && stats.running;
  const cpuPct = live ? Math.min(100, Math.round(stats.cpuPercent)) : 0;
  const memPct = live ? Math.min(100, Math.round(stats.memPercent)) : 0;
  const cpuGaugeCls = cpuPct >= 90 ? 'danger' : cpuPct >= 70 ? 'warn' : '';
  const memGaugeCls = memPct >= 90 ? 'danger' : memPct >= 70 ? 'warn' : '';

  return (
      <div className="card project-card">
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {/* Row 1: status + runtime tag */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
          <span className={`badge ${status.cls}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: status.dot, display: 'inline-block' }} />
            {status.label}
          </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
            {project.runtime
                ? `${project.runtime} ${project.runtimeVersion || ''}`.trim()
                : project.projectType === 'frontend' ? 'static' : project.projectType}
          </span>
          </div>

          {/* Title */}
          <div>
            <div className="card-heading" style={{ wordBreak: 'break-word' }}>{project.title}</div>
            <a
                href={project.liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mono"
                style={{ fontSize: '0.72rem', color: 'var(--accent)', textDecoration: 'none', wordBreak: 'break-all' }}
                onClick={e => e.stopPropagation()}
            >
              {project.subdomain}.acadhost.com ↗
            </a>
          </div>

          {/* Live gauges or inline placeholder */}
          {project.status === 'running' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.1rem' }}>
                <MiniGauge
                    label="CPU"
                    valueLabel={live ? `${stats.cpuPercent.toFixed(1)}%` : '…'}
                    pct={cpuPct}
                    cls={cpuGaugeCls}
                />
                <MiniGauge
                    label="RAM"
                    valueLabel={live ? `${stats.memUsageMb} / ${stats.memLimitMb} MB` : '…'}
                    pct={memPct}
                    cls={memGaugeCls}
                />
              </div>
          ) : (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', fontStyle: 'italic' }}>
                {project.status === 'stopped'  && 'Start the project to see live stats.'}
                {project.status === 'building' && 'Build in progress — stats will appear when it starts.'}
                {project.status === 'failed'   && 'Build failed — check build logs.'}
              </div>
          )}

          {/* Footer */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.3rem' }}>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {project.projectType}
          </span>
            <button className="btn btn-secondary btn-sm" onClick={handleSettings}>
              Settings →
            </button>
          </div>
        </div>
      </div>
  );
}

function MiniGauge({ label, valueLabel, pct, cls }) {
  return (
      <div className="gauge">
        <div className="gauge-head">
          <span className="gauge-label">{label}</span>
          <span className="gauge-value mono" style={{ fontSize: '0.75rem' }}>{valueLabel}</span>
        </div>
        <div className="gauge-track">
          <div className={`gauge-fill ${cls}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
  );
}