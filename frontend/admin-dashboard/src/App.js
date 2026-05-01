/**
 * AcadHost Admin Dashboard -- App.js
 *
 * Root component. Wraps the entire application in:
 *   - BrowserRouter  (client-side routing)
 *   - ThemeProvider  (dark/light mode context — navbar pill toggle)
 *   - AuthProvider   (authentication context — Section 14.3)
 *
 * Route definitions (Section 14.2.1):
 *   /login              LoginPage           (PublicRoute)
 *   /                   DashboardPage       (ProtectedRoute → AdminLayout)
 *   /projects           ProjectsPage        (ProtectedRoute → AdminLayout)
 *   /students           StudentsPage        (ProtectedRoute → AdminLayout)
 *   /resource-requests  ResourceRequestsPage (ProtectedRoute → AdminLayout)
 */
import React, { useState } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import api from './services/api';

// Pages
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProjectsPage from './pages/ProjectsPage';
import StudentsPage from './pages/StudentsPage';
import ResourceRequestsPage from './pages/ResourceRequestsPage';

// Components
import Navbar from './components/Navbar';

function LoadingSpinner() {
  return (
      <div className="loading-spinner">
        <div className="spinner" />
      </div>
  );
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/login" replace />;
  return children;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingSpinner />;
  if (user && user.role === 'admin') return <Navigate to="/" replace />;
  return children;
}

function ForcePasswordChangeOverlay() {
  const { setUser } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmNewPassword) {
      setError('New passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await api.put('auth/password', { currentPassword, newPassword });
      setUser((prev) => ({ ...prev, mustChangePassword: false }));
      sessionStorage.removeItem('acadhost_admin_mcp');
    } catch (err) {
      const code = err.response?.data?.error;
      const msg  = err.response?.data?.message;
      if (code === 'CURRENT_PASSWORD_INCORRECT') {
        setError('Current password is incorrect.');
      } else if (code === 'PASSWORD_TOO_SHORT') {
        setError('Password must be at least 8 characters.');
      } else if (code === 'PASSWORD_TOO_LONG') {
        setError('Password must not exceed 128 characters.');
      } else if (!err.response) {
        setError('Unable to connect to the server. Please check your connection.');
      } else {
        setError(msg || 'Failed to change password. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
      <div className="force-password-overlay">
        <div className="force-password-card">
          <h2>Change Your Password</h2>
          <p>You must change your default password before continuing.</p>
          {error && <div className="error-message">{error}</div>}
          <form onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label htmlFor="cp-current">Current Password</label>
              <input id="cp-current" type="password" value={currentPassword}
                     onChange={(e) => setCurrentPassword(e.target.value)}
                     required disabled={submitting} autoComplete="current-password" />
            </div>
            <div className="form-group">
              <label htmlFor="cp-new">New Password</label>
              <input id="cp-new" type="password" value={newPassword}
                     onChange={(e) => setNewPassword(e.target.value)}
                     required disabled={submitting} autoComplete="new-password" />
            </div>
            <div className="form-group">
              <label htmlFor="cp-confirm">Confirm New Password</label>
              <input id="cp-confirm" type="password" value={confirmNewPassword}
                     onChange={(e) => setConfirmNewPassword(e.target.value)}
                     required disabled={submitting} autoComplete="new-password" />
            </div>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Changing...' : 'Change Password'}
            </button>
          </form>
        </div>
      </div>
  );
}

function AdminLayout({ children }) {
  const { user } = useAuth();
  if (user && user.mustChangePassword) {
    return <ForcePasswordChangeOverlay />;
  }
  return (
      <div className="app-shell">
        <Navbar />
        <div className="app-main">
          <main className="main-content">
            {children}
          </main>
        </div>
      </div>
  );
}

function App() {
  return (
      <BrowserRouter>
        {/* ThemeProvider must wrap AuthProvider so Navbar (inside AdminLayout)
          can call useTheme() regardless of auth state */}
        <ThemeProvider>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
              <Route path="/" element={<ProtectedRoute><AdminLayout><DashboardPage /></AdminLayout></ProtectedRoute>} />
              <Route path="/projects" element={<ProtectedRoute><AdminLayout><ProjectsPage /></AdminLayout></ProtectedRoute>} />
              <Route path="/students" element={<ProtectedRoute><AdminLayout><StudentsPage /></AdminLayout></ProtectedRoute>} />
              <Route path="/resource-requests" element={<ProtectedRoute><AdminLayout><ResourceRequestsPage /></AdminLayout></ProtectedRoute>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
  );
}

export default App;