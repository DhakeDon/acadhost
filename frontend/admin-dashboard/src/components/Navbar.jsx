import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

function Icon({ path, size = 16 }) {
    return (
        <svg
            width={size} height={size} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.75"
            strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true"
        >
            {path}
        </svg>
    );
}

const I = {
    dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>,
    projects:  <><path d="M4 7v12a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-7L10 5H5a1 1 0 0 0-1 1v1z"/></>,
    students:  <><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="10" r="2.5"/><path d="M21 20c0-2.5-1.8-4.5-4-4.5"/></>,
    requests:  <><path d="M9 11l3 3 5-5"/><rect x="3" y="4" width="18" height="16" rx="2"/></>,
    logout:    <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></>,
    hex:       <><path d="M12 2l9 5.2v9.6L12 22l-9-5.2V7.2z"/></>,
};

export default function Navbar() {
    const { pathname } = useLocation();
    const navigate     = useNavigate();
    const { user, logout } = useAuth();
    const { dark, toggle }  = useTheme();

    const navItems = [
        { label: 'Dashboard', to: '/',                  icon: I.dashboard },
        { label: 'Projects',  to: '/projects',          icon: I.projects  },
        { label: 'Students',  to: '/students',          icon: I.students  },
        { label: 'Requests',  to: '/resource-requests', icon: I.requests  },
    ];

    async function handleLogout() {
        await logout();
        navigate('/login');
    }

    const initials = (user?.email || '?').slice(0, 2).toUpperCase();

    return (
        <>
            <aside className="sidebar" aria-label="Primary navigation">

                {/* ── Brand ── */}
                <div className="sb-brand">
                    <span className="sb-logo" aria-hidden="true">
                        <Icon path={I.hex} size={18} />
                    </span>
                    <div className="sb-brand-text">
                        <span className="sb-title">AcadHost</span>
                        <span className="sb-sub">Admin Console</span>
                    </div>
                </div>

                {/* ── Section header with toggle ── */}
                <div className="sb-section-header">
                    <span className="sb-section-label">Platform</span>
                    <div
                        className={`toggle-track ${dark ? 'dark-mode' : 'light-mode'}`}
                        onClick={toggle}
                        role="button"
                        aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
                    >
                        <div className="t-stars">
                            <div className="t-star" style={{width:'3px',height:'3px',top:'6px',left:'7px'}} />
                            <div className="t-star" style={{width:'2px',height:'2px',top:'11px',left:'12px'}} />
                            <div className="t-star" style={{width:'2px',height:'2px',top:'5px',left:'15px'}} />
                        </div>
                        <div className="t-thumb">
                            <svg className="t-sun" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#7a5a00" strokeWidth="2.5" strokeLinecap="round">
                                <circle cx="12" cy="12" r="4"/>
                                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
                            </svg>
                            <svg className="t-moon" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#8b9fc2" strokeWidth="2.5" strokeLinecap="round">
                                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                            </svg>
                        </div>
                    </div>
                </div>

                {/* ── Nav links ── */}
                <nav className="sb-links">
                    {navItems.map((item) => (
                        <Link
                            key={item.to}
                            to={item.to}
                            className={`sb-link${pathname === item.to ? ' active' : ''}`}
                        >
                            <span className="sb-link-icon"><Icon path={item.icon} /></span>
                            <span className="sb-link-label">{item.label}</span>
                        </Link>
                    ))}
                </nav>

                {/* ── Footer ── */}
                <div className="sb-footer">
                    <div className="sb-user">
                        <span className="sb-avatar">{initials}</span>
                        <div className="sb-user-meta">
                            <span className="sb-user-role">Administrator</span>
                            <span className="sb-user-email" title={user?.email}>{user?.email}</span>
                        </div>
                    </div>
                    <button className="sb-logout" onClick={handleLogout} title="Sign out">
                        <Icon path={I.logout} size={14} />
                    </button>
                </div>

            </aside>

            <style>{`
                /* ─── Sidebar shell ─── */
                .sidebar {
                    position: sticky;
                    top: 0;
                    height: 100vh;
                    width: var(--sidebar-w);
                    background: var(--sidebar-bg);
                    border-right: 1px solid var(--border);
                    display: flex;
                    flex-direction: column;
                    padding: 18px 14px 16px;
                    z-index: 200;
                    font-family: 'Inter', 'DM Sans', 'Segoe UI', sans-serif;
                    overflow-y: auto;
                    flex-shrink: 0;
                }

                /* ─── Brand ─── */
                .sb-brand {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 4px 8px 20px;
                    border-bottom: 1px solid var(--border);
                    margin-bottom: 16px;
                    flex-shrink: 0;
                }
                .sb-logo {
                    width: 30px; height: 30px;
                    border-radius: 8px;
                    background: var(--accent);
                    color: var(--accent-fg);
                    display: flex; align-items: center; justify-content: center;
                    flex-shrink: 0;
                }
                .sb-brand-text {
                    display: flex; flex-direction: column;
                    line-height: 1.2; min-width: 0;
                }
                .sb-title {
                    font-weight: 600; font-size: 14px;
                    color: var(--text-primary);
                    letter-spacing: -0.01em;
                }
                .sb-sub {
                    font-size: 11px;
                    color: var(--text-muted);
                    font-weight: 500;
                }

                /* ─── Section header ─── */
                .sb-section-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 0 10px 10px;
                    flex-shrink: 0;
                }
                .sb-section-label {
                    font-size: 10.5px;
                    font-weight: 600;
                    letter-spacing: 0.06em;
                    text-transform: uppercase;
                    color: var(--text-muted);
                    line-height: 1;
                }

                /* ─── Toggle ─── */
                .toggle-track {
                    position: relative;
                    width: 40px; height: 22px;
                    border-radius: 999px;
                    cursor: pointer;
                    flex-shrink: 0;
                    transition: background 0.35s cubic-bezier(.4,0,.2,1), border-color 0.35s;
                }
                .toggle-track.light-mode {
                    background: #f0e9d6;
                    border: 1px solid #cdc7b8;
                }
                .toggle-track.dark-mode {
                    background: #1a1a1a;
                    border: 1px solid #2a2a2a;
                }
                .t-stars {
                    position: absolute; inset: 0;
                    border-radius: 999px; overflow: hidden;
                    pointer-events: none;
                }
                .t-star {
                    position: absolute; border-radius: 50%;
                    background: #c8d6f0;
                    transition: opacity 0.4s;
                }
                .toggle-track.light-mode .t-star { opacity: 0; }
                .toggle-track.dark-mode  .t-star { opacity: 1; }

                .t-thumb {
                    position: absolute;
                    top: 3px;
                    width: 16px; height: 16px;
                    border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    overflow: hidden;
                    transition: transform 0.35s cubic-bezier(.4,0,.2,1), background 0.35s;
                }
                .toggle-track.light-mode .t-thumb {
                    transform: translateX(3px);
                    background: #e9a825;
                }
                .toggle-track.dark-mode .t-thumb {
                    transform: translateX(19px);
                    background: #3a4a6a;
                }
                .t-sun, .t-moon {
                    position: absolute;
                    transition: opacity 0.25s, transform 0.35s;
                }
                .toggle-track.light-mode .t-sun  { opacity: 1; transform: rotate(0deg)   scale(1);   }
                .toggle-track.light-mode .t-moon { opacity: 0; transform: rotate(30deg)  scale(0.7); }
                .toggle-track.dark-mode  .t-sun  { opacity: 0; transform: rotate(-30deg) scale(0.7); }
                .toggle-track.dark-mode  .t-moon { opacity: 1; transform: rotate(0deg)   scale(1);   }

                /* ─── Nav links ─── */
                .sb-links {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    flex-shrink: 0;
                }
                .sb-link {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 7px 10px;
                    border-radius: 6px;
                    color: var(--text-secondary);
                    text-decoration: none;
                    font-size: 13px;
                    font-weight: 500;
                    line-height: 1.4;
                    transition: background 0.12s, color 0.12s;
                    position: relative;
                }
                .sb-link:hover {
                    background: var(--bg-tertiary);
                    color: var(--text-primary);
                }
                .sb-link.active {
                    background: var(--bg-tertiary);
                    color: var(--text-primary);
                    font-weight: 600;
                }
                .sb-link.active::before {
                    content: '';
                    position: absolute;
                    left: -14px; top: 6px; bottom: 6px;
                    width: 2px;
                    background: var(--accent);
                    border-radius: 0 2px 2px 0;
                }
                .sb-link-icon {
                    display: flex; align-items: center; justify-content: center;
                    color: var(--text-muted);
                    flex-shrink: 0;
                }
                .sb-link.active .sb-link-icon,
                .sb-link:hover  .sb-link-icon { color: var(--accent); }

                /* ─── Footer ─── */
                .sb-footer {
                    margin-top: auto;
                    padding-top: 14px;
                    border-top: 1px solid var(--border);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    flex-shrink: 0;
                }
                .sb-user {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 4px 6px;
                    border-radius: 8px;
                    flex: 1; min-width: 0;
                }
                .sb-avatar {
                    width: 28px; height: 28px;
                    border-radius: 50%;
                    background: var(--bg-tertiary);
                    border: 1px solid var(--border);
                    color: var(--text-primary);
                    display: flex; align-items: center; justify-content: center;
                    font-size: 10px; font-weight: 600;
                    letter-spacing: 0.02em;
                    flex-shrink: 0;
                }
                .sb-user-meta {
                    display: flex; flex-direction: column;
                    min-width: 0; line-height: 1.3;
                }
                .sb-user-role {
                    font-size: 12px; font-weight: 600;
                    color: var(--text-primary);
                }
                .sb-user-email {
                    font-size: 11px;
                    color: var(--text-muted);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .sb-logout {
                    width: 28px; height: 28px;
                    border-radius: 6px;
                    border: 1px solid var(--border);
                    background: transparent;
                    color: var(--text-muted);
                    display: flex; align-items: center; justify-content: center;
                    cursor: pointer;
                    flex-shrink: 0;
                    transition: background 0.12s, color 0.12s, border-color 0.12s;
                }
                .sb-logout:hover {
                    background: var(--bg-tertiary);
                    color: var(--error);
                    border-color: var(--border-strong);
                }

                /* ─── Mobile ─── */
                @media (max-width: 600px) {
                    .sidebar {
                        position: sticky;
                        top: 0;
                        height: auto;
                        width: 100%;
                        flex-direction: column;
                        padding: 12px 14px;
                        border-right: none;
                        border-bottom: 1px solid var(--border);
                        overflow-y: visible;
                    }
                    .sb-brand { border-bottom: none; padding: 0 0 10px; margin-bottom: 0; }
                    .sb-section-header { padding: 8px 4px 6px; }
                    .sb-links { flex-direction: row; flex-wrap: wrap; gap: 4px; }
                    .sb-link { padding: 6px 10px; font-size: 12.5px; }
                    .sb-link.active::before { display: none; }
                    .sb-footer { display: none; }
                }
            `}</style>
        </>
    );
}