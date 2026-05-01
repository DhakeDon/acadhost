import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import BuildLogs from './BuildLogs';

// ─────────────────────────────────────────────────────────────────────────────
// ProjectCreate v5
//
// Changes vs v4:
//  • EnvVarsEditor now includes a collapsible "How to use" guide that shows:
//      - Node.js / Python code examples for reading custom vars
//      - MySQL connection snippets using DB_* auto-injected vars
//      - Local dev .env.local tip
//  • DB info box expanded with full connection-string examples when a
//    database is selected (mysql2 for Node, mysql-connector for Python).
//  • DbConnectionGuide new component rendered inside the database card.
//  • All v4 behaviour (bulk import, dot-env parse, reveal/hide) unchanged.
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_TYPES = [
  { value: 'frontend', label: 'Frontend',   desc: 'Static HTML / React / Vue' },
  { value: 'backend',  label: 'Backend',    desc: 'Node.js or Python API' },
  { value: 'combined', label: 'Full-stack', desc: 'Frontend + backend together' },
];

const NODE_VERSIONS   = ['18', '20', '22', '23'];
const PYTHON_VERSIONS = ['3.10', '3.11', '3.12', '3.13'];
const MAX_ZIP_MB      = 200;
const ENV_KEY_REGEX   = /^[A-Z_][A-Z0-9_]{0,127}$/;
const RESERVED_KEYS   = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const MAX_VAL_LEN     = 2048;

function parseDotEnv(text) {
  const rows = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val    = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    rows.push({ key, value: val });
  }
  return rows;
}

function validateRow(key, value) {
  if (!key) return 'Key is required.';
  if (!ENV_KEY_REGEX.test(key)) return 'UPPER_SNAKE_CASE only (A-Z, 0-9, _).';
  if (RESERVED_KEYS.includes(key)) return `"${key}" is reserved — auto-injected when a DB is attached.`;
  if (value.length > MAX_VAL_LEN) return `Value exceeds ${MAX_VAL_LEN} chars.`;
  return null;
}

export default function ProjectCreate({ onCancel, onCreated }) {
  const [projectType,     setProjectType]     = useState('');
  const [runtime,         setRuntime]         = useState('node');
  const [runtimeVersion,  setRuntimeVersion]  = useState('20');
  const [subdomain,       setSubdomain]       = useState('');
  const [subdomainSuggest,setSubdomainSuggest]= useState('');
  const [subdomainStatus, setSubdomainStatus] = useState('idle');
  const [cpuLimit,        setCpuLimit]        = useState(1.0);
  const [ramLimitMb,      setRamLimitMb]      = useState(512);
  const [databaseId,      setDatabaseId]      = useState('');
  const [title,           setTitle]           = useState('');
  const [sourceType,      setSourceType]      = useState('git');
  const [gitUrl,          setGitUrl]          = useState('');
  const [gitUrlBackend,   setGitUrlBackend]   = useState('');
  const [zipFile,         setZipFile]         = useState(null);
  const [zipFileFrontend, setZipFileFrontend] = useState(null);
  const [zipFileBackend,  setZipFileBackend]  = useState(null);

  const [envVars, setEnvVars] = useState([]);
  const nextId = useRef(1);

  const [showImport,   setShowImport]   = useState(false);
  const [importText,   setImportText]   = useState('');
  const [importParsed, setImportParsed] = useState([]);
  const [importErrors, setImportErrors] = useState([]);

  const [profile,   setProfile]   = useState(null);
  const [databases, setDatabases] = useState([]);
  const [errors,    setErrors]    = useState({});
  const [submitting,setSubmitting]= useState(false);
  const [buildProjectId, setBuildProjectId] = useState(null);
  const [buildDone,      setBuildDone]      = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [pr, dr] = await Promise.all([api.get('/student/profile'), api.get('/databases')]);
        setProfile(pr.data.data);
        setDatabases(dr.data.data.items || []);
      } catch {}
    })();
  }, []);

  useEffect(() => { setRuntimeVersion(runtime === 'python' ? '3.11' : '20'); }, [runtime]);

  const availCpu = profile ? +(profile.cpuQuota - profile.cpuUsed).toFixed(2) : 0;
  const availRam = profile ? (profile.ramQuotaMb - profile.ramUsedMb) : 0;

  const checkSubdomain = async () => {
    const s = subdomain.trim().toLowerCase();
    if (!s) { setSubdomainStatus('empty'); return; }
    if (!/^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(s) || s.length < 3) { setSubdomainStatus('invalid'); return; }
    setSubdomainStatus('checking');
    try {
      const res  = await api.get('/projects/check-subdomain', { params: { name: s } });
      const data = res.data.data || {};
      if (data.available) { setSubdomainStatus('available'); setSubdomainSuggest(''); }
      else {
        const r = data.reason || 'taken';
        setSubdomainStatus(r === 'reserved' ? 'reserved' : r === 'invalid_format' ? 'invalid' : 'taken');
        setSubdomainSuggest(data.suggestion || data.suggestedSubdomain || '');
      }
    } catch { setSubdomainStatus('idle'); }
  };

  const addRow = (key = '', value = '') => {
    setEnvVars(prev => [...prev, { id: nextId.current++, key, value, revealed: false, error: null }]);
  };
  const updateRow = (id, field, val) => {
    setEnvVars(prev => prev.map(r => r.id === id
        ? { ...r, [field]: field === 'key' ? val.toUpperCase().replace(/[^A-Z0-9_]/g, '') : val, error: null }
        : r
    ));
  };
  const removeRow = (id) => setEnvVars(prev => prev.filter(r => r.id !== id));
  const toggleReveal = (id) => setEnvVars(prev => prev.map(r => r.id === id ? { ...r, revealed: !r.revealed } : r));

  const validateEnvVars = useCallback(() => {
    const cleaned = [];
    const rowErrors = {};
    const seen = new Set();
    for (const row of envVars) {
      const k = row.key.trim(), v = (row.value ?? '');
      if (!k && !v) continue;
      const err = validateRow(k, v);
      if (err) { rowErrors[row.id] = err; continue; }
      if (seen.has(k)) { rowErrors[row.id] = `Duplicate key "${k}".`; continue; }
      seen.add(k);
      cleaned.push({ key: k, value: v });
    }
    return { rowErrors, cleaned };
  }, [envVars]);

  const handleImportPreview = () => {
    const parsed = parseDotEnv(importText);
    const errs   = [];
    const seen   = new Set();
    parsed.forEach((r, i) => {
      const e = validateRow(r.key, r.value);
      if (e) errs.push(`Row ${i + 1} (${r.key || '?'}): ${e}`);
      else if (seen.has(r.key)) errs.push(`Row ${i + 1}: Duplicate key "${r.key}".`);
      else seen.add(r.key);
    });
    setImportParsed(parsed);
    setImportErrors(errs);
  };

  const handleImportConfirm = () => {
    const incoming = importParsed.filter(r => !validateRow(r.key, r.value));
    setEnvVars(prev => {
      const map = new Map(prev.map(r => [r.key, r]));
      for (const r of incoming) {
        const id = map.has(r.key) ? map.get(r.key).id : nextId.current++;
        map.set(r.key, { id, key: r.key, value: r.value, revealed: false, error: null });
      }
      return Array.from(map.values());
    });
    setShowImport(false); setImportText(''); setImportParsed([]); setImportErrors([]);
  };

  // ── FIX #3: Guard against null profile so availCpu/availRam (both 0)
  //    don't incorrectly block the form before the API call completes.
  const validate = useCallback(() => {
    const errs = {};

    if (!profile) {
      errs.submit = 'Profile is still loading — please wait a moment.';
      return errs;
    }

    if (!title.trim())     errs.title = 'Project title is required.';
    if (!projectType)      errs.projectType = 'Select a project type.';
    if (!subdomain.trim()) errs.subdomain = 'Subdomain is required.';
    else if (!/^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(subdomain) || subdomain.length < 3)
      errs.subdomain = 'Subdomain: 3–63 chars, lowercase/numbers/hyphens.';
    if (cpuLimit <= 0 || cpuLimit > availCpu)    errs.cpuLimit   = `CPU must be > 0 and ≤ ${availCpu}.`;
    if (ramLimitMb <= 0 || ramLimitMb > availRam) errs.ramLimitMb = `RAM must be > 0 and ≤ ${availRam}.`;
    if (projectType !== 'frontend' && !runtime) errs.runtime = 'Select a runtime.';
    if (sourceType === 'git') {
      if (projectType === 'combined') {
        if (!gitUrl.trim())        errs.gitUrl        = 'Frontend Git URL is required.';
        if (!gitUrlBackend.trim()) errs.gitUrlBackend = 'Backend Git URL is required.';
      } else if (!gitUrl.trim()) errs.gitUrl = 'Git URL is required.';
    } else {
      if (projectType === 'combined') {
        if (!zipFileFrontend) errs.zipFileFrontend = 'Frontend ZIP required.';
        if (!zipFileBackend)  errs.zipFileBackend  = 'Backend ZIP required.';
        if (zipFileFrontend && zipFileFrontend.size > MAX_ZIP_MB * 1024 * 1024) errs.zipFileFrontend = `Exceeds ${MAX_ZIP_MB} MB.`;
        if (zipFileBackend  && zipFileBackend.size  > MAX_ZIP_MB * 1024 * 1024) errs.zipFileBackend  = `Exceeds ${MAX_ZIP_MB} MB.`;
      } else {
        if (!zipFile) errs.zipFile = 'ZIP file is required.';
        if (zipFile && zipFile.size > MAX_ZIP_MB * 1024 * 1024) errs.zipFile = `Exceeds ${MAX_ZIP_MB} MB.`;
      }
    }
    const { rowErrors } = validateEnvVars();
    if (Object.keys(rowErrors).length > 0) { errs.envVars = 'Fix env var errors below.'; errs.envVarRows = rowErrors; }
    return errs;
  }, [profile, title, projectType, subdomain, cpuLimit, ramLimitMb, runtime, sourceType,
    gitUrl, gitUrlBackend, zipFile, zipFileFrontend, zipFileBackend, availCpu, availRam, validateEnvVars]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const { rowErrors } = validateEnvVars();
    setEnvVars(prev => prev.map(r => ({ ...r, error: rowErrors[r.id] || null })));
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).filter(k => k !== 'envVarRows').length > 0) return;

    setSubmitting(true); setErrors({});
    try {
      const fd = new FormData();
      fd.append('title', title.trim());
      fd.append('subdomain', subdomain.trim());
      fd.append('projectType', projectType);
      fd.append('sourceType', sourceType);
      fd.append('cpuLimit', String(cpuLimit));
      fd.append('ramLimitMb', String(ramLimitMb));
      if (databaseId) fd.append('databaseId', databaseId);
      if (projectType !== 'frontend') { fd.append('runtime', runtime); fd.append('runtimeVersion', runtimeVersion); }
      if (sourceType === 'git') {
        fd.append('gitUrl', gitUrl.trim());
        if (projectType === 'combined') fd.append('gitUrlBackend', gitUrlBackend.trim());
      } else {
        if (projectType === 'combined') { fd.append('zipFileFrontend', zipFileFrontend); fd.append('zipFileBackend', zipFileBackend); }
        else fd.append('zipFile', zipFile);
      }
      const { cleaned } = validateEnvVars();
      if (cleaned.length > 0) fd.append('envVars', JSON.stringify(cleaned));

      const res = await api.post('/projects', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setBuildProjectId(res.data.data.projectId);
    } catch (err) {
      const body = err.response?.data, code = body?.error;
      if (code === 'SUBDOMAIN_TAKEN') {
        const sug = body?.suggestedSubdomain || body?.suggestion || '';
        setSubdomainSuggest(sug);
        setErrors({ subdomain: `'${subdomain}' is taken.${sug ? ` Try: ${sug}` : ''}` });
      } else {
        const MAP = {
          PROJECT_QUOTA_EXCEEDED: "You've reached your project limit.", SUBDOMAIN_RESERVED: 'This subdomain is reserved.',
          SUBDOMAIN_INVALID: 'Subdomain: 3–63 chars, lowercase/numbers/hyphens.', CPU_QUOTA_EXCEEDED: 'CPU limit exceeds your quota.',
          RAM_QUOTA_EXCEEDED: 'RAM limit exceeds your quota.', ZIP_TOO_LARGE: `ZIP exceeds ${MAX_ZIP_MB} MB.`,
          DATABASE_NOT_FOUND: 'Selected database not found.', BUILD_QUEUE_FULL: 'Build queue is full. Try again shortly.',
          ENV_VAR_KEY_RESERVED: body?.message || 'A reserved env var key was used.',
          ENV_VAR_KEY_INVALID: body?.message || 'Invalid env var key format.',
          ENV_VAR_KEY_DUPLICATE: body?.message || 'Duplicate env var key.',
          ENV_VAR_VALUE_TOO_LONG: body?.message || 'An env var value is too long.',
        };
        setErrors({ submit: MAP[code] || body?.message || 'Failed to create project.' });
      }
    } finally { setSubmitting(false); }
  };

  const handleBuildComplete = (result) => {
    setBuildDone(true);
    if (result.status === 'success') setTimeout(() => onCreated && onCreated(), 2000);
  };

  if (buildProjectId) {
    return (
        <div>
          <div className="section-header">
            <div><h2 className="section-title">Deploying</h2><p className="section-subtitle">Live build output</p></div>
          </div>
          <BuildLogs projectId={buildProjectId} onComplete={handleBuildComplete}
                     onReturn={() => { setBuildProjectId(null); setBuildDone(false); }} />
          {buildDone && (
              <div style={{ marginTop:'1rem' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => { setBuildProjectId(null); setBuildDone(false); }}>← Back to form</button>
              </div>
          )}
        </div>
    );
  }

  const needsRuntime = projectType === 'backend' || projectType === 'combined';
  const envRowErrors = errors.envVarRows || {};
  const selectedDb   = databases.find(d => String(d.id) === String(databaseId));

  return (
      <div>
        <div className="section-header">
          <div><h2 className="section-title">New Project</h2><p className="section-subtitle">Deploy your application to AcadHost</p></div>
          {onCancel && <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>}
        </div>

        {errors.submit && <div className="alert alert-error" style={{ marginBottom:'1rem' }}>{errors.submit}</div>}

        <form onSubmit={handleSubmit} autoComplete="off">
          {/* Project Type */}
          <div className="card" style={{ marginBottom:'0.85rem' }}>
            <div className="card-body">
              <SectionTitle accent="var(--accent)">1. Project Type</SectionTitle>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'0.5rem' }}>
                {PROJECT_TYPES.map(pt => (
                    <button key={pt.value} type="button" onClick={() => setProjectType(pt.value)}
                            className={`pill ${projectType === pt.value ? 'pill-active' : ''}`}>
                      <span className="pill-label">{pt.label}</span>
                      <span className="pill-desc">{pt.desc}</span>
                    </button>
                ))}
              </div>
              {errors.projectType && <div className="form-error" style={{ marginTop:'0.4rem' }}>{errors.projectType}</div>}
            </div>
          </div>

          {projectType && (
              <div className="pc-grid">
                {/* ── LEFT COLUMN ── */}
                <div className="pc-col">
                  {needsRuntime && (
                      <div className="card">
                        <div className="card-body">
                          <SectionTitle accent="var(--success)">Runtime</SectionTitle>
                          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem' }}>
                            <div className="form-group" style={{ marginBottom:0 }}>
                              <label className="form-label">Language</label>
                              <select className="input" value={runtime} onChange={e => setRuntime(e.target.value)}>
                                <option value="node">Node.js</option>
                                <option value="python">Python</option>
                              </select>
                            </div>
                            <div className="form-group" style={{ marginBottom:0 }}>
                              <label className="form-label">Version</label>
                              <select className="input" value={runtimeVersion} onChange={e => setRuntimeVersion(e.target.value)}>
                                {(runtime === 'python' ? PYTHON_VERSIONS : NODE_VERSIONS).map(v => (
                                    <option key={v} value={v}>{runtime === 'node' ? `Node ${v}` : `Python ${v}`}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          {errors.runtime && <div className="form-error" style={{ marginTop:'0.4rem' }}>{errors.runtime}</div>}
                        </div>
                      </div>
                  )}

                  {/* Details */}
                  <div className="card">
                    <div className="card-body">
                      <SectionTitle accent="var(--info)">Details</SectionTitle>
                      <div className="form-group">
                        <label className="form-label">Project Title</label>
                        <input className={`input${errors.title ? ' input-error' : ''}`} type="text" value={title}
                               onChange={e => setTitle(e.target.value)} maxLength={255} placeholder="My Awesome App" autoComplete="off" />
                        {errors.title && <div className="form-error">{errors.title}</div>}
                      </div>
                      <div className="form-group" style={{ marginBottom:0 }}>
                        <label className="form-label">Subdomain</label>
                        <div style={{ display:'flex', gap:'0.35rem' }}>
                          <input className={`input${errors.subdomain || ['taken','invalid','reserved'].includes(subdomainStatus) ? ' input-error' : ''}`}
                                 type="text" value={subdomain} maxLength={63} placeholder="my-project" autoComplete="off"
                                 onChange={e => { setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setSubdomainSuggest(''); setSubdomainStatus('idle'); setErrors(prev => ({ ...prev, subdomain: '' })); }} />
                          <button type="button" className="btn btn-secondary btn-sm" onClick={checkSubdomain} disabled={subdomainStatus === 'checking'}>
                            {subdomainStatus === 'checking' ? <><span className="spinner" />…</> : 'Check'}
                          </button>
                        </div>
                        {subdomain && <div className="mono" style={{ fontSize:'0.7rem', color:'var(--text-muted)', marginTop:'0.3rem' }}>https://{subdomain}.acadhost.com</div>}
                        {subdomainStatus === 'available' && <div className="form-hint" style={{ color:'var(--success)' }}>✓ Available</div>}
                        {subdomainStatus === 'taken' && (
                            <div className="form-hint" style={{ color:'var(--error)' }}>
                              ✗ Taken
                              {subdomainSuggest && (
                                  <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft:'0.4rem' }}
                                          onClick={() => { setSubdomain(subdomainSuggest); setSubdomainStatus('idle'); setSubdomainSuggest(''); }}>
                                    Use "{subdomainSuggest}"
                                  </button>
                              )}
                            </div>
                        )}
                        {subdomainStatus === 'reserved' && <div className="form-hint" style={{ color:'var(--error)' }}>✗ Reserved subdomain.</div>}
                        {subdomainStatus === 'invalid'  && <div className="form-hint" style={{ color:'var(--error)' }}>✗ 3–63 chars, lowercase/numbers/hyphens.</div>}
                        {subdomainStatus === 'empty'    && <div className="form-hint" style={{ color:'var(--text-muted)' }}>Enter a subdomain first.</div>}
                        {errors.subdomain && <div className="form-error">{errors.subdomain}</div>}
                      </div>
                    </div>
                  </div>

                  {/* Resources */}
                  <div className="card">
                    <div className="card-body">
                      <SectionTitle accent="var(--error)">Resources</SectionTitle>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem' }}>
                        <div className="form-group" style={{ marginBottom:0 }}>
                          <label className="form-label">CPU (cores)</label>
                          <input className={`input${errors.cpuLimit ? ' input-error' : ''}`} type="number" step="0.25" min="0.25" max={availCpu}
                                 value={cpuLimit} onChange={e => setCpuLimit(parseFloat(e.target.value) || 0)} />
                          <span className="form-hint">{availCpu} available</span>
                          {errors.cpuLimit && <div className="form-error">{errors.cpuLimit}</div>}
                        </div>
                        <div className="form-group" style={{ marginBottom:0 }}>
                          <label className="form-label">RAM (MB)</label>
                          <input className={`input${errors.ramLimitMb ? ' input-error' : ''}`} type="number" step="64" min="64" max={availRam}
                                 value={ramLimitMb} onChange={e => setRamLimitMb(parseInt(e.target.value, 10) || 0)} />
                          <span className="form-hint">{availRam} available</span>
                          {errors.ramLimitMb && <div className="form-error">{errors.ramLimitMb}</div>}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Database */}
                  <div className="card">
                    <div className="card-body">
                      <SectionTitle accent="var(--warning)">Database (optional)</SectionTitle>
                      <div className="form-group" style={{ marginBottom: databaseId ? '0.75rem' : 0 }}>
                        <label className="form-label">Attach</label>
                        <select className="input" value={databaseId} onChange={e => setDatabaseId(e.target.value)}>
                          <option value="">None</option>
                          {databases.map(db => <option key={db.id} value={db.id}>{db.dbName}</option>)}
                        </select>
                        {databases.length === 0 && <span className="form-hint">No databases yet — create one in Databases.</span>}
                      </div>

                      {/* Expanded DB guide shown when a DB is selected */}
                      {databaseId && (
                          <DbConnectionGuide runtime={runtime} dbName={selectedDb?.dbName} />
                      )}
                    </div>
                  </div>

                  {/* Environment Variables */}
                  <EnvVarsEditor
                      items={envVars}
                      rowErrors={envRowErrors}
                      runtime={runtime}
                      projectType={projectType}
                      databaseAttached={!!databaseId}
                      onAdd={() => addRow()}
                      onUpdate={updateRow}
                      onRemove={removeRow}
                      onToggleReveal={toggleReveal}
                      onOpenImport={() => setShowImport(true)}
                      topLevelError={errors.envVars}
                  />
                </div>

                {/* ── RIGHT COLUMN ── */}
                <div className="pc-col">
                  {/* Source */}
                  <div className="card">
                    <div className="card-body">
                      <SectionTitle accent="#8a7bff">Source Code</SectionTitle>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.4rem', marginBottom:'0.75rem' }}>
                        <button type="button" onClick={() => setSourceType('git')} className={`pill ${sourceType === 'git' ? 'pill-active' : ''}`}>
                          <span className="pill-label">Git Repository</span>
                          <span className="pill-desc">Auto-deploy on push</span>
                        </button>
                        <button type="button" onClick={() => setSourceType('zip')} className={`pill ${sourceType === 'zip' ? 'pill-active' : ''}`}>
                          <span className="pill-label">ZIP Upload</span>
                          <span className="pill-desc">Max {MAX_ZIP_MB} MB</span>
                        </button>
                      </div>

                      {sourceType === 'git' ? (
                          projectType === 'combined' ? (
                              <>
                                <div className="form-group">
                                  <label className="form-label">Frontend Git URL</label>
                                  <input className={`input${errors.gitUrl ? ' input-error' : ''}`} type="url" value={gitUrl}
                                         onChange={e => setGitUrl(e.target.value)} autoComplete="off" placeholder="https://github.com/you/frontend.git" />
                                  {errors.gitUrl && <div className="form-error">{errors.gitUrl}</div>}
                                </div>
                                <div className="form-group" style={{ marginBottom:0 }}>
                                  <label className="form-label">Backend Git URL</label>
                                  <input className={`input${errors.gitUrlBackend ? ' input-error' : ''}`} type="url" value={gitUrlBackend}
                                         onChange={e => setGitUrlBackend(e.target.value)} autoComplete="off" placeholder="https://github.com/you/backend.git" />
                                  {errors.gitUrlBackend && <div className="form-error">{errors.gitUrlBackend}</div>}
                                </div>
                              </>
                          ) : (
                              <div className="form-group" style={{ marginBottom:0 }}>
                                <label className="form-label">Repository URL</label>
                                <input className={`input${errors.gitUrl ? ' input-error' : ''}`} type="url" value={gitUrl}
                                       onChange={e => setGitUrl(e.target.value)} autoComplete="off" placeholder="https://github.com/you/project.git" />
                                {errors.gitUrl && <div className="form-error">{errors.gitUrl}</div>}
                              </div>
                          )
                      ) : (
                          projectType === 'combined' ? (
                              <>
                                <DropZone label="Frontend ZIP" file={zipFileFrontend} onFile={setZipFileFrontend} error={errors.zipFileFrontend} />
                                <div style={{ height:8 }} />
                                <DropZone label="Backend ZIP" file={zipFileBackend} onFile={setZipFileBackend} error={errors.zipFileBackend} />
                              </>
                          ) : (
                              <DropZone label={`ZIP File (max ${MAX_ZIP_MB} MB)`} file={zipFile} onFile={setZipFile} error={errors.zipFile} />
                          )
                      )}
                    </div>
                  </div>

                  {/* CLI Tutorial */}
                  <CLITutorial
                      projectType={projectType} sourceType={sourceType} runtime={runtime}
                      databaseAttached={!!databaseId} databaseName={selectedDb?.dbName}
                      customEnvKeys={envVars.filter(r => r.key.trim() && !validateRow(r.key.trim(), r.value)).map(r => r.key.trim())}
                  />
                </div>
              </div>
          )}

          {projectType && (
              <div style={{ display:'flex', gap:'0.5rem', marginTop:'1rem' }}>
                <button className="btn btn-primary" type="submit" disabled={submitting} style={{ flex:1, maxWidth:240 }}>
                  {submitting ? <><span className="spinner" />Deploying</> : 'Deploy Project →'}
                </button>
                {onCancel && <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>}
              </div>
          )}
        </form>

        {showImport && (
            <ImportModal text={importText} onTextChange={setImportText} parsed={importParsed} parseErrors={importErrors}
                         onPreview={handleImportPreview} onConfirm={handleImportConfirm}
                         onClose={() => { setShowImport(false); setImportText(''); setImportParsed([]); setImportErrors([]); }} />
        )}

        <style>{CSS}</style>
      </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DbConnectionGuide — shown when a database is selected during project creation
// ─────────────────────────────────────────────────────────────────────────────
function DbConnectionGuide({ runtime, dbName }) {
  const [tab, setTab] = useState(runtime === 'python' ? 'python' : 'node');

  useEffect(() => { setTab(runtime === 'python' ? 'python' : 'node'); }, [runtime]);

  return (
      <div>
        {/* Injected vars notice */}
        <div style={{ padding:'0.5rem 0.65rem', background:'rgba(59,130,246,0.07)', border:'1px solid rgba(59,130,246,0.2)',
          borderRadius:3, fontSize:'0.72rem', color:'var(--info)', marginBottom:'0.65rem', lineHeight:1.6 }}>
          <div style={{ fontWeight:700, marginBottom:'0.2rem' }}>✓ Platform will auto-inject these 5 variables:</div>
          {['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'].map(k => (
              <code key={k} style={{ marginRight:'0.4rem', padding:'1px 5px', background:'rgba(59,130,246,0.12)',
                fontFamily:'monospace', borderRadius:2, fontSize:'0.68rem' }}>{k}</code>
          ))}
          <div style={{ marginTop:'0.35rem', fontSize:'0.68rem', color:'var(--text-muted)' }}>
            Never add them manually — they are injected at container start from your database credentials.
            <strong style={{ color:'var(--warning)' }}> DB_PASSWORD is never exposed in the UI.</strong>
          </div>
        </div>

        {/* Language tab toggle */}
        <div style={{ display:'flex', gap:'0.25rem', marginBottom:'0.45rem' }}>
          {['node', 'python'].map(t => (
              <button key={t} type="button" onClick={() => setTab(t)}
                      style={{ padding:'0.2rem 0.55rem', fontSize:'0.63rem', fontWeight:700, textTransform:'uppercase',
                        letterSpacing:'0.07em', cursor:'pointer', border:'1px solid var(--border)', borderRadius:2,
                        fontFamily:'inherit',
                        background: tab === t ? 'var(--accent-soft)' : 'var(--bg-secondary)',
                        borderColor: tab === t ? 'var(--accent)' : 'var(--border)',
                        color: tab === t ? 'var(--accent)' : 'var(--text-muted)' }}>
                {t === 'node' ? 'Node.js' : 'Python'}
              </button>
          ))}
        </div>

        <div className="terminal">
          <div className="terminal-titlebar">
            <span className="terminal-dot red" /><span className="terminal-dot yellow" /><span className="terminal-dot green" />
            <span className="terminal-title">db-connection · {tab === 'node' ? 'mysql2' : 'mysql-connector-python'}</span>
          </div>
          <div className="terminal-body">
            {tab === 'node' ? (
                <>
                  <div className="terminal-comment"># npm install mysql2</div>
                  <div className="terminal-output">const mysql = require(<span className="terminal-key">'mysql2/promise'</span>);</div>
                  <div style={{ height:'0.3rem' }} />
                  <div className="terminal-output">
                    {'const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = '}
                    <span className="terminal-key">process.env</span>;
                  </div>
                  <div style={{ height:'0.3rem' }} />
                  <div className="terminal-output">const pool = mysql.createPool({'{'}</div>
                  <div className="terminal-output">{'  host:     DB_HOST,'}</div>
                  <div className="terminal-output">
                    {'  port:     +DB_PORT,'}
                    <span className="terminal-comment">  // coerce string → number</span>
                  </div>
                  <div className="terminal-output">{'  user:     DB_USER,'}</div>
                  <div className="terminal-output">{'  password: DB_PASSWORD,'}</div>
                  <div className="terminal-output">{'  database: DB_NAME,'}</div>
                  <div className="terminal-output">{'  waitForConnections: true, connectionLimit: 10,'}</div>
                  <div className="terminal-output">{'});'}</div>
                  <div style={{ height:'0.4rem' }} />
                  <div className="terminal-comment"># Example query</div>
                  <div className="terminal-output">{'const [rows] = await pool.query('}</div>
                  <div className="terminal-output">
                    {'  '}<span className="terminal-key">'SELECT * FROM users WHERE id = ?'</span>{', [userId]'}
                  </div>
                  <div className="terminal-output">{');'}</div>
                  {dbName && (
                      <>
                        <div style={{ height:'0.4rem' }} />
                        <div className="terminal-comment"># Your database: {dbName}</div>
                        <div className="terminal-comment"># DB_NAME will equal "{dbName}" at runtime</div>
                      </>
                  )}
                </>
            ) : (
                <>
                  <div className="terminal-comment"># pip install mysql-connector-python</div>
                  <div className="terminal-output">import os, mysql.connector</div>
                  <div style={{ height:'0.3rem' }} />
                  <div className="terminal-output">
                    {'conn = mysql.connector.connect('}
                  </div>
                  <div className="terminal-output">
                    {'  host=os.environ['}
                    <span className="terminal-key">'DB_HOST'</span>
                    {'],'}
                  </div>
                  <div className="terminal-output">
                    {'  port=int(os.environ['}
                    <span className="terminal-key">'DB_PORT'</span>
                    {']),'}
                    <span className="terminal-comment">  # cast to int</span>
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
                  <div style={{ height:'0.4rem' }} />
                  <div className="terminal-comment"># SQLAlchemy alternative</div>
                  <div className="terminal-comment"># pip install sqlalchemy</div>
                  <div className="terminal-output">from sqlalchemy import create_engine</div>
                  <div className="terminal-output">engine = create_engine(</div>
                  <div className="terminal-output">{'  "mysql+mysqlconnector://"'}</div>
                  {/* ── FIX #1: These lines previously used bare {os.environ[<span>]} syntax
                   which JSX parsed as JavaScript expressions, causing a ReferenceError
                   at runtime. All interpolated text is now wrapped in string literals. ── */}
                  <div className="terminal-output">
                    {'  f"{os.environ['}
                    <span className="terminal-key">'DB_USER'</span>
                    {']}:{os.environ['}
                    <span className="terminal-key">'DB_PASSWORD'</span>
                    {']}@"'}
                  </div>
                  <div className="terminal-output">
                    {'  f"{os.environ['}
                    <span className="terminal-key">'DB_HOST'</span>
                    {']}:{os.environ['}
                    <span className="terminal-key">'DB_PORT'</span>
                    {'"]}/{os.environ['}
                    <span className="terminal-key">'DB_NAME'</span>
                    {']}"'}
                  </div>
                  <div className="terminal-output">)</div>
                  {dbName && (
                      <>
                        <div style={{ height:'0.3rem' }} />
                        <div className="terminal-comment"># DB_NAME will equal "{dbName}" at runtime</div>
                      </>
                  )}
                </>
            )}
          </div>
        </div>
      </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EnvVarsEditor — with integrated usage guide
// ─────────────────────────────────────────────────────────────────────────────
function EnvVarsEditor({ items, rowErrors, runtime, projectType, databaseAttached, onAdd, onUpdate, onRemove, onToggleReveal, onOpenImport, topLevelError }) {
  const [showGuide, setShowGuide] = useState(false);
  const isBackend = projectType === 'backend' || projectType === 'combined';

  return (
      <div className="card">
        <div className="card-body">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.5rem' }}>
            <SectionTitle accent="#e8c94a">Environment Variables</SectionTitle>
            <div style={{ display:'flex', gap:'0.35rem' }}>
              {isBackend && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowGuide(g => !g)}
                          style={{ fontSize:'0.63rem' }}>
                    {showGuide ? '▲ Hide guide' : '▾ Usage guide'}
                  </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenImport} title="Paste .env file">↑ Import .env</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onAdd}>+ Add</button>
            </div>
          </div>

          {/* Description */}
          <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', marginBottom:'0.6rem', lineHeight:1.5 }}>
            Stored encrypted at rest. Available in your container as{' '}
            <code style={{ padding:'1px 4px', background:'var(--bg-tertiary)', fontFamily:'monospace' }}>process.env.KEY</code> (Node) or{' '}
            <code style={{ padding:'1px 4px', background:'var(--bg-tertiary)', fontFamily:'monospace' }}>os.environ['KEY']</code> (Python).
            Keys must be <span style={{ fontFamily:'monospace' }}>UPPER_SNAKE_CASE</span>.{' '}
            <code style={{ padding:'1px 4px', background:'var(--bg-tertiary)', fontFamily:'monospace' }}>DB_*</code> are reserved.
          </div>

          {/* Collapsible usage guide */}
          {showGuide && isBackend && (
              <EnvUsageGuideInline runtime={runtime} databaseAttached={databaseAttached} />
          )}

          {/* Rows */}
          {items.length === 0 ? (
              <div style={{ padding:'0.75rem', border:'1px dashed var(--border)', background:'var(--bg-secondary)',
                textAlign:'center', fontSize:'0.72rem', color:'var(--text-muted)' }}>
                No custom variables. Click <strong>+ Add</strong> or <strong>↑ Import .env</strong>.
              </div>
          ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem' }}>
                <div style={{ display:'grid', gridTemplateColumns:'38% 1fr 28px 28px', gap:'0.3rem',
                  fontSize:'0.64rem', color:'var(--text-muted)', paddingBottom:'0.25rem',
                  borderBottom:'1px solid var(--border)', marginBottom:'0.1rem', textTransform:'uppercase', letterSpacing:'0.08em' }}>
                  <span>Key</span><span>Value</span><span /><span />
                </div>
                {items.map(row => {
                  const err = rowErrors[row.id] || row.error;
                  return (
                      <div key={row.id}>
                        <div style={{ display:'grid', gridTemplateColumns:'38% 1fr 28px 28px', gap:'0.3rem', alignItems:'center' }}>
                          <input className={`input mono${err ? ' input-error' : ''}`}
                                 style={{ fontSize:'0.74rem', padding:'0.35rem 0.5rem' }}
                                 type="text" value={row.key} placeholder="API_KEY" autoComplete="off" spellCheck={false}
                                 onChange={e => onUpdate(row.id, 'key', e.target.value)} maxLength={128} />
                          {/*
                      FIX #2: Replaced the readOnly + onFocus reveal pattern with a
                      type="password" / type="text" toggle. The previous approach set
                      readOnly={true} and called onToggleReveal inside onFocus, but React
                      batches the state update so the input remained readOnly during the
                      first keypress after focusing — silently dropping that character.
                      Using the native password input avoids the race condition entirely.
                    */}
                          <input className={`input mono${err ? ' input-error' : ''}`}
                                 style={{ fontSize:'0.74rem', padding:'0.35rem 0.5rem' }}
                                 type={row.revealed ? 'text' : 'password'}
                                 value={row.value}
                                 placeholder="value"
                                 autoComplete="new-password"
                                 spellCheck={false}
                                 onChange={e => onUpdate(row.id, 'value', e.target.value)}
                          />
                          <button type="button" className="btn btn-ghost btn-sm"
                                  title={row.revealed ? 'Hide' : 'Reveal'} onClick={() => onToggleReveal(row.id)}
                                  style={{ padding:'0.25rem', fontSize:'0.72rem', color: row.revealed ? 'var(--success)' : 'var(--text-muted)' }}>
                            {row.revealed ? '👁' : '○'}
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm"
                                  title="Remove" onClick={() => onRemove(row.id)} style={{ padding:'0.25rem', color:'var(--error)' }}>✕</button>
                        </div>
                        {err && <div className="form-error" style={{ marginTop:'0.2rem', marginLeft:2 }}>{err}</div>}
                      </div>
                  );
                })}
              </div>
          )}

          {topLevelError && <div className="form-error" style={{ marginTop:'0.5rem' }}>{topLevelError}</div>}
        </div>
      </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EnvUsageGuideInline — compact guide inside the env vars card
// ─────────────────────────────────────────────────────────────────────────────
function EnvUsageGuideInline({ runtime, databaseAttached }) {
  const isNode = runtime !== 'python';

  return (
      <div style={{ marginBottom:'0.75rem' }}>
        <div className="terminal">
          <div className="terminal-titlebar">
            <span className="terminal-dot red" /><span className="terminal-dot yellow" /><span className="terminal-dot green" />
            <span className="terminal-title">how-to-use-env-vars · {isNode ? 'Node.js' : 'Python'}</span>
          </div>
          <div className="terminal-body" style={{ maxHeight:300 }}>
            {isNode ? (
                <>
                  <div className="terminal-comment"># ── Custom variables ──────────────────────────</div>
                  <div className="terminal-output">
                    {'const { MY_API_KEY, STRIPE_SECRET } = '}
                    <span className="terminal-key">process.env</span>;
                  </div>
                  <div className="terminal-output">
                    {'const withDefault = process.env.PORT ?? '}<span className="terminal-key">8080</span>;
                  </div>
                  {databaseAttached && (
                      <>
                        <div style={{ height:'0.5rem' }} />
                        <div className="terminal-comment"># ── DB_* vars (auto-injected by platform) ─────</div>
                        <div className="terminal-output">
                          {'const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;'}
                        </div>
                        <div className="terminal-output">{'const pool = mysql.createPool({'}</div>
                        <div className="terminal-output">{'  host:DB_HOST, port:+DB_PORT, user:DB_USER,'}</div>
                        <div className="terminal-output">{'  password:DB_PASSWORD, database:DB_NAME'}</div>
                        <div className="terminal-output">{'});'}</div>
                      </>
                  )}
                  <div style={{ height:'0.5rem' }} />
                  <div className="terminal-comment"># ── Local dev (.env.local, not committed) ──────</div>
                  <div className="terminal-output">
                    {'require('}
                    <span className="terminal-key">'dotenv'</span>
                    {").config({ path: "}
                    <span className="terminal-key">'.env.local'</span>
                    {' });'}
                  </div>
                </>
            ) : (
                <>
                  <div className="terminal-comment"># ── Custom variables ──────────────────────────</div>
                  <div className="terminal-output">import os</div>
                  <div className="terminal-output">
                    {'api_key = os.environ['}
                    <span className="terminal-key">'MY_API_KEY'</span>
                    {']'}
                  </div>
                  <div className="terminal-output">
                    {'debug = os.environ.get('}
                    <span className="terminal-key">'DEBUG'</span>
                    {', '}
                    <span className="terminal-key">'false'</span>
                    {')'}
                  </div>
                  {databaseAttached && (
                      <>
                        <div style={{ height:'0.5rem' }} />
                        <div className="terminal-comment"># ── DB_* vars (auto-injected by platform) ─────</div>
                        <div className="terminal-output">{'conn = mysql.connector.connect('}</div>
                        <div className="terminal-output">
                          {'  host=os.environ['}
                          <span className="terminal-key">'DB_HOST'</span>
                          {'], port=int(os.environ['}
                          <span className="terminal-key">'DB_PORT'</span>
                          {']),'}
                        </div>
                        <div className="terminal-output">
                          {'  user=os.environ['}
                          <span className="terminal-key">'DB_USER'</span>
                          {'], password=os.environ['}
                          <span className="terminal-key">'DB_PASSWORD'</span>
                          {'],'}
                        </div>
                        <div className="terminal-output">
                          {'  database=os.environ['}
                          <span className="terminal-key">'DB_NAME'</span>
                          {']'}
                        </div>
                        <div className="terminal-output">)</div>
                      </>
                  )}
                  <div style={{ height:'0.5rem' }} />
                  <div className="terminal-comment"># ── Local dev ──────────────────────────────────</div>
                  <div className="terminal-output">from dotenv import load_dotenv</div>
                  <div className="terminal-output">
                    {'load_dotenv('}
                    <span className="terminal-key">'.env.local'</span>
                    {')'}
                  </div>
                </>
            )}
          </div>
        </div>
      </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ImportModal
// ─────────────────────────────────────────────────────────────────────────────
function ImportModal({ text, onTextChange, parsed, parseErrors, onPreview, onConfirm, onClose }) {
  return (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.65)', zIndex:1000,
        display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
        <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:6,
          width:'100%', maxWidth:560, maxHeight:'85vh', display:'flex', flexDirection:'column', boxShadow:'0 8px 48px rgba(0,0,0,0.4)' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0.85rem 1rem', borderBottom:'1px solid var(--border)' }}>
            <div>
              <div style={{ fontWeight:700, fontSize:'0.82rem', color:'var(--text-primary)' }}>Import from .env file</div>
              <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', marginTop:'0.15rem' }}>Paste your .env contents. Keys must be UPPER_SNAKE_CASE.</div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} style={{ padding:'0.3rem 0.5rem', fontSize:'1rem', lineHeight:1 }}>×</button>
          </div>
          <div style={{ padding:'0.85rem 1rem', overflowY:'auto', flex:1 }}>
            <div style={{ marginBottom:'0.6rem', padding:'0.55rem 0.7rem', background:'var(--bg-secondary)', border:'1px solid var(--border)',
              borderRadius:3, fontSize:'0.7rem', color:'var(--text-muted)', fontFamily:'monospace', lineHeight:1.7 }}>
              <div style={{ color:'var(--text-muted)', marginBottom:'0.25rem' }}># example .env</div>
              <div><span style={{ color:'#e8c94a' }}>API_KEY</span>=abc123</div>
              <div><span style={{ color:'#e8c94a' }}>STRIPE_SECRET</span>=sk_live_...</div>
              <div><span style={{ color:'#e8c94a' }}>ALLOWED_ORIGINS</span>=https://example.com</div>
              <div style={{ color:'var(--text-muted)', marginTop:'0.25rem' }}># DB_* keys are reserved and will be skipped</div>
            </div>
            <textarea className="input"
                      style={{ width:'100%', boxSizing:'border-box', fontFamily:'monospace', fontSize:'0.74rem', minHeight:140, resize:'vertical', lineHeight:1.6 }}
                      value={text} onChange={e => onTextChange(e.target.value)}
                      placeholder={"API_KEY=abc123\nSTRIPE_SECRET=sk_live_...\nNODE_ENV=production"}
                      autoComplete="off" spellCheck={false} />
            <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop:'0.5rem' }} onClick={onPreview} disabled={!text.trim()}>
              Preview {parsed.length > 0 ? `(${parsed.length} found)` : ''}
            </button>
            {parseErrors.length > 0 && <div style={{ marginTop:'0.6rem' }}>{parseErrors.map((e,i) => <div key={i} className="form-error" style={{ marginBottom:'0.2rem' }}>{e}</div>)}</div>}
            {parsed.length > 0 && (
                <div style={{ marginTop:'0.75rem' }}>
                  <div style={{ fontSize:'0.68rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:'0.4rem' }}>
                    Will import ({parseErrors.length > 0 ? 'valid rows only' : `${parsed.length} rows`}):
                  </div>
                  <div style={{ maxHeight:180, overflowY:'auto', border:'1px solid var(--border)', borderRadius:3 }}>
                    {parsed.map((r,i) => {
                      const err = validateRow(r.key, r.value);
                      return (
                          <div key={i} style={{ display:'flex', gap:'0.5rem', padding:'0.3rem 0.5rem',
                            borderBottom:'1px solid var(--border)', background: err ? 'rgba(239,68,68,0.04)' : 'var(--bg-secondary)',
                            fontSize:'0.72rem', fontFamily:'monospace', alignItems:'center' }}>
                            <span style={{ color: err ? 'var(--error)' : '#e8c94a', minWidth:120 }}>{r.key}</span>
                            <span style={{ color:'var(--text-muted)', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {r.value.length > 40 ? r.value.slice(0,40)+'…' : r.value}
                      </span>
                            {err && <span style={{ color:'var(--error)', fontSize:'0.66rem', whiteSpace:'nowrap' }}>{err}</span>}
                          </div>
                      );
                    })}
                  </div>
                </div>
            )}
          </div>
          <div style={{ display:'flex', gap:'0.5rem', justifyContent:'flex-end', padding:'0.75rem 1rem', borderTop:'1px solid var(--border)' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={onConfirm}
                    disabled={parsed.length === 0 || parsed.every(r => validateRow(r.key, r.value))}>
              Import {parsed.filter(r => !validateRow(r.key, r.value)).length} variable{parsed.filter(r => !validateRow(r.key, r.value)).length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DropZone
// ─────────────────────────────────────────────────────────────────────────────
function DropZone({ label, file, onFile, error }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const onFiles = (files) => {
    const f = files?.[0];
    if (!f) return;
    if (!/\.zip$/i.test(f.name)) { alert('Only .zip files accepted.'); return; }
    onFile(f);
  };
  return (
      <div>
        <label className="form-label">{label}</label>
        <div className={`dropzone ${drag ? 'drag' : ''} ${error ? 'error' : ''}`}
             onClick={() => inputRef.current?.click()}
             onDragOver={e => { e.preventDefault(); setDrag(true); }}
             onDragLeave={() => setDrag(false)}
             onDrop={e => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}>
          {file ? (
              <>
                <div className="mono" style={{ fontSize:'0.78rem', color:'var(--text-primary)', fontWeight:700 }}>📦 {file.name}</div>
                <div style={{ fontSize:'0.68rem', color:'var(--text-muted)', marginTop:'0.15rem' }}>{(file.size/1024/1024).toFixed(2)} MB · click to replace</div>
              </>
          ) : (
              <>
                <div style={{ fontSize:'0.82rem', fontWeight:700, color:'var(--text-primary)' }}>Drop .zip here or click to browse</div>
                <div style={{ fontSize:'0.66rem', color:'var(--text-muted)', marginTop:'0.2rem' }}>Max {MAX_ZIP_MB} MB</div>
              </>
          )}
          <input ref={inputRef} type="file" accept=".zip,application/zip,application/x-zip-compressed"
                 style={{ display:'none' }} onChange={e => onFiles(e.target.files)} />
        </div>
        {error && <div className="form-error" style={{ marginTop:'0.25rem' }}>{error}</div>}
      </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CLITutorial
// ─────────────────────────────────────────────────────────────────────────────
function CLITutorial({ projectType, sourceType, runtime, databaseAttached, databaseName, customEnvKeys }) {
  const hasEnvInfo = databaseAttached || customEnvKeys.length > 0;
  return (
      <div className="card">
        <div className="card-body">
          <SectionTitle accent="#27c93f">Preparation Guide</SectionTitle>
          <div className="terminal">
            <div className="terminal-titlebar">
              <span className="terminal-dot red" /><span className="terminal-dot yellow" /><span className="terminal-dot green" />
              <span className="terminal-title">prepare-{projectType||'project'}-{sourceType}.sh</span>
            </div>
            <div className="terminal-body">
              {renderGuide(projectType, sourceType, runtime)}
              {projectType && hasEnvInfo && (
                  <>
                    <div style={{ height:'0.8rem' }} />
                    <div style={{ borderTop:'1px dashed #2a2a2a', paddingTop:'0.6rem' }}>
                      <div className="terminal-comment"># ─── Environment variables your app will see ───</div>
                      <div style={{ height:'0.25rem' }} />
                      {databaseAttached && (
                          <>
                            <div className="terminal-comment"># Auto-injected by AcadHost (DB credentials):</div>
                            {['DB_HOST','DB_PORT','DB_USER','DB_PASSWORD','DB_NAME'].map(k => (
                                <div key={k} className="terminal-output">
                                  <span className="terminal-key">{k}</span>=<span style={{ opacity:0.6 }}>
                            {k==='DB_HOST'?'host.docker.internal':k==='DB_PORT'?'3306':k==='DB_NAME'&&databaseName?databaseName:'(set by platform)'}
                          </span>
                                </div>
                            ))}
                            <div style={{ height:'0.3rem' }} />
                          </>
                      )}
                      {customEnvKeys.length > 0 && (
                          <>
                            <div className="terminal-comment"># Your custom variables:</div>
                            {customEnvKeys.map(k => (
                                <div key={k} className="terminal-output">
                                  <span className="terminal-key">{k}</span>=<span style={{ opacity:0.6 }}>(your value)</span>
                                </div>
                            ))}
                            <div style={{ height:'0.3rem' }} />
                          </>
                      )}
                      <div className="terminal-comment"># How to use them:</div>
                      {runtime !== 'python' ? (
                          <>
                            {databaseAttached && <div className="terminal-output">{'const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = '}<span className="terminal-key">process.env</span>;</div>}
                            {customEnvKeys.length > 0 && <div className="terminal-output">{'const { '+customEnvKeys.join(', ')+' } = '}<span className="terminal-key">process.env</span>;</div>}
                          </>
                      ) : (
                          <>
                            <div className="terminal-output">import os</div>
                            {databaseAttached && (
                                <div className="terminal-output">
                                  {'db_host = os.environ['}
                                  <span className="terminal-key">'DB_HOST'</span>
                                  {']'}
                                </div>
                            )}
                            {customEnvKeys.slice(0,3).map(k => (
                                <div key={k} className="terminal-output">
                                  {k.toLowerCase()}
                                  {' = os.environ['}
                                  <span className="terminal-key">'{k}'</span>
                                  {']'}
                                </div>
                            ))}
                          </>
                      )}
                    </div>
                  </>
              )}
            </div>
          </div>
        </div>
      </div>
  );
}

function renderGuide(projectType, sourceType, runtime) {
  if (!projectType) return <span className="terminal-comment"># Select a project type above.</span>;
  const isGit = sourceType === 'git';
  const header = (
      <>
      <span className="terminal-comment">
        # Type: <span className="terminal-key">{projectType}</span>
        {projectType !== 'frontend' && <> · Runtime: <span className="terminal-key">{runtime}</span></>}
        {' '}· Source: <span className="terminal-key">{sourceType}</span>
      </span>
        <div style={{ height:'0.5rem' }} />
      </>
  );
  const structures = {
    frontend: ['my-project/', '├── index.html', '├── style.css', '├── script.js', '└── (assets)'],
    backend: runtime === 'python'
        ? ['my-project/', '├── main.py        # entry point', '├── requirements.txt', '└── (modules)']
        : ['my-project/', '├── package.json   # must have "start" script', '├── server.js', '└── (modules)'],
    combined: ['frontend/            backend/', `├── index.html       ├── ${runtime==='python'?'main.py':'server.js'}`,
      `├── style.css        ├── ${runtime==='python'?'requirements.txt':'package.json'}`, '└── script.js        └── (modules)'],
  };
  const portNotice = projectType !== 'frontend' && (
      <>
        <span className="terminal-comment"># ⚠ App MUST listen on port 8080</span>
        <div>{runtime === 'python'
            ? <span className="terminal-output">app.run(host=<span className="terminal-key">'0.0.0.0'</span>, port=<span className="terminal-key">8080</span>)</span>
            : <span className="terminal-output">app.listen(<span className="terminal-key">8080</span>, <span className="terminal-key">'0.0.0.0'</span>)</span>
        }</div>
        <div style={{ height:'0.5rem' }} />
      </>
  );
  if (isGit) {
    return (<>
      {header}
      <span className="terminal-comment"># Repo structure:</span>
      {structures[projectType].map((l,i) => <div key={i} className="terminal-output">{l}</div>)}
      <div style={{ height:'0.5rem' }} />
      {portNotice}
      <div><span className="terminal-prompt">$</span> git add . && git commit -m <span className="terminal-key">"deploy"</span></div>
      <div><span className="terminal-prompt">$</span> git push origin main</div>
      <div style={{ height:'0.35rem' }} />
      <span className="terminal-comment"># Paste the URL on the left → Deploy</span>
      <span className="terminal-comment"># Set up webhooks in Project Settings for auto-rebuild 🚀</span>
    </>);
  }
  return (<>
    {header}
    <span className="terminal-comment"># ZIP must contain files at its ROOT (no wrapping folder):</span>
    {structures[projectType].map((l,i) => <div key={i} className="terminal-output">{l}</div>)}
    <div style={{ height:'0.5rem' }} />
    {portNotice}
    <span className="terminal-comment"># Exclude node_modules, venv, build artifacts.</span>
    {runtime==='node'&&projectType!=='frontend'&&(<><span className="terminal-comment"># Generate package-lock.json first:</span><div><span className="terminal-prompt">$</span> npm install && rm -rf node_modules</div></>)}
    {runtime==='python'&&projectType!=='frontend'&&(<div><span className="terminal-prompt">$</span> pip freeze {'>'} requirements.txt</div>)}
    <div style={{ height:'0.35rem' }} />
    {projectType==='combined'?(<>
      <div><span className="terminal-prompt">$</span> cd frontend && zip -r ../frontend.zip . && cd ..</div>
      <div><span className="terminal-prompt">$</span> cd backend  && zip -r ../backend.zip  . && cd ..</div>
    </>):(<div><span className="terminal-prompt">$</span> zip -r my-project.zip .</div>)}
    <span className="terminal-comment"># Upload above → Deploy</span>
  </>);
}

// ─────────────────────────────────────────────────────────────────────────────
function SectionTitle({ children, accent = 'var(--accent)' }) {
  return (
      <div style={{ display:'flex', alignItems:'center', gap:'0.45rem', marginBottom:'0.6rem' }}>
        <span style={{ width:3, height:13, background:accent, display:'inline-block' }} />
        <span style={{ fontSize:'0.7rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--text-primary)' }}>
        {children}
      </span>
      </div>
  );
}

const CSS = `
  .pc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem; align-items: start; }
  .pc-col  { display: flex; flex-direction: column; gap: 0.85rem; min-width: 0; }
  @media (max-width: 1024px) { .pc-grid { grid-template-columns: 1fr; } }

  .pill { display:flex; flex-direction:column; align-items:flex-start; padding:0.6rem 0.7rem;
    border:1px solid var(--border); border-radius:2px; cursor:pointer;
    background:var(--bg-secondary); color:var(--text-primary); text-align:left;
    font-family:inherit; gap:0.15rem; }
  .pill:hover { border-color:var(--border-strong); }
  .pill-active { border-color:var(--accent) !important; background:var(--accent-soft); }
  .pill-label { font-weight:700; font-size:0.78rem; text-transform:uppercase; letter-spacing:0.04em; color:var(--text-primary); }
  .pill-desc  { font-size:0.66rem; color:var(--text-muted); }

  .dropzone { border:1.5px dashed var(--border); background:var(--bg-secondary); padding:0.9rem;
    text-align:center; cursor:pointer; border-radius:2px; }
  .dropzone:hover { border-color:var(--border-strong); }
  .dropzone.drag  { border-color:var(--accent); background:var(--accent-soft); }
  .dropzone.error { border-color:var(--error); }

  .terminal { background:#0a0a0a; border:1px solid #1e1e1e; border-radius:4px;
    overflow:hidden; font-family:'JetBrains Mono',monospace; font-size:0.7rem; color:#e8e6e0; }
  .terminal-titlebar { background:linear-gradient(180deg,#252525,#1a1a1a); padding:0.35rem 0.55rem;
    display:flex; align-items:center; gap:0.4rem; border-bottom:1px solid #141414; }
  .terminal-dot { width:9px; height:9px; border-radius:50%; display:inline-block; }
  .terminal-dot.red    { background:#ff5f56; }
  .terminal-dot.yellow { background:#ffbd2e; }
  .terminal-dot.green  { background:#27c93f; }
  .terminal-title { flex:1; text-align:center; font-size:0.64rem; color:#9a9488; letter-spacing:0.04em; }
  .terminal-body  { padding:0.65rem 0.75rem; max-height:520px; overflow:auto; line-height:1.65; }
  .terminal-prompt  { color:#4caf82; }
  .terminal-comment { color:#6a665e; }
  .terminal-output  { color:#a8a49c; }
  .terminal-key     { color:#e8c94a; }
`;