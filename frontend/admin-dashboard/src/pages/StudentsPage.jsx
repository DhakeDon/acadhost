import { useState } from 'react';
import StudentList from '../components/StudentList';
import StudentInvite from '../components/StudentInvite';
import BatchRemoval from '../components/BatchRemoval';

export default function StudentsPage() {
    const [activeTab, setActiveTab] = useState('list');
    const [refreshKey, setRefreshKey] = useState(0);

    function refresh() {
        setRefreshKey(k => k + 1);
    }

    return (
        <div className="page sp-page">
            {/* Tab navigation */}
            <div className="sp-tabs">
                {[
                    { id: 'list',   label: 'All Students' },
                    { id: 'invite', label: 'Invite Students' },
                    { id: 'batch',  label: 'Batch Removal' },
                ].map(({ id, label }) => (
                    <button
                        key={id}
                        className={`sp-tab${activeTab === id ? ' active' : ''}`}
                        onClick={() => setActiveTab(id)}
                    >
                        {label}
                        {activeTab === id && <span className="sp-tab-bar" />}
                    </button>
                ))}
            </div>

            <div className="sp-content">
                {activeTab === 'list' && <StudentList key={refreshKey} />}
                {activeTab === 'invite' && (
                    <StudentInvite onSuccess={() => { refresh(); setActiveTab('list'); }} />
                )}
                {activeTab === 'batch' && (
                    <BatchRemoval onSuccess={() => { refresh(); setActiveTab('list'); }} />
                )}
            </div>

            <style>{`
        /* ── Page shell ── */
        .sp-page {
          font-family: 'DM Sans', 'Segoe UI', sans-serif;
          min-height: 100vh;
          background: var(--bg-secondary);
        }

        /* ── Tab strip ── */
        .sp-tabs {
          display: flex;
          gap: 0;
          border-bottom: 1px solid var(--border);
          margin-bottom: 1.75rem;
        }
        .sp-tab {
          position: relative;
          background: none;
          border: none;
          padding: 0.55rem 1.2rem 0.65rem;
          font-size: 0.875rem;
          font-weight: 500;
          font-family: inherit;
          color: var(--text-secondary);
          cursor: pointer;
          letter-spacing: -0.01em;
          transition: color 0.15s;
        }
        .sp-tab:hover { color: var(--text-primary); }
        .sp-tab.active {
          color: var(--accent);
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        /* Active underline drawn as a child span so we can animate it */
        .sp-tab-bar {
          position: absolute;
          bottom: -1px;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--accent);
          border-radius: 2px 2px 0 0;
        }

        /* ── Content area ── */
        .sp-content {
          /* Cards inside will carry their own bg */
        }

        /* ── Reusable card used by child components ── */
        .sp-card {
          background: var(--card-bg);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 1.5rem;
          box-shadow: 0 1px 3px rgba(0,0,0,0.06);
          transition: background 0.25s, border-color 0.25s;
        }

        /* ── Typography helpers ── */
        .sp-title {
          font-size: 1.1rem;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: -0.015em;
          margin: 0 0 0.25rem;
        }
        .sp-subtitle {
          font-size: 0.82rem;
          color: var(--text-secondary);
          margin: 0;
          line-height: 1.55;
        }

        /* ── Mobile ── */
        @media (max-width: 640px) {
          .sp-page { padding: 1.25rem 1rem; }
          .sp-tab  { padding: 0.5rem 0.8rem; font-size: 0.82rem; }
        }
      `}</style>
        </div>
    );
}