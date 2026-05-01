import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  LineChart, Line, ResponsiveContainer, YAxis, XAxis, Tooltip, CartesianGrid,
} from 'recharts';
import api from '../services/api';

// ─────────────────────────────────────────────────────────────────────────────
// ProjectSettings v7
//
// Layout changes vs v6:
//  • WebhookPanel removed from the right ps-col — now lives in a dedicated
//    bottom-section LEFT column, eliminating the awkward blank space.
//  • New bottom 2-col layout:
//      LEFT  → GitHub Webhook panel + EnvVarUsageGuide (code examples)
//      RIGHT → Environment Variables editor + Auto-Injected Variables terminal
//  • EnvVarUsageGuide — rich new component showing:
//      - How to read custom env vars (Node.js & Python, with destructuring)
//      - How to connect to MySQL using DB_* vars (mysql2 pool & Python connector)
//      - .env.local tip for local dev
//  • All existing API wiring unchanged; routes must include:
//      GET/POST  /api/projects/:id/env-vars
//      PUT/DEL   /api/projects/:id/env-vars/:envId
//      GET       /api/projects/:id/injected-env
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_META = {
  running:  { cls: 'badge-running',  dot: 'var(--success)' },
  stopped:  { cls: 'badge-stopped',  dot: 'var(--text-muted)' },
  building: { cls: 'badge-building', dot: 'var(--info)' },
  failed:   { cls: 'badge-failed',   dot: 'var(--error)' },
  deleted:  { cls: 'badge-stopped',  dot: 'var(--text-muted)' },
};

const MAX_POINTS    = 30;
const ENV_KEY_REGEX = /^[A-Z_][A-Z0-9_]{0,127}$/;
const RESERVED_KEYS = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const MAX_VAL_LEN   = 2048;

const ISSUE_COPY = {
  BUILD_STUCK:        { headline: 'Your last deploy got stuck',     detail: 'A deploy started but never finished. Redeploy to try again.' },
  CONTAINER_MISSING:  { headline: "Your site isn't running",        detail: "We think it's running, but it went offline during a deploy. Redeploy to bring it back." },
  CONTAINER_STOPPED:  { headline: 'Your site crashed',              detail: 'It started up then stopped. Check runtime logs for errors.' },
  CONTAINER_ID_STALE: { headline: 'Minor cleanup needed',           detail: "An old reference is stale — it won't affect your site. Clean up if you like." },
};

const SUMMARY_COPY = {
  stuck_building:    { title: "Your last deploy didn't finish", hint: 'Click Redeploy to try again.' },
  container_missing: { title: 'Your site is offline',           hint: 'Click Redeploy to bring it back.' },
  desync:            { title: 'Your project needs attention',   hint: 'Click Redeploy to fix it.' },
};

function friendlyIssue(issue) {
  return ISSUE_COPY[issue.code] || { headline: "Something isn't right", detail: issue.message || "We couldn't verify the state of your site." };
}
function pickSourceType(p)    { return p.sourceType || p.source_type || ''; }
function pickGitUrl(p)        { return p.gitUrl || p.git_url || ''; }
function pickGitUrlBackend(p) { return p.gitUrlBackend || p.git_url_backend || ''; }

function validateRow(key, value) {
  if (!key) return 'Key is required.';
  if (!ENV_KEY_REGEX.test(key)) return 'UPPER_SNAKE_CASE only (A-Z, 0-9, _).';
  if (RESERVED_KEYS.includes(key)) return `"${key}" is reserved.`;
  if ((value || '').length > MAX_VAL_LEN) return `Value too long (max ${MAX_VAL_LEN}).`;
  return null;
}

export default function ProjectSettings() {
  const { id }   = useParams();
  const navigate = useNavigate();

  const [project,   setProject]   = useState(null);
  const [profile,   setProfile]   = useState(null);
  const [databases, setDatabases] = useState([]);
  const [storage,   setStorage]   = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');

  const [statsNow,  setStatsNow]  = useState(null);
  const [history,   setHistory]   = useState([]);
  const historyRef    = useRef([]);
  const statsTimerRef = useRef(null);

  const [cpuEdit,   setCpuEdit]   = useState('');
  const [ramEdit,   setRamEdit]   = useState('');
  const [resError,  setResError]  = useState('');
  const [resSaving, setResSaving] = useState(false);
  const [resSaved,  setResSaved]  = useState(false);

  const [dbSwitch, setDbSwitch] = useState('');
  const [dbSaving, setDbSaving] = useState(false);
  const [dbMsg,    setDbMsg]    = useState('');

  const [actionLoading, setActionLoading] = useState('');
  const [actionMsg,     setActionMsg]     = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [logs,        setLogs]        = useState('');
  const [logsLoading, setLogsLoading] = useState(false);

  const [webhook,        setWebhook]        = useState(null);
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [webhookError,   setWebhookError]   = useState('');

  const [health,        setHealth]        = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [recovering,    setRecovering]    = useState(false);
  const [recoverMsg,    setRecoverMsg]    = useState('');

  // Env vars
  const [envRows,    setEnvRows]    = useState([]);
  const [envLoading, setEnvLoading] = useState(false);
  const [envSaving,  setEnvSaving]  = useState(false);
  const [envSaved,   setEnvSaved]   = useState(false);
  const [envError,   setEnvError]   = useState('');
  const nextEnvId = useRef(1);

  // Injected env
  const [injectedEnv,        setInjectedEnv]        = useState(null);
  const [injectedEnvLoading, setInjectedEnvLoading] = useState(false);

  // Env usage guide tab
  const [guideTab, setGuideTab] = useState('node'); // 'node' | 'python'

  const loadWebhook = useCallback(async () => {
    setWebhookLoading(true); setWebhookError('');
    try { const r = await api.get(`/projects/${id}/webhook`); setWebhook(r.data.data); }
    catch (err) {
      if (err.response?.data?.error === 'WEBHOOK_NOT_APPLICABLE') setWebhook(null);
      else setWebhookError(err.response?.data?.message || 'Failed to load webhook info.');
    } finally { setWebhookLoading(false); }
  }, [id]);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try { const r = await api.get(`/projects/${id}/health`); setHealth(r.data.data); }
    catch { setHealth(null); }
    finally { setHealthLoading(false); }
  }, [id]);

  const loadEnvVars = useCallback(async () => {
    setEnvLoading(true);
    try {
      const r = await api.get(`/projects/${id}/env-vars`);
      const items = r.data.data.items || [];
      setEnvRows(items.map(it => ({ id: nextEnvId.current++, key: it.key, value: it.value, revealed: false, error: null, isNew: false })));
    } catch { /* env vars optional */ }
    finally { setEnvLoading(false); }
  }, [id]);

  const loadInjectedEnv = useCallback(async () => {
    setInjectedEnvLoading(true);
    try { const r = await api.get(`/projects/${id}/injected-env`); setInjectedEnv(r.data.data); }
    catch { setInjectedEnv(null); }
    finally { setInjectedEnvLoading(false); }
  }, [id]);

  const loadAll = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [projRes, profRes, dbRes, storRes] = await Promise.all([
        api.get(`/projects/${id}`),
        api.get('/student/profile'),
        api.get('/databases'),
        api.get(`/projects/${id}/storage`),
      ]);
      const proj = projRes.data.data;
      setProject(proj);
      setProfile(profRes.data.data);
      setDatabases(dbRes.data.data.items || []);
      setStorage(storRes.data.data);
      setCpuEdit(String(proj.cpuLimit));
      setRamEdit(String(proj.ramLimitMb));
      setDbSwitch(String(proj.databaseId || ''));
      if (pickSourceType(proj) === 'git') loadWebhook();
      loadHealth();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load project settings.');
    } finally { setLoading(false); }
  }, [id, loadWebhook, loadHealth]);

  useEffect(() => {
    loadAll();
    loadEnvVars();
    loadInjectedEnv();
  }, [loadAll, loadEnvVars, loadInjectedEnv]);

  // Stats polling
  useEffect(() => {
    if (!project) return;
    const sample = async () => {
      try {
        const r = await api.get(`/projects/${id}/stats`);
        const s = r.data.data;
        setStatsNow(s);
        if (s.running) {
          const t = new Date().toLocaleTimeString();
          historyRef.current = [...historyRef.current, { t, cpu: +s.cpuPercent.toFixed(1), mem: +s.memUsageMb.toFixed(1) }].slice(-MAX_POINTS);
          setHistory([...historyRef.current]);
        }
      } catch { setStatsNow({ running: false }); }
    };
    if (project.status === 'running') { sample(); statsTimerRef.current = setInterval(sample, 4000); }
    return () => { if (statsTimerRef.current) clearInterval(statsTimerRef.current); };
  }, [project, id]);

  const handleRecover = async () => {
    setRecovering(true); setRecoverMsg('');
    try { await api.post(`/projects/${id}/recover`); setRecoverMsg('Fixed. Redeploy if your site is still down.'); await loadAll(); }
    catch (err) { setRecoverMsg(err.response?.data?.message || "Couldn't fix automatically. Try Restart or contact support."); }
    finally { setRecovering(false); }
  };

  const runAction = async (action) => {
    setActionMsg(''); setActionLoading(action);
    try {
      if (action === 'restart')   await api.post(`/projects/${id}/restart`);
      else if (action === 'stop') await api.post(`/projects/${id}/stop`);
      else if (action === 'delete') { await api.delete(`/projects/${id}`); navigate('/projects'); return; }
      setActionMsg(`Project ${action === 'restart' ? 'restarted' : 'stopped'}.`);
      loadAll();
    } catch (err) {
      const msgs = { PROJECT_BUILDING: 'Cannot do that while building.', PROJECT_ALREADY_STOPPED: 'Already stopped.',
        PROJECT_DELETED: 'Already deleted.', CONTAINER_NOT_FOUND: 'No container exists.' };
      setActionMsg(msgs[err.response?.data?.error] || err.response?.data?.message || `${action} failed.`);
    } finally { setActionLoading(''); }
  };

  const handleUpdateResources = async (e) => {
    e.preventDefault();
    setResError(''); setResSaved(false);
    const cpu = parseFloat(cpuEdit), ram = parseInt(ramEdit, 10);
    if (isNaN(cpu) || cpu <= 0) { setResError('Enter a valid CPU > 0.'); return; }
    if (isNaN(ram) || ram <= 0) { setResError('Enter a valid RAM > 0.'); return; }
    setResSaving(true);
    try { await api.put(`/projects/${id}/resources`, { cpuLimit: cpu, ramLimitMb: ram }); setResSaved(true); loadAll(); }
    catch (err) {
      const msgs = { CPU_QUOTA_EXCEEDED: 'CPU exceeds quota.', RAM_QUOTA_EXCEEDED: 'RAM exceeds quota.' };
      setResError(msgs[err.response?.data?.error] || err.response?.data?.message || 'Update failed.');
    } finally { setResSaving(false); }
  };

  const handleDbSwitch = async () => {
    setDbSaving(true); setDbMsg('');
    try {
      await api.put(`/projects/${id}/database`, { databaseId: dbSwitch === '' ? null : parseInt(dbSwitch, 10) });
      setDbMsg('Database updated.');
      loadAll();
      loadInjectedEnv();
    } catch (err) { setDbMsg(err.response?.data?.message || 'Failed to switch database.'); }
    finally { setDbSaving(false); }
  };

  const loadLogs = async () => {
    setLogsLoading(true);
    try { const r = await api.get(`/projects/${id}/logs`); setLogs(r.data.data.logs); }
    catch (err) { setLogs(err.response?.data?.error === 'CONTAINER_NOT_RUNNING' ? '(No running container)' : 'Failed to fetch logs.'); }
    finally { setLogsLoading(false); }
  };

  // ── Env var helpers ──────────────────────────────────────────────────────
  const addEnvRow = () => {
    setEnvRows(prev => [...prev, { id: nextEnvId.current++, key: '', value: '', revealed: true, error: null, isNew: true }]);
  };
  const updateEnvRow = (rowId, field, val) => {
    setEnvRows(prev => prev.map(r => r.id === rowId
        ? { ...r, [field]: field === 'key' ? val.toUpperCase().replace(/[^A-Z0-9_]/g, '') : val, error: null }
        : r
    ));
  };
  const removeEnvRow = (rowId) => setEnvRows(prev => prev.filter(r => r.id !== rowId));
  const toggleReveal = (rowId) => setEnvRows(prev => prev.map(r => r.id === rowId ? { ...r, revealed: !r.revealed } : r));

  const handleSaveEnvVars = async () => {
    setEnvError(''); setEnvSaved(false);
    const seen = new Set();
    let hasErrors = false;
    const validated = envRows.map(r => {
      const k = r.key.trim(), v = r.value || '';
      if (!k && !v) return { ...r, skip: true };
      const err = validateRow(k, v) || (seen.has(k) ? `Duplicate key "${k}".` : null);
      if (err) { hasErrors = true; seen.add(k); return { ...r, error: err }; }
      seen.add(k);
      return { ...r, error: null };
    });
    setEnvRows(validated);
    if (hasErrors) { setEnvError('Fix errors above before saving.'); return; }

    const items = validated.filter(r => !r.skip).map(r => ({ key: r.key.trim(), value: r.value || '' }));
    setEnvSaving(true);
    try {
      const res = await api.post(`/projects/${id}/env-vars`, { items });
      const saved = res.data.data.items || [];
      setEnvRows(saved.map(it => ({ id: nextEnvId.current++, key: it.key, value: it.value, revealed: false, error: null, isNew: false })));
      setEnvSaved(true);
      if (res.data.data.containerRecreated) setActionMsg('Env vars saved and container restarted with new values.');
    } catch (err) {
      setEnvError(err.response?.data?.message || 'Failed to save environment variables.');
    } finally { setEnvSaving(false); }
  };

  if (loading) return <div className="spinner-center"><div className="spinner spinner-lg" /></div>;
  if (error)   return <div className="alert alert-error" style={{ marginTop: '2rem' }}>{error}</div>;
  if (!project) return null;

  const st       = project.status;
  const stMeta   = STATUS_META[st] || STATUS_META.stopped;
  const availCpu = profile ? +(profile.cpuQuota   - profile.cpuUsed   + (project.cpuLimit   || 0)).toFixed(2) : 0;
  const availRam = profile ? profile.ramQuotaMb   - profile.ramUsedMb + (project.ramLimitMb || 0) : 0;
  const isGit    = pickSourceType(project) === 'git';
  const hasIssues = health?.issues?.length > 0;
  const summary   = health && SUMMARY_COPY[health.summary];
  const canAutoFix = hasIssues && health.issues.some(i => i.canAutoFix);
  const hasDb     = !!project.databaseId;

  return (
      <div>
        {/* HEADER */}
        <div style={{ display:'flex', alignItems:'flex-start', gap:'0.8rem', marginBottom:'1rem', flexWrap:'wrap' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>← Back</button>
          <div style={{ flex:1, minWidth:240 }}>
            <h1 className="section-title" style={{ marginBottom:'0.3rem' }}>{project.title}</h1>
            <div style={{ display:'flex', alignItems:'center', gap:'0.6rem', flexWrap:'wrap' }}>
            <span className={`badge ${stMeta.cls}`} style={{ display:'inline-flex', alignItems:'center', gap:'0.3rem' }}>
              <span style={{ width:6, height:6, borderRadius:'50%', background:stMeta.dot, display:'inline-block' }} />{st}
            </span>
              <a href={project.liveUrl} target="_blank" rel="noopener noreferrer" className="mono"
                 style={{ fontSize:'0.75rem', color:'var(--accent)', textDecoration:'none' }}>
                {project.subdomain}.acadhost.com ↗
              </a>
              <span className="mono" style={{ fontSize:'0.7rem', color:'var(--text-muted)' }}>
              {project.projectType}{project.runtime ? ` · ${project.runtime} ${project.runtimeVersion||''}` : ''}
            </span>
            </div>
          </div>
        </div>

        {actionMsg && <div className="alert alert-info" style={{ marginBottom:'1rem' }}>{actionMsg}</div>}

        {/* Site status alert */}
        {hasIssues && (
            <div className="card" style={{ marginBottom:'0.85rem', borderLeft:'3px solid var(--error)' }}>
              <div className="card-body">
                <div style={{ display:'flex', alignItems:'flex-start', gap:'0.75rem', flexWrap:'wrap' }}>
                  <div style={{ flex:1, minWidth:260 }}>
                    <div style={{ fontSize:'0.7rem', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--error)', marginBottom:'0.4rem' }}>⚠ Site Status</div>
                    <div style={{ fontSize:'0.88rem', fontWeight:600, color:'var(--text-primary)', marginBottom:'0.25rem' }}>
                      {summary ? summary.title : 'Your project needs attention'}
                    </div>
                    {summary && <div style={{ fontSize:'0.76rem', color:'var(--text-secondary)', marginBottom:'0.6rem' }}>{summary.hint}</div>}
                    <ul style={{ margin:0, paddingLeft:'1.1rem', fontSize:'0.76rem', color:'var(--text-primary)' }}>
                      {health.issues.map((iss, i) => {
                        const f = friendlyIssue(iss);
                        return (
                            <li key={i} style={{ marginBottom:'0.4rem' }}>
                              <div style={{ fontWeight:600 }}>{f.headline}</div>
                              <div style={{ fontSize:'0.72rem', color:'var(--text-secondary)', marginTop:'0.1rem' }}>{f.detail}</div>
                            </li>
                        );
                      })}
                    </ul>
                    {recoverMsg && <div style={{ marginTop:'0.6rem', fontSize:'0.76rem', color:'var(--success)' }}>✓ {recoverMsg}</div>}
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:'0.35rem', minWidth:140 }}>
                    {canAutoFix && (
                        <button className="btn btn-danger btn-sm" onClick={handleRecover} disabled={recovering}>
                          {recovering ? <><span className="spinner" />Fixing</> : 'Fix it'}
                        </button>
                    )}
                    <button className="btn btn-secondary btn-sm" onClick={() => runAction('restart')}
                            disabled={actionLoading !== '' || st === 'building' || st === 'deleted'}>
                      {actionLoading === 'restart' ? <><span className="spinner" />Restarting</> : '↺ Redeploy'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={loadHealth} disabled={healthLoading}>
                      {healthLoading ? <><span className="spinner" />Checking</> : 'Re-check'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
        )}

        {/* ── TOP GRID: monitoring + config ── */}
        <div className="ps-grid">
          {/* LEFT */}
          <div className="ps-col">
            {/* Actions */}
            <div className="card">
              <div className="card-body">
                <SectionTitle accent="var(--accent)">Project Actions</SectionTitle>
                <div style={{ display:'flex', gap:'0.4rem', flexWrap:'wrap' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => runAction('restart')}
                          disabled={actionLoading !== '' || st === 'building' || st === 'deleted'}>
                    {actionLoading === 'restart' ? <><span className="spinner" />Restarting</> : '↺ Restart'}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => runAction('stop')}
                          disabled={actionLoading !== '' || st !== 'running'}>
                    {actionLoading === 'stop' ? <><span className="spinner" />Stopping</> : '■ Stop'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={loadHealth} disabled={healthLoading} title="Check site health">
                    {healthLoading ? <><span className="spinner" />Checking</> : '⚕ Check status'}
                  </button>
                  {!confirmDelete ? (
                      <button className="btn btn-danger btn-sm" style={{ marginLeft:'auto' }}
                              onClick={() => setConfirmDelete(true)} disabled={actionLoading !== '' || st === 'deleted'}>× Delete</button>
                  ) : (
                      <div style={{ display:'flex', gap:'0.3rem', alignItems:'center', marginLeft:'auto', flexWrap:'wrap' }}>
                        <span style={{ fontSize:'0.72rem', color:'var(--error)' }}>Confirm?</span>
                        <button className="btn btn-danger btn-sm" onClick={() => runAction('delete')} disabled={actionLoading !== ''}>
                          {actionLoading === 'delete' ? <><span className="spinner" />Deleting</> : 'Yes, delete'}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
                      </div>
                  )}
                </div>
                {health && !hasIssues && <div className="form-hint" style={{ color:'var(--success)', marginTop:'0.5rem' }}>✓ Your site is healthy.</div>}
              </div>
            </div>

            {/* Live Runtime */}
            <div className="card">
              <div className="card-body">
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <SectionTitle accent="var(--success)" noMargin>Live Runtime</SectionTitle>
                  <LiveIndicator on={statsNow?.running} />
                </div>
                <div style={{ height:8 }} />
                {st !== 'running' ? (
                    <div style={{ padding:'1rem 0', textAlign:'center', color:'var(--text-muted)', fontSize:'0.8rem' }}>
                      {st === 'building' ? 'Waiting for build…' : 'Project is not running.'}
                    </div>
                ) : (
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.65rem' }}>
                      <StatChart title="CPU %" color="var(--success)" dataKey="cpu" data={history}
                                 currentLabel={statsNow?.running ? `${statsNow.cpuPercent.toFixed(1)}%` : '…'} yMax={100} unit="%" />
                      <StatChart title="RAM MB" color="var(--accent)" dataKey="mem" data={history}
                                 currentLabel={statsNow?.running ? `${statsNow.memUsageMb}/${statsNow.memLimitMb}` : '…'}
                                 yMax={statsNow?.running ? statsNow.memLimitMb : undefined} unit=" MB" />
                    </div>
                )}
                {statsNow?.running && (
                    <div style={{ display:'flex', gap:'1rem', marginTop:'0.6rem', flexWrap:'wrap', fontSize:'0.68rem', color:'var(--text-muted)' }}>
                      <span>↓ <span className="mono" style={{ color:'var(--text-primary)' }}>{statsNow.netRxMb.toFixed(2)} MB</span></span>
                      <span>↑ <span className="mono" style={{ color:'var(--text-primary)' }}>{statsNow.netTxMb.toFixed(2)} MB</span></span>
                      <span style={{ marginLeft:'auto' }}>4s poll</span>
                    </div>
                )}
              </div>
            </div>

            {/* Storage */}
            {storage && profile && (
                <div className="card">
                  <div className="card-body">
                    <SectionTitle accent="var(--info)">Storage Usage</SectionTitle>
                    <div className="gauge" style={{ marginBottom:'0.75rem' }}>
                      <div className="gauge-head">
                        <span className="gauge-label">This project</span>
                        <span className="gauge-value mono">{Number(storage.storageUsedMb).toFixed(1)}<span className="gauge-total"> MB</span></span>
                      </div>
                      <div className="gauge-track">
                        <div className="gauge-fill" style={{ width:`${Math.min(100,(storage.storageUsedMb/Math.max(1,profile.storageQuotaMb))*100)}%` }} />
                      </div>
                      <div className="gauge-foot"><span>of {profile.storageQuotaMb} MB quota (all projects)</span></div>
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'0.4rem' }}>
                      {[
                        { label:'Source',     val:storage.breakdown?.sourceMb    ?? 0, color:'var(--accent)' },
                        { label:'Build Logs', val:storage.breakdown?.buildLogsMb ?? 0, color:'var(--info)' },
                        { label:'Uploads',    val:storage.breakdown?.uploadsMb   ?? 0, color:'var(--warning)' },
                        { label:'Other',      val:storage.breakdown?.otherMb     ?? 0, color:'var(--text-muted)' },
                      ].map(row => (
                          <div key={row.label} style={{ padding:'0.5rem 0.6rem', border:'1px solid var(--border)' }}>
                            <div className="mono" style={{ fontSize:'0.9rem', fontWeight:700, color:row.color }}>{Number(row.val).toFixed(1)}</div>
                            <div style={{ fontSize:'0.58rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em', marginTop:'0.1rem' }}>{row.label} MB</div>
                          </div>
                      ))}
                    </div>
                  </div>
                </div>
            )}


            {/* Environment Variables */}
            <div className="card">
              <div className="card-body">
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'0.4rem' }}>
                  <SectionTitle accent="#e8c94a" noMargin>Environment Variables</SectionTitle>
                  <div style={{ display:'flex', gap:'0.4rem', alignItems:'center' }}>
                    {envSaved && <span style={{ fontSize:'0.72rem', color:'var(--success)' }}>✓ Saved</span>}
                    <button className="btn btn-ghost btn-sm" onClick={addEnvRow}>+ Add</button>
                    <button className="btn btn-secondary btn-sm" onClick={handleSaveEnvVars} disabled={envSaving}>
                      {envSaving ? <><span className="spinner" />Saving…</> : 'Save All'}
                    </button>
                  </div>
                </div>

                <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', margin:'0.4rem 0 0.65rem', lineHeight:1.5 }}>
                  Stored encrypted. Injected into your container on every deploy.{' '}
                  <code style={{ padding:'1px 4px', background:'var(--bg-tertiary)', fontFamily:'monospace' }}>DB_*</code> keys are reserved.
                  Changes take effect when the container is recreated.
                </div>

                {envLoading ? (
                    <div className="spinner-center" style={{ padding:'1rem' }}><div className="spinner" /></div>
                ) : envRows.length === 0 ? (
                    <div style={{ padding:'0.75rem', border:'1px dashed var(--border)', background:'var(--bg-secondary)',
                      textAlign:'center', fontSize:'0.72rem', color:'var(--text-muted)' }}>
                      No custom variables. Click <strong>+ Add</strong> to create one.
                    </div>
                ) : (
                    <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem' }}>
                      <div style={{ display:'grid', gridTemplateColumns:'36% 1fr 28px 28px', gap:'0.3rem',
                        fontSize:'0.64rem', color:'var(--text-muted)', paddingBottom:'0.25rem',
                        borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.08em' }}>
                        <span>Key</span><span>Value</span><span /><span />
                      </div>
                      {envRows.map(row => {
                        const err = row.error;
                        return (
                            <div key={row.id}>
                              <div style={{ display:'grid', gridTemplateColumns:'36% 1fr 28px 28px', gap:'0.3rem', alignItems:'center' }}>
                                <input className={`input mono${err ? ' input-error' : ''}`}
                                       style={{ fontSize:'0.74rem', padding:'0.35rem 0.5rem' }}
                                       type="text" value={row.key} placeholder="MY_SECRET"
                                       autoComplete="off" spellCheck={false}
                                       onChange={e => updateEnvRow(row.id, 'key', e.target.value)} maxLength={128} />
                                <input className={`input mono${err ? ' input-error' : ''}`}
                                       style={{ fontSize:'0.74rem', padding:'0.35rem 0.5rem',
                                         letterSpacing: row.revealed ? 'normal' : '0.12em',
                                         color: row.revealed ? 'var(--text-primary)' : 'var(--text-muted)' }}
                                       type="text"
                                       value={row.revealed ? row.value : row.value.replace(/./g, '•')}
                                       placeholder="value" autoComplete="new-password"
                                       readOnly={!row.revealed}
                                       onChange={row.revealed ? (e => updateEnvRow(row.id, 'value', e.target.value)) : undefined}
                                       onFocus={() => { if (!row.revealed) toggleReveal(row.id); }} />
                                <button type="button" className="btn btn-ghost btn-sm"
                                        title={row.revealed ? 'Hide' : 'Reveal to edit'}
                                        onClick={() => toggleReveal(row.id)}
                                        style={{ padding:'0.25rem', fontSize:'0.72rem', color: row.revealed ? 'var(--success)' : 'var(--text-muted)' }}>
                                  {row.revealed ? '👁' : '○'}
                                </button>
                                <button type="button" className="btn btn-ghost btn-sm"
                                        title="Remove" onClick={() => removeEnvRow(row.id)}
                                        style={{ padding:'0.25rem', color:'var(--error)' }}>✕</button>
                              </div>
                              {err && <div className="form-error" style={{ marginTop:'0.2rem' }}>{err}</div>}
                            </div>
                        );
                      })}
                    </div>
                )}
                {envError && <div className="form-error" style={{ marginTop:'0.5rem' }}>{envError}</div>}
              </div>
            </div>

            {/* GitHub Webhooks (git only) */}
            {isGit ? (
                <WebhookPanel
                    webhook={webhook}
                    loading={webhookLoading}
                    error={webhookError}
                    onReload={loadWebhook}
                    repoUrls={{ frontend: pickGitUrl(project), backend: pickGitUrlBackend(project) }}
                />
            ) : (
                <div className="card">
                  <div className="card-body">
                    <SectionTitle accent="#8a7bff">Source &amp; Deploys</SectionTitle>
                    <div style={{ background:'var(--bg-secondary)', border:'1px solid var(--border)', padding:'0.65rem 0.8rem', borderRadius:2, fontSize:'0.76rem', color:'var(--text-secondary)', lineHeight:1.6 }}>
                      <div style={{ fontWeight:700, color:'var(--text-primary)', marginBottom:'0.35rem' }}>ZIP-based project</div>
                      This project was deployed from a ZIP upload. To redeploy, go back to the
                      Projects list and create a new version, or use <strong>Restart</strong> to bounce the
                      current container without re-uploading.
                      <div style={{ marginTop:'0.55rem', fontSize:'0.7rem', color:'var(--text-muted)' }}>
                        Tip: Switch to a Git-based project to get auto-deploy on every <code style={{ padding:'1px 4px', background:'var(--bg-tertiary)' }}>git push</code>.
                      </div>
                    </div>
                  </div>
                </div>
            )}



          </div>

          {/* RIGHT */}
          <div className="ps-col">
            {/* Database */}
            <div className="card">
              <div className="card-body">
                <SectionTitle accent="var(--warning)">Attached Database</SectionTitle>
                <div style={{ display:'flex', gap:'0.4rem', alignItems:'flex-end', flexWrap:'wrap' }}>
                  <div className="form-group" style={{ flex:1, marginBottom:0, minWidth:160 }}>
                    <label className="form-label">Database</label>
                    <select className="input" value={dbSwitch} onChange={e => setDbSwitch(e.target.value)}>
                      <option value="">None</option>
                      {databases.map(db => <option key={db.id} value={db.id}>{db.dbName}</option>)}
                    </select>
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={handleDbSwitch} disabled={dbSaving}>
                    {dbSaving ? <><span className="spinner" />Applying</> : 'Apply'}
                  </button>
                </div>
                {dbMsg && <div className="form-hint" style={{ marginTop:'0.4rem', color:'var(--success)' }}>{dbMsg}</div>}
                <div className="form-hint" style={{ marginTop:'0.3rem' }}>Changing DB recreates the container with new credentials.</div>
              </div>
            </div>

            {/* Resources */}
            <div className="card">
              <div className="card-body">
                <SectionTitle accent="var(--error)">Resource Limits</SectionTitle>
                <form onSubmit={handleUpdateResources} autoComplete="off">
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem', marginBottom:'0.5rem' }}>
                    <div className="form-group" style={{ marginBottom:0 }}>
                      <label className="form-label">CPU (cores)</label>
                      <input className={`input${resError ? ' input-error' : ''}`} type="number" step="0.25" min="0.25" max={availCpu}
                             value={cpuEdit} onChange={e => setCpuEdit(e.target.value)} />
                      <span className="form-hint">{availCpu} available</span>
                    </div>
                    <div className="form-group" style={{ marginBottom:0 }}>
                      <label className="form-label">RAM (MB)</label>
                      <input className={`input${resError ? ' input-error' : ''}`} type="number" step="64" min="64" max={availRam}
                             value={ramEdit} onChange={e => setRamEdit(e.target.value)} />
                      <span className="form-hint">{availRam} available</span>
                    </div>
                  </div>
                  {resError && <div className="form-error" style={{ marginBottom:'0.4rem' }}>{resError}</div>}
                  {resSaved  && <div className="form-hint" style={{ color:'var(--success)', marginBottom:'0.4rem' }}>Resources updated.</div>}
                  <button className="btn btn-secondary btn-sm" type="submit" disabled={resSaving}>
                    {resSaving ? <><span className="spinner" />Saving</> : 'Update Resources'}
                  </button>
                </form>
              </div>
            </div>
            {/* Runtime Logs */}
            <div className="card">
              <div className="card-body">
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.5rem' }}>
                  <SectionTitle accent="var(--text-primary)" noMargin>Runtime Logs</SectionTitle>
                  <button className="btn btn-ghost btn-sm" onClick={loadLogs} disabled={logsLoading}>
                    {logsLoading ? <><span className="spinner" />Loading</> : '↻ Refresh'}
                  </button>
                </div>
                <pre className="runtime-log">
                  {logs || <span style={{ opacity:0.4 }}>Click Refresh to load logs.</span>}
                </pre>
              </div>
            </div>



            {/* ── Env Var Usage Guide (fills remaining right-column space) ── */}
            <EnvVarUsageGuide
                hasDb={hasDb}
                runtime={project.runtime}
                projectType={project.projectType}
                guideTab={guideTab}
                onTabChange={setGuideTab}
            />
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════════════
          BOTTOM SECTION — 2-column:
          LEFT  → Environment Variables editor  (top) + GitHub Webhook (bottom)
          RIGHT → Auto-Injected Variables       (top) + Runtime Logs   (bottom)
          ════════════════════════════════════════════════════════════════════ */}


        <style>{CSS}</style>
      </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EnvVarUsageGuide — tabbed terminal showing how to use env vars in code
// ─────────────────────────────────────────────────────────────────────────────
function EnvVarUsageGuide({ hasDb, runtime, projectType, guideTab, onTabChange }) {
  const isBackend = projectType === 'backend' || projectType === 'combined';
  if (!isBackend) return null; // frontend projects don't have server-side env vars

  return (
      <div className="card">
        <div className="card-body">
          <SectionTitle accent="var(--info)">How to Use Env Vars in Your Code</SectionTitle>

          {/* Tab selector */}
          <div style={{ display:'flex', gap:'0.25rem', marginBottom:'0.65rem' }}>
            {['node', 'python'].map(tab => (
                <button key={tab} type="button"
                        onClick={() => onTabChange(tab)}
                        style={{
                          padding:'0.25rem 0.65rem', fontSize:'0.66rem', fontWeight:700,
                          textTransform:'uppercase', letterSpacing:'0.08em', cursor:'pointer',
                          border:'1px solid var(--border)', borderRadius:2, fontFamily:'inherit',
                          background: guideTab === tab ? 'var(--accent-soft)' : 'var(--bg-secondary)',
                          borderColor: guideTab === tab ? 'var(--accent)' : 'var(--border)',
                          color: guideTab === tab ? 'var(--accent)' : 'var(--text-muted)',
                        }}>
                  {tab === 'node' ? 'Node.js' : 'Python'}
                </button>
            ))}
          </div>

          <div className="terminal">
            <div className="terminal-titlebar">
              <span className="terminal-dot red" /><span className="terminal-dot yellow" /><span className="terminal-dot green" />
              <span className="terminal-title">env-usage · {guideTab === 'node' ? 'Node.js' : 'Python'}</span>
            </div>
            <div className="terminal-body">

              {guideTab === 'node' ? (
                  <>
                    {/* ── Custom env vars ── */}
                    <div className="terminal-comment"># ─── Reading your custom environment variables ───</div>
                    <div className="terminal-output">
                      <span className="terminal-comment"># Single variable</span>
                    </div>
                    <div className="terminal-output">
                      const apiKey = <span className="terminal-key">process.env</span>.MY_API_KEY;
                    </div>
                    <div style={{ height:'0.3rem' }} />
                    <div className="terminal-output">
                      <span className="terminal-comment"># Destructure several at once</span>
                    </div>
                    <div className="terminal-output">
                      {'const { MY_API_KEY, STRIPE_SECRET, ALLOWED_ORIGINS } = '}
                    </div>
                    <div className="terminal-output">{'  process.env;'}</div>
                    <div style={{ height:'0.3rem' }} />
                    <div className="terminal-output">
                      <span className="terminal-comment"># With a fallback default</span>
                    </div>
                    <div className="terminal-output">
                      {'const port = process.env.PORT ?? '}
                      <span className="terminal-key">8080</span>;
                    </div>

                    {hasDb && (
                        <>
                          <div style={{ height:'0.75rem', borderTop:'1px dashed #2a2a2a', marginTop:'0.5rem' }} />
                          <div className="terminal-comment"># ─── Connecting to your attached MySQL database ───</div>
                          <div className="terminal-output">
                            <span className="terminal-comment"># Install: npm install mysql2</span>
                          </div>
                          <div className="terminal-output">
                            const mysql = require(<span className="terminal-key">'mysql2/promise'</span>);
                          </div>
                          <div style={{ height:'0.3rem' }} />
                          <div className="terminal-output">
                            <span className="terminal-comment"># Destructure the injected DB_* vars</span>
                          </div>
                          <div className="terminal-output">
                            {'const {'}
                          </div>
                          <div className="terminal-output">
                            {'  DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME,'}
                          </div>
                          <div className="terminal-output">{'} = process.env;'}</div>
                          <div style={{ height:'0.3rem' }} />
                          <div className="terminal-output">
                            <span className="terminal-comment"># Create a connection pool (recommended)</span>
                          </div>
                          <div className="terminal-output">const pool = mysql.createPool({'{'}</div>
                          <div className="terminal-output">
                            {'  host:     DB_HOST,'}
                          </div>
                          <div className="terminal-output">
                            {'  port:     +DB_PORT,  '}
                            <span className="terminal-comment">// coerce string → number</span>
                          </div>
                          <div className="terminal-output">
                            {'  user:     DB_USER,'}
                          </div>
                          <div className="terminal-output">
                            {'  password: DB_PASSWORD,'}
                          </div>
                          <div className="terminal-output">
                            {'  database: DB_NAME,'}
                          </div>
                          <div className="terminal-output">{'});'}</div>
                          <div style={{ height:'0.3rem' }} />

                        </>
                    )}

                    <div style={{ height:'0.75rem', borderTop:'1px dashed #2a2a2a', marginTop:'0.5rem' }} />
                    <div className="terminal-comment"># ─── Local development tip ───</div>
                    <div className="terminal-output">
                      <span className="terminal-comment"># Install: npm install dotenv</span>
                    </div>
                    <div className="terminal-output">
                      <span className="terminal-comment"># At the very top of your entry file:</span>
                    </div>
                    <div className="terminal-output">
                      require(<span className="terminal-key">'dotenv'</span>).config();
                    </div>
                    <div className="terminal-output">
                      <span className="terminal-comment"># Create .env.local (never commit this!):</span>
                    </div>
                    <div className="terminal-output">
                      MY_API_KEY=<span className="terminal-key">abc123_local</span>
                    </div>
                    {hasDb && (
                        <div className="terminal-output">
                          DB_HOST=<span className="terminal-key">127.0.0.1</span>{'  '}
                          <span className="terminal-comment"># your local MySQL</span>
                        </div>
                    )}
                  </>
              ) : (
                  <>
                    {/* ── Python ── */}
                    <div className="terminal-comment"># ─── Reading your custom environment variables ───</div>
                    <div className="terminal-output">import os</div>
                    <div style={{ height:'0.3rem' }} />
                    <div className="terminal-output">
                      <span className="terminal-comment"># Required — raises KeyError if missing</span>
                    </div>
                    <div className="terminal-output">
                      api_key = os.environ[<span className="terminal-key">'MY_API_KEY'</span>]
                    </div>
                    <div style={{ height:'0.3rem' }} />
                    <div className="terminal-output">
                      <span className="terminal-comment"># Optional — returns default if not set</span>
                    </div>
                    <div className="terminal-output">
                      {'debug = os.environ.get('}
                      <span className="terminal-key">'DEBUG'</span>
                      {", 'false')"}
                    </div>
                    <div style={{ height:'0.3rem' }} />
                    <div className="terminal-output">
                      <span className="terminal-comment"># Load multiple at once</span>
                    </div>
                    <div className="terminal-output">
                      {'config = {k: os.environ[k] for k in ['}
                    </div>
                    <div className="terminal-output">
                      {'  '}
                      <span className="terminal-key">'MY_API_KEY'</span>
                      {', '}
                      <span className="terminal-key">'STRIPE_SECRET'</span>
                      {', '}
                      <span className="terminal-key">'ALLOWED_ORIGINS'</span>
                    </div>
                    <div className="terminal-output">{']}'}
                    </div>

                    {hasDb && (
                        <>
                          <div style={{ height:'0.75rem', borderTop:'1px dashed #2a2a2a', marginTop:'0.5rem' }} />
                          <div className="terminal-comment"># ─── Connecting to your attached MySQL database ───</div>
                          <div className="terminal-output">
                            <span className="terminal-comment"># Install: pip install mysql-connector-python</span>
                          </div>
                          <div className="terminal-output">import os</div>
                          <div className="terminal-output">
                            import mysql.connector
                          </div>
                          <div style={{ height:'0.3rem' }} />
                          <div className="terminal-output">
                            conn = mysql.connector.connect(
                          </div>
                          <div className="terminal-output">
                            {'  host=os.environ['}
                            <span className="terminal-key">'DB_HOST'</span>
                            {'],'}
                          </div>
                          <div className="terminal-output">
                            {'  port=int(os.environ['}
                            <span className="terminal-key">'DB_PORT'</span>
                            {']),  '}
                            <span className="terminal-comment"># coerce str → int</span>
                          </div>
                          <div className="terminal-output">
                            {'  user=os.environ['}
                            <span className="terminal-key">'DB_USER'</span>
                            {'],'}
                          </div>
                          <div className="terminal-output">
                            {'  password=os.environ['}
                            <span className="terminal-key">'DB_PASSWORD'</span>
                            {'],'}
                          </div>
                          <div className="terminal-output">
                            {'  database=os.environ['}
                            <span className="terminal-key">'DB_NAME'</span>
                            {']'}
                          </div>
                          <div className="terminal-output">)</div>
                          <div style={{ height:'0.3rem' }} />
                          <div className="terminal-output">
                            <span className="terminal-comment"># SQLAlchemy connection string (alternative):</span>
                          </div>
                          <div className="terminal-output">
                            {'from sqlalchemy import create_engine'}
                          </div>
                          <div className="terminal-output">
                            engine = create_engine(
                          </div>
                          <div className="terminal-output">
                            {'  f"mysql+mysqlconnector://"'}
                          </div>
                          <div className="terminal-output">
                            {'  f"{os.environ['}
                            <span className="terminal-key">'DB_USER'</span>
                            {']}:{os.environ['}
                            <span className="terminal-key">'DB_PASSWORD'</span>
                            {']}"}'}
                          </div>
                          <div className="terminal-output">
                            {'  f"@{os.environ['}
                            <span className="terminal-key">'DB_HOST'</span>
                            {']}:{os.environ['}
                            <span className="terminal-key">'DB_PORT'</span>
                            {']}"}'}
                          </div>
                          <div className="terminal-output">
                            {'  f"/{os.environ['}
                            <span className="terminal-key">'DB_NAME'</span>
                            {']})"'}
                          </div>
                          <div className="terminal-output">)</div>
                        </>
                    )}

                    <div style={{ height:'0.75rem', borderTop:'1px dashed #2a2a2a', marginTop:'0.5rem' }} />
                    <div className="terminal-comment"># ─── Local development tip ───</div>
                    <div className="terminal-output">
                      <span className="terminal-comment"># Install: pip install python-dotenv</span>
                    </div>
                    <div className="terminal-output">
                      from dotenv import load_dotenv
                    </div>
                    <div className="terminal-output">
                      load_dotenv(<span className="terminal-key">'.env.local'</span>)
                    </div>
                    <div className="terminal-output">
                      <span className="terminal-comment"># Create .env.local (never commit this!)</span>
                    </div>
                    <div className="terminal-output">
                      MY_API_KEY=<span className="terminal-key">abc123_local</span>
                    </div>
                  </>
              )}
            </div>
          </div>

          {/* Key/Value quick-reference */}
          {hasDb && (
              <div style={{ marginTop:'0.65rem', padding:'0.55rem 0.7rem', background:'rgba(59,130,246,0.06)',
                border:'1px solid rgba(59,130,246,0.18)', borderRadius:2, fontSize:'0.72rem', lineHeight:1.6 }}>
                <div style={{ fontWeight:700, color:'var(--info)', marginBottom:'0.3rem', fontSize:'0.66rem',
                  textTransform:'uppercase', letterSpacing:'0.08em' }}>Auto-injected DB_* variable reference</div>
                {[
                  ['DB_HOST',     'Mysql', 'MySQL server hostname (reachable from inside container)'],
                  ['DB_PORT',     '3306',                 'MySQL port — cast to number before use'],
                  ['DB_USER',     '(your db user)',        'Scoped MySQL user with access only to your schema'],
                  ['DB_PASSWORD', '••••••••',             'Never exposed via API — injected at runtime only'],
                  ['DB_NAME',     '(your db name)',        'Your MySQL database/schema name'],
                ].map(([k, v, note]) => (
                    <div key={k} style={{ display:'grid', gridTemplateColumns:'120px 150px 1fr', gap:'0.3rem',
                      padding:'0.18rem 0', borderBottom:'1px solid rgba(59,130,246,0.1)', fontSize:'0.68rem' }}>
                      <code style={{ color:'#e8c94a', fontFamily:'monospace' }}>{k}</code>
                      <code style={{ color:'var(--text-secondary)', fontFamily:'monospace' }}>{v}</code>
                      <span style={{ color:'var(--text-muted)' }}>{note}</span>
                    </div>
                ))}
              </div>
          )}
        </div>
      </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// InjectedEnvTerminal
// ─────────────────────────────────────────────────────────────────────────────
function InjectedEnvTerminal({ data, loading, projectType, runtime }) {
  if (loading) return <div className="spinner-center" style={{ padding:'0.75rem' }}><div className="spinner" /></div>;

  const attached = data?.databaseAttached;
  const injected = data?.injected || [];
  const isNode   = runtime === 'node' || (!runtime && projectType !== 'backend');

  return (
      <div className="terminal">
        <div className="terminal-titlebar">
          <span className="terminal-dot red" /><span className="terminal-dot yellow" /><span className="terminal-dot green" />
          <span className="terminal-title">injected-env · project</span>
        </div>
        <div className="terminal-body">
          {!attached ? (
              <>
                <div><span className="terminal-prompt">$</span> printenv | grep -E <span className="terminal-key">'^DB_'</span></div>
                <div className="terminal-comment"># (no database attached — no DB_* variables injected)</div>
                <div style={{ height:'0.45rem' }} />
                <div className="terminal-comment"># Attach a database above to get DB_HOST, DB_PORT,</div>
                <div className="terminal-comment"># DB_USER, DB_PASSWORD, and DB_NAME auto-injected.</div>
              </>
          ) : (
              <>
                <div><span className="terminal-prompt">$</span> printenv | grep -E <span className="terminal-key">'^DB_'</span></div>
                <div style={{ height:'0.2rem' }} />
                {injected.map(v => (
                    <div key={v.key} className="terminal-output">
                      <span className="terminal-key">{v.key}</span>
                      =<span style={{ color: v.sensitive ? '#6a665e' : '#a8a49c' }}>
                  {v.sensitive ? '••••••••' : v.value}
                </span>
                      {v.note && <span className="terminal-comment" style={{ marginLeft:'0.75rem' }}>  # {v.note}</span>}
                    </div>
                ))}
                <div style={{ height:'0.7rem' }} />
                <div className="terminal-comment"># Use in your code:</div>
                {isNode ? (
                    <>
                      <div className="terminal-output">
                        {'const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = '}
                        <span className="terminal-key">process.env</span>;
                      </div>
                      <div style={{ height:'0.3rem' }} />
                      <div className="terminal-output">const pool = mysql.createPool({'{'}</div>
                      <div className="terminal-output">{'  host: DB_HOST, port: +DB_PORT,'}</div>
                      <div className="terminal-output">{'  user: DB_USER, password: DB_PASSWORD, database: DB_NAME'}</div>
                      <div className="terminal-output">{'});'}</div>
                    </>
                ) : (
                    <>
                      <div className="terminal-output">import os</div>
                      <div className="terminal-output">DB_HOST = os.environ[<span className="terminal-key">'DB_HOST'</span>]</div>
                      <div className="terminal-output">DB_PORT = int(os.environ[<span className="terminal-key">'DB_PORT'</span>])</div>
                      <div className="terminal-output">DB_USER = os.environ[<span className="terminal-key">'DB_USER'</span>]</div>
                      <div className="terminal-output">DB_PASSWORD = os.environ[<span className="terminal-key">'DB_PASSWORD'</span>]</div>
                      <div className="terminal-output">DB_NAME = os.environ[<span className="terminal-key">'DB_NAME'</span>]</div>
                    </>
                )}
              </>
          )}
        </div>
      </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────
function SectionTitle({ children, accent, noMargin }) {
  return (
      <div style={{ display:'flex', alignItems:'center', gap:'0.45rem', marginBottom: noMargin ? 0 : '0.6rem' }}>
        <span style={{ width:3, height:13, background:accent, display:'inline-block' }} />
        <span style={{ fontSize:'0.7rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--text-primary)' }}>
        {children}
      </span>
      </div>
  );
}

function LiveIndicator({ on }) {
  return (
      <span style={{ display:'inline-flex', alignItems:'center', gap:'0.3rem', fontSize:'0.64rem',
        color: on ? 'var(--success)' : 'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.1em' }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background: on ? 'var(--success)' : 'var(--text-muted)',
        boxShadow: on ? '0 0 6px var(--success)' : 'none' }} />
        {on ? 'Live' : 'Idle'}
    </span>
  );
}

function StatChart({ title, color, dataKey, data, currentLabel, yMax, unit }) {
  return (
      <div style={{ border:'1px solid var(--border)', padding:'0.55rem', background:'var(--bg-secondary)', borderRadius:2, minWidth:0 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:'0.3rem' }}>
          <span style={{ fontSize:'0.6rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--text-muted)' }}>{title}</span>
          <span className="mono" style={{ fontSize:'0.72rem', fontWeight:700, color }}>{currentLabel}</span>
        </div>
        <div style={{ width:'100%', height:80 }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top:3, right:3, left:0, bottom:0 }}>
              <CartesianGrid stroke="var(--border-faint)" strokeDasharray="2 3" vertical={false} />
              <XAxis dataKey="t" hide />
              <YAxis domain={[0, yMax || 'auto']} width={28} tick={{ fontSize:8, fill:'var(--text-muted)' }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background:'var(--card-bg)', border:'1px solid var(--border)', fontSize:'0.68rem', padding:'0.25rem 0.45rem' }}
                       labelStyle={{ color:'var(--text-muted)', fontSize:'0.62rem' }} formatter={(v) => [`${v}${unit}`, title]} />
              <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
  );
}

function WebhookPanel({ webhook, loading, error, onReload, repoUrls }) {
  const deriveSettingsUrl = (url) => url
      ? url.replace(/\.git$/, '') + '/settings/hooks/new'
      : 'https://github.com/YOUR_USER/YOUR_REPO/settings/hooks/new';
  const settingsUrl = deriveSettingsUrl(repoUrls.frontend || repoUrls.backend);
  return (
      <div className="card">
        <div className="card-body">
          <SectionTitle accent="#8a7bff">GitHub Webhooks</SectionTitle>
          <div style={{ background:'linear-gradient(90deg,rgba(138,123,255,0.08),rgba(232,201,74,0.06))',
            border:'1px solid var(--border)', padding:'0.55rem 0.75rem', marginBottom:'0.75rem', borderRadius:2 }}>
            <div style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--text-primary)' }}>Push to GitHub, deploy automatically.</div>
            <div style={{ fontSize:'0.68rem', color:'var(--text-muted)', marginTop:'0.1rem' }}>
              Every <code style={{ padding:'1px 4px', background:'var(--bg-tertiary)' }}>git push</code> rebuilds in seconds.
            </div>
          </div>
          {loading && <div className="spinner-center" style={{ padding:'0.75rem' }}><div className="spinner" /></div>}
          {error   && <div className="alert alert-error">{error} <button className="btn btn-ghost btn-sm" onClick={onReload} style={{ marginLeft:'0.5rem' }}>Retry</button></div>}
          {webhook && webhook.entries.map((entry, idx) => <WebhookEntry key={idx} entry={entry} />)}
          <div style={{ marginTop:'0.9rem' }}>
            {['Go to your repo\'s Settings tab.',
              'Left sidebar → Webhooks → Add webhook.',
              `Or jump straight there: ${settingsUrl}`,
              'Paste Payload URL, set Content type to application/json, paste Secret.',
              'Select "Just the push event" → tick Active → Add webhook.',
            ].map((step, i) => (
                <div key={i} className="step-box">
                  <span className="step-num">{i+1}</span>
                  {i === 2
                      ? <>{step.split(settingsUrl)[0]}<a href={settingsUrl} target="_blank" rel="noopener noreferrer" className="mono" style={{ color:'var(--accent)', fontSize:'0.7rem', wordBreak:'break-all' }}>{settingsUrl}</a></>
                      : step}
                </div>
            ))}
          </div>
          <div className="terminal" style={{ marginTop:'0.75rem' }}>
            <div className="terminal-titlebar">
              <span className="terminal-dot red" /><span className="terminal-dot yellow" /><span className="terminal-dot green" />
              <span className="terminal-title">github-webhook-setup.sh</span>
            </div>
            <div className="terminal-body">
              <div className="terminal-output">Payload URL  → {webhook?.entries?.[0]?.url || '…'}</div>
              <div className="terminal-output">Content type → <span className="terminal-key">application/json</span></div>
              <div className="terminal-output">Secret       → <span className="terminal-key">(paste from above)</span></div>
              <div style={{ height:'0.45rem' }} />
              <div><span className="terminal-prompt">$</span> git push origin main  <span className="terminal-comment"># → auto-rebuild 🚀</span></div>
            </div>
          </div>
        </div>
      </div>
  );
}

function WebhookEntry({ entry }) {
  const [showSecret, setShowSecret] = useState(false);
  const [copiedUrl,  setCopiedUrl]  = useState(false);
  const [copiedSec,  setCopiedSec]  = useState(false);
  const copy = async (val, setter) => {
    try { await navigator.clipboard.writeText(val); }
    catch { const ta=document.createElement('textarea'); ta.value=val; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
    setter(true); setTimeout(() => setter(false), 1200);
  };
  return (
      <div style={{ marginBottom:'0.65rem' }}>
        {entry.role !== 'single' && (
            <div style={{ fontSize:'0.62rem', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:'0.3rem' }}>
              {entry.role} repo
            </div>
        )}
        <FieldRow label="Payload URL" value={entry.url} copied={copiedUrl} onCopy={() => copy(entry.url, setCopiedUrl)} />
        <FieldRow label="Secret" value={showSecret ? entry.secret : '••••••••••••••••••••'} copied={copiedSec}
                  onCopy={() => copy(entry.secret, setCopiedSec)} onToggle={() => setShowSecret(s => !s)} toggled={showSecret} />
      </div>
  );
}

function FieldRow({ label, value, copied, onCopy, onToggle, toggled }) {
  return (
      <div style={{ marginBottom:'0.35rem' }}>
        <label className="form-label" style={{ marginBottom:'0.2rem' }}>{label}</label>
        <div style={{ display:'flex', gap:'0.3rem' }}>
          <div className="input mono" style={{ flex:1, userSelect:'all', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:'0.72rem', padding:'0.4rem 0.55rem' }}>{value}</div>
          {onToggle && <button type="button" className="btn btn-ghost btn-sm" onClick={onToggle} style={{ padding:'0.3rem 0.5rem' }}>{toggled ? '🙈' : '👁'}</button>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCopy} style={{ padding:'0.3rem 0.55rem' }}>{copied ? '✓' : '⧉'}</button>
        </div>
      </div>
  );
}

const CSS = `
  .ps-grid { display:grid; grid-template-columns:1fr 1fr; gap:0.85rem; align-items:start; }
  .ps-col  { display:flex; flex-direction:column; gap:0.85rem; min-width:0; }
  @media (max-width:1024px) { .ps-grid { grid-template-columns:1fr; } }

  .runtime-log {
    background:var(--bg-secondary); color:var(--text-secondary);
    border:1px solid var(--border); border-radius:2px;
    padding:0.75rem; max-height:320px; overflow:auto;
    white-space:pre-wrap; word-break:break-word;
    font-size:0.72rem; line-height:1.55;
    font-family:'JetBrains Mono',monospace; margin:0;
  }
  .runtime-log::-webkit-scrollbar { width:8px; }
  .runtime-log::-webkit-scrollbar-thumb { background:var(--scrollbar-thumb); }

  .terminal { background:#0a0a0a; border:1px solid #1e1e1e; border-radius:4px;
    overflow:hidden; font-family:'JetBrains Mono',monospace; font-size:0.72rem; color:#e8e6e0; }
  .terminal-titlebar { background:linear-gradient(180deg,#252525,#1a1a1a); padding:0.4rem 0.6rem;
    display:flex; align-items:center; gap:0.45rem; border-bottom:1px solid #141414; }
  .terminal-dot { width:10px; height:10px; border-radius:50%; display:inline-block; }
  .terminal-dot.red    { background:#ff5f56; }
  .terminal-dot.yellow { background:#ffbd2e; }
  .terminal-dot.green  { background:#27c93f; }
  .terminal-title { flex:1; text-align:center; font-size:0.66rem; color:#9a9488; letter-spacing:0.04em; }
  .terminal-body  { padding:0.65rem 0.75rem; max-height:400px; overflow:auto; line-height:1.6; word-break:break-all; }
  .terminal-prompt  { color:#4caf82; }
  .terminal-comment { color:#6a665e; }
  .terminal-output  { color:#a8a49c; }
  .terminal-key     { color:#e8c94a; }

  .step-box { background:var(--bg-secondary); border:1px solid var(--border-faint);
    border-left:3px solid var(--accent); padding:0.45rem 0.6rem;
    margin-bottom:0.35rem; font-size:0.72rem; color:var(--text-secondary); }
  .step-box strong { color:var(--text-primary); }
  .step-box .step-num { display:inline-block; background:var(--accent); color:var(--accent-text);
    font-weight:700; font-size:0.62rem; padding:1px 6px; margin-right:0.35rem; border-radius:1px; }
`;