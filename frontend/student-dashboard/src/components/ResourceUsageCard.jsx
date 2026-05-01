import React from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// ResourceUsageCard
//
// Displays a single resource's usage in n/m format with:
//   - Used / Total display
//   - Remaining quantity
//   - A labelled progress bar
//   - Warning state when storageWarning is true (for the Storage card)
// ─────────────────────────────────────────────────────────────────────────────

function formatValue(value, unit) {
  if (unit === 'cores') return Number(value).toFixed(2);
  if (unit === 'MB' && value >= 1024) return `${(value / 1024).toFixed(1)} GB`;
  return String(value);
}

export default function ResourceUsageCard({ label, used, total, unit = '', icon = '○', warning = false }) {
  const remaining = total - used;
  const pct       = total > 0 ? Math.min((used / total) * 100, 100) : 0;

  let barClass = 'progress-bar-fill';
  if (pct >= 90) barClass += ' danger';
  else if (pct >= 80 || warning) barClass += ' warning';

  return (
    <div
      className="card"
      style={{
        ...styles.card,
        borderColor: warning ? 'var(--warning)' : 'var(--border)',
      }}
    >
      {/* Icon + label row */}
      <div style={styles.topRow}>
        <span style={styles.icon}>{icon}</span>
        <span style={styles.label}>{label}</span>
        {warning && (
          <span style={styles.warnBadge} title="Storage usage above 80%">
            ⚠ High
          </span>
        )}
      </div>

      {/* n / m */}
      <div style={styles.usageRow}>
        <span style={styles.usedNum} className="mono">
          {formatValue(used, unit)}
        </span>
        <span style={styles.slash} className="mono">/</span>
        <span style={styles.totalNum} className="mono">
          {formatValue(total, unit)}
        </span>
        {unit && <span style={styles.unit}>{unit}</span>}
      </div>

      {/* Progress bar */}
      <div className="progress-bar-wrap" style={{ marginBottom: '0.5rem' }}>
        <div className={barClass} style={{ width: `${pct}%` }} />
      </div>

      {/* Remaining */}
      <div style={styles.remaining}>
        <span style={{ color: warning ? 'var(--warning)' : 'var(--text-muted)' }}>
          {formatValue(remaining, unit)}{unit ? ` ${unit}` : ''} remaining
        </span>
      </div>
    </div>
  );
}

const styles = {
  card: {
    padding:    '1.1rem 1.25rem',
    transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
  },
  topRow: {
    display:        'flex',
    alignItems:     'center',
    gap:            '0.4rem',
    marginBottom:   '0.6rem',
  },
  icon: {
    fontSize:       '0.9rem',
    color:          'var(--accent)',
  },
  label: {
    fontSize:       '0.72rem',
    fontWeight:     700,
    textTransform:  'uppercase',
    letterSpacing:  '0.07em',
    color:          'var(--text-secondary)',
    flex:           1,
  },
  warnBadge: {
    fontSize:       '0.65rem',
    fontWeight:     700,
    color:          'var(--warning)',
    background:     'var(--warning-bg)',
    padding:        '0.15rem 0.4rem',
    borderRadius:   '99px',
    letterSpacing:  '0.04em',
  },
  usageRow: {
    display:        'flex',
    alignItems:     'baseline',
    gap:            '0.25rem',
    marginBottom:   '0.5rem',
  },
  usedNum: {
    fontSize:       '1.5rem',
    fontWeight:     700,
    color:          'var(--text-primary)',
    lineHeight:     1,
  },
  slash: {
    fontSize:       '1rem',
    color:          'var(--text-muted)',
  },
  totalNum: {
    fontSize:       '1rem',
    color:          'var(--text-muted)',
  },
  unit: {
    fontSize:       '0.72rem',
    color:          'var(--text-muted)',
    marginLeft:     '0.15rem',
  },
  remaining: {
    fontSize:       '0.75rem',
    color:          'var(--text-muted)',
  },
};
