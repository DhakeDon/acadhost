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
function barColor(pct) {
  return pct >= 90 ? 'var(--error)' : pct >= 70 ? 'var(--warning)' : 'var(--accent)';
}

// ─── sub-components ──────────────────────────────────────────────────────────
function MetricCard3D({ icon, accentBg, value, label, hint, highlight, badge }) {
  return (
      <div className={`card3d${highlight ? ' card3d--warn' : ''}`}>
        {icon && (
            <div className="card3d-icon" style={{ background: accentBg }}>
              {icon}
            </div>
        )}
        <div className="card3d-value">{value}</div>
        <div className="card3d-label">{label}</div>
        {hint && <div className="card3d-hint">{hint}</div>}
        {badge && <span className="card3d-badge">{badge}</span>}
      </div>
  );
}

function UsageBar({ label, used, total, format }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  return (
      <div className="bar-row">
        <div className="bar-meta">
          <span className="bar-meta-lbl">{label}</span>
          <span className="bar-meta-val">{format(used)} / {format(total)}</span>
        </div>
        <div className="bar-track">
          <div
              className="bar-fill"
              style={{ width: `${pct.toFixed(1)}%`, background: barColor(pct) }}
          />
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

  const lineData = {
    labels: h.labels,
    datasets: [
      { label: 'CPU %', data: h.cpu, borderColor: '#1D9E75', backgroundColor: 'rgba(29,158,117,0.07)', borderWidth: 2, pointRadius: 2, tension: 0.35, fill: true },
      { label: 'RAM (÷10)', data: h.ram.map(v => +(v / 10).toFixed(1)), borderColor: '#378ADD', borderDash: [4, 3], borderWidth: 2, pointRadius: 2, tension: 0.35, fill: false },
      { label: 'Storage (÷10)', data: h.storage.map(v => +(v / 10).toFixed(1)), borderColor: '#BA7517', borderWidth: 2, pointRadius: 2, tension: 0.35, fill: false },
    ],
  };

  const barData = {
    labels: ['CPU %', 'RAM (MB)', 'Storage (MB)'],
    datasets: [{
      label: 'Current',
      data: liveData
          ? [parseFloat(liveData.cpuUsedPercent.toFixed(2)), Math.round(liveData.ramUsedMb), Math.round(liveData.storageUsedMb)]
          : [0, 0, 0],
      backgroundColor: ['rgba(29,158,117,.75)', 'rgba(55,138,221,.75)', 'rgba(186,117,23,.75)'],
      borderColor: ['#1D9E75', '#378ADD', '#BA7517'],
      borderWidth: 1,
      borderRadius: 5,
    }],
  };

  const gridColor = 'rgba(128,128,128,0.1)';
  const tickColor = '#888780';

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
      x: { ticks: { color: tickColor, font: { size: 10 }, autoSkip: true, maxTicksLimit: 6, maxRotation: 0 }, grid: { color: gridColor } },
      y: { ticks: { color: tickColor, font: { size: 10 } }, grid: { color: gridColor }, beginAtZero: true },
    },
  };

  const barOptions = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 450 },
    plugins: { legend: { display: false }, tooltip: { callbacks: {
          label: (ctx) => ctx.dataIndex === 0 ? ` ${ctx.raw}%` : ` ${fmtMb(ctx.raw)}`,
        }}},
    scales: {
      x: { ticks: { color: tickColor, font: { size: 12 } }, grid: { display: false } },
      y: { ticks: { color: tickColor, font: { size: 11 } }, grid: { color: gridColor }, beginAtZero: true },
    },
  };

  // ── render guards ───────────────────────────────────────────────────────────
  if (loading) return (
      <div className="db-state">
        <div className="spinner" />
        <span>Loading metrics…</span>
      </div>
  );

  if (error && !metrics) return (
      <div className="db-state db-state--err">
        <span>⚠ {error}</span>
        <button onClick={fetchAll} className="btn-retry">Retry</button>
      </div>
  );

  return (
      <div className="dashboard">

        {/* ── header ── */}
        <div className="db-header">
          <div>
            <h1 className="db-title">System Overview</h1>
            <p className="db-sub">Platform-wide resource consumption and activity</p>
          </div>
          <div className="db-header-right">
            <div className="live-tag">
              <span className={`live-dot${pulse ? ' live-dot--ping' : ''}`} />
              Live
            </div>
            {lastRefreshed && (
                <span className="upd-time">Updated {lastRefreshed.toLocaleTimeString()}</span>
            )}
            <button className="btn-ref" onClick={fetchAll}>↻ Refresh</button>
          </div>
        </div>

        {error && <div className="err-banner">⚠ {error}</div>}

        {/* ── platform activity cards ── */}
        <p className="sec-label">Platform activity</p>
        <div className="grid-6">
          <MetricCard3D
              accentBg="#E1F5EE"
              value={metrics.totalLiveProjects.toLocaleString()}
              label="Live projects"
              hint="Running containers"
          />
          <MetricCard3D
              accentBg="#E6F1FB"
              value={metrics.totalStudents.toLocaleString()}
              label="Active students"
              hint="Registered accounts"
          />
          <MetricCard3D
              accentBg="#FAEEDA"
              value={metrics.pendingResourceRequests.toLocaleString()}
              label="Pending requests"
              hint="Awaiting admin review"
              highlight={metrics.pendingResourceRequests > 0}
              badge={metrics.pendingResourceRequests > 0 ? 'needs review' : null}
          />
        </div>

        {/* ── allocated resources cards ── */}
        <p className="sec-label">Allocated resources</p>
        <div className="grid-6">
          <MetricCard3D
              accentBg="#EEEDFE"
              value={`${fmtCpu(metrics.aggregateCpuUsed)} / ${fmtCpu(metrics.totalCpuAllocated)}`}
              label="CPU"
              hint="Cores used / allocated"
          />
          <MetricCard3D
              accentBg="#E6F1FB"
              value={`${fmtMb(metrics.aggregateRamUsedMb)} / ${fmtMb(metrics.totalRamAllocatedMb)}`}
              label="RAM"
              hint="In use / allocated"
          />
          <MetricCard3D
              accentBg="#F1EFE8"
              value={`${fmtMb(metrics.aggregateStorageUsedMb)} / ${fmtMb(metrics.totalStorageAllocatedMb)}`}
              label="Storage"
              hint="In use / allocated"
          />
        </div>

        {/* ── usage bars ── */}
        <div className="usage-card">
          <p className="sec-label" style={{ marginBottom: 14 }}>Resource utilisation</p>
          <UsageBar label="CPU"     used={metrics.aggregateCpuUsed}        total={metrics.totalCpuAllocated}        format={fmtCpu} />
          <UsageBar label="RAM"     used={metrics.aggregateRamUsedMb}       total={metrics.totalRamAllocatedMb}      format={fmtMb}  />
          <UsageBar label="Storage" used={metrics.aggregateStorageUsedMb}   total={metrics.totalStorageAllocatedMb}  format={fmtMb}  />
        </div>

        <hr className="divider" />

        {/* ── live container section ── */}
        <p className="sec-label">Live container metrics</p>
        <div className="grid-4">
          <MetricCard3D accentBg="#E1F5EE" value={liveData?.projectsRunning ?? '—'} label="Containers running" />
          <MetricCard3D accentBg="#EEEDFE" value={liveData ? `${liveData.cpuUsedPercent.toFixed(1)}%` : '—'} label="CPU usage" hint="Live %" />
          <MetricCard3D accentBg="#E6F1FB" value={liveData ? fmtMb(liveData.ramUsedMb) : '—'} label="RAM used" />
          <MetricCard3D accentBg="#FAEEDA" value={liveData ? fmtMb(liveData.storageUsedMb) : '—'} label="Storage used" />
        </div>

        {/* ── line chart ── */}
        <div className="chart-card">
          <div className="chart-hdr">
            <span className="chart-title">Usage history — last {MAX_HISTORY} snapshots</span>
            <div className="legend">
              <LegendItem color="#1D9E75" label="CPU %" />
              <LegendItem color="#378ADD" label="RAM ÷10" dashed />
              <LegendItem color="#BA7517" label="Storage ÷10" />
            </div>
          </div>
          <div style={{ position: 'relative', height: 200 }}>
            <Line data={lineData} options={lineOptions} />
          </div>
        </div>

        {/* ── bar chart ── */}
        <div className="chart-card">
          <div className="chart-hdr">
            <span className="chart-title">Current snapshot — resource breakdown</span>
            <div className="legend">
              <LegendItem color="#1D9E75" label="CPU %" />
              <LegendItem color="#378ADD" label="RAM MB" />
              <LegendItem color="#BA7517" label="Storage MB" />
            </div>
          </div>
          <div style={{ position: 'relative', height: 175 }}>
            <Bar data={barData} options={barOptions} />
          </div>
        </div>

        <style>{`
        .dashboard {
          padding: 1.5rem 2rem 2rem;
          max-width: 1200px;
          margin: 0 auto;
          font-family: 'DM Sans', 'Segoe UI', sans-serif;
        }
        .db-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 1.75rem;
        }
        .db-title {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0 0 4px;
        }
        .db-sub {
          font-size: 0.85rem;
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
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: #0F6E56;
          background: #E1F5EE;
          padding: 4px 12px;
          border-radius: 20px;
          border: 1px solid #9FE1CB;
          font-weight: 500;
        }
        .live-dot {
          width: 7px; height: 7px;
          border-radius: 50%;
          background: #1D9E75;
          display: inline-block;
          transition: transform 0.2s;
        }
        .live-dot--ping { transform: scale(1.8); }
        .upd-time { font-size: 0.7rem; color: var(--text-secondary); }
        .btn-ref {
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          color: var(--text-primary);
          padding: 0.35rem 0.85rem;
          border-radius: 7px;
          font-size: 0.78rem;
          cursor: pointer;
          transition: background 0.15s;
        }
        .btn-ref:hover { background: var(--border); }
        .btn-retry {
          background: var(--accent);
          color: #fff;
          border: none;
          padding: 0.35rem 1rem;
          border-radius: 7px;
          cursor: pointer;
          font-size: 0.78rem;
          margin-left: 10px;
        }
        .err-banner {
          padding: 10px 14px;
          border-radius: 8px;
          background: #fef2f2;
          color: #991b1b;
          font-size: 13px;
          margin-bottom: 1.25rem;
        }
        .sec-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.06em;
          color: var(--text-secondary);
          text-transform: uppercase;
          margin-bottom: 10px;
        }
        .grid-6 {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 12px;
          margin-bottom: 1.5rem;
        }
        .grid-4 {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 10px;
          margin-bottom: 1.25rem;
        }

        /* ── 3D shadow cards ── */
        .card3d {
          background: var(--card-bg, #fff);
          border-radius: 14px;
          border: 1px solid var(--border, rgba(0,0,0,.1));
          padding: 1.1rem 1.25rem;
          position: relative;
          transition: transform 0.18s ease, box-shadow 0.18s ease;
          box-shadow:
            0 1px 2px rgba(0,0,0,.04),
            0 4px 8px rgba(0,0,0,.06),
            0 8px 20px rgba(0,0,0,.05),
            inset 0 1px 0 rgba(255,255,255,.75);
        }
        .card3d:hover {
          transform: translateY(-3px) scale(1.015);
          box-shadow:
            0 2px 4px rgba(0,0,0,.05),
            0 8px 20px rgba(0,0,0,.1),
            0 20px 40px rgba(0,0,0,.07),
            inset 0 1px 0 rgba(255,255,255,.85);
        }
        .card3d--warn {
          border-color: #EF9F27;
          box-shadow:
            0 4px 16px rgba(186,117,23,.18),
            0 1px 2px rgba(0,0,0,.04),
            inset 0 1px 0 rgba(255,255,255,.75);
        }
        .card3d-icon {
          width: 32px; height: 32px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 10px;
        }
        .card3d-value {
          font-size: 1.3rem;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1.1;
          margin-bottom: 3px;
        }
        .card3d-label {
          font-size: 0.78rem;
          color: var(--text-secondary);
          font-weight: 500;
        }
        .card3d-hint {
          font-size: 0.7rem;
          color: var(--text-secondary);
          opacity: 0.7;
          margin-top: 2px;
        }
        .card3d-badge {
          display: inline-block;
          font-size: 10px;
          padding: 2px 8px;
          border-radius: 10px;
          background: #FAEEDA;
          color: #633806;
          margin-top: 6px;
          border: 1px solid #FAC775;
        }

        /* ── usage bars ── */
        .usage-card {
          background: var(--card-bg, #fff);
          border-radius: 14px;
          border: 1px solid var(--border, rgba(0,0,0,.1));
          padding: 1.25rem;
          margin-bottom: 1.5rem;
          box-shadow:
            0 2px 8px rgba(0,0,0,.05),
            0 6px 18px rgba(0,0,0,.04),
            inset 0 1px 0 rgba(255,255,255,.65);
        }
        .bar-row { margin-bottom: 14px; }
        .bar-row:last-child { margin-bottom: 0; }
        .bar-meta { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 5px; }
        .bar-meta-lbl { color: var(--text-secondary); font-weight: 500; }
        .bar-meta-val { color: var(--text-primary); font-weight: 600; }
        .bar-track { height: 7px; border-radius: 4px; background: var(--bg-secondary, #f4f4f4); overflow: hidden; }
        .bar-fill  { height: 100%; border-radius: 4px; transition: width 0.5s cubic-bezier(.4,0,.2,1); }

        .divider { border: none; border-top: 1px solid var(--border, rgba(0,0,0,.08)); margin: 1.5rem 0; }

        /* ── chart cards ── */
        .chart-card {
          background: var(--card-bg, #fff);
          border-radius: 14px;
          border: 1px solid var(--border, rgba(0,0,0,.1));
          padding: 1.25rem;
          margin-bottom: 1.25rem;
          box-shadow:
            0 2px 8px rgba(0,0,0,.05),
            0 6px 18px rgba(0,0,0,.04),
            inset 0 1px 0 rgba(255,255,255,.65);
        }
        .chart-hdr {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 12px;
        }
        .chart-title { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
        .legend { display: flex; flex-wrap: wrap; gap: 12px; }
        .leg-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-secondary); }
        .leg-sq { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
        .leg-dashed { width: 14px; height: 0; border-top: 2px dashed; display: inline-block; }

        .db-state {
          display: flex; align-items: center; justify-content: center;
          gap: 1rem; padding: 4rem; color: var(--text-secondary);
        }
        .db-state--err { color: var(--error); }
        .spinner {
          width: 20px; height: 20px;
          border: 2px solid var(--border);
          border-top-color: var(--accent);
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      </div>
  );
}