# Section 14 — Admin Dashboard — Frontend Specification

## 14.1 Overview

The admin dashboard is a standalone React single-page application (SPA) served by Nginx on the subdomain `admin.acadhost.com`. It is a separate codebase from the student dashboard — they share no runtime code. The admin dashboard provides the complete admin-facing interface for system monitoring, project management, student management, and resource request review.

### 14.1.1 Technology Stack

| Technology | Purpose |
|---|---|
| React | UI framework |
| React Router | Client-side routing |
| Axios or Fetch API | HTTP client for backend API communication |
| CSS (custom) | Styling (no dark/light mode toggle — admin dashboard has a single theme) |

### 14.1.2 Deployment

| Property | Value |
|---|---|
| Build tool | Standard React build (`npm run build`) |
| Build output directory | `build/` (standard Create React App output) |
| Production serving | Nginx serves static files from `ADMIN_DASHBOARD_DIST` (Section 3.2.4); production value: `/var/www/acadhost/admin` |
| Development serving | Separate dev server (different port from student dashboard) |
| SPA routing | Nginx `try_files $uri $uri/ /index.html` ensures all client-side routes are handled by React Router (Section 8.3.2) |
| Domain | `admin.acadhost.com` (production) |

### 14.1.3 Directory Structure (Locked in Section 2.4.2)

```
frontend/admin-dashboard/
├── package.json
├── public/
│   └── index.html
└── src/
    ├── index.js
    ├── App.js
    ├── components/
    │   ├── Dashboard.jsx
    │   ├── ProjectList.jsx
    │   ├── StudentList.jsx
    │   ├── StudentQuotaEditor.jsx
    │   ├── BatchRemoval.jsx
    │   ├── StudentInvite.jsx
    │   ├── ResourceRequestList.jsx
    │   ├── SystemMetricsCard.jsx
    │   └── Navbar.jsx
    ├── pages/
    │   ├── LoginPage.jsx
    │   ├── DashboardPage.jsx
    │   ├── ProjectsPage.jsx
    │   ├── StudentsPage.jsx
    │   └── ResourceRequestsPage.jsx
    ├── services/
    │   └── api.js
    └── styles/
        └── theme.css
```

### 14.1.4 Single Admin Account

There is exactly one admin account, created via `seeds/adminSeed.js` (Section 5.8.1). There is no admin registration, no admin invitation, and no admin self-signup. The admin dashboard is used by this single account only (Section 12.11.1).

---

## 14.2 Routing — `App.js`

`App.js` is the root component. It wraps the entire application in `AuthContext.Provider` and defines all client-side routes via React Router.

### 14.2.1 Route Definitions

| Route Path | Page Component | Access | Description |
|---|---|---|---|
| `/login` | `LoginPage` | Public (redirects to `/` if already authenticated) | Admin login |
| `/` | `DashboardPage` | Protected (admin only) | Dashboard home — system-wide metrics |
| `/projects` | `ProjectsPage` | Protected (admin only) | Project management — list, stop, terminate |
| `/students` | `StudentsPage` | Protected (admin only) | Student management — list, invite, remove, batch remove, quota editing |
| `/resource-requests` | `ResourceRequestsPage` | Protected (admin only) | Resource request review — list, approve, deny |

AMBIGUITY DETECTED: The spec does not define a dedicated route for the admin's forced password change page. Section 5.8.2 states "the frontend must redirect the admin to a password change screen before allowing access to any other functionality."
My decision: When `mustChangePassword` is `true`, the admin dashboard renders a password change modal overlay or full-screen form on top of the dashboard route. This is handled within `AuthContext` — all navigation is blocked until the password is changed. No separate route is needed because the password change UI is a blocking overlay, not a distinct page.

### 14.2.2 Route Protection

Protected routes require an authenticated admin:

```
function ProtectedRoute({ children }):
  { user, loading } = useAuthContext()

  IF loading:
    RETURN <LoadingSpinner />

  IF user is null:
    RETURN <Navigate to="/login" />

  IF user.role !== 'admin':
    RETURN <Navigate to="/login" />

  RETURN children
```

| Check | Behavior |
|---|---|
| `loading` is `true` | Show a loading spinner while `POST /api/auth/refresh` is in progress on page load (Section 5.4) |
| `user` is `null` | Redirect to `/login` — no valid session |
| `user.role` is not `admin` | Redirect to `/login` — student users should use the student dashboard at `acadhost.com` |

### 14.2.3 Forced Password Change Overlay

When `user.mustChangePassword` is `true` (Section 5.8.2), the admin dashboard renders a full-screen password change form that blocks all interaction until the password is changed:

```
function AdminLayout({ children }):
  { user } = useAuthContext()

  IF user.mustChangePassword:
    RETURN <ForcePasswordChangeOverlay />

  RETURN (
    <Navbar />
    {children}
  )
```

The `ForcePasswordChangeOverlay` component:

| Element | Description |
|---|---|
| Heading | "Change Your Password" |
| Message | "You must change your default password before continuing." |
| Form fields | `currentPassword`, `newPassword`, `confirmNewPassword` |
| API endpoint | `PUT /api/auth/password` (Section 6.2.8) |
| On success | Set `user.mustChangePassword = false` in AuthContext state; overlay disappears; admin proceeds normally |

### 14.2.4 Public Route Redirect

If an already-authenticated admin navigates to `/login`, they are redirected to `/`:

```
function PublicRoute({ children }):
  { user, loading } = useAuthContext()

  IF loading:
    RETURN <LoadingSpinner />

  IF user is not null AND user.role === 'admin':
    RETURN <Navigate to="/" />

  RETURN children
```

---

## 14.3 Authentication Context — `AuthContext.jsx`

The admin dashboard's `AuthContext` follows the identical pattern as the student dashboard (Section 13.3), with the same token-in-memory storage, page-load refresh, proactive refresh, and 401 interceptor. The only difference is the role check.

### 14.3.1 State

| State Variable | Type | Initial Value | Description |
|---|---|---|---|
| `accessToken` | `string` or `null` | `null` | JWT access token; stored in memory only; never in `localStorage` or cookies (Section 5.4) |
| `user` | `object` or `null` | `null` | User data: `{ id, email, name, role, mustChangePassword }` |
| `loading` | `boolean` | `true` | `true` while the initial token refresh is in progress |

### 14.3.2 Provided Functions

| Function | Description |
|---|---|
| `login(email, password)` | Calls `POST /api/auth/login`; stores `accessToken` and `user` in state |
| `logout()` | Calls `POST /api/auth/logout`; clears `accessToken` and `user` from state |
| `refreshToken()` | Calls `POST /api/auth/refresh`; updates `accessToken` in state; called on page load/refresh and proactively before expiry |

There is no `register()` function — admin accounts are never registered through the UI.

### 14.3.3 Token Refresh on Page Load

Identical to Section 13.3.3. On mount, `AuthContext` calls `POST /api/auth/refresh` to restore the session from the `httpOnly` cookie.

### 14.3.4 Proactive Token Refresh

Identical to Section 13.3.4. The access token is refreshed 60 seconds before its `exp` claim.

### 14.3.5 JWT Decoding

Identical to Section 13.3.5. The access token payload is decoded via base64 to extract `sub`, `email`, `role`.

---

## 14.4 API Client — `services/api.js`

The admin dashboard's API client follows the identical pattern as the student dashboard (Section 13.4).

### 14.4.1 Configuration

```javascript
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',          // Nginx on admin.acadhost.com proxies /api/* to the backend (Section 8.3.2)
  withCredentials: true,    // Send httpOnly cookies (refresh token)
  headers: {
    'Content-Type': 'application/json',
  },
});
```

| Setting | Value | Reason |
|---|---|---|
| `baseURL` | `/api` | In production, Nginx on `admin.acadhost.com` proxies `/api/*` to `http://127.0.0.1:3000/api/*` (Section 8.3.2) |
| `withCredentials` | `true` | Required for the `httpOnly` `refreshToken` cookie (Section 5.10) |

### 14.4.2 Request Interceptor — Attach Access Token

Identical to Section 13.4.2. Every request includes `Authorization: Bearer <token>`.

### 14.4.3 Response Interceptor — Handle 401

Identical to Section 13.4.3. On `401`, attempt a token refresh; on failure, log out.

---

## 14.5 Theme — `styles/theme.css`

The admin dashboard does not have a dark/light mode toggle (the spec only specifies dark/light mode for the student dashboard's profile section). The admin dashboard uses a single fixed theme.

```css
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f5;
  --text-primary: #333333;
  --text-secondary: #666666;
  --accent: #2196F3;
  --accent-hover: #1976D2;
  --border: #e0e0e0;
  --card-bg: #ffffff;
  --card-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  --error: #f44336;
  --success: #4CAF50;
  --warning: #ff9800;
  --input-bg: #ffffff;
  --input-border: #cccccc;
  --navbar-bg: #1a237e;
  --navbar-text: #ffffff;
  --badge-pending: #ff9800;
  --badge-approved: #4CAF50;
  --badge-denied: #f44336;
  --badge-running: #4CAF50;
  --badge-stopped: #9e9e9e;
  --badge-building: #2196F3;
  --badge-failed: #f44336;
  --badge-invited: #ff9800;
  --badge-active: #4CAF50;
  --badge-removed: #9e9e9e;
}
```

AMBIGUITY DETECTED: The spec does not define specific color values for the admin dashboard.
My decision: The CSS custom properties above provide a functional starting point. A distinct `--navbar-bg` color (#1a237e, dark blue) differentiates the admin dashboard visually from the student dashboard. Exact colors are implementation details that do not affect API contracts.

---

## 14.6 Navigation Bar — `Navbar.jsx`

The navigation bar is visible on all authenticated admin pages.

### 14.6.1 Navigation Items

| Label | Route | Description |
|---|---|---|
| Dashboard | `/` | System-wide metrics |
| Projects | `/projects` | Project management |
| Students | `/students` | Student management |
| Requests | `/resource-requests` | Resource request review |
| Logout | (triggers `logout()`) | Clears session and navigates to `/login` |

### 14.6.2 Active State

The current route's navigation item is visually highlighted (e.g., underline, background color, bold text).

### 14.6.3 Logout Behavior

Identical to Section 13.10.3. Calls `POST /api/auth/logout`, then clears state and navigates to `/login`.

---

## 14.7 Login Page — `LoginPage.jsx`

### 14.7.1 Route and Access

| Property | Value |
|---|---|
| Route | `/login` |
| Access | Public; redirects to `/` if already authenticated (Section 14.2.4) |
| API Endpoint | `POST /api/auth/login` (Section 6.2.1) |

### 14.7.2 Form Fields

| Field | Type | Required | Maps To |
|---|---|---|---|
| Email | `<input type="email">` | Yes | `email` in request body |
| Password | `<input type="password">` | Yes | `password` in request body |

### 14.7.3 Submit Behavior

```
async function handleLogin(email, password):
  TRY:
    response = await api.post('/api/auth/login', { email, password })
    accessToken = response.data.data.accessToken
    user = response.data.data.user
    setAccessToken(accessToken)
    setUser(user)

    IF user.role !== 'admin':
      // Student logged into admin dashboard — show message
      showError('This dashboard is for administrators only. Please use acadhost.com.')
      logout()
      RETURN

    navigate('/')
    // If mustChangePassword is true, the AdminLayout overlay handles it
  CATCH error:
    displayErrorMessage(error.response.data.error)
```

### 14.7.4 Error Display

| Error Code (from Section 6.2.1) | User-Facing Message |
|---|---|
| `VALIDATION_ERROR` | Display the `message` field from the response |
| `INVALID_CREDENTIALS` | "Invalid email or password" |
| `REGISTRATION_INCOMPLETE` | "Please complete registration using your invitation link" |
| `ACCOUNT_REMOVED` | "This account has been deactivated" |

---

## 14.8 Dashboard Page — `DashboardPage.jsx` and `Dashboard.jsx`

The admin dashboard home page displays system-wide metrics (spec: "The admin dashboard displays system-wide metrics including total live projects and aggregate CPU, RAM, and storage consumption, presented in a card-based layout where possible").

### 14.8.1 Data Source

| API Endpoint | Purpose |
|---|---|
| `GET /api/admin/metrics` (Section 6.4.1) | Fetches all system-wide metrics |

Called on page mount and can be refreshed on demand.

### 14.8.2 System Metrics Cards — `SystemMetricsCard.jsx`

Each metric is displayed as a card in a card-based layout:

| Card Label | Source Field | Display |
|---|---|---|
| Live Projects | `totalLiveProjects` | Count of currently running projects |
| Active Students | `totalStudents` | Count of active student accounts |
| CPU Usage | `aggregateCpuUsed` / `totalCpuAllocated` | Used cores / allocated cores |
| RAM Usage | `aggregateRamUsedMb` / `totalRamAllocatedMb` | Used MB / allocated MB |
| Storage Usage | `aggregateStorageUsedMb` / `totalStorageAllocatedMb` | Used MB / allocated MB |
| Pending Requests | `pendingResourceRequests` | Count of pending resource requests |

**`SystemMetricsCard` component interface:**

```
SystemMetricsCard({ label, value, subtitle })
  RENDER:
    <Card>
      <Label>{label}</Label>
      <Value>{value}</Value>
      <Subtitle>{subtitle}</Subtitle>
    </Card>
```

**Card display examples:**

| Card | Value | Subtitle |
|---|---|---|
| Live Projects | `23` | — |
| Active Students | `50` | — |
| CPU Usage | `18.50 / 100.00` | `cores` |
| RAM Usage | `12,288 / 51,200` | `MB` |
| Storage Usage | `45,000 / 128,000` | `MB` |
| Pending Requests | `3` | (highlight if > 0) |

### 14.8.3 Metrics Scope

The admin metrics use `status = 'running'` for aggregate CPU/RAM (active VM load), while per-student quotas sum all non-deleted projects. This distinction is documented in Section 10.9.1.

---

## 14.9 Projects Page — `ProjectsPage.jsx` and `ProjectList.jsx`

Spec: "The Projects section lists all deployed projects across all students. The admin can stop or terminate any project. Each action triggers an automated email notification to the affected student."

### 14.9.1 Data Source

| API Endpoint | Purpose |
|---|---|
| `GET /api/admin/projects` (Section 6.4.8) | Fetches all projects across all students (paginated) |

### 14.9.2 Filter and Search Controls

| Control | Type | Query Parameter | Options / Constraints |
|---|---|---|---|
| Status filter | Dropdown | `status` | `All` (default), `building`, `running`, `stopped`, `failed`, `deleted` |
| Student filter | Dropdown or text input | `studentId` | Filter by student ID |
| Search | Text input | `search` | Search by project title or subdomain (partial match) |
| Page | Pagination controls | `page` | 1-indexed |
| Items per page | Dropdown | `limit` | Default `20`, max `100` |

### 14.9.3 Project List Table

Each project in the response is displayed as a row in a table or card:

| Column | Source Field | Display |
|---|---|---|
| Title | `item.title` | Project display title |
| Subdomain | `item.subdomain` | Subdomain text |
| Live URL | `item.liveUrl` | Clickable link: `https://{subdomain}.acadhost.com` |
| Type | `item.projectType` | `frontend`, `backend`, or `combined` |
| Runtime | `item.runtime` / `item.runtimeVersion` | e.g., `Node.js 20` or `Python 3.11` or `—` for frontend |
| Status | `item.status` | Color-coded badge: `running` = green, `stopped` = gray, `building` = blue, `failed` = red, `deleted` = dark gray |
| CPU | `item.cpuLimit` | CPU cores allocated |
| RAM | `item.ramLimitMb` | RAM in MB allocated |
| Student | `item.student.name` (`item.student.email`) | Owning student name and email |
| Created | `item.createdAt` | Formatted date |
| Actions | — | Stop button, Terminate button (conditional) |

### 14.9.4 Pagination

The response includes a `pagination` object (Section 6.1.2):

```json
{
  "page": 1,
  "limit": 20,
  "totalItems": 23,
  "totalPages": 2
}
```

The frontend renders page navigation controls: Previous, Next, and page number indicators.

### 14.9.5 Stop Action

| Property | Value |
|---|---|
| Button label | "Stop" |
| Displayed when | `item.status` is `running` |
| API endpoint | `POST /api/admin/projects/:id/stop` (Section 6.4.9) |
| Confirmation | Confirmation dialog: "Stop project '{title}'? The student will be notified by email." |

**Submit behavior:**

```
async function handleStopProject(projectId, title):
  IF NOT confirm(`Stop project "${title}"? The student will be notified.`):
    RETURN

  TRY:
    response = await api.post(`/api/admin/projects/${projectId}/stop`)
    showSuccess(`Project "${title}" stopped. Student notified at ${response.data.data.notifiedStudent}.`)
    refreshProjectList()
  CATCH error:
    displayErrorMessage(error.response.data.error)
```

**Error Codes (from Section 6.4.9):**

| Error Code | User-Facing Message |
|---|---|
| `PROJECT_NOT_FOUND` | "Project not found." |
| `PROJECT_ALREADY_STOPPED` | "Project is already stopped." |
| `PROJECT_DELETED` | "Cannot stop a deleted project." |
| `PROJECT_BUILDING` | "Cannot stop a project that is currently building." |

### 14.9.6 Terminate Action

| Property | Value |
|---|---|
| Button label | "Terminate" |
| Displayed when | `item.status` is not `deleted` |
| API endpoint | `POST /api/admin/projects/:id/terminate` (Section 6.4.10) |
| Confirmation | Confirmation dialog: "Terminate project '{title}'? This will permanently remove the container, source files, and Nginx config. The student will be notified by email. This action cannot be undone." |

Admin "terminate" is equivalent to student "delete" with an additional email notification (Section 12.11.2).

**Submit behavior:**

```
async function handleTerminateProject(projectId, title):
  IF NOT confirm(`Terminate project "${title}"? This cannot be undone.`):
    RETURN

  TRY:
    response = await api.post(`/api/admin/projects/${projectId}/terminate`)
    showSuccess(`Project "${title}" terminated. Student notified at ${response.data.data.notifiedStudent}.`)
    refreshProjectList()
  CATCH error:
    displayErrorMessage(error.response.data.error)
```

**Error Codes (from Section 6.4.10):**

| Error Code | User-Facing Message |
|---|---|
| `PROJECT_NOT_FOUND` | "Project not found." |
| `PROJECT_ALREADY_DELETED` | "Project has already been terminated." |

### 14.9.7 Button State by Project Status

| Status | Stop Button | Terminate Button |
|---|---|---|
| `building` | Disabled | Enabled |
| `running` | Enabled | Enabled |
| `stopped` | Disabled | Enabled |
| `failed` | Disabled | Enabled |
| `deleted` | Hidden | Hidden |

This matches the operation restriction matrix in Section 12.3.2.

---

## 14.10 Students Page — `StudentsPage.jsx`, `StudentList.jsx`, `StudentQuotaEditor.jsx`, `StudentInvite.jsx`, `BatchRemoval.jsx`

Spec: "The Students section lists all registered students. For each student the admin can adjust individual resource quotas — CPU cores, RAM, storage, number of projects, and number of databases — and can remove individual students from the platform."

### 14.10.1 Data Source

| API Endpoint | Purpose |
|---|---|
| `GET /api/admin/students` (Section 6.4.2) | Fetches all students (paginated, filterable) |

### 14.10.2 Filter and Search Controls

| Control | Type | Query Parameter | Options / Constraints |
|---|---|---|---|
| Status filter | Dropdown | `status` | `All` (default), `invited`, `active`, `removed` |
| Batch year filter | Dropdown or text input | `batchYear` | Filter by enrollment year |
| Search | Text input | `search` | Search by name or email (partial match) |
| Page | Pagination controls | `page` | 1-indexed |
| Items per page | Dropdown | `limit` | Default `20`, max `100` |

### 14.10.3 Student List Table — `StudentList.jsx`

| Column | Source Field | Display |
|---|---|---|
| Name | `item.name` | Student name (null for invited-not-registered) |
| Email | `item.email` | Student email |
| Status | `item.status` | Color-coded badge: `invited` = orange/yellow, `active` = green, `removed` = gray |
| Batch Year | `item.batchYear` | Enrollment year (null if not assigned) |
| CPU | `item.cpuUsed` / `item.cpuQuota` | Used / total cores |
| RAM | `item.ramUsedMb` / `item.ramQuotaMb` | Used / total MB |
| Projects | `item.projectCount` / `item.maxProjects` | Used / total |
| Databases | `item.databaseCount` / `item.maxDatabases` | Used / total |
| Created | `item.createdAt` | Formatted date |
| Actions | — | Edit Quota, Remove, Resend Invite (conditional) |

### 14.10.4 Student Actions

| Action | Button Label | Displayed When | API Endpoint |
|---|---|---|---|
| Edit quota | "Edit Quota" | `status` is `active` | Opens `StudentQuotaEditor` |
| Remove student | "Remove" | `status` is `active` or `invited` | `DELETE /api/admin/students/:id` (Section 6.4.4) |
| Resend invite | "Resend Invite" | `status` is `invited` | `POST /api/admin/students/:id/resend-invite` (Section 6.4.7) |

### 14.10.5 Student Quota Editor — `StudentQuotaEditor.jsx`

Spec: "For each student the admin can adjust individual resource quotas — CPU cores, RAM, storage, number of projects, and number of databases."

The quota editor is displayed as an inline form, modal, or expandable panel when the admin clicks "Edit Quota" on a student row.

**Form Fields:**

| Field | Type | Current Value Source | Constraints | Maps To |
|---|---|---|---|---|
| CPU Quota (cores) | Number input | `student.cpuQuota` | Positive, max 2 decimal places | `cpuQuota` |
| RAM Quota (MB) | Number input | `student.ramQuotaMb` | Positive integer | `ramQuotaMb` |
| Storage Quota (MB) | Number input | `student.storageQuotaMb` | Positive integer | `storageQuotaMb` |
| Max Projects | Number input | `student.maxProjects` | Positive integer | `maxProjects` |
| Max Databases | Number input | `student.maxDatabases` | Positive integer | `maxDatabases` |

All fields are optional — only changed fields are sent. At least one field must be modified.

**API Endpoint:** `PUT /api/admin/students/:id/quota` (Section 6.4.3)

**Submit behavior:**

```
async function handleUpdateQuota(studentId, quotaData):
  TRY:
    response = await api.put(`/api/admin/students/${studentId}/quota`, quotaData)
    showSuccess('Quota updated successfully')
    refreshStudentList()
  CATCH error:
    displayErrorMessage(error.response.data.error)
```

**Error Codes (from Section 6.4.3):**

| Error Code | User-Facing Message |
|---|---|
| `STUDENT_NOT_FOUND` | "Student not found." |
| `VALIDATION_ERROR` | Display the `message` field |
| `QUOTA_BELOW_USAGE` | Display the `message` field (e.g., "Cannot set max projects below current usage (3 active projects)") |

The `QUOTA_BELOW_USAGE` error is returned when the admin attempts to set a quota below the student's current usage (Section 10.7.4). The error message includes the current usage value — the frontend should display this message directly.

### 14.10.6 Remove Student

**Confirmation dialog:** "Remove student '{name}' ({email})? This will permanently delete all their projects, databases, containers, and source files. This action cannot be undone."

**API Endpoint:** `DELETE /api/admin/students/:id` (Section 6.4.4)

**Submit behavior:**

```
async function handleRemoveStudent(studentId, name, email):
  IF NOT confirm(`Remove student "${name}" (${email})? This cannot be undone.`):
    RETURN

  TRY:
    response = await api.delete(`/api/admin/students/${studentId}`)
    showSuccess(`Student "${name}" removed.`)
    refreshStudentList()
  CATCH error:
    displayErrorMessage(error.response.data.error)
```

**Error Codes (from Section 6.4.4):**

| Error Code | User-Facing Message |
|---|---|
| `STUDENT_NOT_FOUND` | "Student not found." |
| `CANNOT_DELETE_ADMIN` | "Cannot delete the admin account." |

### 14.10.7 Resend Invite

Displayed only for students with `status = 'invited'`.

**API Endpoint:** `POST /api/admin/students/:id/resend-invite` (Section 6.4.7)

**Submit behavior:**

```
async function handleResendInvite(studentId, email):
  TRY:
    response = await api.post(`/api/admin/students/${studentId}/resend-invite`)
    showSuccess(`Invitation resent to ${response.data.data.email}.`)
  CATCH error:
    displayErrorMessage(error.response.data.error)
```

**Error Codes (from Section 6.4.7):**

| Error Code | User-Facing Message |
|---|---|
| `STUDENT_NOT_FOUND` | "Student not found." |
| `ALREADY_REGISTERED` | "Student has already completed registration." |

---

## 14.11 Student Invitation — `StudentInvite.jsx`

Spec: "To add students, the admin can either upload a list of email addresses via an Excel file or enter one or more addresses directly in a text field, comma-separated. Before processing, the platform validates each address. Any addresses that already exist in the system are skipped, and the admin is informed which ones were skipped. A batch year label can be assigned to the group being added."

### 14.11.1 Location

The `StudentInvite` component is rendered within `StudentsPage.jsx` — either as a collapsible section, a modal triggered by an "Invite Students" button, or a dedicated tab.

### 14.11.2 Form Fields

| Field | Type | Required | Constraints | Maps To |
|---|---|---|---|---|
| Email Addresses | `<textarea>` | Conditional (at least one of emails or file) | Comma-separated email addresses | `emails` in multipart request |
| Excel File | `<input type="file">` | Conditional (at least one of emails or file) | `.xlsx` or `.xls` files only | `file` in multipart request |
| Batch Year | `<input type="number">` | No | Valid year (e.g., `2024`) | `batchYear` in multipart request |

The admin must provide at least one of `emails` or `file`. Both can be provided simultaneously — the backend merges both sources.

### 14.11.3 Submit Behavior

The form is submitted as `multipart/form-data` to `POST /api/admin/students/invite` (Section 6.4.6):

```
async function handleInviteStudents(formData):
  TRY:
    response = await api.post('/api/admin/students/invite', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    showInviteResults(response.data.data)
  CATCH error:
    displayErrorMessage(error.response.data.error)
```

### 14.11.4 Results Display

After a successful submission, the response contains three categories (Section 6.4.6):

| Category | Source Field | Display |
|---|---|---|
| Successfully invited | `data.invited` (array of email strings) | Green list: "Invitation sent to {email}" for each |
| Skipped (already exist) | `data.skipped` (array of `{ email, reason }`) | Yellow/orange list: "{email} — {reason}" for each |
| Invalid format | `data.invalid` (array of `{ email, reason }`) | Red list: "{email} — {reason}" for each |
| Summary counts | `data.totalInvited`, `data.totalSkipped`, `data.totalInvalid` | Summary line: "{totalInvited} invited, {totalSkipped} skipped, {totalInvalid} invalid" |

**Error Codes (from Section 6.4.6):**

| Error Code | User-Facing Message |
|---|---|
| `VALIDATION_ERROR` | "Either email addresses or an Excel file must be provided." |
| `INVALID_FILE_FORMAT` | "File must be an Excel file (.xlsx or .xls)." |
| `NO_VALID_EMAILS` | "No valid email addresses found in the provided input." |

---

## 14.12 Batch Removal — `BatchRemoval.jsx`

Spec: "The admin can also perform a batch removal of all students from a specific enrollment year, for example removing the entire 2022 batch at once."

### 14.12.1 Location

The `BatchRemoval` component is rendered within `StudentsPage.jsx` — as a collapsible section, modal, or dedicated tab.

### 14.12.2 Form Fields

| Field | Type | Required | Constraints | Maps To |
|---|---|---|---|---|
| Batch Year | `<input type="number">` | Yes | Valid year (e.g., `2022`) | `batchYear` in request body |

### 14.12.3 Submit Behavior

**Confirmation dialog:** "Remove ALL students from batch year {batchYear}? This will permanently delete all their projects, databases, containers, and source files. This action cannot be undone."

**API Endpoint:** `POST /api/admin/students/batch-remove` (Section 6.4.5)

```
async function handleBatchRemoval(batchYear):
  IF NOT confirm(`Remove ALL students from batch ${batchYear}? This cannot be undone.`):
    RETURN

  TRY:
    response = await api.post('/api/admin/students/batch-remove', { batchYear })
    data = response.data.data
    showSuccess(
      `Batch ${batchYear} removed: ${data.studentsRemoved} students, ` +
      `${data.projectsRemoved} projects, ${data.databasesRemoved} databases.`
    )
    IF data.failed.length > 0:
      showWarning(`Failed to remove ${data.failed.length} student(s): IDs ${data.failed.join(', ')}`)
    refreshStudentList()
  CATCH error:
    displayErrorMessage(error.response.data.error)
```

### 14.12.4 Results Display

| Field | Source | Display |
|---|---|---|
| Students removed | `data.studentsRemoved` | Count |
| Projects removed | `data.projectsRemoved` | Count |
| Databases removed | `data.databasesRemoved` | Count |
| Failed | `data.failed` | Array of student IDs that failed cleanup; displayed as a warning if non-empty |

**Error Codes (from Section 6.4.5):**

| Error Code | User-Facing Message |
|---|---|
| `VALIDATION_ERROR` | "Batch year is required" or "Batch year must be a valid integer" |
| `NO_STUDENTS_FOUND` | "No students found for batch year {batchYear}." |

---

## 14.13 Resource Requests Page — `ResourceRequestsPage.jsx` and `ResourceRequestList.jsx`

Spec: "Resource Requests — The final navigation section provides a request channel to the admin." (student side) and implied admin review functionality.

### 14.13.1 Data Source

| API Endpoint | Purpose |
|---|---|
| `GET /api/resource-requests` (Section 6.7.2, admin scope) | Fetches all resource requests across all students (paginated) |

### 14.13.2 Filter Controls

| Control | Type | Query Parameter | Options |
|---|---|---|---|
| Status filter | Dropdown | `status` | `All` (default), `pending`, `approved`, `denied` |
| Page | Pagination controls | `page` | 1-indexed |
| Items per page | Dropdown | `limit` | Default `20`, max `100` |

### 14.13.3 Request List Table — `ResourceRequestList.jsx`

| Column | Source Field | Display |
|---|---|---|
| Student | `item.student.name` (`item.student.email`) | Requesting student name and email |
| Resource Type | `item.resourceType` | `cpu`, `ram`, `storage`, `projects`, or `databases` |
| Requested Value | `item.requestedValue` | The value requested (absolute total, not delta — Section 6 ambiguity #9) |
| Description | `item.description` | Student's justification |
| Status | `item.status` | Color-coded badge: `pending` = orange/yellow, `approved` = green, `denied` = red |
| Admin Notes | `item.adminNotes` | Admin's response (if reviewed) |
| Submitted | `item.createdAt` | Formatted date |
| Reviewed | `item.reviewedAt` | Formatted date (if reviewed) |
| Actions | — | Approve / Deny buttons (for pending requests only) |

### 14.13.4 Review Action — Approve / Deny

| Property | Value |
|---|---|
| Displayed when | `item.status` is `pending` |
| API endpoint | `PUT /api/resource-requests/:id` (Section 6.7.3) |

**Approve flow:**

```
async function handleApprove(requestId, adminNotes):
  TRY:
    response = await api.put(`/api/resource-requests/${requestId}`, {
      status: 'approved',
      adminNotes: adminNotes || null
    })
    showSuccess('Request approved. Quota updated automatically.')
    refreshRequestList()
  CATCH error:
    displayErrorMessage(error.response.data.error)
```

**Deny flow:**

```
async function handleDeny(requestId, adminNotes):
  TRY:
    response = await api.put(`/api/resource-requests/${requestId}`, {
      status: 'denied',
      adminNotes: adminNotes || null
    })
    showSuccess('Request denied.')
    refreshRequestList()
  CATCH error:
    displayErrorMessage(error.response.data.error)
```

**Admin Notes input:** When the admin clicks Approve or Deny, a text input or modal appears for optional admin notes (max 1000 characters, Section 6.7.3). The notes are displayed to the student in their request history.

**Auto-apply on approval:** When `status = 'approved'`, the backend automatically applies the `requestedValue` as the new absolute total for the corresponding quota column on the student's `users` row (Section 6.7.3). No additional API call is needed from the frontend. The response includes `quotaApplied: true` to confirm.

**Error Codes (from Section 6.7.3):**

| Error Code | User-Facing Message |
|---|---|
| `REQUEST_NOT_FOUND` | "Resource request not found." |
| `REQUEST_ALREADY_REVIEWED` | "This request has already been reviewed." |
| `VALIDATION_ERROR` | "Status must be approved or denied." |

---

## 14.14 API Endpoint Summary — Admin Dashboard

This table lists every API endpoint consumed by the admin dashboard:

| Page / Component | API Endpoint | Method | Purpose |
|---|---|---|---|
| AuthContext (page load) | `/api/auth/refresh` | `POST` | Restore session on page load/refresh |
| AuthContext (proactive) | `/api/auth/refresh` | `POST` | Refresh access token before expiry |
| LoginPage | `/api/auth/login` | `POST` | Admin login |
| Navbar (logout) | `/api/auth/logout` | `POST` | Logout and clear session |
| ForcePasswordChange | `/api/auth/password` | `PUT` | Change password (forced on first login) |
| DashboardPage | `/api/admin/metrics` | `GET` | System-wide metrics |
| ProjectsPage | `/api/admin/projects` | `GET` | List all projects (paginated) |
| ProjectsPage (stop) | `/api/admin/projects/:id/stop` | `POST` | Stop a project |
| ProjectsPage (terminate) | `/api/admin/projects/:id/terminate` | `POST` | Terminate a project |
| StudentsPage | `/api/admin/students` | `GET` | List all students (paginated) |
| StudentsPage (quota) | `/api/admin/students/:id/quota` | `PUT` | Adjust student quotas |
| StudentsPage (remove) | `/api/admin/students/:id` | `DELETE` | Remove individual student |
| StudentsPage (resend) | `/api/admin/students/:id/resend-invite` | `POST` | Resend invitation |
| StudentInvite | `/api/admin/students/invite` | `POST` | Invite students (multipart) |
| BatchRemoval | `/api/admin/students/batch-remove` | `POST` | Batch remove by year |
| ResourceRequestsPage | `/api/resource-requests` | `GET` | List all requests (admin scope) |
| ResourceRequestsPage (review) | `/api/resource-requests/:id` | `PUT` | Approve or deny request |

**Total unique endpoints consumed: 15** (out of the 40 total platform endpoints, Section 6.10).

---

## 14.15 Error Handling Patterns

### 14.15.1 Standard Error Display

Identical to Section 13.19.1. All API error responses follow the standard envelope (Section 6.1.1). The frontend displays the `message` field from the error response.

### 14.15.2 Network Error Handling

Identical to Section 13.19.2. "Unable to connect to the server. Please check your connection."

### 14.15.3 Loading States

Identical to Section 13.19.3. Full-page spinner for initial load; button spinners for form submissions; inline spinners for data fetches.

### 14.15.4 Confirmation Dialogs for Destructive Actions

The admin dashboard requires confirmation dialogs for all destructive actions:

| Action | Confirmation Required | Reason |
|---|---|---|
| Stop project | Yes | Affects student's running project; triggers email |
| Terminate project | Yes | Permanently removes resources; cannot be undone |
| Remove student | Yes | Permanently removes all student data; cannot be undone |
| Batch remove students | Yes | Mass destructive action; cannot be undone |
| Approve/deny resource request | No | Reversible by adjusting quota directly |

---

## 14.16 Shared Patterns Between Student and Admin Dashboards

While the student and admin dashboards are separate codebases, they share these identical patterns:

| Pattern | Implementation | Reference |
|---|---|---|
| Access token in JavaScript memory | React state in AuthContext; never `localStorage` | Section 5.4, Section 13.3.1 |
| Token refresh on page load | `POST /api/auth/refresh` on mount | Section 13.3.3 |
| Proactive token refresh | Refresh 60 seconds before `exp` claim | Section 13.3.4 |
| JWT decoding | Base64 decode of payload | Section 13.3.5 |
| 401 response interceptor | Retry with refreshed token; logout on failure | Section 13.4.3 |
| Axios `withCredentials: true` | Required for httpOnly cookie | Section 5.10 |
| API base URL `/api` | Nginx proxies to backend | Section 8.3.1, 8.3.2 |
| Standard error envelope | `{ success, error, message }` | Section 6.1.1 |
| Logout behavior | Idempotent; clear state even if API call fails | Section 6.2.4 |
| `mustChangePassword` forced redirect | Blocks all navigation until password is changed | Section 5.8.2 |

Code generators may share utility functions (e.g., `decodeJwt`, error display helpers) between the two dashboards at the code level, but the dashboards are built and deployed independently.

---

## 14.17 Ambiguity Decisions Registry

| # | Ambiguity | Decision | Rationale |
|---|---|---|---|
| 1 | Spec does not define a dedicated route for the admin's forced password change | Full-screen overlay within the admin layout, not a separate route | Simpler than a separate page; blocks all navigation; same UX effect |
| 2 | Spec does not define specific color values for the admin dashboard | CSS custom properties with a functional color set; dark blue navbar to distinguish from student dashboard | Implementation detail; visual differentiation helps the admin know which dashboard they are on |
| 3 | Spec does not define whether the admin dashboard has a dark/light mode toggle | No dark/light mode toggle for the admin dashboard | The spec only mentions dark/light mode in the student profile section; the admin dashboard uses a single fixed theme |
| 4 | Spec does not define where the StudentInvite and BatchRemoval components are placed within StudentsPage | Rendered as collapsible sections, modals, or tabs within StudentsPage | UI layout detail; does not affect API contracts |
| 5 | Spec does not define whether admin notes are required for approve/deny | Admin notes are optional (max 1000 characters) | Some approvals/denials are self-explanatory; forcing notes would slow down the admin |
| 6 | Spec does not define whether student users who log into the admin dashboard are redirected | Student users are shown an error and logged out; they should use `acadhost.com` | Separate SPAs per role; prevents confusion |
| 7 | Spec does not define whether the admin can see deleted projects in the project list | The status filter includes `deleted` as an option | Deleted projects have `status = 'deleted'` in the database; the admin may need to audit them |
| 8 | Spec does not define a refresh/reload button for the admin metrics dashboard | Not explicitly included; data is fetched on page mount | The admin can refresh the browser or navigate away and back; a manual refresh button can be added as a UX enhancement in the code phase |

---

## VERIFICATION REPORT — Section 14: Admin Dashboard — Frontend Specification

### Spec Alignment Check

| Spec Requirement | Covered In Output | Status |
|---|---|---|
| "The admin account is a single fixed account created via a seed script on first deployment" | Section 14.1.4, Section 14.3.2 (no register function) | ✅ Covered |
| "The admin email is configured through an environment variable" | Section 14.1.4 (cross-ref to Section 5.8.1) | ✅ Covered |
| "There is no self-registration for admin accounts" | Section 14.3.2 (no register function; no registration route) | ✅ Covered |
| "The admin dashboard displays system-wide metrics including total live projects and aggregate CPU, RAM, and storage consumption, presented in a card-based layout where possible" | Section 14.8 — DashboardPage.jsx and SystemMetricsCard.jsx | ✅ Covered |
| "The Projects section lists all deployed projects across all students" | Section 14.9 — ProjectsPage.jsx and ProjectList.jsx | ✅ Covered |
| "The admin can stop or terminate any project" | Section 14.9.5 (Stop) and Section 14.9.6 (Terminate) | ✅ Covered |
| "Each action triggers an automated email notification to the affected student" | Section 14.9.5, 14.9.6 — confirmation dialogs note email notification; backend sends email | ✅ Covered |
| "The Students section lists all registered students" | Section 14.10 — StudentsPage.jsx and StudentList.jsx | ✅ Covered |
| "For each student the admin can adjust individual resource quotas — CPU cores, RAM, storage, number of projects, and number of databases" | Section 14.10.5 — StudentQuotaEditor.jsx | ✅ Covered |
| "Can remove individual students from the platform" | Section 14.10.6 — Remove Student | ✅ Covered |
| "The admin can also perform a batch removal of all students from a specific enrollment year" | Section 14.12 — BatchRemoval.jsx | ✅ Covered |
| "To add students, the admin can either upload a list of email addresses via an Excel file or enter one or more addresses directly in a text field, comma-separated" | Section 14.11 — StudentInvite.jsx | ✅ Covered |
| "Before processing, the platform validates each address" | Section 14.11.3 — backend validates; results displayed | ✅ Covered |
| "Any addresses that already exist in the system are skipped, and the admin is informed which ones were skipped" | Section 14.11.4 — skipped array displayed | ✅ Covered |
| "A batch year label can be assigned to the group being added" | Section 14.11.2 — batchYear form field | ✅ Covered |
| "After submission, the platform sends each new student an invitation email containing a time-limited registration link" | Section 14.11.3 — POST /api/admin/students/invite triggers emails | ✅ Covered |
| "Invitation links expire after two hours" | Cross-ref to Section 3.2.3, Section 5.4 | ✅ Covered (backend enforces) |
| Section 5.8.2: "The frontend must redirect the admin to a password change screen before allowing access to any other functionality" | Section 14.2.3 — Forced Password Change Overlay | ✅ Covered |
| Section 5.4: "Access tokens stored in JavaScript memory, never in localStorage or cookies" | Section 14.3.1 — accessToken in state | ✅ Covered |
| Section 5.4: "Frontend must call POST /api/auth/refresh on every page load/refresh" | Section 14.3.3 — Token Refresh on Page Load | ✅ Covered |
| Resource request review — "reviewed and acted upon" by admin | Section 14.13 — ResourceRequestsPage.jsx and ResourceRequestList.jsx | ✅ Covered |
| Resource request approval auto-applies quota (Section 6 ambiguity #9) | Section 14.13.4 — quotaApplied: true confirmation | ✅ Covered |

### Gaps Found

| Missing Item | Action |
|---|---|
| (none) | — |

### Decisions Beyond The Spec

| Decision Made | Reason |
|---|---|
| Forced password change as overlay instead of separate route | Simpler implementation; same blocking effect |
| No dark/light mode toggle for admin dashboard | Spec only mentions dark/light mode for the student dashboard profile |
| Single fixed theme with dark blue navbar | Visual differentiation from student dashboard |
| Admin notes optional for approve/deny | Not all reviews need explanation; avoids slowing admin workflow |
| Deleted projects visible via status filter | Admin may need to audit deleted projects |
| Confirmation dialogs for all destructive actions (stop, terminate, remove, batch remove) | Standard UX for irreversible or impactful operations |

### Cross-Section Consistency Check

| Item | Matches Earlier Sections | Status |
|---|---|---|
| Access token in memory, never in localStorage | Section 5.4 | ✅ Consistent |
| Refresh token in httpOnly cookie | Section 5.10 | ✅ Consistent |
| POST /api/auth/refresh on page load | Section 5.4 | ✅ Consistent |
| mustChangePassword handling | Section 5.8.2, Section 6.2.1 | ✅ Consistent |
| Admin metrics fields | Section 6.4.1, Section 10.9.1 | ✅ Consistent |
| Admin metrics scope (running for CPU/RAM) | Section 10.9.1 | ✅ Consistent |
| Admin project list pagination | Section 6.1.2, Section 6.4.8 | ✅ Consistent |
| Admin project list filter params | Section 6.4.8 | ✅ Consistent |
| Stop error codes | Section 6.4.9 | ✅ Consistent |
| Terminate error codes | Section 6.4.10 | ✅ Consistent |
| Student list pagination and filters | Section 6.1.2, Section 6.4.2 | ✅ Consistent |
| Quota update fields and error codes | Section 6.4.3 | ✅ Consistent |
| Remove student error codes | Section 6.4.4 | ✅ Consistent |
| CANNOT_DELETE_ADMIN error | Section 6.4.4, Section 12.11.1 | ✅ Consistent |
| Resend invite error codes | Section 6.4.7 | ✅ Consistent |
| Invite multipart form (emails, file, batchYear) | Section 6.4.6 | ✅ Consistent |
| Invite response categories (invited, skipped, invalid) | Section 6.4.6 | ✅ Consistent |
| Batch removal request body and response | Section 6.4.5 | ✅ Consistent |
| Batch removal processes synchronously | Section 6.4.5, Section 12.15.2 | ✅ Consistent |
| Resource request review fields (status, adminNotes) | Section 6.7.3 | ✅ Consistent |
| Resource request approval auto-applies as absolute total | Section 6.7.3, Section 6 ambiguity #9 | ✅ Consistent |
| Resource request error codes | Section 6.7.3 | ✅ Consistent |
| Resource request list scoped by role (admin sees all) | Section 6.7.2 | ✅ Consistent |
| QUOTA_BELOW_USAGE error on quota decrease | Section 6.4.3, Section 10.7.4 | ✅ Consistent |
| File structure matches Section 2.4.2 | Section 2 | ✅ Consistent |
| All API endpoint paths match Section 6.10 | Section 6 | ✅ Consistent |
| Operation restriction matrix for project stop/terminate | Section 12.3.2 | ✅ Consistent |
| Admin terminate = student delete + email notification | Section 12.11.2 | ✅ Consistent |
| Admin stop = student stop + email notification | Section 12.11.3 | ✅ Consistent |
| No admin in batch removal (role = 'student' filter) | Section 12.11.1 | ✅ Consistent |
| Admin cannot delete themselves | Section 12.11.1 | ✅ Consistent |

### Business Logic Check

| Logic Item | Real-World Valid | Issue (if any) |
|---|---|---|
| Token refresh on every page load | ✅ Valid | Standard SPA pattern |
| Forced password change overlay | ✅ Valid | Blocks all interaction; same effect as redirect to dedicated page |
| No dark/light mode for admin | ✅ Valid | Spec does not require it; single user; reduces complexity |
| Confirmation for destructive actions | ✅ Valid | Essential for admin operations that delete data permanently |
| Batch removal shows failed IDs | ✅ Valid | Admin can investigate and retry for failed students |
| quotaApplied confirmation on approval | ✅ Valid | Confirms the quota was automatically updated |
| Student logged into admin dashboard → error and logout | ✅ Valid | Prevents role confusion between separate SPAs |
| Deleted projects visible via filter | ✅ Valid | Audit trail; admin may need to review deleted project history |
| Admin notes optional for approve/deny | ⚠️ Questionable | Some institutions may want mandatory notes for accountability; but optional is less friction for a single-admin platform |

---

## ✅ SECTION 14 COMPLETE — Admin Dashboard — Frontend Specification

| Final Check | Result |
|---|---|
| All spec requirements covered | ✅ Yes |
| All gaps found and fixed | ✅ Yes |
| Business logic is consistent | ✅ Yes |
| No conflicts with past sections | ✅ Yes |
| Output is valid renderable Markdown | ✅ Yes |

**Section status: LOCKED**
This section's field names, variable names, table names, route paths, and values are now permanently locked. No changes will be made to this section in future sessions unless the user explicitly requests a correction.