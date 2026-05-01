export default function SystemMetricsCard({ label, value, subtitle, highlight }) {
  return (
    <div className={`metrics-card${highlight ? ' highlight' : ''}`}>
      <div className="metrics-label">{label}</div>
      <div className="metrics-value">{value}</div>
      {subtitle && <div className="metrics-subtitle">{subtitle}</div>}

      <style>{`
        .metrics-card {
          background: var(--card-bg);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 1.25rem 1.5rem;
          box-shadow: var(--card-shadow);
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          transition: transform 0.15s, box-shadow 0.15s;
        }
        .metrics-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(0,0,0,0.1);
        }
        .metrics-card.highlight {
          border-color: var(--warning);
          background: linear-gradient(135deg, var(--card-bg), rgba(255,152,0,0.04));
        }
        .metrics-label {
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-secondary);
        }
        .metrics-value {
          font-size: 1.75rem;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1.1;
          font-variant-numeric: tabular-nums;
        }
        .metrics-subtitle {
          font-size: 0.75rem;
          color: var(--text-secondary);
          margin-top: 0.125rem;
        }
        .metrics-card.highlight .metrics-value {
          color: var(--warning);
        }
      `}</style>
    </div>
  );
}
