import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  PointElement, LineElement,
  BarElement, Filler, Tooltip, Legend,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import api from '../services/api';

ChartJS.register(
    CategoryScale, LinearScale,
    PointElement, LineElement,
    BarElement, Filler, Tooltip, Legend
);

const MAX_HISTORY = 20;

// ─── helpers ────────────────────────────────────────────────────────────────
function fmtMb(mb) {
  if (mb == null) return '—';
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}
function fmtCpu(v) {
  if (v == null) return '—';
  return Number(v).toFixed(2);
}
function pctOf(used, total) {
  if (!total || total <= 0) return 0;
  return Math.min((used / total) * 100, 100);
}

// ─── sub-components ──────────────────────────────────────────────────────────
function StatCard({ label, value, sub, tone, badge }) {
  return (
      <div className={`stat-card${tone ? ` stat-card--${tone}` : ''}`}>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {sub && <div className="stat-sub">{sub}</div>}
        {badge && <span className={`stat-badge stat-badge--${tone || 'info'}`}>{badge}</span>}
      </div>
  );
}

function UsageBar({ label, used, total, format }) {
  const pct = pctOf(used, total);
  const tone = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok';
  return (
      <div className="bar-row">
        <div className="bar-meta">
          <span className="bar-meta-lbl">{label}</span>
          <span className="bar-meta-val">
            <span className="mono">{format(used)}</span>
            <span className="bar-meta-slash"> / </span>
            <span className="mono bar-meta-total">{format(total)}</span>
            <span className={`bar-meta-pct bar-meta-pct--${tone}`}>{pct.toFixed(1)}%</span>
          </span>
        </div>
        <div className="bar-track">
          <div className={`bar-fill bar-fill--${tone}`} style={{ width: `${pct.toFixed(1)}%` }} />
        </div>
      </div>
  );
}

function LegendItem({ color, label, dashed }) {
  return (
      <span className="leg-item">
      {dashed
          ? <span className="leg-dashed" style={{ borderColor: color }} />
          : <span className="leg-sq" style={{ background: color }} />
      }
        {label}
    </span>
  );
}

// ─── main component ──────────────────────────────────────────────────────────
export default function Dashboard() {
  const [metrics, setMetrics]         = useState(null);
  const [liveData, setLiveData]       = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [pulse, setPulse]             = useState(false);

  const historyRef = useRef({ labels: [], cpu: [], ram: [], storage: [] });

  const addHistory = useCallback((d) => {
    const h = historyRef.current;
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    h.labels.push(t);
    h.cpu.push(parseFloat(d.cpuUsedPercent.toFixed(2)));
    h.ram.push(Math.round(d.ramUsedMb));
    h.storage.push(Math.round(d.storageUsedMb));
    if (h.labels.length > MAX_HISTORY) {
      h.labels.shift(); h.cpu.shift(); h.ram.shift(); h.storage.shift();
    }
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const [r1, r2] = await Promise.all([
        api.get('/admin/metrics'),
        api.get('/admin/live-project-usage'),
      ]);
      setMetrics(r1.data.data);
      const live = r2.data.data;
      addHistory(live);
      setLiveData({ ...live });
      setLastRefreshed(new Date());
      setError(null);
      setPulse(true);
      setTimeout(() => setPulse(false), 300);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  }, [addHistory]);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 30000);
    return () => clearInterval(id);
  }, [fetchAll]);

  // ── chart data ──────────────────────────────────────────────────────────────
  const h = historyRef.current;

  // Chart theme-aware colors
  const COL_CPU  = '#10b981';
  const COL_RAM  = '#2563eb';
  const COL_STO  = '#a855f7';

  const lineData = {
    labels: h.labels,
    datasets: [
      { label: 'CPU %',        data: h.cpu,                           borderColor: COL_CPU, backgroundColor: 'rgba(16,185,129,0.10)', borderWidth: 2, pointRadius: 0, tension: 0.35, fill: true },
      { label: 'RAM (÷10)',    data: h.ram.map(v => +(v / 10).toFixed(1)),     borderColor: COL_RAM, borderDash: [4, 3], borderWidth: 2, pointRadius: 0, tension: 0.35, fill: false },
      { label: 'Storage (÷10)',data: h.storage.map(v => +(v / 10).toFixed(1)), borderColor: COL_STO, borderWidth: 2, pointRadius: 0, tension: 0.35, fill: false },
    ],
  };

  const barData = {
    labels: ['CPU %', 'RAM (MB)', 'Storage (MB)'],
    datasets: [{
      label: 'Current',
      data: liveData
          ? [parseFloat(liveData.cpuUsedPercent.toFixed(2)), Math.round(liveData.ramUsedMb), Math.round(liveData.storageUsedMb)]
          : [0, 0, 0],
      backgroundColor: ['rgba(16,185,129,.85)', 'rgba(37,99,235,.85)', 'rgba(168,85,247,.85)'],
      borderColor: [COL_CPU, COL_RAM, COL_STO],
      borderWidth: 0,
      borderRadius: 4,
      maxBarThickness: 44,
    }],
  };

  const gridColor = 'rgba(128,128,128,0.12)';
  const tickColor = 'rgba(128,128,128,0.9)';

  const lineOptions = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 350 },
    plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false, callbacks: {
          label: (ctx) => {
            if (ctx.datasetIndex === 0) return ` CPU: ${ctx.raw}%`;
            if (ctx.datasetIndex === 1) return ` RAM: ${fmtMb(ctx.raw * 10)}`;
            return ` Storage: ${fmtMb(ctx.raw * 10)}`;
          },
        }}},
    scales: {
      x: { ticks: { color: tickColor, font: { size: 10 }, autoSkip: true, maxTicksLimit: 6, maxRotation: 0 }, grid: { color: gridColor, drawTicks: false } },
      y: { ticks: { color: tickColor, font: { size: 10 } }, grid: { color: gridColor, drawTicks: false }, beginAtZero: true, border: { display: false } },
    },
  };

  const barOptions = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 450 },
    plugins: { legend: { display: false }, tooltip: { callbacks: {
          label: (ctx) => ctx.dataIndex === 0 ? ` ${ctx.raw}%` : ` ${fmtMb(ctx.raw)}`,
        }}},
    scales: {
      x: { ticks: { color: tickColor, font: { size: 11 } }, grid: { display: false }, border: { display: false } },
      y: { ticks: { color: tickColor, font: { size: 10 } }, grid: { color: gridColor, drawTicks: false }, beginAtZero: true, border: { display: false } },
    },
  };

  // ── render guards ───────────────────────────────────────────────────────────
  if (loading) return (
      <div className="db-state">
        <div className="spinner-sm" />
        <span>Loading metrics…</span>
      </div>
  );

  if (error && !metrics) return (
      <div className="db-state db-state--err">
        <span>{error}</span>
        <button onClick={fetchAll} className="btn-retry">Retry</button>
      </div>
  );

  const warnPending = metrics.pendingResourceRequests > 0;

  return (
      <div className="dashboard">

        {/* ── header ── */}
        <div className="db-header">
          <div className="db-header-left">
            <h1 className="db-title">Overview</h1>
            <p className="db-sub">Platform-wide resource consumption and activity.</p>
          </div>
          <div className="db-header-right">
            <div className="live-tag">
              <span className={`live-dot${pulse ? ' live-dot--ping' : ''}`} />
              <span>Live</span>
              {lastRefreshed && (
                  <span className="upd-time">· updated {lastRefreshed.toLocaleTimeString()}</span>
              )}
            </div>
            <button className="btn-ref" onClick={fetchAll} aria-label="Refresh metrics">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {error && <div className="err-banner">{error}</div>}

        {/* ── platform activity cards ── */}
        <p className="sec-label">Platform activity</p>
        <div className="grid-3">
          <StatCard
              label="Live projects"
              value={metrics.totalLiveProjects.toLocaleString()}
              sub="Running containers"
          />
          <StatCard
              label="Active students"
              value={metrics.totalStudents.toLocaleString()}
              sub="Registered accounts"
          />
          <StatCard
              label="Pending requests"
              value={metrics.pendingResourceRequests.toLocaleString()}
              sub="Awaiting admin review"
              tone={warnPending ? 'warn' : undefined}
              badge={warnPending ? 'Needs review' : null}
          />
        </div>



        {/* ── usage bars ── */}
        <div className="panel usage-card">
          <div className="panel-hdr">
            <h2 className="panel-title">Resource utilisation</h2>
            <span className="panel-sub">Aggregate across all allocations</span>
          </div>
          <div className="panel-body">
            <UsageBar label="CPU"     used={metrics.aggregateCpuUsed}        total={metrics.totalCpuAllocated}        format={fmtCpu} />
            <UsageBar label="RAM"     used={metrics.aggregateRamUsedMb}       total={metrics.totalRamAllocatedMb}      format={fmtMb}  />
            <UsageBar label="Storage" used={metrics.aggregateStorageUsedMb}   total={metrics.totalStorageAllocatedMb}  format={fmtMb}  />
          </div>
        </div>

        {/* ── live container section ── */}
        <p className="sec-label">Live container metrics</p>
        <div className="grid-4">
          <StatCard label="Containers running" value={liveData?.projectsRunning ?? '—'} />
          <StatCard label="CPU usage"          value={liveData ? `${liveData.cpuUsedPercent.toFixed(1)}%` : '—'} sub="Live %" />
          <StatCard label="RAM used"           value={<span className="mono">{liveData ? fmtMb(liveData.ramUsedMb) : '—'}</span>} />
          <StatCard label="Storage used"       value={<span className="mono">{liveData ? fmtMb(liveData.storageUsedMb) : '—'}</span>} />
        </div>

        {/* ── line chart ── */}
        <div className="panel chart-card">
          <div className="panel-hdr">
            <div>
              <h2 className="panel-title">Usage history</h2>
              <span className="panel-sub">Last {MAX_HISTORY} snapshots · sampled every 30s</span>
            </div>
            <div className="legend">
              <LegendItem color={COL_CPU} label="CPU %" />
              <LegendItem color={COL_RAM} label="RAM ÷10" dashed />
              <LegendItem color={COL_STO} label="Storage ÷10" />
            </div>
          </div>
          <div className="panel-body">
            <div style={{ position: 'relative', height: 220 }}>
              <Line data={lineData} options={lineOptions} />
            </div>
          </div>
        </div>



        <style>{`
        .dashboard {
          font-family: 'Inter', 'DM Sans', 'Segoe UI', sans-serif;
          color: var(--text-primary);
        }
        .mono {
          font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
          font-variant-numeric: tabular-nums;
          font-size: 0.92em;
          letter-spacing: -0.01em;
        }

        /* ── header ── */
        .db-header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 14px;
          margin-bottom: 1.75rem;
          padding-bottom: 18px;
          border-bottom: 1px solid var(--border);
        }
        .db-title {
          font-size: 1.5rem;
          font-weight: 600;
          letter-spacing: -0.02em;
          color: var(--text-primary);
          margin: 0 0 4px;
        }
        .db-sub {
          font-size: 13px;
          color: var(--text-secondary);
          margin: 0;
        }
        .db-header-right {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .live-tag {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--text-secondary);
          background: var(--card-bg);
          padding: 6px 12px;
          border-radius: 999px;
          border: 1px solid var(--border);
          font-weight: 500;
        }
        .live-dot {
          width: 7px; height: 7px;
          border-radius: 50%;
          background: var(--success);
          display: inline-block;
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 18%, transparent);
          transition: transform 0.2s;
        }
        .live-dot--ping { transform: scale(1.4); }
        .upd-time { font-size: 11.5px; color: var(--text-muted); font-weight: 400; }

        .btn-ref {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: var(--card-bg);
          border: 1px solid var(--border);
          color: var(--text-primary);
          padding: 6px 12px;
          height: 30px;
          border-radius: 7px;
          font-size: 12.5px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
        }
        .btn-ref:hover { background: var(--bg-tertiary); border-color: var(--border-strong); }

        .btn-retry {
          background: var(--accent);
          color: var(--accent-fg);
          border: 1px solid var(--accent);
          padding: 7px 14px;
          border-radius: 7px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          margin-left: 10px;
        }
        .btn-retry:hover { background: var(--accent-hover); }

        .err-banner {
          padding: 10px 14px;
          border-radius: 8px;
          background: var(--error-soft);
          color: var(--error);
          border: 1px solid color-mix(in srgb, var(--error) 28%, transparent);
          font-size: 13px;
          margin-bottom: 1.25rem;
        }

        .sec-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.06em;
          color: var(--text-muted);
          text-transform: uppercase;
          margin: 24px 0 12px;
        }

        /* ── grids ── */
        .grid-3 {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }
        .grid-4 {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }
        @media (max-width: 960px) {
          .grid-3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .grid-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 560px) {
          .grid-3, .grid-4 { grid-template-columns: 1fr; }
        }

        /* ── stat cards ── */
        .stat-card {
          background: var(--card-bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 16px 18px;
          box-shadow: var(--card-shadow);
          position: relative;
          transition: border-color 0.15s;
        }
        .stat-card:hover { border-color: var(--border-strong); }
        .stat-card--warn { border-color: color-mix(in srgb, var(--warning) 40%, var(--border)); }

        .stat-label {
          font-size: 12px;
          color: var(--text-secondary);
          font-weight: 500;
          margin-bottom: 6px;
        }
        .stat-value {
          font-size: 22px;
          font-weight: 600;
          letter-spacing: -0.02em;
          line-height: 1.15;
          color: var(--text-primary);
        }
        .stat-sub {
          font-size: 11.5px;
          color: var(--text-muted);
          margin-top: 4px;
        }
        .stat-badge {
          display: inline-flex;
          align-items: center;
          position: absolute;
          top: 14px;
          right: 14px;
          font-size: 10.5px;
          font-weight: 500;
          padding: 2px 8px;
          border-radius: 999px;
          letter-spacing: 0.01em;
        }
        .stat-badge--warn {
          background: var(--warning-soft);
          color: var(--warning);
          border: 1px solid color-mix(in srgb, var(--warning) 28%, transparent);
        }
        .stat-badge--info {
          background: var(--info-soft);
          color: var(--info);
        }

        /* ── panels ── */
        .panel {
          background: var(--card-bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          box-shadow: var(--card-shadow);
          margin-top: 12px;
        }
        .panel-hdr {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding: 14px 18px;
          border-bottom: 1px solid var(--border);
          flex-wrap: wrap;
        }
        .panel-title {
          font-size: 13.5px;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0;
          letter-spacing: -0.005em;
        }
        .panel-sub {
          display: block;
          font-size: 11.5px;
          color: var(--text-muted);
          margin-top: 2px;
        }
        .panel-body { padding: 18px; }

        /* ── usage bars ── */
        .bar-row { margin-bottom: 16px; }
        .bar-row:last-child { margin-bottom: 0; }
        .bar-meta {
          display: flex; justify-content: space-between; align-items: baseline;
          font-size: 12.5px; margin-bottom: 7px;
        }
        .bar-meta-lbl { color: var(--text-primary); font-weight: 500; }
        .bar-meta-val { color: var(--text-secondary); display: inline-flex; align-items: baseline; gap: 0; }
        .bar-meta-slash { color: var(--border-strong); margin: 0 2px; }
        .bar-meta-total { color: var(--text-muted); }
        .bar-meta-pct {
          margin-left: 10px;
          padding: 1px 6px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
        }
        .bar-meta-pct--ok     { background: var(--success-soft); color: var(--success); }
        .bar-meta-pct--warn   { background: var(--warning-soft); color: var(--warning); }
        .bar-meta-pct--danger { background: var(--error-soft);   color: var(--error);   }

        .bar-track {
          height: 6px;
          border-radius: 999px;
          background: var(--bg-tertiary);
          overflow: hidden;
        }
        .bar-fill  {
          height: 100%;
          border-radius: 999px;
          transition: width 0.5s cubic-bezier(.4,0,.2,1);
        }
        .bar-fill--ok     { background: var(--success); }
        .bar-fill--warn   { background: var(--warning); }
        .bar-fill--danger { background: var(--error);   }

        /* ── legend ── */
        .legend { display: flex; flex-wrap: wrap; gap: 12px; }
        .leg-item {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 11.5px; color: var(--text-secondary);
        }
        .leg-sq { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
        .leg-dashed { width: 14px; height: 0; border-top: 2px dashed; display: inline-block; }

        /* ── loading/error state ── */
        .db-state {
          display: flex; align-items: center; justify-content: center;
          gap: 12px; padding: 64px 16px; color: var(--text-secondary); font-size: 13px;
        }
        .db-state--err { color: var(--error); }
        .spinner-sm {
          width: 18px; height: 18px;
          border: 2px solid var(--border);
          border-top-color: var(--accent);
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      </div>
  );
}
