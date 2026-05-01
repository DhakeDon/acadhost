import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';

// ─────────────────────────────────────────────────────────────────────────────
// BuildLogs
//
// Connects to GET /api/projects/:id/build-logs/stream via EventSource (SSE).
// The access token is passed as a query parameter because EventSource does not
// support custom Authorization headers (Section 5.14, 6.1.3, 6.5.7).
//
// SSE events from the server:
//   log      — single log line (application-level output only)
//   status   — current build status: building | success | failed | timeout
//   complete — final result JSON: { status, message? }
//
// Props:
//   projectId  — projects.id
//   onComplete — callback(result: { status, message? })
//   onReturn   — callback() to go back to project edit view on failure
// ─────────────────────────────────────────────────────────────────────────────

export default function BuildLogs({ projectId, onComplete, onReturn }) {
  const { accessToken } = useAuth();
  const [lines,       setLines]       = useState([]);
  const [status,      setStatus]      = useState('building');
  const [connStatus,  setConnStatus]  = useState('connecting'); // connecting | open | closed | error
  const [finalResult, setFinalResult] = useState(null);

  // logContainerRef — the scrollable pane; we scroll it ourselves.
  const logContainerRef = useRef(null);
  // finalResultRef — scrolled into view when the result banner appears.
  const finalResultRef  = useRef(null);
  const esRef           = useRef(null);

  // Auto-scroll the log pane to the bottom whenever new lines arrive.
  useEffect(() => {
    const el = logContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  // When the final result appears, scroll it into view so it is never hidden
  // behind the log pane (the root cause of the "result hidden behind logs" bug).
  useEffect(() => {
    if (!finalResult) return;
    // Small rAF so the DOM has painted the result banner before we scroll.
    const raf = requestAnimationFrame(() => {
      if (finalResultRef.current) {
        finalResultRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [finalResult]);

  useEffect(() => {
    if (!accessToken || !projectId) return;

    const url = `/api/projects/${projectId}/build-logs/stream?token=${encodeURIComponent(accessToken)}`;
    const es  = new EventSource(url);
    esRef.current = es;

    setConnStatus('connecting');
    setLines([]);
    setStatus('building');
    setFinalResult(null);

    es.addEventListener('open', () => {
      setConnStatus('open');
    });

    es.addEventListener('log', (e) => {
      const line = e.data;
      if (line) {
        setLines(prev => [...prev, line]);
      }
    });

    es.addEventListener('status', (e) => {
      setStatus(e.data);
    });

    es.addEventListener('complete', (e) => {
      let result;
      try {
        result = JSON.parse(e.data);
      } catch {
        result = { status: 'failed', message: 'Unexpected response from server.' };
      }
      setFinalResult(result);
      setStatus(result.status);
      setConnStatus('closed');
      es.close();
      if (onComplete) onComplete(result);
    });

    es.onerror = () => {
      setConnStatus('error');
      es.close();
    };

    // Cleanup on unmount or projectId change.
    return () => {
      es.close();
    };
  }, [projectId, accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const isBuilding  = status === 'building';
  const isSuccess   = status === 'success';
  const isFailed    = status === 'failed' || status === 'timeout';

  return (
      // The wrapper is a flex column so the result banner always sits *below*
      // the capped-height log pane — never underneath it.
      <div style={styles.wrapper}>
        {/* Header bar */}
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <span style={styles.titleText}>Build Log</span>
            <span
                className={`badge ${isSuccess ? 'badge-running' : isFailed ? 'badge-failed' : 'badge-building'}`}
            >
            {isBuilding ? (
                <><span className="spinner" style={{ width:10, height:10, marginRight:4 }} />building</>
            ) : status}
          </span>
          </div>

          <div style={styles.connDot} title={`Connection: ${connStatus}`}>
          <span
              style={{
                width:        7,
                height:       7,
                borderRadius: '50%',
                display:      'inline-block',
                background:   connStatus === 'open'
                    ? 'var(--success)'
                    : connStatus === 'error' || connStatus === 'closed'
                        ? 'var(--text-muted)'
                        : 'var(--warning)',
              }}
          />
            <span className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 4 }}>
            {connStatus}
          </span>
          </div>
        </div>

        {/* Log lines — fixed-height scrollable pane */}
        <div
            ref={logContainerRef}
            className="log-container"
            style={{ maxHeight: '420px', overflowY: 'auto' }}
        >
          {lines.length === 0 && connStatus === 'connecting' && (
              <span className="log-line" style={{ opacity: 0.5 }}>Connecting to build stream…</span>
          )}
          {lines.map((line, i) => (
              <span
                  key={i}
                  className={`log-line${
                      line.toLowerCase().includes('error') || line.toLowerCase().includes('fail') ? ' log-error' :
                          line.toLowerCase().includes('warn')  ? ' log-info' : ''
                  }`}
              >
            {line}
          </span>
          ))}
          {connStatus === 'error' && (
              <span className="log-line log-error">
            ⚠ Connection to build stream lost. The build may still be running.
          </span>
          )}
        </div>

        {/* Final result banner — rendered *outside* the scrollable pane so it
          is always fully visible below it, never hidden underneath the logs. */}
        {finalResult && (
            <div
                ref={finalResultRef}
                className={`alert ${isSuccess ? 'alert-success' : 'alert-error'}`}
                style={{
                  borderTop:    '1px solid var(--border)',
                  borderRadius: '0 0 6px 6px',
                  // Ensure the banner is never clipped by a parent overflow:hidden
                  position:     'relative',
                  zIndex:       1,
                }}
            >
              {isSuccess ? (
                  '✓ Build successful! Redirecting to dashboard…'
              ) : (
                  <>
                    {finalResult.message || 'Build failed.'}
                    {onReturn && (
                        <button
                            className="btn btn-ghost btn-sm"
                            onClick={onReturn}
                            style={{ marginLeft: '1rem' }}
                        >
                          ← Back to project
                        </button>
                    )}
                  </>
              )}
            </div>
        )}
      </div>
  );
}

const styles = {
  wrapper: {
    // flex column keeps header → log pane → result banner stacked correctly;
    // overflow visible so the result banner is never clipped.
    display:       'flex',
    flexDirection: 'column',
    borderRadius:  '6px',
    border:        '1px solid var(--border)',
    overflow:      'visible',
  },
  header: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    padding:        '0.6rem 0.9rem',
    background:     'var(--code-bg)',
    borderBottom:   '1px solid rgba(255,255,255,0.06)',
    borderRadius:   '6px 6px 0 0',
  },
  headerLeft: {
    display:    'flex',
    alignItems: 'center',
    gap:        '0.6rem',
  },
  titleText: {
    fontFamily:    "'Space Mono', monospace",
    fontSize:      '0.72rem',
    color:         'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  },
  connDot: {
    display:    'flex',
    alignItems: 'center',
    gap:        '0.3rem',
  },
};