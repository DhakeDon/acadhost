import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { registerAuthHandlers } from './services/api';

// Pages
import LoginPage             from './pages/LoginPage';
import RegisterPage          from './pages/RegisterPage';
import HomePage              from './pages/HomePage';
import ProjectsPage          from './pages/ProjectsPage';
import DatabasesPage         from './pages/DatabasesPage';
import ResourceRequestsPage  from './pages/ResourceRequestsPage';

// Components
import LandingPage from './components/LandingPage';
import Profile     from './components/Profile';
import Navbar      from './components/Navbar';

// ─────────────────────────────────────────────────────────────────────────────
// ApiAuthBridge
// Registers auth handlers from AuthContext into api.js so the Axios
// interceptor can read/update the in-memory access token.
// ─────────────────────────────────────────────────────────────────────────────
function ApiAuthBridge() {
  const { accessToken, updateAccessToken, logout } = useAuth();

  useEffect(() => {
    registerAuthHandlers({
      getAccessToken: () => accessToken,
      updateToken:    updateAccessToken,
      clearAuth:      logout,
    });
  }, [accessToken, updateAccessToken, logout]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ProtectedRoute
// Blocks access when:
//   - Still loading (initial refresh in progress)
//   - No authenticated user
//   - User is not a student
//   - User must change their password (forces /profile)
// ─────────────────────────────────────────────────────────────────────────────
function ProtectedRoute({ children }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="page-loading">
        <div className="spinner spinner-lg" aria-label="Loading…" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user.role !== 'student') {
    // Admin accidentally hit the student dashboard.
    return <Navigate to="/login" replace />;
  }

  if (user.mustChangePassword && location.pathname !== '/profile') {
    return <Navigate to="/profile" replace />;
  }

  return children;
}

// ─────────────────────────────────────────────────────────────────────────────
// PublicRoute
// Redirects authenticated students away from login / register pages.
// ─────────────────────────────────────────────────────────────────────────────
function PublicRoute({ children }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="page-loading">
        <div className="spinner spinner-lg" aria-label="Loading…" />
      </div>
    );
  }

  if (user && user.role === 'student') {
    return <Navigate to="/home" replace />;
  }

  return children;
}

// ─────────────────────────────────────────────────────────────────────────────
// AuthedLayout — wraps every protected page with the Navbar
// ─────────────────────────────────────────────────────────────────────────────
function AuthedLayout({ children }) {
  return (
    <div className="page-layout">
      <Navbar />
      <main className="page-main">
        {children}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AppRoutes
// ─────────────────────────────────────────────────────────────────────────────
function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<LandingPage />} />

      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />

      <Route
        path="/register"
        element={
          <PublicRoute>
            <RegisterPage />
          </PublicRoute>
        }
      />

      {/* Public — password reset link from email */}
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* Protected — student only */}
      <Route
        path="/home"
        element={
          <ProtectedRoute>
            <AuthedLayout>
              <HomePage />
            </AuthedLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/projects/*"
        element={
          <ProtectedRoute>
            <AuthedLayout>
              <ProjectsPage />
            </AuthedLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/databases"
        element={
          <ProtectedRoute>
            <AuthedLayout>
              <DatabasesPage />
            </AuthedLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/resource-requests"
        element={
          <ProtectedRoute>
            <AuthedLayout>
              <ResourceRequestsPage />
            </AuthedLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <AuthedLayout>
              <Profile />
            </AuthedLayout>
          </ProtectedRoute>
        }
      />

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// Inline ResetPasswordPage (simple, no auth required)
function ResetPasswordPage() {
  const [newPassword,     setNewPassword]     = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [status,          setStatus]          = React.useState('idle'); // idle|loading|success|error
  const [errorMsg,        setErrorMsg]        = React.useState('');
  const navigate = useNavigate();

  const token = new URLSearchParams(window.location.search).get('token');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');
      return;
    }
    if (newPassword.length > 128) {
      setErrorMsg('Password must not exceed 128 characters.');
      return;
    }

    setStatus('loading');
    try {
      const res  = await fetch('/api/auth/reset-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      const body = await res.json();

      if (!res.ok || !body.success) {
        const codeMap = {
          TOKEN_INVALID:    'This reset link is invalid.',
          TOKEN_USED:       'This reset link has already been used.',
          TOKEN_EXPIRED:    'This reset link has expired. Please request a new one.',
          PASSWORD_TOO_SHORT: 'Password must be at least 8 characters.',
          PASSWORD_TOO_LONG:  'Password must not exceed 128 characters.',
        };
        setErrorMsg(codeMap[body.error] || body.message || 'Reset failed.');
        setStatus('error');
        return;
      }

      setStatus('success');
      setTimeout(() => navigate('/login'), 2200);
    } catch {
      setErrorMsg('Network error. Please try again.');
      setStatus('error');
    }
  };

  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', padding:'1rem' }}>
      <div className="card" style={{ width:'100%', maxWidth:420 }}>
        <div className="card-body">
          <h1 style={{ fontSize:'1.4rem', fontWeight:800, marginBottom:'0.25rem' }}>Reset Password</h1>
          <p style={{ fontSize:'0.85rem', color:'var(--text-muted)', marginBottom:'1.5rem' }}>
            Enter your new password below.
          </p>

          {status === 'success' ? (
            <div className="alert alert-success">
              Password reset successfully. Redirecting to login…
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">New Password</label>
                <input
                  className={`input${errorMsg ? ' input-error' : ''}`}
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  maxLength={128}
                  placeholder="8–128 characters"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Confirm Password</label>
                <input
                  className={`input${errorMsg ? ' input-error' : ''}`}
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  placeholder="Repeat new password"
                />
              </div>

              {errorMsg && (
                <div className="alert alert-error" style={{ marginBottom:'1rem' }}>{errorMsg}</div>
              )}

              <button
                className="btn btn-primary"
                type="submit"
                disabled={status === 'loading'}
                style={{ width:'100%' }}
              >
                {status === 'loading' ? <><span className="spinner" /> Resetting…</> : 'Set New Password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
      <ApiAuthBridge />
      <AppRoutes />
    </BrowserRouter>
  );
}
