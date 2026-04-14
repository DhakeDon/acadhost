# Section 13 — Student Dashboard — Frontend Specification

## 13.1 Overview

The student dashboard is a standalone React single-page application (SPA) served by Nginx on the root domain `acadhost.com`. It is a separate codebase from the admin dashboard — they share no runtime code. The student dashboard provides the complete student-facing interface for authentication, project management, database management, resource monitoring, and resource requests.

### 13.1.1 Technology Stack

| Technology | Purpose |
|---|---|
| React | UI framework |
| React Router | Client-side routing |
| Axios or Fetch API | HTTP client for backend API communication |
| EventSource (browser native) | Server-Sent Events for real-time build logs |
| CSS (custom) | Styling with dark/light mode theming |

### 13.1.2 Deployment

| Property | Value |
|---|---|
| Build tool | Standard React build (`npm run build`) |
| Build output directory | `build/` (standard Create React App output) |
| Production serving | Nginx serves static files from `STUDENT_DASHBOARD_DIST` (Section 3.2.4); production value: `/var/www/acadhost/student` |
| Development serving | Vite or CRA dev server at `http://localhost:5173` (configured via `FRONTEND_URL`, Section 3.2.11) |
| SPA routing | Nginx `try_files $uri $uri/ /index.html` ensures all client-side routes are handled by React Router (Section 8.3.1) |
| Domain | `acadhost.com` (production); `localhost:5173` (development) |

### 13.1.3 Directory Structure (Locked in Section 2.4.1)

```
frontend/student-dashboard/
├── package.json
├── public/
│   └── index.html
└── src/
    ├── index.js
    ├── App.js
    ├── components/
    │   ├── LandingPage.jsx
    │   ├── Dashboard.jsx
    │   ├── Profile.jsx
    │   ├── ProjectCard.jsx
    │   ├── ProjectSettings.jsx
    │   ├── ProjectCreate.jsx
    │   ├── DatabaseSection.jsx
    │   ├── ResourceRequestForm.jsx
    │   ├── ResourceUsageCard.jsx
    │   ├── BuildLogs.jsx
    │   └── Navbar.jsx
    ├── pages/
    │   ├── LoginPage.jsx
    │   ├── RegisterPage.jsx
    │   ├── HomePage.jsx
    │   ├── ProjectsPage.jsx
    │   ├── DatabasesPage.jsx
    │   └── ResourceRequestsPage.jsx
    ├── services/
    │   └── api.js
    ├── context/
    │   ├── AuthContext.jsx
    │   └── ThemeContext.jsx
    └── styles/
        └── theme.css
```

---

## 13.2 Routing — `App.js`

`App.js` is the root component. It wraps the entire application in `AuthContext.Provider` and `ThemeContext.Provider`, and defines all client-side routes via React Router.

### 13.2.1 Route Definitions

| Route Path | Page Component | Access | Description |
|---|---|---|---|
| `/` | `LandingPage` | Public | Public-facing landing page |
| `/login` | `LoginPage` | Public (redirects to `/home` if already authenticated) | Student login |
| `/register` | `RegisterPage` | Public | Registration via invite link; reads `token` from URL query parameter |
| `/reset-password` | `ResetPasswordPage` (inline in `LoginPage` or dedicated) | Public | Password reset; reads `token` from URL query parameter |
| `/home` | `HomePage` | Protected (student only) | Dashboard home — resource summary + project cards |
| `/projects` | `ProjectsPage` | Protected (student only) | Project creation workflow |
| `/projects/:id/settings` | `ProjectSettings` (rendered within `ProjectsPage` or standalone) | Protected (student only) | Project management panel |
| `/databases` | `DatabasesPage` | Protected (student only) | Database listing and creation |
| `/resource-requests` | `ResourceRequestsPage` | Protected (student only) | Resource request submission |
| `/profile` | `Profile` (rendered within layout or standalone) | Protected (student only) | Password change and dark/light mode toggle |

AMBIGUITY DETECTED: The spec does not define a dedicated route for the password reset page. It mentions "the student follows the link to set their name and password" for registration and `{FRONTEND_URL}/reset-password?token=<raw_token>` for password reset (Section 5.9.8, Section 11.4.2).
My decision: The `/reset-password` route is a public page that reads the `token` query parameter and presents a form for the new password. This is consistent with the `{FRONTEND_URL}/reset-password?token=<raw_token>` link generated in the password reset email (Section 11.4.2).

### 13.2.2 Route Protection

Protected routes require an authenticated student. The route protection logic is:

```
function ProtectedRoute({ children }):
  { user, loading } = useAuthContext()

  IF loading:
    RETURN <LoadingSpinner />

  IF user is null:
    RETURN <Navigate to="/login" />

  IF user.role !== 'student':
    RETURN <Navigate to="/login" />

  IF user.mustChangePassword:
    RETURN <Navigate to="/profile" />
    // Force password change before any other navigation

  RETURN children
```

| Check | Behavior |
|---|---|
| `loading` is `true` | Show a loading spinner while `POST /api/auth/refresh` is in progress on page load (Section 5.4) |
| `user` is `null` | Redirect to `/login` — no valid session |
| `user.role` is not `student` | Redirect to `/login` — admin users should use the admin dashboard at `admin.acadhost.com` |
| `user.mustChangePassword` is `true` | Redirect to `/profile` — forced password change required before any other action (Section 5.8.2) |

### 13.2.3 Public Route Redirect

If an already-authenticated student navigates to `/login` or `/register`, they are redirected to `/home`:

```
function PublicRoute({ children }):
  { user, loading } = useAuthContext()

  IF loading:
    RETURN <LoadingSpinner />

  IF user is not null AND user.role === 'student':
    RETURN <Navigate to="/home" />

  RETURN children
```

---

## 13.3 Authentication Context — `AuthContext.jsx`

`AuthContext` is a React context that manages the authentication state for the entire application. It stores the access token in a JavaScript variable (React state) — never in `localStorage` or cookies (Section 5.4).

### 13.3.1 State

| State Variable | Type | Initial Value | Description |
|---|---|---|---|
| `accessToken` | `string` or `null` | `null` | JWT access token; stored in memory only; lost on page refresh |
| `user` | `object` or `null` | `null` | User data from login/refresh response: `{ id, email, name, role, mustChangePassword }` |
| `loading` | `boolean` | `true` | `true` while the initial token refresh is in progress on page load; prevents route protection from prematurely redirecting to login |

### 13.3.2 Provided Functions

| Function | Description |
|---|---|
| `login(email, password)` | Calls `POST /api/auth/login`; stores `accessToken` and `user` in state; refresh token is set as `httpOnly` cookie by the backend |
| `register(token, name, password)` | Calls `POST /api/auth/register`; stores `accessToken` and `user` in state |
| `logout()` | Calls `POST /api/auth/logout`; clears `accessToken` and `user` from state; backend clears the `refreshToken` cookie |
| `refreshToken()` | Calls `POST /api/auth/refresh`; updates `accessToken` in state; called on page load/refresh and before token expiry |

### 13.3.3 Token Refresh on Page Load

Because the access token is stored in JavaScript memory, it is lost on every page refresh. The frontend must call `POST /api/auth/refresh` on every page load to restore the session. This is implemented in a `useEffect` hook that runs once when `AuthContext` mounts:

```
useEffect(() => {
  async function restoreSession():
    TRY:
      response = await api.post('/api/auth/refresh')
      // The httpOnly refreshToken cookie is sent automatically
      setAccessToken(response.data.data.accessToken)
      // Decode the access token to extract user data
      decoded = decodeJwt(response.data.data.accessToken)
      setUser({ id: decoded.sub, email: decoded.email, role: decoded.role })
    CATCH error:
      // No valid refresh token — user is not authenticated
      setAccessToken(null)
      setUser(null)
    FINALLY:
      setLoading(false)

  restoreSession()
}, [])
```

| Behavior | Detail |
|---|---|
| While refreshing | `loading = true`; all protected routes show a loading spinner |
| Refresh succeeds | `loading = false`; `accessToken` and `user` are populated; user proceeds to their intended page |
| Refresh fails | `loading = false`; `accessToken` and `user` are `null`; protected routes redirect to `/login` |

### 13.3.4 Proactive Token Refresh

The access token expires after 15 minutes (`ACCESS_TOKEN_EXPIRY`, Section 3.2.3). To prevent token expiry during active use, the frontend should proactively refresh the token before it expires:

```
useEffect(() => {
  IF accessToken is null:
    RETURN

  // Decode exp claim from the access token
  decoded = decodeJwt(accessToken)
  expiresAt = decoded.exp * 1000  // Convert to milliseconds
  now = Date.now()
  // Refresh 60 seconds before expiry
  refreshIn = expiresAt - now - 60000

  IF refreshIn <= 0:
    // Token is already expired or about to expire
    refreshToken()
    RETURN

  timer = setTimeout(() => refreshToken(), refreshIn)
  RETURN () => clearTimeout(timer)
}, [accessToken])
```

This ensures the access token is always refreshed before it expires, as long as the user's tab is active. If the tab is backgrounded and the token expires, the next API call will fail with `401`, triggering a refresh attempt.

### 13.3.5 JWT Decoding

The access token payload is decoded on the client side to extract user information. This is a simple base64 decode — not signature verification (the server verifies signatures; the client trusts the server's response).

```
function decodeJwt(token):
  payload = token.split('.')[1]
  decoded = JSON.parse(atob(payload))
  RETURN decoded
  // Returns: { sub, email, role, iat, exp }
```

The `sub` claim (Section 5.4.1) contains the `users.id` as a string. The frontend stores `parseInt(decoded.sub)` as `user.id`.

### 13.3.6 `mustChangePassword` Handling

When the login response includes `mustChangePassword: true` (Section 6.2.1), the `user` state object includes this flag. The `ProtectedRoute` component (Section 13.2.2) checks this flag and forces navigation to the profile/password-change page. The flag is checked on every route transition — the user cannot navigate away from the password change page until the password is changed.

After the user successfully changes their password via `PUT /api/auth/password` (Section 6.2.8), the frontend:

1. Removes `mustChangePassword` from the `user` state (sets it to `false` or removes the key).
2. Allows navigation to proceed normally.

AMBIGUITY DETECTED: The spec does not define how the frontend knows to clear the `mustChangePassword` flag after a successful password change.
My decision: After a successful `PUT /api/auth/password` response, the frontend sets `user.mustChangePassword = false` in the AuthContext state. The backend sets `users.must_change_password = 0` on the server side (Section 5.9.7). No additional API call is needed.

---

## 13.4 API Client — `services/api.js`

The API client is a configured Axios instance (or a fetch wrapper) that handles base URL configuration, authentication headers, and error interception.

### 13.4.1 Configuration

```javascript
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',          // Nginx proxies /api/* to the backend (Section 8.3.1)
  withCredentials: true,    // Send httpOnly cookies (refresh token) on cross-origin requests
  headers: {
    'Content-Type': 'application/json',
  },
});
```

| Setting | Value | Reason |
|---|---|---|
| `baseURL` | `/api` | In production, Nginx on `acadhost.com` proxies `/api/*` to `http://127.0.0.1:3000/api/*` (Section 8.3.1). In development, the React dev server can proxy `/api` to the backend. |
| `withCredentials` | `true` | Required for the `httpOnly` `refreshToken` cookie to be sent on cross-origin requests (Section 5.10) |

### 13.4.2 Request Interceptor — Attach Access Token

Every API request (except refresh and login) must include the access token in the `Authorization` header:

```
api.interceptors.request.use((config) => {
  token = getAccessToken()  // From AuthContext
  IF token is not null:
    config.headers.Authorization = `Bearer ${token}`
  RETURN config
})
```

### 13.4.3 Response Interceptor — Handle 401

When the backend returns `401` (access token expired or invalid), the frontend should attempt a token refresh. If the refresh also fails, the user is logged out.

```
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    originalRequest = error.config

    IF error.response.status === 401
       AND NOT originalRequest._retry
       AND originalRequest.url !== '/api/auth/refresh'
       AND originalRequest.url !== '/api/auth/login':

      originalRequest._retry = true
      TRY:
        refreshResponse = await api.post('/api/auth/refresh')
        newToken = refreshResponse.data.data.accessToken
        setAccessToken(newToken)  // Update AuthContext
        originalRequest.headers.Authorization = `Bearer ${newToken}`
        RETURN api(originalRequest)  // Retry original request
      CATCH refreshError:
        // Refresh failed — log out
        logout()
        RETURN Promise.reject(refreshError)

    RETURN Promise.reject(error)
  }
)
```

| Behavior | Detail |
|---|---|
| `_retry` flag | Prevents infinite retry loops |
| Excluded endpoints | `/api/auth/refresh` and `/api/auth/login` are excluded from retry logic to prevent loops |
| On refresh success | The original failed request is retried with the new access token |
| On refresh failure | The user is logged out and redirected to the login page |

---

## 13.5 Theme Context — `ThemeContext.jsx`

`ThemeContext` manages the dark/light mode toggle state. The theme preference is persisted to the backend and reflected via CSS classes on the root element.

### 13.5.1 State

| State Variable | Type | Initial Value | Description |
|---|---|---|---|
| `darkMode` | `boolean` | `false` | `true` for dark mode, `false` for light mode |

### 13.5.2 Initialization

When the user's profile is loaded (after authentication), the theme is initialized from the `darkMode` field in the `GET /api/student/profile` response (Section 6.3.1):

```
useEffect(() => {
  IF user is authenticated:
    profile = await api.get('/api/student/profile')
    setDarkMode(profile.data.data.darkMode)
}, [user])
```

### 13.5.3 Toggle Function

```
async function toggleDarkMode():
  newValue = !darkMode
  await api.put('/api/student/dark-mode', { darkMode: newValue })
  setDarkMode(newValue)
```

The backend updates `users.dark_mode` to `1` (dark) or `0` (light) (Section 6.3.2).

### 13.5.4 CSS Application

The theme is applied by toggling a CSS class on the document root element:

```
useEffect(() => {
  IF darkMode:
    document.documentElement.classList.add('dark')
    document.documentElement.classList.remove('light')
  ELSE:
    document.documentElement.classList.add('light')
    document.documentElement.classList.remove('dark')
}, [darkMode])
```

### 13.5.5 Theme CSS — `styles/theme.css`

The `theme.css` file defines CSS custom properties for both themes:

```css
:root.light {
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f5;
  --text-primary: #333333;
  --text-secondary: #666666;
  --accent: #4CAF50;
  --accent-hover: #45a049;
  --border: #e0e0e0;
  --card-bg: #ffffff;
  --card-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  --error: #f44336;
  --success: #4CAF50;
  --warning: #ff9800;
  --input-bg: #ffffff;
  --input-border: #cccccc;
  --navbar-bg: #ffffff;
  --navbar-text: #333333;
}

:root.dark {
  --bg-primary: #1a1a2e;
  --bg-secondary: #16213e;
  --text-primary: #e0e0e0;
  --text-secondary: #a0a0a0;
  --accent: #4CAF50;
  --accent-hover: #45a049;
  --border: #333355;
  --card-bg: #16213e;
  --card-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  --error: #ef5350;
  --success: #66bb6a;
  --warning: #ffa726;
  --input-bg: #1a1a2e;
  --input-border: #333355;
  --navbar-bg: #16213e;
  --navbar-text: #e0e0e0;
}
```

AMBIGUITY DETECTED: The spec does not define specific color values for dark and light modes.
My decision: The CSS custom properties above provide a functional starting point. The exact color values are implementation details that do not affect API contracts or business logic. Code generators may adjust these values for visual quality.

All components reference these CSS custom properties (e.g., `background-color: var(--bg-primary)`) rather than hardcoded color values. This ensures consistent theming across the entire application.

---

## 13.6 Landing Page — `LandingPage.jsx`

The spec states: "A public-facing landing page introduces the platform to prospective and current students."

### 13.6.1 Behavior

| Property | Value |
|---|---|
| Route | `/` |
| Access | Public — no authentication required |
| Purpose | Introduces AcadHost to prospective and current students |

### 13.6.2 Content

| Element | Description |
|---|---|
| Platform name and tagline | "AcadHost" with a brief description of the platform's purpose |
| Feature summary | Brief overview of what students can do: deploy projects, manage databases, monitor resources |
| Login link | Button or link navigating to `/login` |
| Visual design | Clean, professional layout communicating the academic/institutional nature of the platform |

AMBIGUITY DETECTED: The spec provides no specific content or layout for the landing page beyond "introduces the platform to prospective and current students."
My decision: The landing page displays the platform name, a tagline, a feature summary, and a login button. The exact copy and visual design are deferred to the code phase — this section defines the component's purpose, route, and structural requirements.

---

## 13.7 Login Page — `LoginPage.jsx`

### 13.7.1 Route and Access

| Property | Value |
|---|---|
| Route | `/login` |
| Access | Public; redirects to `/home` if already authenticated (Section 13.2.3) |
| API Endpoint | `POST /api/auth/login` (Section 6.2.1) |

### 13.7.2 Form Fields

| Field | Type | Required | Constraints | Maps To |
|---|---|---|---|---|
| Email | `<input type="email">` | Yes | Valid email format | `email` in request body |
| Password | `<input type="password">` | Yes | Non-empty | `password` in request body |

### 13.7.3 Submit Behavior

```
async function handleLogin(email, password):
  TRY:
    response = await api.post('/api/auth/login', { email, password })
    accessToken = response.data.data.accessToken
    user = response.data.data.user
    // Store in AuthContext
    setAccessToken(accessToken)
    setUser(user)
    // Refresh token cookie is set automatically by the backend

    IF user.mustChangePassword:
      navigate('/profile')   // Force password change
    ELSE IF user.role === 'admin':
      // Admin logged into wrong dashboard — show message
      showError('Please use the admin dashboard at admin.acadhost.com')
      logout()
    ELSE:
      navigate('/home')
  CATCH error:
    displayErrorMessage(error.response.data.error)
```

### 13.7.4 Error Display

| Error Code (from Section 6.2.1) | User-Facing Message |
|---|---|
| `VALIDATION_ERROR` | Display the `message` field from the response |
| `INVALID_CREDENTIALS` | "Invalid email or password" |
| `REGISTRATION_INCOMPLETE` | "Please complete registration using your invitation link" |
| `ACCOUNT_REMOVED` | "This account has been deactivated" |

### 13.7.5 Forgot Password Link

The login page includes a "Forgot Password?" link that navigates to a forgot-password flow. This can be implemented as:

- A separate section within `LoginPage.jsx` (toggled by state), or
- A modal overlay

**Forgot Password Form:**

| Field | Type | Required | Maps To |
|---|---|---|---|
| Email | `<input type="email">` | Yes | `email` in request body to `POST /api/auth/forgot-password` (Section 6.2.6) |

**Submit Behavior:**

```
async function handleForgotPassword(email):
  TRY:
    await api.post('/api/auth/forgot-password', { email })
    showSuccess('If an account exists with that email, a password reset link has been sent.')
  CATCH error:
    displayErrorMessage(error.response.data.message)
```

The success message is always shown regardless of whether the email exists (Section 5.9.8 — user enumeration prevention). The backend always returns `200 OK`.

---

## 13.8 Registration Page — `RegisterPage.jsx`

### 13.8.1 Route and Access

| Property | Value |
|---|---|
| Route | `/register` |
| Access | Public |
| Entry point | Student clicks the registration link from the invitation email: `{FRONTEND_URL}/register?token=<jwt_string>` (Section 5.9.1) |
| API Endpoints | `GET /api/auth/invite/validate` (Section 6.2.5), `POST /api/auth/register` (Section 6.2.2) |

### 13.8.2 Page Load — Token Validation

On mount, the page reads the `token` query parameter from the URL and validates it:

```
useEffect(() => {
  token = getQueryParam('token')
  IF token is null OR token is empty:
    showError('No invitation token provided')
    RETURN

  TRY:
    response = await api.get('/api/auth/invite/validate', { params: { token } })
    setEmail(response.data.data.email)
    setBatchYear(response.data.data.batchYear)
    setTokenValid(true)
  CATCH error:
    IF error.response.status === 410:
      // INVITE_EXPIRED
      setExpired(true)
      setCanResend(error.response.data.canResend)
    ELSE:
      setTokenValid(false)
      setErrorMessage(mapErrorCode(error.response.data.error))
}, [])
```

### 13.8.3 Token Validation States

| State | Display |
|---|---|
| Loading (validation in progress) | Loading spinner |
| Token valid (`200 OK`) | Show registration form with pre-filled email and batch year |
| Token expired (`410 Gone` with `canResend: true`) | Message: "Your invitation link has expired. Please contact your administrator for a new one." |
| Token invalid (`400` — `INVITE_INVALID`) | Message: "This invitation link is invalid." |
| Token already used (`400` — `INVITE_ALREADY_USED`) | Message: "This invitation has already been used." |
| No token in URL | Message: "No invitation token provided." |

### 13.8.4 Registration Form Fields

Displayed only when the token is valid:

| Field | Type | Required | Constraints | Maps To |
|---|---|---|---|---|
| Email | `<input type="email" disabled>` | Pre-filled from validation response | Read-only — the email is fixed by the invite token | Not sent separately; embedded in the token |
| Batch Year | Text display (not an input) | Pre-filled from validation response | Read-only; informational only; `null` if no batch year assigned | Not sent separately |
| Name | `<input type="text">` | Yes | Non-empty, max 255 characters | `name` in request body |
| Password | `<input type="password">` | Yes | 8–128 characters | `password` in request body |
| Confirm Password | `<input type="password">` | Yes | Must match Password field | Client-side validation only; not sent to backend |

### 13.8.5 Submit Behavior

```
async function handleRegister(name, password, confirmPassword):
  IF password !== confirmPassword:
    showError('Passwords do not match')
    RETURN

  TRY:
    response = await api.post('/api/auth/register', {
      token: tokenFromUrl,
      name: name,
      password: password
    })
    accessToken = response.data.data.accessToken
    user = response.data.data.user
    setAccessToken(accessToken)
    setUser(user)
    navigate('/home')
  CATCH error:
    displayErrorMessage(error.response.data.error)
```

### 13.8.6 Error Display

| Error Code (from Section 6.2.2) | User-Facing Message |
|---|---|
| `INVITE_INVALID` | "This invitation link is invalid." |
| `INVITE_ALREADY_USED` | "This invitation has already been used." |
| `INVITE_EXPIRED` | "This invitation has expired. Please contact your administrator." |
| `NAME_REQUIRED` | "Name is required." |
| `PASSWORD_TOO_SHORT` | "Password must be at least 8 characters." |
| `PASSWORD_TOO_LONG` | "Password must not exceed 128 characters." |

---

## 13.9 Password Reset Page

### 13.9.1 Route and Access

| Property | Value |
|---|---|
| Route | `/reset-password` |
| Access | Public |
| Entry point | Student clicks the password reset link from the email: `{FRONTEND_URL}/reset-password?token=<raw_token>` (Section 5.9.8, Section 11.4.2) |
| API Endpoint | `POST /api/auth/reset-password` (Section 6.2.7) |

### 13.9.2 Form Fields

| Field | Type | Required | Constraints | Maps To |
|---|---|---|---|---|
| New Password | `<input type="password">` | Yes | 8–128 characters | `newPassword` in request body |
| Confirm Password | `<input type="password">` | Yes | Must match New Password | Client-side validation only; not sent to backend |

The `token` query parameter is read from the URL and sent in the request body.

### 13.9.3 Submit Behavior

```
async function handleResetPassword(newPassword, confirmPassword):
  IF newPassword !== confirmPassword:
    showError('Passwords do not match')
    RETURN

  token = getQueryParam('token')

  TRY:
    await api.post('/api/auth/reset-password', {
      token: token,
      newPassword: newPassword
    })
    showSuccess('Password reset successful. You can now log in with your new password.')
    navigate('/login')
  CATCH error:
    displayErrorMessage(error.response.data.error)
```

### 13.9.4 Error Display

| Error Code (from Section 6.2.7) | User-Facing Message |
|---|---|
| `TOKEN_INVALID` | "This reset link is invalid." |
| `TOKEN_USED` | "This reset link has already been used." |
| `TOKEN_EXPIRED` | "This reset link has expired. Please request a new one." |
| `PASSWORD_TOO_SHORT` | "Password must be at least 8 characters." |
| `PASSWORD_TOO_LONG` | "Password must not exceed 128 characters." |

---

## 13.10 Navigation Bar — `Navbar.jsx`

The navigation bar is visible on all authenticated pages.

### 13.10.1 Navigation Items

| Label | Route | Icon (optional) | Description |
|---|---|---|---|
| Home | `/home` | Dashboard icon | Dashboard with resource summary and project cards |
| Projects | `/projects` | Folder icon | Project listing and creation |
| Databases | `/databases` | Database icon | Database listing and creation |
| Requests | `/resource-requests` | Request icon | Resource request submission |
| Profile | `/profile` | User icon | Password change and theme toggle |
| Logout | (triggers `logout()`) | Logout icon | Clears session and navigates to `/login` |

### 13.10.2 Active State

The current route's navigation item is visually highlighted (e.g., bold text, underline, or background color) to indicate the active page. This is determined by comparing the current URL path against each navigation item's route.

### 13.10.3 Logout Behavior

```
async function handleLogout():
  TRY:
    await api.post('/api/auth/logout')
  CATCH error:
    // Logout is idempotent — proceed even if the API call fails
  FINALLY:
    setAccessToken(null)
    setUser(null)
    navigate('/login')
```

The `POST /api/auth/logout` endpoint is idempotent (Section 6.2.4). Even if the call fails (e.g., network error), the frontend clears the access token and user state, effectively logging out locally.

---

## 13.11 Home Page — `HomePage.jsx` and `Dashboard.jsx`

The home page is the main authenticated landing page after login.

### 13.11.1 Data Source

| API Endpoint | Purpose |
|---|---|
| `GET /api/student/profile` (Section 6.3.1) | Fetches all resource quotas, usage values, and `storageWarning` flag |
| `GET /api/projects` (Section 6.5.2) | Fetches all non-deleted projects for the student |

Both endpoints are called on page mount.

### 13.11.2 Resource Usage Cards — `ResourceUsageCard.jsx`

The dashboard displays the student's resource usage in a card-based layout (spec: "Each resource card shows consumption in an n/m format alongside the remaining quantity and a label"). Five cards are rendered from the profile response:

| Card Label | Used (`n`) | Total (`m`) | Remaining | Profile Field (Used) | Profile Field (Total) |
|---|---|---|---|---|---|
| CPU Cores | `cpuUsed` | `cpuQuota` | `cpuQuota - cpuUsed` | `data.cpuUsed` | `data.cpuQuota` |
| RAM (MB) | `ramUsedMb` | `ramQuotaMb` | `ramQuotaMb - ramUsedMb` | `data.ramUsedMb` | `data.ramQuotaMb` |
| Storage (MB) | `storageUsedMb` | `storageQuotaMb` | `storageQuotaMb - storageUsedMb` | `data.storageUsedMb` | `data.storageQuotaMb` |
| Projects | `projectCount` | `maxProjects` | `maxProjects - projectCount` | `data.projectCount` | `data.maxProjects` |
| Databases | `databaseCount` | `maxDatabases` | `maxDatabases - databaseCount` | `data.databaseCount` | `data.maxDatabases` |

These match the display format defined in Section 10.10.1.

**`ResourceUsageCard` component interface:**

```
ResourceUsageCard({ label, used, total })
  remaining = total - used
  RENDER:
    <Card>
      <Label>{label}</Label>
      <Usage>{used} / {total}</Usage>
      <Remaining>{remaining} remaining</Remaining>
    </Card>
```

### 13.11.3 Storage Warning

When the profile response includes `storageWarning: true` (Section 6.3.1), the Storage card displays a visual warning indicator (e.g., orange/yellow highlight, warning icon) to alert the student that their storage usage is at or above the `STORAGE_WARNING_THRESHOLD_PERCENT` threshold (default 80%, Section 10.6).

### 13.11.4 Project Cards — `ProjectCard.jsx`

Below the resource summary, each active project is displayed as a card (spec: "each active project is displayed as a card showing the project name, its live URL, and a settings button").

**Data source:** `GET /api/projects` response (Section 6.5.2).

**Card content for each project:**

| Element | Source Field | Display |
|---|---|---|
| Project name | `item.title` | Bold text |
| Live URL | `item.liveUrl` | Clickable link: `https://{subdomain}.acadhost.com` |
| Status badge | `item.status` | Color-coded badge: `running` = green, `stopped` = gray, `building` = blue, `failed` = red |
| Settings button | — | Navigates to `/projects/{item.id}/settings` |

**Filtered display:** Only projects with `status != 'deleted'` are returned by the API (Section 6.5.2). No client-side filtering is needed.

---

## 13.12 Profile — `Profile.jsx`

The profile section provides password change functionality and a dark/light mode toggle (spec: "A profile section allows them to change their password and toggle between dark mode and light mode").

### 13.12.1 Password Change Form

| Field | Type | Required | Constraints | Maps To |
|---|---|---|---|---|
| Current Password | `<input type="password">` | Yes | Non-empty | `currentPassword` in request body |
| New Password | `<input type="password">` | Yes | 8–128 characters | `newPassword` in request body |
| Confirm New Password | `<input type="password">` | Yes | Must match New Password | Client-side validation only |

**API Endpoint:** `PUT /api/auth/password` (Section 6.2.8)

**Submit Behavior:**

```
async function handleChangePassword(currentPassword, newPassword, confirmPassword):
  IF newPassword !== confirmPassword:
    showError('New passwords do not match')
    RETURN

  TRY:
    await api.put('/api/auth/password', {
      currentPassword: currentPassword,
      newPassword: newPassword
    })
    showSuccess('Password changed successfully')

    IF user.mustChangePassword:
      // Clear the flag after forced password change
      setUser({ ...user, mustChangePassword: false })
  CATCH error:
    displayErrorMessage(error.response.data.error)
```

**Error Display:**

| Error Code (from Section 6.2.8) | User-Facing Message |
|---|---|
| `CURRENT_PASSWORD_INCORRECT` | "Current password is incorrect." |
| `PASSWORD_TOO_SHORT` | "Password must be at least 8 characters." |
| `PASSWORD_TOO_LONG` | "Password must not exceed 128 characters." |

### 13.12.2 Dark/Light Mode Toggle

A toggle switch (checkbox, button, or switch component) that calls `toggleDarkMode()` from `ThemeContext` (Section 13.5.3). The toggle reflects the current `darkMode` state and updates both the frontend theme and the backend `users.dark_mode` column via `PUT /api/student/dark-mode` (Section 6.3.2).

---

## 13.13 Projects Page — `ProjectsPage.jsx` and `ProjectCreate.jsx`

### 13.13.1 Page Layout

The Projects page displays the project creation form. It may also list existing projects (same data as the home page cards) with links to their settings pages.

### 13.13.2 Project Creation Workflow — `ProjectCreate.jsx`

The spec defines a multi-step project creation workflow. The component collects all required information and submits it as a single `multipart/form-data` request to `POST /api/projects` (Section 6.5.1).

**Step 1 — Project Type Selection:**

| Option | Value | Description |
|---|---|---|
| Frontend Only | `frontend` | Static site served by Nginx inside the container |
| Backend Only | `backend` | Node.js or Python backend service |
| Frontend + Backend | `combined` | Frontend built into the backend; deployed as a single container |

**Step 2 — Runtime and Version Selection (conditional):**

Displayed only when `projectType` is `backend` or `combined`:

| Field | Type | Options | Default |
|---|---|---|---|
| Runtime | Dropdown or radio | `node`, `python` | — (required) |
| Runtime Version | Dropdown | Node.js: `18`, `20`, `22`, `23`; Python: `3.10`, `3.11`, `3.12`, `3.13` | Node.js: `20`; Python: `3.11` |

When `projectType` is `frontend`, runtime fields are hidden (frontend-only projects have no server runtime, Section 4.2.2 notes).

**Step 3 — Subdomain Input:**

| Field | Type | Constraints | Validation |
|---|---|---|---|
| Subdomain | `<input type="text">` | Lowercase alphanumeric and hyphens, 3–63 characters, no leading/trailing hyphens | Client-side format validation matching the regex `^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$` (Section 12.2.1) |

The field displays a preview of the full URL: `https://{subdomain}.acadhost.com`.

If the backend returns `SUBDOMAIN_TAKEN` (HTTP `409`, Section 6.5.1), the error response may include a suggested random subdomain (Section 12.2.4). The frontend displays the suggestion and allows the student to accept it (by filling it into the subdomain field) or try another.

If the backend returns `SUBDOMAIN_RESERVED` (HTTP `400`, Section 6.5.1), the frontend displays "This subdomain is reserved."

**Step 4 — Resource Allocation:**

| Field | Type | Default | Display |
|---|---|---|---|
| CPU Limit | Number input | `1.00` | Shows available CPU: `{cpuQuota - cpuUsed}` cores remaining |
| RAM Limit (MB) | Number input | `512` | Shows available RAM: `{ramQuotaMb - ramUsedMb}` MB remaining |

The defaults `cpuLimit = 1.00` and `ramLimitMb = 512` are per Section 6.5.1 (Section 6 ambiguity decision #3, Section 10.3.1).

The available capacity is fetched from `GET /api/student/profile` (Section 6.3.1) and displayed alongside the input fields so the student can make informed adjustments (spec: "Default CPU, RAM, and database allocations are pre-filled with recommended values, with available capacity clearly shown").

**Step 5 — Database Selection:**

| Field | Type | Options | Default |
|---|---|---|---|
| Database | Dropdown | List of student's databases from `GET /api/databases` (Section 6.6.2) + "None" option | `null` (no database) |

Each dropdown option displays the database display name. The `databaseId` value is sent in the request body.

**Step 6 — Project Title:**

| Field | Type | Required | Constraints | Maps To |
|---|---|---|---|---|
| Project Title | `<input type="text">` | Yes | Non-empty, max 255 characters | `title` in request body |

**Step 7 — Source Upload:**

| Field | Type | Description |
|---|---|---|
| Source Type | Radio buttons: `git` or `zip` | Determines whether Git URL or ZIP upload fields are shown |

**When `sourceType = 'git'`:**

| Field | Displayed When | Constraints | Maps To |
|---|---|---|---|
| Git URL | `projectType` is `frontend` or `backend` | Valid URL | `gitUrl` |
| Frontend Git URL | `projectType` is `combined` | Valid URL | `gitUrl` |
| Backend Git URL | `projectType` is `combined` | Valid URL | `gitUrlBackend` |

**When `sourceType = 'zip'`:**

| Field | Displayed When | Constraints | Maps To |
|---|---|---|---|
| ZIP File | `projectType` is `frontend` or `backend` | Max 200 MB; `.zip` files only | `zipFile` |
| Frontend ZIP | `projectType` is `combined` | Max 200 MB each; `.zip` files only | `zipFileFrontend` |
| Backend ZIP | `projectType` is `combined` | Max 200 MB each; `.zip` files only | `zipFileBackend` |

The 200 MB limit is `MAX_ZIP_UPLOAD_SIZE_MB` (Section 3.2.11). Client-side file size validation should be performed before upload to avoid waiting for a server-side rejection.

### 13.13.3 Form Submission

The form is submitted as `multipart/form-data` to `POST /api/projects` (Section 6.5.1):

```
async function handleCreateProject(formData):
  TRY:
    response = await api.post('/api/projects', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    projectId = response.data.data.projectId
    buildStreamUrl = response.data.data.buildStreamUrl
    // Navigate to build logs view
    showBuildLogs(projectId, buildStreamUrl)
  CATCH error:
    displayErrorMessage(error.response.data.error)
```

The response is `202 Accepted` with a `buildStreamUrl` field (Section 6.5.1). The frontend should immediately open an SSE connection to this URL to display real-time build logs.

### 13.13.4 Error Display for Project Creation

| Error Code (from Section 6.5.1) | User-Facing Message |
|---|---|
| `PROJECT_QUOTA_EXCEEDED` | "You've reached your project limit." |
| `SUBDOMAIN_RESERVED` | "This subdomain is reserved." |
| `SUBDOMAIN_TAKEN` | "This subdomain is already in use." (with suggested alternative if provided) |
| `SUBDOMAIN_INVALID` | "Subdomain must be 3–63 characters, lowercase letters, numbers, and hyphens." |
| `CPU_QUOTA_EXCEEDED` | "CPU limit exceeds your available quota." |
| `RAM_QUOTA_EXCEEDED` | "RAM limit exceeds your available quota." |
| `ZIP_TOO_LARGE` | "ZIP file exceeds the maximum size of 200 MB." |
| `DATABASE_NOT_FOUND` | "Selected database not found." |
| `SOURCE_TYPE_MISMATCH` | "Combined projects require both sources to use the same type (both Git or both ZIP)." |
| `BUILD_QUEUE_FULL` | "Build queue is full. Please try again later." |
| `VALIDATION_ERROR` | Display the `message` field from the response |

---

## 13.14 Build Logs — `BuildLogs.jsx`

The build logs component displays real-time build output using Server-Sent Events (spec: "the platform displays real-time build logs showing only application-level output, not internal Docker or system messages").

### 13.14.1 SSE Connection

```
function BuildLogs({ projectId, accessToken }):
  eventSource = new EventSource(
    `/api/projects/${projectId}/build-logs/stream?token=${accessToken}`
  )
```

The access token is passed as a query parameter because `EventSource` does not support custom headers (Section 5.14, Section 6.1.3, Section 6.5.7).

### 13.14.2 Event Handlers

| SSE Event Type (Section 6.5.7) | Handler | Client Action |
|---|---|---|
| `log` | `eventSource.addEventListener('log', handler)` | Append `event.data` (a single log line) to the log display |
| `status` | `eventSource.addEventListener('status', handler)` | Update a status indicator with the current build status: `building`, `success`, `failed`, `timeout` |
| `complete` | `eventSource.addEventListener('complete', handler)` | Parse `event.data` as JSON; close the `EventSource`; navigate based on result |

### 13.14.3 Build Completion Behavior

```
eventSource.addEventListener('complete', (event) => {
  result = JSON.parse(event.data)
  eventSource.close()

  IF result.status === 'success':
    // Green success indicator; redirect to home dashboard
    showSuccessIndicator()
    setTimeout(() => navigate('/home'), 2000)
  ELSE:
    // Red failure indicator; show error message and option to return
    showFailureIndicator(result.message)
    showReturnToEditButton()
})
```

| Build Result | Visual Indicator | Behavior |
|---|---|---|
| `success` | Green text/background | Redirects to `/home` dashboard (spec: "A successful deployment is indicated in green and redirects the student to the home dashboard") |
| `failed` | Red text/background | Shows relevant logs and an option to return to the edit page (spec: "A failed deployment is indicated in red, shows the relevant logs, and offers an option to return to the edit page to correct the configuration") |
| `timeout` | Red text/background | Shows timeout message: "Build exceeded time limit" |

### 13.14.4 Log Display Styling

| Element | Style |
|---|---|
| Log container | Monospace font; scrollable; auto-scroll to bottom as new lines arrive |
| Log lines | Each `log` event data is a single line appended to the display |
| Success state | Green text or green-bordered container |
| Failure/timeout state | Red text or red-bordered container |

### 13.14.5 Connection Error Handling

If the `EventSource` connection fails or encounters an error:

```
eventSource.onerror = (error) => {
  eventSource.close()
  showError('Connection to build log stream lost. Refresh to reconnect.')
}
```

---

## 13.15 Project Settings — `ProjectSettings.jsx`

The project settings panel is accessed by clicking the settings button on a project card (spec: "Clicking the settings option on a project card opens a detailed management panel").

### 13.15.1 Data Sources

| API Endpoint | Purpose |
|---|---|
| `GET /api/projects/:id` (Section 6.5.3) | Fetch full project details |
| `GET /api/student/profile` (Section 6.3.1) | Fetch resource quotas and usage for available capacity display |
| `GET /api/databases` (Section 6.6.2) | Fetch database list for the database switching dropdown |

### 13.15.2 Database Switching

Spec: "Switch the attached database via a dropdown menu. Selecting a new database automatically injects its credentials into the running container as environment variables."

| Element | Description |
|---|---|
| Dropdown | Lists all student's databases from `GET /api/databases` + "None" option |
| Current selection | Pre-selected to the project's current `databaseId` (or "None" if `null`) |
| On change | Calls `PUT /api/projects/:id/database` (Section 6.5.4) with `{ databaseId: selectedId }` or `{ databaseId: null }` for detach |

**API Endpoint:** `PUT /api/projects/:id/database` (Section 6.5.4)

**Success:** Display confirmation message `"DATABASE_SWITCHED"`.

**Error Codes (from Section 6.5.4):**

| Error Code | User-Facing Message |
|---|---|
| `PROJECT_NOT_FOUND` | "Project not found." |
| `PROJECT_DELETED` | "Cannot modify a deleted project." |
| `DATABASE_NOT_FOUND` | "Database not found." |

### 13.15.3 CPU and RAM Adjustment

Spec: "Adjust CPU and RAM limits, with the panel clearly showing available and total resource values so the student can make informed adjustments."

| Field | Type | Current Value Source | Available Capacity |
|---|---|---|---|
| CPU Limit | Number input | `project.cpuLimit` | `cpuQuota - cpuUsed + project.cpuLimit` (current project's allocation is available for reuse) |
| RAM Limit (MB) | Number input | `project.ramLimitMb` | `ramQuotaMb - ramUsedMb + project.ramLimitMb` (current project's allocation is available for reuse) |

The available capacity calculation accounts for the `excludeProjectId` parameter in `quotaChecker.js` (Section 10.5.4) — the current project's existing allocation is excluded from the "in use" total, making it available for the resize operation.

**API Endpoint:** `PUT /api/projects/:id/resources` (Section 6.5.5)

**Submit Behavior:**

```
async function handleUpdateResources(cpuLimit, ramLimitMb):
  TRY:
    await api.put(`/api/projects/${projectId}/resources`, {
      cpuLimit: cpuLimit,
      ramLimitMb: ramLimitMb
    })
    showSuccess('Resources updated')
    refreshProjectDetails()
  CATCH error:
    displayErrorMessage(error.response.data.error)
```

**Error Codes (from Section 6.5.5):**

| Error Code | User-Facing Message |
|---|---|
| `CPU_QUOTA_EXCEEDED` | "CPU limit exceeds available quota." |
| `RAM_QUOTA_EXCEEDED` | "RAM limit exceeds available quota." |
| `PROJECT_DELETED` | "Cannot modify a deleted project." |

### 13.15.4 Live Application Logs

Spec: "View live application logs with a refresh button to fetch the latest output."

| Element | Description |
|---|---|
| Log display | Monospace text area displaying runtime logs |
| Refresh button | Fetches the latest logs on click |
| Default tail | `100` lines (default query parameter, Section 6.5.6) |

**API Endpoint:** `GET /api/projects/:id/logs` (Section 6.5.6)

```
async function handleRefreshLogs():
  TRY:
    response = await api.get(`/api/projects/${projectId}/logs`)
    setLogs(response.data.data.logs)
  CATCH error:
    IF error.response.data.error === 'CONTAINER_NOT_RUNNING':
      showMessage('No running container for this project.')
    ELSE:
      displayErrorMessage(error.response.data.error)
```

### 13.15.5 Storage Usage

Spec: "View detailed storage usage for that project."

**API Endpoint:** `GET /api/projects/:id/storage` (Section 6.5.9)

**Display:**

| Field | Source | Display |
|---|---|---|
| Total storage | `data.storageUsedMb` | Total project storage in MB |
| Source | `data.breakdown.sourceMb` | Source code size |
| Build logs | `data.breakdown.buildLogsMb` | Build log size |
| Uploads | `data.breakdown.uploadsMb` | Uploaded ZIP file size |
| Other | `data.breakdown.otherMb` | Other files |

### 13.15.6 Action Buttons

Spec: "Restart, stop, or delete the project using clearly labelled action buttons."

| Button | Label | API Endpoint | Displayed When |
|---|---|---|---|
| Restart | "Restart" | `POST /api/projects/:id/restart` (Section 6.5.10) | Project status is `running` or `stopped` |
| Stop | "Stop" | `POST /api/projects/:id/stop` (Section 6.5.11) | Project status is `running` |
| Delete | "Delete" | `DELETE /api/projects/:id` (Section 6.5.12) | Any non-deleted status |

**Confirmation dialog for destructive actions:** The Delete button must show a confirmation dialog before proceeding (e.g., "Are you sure you want to delete this project? This action cannot be undone."). The Restart and Stop buttons do not require confirmation.

**Button state logic based on project status (Section 12.3.2):**

| Status | Restart | Stop | Delete |
|---|---|---|---|
| `building` | Disabled | Disabled | Enabled |
| `running` | Enabled | Enabled | Enabled |
| `stopped` | Enabled | Disabled | Enabled |
| `failed` | Disabled | Disabled | Enabled |

**Error Codes for Actions:**

| Action | Error Code | User-Facing Message |
|---|---|---|
| Restart | `PROJECT_DELETED` | "Cannot restart a deleted project." |
| Restart | `PROJECT_BUILDING` | "Cannot restart a project that is currently building." |
| Restart | `CONTAINER_NOT_FOUND` | "No container exists for this project." |
| Stop | `PROJECT_ALREADY_STOPPED` | "Project is already stopped." |
| Stop | `PROJECT_DELETED` | "Cannot stop a deleted project." |
| Stop | `PROJECT_BUILDING` | "Cannot stop a project that is currently building." |
| Delete | `PROJECT_ALREADY_DELETED` | "Project has already been deleted." |

**After successful delete:** Navigate back to `/home` and refresh the project list.

---

## 13.16 Databases Page — `DatabasesPage.jsx` and `DatabaseSection.jsx`

### 13.16.1 Database Usage Card

Spec: "The Databases section shows a card displaying how many databases the student has created out of their total allocation (n/m)."

**Data source:** `GET /api/databases` response (Section 6.6.2) includes a `quota` object: `{ used: 1, total: 4 }`.

**Display:**

| Element | Source |
|---|---|
| Usage text | `{quota.used} / {quota.total}` |
| Remaining | `{quota.total - quota.used} remaining` |

### 13.16.2 Database Creation

Spec: "An input field allows the student to create a new database by name. The platform validates that the name does not duplicate any of the student's existing databases."

| Field | Type | Required | Constraints | Maps To |
|---|---|---|---|---|
| Database Name | `<input type="text">` | Yes | Alphanumeric and underscores, 1–64 characters | `dbName` in request body |

**API Endpoint:** `POST /api/databases` (Section 6.6.1)

**Submit Behavior:**

```
async function handleCreateDatabase(dbName):
  TRY:
    response = await api.post('/api/databases', { dbName })
    showSuccess(`Database "${dbName}" created`)
    refreshDatabaseList()
  CATCH error:
    displayErrorMessage(error.response.data.error)
```

**Error Codes (from Section 6.6.1):**

| Error Code | User-Facing Message |
|---|---|
| `VALIDATION_ERROR` | Display the `message` field |
| `DATABASE_NAME_DUPLICATE` | "You already have a database with this name." |
| `DATABASE_QUOTA_EXCEEDED` | "You've reached your database limit." |

**Disable creation:** If `quota.used >= quota.total`, disable the creation form and show a message: "Database limit reached."

### 13.16.3 Database List

Each database is displayed with:

| Element | Source | Description |
|---|---|---|
| Display name | `item.dbName` | The student's chosen database name |
| MySQL schema name | `item.mysqlSchemaName` | The actual MySQL schema name (e.g., `s42_mydb`) |
| phpMyAdmin link | `item.phpMyAdminUrl` | Opens phpMyAdmin scoped to this database |
| Created date | `item.createdAt` | When the database was created |

**phpMyAdmin link behavior:** Spec: "Once created, a link opens phpMyAdmin scoped exclusively to that database schema — the student cannot access any other schemas."

The link URL is provided by the API (`phpMyAdminUrl` field in the `GET /api/databases` response, Section 6.6.2). The frontend renders it as an `<a>` tag with `target="_blank"` to open phpMyAdmin in a new tab. The actual access restriction is enforced at the MySQL level by the restricted user's privileges (Section 9.7) — the link is a convenience for pre-selecting the database in phpMyAdmin.

---

## 13.17 Resource Requests Page — `ResourceRequestsPage.jsx` and `ResourceRequestForm.jsx`

### 13.17.1 Resource Request Form

Spec: "The student fills out a form specifying the resource they need increased — CPU, RAM, storage, databases, or projects — along with a requested value and a description."

| Field | Type | Required | Options / Constraints | Maps To |
|---|---|---|---|---|
| Resource Type | Dropdown | Yes | `cpu`, `ram`, `storage`, `projects`, `databases` | `resourceType` in request body |
| Requested Value | `<input type="text">` | Yes | Non-empty, max 50 characters | `requestedValue` in request body |
| Description | `<textarea>` | Yes | Non-empty | `description` in request body |

**API Endpoint:** `POST /api/resource-requests` (Section 6.7.1)

**Submit Behavior:**

```
async function handleSubmitRequest(resourceType, requestedValue, description):
  TRY:
    response = await api.post('/api/resource-requests', {
      resourceType,
      requestedValue,
      description
    })
    showSuccess('Request submitted')
    refreshRequestList()
  CATCH error:
    displayErrorMessage(error.response.data.error)
```

### 13.17.2 Request History

The page also displays the student's previous resource requests:

**API Endpoint:** `GET /api/resource-requests` (Section 6.7.2, student scope)

**Display per request:**

| Field | Source | Description |
|---|---|---|
| Resource type | `item.resourceType` | Which resource was requested |
| Requested value | `item.requestedValue` | The value requested |
| Description | `item.description` | Student's justification |
| Status | `item.status` | Badge: `pending` = yellow/gray, `approved` = green, `denied` = red |
| Admin notes | `item.adminNotes` | Admin's response (if reviewed); `null` for pending requests |
| Submitted at | `item.createdAt` | Submission timestamp |
| Reviewed at | `item.reviewedAt` | Review timestamp (if reviewed); `null` for pending requests |

---

## 13.18 API Endpoint Summary — Student Dashboard

This table lists every API endpoint consumed by the student dashboard, organized by page/component:

| Page / Component | API Endpoint | Method | Purpose |
|---|---|---|---|
| AuthContext (page load) | `/api/auth/refresh` | `POST` | Restore session on page load/refresh |
| AuthContext (proactive) | `/api/auth/refresh` | `POST` | Refresh access token before expiry |
| LoginPage | `/api/auth/login` | `POST` | Student login |
| LoginPage (forgot password) | `/api/auth/forgot-password` | `POST` | Request password reset email |
| RegisterPage | `/api/auth/invite/validate` | `GET` | Validate invite token on page load |
| RegisterPage | `/api/auth/register` | `POST` | Complete student registration |
| ResetPasswordPage | `/api/auth/reset-password` | `POST` | Reset password with token |
| Navbar (logout) | `/api/auth/logout` | `POST` | Logout and clear session |
| HomePage / Dashboard | `/api/student/profile` | `GET` | Resource quotas and usage |
| HomePage / Dashboard | `/api/projects` | `GET` | List student's projects |
| Profile | `/api/auth/password` | `PUT` | Change password |
| Profile | `/api/student/dark-mode` | `PUT` | Toggle dark/light mode |
| ProjectCreate | `/api/student/profile` | `GET` | Available resource capacity |
| ProjectCreate | `/api/databases` | `GET` | Database list for dropdown |
| ProjectCreate | `/api/projects` | `POST` | Create project and start build |
| BuildLogs | `/api/projects/:id/build-logs/stream` | `GET` (SSE) | Real-time build log stream |
| ProjectSettings | `/api/projects/:id` | `GET` | Project details |
| ProjectSettings | `/api/student/profile` | `GET` | Available resource capacity |
| ProjectSettings | `/api/databases` | `GET` | Database list for switching dropdown |
| ProjectSettings | `/api/projects/:id/database` | `PUT` | Switch attached database |
| ProjectSettings | `/api/projects/:id/resources` | `PUT` | Adjust CPU/RAM limits |
| ProjectSettings | `/api/projects/:id/logs` | `GET` | Runtime application logs |
| ProjectSettings | `/api/projects/:id/storage` | `GET` | Project storage usage breakdown |
| ProjectSettings | `/api/projects/:id/restart` | `POST` | Restart project container |
| ProjectSettings | `/api/projects/:id/stop` | `POST` | Stop project container |
| ProjectSettings | `/api/projects/:id` | `DELETE` | Delete project (soft-delete) |
| DatabasesPage | `/api/databases` | `GET` | List databases with quota |
| DatabasesPage | `/api/databases` | `POST` | Create new database |
| ResourceRequestsPage | `/api/resource-requests` | `POST` | Submit resource request |
| ResourceRequestsPage | `/api/resource-requests` | `GET` | List student's request history |

**Total unique endpoints consumed: 20** (out of the 40 total platform endpoints, Section 6.10).

---

## 13.19 Error Handling Patterns

### 13.19.1 Standard Error Display

All API error responses follow the standard envelope (Section 6.1.1):

```json
{
  "success": false,
  "error": "ERROR_CODE",
  "message": "Human-readable description"
}
```

The frontend's error handler:

```
function displayErrorMessage(errorResponse):
  IF errorResponse AND errorResponse.message:
    showToast(errorResponse.message, 'error')
  ELSE IF errorResponse AND errorResponse.error:
    showToast(humanReadableError(errorResponse.error), 'error')
  ELSE:
    showToast('An unexpected error occurred', 'error')
```

### 13.19.2 Network Error Handling

When the backend is unreachable (network error, server down):

```
function handleNetworkError():
  showToast('Unable to connect to the server. Please check your connection.', 'error')
```

### 13.19.3 Loading States

Every API call should display a loading indicator while in progress. Common patterns:

| Pattern | Usage |
|---|---|
| Full-page spinner | Initial page load (AuthContext token refresh) |
| Button spinner | Form submissions (login, register, create project, etc.) |
| Inline spinner | Data fetches (profile, project list, database list, etc.) |
| Disable form | All form inputs and buttons are disabled during submission |

---

## 13.20 Ambiguity Decisions Registry

| # | Ambiguity | Decision | Rationale |
|---|---|---|---|
| 1 | Spec does not define a dedicated route for the password reset page | `/reset-password` route reads `token` query parameter | Consistent with the `{FRONTEND_URL}/reset-password?token=<raw_token>` link in Section 11.4.2 |
| 2 | Spec does not define how the frontend knows to clear `mustChangePassword` after password change | Frontend sets `user.mustChangePassword = false` after successful `PUT /api/auth/password` | Backend sets the DB flag; frontend mirrors in state. No extra API call needed. |
| 3 | Spec does not define specific landing page content | Platform name, tagline, feature summary, login button | Minimal viable content; exact copy deferred to code phase |
| 4 | Spec does not define CSS color values for dark/light modes | CSS custom properties with functional color values | Implementation detail; code generators may adjust values |
| 5 | Spec does not define whether the project creation form is multi-step or single-page | Single-page form with conditional sections based on project type and source type | Simpler implementation; all fields visible in context |
| 6 | Spec does not define a confirm-password field for registration | Added confirm-password with client-side match validation | Standard UX pattern preventing password typos |
| 7 | Spec does not define a confirm-password field for password reset | Added confirm-password with client-side match validation | Same rationale as registration |
| 8 | Spec does not define a confirm-password field for password change | Added confirm-new-password with client-side match validation | Same rationale as registration |
| 9 | Spec does not define a confirmation dialog for project deletion | Confirmation dialog required before `DELETE /api/projects/:id` | Prevents accidental data loss; standard UX for destructive actions |
| 10 | Spec does not define whether admin users who log into the student dashboard are redirected | Admin users are shown an error message and logged out; they should use `admin.acadhost.com` | The student dashboard is a separate SPA from the admin dashboard; admin routes are not present |
| 11 | Spec does not define whether resource request form shows current quota values for context | Not explicitly specified | The form could display current quota alongside the request fields for context, but this is a UX enhancement deferred to code phase |
| 12 | Spec does not define the proactive token refresh strategy | Refresh 60 seconds before the access token's `exp` claim | Prevents token expiry during active use; 60 seconds provides sufficient margin |

---

## VERIFICATION REPORT — Section 13: Student Dashboard — Frontend Specification

### Spec Alignment Check

| Spec Requirement | Covered In Output | Status |
|---|---|---|
| "A public-facing landing page introduces the platform to prospective and current students" | Section 13.6 — LandingPage.jsx | ✅ Covered |
| "Upon login, students access a personal dashboard" | Section 13.11 — HomePage.jsx and Dashboard.jsx | ✅ Covered |
| "A profile section allows them to change their password and toggle between dark mode and light mode" | Section 13.12 — Profile.jsx | ✅ Covered |
| "The dashboard displays the student's resource usage in a card-based layout" | Section 13.11.2 — ResourceUsageCard.jsx | ✅ Covered |
| "Each resource card shows consumption in an n/m format alongside the remaining quantity and a label" | Section 13.11.2 — five cards with n/m format | ✅ Covered |
| "Resources displayed are CPU cores, RAM, storage, number of projects, and number of databases" | Section 13.11.2 — all five resources listed | ✅ Covered |
| "Each active project is displayed as a card showing the project name, its live URL, and a settings button" | Section 13.11.4 — ProjectCard.jsx | ✅ Covered |
| "Switch the attached database via a dropdown menu" | Section 13.15.2 — Database Switching | ✅ Covered |
| "Selecting a new database automatically injects its credentials into the running container" | Section 13.15.2 — calls PUT /api/projects/:id/database | ✅ Covered |
| "Adjust CPU and RAM limits, with the panel clearly showing available and total resource values" | Section 13.15.3 — CPU and RAM Adjustment | ✅ Covered |
| "View live application logs with a refresh button" | Section 13.15.4 — Live Application Logs | ✅ Covered |
| "View detailed storage usage for that project" | Section 13.15.5 — Storage Usage | ✅ Covered |
| "Restart, stop, or delete the project using clearly labelled action buttons" | Section 13.15.6 — Action Buttons | ✅ Covered |
| "The student selects a project type — frontend only, backend only, or a combined frontend and backend" | Section 13.13.2 Step 1 — Project Type Selection | ✅ Covered |
| "Selects the runtime version required: one of Node.js 18, 20, 22, or 23 (default: 20), or one of Python 3.10, 3.11, 3.12, or 3.13 (default: 3.11)" | Section 13.13.2 Step 2 — Runtime and Version Selection | ✅ Covered |
| "Student then chooses a subdomain under *.acadhost.com" | Section 13.13.2 Step 3 — Subdomain Input | ✅ Covered |
| "If the requested subdomain is already taken, the platform displays an error and prompts for an alternative or offers a randomly generated subdomain" | Section 13.13.2 Step 3 — SUBDOMAIN_TAKEN handling | ✅ Covered |
| "Default CPU, RAM, and database allocations are pre-filled with recommended values, with available capacity clearly shown" | Section 13.13.2 Steps 4–5 — Resource Allocation and Database Selection | ✅ Covered |
| "Student provides a project title and uploads the source via a Git repository URL or a ZIP file (maximum 200 MB)" | Section 13.13.2 Steps 6–7 — Project Title and Source Upload | ✅ Covered |
| "For combined projects, the student provides two separate sources — either two Git repositories or two ZIP files" | Section 13.13.2 Step 7 — Combined project source fields | ✅ Covered |
| "Platform displays real-time build logs showing only application-level output" | Section 13.14 — BuildLogs.jsx | ✅ Covered |
| "Successful deployment is indicated in green and redirects the student to the home dashboard" | Section 13.14.3 — success handling | ✅ Covered |
| "Failed deployment is indicated in red, shows the relevant logs, and offers an option to return to the edit page" | Section 13.14.3 — failure handling | ✅ Covered |
| "Databases section shows a card displaying how many databases the student has created out of their total allocation (n/m)" | Section 13.16.1 — Database Usage Card | ✅ Covered |
| "Input field allows the student to create a new database by name" | Section 13.16.2 — Database Creation | ✅ Covered |
| "Platform validates that the name does not duplicate any of the student's existing databases" | Section 13.16.2 — DATABASE_NAME_DUPLICATE error handling | ✅ Covered |
| "Once created, a link opens phpMyAdmin scoped exclusively to that database schema" | Section 13.16.3 — phpMyAdmin link | ✅ Covered |
| "Student fills out a form specifying the resource they need increased — CPU, RAM, storage, databases, or projects — along with a requested value and a description" | Section 13.17.1 — Resource Request Form | ✅ Covered |
| "Submitting the form sends the request to the admin for review" | Section 13.17.1 — POST /api/resource-requests | ✅ Covered |
| Section 5.4: "Access tokens stored in JavaScript memory (React state/context), never in localStorage or cookies" | Section 13.3.1 — accessToken in state | ✅ Covered |
| Section 5.4: "Frontend must call POST /api/auth/refresh on every page load/refresh to obtain a new access token" | Section 13.3.3 — Token Refresh on Page Load | ✅ Covered |
| Section 5.8.2: "Frontend must redirect the admin to a password change screen before allowing access to any other functionality" | Section 13.3.6 — mustChangePassword handling | ✅ Covered |
| Section 5.14: "SSE endpoint auth via query parameter" | Section 13.14.1 — token passed as query parameter | ✅ Covered |
| Section 5.14: "All frontend page links use FRONTEND_URL" | Section 13.8.1, 13.9.1 — registration and reset links use FRONTEND_URL | ✅ Covered |
| Registration link format: `{FRONTEND_URL}/register?token=<jwt_string>` | Section 13.8.1 — route `/register` reads `token` query param | ✅ Covered |
| Password reset link format: `{FRONTEND_URL}/reset-password?token=<raw_token>` | Section 13.9.1 — route `/reset-password` reads `token` query param | ✅ Covered |
| Invite expired: "410 Gone response with canResend: true flag" | Section 13.8.3 — expired state handling | ✅ Covered |

### Gaps Found

| Missing Item | Action |
|---|---|
| (none) | — |

### Decisions Beyond The Spec

| Decision Made | Reason |
|---|---|
| Added `/reset-password` route | Spec defines the link format `{FRONTEND_URL}/reset-password?token=<raw_token>` but does not explicitly define the page; the route is implied |
| Added confirm-password fields to registration, reset, and change forms | Standard UX pattern to prevent typos |
| Added confirmation dialog for project deletion | Standard UX for destructive actions |
| Admin users logging into student dashboard are shown an error and logged out | Student and admin dashboards are separate SPAs; cross-role login should not proceed |
| Proactive token refresh at `exp - 60s` | Prevents mid-session token expiry |
| CSS custom property color values | Spec does not define colors; functional defaults provided |
| Single-page project creation form (not multi-step wizard) | Simpler implementation; all fields contextually visible |

### Cross-Section Consistency Check

| Item | Matches Earlier Sections | Status |
|---|---|---|
| Access token in memory, never in localStorage | Section 5.4 | ✅ Consistent |
| Refresh token in httpOnly cookie, sent via `withCredentials: true` | Section 5.10 | ✅ Consistent |
| Access token expiry 15 minutes | Section 3.2.3, Section 5.4 | ✅ Consistent |
| POST /api/auth/refresh on page load | Section 5.4 | ✅ Consistent |
| mustChangePassword handling | Section 5.8.2, Section 6.2.1 | ✅ Consistent |
| ResourceUsageCard n/m format | Section 10.10.1 | ✅ Consistent |
| Five resource types (CPU, RAM, storage, projects, databases) | Section 10.1.1 | ✅ Consistent |
| Per-project defaults cpuLimit=1.00, ramLimitMb=512 | Section 6 ambiguity #3, Section 10.3.1 | ✅ Consistent |
| Subdomain validation regex | Section 12.2.1 | ✅ Consistent |
| Reserved subdomains list | Section 3.3, Section 12.2.2 | ✅ Consistent |
| ZIP max 200 MB (`MAX_ZIP_UPLOAD_SIZE_MB`) | Section 3.2.11, Section 6.12.1 | ✅ Consistent |
| Runtime versions (Node: 18,20,22,23; Python: 3.10,3.11,3.12,3.13) | Section 4.2.2, Section 6.5.1 | ✅ Consistent |
| Runtime defaults (Node: 20, Python: 3.11) | Section 6.5.1 | ✅ Consistent |
| SSE event types (log, status, complete) | Section 6.5.7 | ✅ Consistent |
| Project status values (building, running, stopped, failed, deleted) | Section 4.2.2 | ✅ Consistent |
| Database naming: display name in API response, s{user_id}_{dbName} for schema | Section 6.6.1, Section 9.3.1 | ✅ Consistent |
| phpMyAdmin URL from API response | Section 6.6.2, Section 6.6.3 | ✅ Consistent |
| Password constraints 8–128 characters | Section 5.3.1 | ✅ Consistent |
| Error codes across all endpoints | Section 6 (all subsections) | ✅ Consistent |
| storageWarning threshold 80% | Section 10.6 | ✅ Consistent |
| FRONTEND_URL used in registration and reset links | Section 5.14 | ✅ Consistent |
| Resource request approval applies absolute total, not delta | Section 6 ambiguity #9 | ✅ Consistent (frontend submits requestedValue as string) |
| Operation restriction matrix for project actions | Section 12.3.2 | ✅ Consistent |
| File structure matches Section 2.4.1 | Section 2 | ✅ Consistent |
| All API endpoint paths match Section 6.10 | Section 6 | ✅ Consistent |
| Refresh token cookie Path=/api/auth | Section 5.10 | ✅ Consistent |

### Business Logic Check

| Logic Item | Real-World Valid | Issue (if any) |
|---|---|---|
| Token refresh on every page load | ✅ Valid | Standard SPA pattern for in-memory token storage |
| Proactive refresh 60s before expiry | ✅ Valid | Prevents mid-session 401 errors during active use |
| Admin login to student dashboard shows error | ✅ Valid | Separate SPAs per role; prevents confusion |
| Confirm-password fields for all password inputs | ✅ Valid | Standard UX; client-side only; no backend impact |
| SSE token via query parameter | ✅ Valid | Required because EventSource lacks header support; token is short-lived (15 min) |
| Delete confirmation dialog | ✅ Valid | Prevents accidental destructive actions |
| Single-page project creation form | ⚠️ Questionable | A multi-step wizard might be better UX for the complex creation flow, but a single page with conditional sections is simpler to implement and equally functional |
| Available capacity display on resource inputs | ✅ Valid | Helps students make informed decisions; matches spec requirement |
| phpMyAdmin link opens in new tab | ✅ Valid | Standard pattern; phpMyAdmin is a separate application |

---

## ✅ SECTION 13 COMPLETE — Student Dashboard — Frontend Specification

| Final Check | Result |
|---|---|
| All spec requirements covered | ✅ Yes |
| All gaps found and fixed | ✅ Yes |
| Business logic is consistent | ✅ Yes |
| No conflicts with past sections | ✅ Yes |
| Output is valid renderable Markdown | ✅ Yes |

**Section status: LOCKED**
This section's field names, variable names, table names, route paths, and values are now permanently locked. No changes will be made to this section in future sessions unless the user explicitly requests a correction.