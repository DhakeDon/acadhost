import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import ProjectCard    from '../components/ProjectCard';
import ProjectCreate  from '../components/ProjectCreate';
import ProjectSettings from '../components/ProjectSettings';

// ─────────────────────────────────────────────────────────────────────────────
// ProjectsPage
// Routes:
//   /projects            → ProjectList
//   /projects/:id/settings → ProjectSettings
// ─────────────────────────────────────────────────────────────────────────────
export default function ProjectsPage() {
  return (
      <Routes>
        <Route path="/"             element={<ProjectList />} />
        <Route path="/:id/settings" element={<ProjectSettings />} />
      </Routes>
  );
}

function ProjectList() {
  const navigate = useNavigate();

  const [projects,    setProjects]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [creating,    setCreating]    = useState(false);
  const [maxProjects, setMaxProjects] = useState(4);

  const loadProjects = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [projRes, profRes] = await Promise.all([
        api.get('/projects'),
        api.get('/student/profile'),
      ]);
      setProjects(projRes.data.data.items || []);
      setMaxProjects(profRes.data.data.maxProjects);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load projects.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  const active   = projects.filter(p => p.status !== 'deleted');
  const atLimit  = active.length >= maxProjects;
  const counts   = {
    running:  active.filter(p => p.status === 'running').length,
    stopped:  active.filter(p => p.status === 'stopped').length,
    building: active.filter(p => p.status === 'building').length,
    failed:   active.filter(p => p.status === 'failed').length,
  };

  const handleCreated = () => {
    setCreating(false);
    loadProjects();
    navigate('/projects');
  };

  if (creating) {
    return <ProjectCreate onCancel={() => setCreating(false)} onCreated={handleCreated} />;
  }

  return (
      <div>
        {/* Header */}
        <div className="section-header">
          <div>
            <h1 className="section-title">Projects</h1>
            <p className="section-subtitle">
              {active.length} of {maxProjects} active
              {counts.running  > 0 && <> · <span style={{ color: 'var(--success)' }}>{counts.running} running</span></>}
              {counts.stopped  > 0 && <> · <span style={{ color: 'var(--text-muted)' }}>{counts.stopped} stopped</span></>}
              {counts.building > 0 && <> · <span style={{ color: 'var(--info)' }}>{counts.building} building</span></>}
              {counts.failed   > 0 && <> · <span style={{ color: 'var(--error)' }}>{counts.failed} failed</span></>}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-ghost btn-sm" onClick={loadProjects}>↻ Refresh</button>
            <button
                className="btn btn-primary"
                onClick={() => setCreating(true)}
                disabled={atLimit}
                title={atLimit ? `Project limit reached (${maxProjects})` : undefined}
            >
              + New Project
            </button>
          </div>
        </div>

        {atLimit && (
            <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
              You've reached your project limit ({maxProjects}).{' '}
              <Link to="/resource-requests" style={{ color: 'var(--warning)', fontWeight: 700 }}>
                Request more →
              </Link>
            </div>
        )}

        {error && (
            <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
              {error}
              <button className="btn btn-ghost btn-sm" onClick={loadProjects} style={{ marginLeft: '1rem' }}>Retry</button>
            </div>
        )}

        {loading ? (
            <div className="spinner-center"><div className="spinner spinner-lg" /></div>
        ) : active.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">◈</div>
              <div className="empty-state-title">No projects yet</div>
              <div className="empty-state-subtitle">Click "+ New Project" to deploy your first application.</div>
            </div>
        ) : (
            <div className="grid grid-3">
              {active.map(p => <ProjectCard key={p.id} project={p} />)}
            </div>
        )}
      </div>
  );
}