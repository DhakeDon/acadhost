import React, { useState, useEffect, useRef } from 'react';

/* ─── Phase durations (ms) ─────────────────────────────────────────
   0  CLI Loop             4500
   1  Professor Notif      2500
   2  Student Sends Localhost 3000
   3  Prof Can't Access    2500
   4  Morph → MacBook      2000
   5  Browser Launch       3000
   6  Dashboard            2500
   7  Project Create       4000
   8  Deploy Logs          4500
   9  Success State        3000
  10  Student Sends URL    3000
  11  Prof Opens Project   3000
  12  Final Reply A+       2500
  13  Reset Loop           2000
──────────────────────────────────────────────────────────────────── */
const DURATIONS = [4500,2500,3000,2500,2000,3000,2500,4000,4500,3000,3000,3000,2500,2000];

export default function TerminalAnimation() {
    const [phase, setPhase] = useState(0);
    const rootRef = useRef(null);

    /* Inject CSS once */
    useEffect(() => {
        const id = 'ta-anim-styles';
        if (document.getElementById(id)) return;
        const el = document.createElement('style');
        el.id = id; el.textContent = ANIM_CSS;
        document.head.appendChild(el);
        return () => document.getElementById(id)?.remove();
    }, []);

    /* Intersection reveal (hero is always in view, but keep for parity) */
    useEffect(() => {
        const node = rootRef.current;
        if (!node) return;
        const obs = new IntersectionObserver(([e]) => {
            if (e.isIntersecting) { node.classList.add('ah-visible'); obs.disconnect(); }
        }, { threshold: 0.05 });
        obs.observe(node);
        return () => obs.disconnect();
    }, []);

    /* Phase loop */
    useEffect(() => {
        const t = setTimeout(() => setPhase(p => (p + 1) % DURATIONS.length), DURATIONS[phase]);
        return () => clearTimeout(t);
    }, [phase]);

    const inTerminal = phase <= 3 || phase === 13;
    const inMacBook  = phase >= 4 && phase <= 12;

    return (
        <div ref={rootRef} className="ah-terminal ah-reveal ta-root">

            {/* ── Terminal layer (phases 0-3, 13) ── */}
            <div className={`ta-layer${inTerminal ? ' ta-show' : ' ta-hide'} ta-term-layer`}>
                <div className="ah-term-header">
                    <span className="ah-term-dot ah-red" />
                    <span className="ah-term-dot ah-yellow" />
                    <span className="ah-term-dot ah-green" />
                    <span className="ah-term-title">
            {phase === 13 ? 'reinitializing...' : 'acadhost-deploy.sh'}
          </span>
                </div>
                <div className="ah-term-body ta-term-body" style={{ position: 'relative' }}>
                    {phase === 0  && <CliView key="p0" />}
                    {phase === 1  && <CliWithNotif key="p1" />}
                    {phase === 2  && <WAChat phase={2} key="p2" />}
                    {phase === 3  && <WAChat phase={3} key="p3" />}
                    {phase === 13 && <ResetView key="p13" />}
                </div>
            </div>

            {/* ── MacBook layer (phases 4-12) ── */}
            <div className={`ta-layer${inMacBook ? ' ta-show' : ' ta-hide'} ta-mac-layer`}
                 style={{ position: 'absolute', inset: 0 }}>
                <MacBook phase={phase} key={`mac-${phase}`} />
            </div>

        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════
   TERMINAL LAYER VIEWS
═══════════════════════════════════════════════════════════════════ */

/* Phase 0 — CLI lines appear one by one */
function CliView() {
    const lines = [
        { delay: 0.1, p: true,  text: '$ npm run dev' },
        { delay: 0.6, p: false, text: '→ localhost:3000 running', cls: 't-green' },
        { delay: 1.1, p: false, text: '\u00a0' },
        { delay: 1.3, p: true,  text: '$ git push origin main' },
        { delay: 1.9, p: false, text: '→ AcadHost webhook triggered', cls: 't-b' },
        { delay: 2.4, p: false, text: '→ Pulling latest from main...', cls: 't-out' },
        { delay: 2.9, p: false, text: '→ npm install (38 packages)', cls: 't-out' },
        { delay: 3.3, p: false, text: '→ Running start script...', cls: 't-out' },
        { delay: 3.7, p: false, text: '\u00a0' },
        { delay: 3.8, p: false, text: '✓ Build successful', cls: 't-green' },
        { delay: 4.0, p: false, text: '✓ Container started (port 3000)', cls: 't-green' },
        { delay: 4.2, p: false, text: '⚡ my-app.acadhost.dev — LIVE', cls: 't-yellow' },
    ];
    return (
        <>
            {lines.map((l, i) => (
                <span key={i} className={`ah-t-line ta-fade-line${l.cls ? ' ' + l.cls : ''}`}
                      style={{ animationDelay: `${l.delay}s` }}>
          {l.p ? <><span className="t-p">$ </span><span className="t-c">{l.text.slice(2)}</span></> : l.text}
        </span>
            ))}
        </>
    );
}

/* Phase 1 — CLI + WhatsApp notification slide-in */
function CliWithNotif() {
    return (
        <>
            {/* Same CLI lines, already visible */}
            {[
                { cls: '',         text: <><span className="t-p">$ </span><span className="t-c">npm run dev</span></> },
                { cls: 't-green',  text: '→ localhost:3000 running' },
                { cls: '',         text: '\u00a0' },
                { cls: '',         text: <><span className="t-p">$ </span><span className="t-c">git push origin main</span></> },
                { cls: 't-b',      text: '→ AcadHost webhook triggered' },
                { cls: 't-out',    text: '→ Pulling latest from main...' },
                { cls: 't-out',    text: '→ npm install (38 packages)' },
                { cls: 't-green',  text: '✓ Build successful' },
                { cls: 't-yellow', text: '⚡ my-app.acadhost.dev — LIVE' },
            ].map((l, i) => (
                <span key={i} className={`ah-t-line ${l.cls}`}>{l.text}</span>
            ))}

            {/* WhatsApp notification */}
            <div className="ta-wa-notif">
                <div className="ta-wa-notif-icon">
                    <span style={{ color: '#25d366', fontSize: '1rem' }}>💬</span>
                </div>
                <div className="ta-wa-notif-body">
                    <div className="ta-wa-notif-header">
                        <span className="ta-wa-notif-app">WhatsApp</span>
                        <span className="ta-wa-notif-time">now</span>
                    </div>
                    <div className="ta-wa-notif-contact">Sir (Professor)</div>
                    <div className="ta-wa-notif-msg">"Send me your live project link."</div>
                </div>
            </div>
        </>
    );
}

/* Phases 2-3 — WhatsApp chat conversation */
function WAChat({ phase }) {
    const msgs2 = [
        { from: 'recv', text: 'Send me your live project link.', time: '10:14' },
        { from: 'sent', text: 'localhost:3000', time: '10:15', delay: 0.8 },
    ];
    const msgs3 = [
        { from: 'recv', text: 'Send me your live project link.', time: '10:14' },
        { from: 'sent', text: 'localhost:3000', time: '10:15' },
        { from: 'recv', text: "I can't access localhost.", time: '10:16', delay: 0.5 },
        { from: 'recv', text: 'Deploy it properly and send me a live link.', time: '10:16', delay: 1.0 },
    ];
    const msgs = phase === 2 ? msgs2 : msgs3;

    return (
        <div className="ta-wa-container">
            {/* Chat header */}
            <div className="ta-wa-header">
                <div className="ta-wa-avatar">S</div>
                <div>
                    <div className="ta-wa-name">Sir (Professor)</div>
                    <div className="ta-wa-status">online</div>
                </div>
                <div style={{ marginLeft: 'auto', color: '#25d366', fontSize: '0.7rem' }}>● online</div>
            </div>
            {/* Messages */}
            <div className="ta-wa-msgs">
                {msgs.map((m, i) => (
                    <div key={i} className={`ta-wa-bubble-wrap ${m.from}`}
                         style={{ animationDelay: `${m.delay || (i * 0.2)}s` }}>
                        <div className={`ta-wa-bubble ${m.from}`}>
                            <span className="ta-wa-text">{m.text}</span>
                            <span className="ta-wa-time">{m.time}</span>
                        </div>
                    </div>
                ))}
                {/* Typing indicator for phase 2 */}
                {phase === 2 && (
                    <div className="ta-wa-bubble-wrap sent" style={{ animationDelay: '0.3s' }}>
                        <div className="ta-wa-bubble sent ta-typing-indicator">
                            <span className="ta-dot" /><span className="ta-dot" /><span className="ta-dot" />
                        </div>
                    </div>
                )}
            </div>
            {/* Input bar */}
            <div className="ta-wa-input">
        <span className="ta-wa-placeholder">
          {phase === 2 ? 'localhost:3000' : ''}
        </span>
                <span className="ta-wa-send">➤</span>
            </div>
        </div>
    );
}

/* Phase 13 — reset / reinitializing */
function ResetView() {
    return (
        <>
      <span className="ah-t-line t-out ta-fade-line" style={{ animationDelay: '0.1s' }}>
        → returning to development environment...
      </span>
            <span className="ah-t-line t-green ta-fade-line" style={{ animationDelay: '0.6s' }}>
        ✓ session restored
      </span>
            <span className="ah-t-line ta-fade-line" style={{ animationDelay: '1.0s' }}>
        <span className="t-p">$ </span><span className="t-c ta-blink-cursor">npm run dev</span>
      </span>
        </>
    );
}

/* ═══════════════════════════════════════════════════════════════════
   MACBOOK FRAME + SCREEN VIEWS (phases 4-12)
═══════════════════════════════════════════════════════════════════ */

function MacBook({ phase }) {
    return (
        <div className="ta-mac-outer">
            {/* Notch */}
            <div className="ta-mac-topbar">
                <div className="ta-mac-cam" />
                <div style={{ flex: 1 }} />
                <div className="ta-mac-statusbar">
                    <span>◉</span><span>▲</span><span>⌚ 10:24</span>
                </div>
            </div>
            {/* Screen */}
            <div className="ta-mac-screen">
                {phase === 4  && <MorphLoadingView />}
                {phase === 5  && <BrowserView />}
                {phase === 6  && <DashboardView />}
                {phase === 7  && <ProjectCreateView />}
                {phase === 8  && <BuildLogsView />}
                {phase === 9  && <SuccessView />}
                {phase === 10 && <WAWebView phase={10} />}
                {phase === 11 && <ProjOpenView />}
                {phase === 12 && <WAWebView phase={12} />}
            </div>
        </div>
    );
}

/* Phase 4 — brief loading screen during morph */
function MorphLoadingView() {
    return (
        <div className="ta-screen-center" style={{ background: '#000' }}>
            <div className="ta-mac-spinner" />
            <div style={{ color: '#6a665e', fontSize: '0.6rem', marginTop: '0.75rem', fontFamily: 'JetBrains Mono, monospace' }}>
                initializing...
            </div>
        </div>
    );
}

/* Phase 5 — browser opens acadhost.dev */
function BrowserView() {
    return (
        <div className="ta-browser">
            {/* Browser chrome */}
            <div className="ta-browser-chrome">
                <div className="ta-browser-dots">
                    <span className="ta-bdot red" /><span className="ta-bdot yellow" /><span className="ta-bdot green" />
                </div>
                <div className="ta-url-bar">
                    <span className="ta-url-lock">🔒</span>
                    <span className="ta-url-text ta-type-url">acadhost.dev</span>
                    <span className="ta-url-cursor">|</span>
                </div>
                <div style={{ width: '48px' }} />
            </div>
            {/* Page content */}
            <div className="ta-browser-body">
                <div className="ta-site-header">
                    <span className="ta-site-logo">· AcadHost</span>
                    <div className="ta-site-nav">
                        <span>Features</span><span>Docs</span><span>Sign In</span>
                    </div>
                </div>
                <div className="ta-site-hero ta-fade-in" style={{ animationDelay: '1.2s' }}>
                    <div className="ta-site-badge">Student Developer Platform</div>
                    <div className="ta-site-title">Deploy Your Code.</div>
                    <div className="ta-site-sub">Own Your Stack.</div>
                    <div className="ta-site-cta">Sign In to Deploy →</div>
                </div>
            </div>
        </div>
    );
}

/* Phase 6 — AcadHost dashboard */
function DashboardView() {
    const metrics = [
        { icon: '⚡', label: 'CPU', val: '0.12', total: '4 cores', pct: 3 },
        { icon: '▣', label: 'RAM', val: '96', total: '2 GB', pct: 9 },
        { icon: '◉', label: 'Storage', val: '0.2', total: '5 GB', pct: 4 },
        { icon: '◈', label: 'Projects', val: '0', total: '3 max', pct: 0 },
        { icon: '⬡', label: 'Databases', val: '0', total: '2 max', pct: 0 },
    ];
    return (
        <div className="ta-dash">
            <div className="ta-dash-nav">
                <span className="ta-dash-logo">· AcadHost</span>
                <div className="ta-dash-navlinks">
                    <span className="active">Dashboard</span>
                    <span>Projects</span>
                    <span>Databases</span>
                </div>
            </div>
            <div className="ta-dash-content">
                <div className="ta-dash-title">Dashboard</div>
                <div className="ta-dash-metrics">
                    {metrics.map(m => (
                        <div key={m.label} className="ta-metric-card ta-fade-in" style={{ animationDelay: '0.3s' }}>
                            <div className="ta-metric-head"><span style={{ color: '#e8c94a' }}>{m.icon}</span> <span>{m.label}</span></div>
                            <div className="ta-metric-val">{m.val}</div>
                            <div className="ta-metric-of">{m.total}</div>
                            <div className="ta-metric-bar"><div className="ta-metric-fill" style={{ width: `${m.pct}%` }} /></div>
                        </div>
                    ))}
                </div>
                <div className="ta-dash-projheader">
                    <span style={{ color: '#e8e6e0', fontWeight: 700 }}>Your Projects</span>
                    <button className="ta-btn-new ta-pulse-btn">+ New Project</button>
                </div>
                <div className="ta-empty-state ta-fade-in" style={{ animationDelay: '0.8s' }}>
                    <div style={{ fontSize: '1.2rem', marginBottom: '0.4rem' }}>◈</div>
                    <div style={{ fontSize: '0.65rem', color: '#6a665e' }}>No projects yet</div>
                </div>
            </div>
        </div>
    );
}

/* Phase 7 — Project creation form */
function ProjectCreateView() {
    const steps = [
        { label: 'Project Type', content: (
                <div className="ta-type-pills">
                    <span className="ta-type-pill">Frontend</span>
                    <span className="ta-type-pill active">Backend</span>
                    <span className="ta-type-pill">Full-stack</span>
                </div>
            )},
        { label: 'GitHub Repo', content: (
                <div className="ta-input-row">
                    <div className="ta-mini-input ta-type-url-slow">https://github.com/student/my-api</div>
                </div>
            )},
        { label: 'Subdomain', content: (
                <div className="ta-input-row">
                    <div className="ta-mini-input" style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <span className="ta-type-url-slow">myproject</span>
                        <span style={{ color: '#6a665e' }}>.acadhost.dev</span>
                        <span className="ta-avail-badge">✓ available</span>
                    </div>
                </div>
            )},
        { label: 'Database', content: (
                <div className="ta-select-row">
                    <span className="ta-mini-select">PostgreSQL — my-db ✓</span>
                </div>
            )},
        { label: 'Env Variables', content: (
                <div className="ta-env-row">
                    <span className="ta-env-key">NODE_ENV</span>
                    <span className="ta-env-eq">=</span>
                    <span className="ta-env-val">production</span>
                </div>
            )},
    ];

    return (
        <div className="ta-create">
            <div className="ta-create-header">
                <span className="ta-create-title">New Project</span>
                <span style={{ color: '#6a665e', fontSize: '0.6rem' }}>Deploy to AcadHost</span>
            </div>
            <div className="ta-create-body">
                {steps.map((s, i) => (
                    <div key={i} className="ta-create-step ta-fade-in" style={{ animationDelay: `${0.2 + i * 0.55}s` }}>
                        <div className="ta-step-label">{s.label}</div>
                        <div className="ta-step-content">{s.content}</div>
                    </div>
                ))}
                <button className="ta-deploy-btn ta-fade-in" style={{ animationDelay: '3.2s' }}>
                    🚀 Deploy Project
                </button>
            </div>
        </div>
    );
}

/* Phase 8 — deployment build logs */
function BuildLogsView() {
    const logs = [
        { delay: 0.2,  sym: '→', cls: 't-out',   text: 'cloning repository' },
        { delay: 0.9,  sym: '→', cls: 't-out',   text: 'installing dependencies' },
        { delay: 1.7,  sym: '→', cls: 't-b',     text: 'building container' },
        { delay: 2.6,  sym: '→', cls: 't-out',   text: 'configuring environment' },
        { delay: 3.2,  sym: '→', cls: 't-out',   text: 'starting application on :3000' },
        { delay: 3.8,  sym: '→', cls: 't-out',   text: 'running health check...' },
        { delay: 4.1,  sym: '✓', cls: 't-green', text: 'deployment successful' },
    ];
    return (
        <div className="ta-logs-view">
            <div className="ta-logs-header">
                <span className="ah-term-dot ah-red" style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#e05c4a', display: 'inline-block' }} />
                <span className="ah-term-dot ah-yellow" style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#e8c94a', display: 'inline-block', margin: '0 4px' }} />
                <span className="ah-term-dot ah-green" style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4caf82', display: 'inline-block' }} />
                <span style={{ marginLeft: '8px', color: '#6a665e', fontSize: '0.6rem' }}>deploy-log.sh</span>
            </div>
            <div className="ta-logs-body">
                <div style={{ color: '#6a665e', marginBottom: '0.5rem', fontSize: '0.7rem' }}>» myproject · Node.js 20 · git push triggered</div>
                {logs.map((l, i) => (
                    <div key={i} className={`ta-log-line ta-fade-line ${l.cls}`}
                         style={{ animationDelay: `${l.delay}s` }}>
                        <span className={l.cls === 't-green' ? '' : 't-p'}>{l.sym} </span>{l.text}
                        {l.sym === '✓' && (
                            <span className="ta-success-badge">LIVE</span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

/* Phase 9 — success state */
function SuccessView() {
    return (
        <div className="ta-success-view">
            <div className="ta-success-badge-big ta-fade-in" style={{ animationDelay: '0.2s' }}>
                <span className="ta-running-dot" />
                RUNNING
            </div>
            <div className="ta-success-url ta-fade-in" style={{ animationDelay: '0.5s' }}>
                myproject.acadhost.dev
            </div>
            <div className="ta-copy-row ta-fade-in" style={{ animationDelay: '0.9s' }}>
                <span className="ta-copy-btn ta-copy-anim">⎘ Copy URL</span>
                <span className="ta-copied-flash">✓ Copied!</span>
            </div>
            <div className="ta-deploy-stats ta-fade-in" style={{ animationDelay: '1.3s' }}>
                <span>Deploy time: 18s</span>
                <span style={{ margin: '0 0.4rem', color: '#3a3630' }}>·</span>
                <span>CPU: 0.08</span>
                <span style={{ margin: '0 0.4rem', color: '#3a3630' }}>·</span>
                <span>RAM: 96 MB</span>
            </div>
            <div className="ta-success-info ta-fade-in" style={{ animationDelay: '1.6s' }}>
                <div className="ta-info-row">
                    <span className="ta-info-key">Runtime</span>
                    <span className="ta-info-val">Node.js 20</span>
                </div>
                <div className="ta-info-row">
                    <span className="ta-info-key">Region</span>
                    <span className="ta-info-val">in-mumbai-1</span>
                </div>
                <div className="ta-info-row">
                    <span className="ta-info-key">HTTPS</span>
                    <span className="ta-info-val" style={{ color: '#4caf82' }}>Enabled</span>
                </div>
            </div>
        </div>
    );
}

/* Phases 10 + 12 — WhatsApp Web in MacBook browser */
function WAWebView({ phase }) {
    const msgs10 = [
        { from: 'recv', text: "I can't access localhost.", time: '10:16' },
        { from: 'recv', text: 'Deploy it properly and send me a live link.', time: '10:16' },
        { from: 'sent', text: 'Done, Sir! Here is the deployed link:', time: '10:31', delay: 0.7 },
        { from: 'sent', text: '🔗 myproject.acadhost.dev', time: '10:31', delay: 1.2, highlight: true },
    ];
    const msgs12 = [
        { from: 'sent', text: '🔗 myproject.acadhost.dev', time: '10:31' },
        { from: 'recv', text: 'Good project 👍', time: '10:34', delay: 0.6 },
        { from: 'recv', text: 'A+ Grade ⭐', time: '10:34', delay: 1.2, grade: true },
    ];
    const msgs = phase === 10 ? msgs10 : msgs12;

    return (
        <div className="ta-browser">
            <div className="ta-browser-chrome">
                <div className="ta-browser-dots">
                    <span className="ta-bdot red" /><span className="ta-bdot yellow" /><span className="ta-bdot green" />
                </div>
                <div className="ta-url-bar">
                    <span className="ta-url-lock">🔒</span>
                    <span style={{ color: '#a8a49c', fontSize: '0.6rem' }}>web.whatsapp.com</span>
                </div>
                <div style={{ width: '48px' }} />
            </div>
            <div className="ta-wa-web">
                {/* Sidebar */}
                <div className="ta-wa-sidebar">
                    <div className="ta-wa-search">🔍 Search</div>
                    <div className="ta-wa-contact-item active">
                        <div className="ta-wa-avatar sm">S</div>
                        <div>
                            <div className="ta-wa-cname">Sir (Professor)</div>
                            <div className="ta-wa-clast" style={{ color: '#6a665e', fontSize: '0.55rem' }}>
                                {phase === 10 ? 'Done, Sir! Here...' : 'A+ Grade ⭐'}
                            </div>
                        </div>
                    </div>
                </div>
                {/* Chat area */}
                <div className="ta-wa-chat-area">
                    <div className="ta-wa-chat-header">
                        <div className="ta-wa-avatar sm">S</div>
                        <div>
                            <div className="ta-wa-cname">Sir (Professor)</div>
                            <div style={{ fontSize: '0.55rem', color: '#25d366' }}>online</div>
                        </div>
                    </div>
                    <div className="ta-wa-chat-msgs">
                        {msgs.map((m, i) => (
                            <div key={i} className={`ta-wa-bubble-wrap ${m.from} sm ta-fade-in`}
                                 style={{ animationDelay: `${m.delay || i * 0.15}s` }}>
                                <div className={`ta-wa-bubble ${m.from}${m.highlight ? ' highlight' : ''}${m.grade ? ' grade' : ''}`}>
                                    <span className="ta-wa-text sm">{m.text}</span>
                                    <span className="ta-wa-time">{m.time}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                    {phase === 10 && (
                        <div className="ta-wa-chat-input">
                            <span style={{ color: '#6a665e', fontSize: '0.6rem' }}>Type a message</span>
                            <span style={{ color: '#25d366' }}>➤</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

/* Phase 11 — professor's browser showing deployed project */
function ProjOpenView() {
    return (
        <div className="ta-browser">
            <div className="ta-browser-chrome">
                <div className="ta-browser-dots">
                    <span className="ta-bdot red" /><span className="ta-bdot yellow" /><span className="ta-bdot green" />
                </div>
                <div className="ta-url-bar">
                    <span className="ta-url-lock">🔒</span>
                    <span style={{ color: '#4caf82', fontSize: '0.6rem' }}>myproject.acadhost.dev</span>
                </div>
                <div style={{ width: '48px' }} />
            </div>
            <div className="ta-proj-page">
                <div className="ta-proj-nav">
                    <span style={{ color: '#e8c94a', fontWeight: 700 }}>● My API</span>
                    <span style={{ fontSize: '0.6rem', color: '#6a665e' }}>v1.0.0</span>
                </div>
                <div className="ta-proj-hero ta-fade-in" style={{ animationDelay: '0.4s' }}>
                    <div className="ta-proj-badge">
                        <span className="ta-running-dot" /> API RUNNING
                    </div>
                    <h3 style={{ color: '#e8e6e0', fontWeight: 700, fontSize: '0.9rem', margin: '0.5rem 0' }}>
                        Student Portfolio API
                    </h3>
                    <p style={{ color: '#a8a49c', fontSize: '0.65rem', margin: 0 }}>
                        Node.js · Express · PostgreSQL
                    </p>
                </div>
                <div className="ta-proj-endpoints ta-fade-in" style={{ animationDelay: '0.9s' }}>
                    {['/api/health', '/api/projects', '/api/users'].map(ep => (
                        <div key={ep} className="ta-endpoint">
                            <span className="ta-ep-method">GET</span>
                            <span className="ta-ep-path">{ep}</span>
                            <span className="ta-ep-status">200 OK</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════
   CSS
═══════════════════════════════════════════════════════════════════ */
const ANIM_CSS = `
/* ── Root container ── */
.ta-root {
  position: relative;
  min-height: 430px;
  overflow: hidden;
}

/* ── Layer system ── */
.ta-layer {
  transition: opacity 0.55s cubic-bezier(0.4, 0, 0.2, 1);
  width: 100%;
}
.ta-show { opacity: 1; pointer-events: auto; }
.ta-hide { opacity: 0; pointer-events: none; }
.ta-mac-layer.ta-show { transition-delay: 0.35s; }
.ta-term-layer.ta-show { transition-delay: 0.35s; }

/* ── Terminal body fill ── */
.ta-term-body { min-height: 350px; }

/* ── Fade-in line ── */
.ta-fade-line {
  opacity: 0;
  animation: taFadeUp 0.4s ease forwards;
}
@keyframes taFadeUp {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── Generic fade in ── */
.ta-fade-in {
  opacity: 0;
  animation: taFadeIn 0.5s ease forwards;
}
@keyframes taFadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── Blinking cursor ── */
.ta-blink-cursor::after {
  content: '█';
  animation: taBlink 0.8s step-end infinite;
  color: #e8c94a;
  margin-left: 2px;
}
@keyframes taBlink { 0%,100%{opacity:1} 50%{opacity:0} }

/* ─────────────────────────────────────────────────────────────────
   WHATSAPP NOTIFICATION (Phase 1)
───────────────────────────────────────────────────────────────── */
.ta-wa-notif {
  position: absolute;
  top: 0.75rem; right: 0.75rem;
  background: #1c1c1e;
  border: 1px solid #2e2e2e;
  border-radius: 10px;
  padding: 0.65rem 0.85rem;
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  max-width: 240px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  animation: taSlideDown 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  z-index: 10;
}
@keyframes taSlideDown {
  from { opacity: 0; transform: translateY(-20px) scale(0.95); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.ta-wa-notif-icon {
  width: 28px; height: 28px;
  background: #075e54;
  border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.ta-wa-notif-body { flex: 1; min-width: 0; }
.ta-wa-notif-header {
  display: flex; justify-content: space-between;
  margin-bottom: 0.15rem;
}
.ta-wa-notif-app {
  font-size: 0.6rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.08em;
  color: #25d366;
}
.ta-wa-notif-time { font-size: 0.58rem; color: #6a665e; }
.ta-wa-notif-contact {
  font-size: 0.65rem; font-weight: 700;
  color: #e8e6e0; margin-bottom: 0.1rem;
}
.ta-wa-notif-msg {
  font-size: 0.62rem; color: #a8a49c;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ─────────────────────────────────────────────────────────────────
   WHATSAPP CHAT (Phases 2-3)
───────────────────────────────────────────────────────────────── */
.ta-wa-container {
  display: flex; flex-direction: column; height: 350px;
  background: #0b141a; border-radius: 4px; overflow: hidden;
}
.ta-wa-header {
  background: #1f2c34; padding: 0.6rem 0.85rem;
  display: flex; align-items: center; gap: 0.6rem;
  border-bottom: 1px solid #1e1e1e;
}
.ta-wa-avatar {
  width: 30px; height: 30px; background: #075e54;
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  font-size: 0.75rem; font-weight: 700; color: #e8e6e0; flex-shrink: 0;
}
.ta-wa-avatar.sm { width: 24px; height: 24px; font-size: 0.6rem; }
.ta-wa-name { font-size: 0.7rem; font-weight: 700; color: #e8e6e0; }
.ta-wa-status { font-size: 0.58rem; color: #25d366; }
.ta-wa-msgs { flex: 1; padding: 0.75rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem; }
.ta-wa-bubble-wrap { display: flex; }
.ta-wa-bubble-wrap.recv { justify-content: flex-start; }
.ta-wa-bubble-wrap.sent { justify-content: flex-end; }
.ta-wa-bubble-wrap.ta-fade-in { opacity: 0; animation: taFadeIn 0.4s ease forwards; }
.ta-wa-bubble {
  max-width: 78%; padding: 0.5rem 0.65rem;
  border-radius: 8px; display: flex; flex-direction: column; gap: 0.2rem;
}
.ta-wa-bubble.recv { background: #1f2c34; border-top-left-radius: 2px; }
.ta-wa-bubble.sent { background: #005c4b; border-top-right-radius: 2px; }
.ta-wa-bubble.highlight { background: #006c59; border: 1px solid #25d366; }
.ta-wa-bubble.grade { background: #0a2a1c; border: 1px solid #4caf82; }
.ta-wa-text { font-size: 0.72rem; color: #e8e6e0; line-height: 1.5; }
.ta-wa-text.sm { font-size: 0.63rem; }
.ta-wa-time { font-size: 0.55rem; color: #6a665e; text-align: right; }
.ta-typing-indicator {
  display: flex; gap: 3px; align-items: center; padding: 0.5rem 0.75rem !important;
  flex-direction: row !important;
}
.ta-dot {
  width: 6px; height: 6px; background: #a8a49c; border-radius: 50%;
  animation: taDotBounce 1.2s infinite ease-in-out;
}
.ta-dot:nth-child(2) { animation-delay: 0.2s; }
.ta-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes taDotBounce {
  0%,60%,100% { transform: translateY(0); }
  30%         { transform: translateY(-5px); }
}
.ta-wa-input {
  background: #1f2c34; padding: 0.5rem 0.75rem;
  display: flex; justify-content: space-between; align-items: center;
  border-top: 1px solid #1e1e1e;
  font-size: 0.65rem; color: #a8a49c;
}
.ta-wa-send { color: #25d366; cursor: pointer; }
.ta-wa-placeholder { color: #e8c94a; }

/* ─────────────────────────────────────────────────────────────────
   MACBOOK FRAME
───────────────────────────────────────────────────────────────── */
.ta-mac-outer {
  background: #1c1c1e;
  border-radius: 12px;
  padding: 6px 8px 8px;
  height: 100%;
  display: flex; flex-direction: column;
  box-shadow: 0 0 0 1px #3a3a3c, 0 0 0 2px #0a0a0a;
}
.ta-mac-topbar {
  display: flex; align-items: center;
  padding: 0 4px 4px; gap: 4px;
}
.ta-mac-cam {
  width: 7px; height: 7px; background: #2a2a2c;
  border-radius: 50%; margin: 0 auto;
}
.ta-mac-statusbar {
  display: flex; align-items: center; gap: 6px;
  font-size: 0.52rem; color: #6a665e;
  font-family: 'JetBrains Mono', monospace;
}
.ta-mac-screen {
  flex: 1; background: #000; border-radius: 6px;
  overflow: hidden; position: relative; min-height: 0;
}

/* ── Loading spinner ── */
.ta-screen-center {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
}
.ta-mac-spinner {
  width: 20px; height: 20px;
  border: 2px solid #1e1e1e;
  border-top-color: #e8c94a;
  border-radius: 50%;
  animation: taSpin 0.8s linear infinite;
}
@keyframes taSpin { to { transform: rotate(360deg); } }

/* ─────────────────────────────────────────────────────────────────
   BROWSER CHROME
───────────────────────────────────────────────────────────────── */
.ta-browser { display: flex; flex-direction: column; height: 100%; }
.ta-browser-chrome {
  background: #1c1c1e; padding: 0.4rem 0.6rem;
  display: flex; align-items: center; gap: 0.5rem;
  border-bottom: 1px solid #2e2e2e; flex-shrink: 0;
}
.ta-browser-dots { display: flex; gap: 4px; }
.ta-bdot {
  width: 8px; height: 8px; border-radius: 50%;
}
.ta-bdot.red    { background: #e05c4a; }
.ta-bdot.yellow { background: #e8c94a; }
.ta-bdot.green  { background: #4caf82; }
.ta-url-bar {
  flex: 1; background: #111; border-radius: 4px;
  padding: 0.2rem 0.5rem; display: flex; align-items: center; gap: 0.3rem;
  font-size: 0.6rem; font-family: 'JetBrains Mono', monospace;
  color: #a8a49c;
}
.ta-url-lock { font-size: 0.5rem; }
.ta-url-text {
  color: #e8e6e0; overflow: hidden; white-space: nowrap;
  animation: taTypeUrl 1.2s steps(12, end) 0.4s both;
  max-width: 0;
}
@keyframes taTypeUrl { from { max-width: 0; } to { max-width: 200px; } }
.ta-url-cursor {
  color: #e8c94a;
  animation: taBlink 0.8s step-end infinite;
}
.ta-browser-body { flex: 1; overflow: hidden; }

/* AcadHost landing (Phase 5) */
.ta-site-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 0.5rem 0.8rem; background: rgba(0,0,0,0.9);
  border-bottom: 1px solid #1e1e1e;
}
.ta-site-logo { color: #e8e6e0; font-size: 0.65rem; font-weight: 700; }
.ta-site-nav { display: flex; gap: 0.8rem; font-size: 0.55rem; color: #6a665e; }
.ta-site-hero {
  padding: 1.5rem 1rem; text-align: center;
  opacity: 0; animation: taFadeIn 0.6s ease 1.2s forwards;
}
.ta-site-badge {
  display: inline-block; background: #1a1608; border: 1px solid #e8c94a;
  color: #e8c94a; font-size: 0.55rem; padding: 0.2rem 0.5rem;
  letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 0.6rem;
}
.ta-site-title { color: #e8e6e0; font-size: 1.1rem; font-weight: 800; text-transform: uppercase; }
.ta-site-sub   { color: #6a665e; font-size: 0.85rem; font-weight: 700; text-transform: uppercase; margin-top: 0.2rem; }
.ta-site-cta   {
  display: inline-block; background: #e8c94a; color: #000;
  font-size: 0.62rem; font-weight: 700; padding: 0.4rem 1rem;
  margin-top: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em;
}

/* ─────────────────────────────────────────────────────────────────
   DASHBOARD (Phase 6)
───────────────────────────────────────────────────────────────── */
.ta-dash { display: flex; flex-direction: column; height: 100%; background: #000; }
.ta-dash-nav {
  background: #0a0a0a; border-bottom: 1px solid #1e1e1e;
  padding: 0.4rem 0.75rem; display: flex; align-items: center; gap: 1rem;
}
.ta-dash-logo { color: #e8e6e0; font-size: 0.65rem; font-weight: 700; flex-shrink: 0; }
.ta-dash-navlinks { display: flex; gap: 0.75rem; font-size: 0.6rem; color: #6a665e; }
.ta-dash-navlinks .active { color: #e8c94a; }
.ta-dash-content { flex: 1; padding: 0.65rem 0.75rem; overflow: hidden; }
.ta-dash-title { color: #e8e6e0; font-size: 0.75rem; font-weight: 700; margin-bottom: 0.5rem; }
.ta-dash-metrics { display: flex; gap: 0.4rem; margin-bottom: 0.65rem; }
.ta-metric-card {
  flex: 1; background: #0a0a0a; border: 1px solid #1e1e1e;
  padding: 0.4rem 0.35rem; min-width: 0;
}
.ta-metric-head { font-size: 0.52rem; color: #6a665e; display: flex; align-items: center; gap: 0.2rem; margin-bottom: 0.2rem; }
.ta-metric-val  { font-size: 0.85rem; font-weight: 700; color: #e8e6e0; line-height: 1; }
.ta-metric-of   { font-size: 0.5rem; color: #6a665e; }
.ta-metric-bar  { height: 2px; background: #1e1e1e; margin-top: 0.3rem; }
.ta-metric-fill { height: 100%; background: #e8c94a; transition: width 0.8s ease; }
.ta-dash-projheader {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 0.5rem;
}
.ta-btn-new {
  background: #e8c94a; color: #000; border: none; cursor: pointer;
  font-family: 'JetBrains Mono', monospace; font-size: 0.58rem; font-weight: 700;
  padding: 0.3rem 0.65rem; text-transform: uppercase;
}
.ta-pulse-btn { animation: taPulse 1.2s ease-in-out infinite; }
@keyframes taPulse {
  0%,100% { box-shadow: 0 0 0 0 rgba(232,201,74,0.4); }
  50%     { box-shadow: 0 0 0 6px rgba(232,201,74,0); }
}
.ta-empty-state { text-align: center; padding: 1rem; color: #6a665e; }

/* ─────────────────────────────────────────────────────────────────
   PROJECT CREATE (Phase 7)
───────────────────────────────────────────────────────────────── */
.ta-create { display: flex; flex-direction: column; height: 100%; background: #000; }
.ta-create-header {
  background: #0a0a0a; border-bottom: 1px solid #1e1e1e;
  padding: 0.5rem 0.75rem; display: flex; justify-content: space-between; align-items: center;
}
.ta-create-title { color: #e8e6e0; font-size: 0.72rem; font-weight: 700; }
.ta-create-body { flex: 1; padding: 0.65rem 0.75rem; overflow: hidden; display: flex; flex-direction: column; gap: 0.45rem; }
.ta-create-step {
  opacity: 0;
  animation: taFadeIn 0.45s ease forwards;
}
.ta-step-label {
  font-size: 0.55rem; font-weight: 700; letter-spacing: 0.1em;
  text-transform: uppercase; color: #e8c94a; margin-bottom: 0.2rem;
}
.ta-step-content {}
.ta-type-pills { display: flex; gap: 0.35rem; }
.ta-type-pill {
  background: #0a0a0a; border: 1px solid #2e2e2e;
  color: #6a665e; font-size: 0.6rem; padding: 0.25rem 0.6rem;
  font-family: 'JetBrains Mono', monospace;
}
.ta-type-pill.active { background: #1a1608; border-color: #e8c94a; color: #e8c94a; }
.ta-mini-input {
  background: #0a0a0a; border: 1px solid #2e2e2e;
  color: #e8e6e0; font-size: 0.62rem; padding: 0.28rem 0.5rem;
  font-family: 'JetBrains Mono', monospace;
  overflow: hidden; white-space: nowrap;
}
.ta-type-url-slow {
  overflow: hidden; white-space: nowrap;
  display: inline-block;
  animation: taTypeUrl 1.5s steps(40, end) 0.2s both;
}
.ta-avail-badge {
  background: rgba(76,175,130,0.15); border: 1px solid #4caf82;
  color: #4caf82; font-size: 0.5rem; padding: 0.1rem 0.3rem;
  margin-left: 0.4rem;
}
.ta-mini-select {
  background: #0a0a0a; border: 1px solid #2e2e2e;
  color: #4caf82; font-size: 0.62rem; padding: 0.28rem 0.5rem;
  font-family: 'JetBrains Mono', monospace; display: inline-block;
}
.ta-env-row { display: flex; align-items: center; gap: 0.35rem; font-size: 0.62rem; }
.ta-env-key { color: #6ab4f0; }
.ta-env-eq  { color: #6a665e; }
.ta-env-val { color: #4caf82; }
.ta-deploy-btn {
  opacity: 0; animation: taFadeIn 0.5s ease forwards;
  background: #e8c94a; color: #000; border: none; cursor: pointer;
  font-family: 'JetBrains Mono', monospace; font-size: 0.68rem; font-weight: 700;
  padding: 0.5rem 1rem; text-transform: uppercase; letter-spacing: 0.08em;
  align-self: flex-start; margin-top: auto;
}

/* ─────────────────────────────────────────────────────────────────
   BUILD LOGS (Phase 8)
───────────────────────────────────────────────────────────────── */
.ta-logs-view { display: flex; flex-direction: column; height: 100%; background: #000; }
.ta-logs-header {
  background: #0a0a0a; border-bottom: 1px solid #1e1e1e;
  padding: 0.45rem 0.75rem; display: flex; align-items: center;
}
.ta-logs-body { flex: 1; padding: 0.75rem; font-family: 'JetBrains Mono', monospace; }
.ta-log-line {
  display: block; font-size: 0.7rem; margin-bottom: 0.35rem;
  opacity: 0; animation: taFadeUp 0.35s ease forwards;
  font-family: 'JetBrains Mono', monospace;
}
.ta-success-badge {
  display: inline-block; background: rgba(76,175,130,0.15);
  border: 1px solid #4caf82; color: #4caf82; font-size: 0.5rem;
  padding: 0.1rem 0.4rem; margin-left: 0.5rem;
  animation: taPulse 1.5s ease-in-out infinite;
}

/* ─────────────────────────────────────────────────────────────────
   SUCCESS (Phase 9)
───────────────────────────────────────────────────────────────── */
.ta-success-view {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 100%; background: #000; padding: 1rem; gap: 0.6rem;
}
.ta-success-badge-big {
  display: flex; align-items: center; gap: 0.4rem;
  background: rgba(76,175,130,0.15); border: 1px solid #4caf82;
  color: #4caf82; font-size: 0.65rem; font-weight: 700;
  padding: 0.3rem 0.75rem; letter-spacing: 0.12em;
}
.ta-running-dot {
  width: 6px; height: 6px; background: #4caf82; border-radius: 50%;
  display: inline-block; animation: taPulse 1.2s ease-in-out infinite;
}
.ta-success-url {
  color: #e8c94a; font-size: 0.9rem; font-weight: 700;
  letter-spacing: 0.02em;
}
.ta-copy-row { display: flex; align-items: center; gap: 0.75rem; }
.ta-copy-btn {
  background: #0a0a0a; border: 1px solid #2e2e2e;
  color: #a8a49c; font-size: 0.62rem; padding: 0.3rem 0.65rem;
  cursor: pointer; font-family: 'JetBrains Mono', monospace;
}
.ta-copy-anim { animation: taCopyFlash 0.6s ease 1.5s forwards; }
@keyframes taCopyFlash {
  0%   { background: #0a0a0a; color: #a8a49c; border-color: #2e2e2e; }
  50%  { background: rgba(76,175,130,0.2); color: #4caf82; border-color: #4caf82; }
  100% { background: rgba(76,175,130,0.15); color: #4caf82; border-color: #4caf82; }
}
.ta-copied-flash {
  color: #4caf82; font-size: 0.62rem; opacity: 0;
  animation: taFadeIn 0.4s ease 1.8s forwards;
}
.ta-deploy-stats { font-size: 0.6rem; color: #6a665e; }
.ta-success-info { width: 100%; max-width: 220px; }
.ta-info-row { display: flex; justify-content: space-between; padding: 0.2rem 0; border-bottom: 1px solid #111; }
.ta-info-key { font-size: 0.58rem; color: #6a665e; }
.ta-info-val { font-size: 0.58rem; color: #a8a49c; }

/* ─────────────────────────────────────────────────────────────────
   WHATSAPP WEB (Phases 10, 12)
───────────────────────────────────────────────────────────────── */
.ta-wa-web { display: flex; flex: 1; overflow: hidden; }
.ta-wa-sidebar {
  width: 35%; background: #111820; border-right: 1px solid #1e1e1e;
  display: flex; flex-direction: column;
}
.ta-wa-search {
  padding: 0.4rem 0.5rem; background: #1f2c34;
  font-size: 0.58rem; color: #6a665e; border-bottom: 1px solid #1e1e1e;
}
.ta-wa-contact-item {
  padding: 0.5rem 0.6rem; display: flex; align-items: center; gap: 0.4rem;
  font-size: 0.62rem;
}
.ta-wa-contact-item.active { background: #1f2c34; }
.ta-wa-cname { color: #e8e6e0; font-weight: 600; }
.ta-wa-chat-area { flex: 1; display: flex; flex-direction: column; background: #0b141a; }
.ta-wa-chat-header {
  background: #1f2c34; padding: 0.4rem 0.6rem;
  display: flex; align-items: center; gap: 0.4rem;
  border-bottom: 1px solid #1e1e1e; flex-shrink: 0;
}
.ta-wa-chat-msgs {
  flex: 1; padding: 0.5rem; overflow-y: auto;
  display: flex; flex-direction: column; gap: 0.35rem;
}
.ta-wa-bubble-wrap.sm { }
.ta-wa-bubble-wrap.sm .ta-wa-bubble { max-width: 85%; }
.ta-wa-chat-input {
  background: #1f2c34; padding: 0.35rem 0.6rem;
  display: flex; justify-content: space-between; align-items: center;
  border-top: 1px solid #1e1e1e; font-size: 0.6rem; color: #6a665e;
}

/* ─────────────────────────────────────────────────────────────────
   PROFESSOR'S PROJECT PAGE (Phase 11)
───────────────────────────────────────────────────────────────── */
.ta-proj-page { background: #000; height: 100%; display: flex; flex-direction: column; }
.ta-proj-nav {
  background: #0a0a0a; border-bottom: 1px solid #1e1e1e;
  padding: 0.4rem 0.75rem; display: flex; align-items: center; justify-content: space-between;
}
.ta-proj-hero { padding: 1.5rem 0.75rem; text-align: center; }
.ta-proj-badge {
  display: inline-flex; align-items: center; gap: 0.4rem;
  background: rgba(76,175,130,0.12); border: 1px solid #4caf82;
  color: #4caf82; font-size: 0.58rem; padding: 0.25rem 0.65rem;
  margin-bottom: 0.5rem; letter-spacing: 0.1em; text-transform: uppercase;
}
.ta-proj-endpoints { padding: 0 0.75rem; display: flex; flex-direction: column; gap: 0.3rem; }
.ta-endpoint {
  display: flex; align-items: center; gap: 0.5rem;
  background: #0a0a0a; border: 1px solid #1e1e1e;
  padding: 0.3rem 0.6rem;
}
.ta-ep-method {
  background: rgba(106,180,240,0.15); border: 1px solid #6ab4f0;
  color: #6ab4f0; font-size: 0.55rem; padding: 0.1rem 0.3rem;
  font-weight: 700;
}
.ta-ep-path  { flex: 1; color: #e8e6e0; font-size: 0.62rem; }
.ta-ep-status { color: #4caf82; font-size: 0.58rem; }
`;