import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import "@fontsource/jetbrains-mono";
/* ─── DATA ──────────────────────────────────────────────────────── */
const FEATURES = [
  { icon: '⚡', title: 'Auto-Deploy on Push', desc: 'Push to GitHub, watch your app rebuild and restart automatically. No manual SSH. No FTP.', tag: 'Git Webhooks' },
  { icon: '◉', title: 'Multi-Runtime Support', desc: 'Node.js 18/20, Python 3.10/3.12, Static sites. Frontend, backend, or full-stack — all covered.', tag: 'Node · Python · HTML' },
  { icon: '⬡', title: 'Managed Databases', desc: 'Spin up a PostgreSQL or MySQL instance with one click. Attach it to your project. That\'s it.', tag: 'PostgreSQL · MySQL' },
  { icon: '▣', title: 'Resource Dashboard', desc: 'CPU, RAM, and storage gauges update in real time. Know exactly what your app is consuming.', tag: 'Live Metrics' },
  { icon: '◈', title: 'Custom Subdomains', desc: 'Every project gets a *.acadhost.dev subdomain. Share with your professor, add it to your CV.', tag: 'HTTPS Included' },
  { icon: '☰', title: 'Build Logs & Alerts', desc: 'Full stdout/stderr streaming during builds. Know exactly why your deploy failed — and fix it.', tag: 'Real-time Logs' },
];

const STEPS = [
  { num: '01', title: 'Create a Project', desc: 'Choose Frontend, Backend, or Full-Stack. Select your runtime and version. Name your subdomain.' },
  { num: '02', title: 'Connect Your Repo', desc: 'Paste your GitHub repo URL or upload a ZIP. AcadHost reads your package.json or requirements.txt.' },
  { num: '03', title: 'Click Deploy', desc: 'We build your container, install deps, run your start script, and route traffic automatically.' },
  { num: '04', title: 'It\'s Live', desc: 'Your app is running at your-project.acadhost.dev with HTTPS. Share the link, it just works.' },
];

const RESOURCES = [
  { num: '4', unit: 'CPU', label: 'Cores Total', pct: '80%' },
  { num: '2', unit: 'GB', label: 'RAM Quota', pct: '65%' },
  { num: '5', unit: 'GB', label: 'Storage', pct: '50%' },
  { num: '3', unit: 'Proj', label: 'Max Projects', pct: '60%' },
  { num: '2', unit: 'DB', label: 'Databases', pct: '40%' },
];

const STACKS = [
  { label: 'Node.js 20', active: true },
  { label: 'Node.js 18', active: true },
  { label: 'Python 3.12', active: true },
  { label: 'Python 3.10', active: true },
  { label: 'Static HTML', active: true },
  { label: 'React (Vite)', active: false },
  { label: 'Vue 3', active: false },
  { label: 'Express.js', active: false },
  { label: 'FastAPI', active: false },
  { label: 'Flask', active: false },
  { label: 'PostgreSQL', active: false },
  { label: 'MySQL', active: false },
];

const TYPED_PHRASES = [
  'express-api.acadhost.dev',
  'ml-project.acadhost.dev',
  'portfolio.acadhost.dev',
  'flask-app.acadhost.dev',
  'react-todo.acadhost.dev',
];

/* ─── PHASE TIMING (ms) ─────────────────────────────────────────── */
const PHASE_DURATIONS = [
  4500, // 0  CLI Loop
  2500, // 1  Professor Notification
  3000, // 2  Student shares localhost
  2500, // 3  Professor reply
  2000, // 4  CLI Morph → MacBook
  3000, // 5  Browser Launch
  2500, // 6  Dashboard
  4000, // 7  Project Creation
  4500, // 8  Deployment Logs
  3000, // 9  Success state
  3000, // 10 Back to messages
  3000, // 11 Professor opens project
  2500, // 12 Final reply
  2000, // 13 Reset
];

/* ─── ANIMATED TERMINAL ─────────────────────────────────────────── */
function AnimatedHeroTerminal() {
  const [phase, setPhase] = useState(0);
  const [tick, setTick] = useState(0);

  // Advance phases
  useEffect(() => {
    const t = setTimeout(() => {
      setPhase(p => (p + 1) % PHASE_DURATIONS.length);
      setTick(0);
    }, PHASE_DURATIONS[phase]);
    return () => clearTimeout(t);
  }, [phase]);

  // Intra-phase tick for staggered reveals
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 120);
    return () => clearInterval(id);
  }, [phase]);

  // Phase 4 → 10 show the laptop bezel (after morph)
  const showLaptop = phase >= 4 && phase <= 11;
  // Phases 0-3 and 12-13 show the CLI terminal frame
  const showTerminal = phase <= 3 || phase >= 12;

  // Message overlay visible during 1–3, 10–12
  const showMessages =
      (phase >= 1 && phase <= 3) || (phase >= 10 && phase <= 12);

  return (
      <div className="ah-reveal ah-stage-wrap">
        {/* Terminal frame (Phases 0-3, 12-13) */}
        <div
            className={`ah-terminal ah-stage ${showTerminal ? 'is-on' : 'is-off'} ${phase === 4 ? 'is-morph' : ''}`}
        >
          <div className="ah-term-header">
            <span className="ah-term-dot ah-red" />
            <span className="ah-term-dot ah-yellow" />
            <span className="ah-term-dot ah-green" />
            <span className="ah-term-title">
            {phase >= 12 ? 'acadhost-deploy.sh' : 'zsh — student@mbp'}
          </span>
          </div>
          <div className="ah-term-body ah-term-body-anim">
            <CliLoop phase={phase} tick={tick} />
          </div>
        </div>

        {/* Laptop / browser stage (Phases 4-11) */}
        <div className={`ah-laptop ah-stage ${showLaptop ? 'is-on' : 'is-off'}`}>
          <div className="ah-laptop-bezel">
            <div className="ah-laptop-notch" />
            <div className="ah-laptop-screen">
              <LaptopContent phase={phase} tick={tick} />
            </div>
          </div>
          <div className="ah-laptop-base" />
        </div>

        {/* Floating message bubbles (overlay on both stages) */}
        {showMessages && <MessagesOverlay phase={phase} tick={tick} />}

        {/* Phase indicator strip */}
        <div className="ah-phase-strip">
          {PHASE_DURATIONS.map((_, i) => (
              <span key={i} className={`ah-phase-dot ${i === phase ? 'on' : ''}`} />
          ))}
        </div>
      </div>
  );
}

/* ── Terminal inner content based on phase ── */
function CliLoop({ phase, tick }) {
  // Base loop lines for Phase 0 and Phase 13 (reset)
  const baseLines = [
    { cls: '',        text: <><span className="t-p">$ </span><span className="t-c">npm run dev</span></> },
    { cls: 't-out',   text: '→ vite v5.0.0 dev server' },
    { cls: 't-green', text: '→ localhost:3000 running' },
    { cls: '',        text: '\u00a0' },
    { cls: '',        text: <><span className="t-p">$ </span><span className="t-c">git push origin main</span></> },
    { cls: 't-out',   text: '→ webhook triggered' },
    { cls: 't-out',   text: '→ streaming deployment logs' },
    { cls: 't-out',   text: '→ build queued · waiting...' },
  ];

  // Phase 2: student copies localhost + pastes
  const phase2Lines = [
    { cls: '',        text: <><span className="t-p">$ </span><span className="t-c">pbcopy &lt;&lt;&lt; "localhost:3000"</span></> },
    { cls: 't-out',   text: '→ copied to clipboard' },
    { cls: '',        text: '\u00a0' },
    { cls: 't-yellow',text: '// sending localhost:3000 to prof...' },
  ];

  // Phase 12/13 handled via baseLines
  let lines = baseLines;
  if (phase === 2) lines = phase2Lines;

  // Stagger reveal: one line per ~280ms
  const visibleCount = Math.min(lines.length, Math.floor((tick * 120) / 280) + 1);

  return (
      <>
        {lines.slice(0, visibleCount).map((l, i) => (
            <span key={i} className={`ah-t-line ${l.cls} ah-fadein`}>{l.text}</span>
        ))}
        <span className="ah-term-caret">▋</span>
      </>
  );
}

/* ── Laptop screen content by phase ── */
function LaptopContent({ phase, tick }) {
  // Phase 5: browser launch & typing
  if (phase === 5) {
    const target = 'acadhost.dev';
    const typed = target.slice(0, Math.min(target.length, Math.floor(tick * 120 / 80)));
    const done = typed === target && tick * 120 > 2000;
    return (
        <BrowserChrome url={typed + (done ? '' : '')}>
          {done ? (
              <div className="ah-mini-landing">
                <div className="ah-mini-logo">· ACADHOST</div>
                <div className="ah-mini-hero">Deploy Your Code.</div>
                <div className="ah-mini-sub">Student Developer Platform</div>
                <div className="ah-mini-cta">Sign In →</div>
              </div>
          ) : (
              <div className="ah-browser-loading">
                <div className="ah-loader-bar" />
              </div>
          )}
        </BrowserChrome>
    );
  }

  // Phase 6: dashboard
  if (phase === 6) {
    return (
        <BrowserChrome url="acadhost.dev/dashboard">
          <div className="ah-dash">
            <div className="ah-dash-top">
              <div className="ah-dash-title">Projects</div>
              <div className={`ah-dash-new ${tick > 12 ? 'is-press' : ''}`}>+ New Project</div>
            </div>
            <div className="ah-dash-metrics">
              <div className="ah-dash-metric"><b>4</b><span>CPU</span></div>
              <div className="ah-dash-metric"><b>2GB</b><span>RAM</span></div>
              <div className="ah-dash-metric"><b>5GB</b><span>Storage</span></div>
              <div className="ah-dash-metric"><b>3</b><span>Projects</span></div>
            </div>
            <div className="ah-dash-list">
              <div className="ah-dash-row"><span className="ah-dot-g" /> portfolio<span className="ah-dash-tag">live</span></div>
              <div className="ah-dash-row"><span className="ah-dot-g" /> ml-project<span className="ah-dash-tag">live</span></div>
              <div className="ah-dash-row"><span className="ah-dot-d" /> react-todo<span className="ah-dash-tag off">idle</span></div>
            </div>
          </div>
        </BrowserChrome>
    );
  }

  // Phase 7: Project creation form
  if (phase === 7) {
    const step = Math.min(5, Math.floor(tick * 120 / 650));
    return (
        <BrowserChrome url="acadhost.dev/new">
          <div className="ah-form">
            <div className="ah-form-title">Create Project</div>
            <Field label="Type" value="Full-Stack" filled={step >= 0} />
            <Field label="Repo" value="github.com/student/myproject" filled={step >= 1} />
            <Field label="Subdomain" value="myproject.acadhost.dev" filled={step >= 2} />
            <Field label="Database" value="PostgreSQL 15" filled={step >= 3} />
            <Field label="Env Vars" value="DATABASE_URL · API_KEY · JWT_SECRET" filled={step >= 4} mono />
            <div className={`ah-form-deploy ${step >= 5 ? 'is-press' : ''}`}>Deploy →</div>
          </div>
        </BrowserChrome>
    );
  }

  // Phase 8: Deployment logs
  if (phase === 8) {
    const logs = [
      '→ cloning repository',
      '→ installing dependencies',
      '→ building container',
      '→ starting application',
      '✓ deployment successful',
    ];
    const n = Math.min(logs.length, Math.floor(tick * 120 / 700));
    return (
        <BrowserChrome url="acadhost.dev/deploy/myproject">
          <div className="ah-deploy-logs">
            <div className="ah-deploy-title">Deploying <span>myproject</span></div>
            <div className="ah-deploy-body">
              {logs.slice(0, n).map((l, i) => (
                  <div key={i} className={`ah-deploy-line ${l.startsWith('✓') ? 'ok' : ''} ah-fadein`}>{l}</div>
              ))}
              {n < logs.length && <div className="ah-deploy-spin">⟳ working…</div>}
            </div>
          </div>
        </BrowserChrome>
    );
  }

  // Phase 9: Success
  if (phase === 9) {
    const pressed = tick * 120 > 1400;
    return (
        <BrowserChrome url="acadhost.dev/p/myproject">
          <div className="ah-success">
            <div className="ah-success-badge">
              <span className="ah-pulse-dot" /> RUNNING
            </div>
            <div className="ah-success-url">myproject.acadhost.dev</div>
            <div className={`ah-success-copy ${pressed ? 'is-press' : ''}`}>
              {pressed ? '✓ Copied' : 'Copy URL'}
            </div>
            <div className="ah-success-meta">Deploy 14s · CPU 0.12 · 128MB</div>
          </div>
        </BrowserChrome>
    );
  }

  // Phase 11: Professor opens project (render deployed site preview)
  if (phase === 11) {
    return (
        <BrowserChrome url="myproject.acadhost.dev" secure>
          <div className="ah-deployed-site">
            <div className="ah-ds-nav">
              <span>myproject</span>
              <span className="ah-ds-dim">home · about · contact</span>
            </div>
            <div className="ah-ds-hero">
              <div className="ah-ds-hero-title">Student Final Project</div>
              <div className="ah-ds-hero-sub">A full-stack web application</div>
              <div className="ah-ds-hero-cta">Explore →</div>
            </div>
            <div className="ah-ds-grid">
              <div className="ah-ds-tile" />
              <div className="ah-ds-tile" />
              <div className="ah-ds-tile" />
            </div>
          </div>
        </BrowserChrome>
    );
  }

  // Phase 4 & 10: empty screen (transition states)
  return <div className="ah-screen-blank" />;
}

function Field({ label, value, filled, mono }) {
  return (
      <div className={`ah-field ${filled ? 'is-filled' : ''}`}>
        <div className="ah-field-label">{label}</div>
        <div className={`ah-field-input ${mono ? 'is-mono' : ''}`}>
          {filled ? value : <span className="ah-field-ph">—</span>}
          {filled && <span className="ah-field-check">✓</span>}
        </div>
      </div>
  );
}

function BrowserChrome({ url, secure, children }) {
  return (
      <div className="ah-browser">
        <div className="ah-browser-bar">
          <span className="ah-br-dot ah-red" />
          <span className="ah-br-dot ah-yellow" />
          <span className="ah-br-dot ah-green" />
          <div className="ah-browser-url">
            <span className="ah-br-lock">{secure ? '🔒' : '⌘'}</span>
            <span>{url}<span className="ah-cursor-inline" /></span>
          </div>
        </div>
        <div className="ah-browser-view">{children}</div>
      </div>
  );
}

/* ── Messaging overlay (original, non-branded UI) ── */
function MessagesOverlay({ phase, tick }) {
  // Per-phase script of bubbles. { who: 'prof'|'me', text, delay (phase ticks) }
  let bubbles = [];
  if (phase === 1) {
    bubbles = [
      { who: 'prof', text: 'Send me your live project link.', at: 0 },
    ];
  } else if (phase === 2) {
    bubbles = [
      { who: 'prof', text: 'Send me your live project link.', at: 0 },
      { who: 'me',   text: 'localhost:3000', at: 10 },
    ];
  } else if (phase === 3) {
    bubbles = [
      { who: 'me',   text: 'localhost:3000', at: 0 },
      { who: 'prof', text: 'I can’t access localhost.', at: 6 },
      { who: 'prof', text: 'Deploy it properly and send me a live link.', at: 12 },
    ];
  } else if (phase === 10) {
    bubbles = [
      { who: 'me',   text: 'Here is the live link:', at: 0 },
      { who: 'me',   text: 'https://myproject.acadhost.dev', at: 8, link: true },
    ];
  } else if (phase === 11) {
    bubbles = [
      { who: 'me',   text: 'https://myproject.acadhost.dev', at: 0, link: true },
      { who: 'prof', text: 'Opening now…', at: 8 },
    ];
  } else if (phase === 12) {
    bubbles = [
      { who: 'prof', text: 'Good project 👍', at: 0 },
      { who: 'prof', text: 'A+ Grade', at: 8, grade: true },
    ];
  }

  const visible = bubbles.filter(b => tick >= b.at);

  return (
      <div className="ah-msg-overlay">
        <div className="ah-msg-card">
          <div className="ah-msg-head">
            <div className="ah-msg-avatar">P</div>
            <div>
              <div className="ah-msg-name">Professor</div>
              <div className="ah-msg-status">online</div>
            </div>
            <div className="ah-msg-chev">›</div>
          </div>
          <div className="ah-msg-body">
            {visible.map((b, i) => (
                <div key={i} className={`ah-bubble ${b.who} ${b.grade ? 'grade' : ''} ah-fadein`}>
                  {b.link ? <u>{b.text}</u> : b.text}
                </div>
            ))}
            {phase === 3 && tick < 6 && <div className="ah-bubble prof typing"><span/><span/><span/></div>}
          </div>
        </div>
      </div>
  );
}

/* ─── COMPONENT ─────────────────────────────────────────────────── */
export default function LandingPage() {
  const canvasRef = useRef(null);
  const typedRef  = useRef(null);
  const particlesRef = useRef(null);

  /* ── Inject CSS ── */
  useEffect(() => {
    const id = 'acadhost-landing-styles';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = CSS;
    document.head.appendChild(style);
    return () => { const el = document.getElementById(id); if (el) el.remove(); };
  }, []);

  /* ── Particles ── */
  useEffect(() => {
    const pc = particlesRef.current;
    if (!pc) return;
    const nodes = [];
    for (let i = 0; i < 24; i++) {
      const p = document.createElement('div');
      p.className = 'ah-particle';
      p.style.left = Math.random() * 100 + '%';
      p.style.animationDuration = (8 + Math.random() * 20) + 's';
      p.style.animationDelay = -(Math.random() * 25) + 's';
      p.style.opacity = 0.08 + Math.random() * 0.18;
      p.style.width = p.style.height = (1 + Math.random() * 2) + 'px';
      pc.appendChild(p);
      nodes.push(p);
    }
    return () => nodes.forEach(n => n.remove());
  }, []);

  /* ── Typed text ── */
  useEffect(() => {
    const el = typedRef.current;
    if (!el) return;
    let pi = 0, ci = 0, deleting = false, timer;
    function type() {
      const cur = TYPED_PHRASES[pi];
      if (!deleting) {
        el.textContent = cur.slice(0, ++ci);
        if (ci === cur.length) { deleting = true; timer = setTimeout(type, 1800); return; }
      } else {
        el.textContent = cur.slice(0, --ci);
        if (ci === 0) { deleting = false; pi = (pi + 1) % TYPED_PHRASES.length; timer = setTimeout(type, 400); return; }
      }
      timer = setTimeout(type, deleting ? 45 : 80);
    }
    type();
    return () => clearTimeout(timer);
  }, []);

  /* ── Scroll reveal ── */
  useEffect(() => {
    const els = document.querySelectorAll('.ah-reveal');
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('ah-visible'); });
    }, { threshold: 0.1 });
    els.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  /* ── Three.js 3D ── */
  useEffect(() => {
    const canvas = canvasRef.current;

    function initThree() {
      if (!canvas || !window.THREE) return;
      const THREE = window.THREE;
      const container = canvas.parentElement;
      const W = () => container.offsetWidth;
      const H = () => container.offsetHeight;

      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(W(), H());
      renderer.setClearColor(0x000000, 0);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(60, W() / H(), 0.1, 100);
      camera.position.set(0, 0, 8);

      const GOLD = 0xe8c94a, GOLD_DIM = 0x3a3010, WHITE = 0xe8e6e0, WHITE_DIM = 0x1e1e1e;

      /* Central icosahedron wireframe */
      const icoGeo = new THREE.IcosahedronGeometry(1.6, 1);
      const ico = new THREE.Mesh(icoGeo, new THREE.MeshBasicMaterial({ color: GOLD, wireframe: true, transparent: true, opacity: 0.28 }));
      scene.add(ico);

      const ico2 = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1.4, 0),
          new THREE.MeshBasicMaterial({ color: GOLD_DIM, transparent: true, opacity: 0.18 })
      );
      scene.add(ico2);

      /* Outer rings */
      const ring = new THREE.Mesh(
          new THREE.TorusGeometry(2.8, 0.008, 2, 80),
          new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.22 })
      );
      ring.rotation.x = Math.PI / 2;
      scene.add(ring);

      const ring2 = new THREE.Mesh(
          new THREE.TorusGeometry(2.2, 0.006, 2, 60),
          new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.06 })
      );
      ring2.rotation.x = 0.9; ring2.rotation.y = 0.5;
      scene.add(ring2);

      /* Extra decorative ring */
      const ring3 = new THREE.Mesh(
          new THREE.TorusGeometry(3.5, 0.004, 2, 100),
          new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.08 })
      );
      ring3.rotation.x = 1.2; ring3.rotation.z = 0.3;
      scene.add(ring3);

      /* Orbiting nodes */
      const nodes = [];
      for (let i = 0; i < 14; i++) {
        const theta = (i / 14) * Math.PI * 2;
        const r = 2.8 + (i % 3 === 0 ? 0.3 : 0);
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(0.06, 0.06, 0.06),
            new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? GOLD : WHITE, transparent: true, opacity: i % 3 === 0 ? 0.9 : 0.4 })
        );
        mesh.position.set(Math.cos(theta) * r, Math.sin(theta * 0.3) * 0.4, Math.sin(theta) * r * 0.4);
        nodes.push({ mesh, theta, baseR: r, speed: 0.002 + Math.random() * 0.002, phase: Math.random() * Math.PI * 2 });
        scene.add(mesh);
      }

      /* Connection lines */
      const lineMat = new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.15 });
      for (let i = 0; i < nodes.length; i += 3) {
        const pts = [new THREE.Vector3(0, 0, 0), nodes[i].mesh.position.clone()];
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
      }

      /* Floating fragments */
      const fragments = [];
      for (let i = 0; i < 35; i++) {
        const sz = 0.02 + Math.random() * 0.04;
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(sz * 3, sz, sz * 0.5),
            new THREE.MeshBasicMaterial({ color: Math.random() > 0.7 ? GOLD : WHITE_DIM, transparent: true, opacity: 0.12 + Math.random() * 0.22 })
        );
        const r = 3.5 + Math.random() * 2.5, theta = Math.random() * Math.PI * 2, phi = Math.random() * Math.PI;
        mesh.position.set(r * Math.sin(phi) * Math.cos(theta), (Math.random() - 0.5) * 3, r * Math.sin(phi) * Math.sin(theta) * 0.5);
        mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        fragments.push({ mesh, speed: 0.001 + Math.random() * 0.003, rotSpeed: Math.random() * 0.01 });
        scene.add(mesh);
      }

      /* ── CLOUD HOSTING EXTRAS ── */

      /* 1. Globe wireframe — far background anchor, feels like a world network */
      const globe = new THREE.Mesh(
          new THREE.IcosahedronGeometry(4.5, 2),
          new THREE.MeshBasicMaterial({ color: GOLD, wireframe: true, transparent: true, opacity: 0.04 })
      );
      globe.position.set(2, -1, -10);
      scene.add(globe);

      /* 2. Floating octahedrons — geo siblings to the icosahedron, scattered at depth */
      const octas = [];
      const octaPositions = [
        [-6, 2.5, -5], [6.5, -1.5, -4], [-5.5, -2, -6],
        [7, 3, -7], [-7, 0.5, -3], [5, -3.5, -5],
      ];
      octaPositions.forEach(([x, y, z], i) => {
        const sz = 0.18 + (i % 2) * 0.12;
        const octa = new THREE.Mesh(
            new THREE.OctahedronGeometry(sz, 0),
            new THREE.MeshBasicMaterial({
              color: i % 2 === 0 ? GOLD : WHITE,
              wireframe: true, transparent: true,
              opacity: 0.18 + (i % 3) * 0.06
            })
        );
        octa.position.set(x, y, z);
        octa.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        octas.push({ mesh: octa, rx: 0.003 + i * 0.001, ry: 0.005 + i * 0.0008 });
        scene.add(octa);
      });

      /* 3. Rising particle streams */
      const streams = [];
      const streamCols = [-5, -2, 2, 5];
      streamCols.forEach(xBase => {
        const col = [];
        for (let p = 0; p < 12; p++) {
          const dot = new THREE.Mesh(
              new THREE.SphereGeometry(0.022, 4, 4),
              new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.25 + Math.random() * 0.35 })
          );
          dot.position.set(
              xBase + (Math.random() - 0.5) * 0.3,
              -4 + Math.random() * 8,
              -3 + Math.random() * 1.5
          );
          col.push({ mesh: dot, speed: 0.008 + Math.random() * 0.012, xBase });
          scene.add(dot);
        }
        streams.push(...col);
      });

      /* 4. Constellation web */
      const starNodes = [];
      const starMat = new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.3 });
      const starLineMat = new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.07 });
      for (let i = 0; i < 22; i++) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.018, 4, 4), starMat);
        dot.position.set(
            (Math.random() - 0.5) * 18,
            (Math.random() - 0.5) * 10,
            -6 + Math.random() * -4
        );
        starNodes.push(dot);
        scene.add(dot);
      }
      for (let i = 0; i < starNodes.length; i++) {
        for (let j = i + 1; j < starNodes.length; j++) {
          if (starNodes[i].position.distanceTo(starNodes[j].position) < 5.5) {
            const pts = [starNodes[i].position.clone(), starNodes[j].position.clone()];
            scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), starLineMat));
          }
        }
      }

      /* 5. Signal pulse rings */
      const pulseRings = [];
      for (let i = 0; i < 3; i++) {
        const pr = new THREE.Mesh(
            new THREE.TorusGeometry(1, 0.005, 2, 60),
            new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.0 })
        );
        pr.position.set(2, -1, -10);
        pr.rotation.x = Math.PI / 2;
        pulseRings.push({ mesh: pr, phase: (i / 3) * Math.PI * 2 });
        scene.add(pr);
      }

      /* Mouse parallax */
      let mx = 0, my = 0;
      const onMouseMove = e => {
        mx = (e.clientX / window.innerWidth - 0.5) * 2;
        my = (e.clientY / window.innerHeight - 0.5) * 2;
      };
      document.addEventListener('mousemove', onMouseMove);

      const onResize = () => {
        renderer.setSize(W(), H());
        camera.aspect = W() / H();
        camera.updateProjectionMatrix();
      };
      window.addEventListener('resize', onResize);

      let t = 0, rafId;
      function animate() {
        rafId = requestAnimationFrame(animate);
        t += 0.008;
        ico.rotation.y = t * 0.3; ico.rotation.x = t * 0.15;
        ico2.rotation.y = -t * 0.2; ico2.rotation.z = t * 0.1;
        ring.rotation.z = t * 0.1;
        ring2.rotation.y = t * 0.15;
        ring3.rotation.z = -t * 0.07;
        nodes.forEach(n => {
          n.theta += n.speed;
          n.mesh.position.x = Math.cos(n.theta) * n.baseR;
          n.mesh.position.y = Math.sin(n.theta * 0.4) * 0.6 + Math.sin(t + n.phase) * 0.3;
          n.mesh.position.z = Math.sin(n.theta) * n.baseR * 0.4;
          n.mesh.rotation.y += 0.02;
        });
        fragments.forEach(f => {
          f.mesh.rotation.y += f.rotSpeed;
          f.mesh.rotation.x += f.rotSpeed * 0.5;
          f.mesh.position.y += Math.sin(t * f.speed * 10) * 0.001;
        });
        globe.rotation.y = t * 0.04;
        globe.rotation.x = t * 0.015;
        octas.forEach(o => {
          o.mesh.rotation.x += o.rx;
          o.mesh.rotation.y += o.ry;
          o.mesh.position.y += Math.sin(t * 0.3 + o.rx * 100) * 0.0008;
        });
        streams.forEach(s => {
          s.mesh.position.y += s.speed;
          if (s.mesh.position.y > 4.5) {
            s.mesh.position.y = -4.5;
            s.mesh.position.x = s.xBase + (Math.random() - 0.5) * 0.3;
          }
          s.mesh.material.opacity = 0.15 + Math.abs(Math.sin(t * 2 + s.mesh.position.y)) * 0.4;
        });
        pulseRings.forEach(pr => {
          const cycle = ((t * 0.4 + pr.phase / (Math.PI * 2)) % 1);
          const scale = 1 + cycle * 5;
          pr.mesh.scale.set(scale, scale, 1);
          pr.mesh.material.opacity = (1 - cycle) * 0.18;
        });

        camera.position.x += (mx * 0.8 - camera.position.x) * 0.03;
        camera.position.y += (-my * 0.5 - camera.position.y) * 0.03;
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
      }
      animate();

      return () => {
        cancelAnimationFrame(rafId);
        document.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('resize', onResize);
        renderer.dispose();
      };
    }

    if (window.THREE) {
      const cleanup = initThree();
      return cleanup;
    } else {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
      script.onload = () => initThree();
      document.head.appendChild(script);
      return () => { /* cleanup handled inside initThree */ };
    }
  }, []);

  return (
      <div className="ah-page">
        {/* Floating particles */}
        <div id="ah-particles" ref={particlesRef} />

        {/* ── NAV ── */}
        <nav className="ah-nav">
          <a href="#" className="ah-nav-logo">
            <span className="ah-nav-dot" />
            AcadHost
          </a>
          <div className="ah-nav-links">
            <a href="#features">Features</a>
            <a href="#how">How It Works</a>
            <a href="#resources">Resources</a>
          </div>
          <Link to="/login" className="ah-nav-cta">Sign In →</Link>
        </nav>

        {/* ── HERO ── */}
        <section className="ah-hero" id="hero">
          <div className="ah-canvas-container">
            <canvas ref={canvasRef} id="threejs-canvas" />
          </div>
          <div className="ah-hero-content">
            <div>
              <div className="ah-hero-badge">
                <span className="ah-badge-dot" />
                Student Developer Platform
              </div>
              <h1 className="ah-hero-title">
                Deploy<br />
                <span className="ah-line-accent">Your Code.</span><br />
                <span className="ah-line-dim">Own Your Stack.</span>
              </h1>
              <div className="ah-typed-container">
                Host your Node.js, Python, and React apps — free, fast, from your college lab.<br />
                Running: <span ref={typedRef} className="ah-typed-text" /><span className="ah-cursor" />
              </div>
              <div className="ah-hero-actions">
                <Link to="/login" className="ah-btn-primary">Sign In to Deploy →</Link>
                <a href="#how" className="ah-btn-ghost">See How It Works</a>
              </div>
              <div className="ah-hero-stats">
                {[['500+', 'Students'], ['1.2k', 'Projects Live'], ['99.1%', 'Uptime']].map(([n, l]) => (
                    <div className="ah-hero-stat" key={l}>
                      <span className="ah-stat-num">{n}</span>
                      <div className="ah-stat-label">{l}</div>
                    </div>
                ))}
              </div>
            </div>

            {/* Animated Terminal / Story */}
            <AnimatedHeroTerminal />
          </div>
        </section>

        <div className="ah-divider" />

        {/* ── FEATURES ── */}
        <section className="ah-section" id="features">
          <div className="ah-reveal">
            <div className="ah-section-label">Why AcadHost</div>
            <h2 className="ah-section-title">Everything You Need.<br />Nothing You Don't.</h2>
            <p className="ah-section-sub">Built specifically for students learning to deploy real applications — no cloud bills, no config hell.</p>
          </div>
          <div className="ah-features-grid ah-reveal">
            {FEATURES.map(f => (
                <div className="ah-feature-card" key={f.title}>
                  <div className="ah-feature-icon">{f.icon}</div>
                  <div className="ah-feature-title">{f.title}</div>
                  <p className="ah-feature-desc">{f.desc}</p>
                  <span className="ah-feature-tag">{f.tag}</span>
                </div>
            ))}
          </div>
        </section>

        <div className="ah-divider" />

        {/* ── HOW IT WORKS ── */}
        <section className="ah-section" id="how">
          <div className="ah-reveal">
            <div className="ah-section-label">Workflow</div>
            <h2 className="ah-section-title">From Code to Live<br />in Under 60 Seconds.</h2>
          </div>
          <div className="ah-steps-row ah-reveal">
            {STEPS.map(s => (
                <div className="ah-step" key={s.num}>
                  <div className="ah-step-num">{s.num}</div>
                  <div className="ah-step-title">{s.title}</div>
                  <p className="ah-step-desc">{s.desc}</p>
                </div>
            ))}
          </div>
        </section>

        {/* ── RESOURCES ── */}
        <div className="ah-resources-band" id="resources">
          <div className="ah-resources-inner">
            <div className="ah-reveal">
              <div className="ah-section-label">Student Quota (Free Tier)</div>
              <h2 className="ah-section-title">Real Resources.<br />Zero Cost.</h2>
            </div>
            <div className="ah-resources-grid ah-reveal">
              {RESOURCES.map(r => (
                  <div className="ah-resource-item" key={r.label}>
                    <span className="ah-resource-num">{r.num} <span>{r.unit}</span></span>
                    <div className="ah-resource-label">{r.label}</div>
                    <div className="ah-resource-bar">
                      <div className="ah-resource-fill" style={{ '--w': r.pct }} />
                    </div>
                  </div>
              ))}
            </div>

            <div style={{ marginTop: '2.5rem' }} className="ah-reveal">
              <div className="ah-section-label">Supported Stacks</div>
              <div className="ah-stacks-row">
                {STACKS.map(s => (
                    <span key={s.label} className={`ah-stack-pill${s.active ? ' active' : ''}`}>{s.label}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── CTA ── */}
        <div className="ah-cta-section" id="cta">
          <div className="ah-cta-grid-bg" />
          <div className="ah-cta-inner ah-reveal">
            <div className="ah-section-label">Get Started</div>
            <h2 className="ah-cta-title">Ready to <span>Deploy?</span></h2>
            <p className="ah-cta-sub">Sign in with your college account and have your first project live in under a minute.</p>
            <Link to="/login" className="ah-btn-primary ah-cta-btn-lg">Sign In to AcadHost →</Link>
            <p style={{ marginTop: '1rem', fontSize: '0.65rem', color: 'var(--ah-text3)' }}>
              Free forever for students · No credit card required
            </p>
          </div>
        </div>

        {/* ── FOOTER ── */}
        <footer className="ah-footer">
          <span className="ah-footer-logo">· AcadHost</span>
          <div className="ah-footer-links">
            <a href="#">Docs</a>
            <a href="#">Status</a>
            <a href="#">GitHub</a>
            <a href="#">Contact</a>
          </div>
          <span style={{ fontSize: '0.65rem', color: 'var(--ah-text3)' }}>Built for college students</span>
        </footer>
      </div>
  );
}

/* ─── CSS ───────────────────────────────────────────────────────── */
const CSS = `
:root {
  --ah-bg: #000000;
  --ah-bg2: #0a0a0a;
  --ah-bg3: #111111;
  --ah-bg4: #141414;
  --ah-accent: #e8c94a;
  --ah-accent-hover: #f0d560;
  --ah-accent-dim: #1a1608;
  --ah-text: #e8e6e0;
  --ah-text2: #a8a49c;
  --ah-text3: #6a665e;
  --ah-text4: #3a3630;
  --ah-border: #1e1e1e;
  --ah-border2: #2e2e2e;
  --ah-success: #4caf82;
  --ah-error: #e05c4a;
  --ah-info: #6ab4f0;
}

.ah-page {
  min-height: 100vh;
  background: var(--ah-bg);
  color: var(--ah-text);
  font-family: 'JetBrains Mono', monospace;
  font-size: 14px;
  line-height: 1.6;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}

/* scrollbar */
.ah-page ::-webkit-scrollbar { width: 6px; }
.ah-page ::-webkit-scrollbar-track { background: #0a0a0a; }
.ah-page ::-webkit-scrollbar-thumb { background: #2a2a2a; }

/* particles */
#ah-particles {
  position: fixed; inset: 0;
  pointer-events: none; z-index: 0; overflow: hidden;
}
.ah-particle {
  position: absolute; width: 1px; height: 1px;
  background: var(--ah-accent); border-radius: 50%;
  animation: ah-float-particle linear infinite;
}
@keyframes ah-float-particle {
  from { transform: translateY(100vh); }
  to   { transform: translateY(-10vh); }
}

/* nav */
.ah-nav {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  background: rgba(0,0,0,0.85);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--ah-border);
  padding: 0 2rem; height: 52px;
  display: flex; align-items: center; justify-content: space-between;
}
.ah-nav-logo {
  display: flex; align-items: center; gap: 0.5rem;
  font-weight: 800; font-size: 0.9rem; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--ah-text); text-decoration: none;
}
.ah-nav-dot {
  width: 8px; height: 8px;
  background: var(--ah-accent); border-radius: 50%;
  display: inline-block;
}
.ah-nav-links { display: flex; align-items: center; gap: 2rem; }
.ah-nav-links a {
  font-size: 0.72rem; font-weight: 600; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--ah-text3); text-decoration: none;
  transition: color 0.15s;
}
.ah-nav-links a:hover { color: var(--ah-text); }
.ah-nav-cta {
  background: var(--ah-accent); color: #000;
  font-family: inherit; font-size: 0.72rem; font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase;
  padding: 0.4rem 1rem; border: none; cursor: pointer;
  text-decoration: none; display: inline-block;
  transition: background 0.15s;
}
.ah-nav-cta:hover { background: var(--ah-accent-hover); }

/* hero */
.ah-hero {
  position: relative; min-height: 100vh;
  display: flex; align-items: center;
  padding-top: 52px; overflow: hidden;
}
.ah-canvas-container {
  position: absolute; inset: 0; pointer-events: none;
}
#threejs-canvas { width: 100% !important; height: 100% !important; }

.ah-hero-content {
  position: relative; z-index: 2;
  max-width: 1200px; margin: 0 auto; padding: 0 2rem;
  display: grid; grid-template-columns: 1fr 1fr;
  align-items: center; gap: 4rem; width: 100%;
}

/* badge */
.ah-hero-badge {
  display: inline-flex; align-items: center; gap: 0.5rem;
  background: var(--ah-accent-dim); border: 1px solid var(--ah-accent);
  padding: 0.3rem 0.75rem;
  font-size: 0.68rem; font-weight: 700; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--ah-accent); margin-bottom: 1.5rem;
}
.ah-badge-dot {
  width: 6px; height: 6px; background: var(--ah-accent); border-radius: 50%;
  animation: ah-pulse 2s infinite;
}
@keyframes ah-pulse {
  0%,100% { opacity:1; transform:scale(1); }
  50% { opacity:0.5; transform:scale(0.8); }
}

/* hero title */
.ah-hero-title {
  font-size: clamp(2rem, 4vw, 3.2rem);
  font-weight: 800; letter-spacing: -0.03em;
  line-height: 1.05; text-transform: uppercase;
  margin-bottom: 1.5rem;
}
.ah-line-accent { color: var(--ah-accent); }
.ah-line-dim    { color: var(--ah-text3); }

/* typed */
.ah-typed-container {
  font-size: 0.85rem; color: var(--ah-text2);
  margin-bottom: 2rem; min-height: 3rem;
}
.ah-typed-text { color: var(--ah-accent); }
.ah-cursor {
  display: inline-block; width: 2px; height: 1em;
  background: var(--ah-accent); margin-left: 2px;
  vertical-align: text-bottom; animation: ah-blink 0.8s infinite;
}
@keyframes ah-blink { 0%,100%{opacity:1} 50%{opacity:0} }

/* hero actions */
.ah-hero-actions { display: flex; gap: 1rem; flex-wrap: wrap; }
.ah-btn-primary {
  background: var(--ah-accent); color: #000;
  font-family: inherit; font-size: 0.78rem; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase;
  padding: 0.75rem 1.75rem; border: none; cursor: pointer;
  text-decoration: none; display: inline-block;
  transition: background 0.15s, transform 0.1s;
}
.ah-btn-primary:hover { background: var(--ah-accent-hover); transform: translateY(-1px); }
.ah-btn-ghost {
  background: transparent; color: var(--ah-text2);
  font-family: inherit; font-size: 0.78rem; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase;
  padding: 0.75rem 1.75rem; border: 1px solid var(--ah-border2);
  cursor: pointer; text-decoration: none; display: inline-block;
  transition: border-color 0.15s, color 0.15s;
}
.ah-btn-ghost:hover { border-color: var(--ah-text3); color: var(--ah-text); }

/* stats */
.ah-hero-stats {
  display: grid; grid-template-columns: repeat(3,1fr);
  gap: 1px; background: var(--ah-border);
  border: 1px solid var(--ah-border); margin-top: 2.5rem;
}
.ah-hero-stat {
  background: var(--ah-bg); padding: 1rem 0.75rem; text-align: center;
}
.ah-stat-num {
  font-size: 1.6rem; font-weight: 800; color: var(--ah-accent);
  letter-spacing: -0.03em; display: block;
}
.ah-stat-label {
  font-size: 0.6rem; font-weight: 700; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--ah-text3); margin-top: 0.2rem;
}

/* ── ANIMATED STAGE (terminal / laptop / messages) ── */
.ah-stage-wrap {
  position: relative;
  width: 100%;
  min-height: 420px;
}
.ah-stage {
  position: absolute; inset: 0;
  transition: opacity 0.55s cubic-bezier(0.4,0,0.2,1),
              transform 0.65s cubic-bezier(0.4,0,0.2,1),
              filter 0.55s ease;
}
.ah-stage.is-off {
  opacity: 0; pointer-events: none;
  transform: scale(0.96);
  filter: blur(6px);
}
.ah-stage.is-on { opacity: 1; transform: scale(1); filter: blur(0); }
.ah-stage.is-morph {
  transform: scale(1.05);
  filter: blur(3px);
  opacity: 0.4;
}

/* terminal (base) */
.ah-terminal {
  background: var(--ah-bg2); border: 1px solid var(--ah-border2);
}
.ah-term-header {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.6rem 0.85rem;
  border-bottom: 1px solid var(--ah-border);
  background: var(--ah-bg3);
}
.ah-term-dot { width: 10px; height: 10px; border-radius: 50%; }
.ah-term-dot.ah-red    { background: #e05c4a; }
.ah-term-dot.ah-yellow { background: #e8c94a; }
.ah-term-dot.ah-green  { background: #4caf82; }
.ah-term-title {
  flex: 1; text-align: center;
  font-size: 0.65rem; font-weight: 600; letter-spacing: 0.08em; color: var(--ah-text3);
}
.ah-term-body { padding: 1.25rem; font-size: 0.78rem; line-height: 1.8; min-height: 340px; }
.ah-term-body-anim { position: relative; }
.ah-t-line { display: block; margin-bottom: 0.15rem; }
.t-p { color: var(--ah-accent); }
.t-c { color: var(--ah-text); }
.t-out { color: var(--ah-text3); }
.t-green  { color: var(--ah-success); }
.t-b { color: var(--ah-info); }
.t-yellow { color: var(--ah-accent); }

.ah-term-caret {
  color: var(--ah-accent);
  animation: ah-blink 0.8s infinite;
  margin-left: 2px;
}

.ah-fadein {
  animation: ah-line-in 0.3s ease both;
}
@keyframes ah-line-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* laptop */
.ah-laptop {
  display: flex; flex-direction: column; align-items: center;
}
.ah-laptop-bezel {
  width: 100%;
  background: linear-gradient(180deg, #1a1a1c 0%, #0e0e10 100%);
  border: 1px solid #2a2a2d;
  border-radius: 14px;
  padding: 18px 14px 14px 14px;
  position: relative;
  box-shadow:
    0 0 0 1px #3a3a3e inset,
    0 30px 60px -30px rgba(0,0,0,0.9),
    0 0 0 2px #08080a;
}
.ah-laptop-notch {
  position: absolute;
  top: 4px; left: 50%; transform: translateX(-50%);
  width: 42px; height: 6px;
  background: #000; border-radius: 0 0 4px 4px;
}
.ah-laptop-screen {
  background: #000;
  border: 1px solid #000;
  border-radius: 4px;
  overflow: hidden;
  min-height: 340px;
}
.ah-laptop-base {
  width: 108%;
  height: 10px;
  background: linear-gradient(180deg, #26262a 0%, #0a0a0c 100%);
  border-radius: 0 0 12px 12px;
  margin-top: -1px;
  box-shadow: 0 6px 12px -4px rgba(0,0,0,0.8);
}

/* browser inside laptop */
.ah-browser {
  background: var(--ah-bg);
  color: var(--ah-text);
  min-height: 340px;
  display: flex; flex-direction: column;
}
.ah-browser-bar {
  display: flex; align-items: center; gap: 0.4rem;
  padding: 0.5rem 0.7rem;
  background: #0e0e10;
  border-bottom: 1px solid var(--ah-border);
}
.ah-br-dot { width: 9px; height: 9px; border-radius: 50%; }
.ah-br-dot.ah-red    { background: #e05c4a; }
.ah-br-dot.ah-yellow { background: #e8c94a; }
.ah-br-dot.ah-green  { background: #4caf82; }
.ah-browser-url {
  flex: 1; margin-left: 0.4rem;
  background: #18181b; border: 1px solid var(--ah-border);
  padding: 0.25rem 0.6rem;
  border-radius: 4px;
  font-size: 0.7rem; color: var(--ah-text2);
  display: flex; align-items: center; gap: 0.4rem;
}
.ah-br-lock { opacity: 0.6; font-size: 0.65rem; }
.ah-cursor-inline {
  display: inline-block; width: 1px; height: 0.85em;
  background: var(--ah-accent); margin-left: 2px;
  vertical-align: text-bottom;
  animation: ah-blink 0.8s infinite;
}
.ah-browser-view {
  flex: 1; padding: 1rem;
  background: radial-gradient(ellipse at top, #0a0a0a 0%, #000 100%);
}

.ah-browser-loading {
  height: 280px; display: flex; align-items: center; justify-content: center;
}
.ah-loader-bar {
  width: 60%; height: 2px; background: var(--ah-border);
  position: relative; overflow: hidden;
}
.ah-loader-bar::after {
  content: ''; position: absolute; top: 0; left: -40%;
  width: 40%; height: 100%;
  background: var(--ah-accent);
  animation: ah-loader 1.2s ease-in-out infinite;
}
@keyframes ah-loader {
  0% { left: -40%; }
  100% { left: 100%; }
}

/* mini landing inside browser */
.ah-mini-landing { padding: 1rem 0.5rem; }
.ah-mini-logo {
  font-size: 0.72rem; font-weight: 800; letter-spacing: 0.12em;
  color: var(--ah-accent); margin-bottom: 1.2rem;
}
.ah-mini-hero {
  font-size: 1.4rem; font-weight: 800; color: var(--ah-text);
  letter-spacing: -0.02em; text-transform: uppercase;
  margin-bottom: 0.4rem;
}
.ah-mini-sub {
  font-size: 0.7rem; color: var(--ah-text3); letter-spacing: 0.1em;
  text-transform: uppercase; margin-bottom: 1rem;
}
.ah-mini-cta {
  display: inline-block;
  background: var(--ah-accent); color: #000;
  font-size: 0.7rem; font-weight: 700; padding: 0.5rem 1rem;
  letter-spacing: 0.08em; text-transform: uppercase;
}

/* dashboard */
.ah-dash { padding: 0.4rem; }
.ah-dash-top {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 0.9rem;
}
.ah-dash-title {
  font-size: 0.8rem; font-weight: 800; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--ah-text);
}
.ah-dash-new {
  background: var(--ah-accent); color: #000;
  padding: 0.35rem 0.75rem;
  font-size: 0.65rem; font-weight: 700; letter-spacing: 0.1em;
  text-transform: uppercase;
  transition: transform 0.15s;
}
.ah-dash-new.is-press { transform: scale(0.92); box-shadow: 0 0 0 3px var(--ah-accent-dim); }
.ah-dash-metrics {
  display: grid; grid-template-columns: repeat(4,1fr);
  gap: 1px; background: var(--ah-border);
  border: 1px solid var(--ah-border); margin-bottom: 0.9rem;
}
.ah-dash-metric {
  background: var(--ah-bg2); padding: 0.55rem; text-align: center;
}
.ah-dash-metric b {
  display: block; font-size: 1rem; color: var(--ah-accent);
  font-weight: 800; letter-spacing: -0.02em;
}
.ah-dash-metric span {
  font-size: 0.55rem; letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--ah-text3);
}
.ah-dash-list { border: 1px solid var(--ah-border); }
.ah-dash-row {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.5rem 0.7rem;
  border-bottom: 1px solid var(--ah-border);
  font-size: 0.72rem; color: var(--ah-text);
}
.ah-dash-row:last-child { border-bottom: none; }
.ah-dash-tag {
  margin-left: auto;
  padding: 0.1rem 0.4rem;
  font-size: 0.55rem; letter-spacing: 0.1em; text-transform: uppercase;
  background: var(--ah-accent-dim); color: var(--ah-accent);
  border: 1px solid var(--ah-accent);
}
.ah-dash-tag.off {
  background: transparent; color: var(--ah-text3); border-color: var(--ah-border2);
}
.ah-dot-g {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--ah-success);
  box-shadow: 0 0 6px var(--ah-success);
}
.ah-dot-d {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--ah-text3);
}

/* form (project creation) */
.ah-form { padding: 0.4rem; }
.ah-form-title {
  font-size: 0.8rem; font-weight: 800; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--ah-text);
  margin-bottom: 0.9rem;
}
.ah-field {
  display: grid; grid-template-columns: 90px 1fr;
  gap: 0.5rem; align-items: center;
  margin-bottom: 0.5rem;
}
.ah-field-label {
  font-size: 0.6rem; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--ah-text3);
}
.ah-field-input {
  display: flex; align-items: center; gap: 0.4rem;
  background: var(--ah-bg2); border: 1px solid var(--ah-border);
  padding: 0.4rem 0.6rem;
  font-size: 0.7rem; color: var(--ah-text3);
  min-height: 28px;
  transition: all 0.2s;
}
.ah-field.is-filled .ah-field-input {
  color: var(--ah-text);
  border-color: var(--ah-accent);
  background: #0d0c07;
}
.ah-field-input.is-mono {
  font-family: 'JetBrains Mono', monospace;
}
.ah-field-ph { opacity: 0.4; }
.ah-field-check {
  margin-left: auto;
  color: var(--ah-accent);
  font-weight: 700;
  animation: ah-pop 0.3s ease;
}
@keyframes ah-pop {
  0% { transform: scale(0); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
.ah-form-deploy {
  margin-top: 0.8rem;
  background: var(--ah-accent); color: #000;
  padding: 0.55rem 1rem;
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.1em;
  text-transform: uppercase;
  display: inline-block;
  transition: all 0.15s;
}
.ah-form-deploy.is-press {
  transform: scale(0.95);
  box-shadow: 0 0 0 4px var(--ah-accent-dim);
}

/* deployment logs */
.ah-deploy-logs { padding: 0.4rem; }
.ah-deploy-title {
  font-size: 0.75rem; font-weight: 700; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--ah-text3);
  margin-bottom: 0.8rem;
}
.ah-deploy-title span { color: var(--ah-accent); }
.ah-deploy-body {
  background: var(--ah-bg2); border: 1px solid var(--ah-border);
  padding: 0.8rem; font-size: 0.72rem; line-height: 1.9;
  min-height: 200px;
}
.ah-deploy-line { color: var(--ah-text2); }
.ah-deploy-line.ok { color: var(--ah-success); font-weight: 700; }
.ah-deploy-spin {
  color: var(--ah-accent);
  font-size: 0.7rem;
  margin-top: 0.4rem;
  animation: ah-spin 1.2s linear infinite;
  display: inline-block;
}
@keyframes ah-spin {
  from { opacity: 0.5; }
  to   { opacity: 1; }
}

/* success */
.ah-success {
  padding: 1.2rem 0.5rem; text-align: center;
}
.ah-success-badge {
  display: inline-flex; align-items: center; gap: 0.4rem;
  background: rgba(76,175,130,0.08);
  border: 1px solid var(--ah-success);
  color: var(--ah-success);
  padding: 0.3rem 0.7rem;
  font-size: 0.6rem; font-weight: 700; letter-spacing: 0.12em;
  margin-bottom: 1rem;
}
.ah-pulse-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--ah-success);
  animation: ah-pulse 1.4s infinite;
  box-shadow: 0 0 8px var(--ah-success);
}
.ah-success-url {
  font-size: 1.05rem; font-weight: 700;
  color: var(--ah-accent);
  margin-bottom: 1rem;
  letter-spacing: 0.02em;
}
.ah-success-copy {
  display: inline-block;
  background: transparent; color: var(--ah-text);
  border: 1px solid var(--ah-border2);
  padding: 0.4rem 0.9rem;
  font-size: 0.65rem; letter-spacing: 0.1em; text-transform: uppercase;
  transition: all 0.2s;
}
.ah-success-copy.is-press {
  background: var(--ah-accent-dim); border-color: var(--ah-accent);
  color: var(--ah-accent);
  transform: scale(0.97);
}
.ah-success-meta {
  margin-top: 1rem;
  font-size: 0.62rem; color: var(--ah-text3);
  letter-spacing: 0.08em;
}

/* deployed site preview */
.ah-deployed-site {
  padding: 0.3rem;
  background: #fafaf5;
  color: #111;
  border: 1px solid var(--ah-border);
  min-height: 260px;
}
.ah-ds-nav {
  display: flex; justify-content: space-between; align-items: center;
  padding: 0.5rem 0.7rem;
  border-bottom: 1px solid #ddd;
  font-size: 0.72rem; font-weight: 700;
}
.ah-ds-dim { color: #888; font-weight: 500; font-size: 0.65rem; }
.ah-ds-hero { padding: 1rem 0.7rem; text-align: center; }
.ah-ds-hero-title {
  font-size: 1.1rem; font-weight: 800; letter-spacing: -0.02em;
  color: #111;
}
.ah-ds-hero-sub {
  font-size: 0.7rem; color: #666; margin: 0.3rem 0 0.8rem;
}
.ah-ds-hero-cta {
  display: inline-block;
  background: #111; color: #fafaf5;
  padding: 0.4rem 0.9rem;
  font-size: 0.65rem; font-weight: 700; letter-spacing: 0.1em;
}
.ah-ds-grid {
  display: grid; grid-template-columns: repeat(3,1fr);
  gap: 6px; padding: 0.5rem 0.7rem 0.7rem;
}
.ah-ds-tile {
  height: 50px;
  background: linear-gradient(135deg, #e8e6e0 0%, #c8c4b8 100%);
  border-radius: 2px;
}

.ah-screen-blank {
  min-height: 260px;
  background: #000;
  background-image:
    radial-gradient(circle at 50% 50%, rgba(232,201,74,0.04) 0%, transparent 70%);
}

/* messages overlay (original, non-branded) */
.ah-msg-overlay {
  position: absolute;
  top: 10%;
  right: -4%;
  z-index: 5;
  pointer-events: none;
  animation: ah-msg-pop 0.45s cubic-bezier(0.34,1.56,0.64,1) both;
}
@keyframes ah-msg-pop {
  from { opacity: 0; transform: translateY(-12px) scale(0.85); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.ah-msg-card {
  width: 240px;
  background: var(--ah-bg2);
  border: 1px solid var(--ah-accent);
  box-shadow:
    0 18px 40px -12px rgba(0,0,0,0.9),
    0 0 0 1px rgba(232,201,74,0.2);
}
.ah-msg-head {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.5rem 0.7rem;
  border-bottom: 1px solid var(--ah-border);
  background: var(--ah-bg3);
}
.ah-msg-avatar {
  width: 26px; height: 26px;
  border-radius: 50%;
  background: var(--ah-accent);
  color: #000;
  font-weight: 800; font-size: 0.7rem;
  display: flex; align-items: center; justify-content: center;
}
.ah-msg-name {
  font-size: 0.68rem; font-weight: 700;
  color: var(--ah-text); letter-spacing: 0.04em;
}
.ah-msg-status {
  font-size: 0.55rem; color: var(--ah-success);
  letter-spacing: 0.1em; text-transform: uppercase;
}
.ah-msg-chev { margin-left: auto; color: var(--ah-text3); }
.ah-msg-body {
  padding: 0.7rem;
  display: flex; flex-direction: column; gap: 0.35rem;
  min-height: 90px;
}
.ah-bubble {
  max-width: 82%;
  padding: 0.4rem 0.6rem;
  font-size: 0.68rem;
  line-height: 1.4;
  word-break: break-word;
}
.ah-bubble.prof {
  align-self: flex-start;
  background: var(--ah-bg3); color: var(--ah-text);
  border: 1px solid var(--ah-border2);
  border-top-left-radius: 2px;
}
.ah-bubble.me {
  align-self: flex-end;
  background: var(--ah-accent); color: #000;
  font-weight: 600;
  border-top-right-radius: 2px;
}
.ah-bubble.grade {
  font-weight: 800;
  letter-spacing: 0.04em;
  color: var(--ah-accent);
  background: var(--ah-accent-dim);
  border-color: var(--ah-accent);
}
.ah-bubble.typing {
  display: inline-flex; gap: 3px; padding: 0.5rem 0.6rem;
}
.ah-bubble.typing span {
  width: 5px; height: 5px; background: var(--ah-text3); border-radius: 50%;
  animation: ah-typing 1.2s infinite;
}
.ah-bubble.typing span:nth-child(2) { animation-delay: 0.15s; }
.ah-bubble.typing span:nth-child(3) { animation-delay: 0.3s; }
@keyframes ah-typing {
  0%,60%,100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
}

/* phase strip */
.ah-phase-strip {
  position: absolute;
  bottom: -22px; left: 0; right: 0;
  display: flex; justify-content: center; gap: 5px;
}
.ah-phase-dot {
  width: 6px; height: 2px;
  background: var(--ah-border2);
  transition: all 0.3s;
}
.ah-phase-dot.on {
  background: var(--ah-accent);
  width: 18px;
}

/* sections */
.ah-section { padding: 5rem 2rem; max-width: 1200px; margin: 0 auto; }
.ah-section-label {
  font-size: 0.65rem; font-weight: 700; letter-spacing: 0.18em;
  text-transform: uppercase; color: var(--ah-accent); margin-bottom: 0.75rem;
}
.ah-section-title {
  font-size: clamp(1.4rem,3vw,2.2rem); font-weight: 800;
  letter-spacing: -0.02em; text-transform: uppercase;
  line-height: 1.1; margin-bottom: 1rem;
}
.ah-section-sub { font-size: 0.85rem; color: var(--ah-text2); max-width: 500px; line-height: 1.7; }
.ah-divider { height: 1px; background: var(--ah-border); margin: 0 2rem; }

/* features grid */
.ah-features-grid {
  display: grid; grid-template-columns: repeat(3,1fr);
  gap: 1px; background: var(--ah-border);
  border: 1px solid var(--ah-border); margin-top: 3rem;
}
.ah-feature-card {
  background: var(--ah-bg); padding: 1.75rem 1.5rem;
  position: relative; overflow: hidden; transition: background 0.2s;
}
.ah-feature-card::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0;
  height: 2px; background: transparent; transition: background 0.2s;
}
.ah-feature-card:hover { background: var(--ah-bg2); }
.ah-feature-card:hover::before { background: var(--ah-accent); }
.ah-feature-icon { font-size: 1.4rem; margin-bottom: 1rem; color: var(--ah-accent); }
.ah-feature-title {
  font-size: 0.8rem; font-weight: 700; letter-spacing: 0.08em;
  text-transform: uppercase; margin-bottom: 0.5rem; color: var(--ah-text);
}
.ah-feature-desc { font-size: 0.78rem; color: var(--ah-text2); line-height: 1.7; }
.ah-feature-tag {
  display: inline-block; margin-top: 1rem;
  padding: 0.2rem 0.5rem;
  background: var(--ah-accent-dim); border: 1px solid var(--ah-border2);
  font-size: 0.6rem; font-weight: 700; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--ah-text3);
}

/* steps */
.ah-steps-row {
  display: grid; grid-template-columns: repeat(4,1fr);
  gap: 0; position: relative; margin-top: 3rem;
}
.ah-step {
  padding: 1.75rem 1.25rem;
  border-right: 1px solid var(--ah-border);
}
.ah-step:last-child { border-right: none; }
.ah-step-num {
  font-size: 3rem; font-weight: 800; color: var(--ah-text4);
  letter-spacing: -0.04em; line-height: 1; margin-bottom: 1rem;
}
.ah-step-title {
  font-size: 0.78rem; font-weight: 700; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--ah-text); margin-bottom: 0.5rem;
}
.ah-step-desc { font-size: 0.75rem; color: var(--ah-text2); line-height: 1.7; }

/* resources */
.ah-resources-band {
  background: var(--ah-bg2);
  border-top: 1px solid var(--ah-border); border-bottom: 1px solid var(--ah-border);
  padding: 3rem 2rem;
}
.ah-resources-inner { max-width: 1200px; margin: 0 auto; }
.ah-resources-grid {
  display: grid; grid-template-columns: repeat(5,1fr);
  gap: 1px; background: var(--ah-border);
  border: 1px solid var(--ah-border); margin-top: 2rem;
}
.ah-resource-item {
  background: var(--ah-bg2); padding: 1.25rem 1rem; text-align: center;
}
.ah-resource-num {
  font-size: 1.8rem; font-weight: 800; color: var(--ah-text);
  letter-spacing: -0.04em; display: block;
}
.ah-resource-num span { color: var(--ah-accent); }
.ah-resource-label {
  font-size: 0.62rem; font-weight: 700; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--ah-text3); margin-top: 0.3rem;
}
.ah-resource-bar {
  height: 2px; background: var(--ah-border); margin-top: 0.75rem;
  position: relative; overflow: hidden;
}
.ah-resource-fill {
  position: absolute; top: 0; left: 0; height: 100%;
  background: var(--ah-accent);
  animation: ah-bar-grow 1.5s ease-out forwards;
  transform-origin: left;
}
@keyframes ah-bar-grow { from { width: 0; } to { width: var(--w); } }

/* stacks */
.ah-stacks-row { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 2rem; }
.ah-stack-pill {
  background: var(--ah-bg3); border: 1px solid var(--ah-border2);
  padding: 0.35rem 0.75rem;
  font-size: 0.68rem; font-weight: 600; letter-spacing: 0.06em;
  color: var(--ah-text2);
}
.ah-stack-pill.active {
  background: var(--ah-accent-dim); border-color: var(--ah-accent); color: var(--ah-accent);
}

/* cta */
.ah-cta-section {
  text-align: center; padding: 6rem 2rem;
  position: relative; overflow: hidden;
  border-top: 1px solid var(--ah-border);
  background: var(--ah-bg);
}
.ah-cta-grid-bg {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(var(--ah-border) 1px, transparent 1px),
    linear-gradient(90deg, var(--ah-border) 1px, transparent 1px);
  background-size: 60px 60px;
  opacity: 0.4; pointer-events: none;
}
.ah-cta-inner { position: relative; z-index: 2; }
.ah-cta-title {
  font-size: clamp(1.8rem,4vw,3rem); font-weight: 800;
  letter-spacing: -0.03em; text-transform: uppercase;
  line-height: 1.05; margin-bottom: 1.5rem;
}
.ah-cta-title span { color: var(--ah-accent); }
.ah-cta-sub {
  font-size: 0.85rem; color: var(--ah-text2); margin-bottom: 2.5rem;
  max-width: 420px; margin-left: auto; margin-right: auto;
}
.ah-cta-btn-lg {
  font-size: 0.9rem !important;
  padding: 0.9rem 2.5rem !important;
  letter-spacing: 0.1em !important;
}

/* footer */
.ah-footer {
  background: var(--ah-bg); border-top: 1px solid var(--ah-border);
  padding: 2rem;
  display: flex; justify-content: space-between; align-items: center;
  flex-wrap: wrap; gap: 1rem;
}
.ah-footer-logo { font-size: 0.72rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ah-text3); }
.ah-footer-links { display: flex; gap: 1.5rem; }
.ah-footer-links a {
  font-size: 0.65rem; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--ah-text3); text-decoration: none;
  transition: color 0.15s;
}
.ah-footer-links a:hover { color: var(--ah-text2); }

/* scroll reveal */
.ah-reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.6s ease, transform 0.6s ease; }
.ah-visible { opacity: 1; transform: translateY(0); }

/* responsive */
@media(max-width:900px) {
  .ah-hero-content { grid-template-columns: 1fr; }
  .ah-features-grid { grid-template-columns: 1fr 1fr; }
  .ah-steps-row { grid-template-columns: 1fr 1fr; }
  .ah-resources-grid { grid-template-columns: repeat(3,1fr); }
  .ah-stage-wrap { display: none; }
}
@media(max-width:600px) {
  .ah-features-grid { grid-template-columns: 1fr; }
  .ah-steps-row { grid-template-columns: 1fr; }
  .ah-step { border-right: none; border-bottom: 1px solid var(--ah-border); }
  .ah-resources-grid { grid-template-columns: repeat(2,1fr); }
  .ah-nav .ah-nav-links { display: none; }
}
`;
