import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import api from '../services/api';

const NAV_ITEMS = [
  { to: '/home',              label: 'Dashboard' },
  { to: '/projects',          label: 'Projects'  },
  { to: '/databases',         label: 'Databases' },
  { to: '/resource-requests', label: 'Requests'  },
];

function initialsFrom(user) {
  if (!user) return '?';
  const base = user.name || user.email || '?';
  const parts = base.trim().split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function Navbar() {
  const { user, logout } = useAuth();
  const { darkMode, toggleDarkMode } = useTheme();
  const navigate = useNavigate();
  const [menuOpen,   setMenuOpen]   = useState(false);
  const [navOpen,    setNavOpen]    = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const handleLogout = async () => {
    setLoggingOut(true);
    try   { await logout(); }
    finally {
      setLoggingOut(false);
      setMenuOpen(false);
      navigate('/login');
    }
  };

  const handleThemeToggle = () => { toggleDarkMode(api); };

  return (
      <nav style={styles.nav}>
        {/* ── Embedded theme variables ─────────────────────────────────── */}
        <style>{`
          /* ── DARK mode navbar ── */
          
          /* ── Nav base ── */
          @media (max-width: 768px) {
            .nav-list-desktop { display: none !important; }
            .nav-hamburger    { display: inline-flex !important; }
          }
          .nav-list-desktop {
            display: flex;
            list-style: none;
            gap: 0.1rem;
            align-items: center;
          }

          /* ── Avatar button ── */
          .avatar {
            width: 30px;
            height: 30px;
            border-radius: 50%;
            background: var(--navbar-avatar-bg);
            color: var(--navbar-active);
            border: 1.5px solid var(--navbar-active);
            font-size: 0.65rem;
            font-weight: 700;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            letter-spacing: 0.04em;
            transition: opacity 0.15s;
          }
          .avatar:hover { opacity: 0.8; }

          /* ── Dropdown menu ── */
          .avatar-menu {
            position: absolute;
            top: calc(100% + 8px);
            right: 0;
            min-width: 210px;
            background: var(--navbar-menu-bg);
            border: 1px solid var(--navbar-border);
            border-radius: 6px;
            box-shadow: var(--navbar-menu-shadow);
            overflow: hidden;
            z-index: 200;
            animation: menuFadeIn 0.15s ease;
          }
          @keyframes menuFadeIn {
            from { opacity: 0; transform: translateY(-4px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .avatar-email {
            padding: 0.75rem 1rem;
            font-size: 0.75rem;
            color: #6b7280;
            border-bottom: 1px solid rgba(0,0,0,0.09);
            line-height: 1.4;
          }
          .avatar-menu-item {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            width: 100%;
            padding: 0.6rem 1rem;
            font-size: 0.78rem;
            font-weight: 500;
            color: #111113;
            background: transparent;
            border: none;
            cursor: pointer;
            text-decoration: none;
            text-align: left;
            transition: background 0.12s;
            letter-spacing: 0.01em;
          }
          .avatar-menu-item:hover {
            background: rgba(0,0,0,0.05);
          }
          .avatar-menu-divider {
            height: 1px;
            background: rgba(0,0,0,0.08);
            margin: 0.25rem 0;
          }

          /* ── Icon button (theme toggle, hamburger) ── */
          .nav-icon-btn {
            background: transparent;
            border: 1px solid var(--navbar-border);
            border-radius: 4px;
            color: var(--navbar-text-muted);
            cursor: pointer;
            padding: 0.3rem 0.55rem;
            height: 30px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            transition: background 0.15s, color 0.15s, border-color 0.15s;
          }
          .nav-icon-btn:hover {
            background: var(--navbar-hover-bg);
            color: var(--navbar-text);
            border-color: rgba(255,255,255,0.3);
          }

          /* ── Nav link hover ── */
          .nav-link-item:hover {
            color: var(--navbar-text) !important;
          }
        `}</style>

        <div style={styles.inner}>
          {/* Brand */}
          <NavLink to="/home" style={styles.brand}>
            <span style={styles.brandDot} />
            <span style={{ fontWeight: 700, letterSpacing: '0.02em', color: 'var(--navbar-text)' }}>ACADHOST</span>
          </NavLink>

          {/* Desktop links */}
          <ul style={styles.navList} className="nav-list-desktop">
            {NAV_ITEMS.map(item => (
                <li key={item.to}>
                  <NavLink
                      to={item.to}
                      className="nav-link-item"
                      style={({ isActive }) => ({
                        ...styles.navLink,
                        color: isActive ? 'var(--navbar-active)' : 'var(--navbar-text-muted)',
                        borderBottom: isActive ? '2px solid var(--navbar-active)' : '2px solid transparent',
                      })}
                  >
                    {item.label}
                  </NavLink>
                </li>
            ))}
          </ul>

          {/* Right side */}
          <div style={styles.right}>
            {/* Theme toggle */}
            <button
                onClick={handleThemeToggle}
                title={darkMode ? 'Switch to light' : 'Switch to dark'}
                className="nav-icon-btn"
                aria-label="Toggle theme"
            >
              {darkMode ? (
                  /* Sun icon */
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="5"/>
                    <line x1="12" y1="1" x2="12" y2="3"/>
                    <line x1="12" y1="21" x2="12" y2="23"/>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                    <line x1="1" y1="12" x2="3" y2="12"/>
                    <line x1="21" y1="12" x2="23" y2="12"/>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                  </svg>
              ) : (
                  /* Moon icon */
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                  </svg>
              )}
            </button>

            {/* Avatar + dropdown */}
            <div ref={menuRef} style={{ position: 'relative' }}>
              <button
                  className="avatar"
                  onClick={() => setMenuOpen(o => !o)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  title={user?.email || 'Account'}
              >
                {initialsFrom(user)}
              </button>

              {menuOpen && (
                  <div className="avatar-menu" role="menu">
                    <div className="avatar-email">
                      <div style={{ fontWeight: 700, color: '#111113', fontSize: '0.82rem' }}>
                        {user?.name || 'Student'}
                      </div>
                      <div style={{ marginTop: '0.1rem' }}>{user?.email}</div>
                    </div>

                    <NavLink
                        to="/profile"
                        className="avatar-menu-item"
                        onClick={() => setMenuOpen(false)}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0, opacity:0.6 }}>
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                      </svg>
                      Profile &amp; Settings
                    </NavLink>

                    <button
                        className="avatar-menu-item"
                        onClick={handleThemeToggle}
                    >
                      {darkMode ? (
                          <>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0, opacity:0.6 }}>
                              <circle cx="12" cy="12" r="5"/>
                              <line x1="12" y1="1" x2="12" y2="3"/>
                              <line x1="12" y1="21" x2="12" y2="23"/>
                              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                              <line x1="1" y1="12" x2="3" y2="12"/>
                              <line x1="21" y1="12" x2="23" y2="12"/>
                              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                            </svg>
                            Light Mode
                          </>
                      ) : (
                          <>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0, opacity:0.6 }}>
                              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                            </svg>
                            Dark Mode
                          </>
                      )}
                    </button>

                    <div className="avatar-menu-divider" />

                    <button
                        className="avatar-menu-item"
                        onClick={handleLogout}
                        disabled={loggingOut}
                        style={{ color: '#e05c5c' }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0, opacity:0.7 }}>
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                      </svg>
                      {loggingOut ? 'Signing out…' : 'Sign out'}
                    </button>
                  </div>
              )}
            </div>

            {/* Mobile hamburger */}
            <button
                style={{ ...styles.iconBtnBase, display: 'none', fontSize: '1rem' }}
                className="nav-icon-btn nav-hamburger"
                onClick={() => setNavOpen(o => !o)}
                aria-label="Menu"
            >☰</button>
          </div>
        </div>

        {/* Mobile menu */}
        {navOpen && (
            <div style={styles.mobileMenu}>
              {NAV_ITEMS.map(item => (
                  <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setNavOpen(false)}
                      style={({ isActive }) => ({
                        ...styles.mobileLink,
                        color: isActive ? 'var(--navbar-active)' : 'var(--navbar-text)',
                      })}
                  >
                    {item.label}
                  </NavLink>
              ))}
              <NavLink to="/profile" onClick={() => setNavOpen(false)} style={styles.mobileLink}>
                Profile
              </NavLink>
            </div>
        )}
      </nav>
  );
}

const styles = {
  nav: {
    background:   'var(--navbar-bg)',
    borderBottom: '1px solid var(--navbar-border)',
    position:     'sticky',
    top:          0,
    zIndex:       100,
  },
  inner: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    maxWidth:       '1280px',
    margin:         '0 auto',
    padding:        '0 1.5rem',
    height:         '52px',
    gap:            '1rem',
  },
  brand: {
    display:        'flex',
    alignItems:     'center',
    gap:            '0.5rem',
    fontSize:       '0.85rem',
    textDecoration: 'none',
    flexShrink:     0,
  },
  brandDot: {
    width:        '8px',
    height:       '8px',
    background:   'var(--navbar-active)',
    borderRadius: '50%',
    display:      'inline-block',
    flexShrink:   0,
  },
  navList: {
    display:        'flex',
    listStyle:      'none',
    gap:            '0.1rem',
    alignItems:     'center',
    flex:           1,
    justifyContent: 'center',
    margin:         0,
    padding:        0,
  },
  navLink: {
    display:        'flex',
    alignItems:     'center',
    padding:        '0 0.85rem',
    height:         '52px',
    fontSize:       '0.72rem',
    fontWeight:     600,
    textDecoration: 'none',
    letterSpacing:  '0.08em',
    textTransform:  'uppercase',
    transition:     'color 0.15s',
  },
  right: {
    display:    'flex',
    alignItems: 'center',
    gap:        '0.6rem',
    flexShrink: 0,
  },
  iconBtnBase: {
    background:     'transparent',
    border:         '1px solid var(--navbar-border)',
    borderRadius:   '4px',
    color:          'var(--navbar-text-muted)',
    cursor:         'pointer',
    padding:        '0.3rem 0.55rem',
    height:         '30px',
    lineHeight:     1,
    display:        'inline-flex',
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
  },
  mobileMenu: {
    background:    'var(--navbar-bg)',
    borderTop:     '1px solid var(--navbar-border)',
    display:       'flex',
    flexDirection: 'column',
  },
  mobileLink: {
    padding:        '0.85rem 1.5rem',
    fontSize:       '0.82rem',
    fontWeight:     600,
    textDecoration: 'none',
    borderBottom:   '1px solid var(--navbar-border)',
    textTransform:  'uppercase',
    letterSpacing:  '0.08em',
  },
};