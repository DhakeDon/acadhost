import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// ThemeContext v2 — NO FLASH on refresh.
//
// Problem with v1: theme initialised to `false` (light), then updated when
// profile loaded. That caused a "light → dark" flash on every reload for
// dark-mode users.
//
// Solution: persist the choice to localStorage the moment it changes.
// Read it synchronously on mount, apply the class BEFORE React renders the
// first paint. Then — once the profile loads — reconcile against the server
// value in case the user toggled theme on a different device.
// ─────────────────────────────────────────────────────────────────────────────

const ThemeContext = createContext(null);
const STORAGE_KEY = 'acadhost-dark-mode';

function readStoredTheme() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === '1' || raw === 'true') return true;
    if (raw === '0' || raw === 'false') return false;
  } catch { /* private mode, etc. */ }
  // Fall back to OS preference if no stored value.
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function applyThemeClass(darkMode) {
  const el = document.documentElement;
  if (darkMode) {
    el.classList.add('dark');
    el.classList.remove('light');
  } else {
    el.classList.add('light');
    el.classList.remove('dark');
  }
}

// Apply the class IMMEDIATELY (before React mounts) so there's no flash.
// This runs as a side effect of the module import.
if (typeof document !== 'undefined') {
  applyThemeClass(readStoredTheme());
}

export function ThemeProvider({ children }) {
  const [darkMode, setDarkModeState] = useState(() => readStoredTheme());

  // Apply class whenever darkMode changes.
  useEffect(() => {
    applyThemeClass(darkMode);
    try { window.localStorage.setItem(STORAGE_KEY, darkMode ? '1' : '0'); }
    catch { /* ignore */ }
  }, [darkMode]);

  // Reconcile with server value once profile loads. If server disagrees
  // with localStorage, server wins silently (user may have toggled elsewhere).
  const initTheme = useCallback((isDark) => {
    const bool = Boolean(isDark);
    setDarkModeState(bool);
  }, []);

  // Toggle + persist to backend. Optimistic with rollback.
  const toggleDarkMode = useCallback(async (api) => {
    const newValue = !darkMode;
    setDarkModeState(newValue);  // local + localStorage (via effect)
    try {
      if (api) await api.put('/student/dark-mode', { darkMode: newValue });
    } catch {
      setDarkModeState(darkMode);  // rollback on API failure
    }
  }, [darkMode]);

  return (
      <ThemeContext.Provider value={{ darkMode, initTheme, toggleDarkMode }}>
        {children}
      </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

export default ThemeContext;