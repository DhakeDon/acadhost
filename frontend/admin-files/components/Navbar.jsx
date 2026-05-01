import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

// ── Sun icon (inline SVG, no emoji) ──────────────────────────
function SunIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4"/>
            <line x1="12" y1="2"  x2="12" y2="5"/>
            <line x1="12" y1="19" x2="12" y2="22"/>
            <line x1="4.22" y1="4.22"  x2="6.34" y2="6.34"/>
            <line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/>
            <line x1="2"  y1="12" x2="5"  y2="12"/>
            <line x1="19" y1="12" x2="22" y2="12"/>
            <line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/>
            <line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/>
        </svg>
    );
}

// ── Moon icon ─────────────────────────────────────────────────
function MoonIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
    );
}

export default function Navbar() {
    const { pathname } = useLocation();
    const navigate    = useNavigate();
    const { user, logout } = useAuth();
    const { dark, toggle } = useTheme();

    const navItems = [
        { label: 'Dashboard', to: '/' },
        { label: 'Projects',  to: '/projects' },
        { label: 'Students',  to: '/students' },
        { label: 'Requests',  to: '/resource-requests' },
    ];

    async function handleLogout() {
        await logout();
        navigate('/login');
    }

    return (
        <nav className="navbar">
            {/* Brand */}
            <div className="navbar-brand">
                <span className="navbar-logo">⬡</span>
                <span className="navbar-title">AcadHost</span>
                <span className="navbar-badge">Admin</span>
            </div>

            {/* Nav links */}
            <div className="navbar-links">
                {navItems.map((item) => (
                    <Link
                        key={item.to}
                        to={item.to}
                        className={`navbar-link${pathname === item.to ? ' active' : ''}`}
                    >
                        {item.label}
                    </Link>
                ))}
            </div>

            {/* Right side */}
            <div className="navbar-user">
                {/* ── Theme toggle pill ── */}
                <button
                    className={`theme-toggle${dark ? ' is-dark' : ''}`}
                    onClick={toggle}
                    aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
                    title={dark ? 'Light mode' : 'Dark mode'}
                >
                    {/* Track icons — always both visible, thumb slides over one */}
                    <span className="theme-toggle-sun"><SunIcon /></span>
                    <span className="theme-toggle-moon"><MoonIcon /></span>
                    {/* Sliding thumb */}
                    <span className="theme-toggle-thumb">
            <span className="thumb-icon">
              {dark ? <MoonIcon /> : <SunIcon />}
            </span>
          </span>
                </button>

                <span className="navbar-email">{user?.email}</span>
                <button className="navbar-logout" onClick={handleLogout}>
                    Logout
                </button>
            </div>

            <style>{`
        /* ── CSS vars — applied to by ThemeContext ── */


        /* ── Navbar shell ── */
        .navbar {
          display: flex;
          align-items: center;
          background: var(--navbar-bg);
          color: var(--navbar-text);
          padding: 0 1.75rem;
          height: 56px;
          border-bottom: 1px solid rgba(255,255,255,0.07);
          position: sticky;
          top: 0;
          z-index: 200;
          font-family: 'DM Sans', 'Segoe UI', sans-serif;
          gap: 0;
          transition: background 0.25s;
        }

        /* Brand */
        .navbar-brand {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-right: 2.25rem;
          flex-shrink: 0;
        }
        .navbar-logo  { font-size: 1.35rem; color: var(--accent); }
        .navbar-title { font-weight: 700; font-size: 1rem; letter-spacing: -0.01em; color: var(--navbar-text); }
        .navbar-badge {
          background: var(--accent);
          color: #fff;
          font-size: 0.58rem;
          font-weight: 700;
          letter-spacing: 0.09em;
          text-transform: uppercase;
          padding: 2px 6px;
          border-radius: 3px;
        }

        /* Links */
        .navbar-links { display: flex; align-items: center; gap: 0.2rem; flex: 1; }
        .navbar-link {
          color: rgba(255,255,255,0.58);
          text-decoration: none;
          font-size: 0.875rem;
          font-weight: 500;
          padding: 0.375rem 0.85rem;
          border-radius: 6px;
          transition: background 0.15s, color 0.15s;
        }
        .navbar-link:hover  { background: rgba(255,255,255,0.07); color: #fff; }
        .navbar-link.active { background: rgba(255,255,255,0.11); color: #fff; font-weight: 600; }

        /* Right cluster */
        .navbar-user { display: flex; align-items: center; gap: 0.9rem; margin-left: auto; }
        .navbar-email { font-size: 0.78rem; color: rgba(255,255,255,0.45); }
        .navbar-logout {
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.11);
          color: rgba(255,255,255,0.72);
          padding: 0.3rem 0.85rem;
          border-radius: 6px;
          font-size: 0.8rem;
          cursor: pointer;
          font-family: inherit;
          transition: background 0.15s, color 0.15s;
        }
        .navbar-logout:hover { background: rgba(255,255,255,0.13); color: #fff; }

        /* ── Theme toggle ───────────────────────────────────── */
        .theme-toggle {
          position: relative;
          width: 58px;
          height: 30px;
          border-radius: 30px;
          border: none;
          cursor: pointer;
          padding: 0;
          flex-shrink: 0;
          outline: none;
          /* Track: neutral dark slab */
          background: rgba(255,255,255,0.12);
          box-shadow: inset 0 1px 3px rgba(0,0,0,0.35);
          transition: background 0.3s;
        }
        .theme-toggle:focus-visible {
          box-shadow: 0 0 0 2px var(--accent);
        }
        /* Dark state — track turns deep indigo */
        .theme-toggle.is-dark {
          background: #2e2c5e;
          box-shadow: inset 0 1px 3px rgba(0,0,0,0.5);
        }

        /* Static track icons — sun left, moon right */
        .theme-toggle-sun,
        .theme-toggle-moon {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          line-height: 0;
          transition: opacity 0.2s;
          pointer-events: none;
        }
        .theme-toggle-sun  { left: 8px;  color: rgba(255,255,255,0.35); }
        .theme-toggle-moon { right: 7px; color: rgba(255,255,255,0.35); }

        /* Sliding thumb */
        .theme-toggle-thumb {
          position: absolute;
          top: 3px;
          left: 3px;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          /* Light mode thumb: warm white */
          background: #ffffff;
          box-shadow: 0 1px 4px rgba(0,0,0,0.28), 0 0 0 0.5px rgba(0,0,0,0.08);
          transition: transform 0.28s cubic-bezier(0.34, 1.4, 0.64, 1), background 0.28s;
        }
        /* Sun icon inside thumb — amber */
        .theme-toggle:not(.is-dark) .thumb-icon { color: #f59e0b; }
        /* Shift thumb to right in dark mode */
        .theme-toggle.is-dark .theme-toggle-thumb {
          transform: translateX(28px);
          /* Dark mode thumb: deep indigo-blue */
          background: #4f46e5;
          box-shadow: 0 1px 4px rgba(0,0,0,0.4), 0 0 0 0.5px rgba(79,70,229,0.4);
        }
        /* Moon icon inside thumb — pale blue-white */
        .theme-toggle.is-dark .thumb-icon { color: #c7d2fe; }

        .thumb-icon {
          line-height: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        /* Page bg reacts to theme */
        body { background: var(--page-bg);}
      `}</style>
        </nav>
    );
}