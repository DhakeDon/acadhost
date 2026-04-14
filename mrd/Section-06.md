# Section 6 — API Routes — Complete Specification

## 6.1 Overview

All API routes are served by the Express.js backend under the `/api` prefix. Routes are organized into seven route files matching Section 2.3:

| Route File | Mount Path | Controller | Primary Role |
|---|---|---|---|
| `routes/auth.js` | `/api/auth` | `controllers/authController.js` | Public / any authenticated user |
| `routes/student.js` | `/api/student` | `controllers/studentController.js` | `student` |
| `routes/admin.js` | `/api/admin` | `controllers/adminController.js` | `admin` |
| `routes/projects.js` | `/api/projects` | `controllers/projectController.js` | `student` |
| `routes/databases.js` | `/api/databases` | `controllers/databaseController.js` | `student` |
| `routes/resourceRequests.js` | `/api/resource-requests` | `controllers/resourceRequestController.js` | `student` + `admin` |
| `routes/webhooks.js` | `/api/webhooks` | `services/webhookService.js` | Public (webhook secret validation) |

### 6.1.1 Standard Response Envelope

All API responses use the following JSON structure:

**Success responses:**

```json
{
  "success": true,
  "data": { ... }
}
```

**Error responses:**

```json
{
  "success": false,
  "error": "ERROR_CODE",
  "message": "Human-readable description"
}
```

Section 5 described authentication flow logic. Section 6 is the authoritative API contract — all response shapes follow the envelope defined here. Code generators follow Section 6 for all response formats.

### 6.1.2 Standard Pagination

Endpoints that return lists support optional pagination via query parameters:

| Query Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | `integer` | `1` | Page number (1-indexed) |
| `limit` | `integer` | `20` | Items per page (max `100`) |

**Paginated response format:**

```json
{
  "success": true,
  "data": {
    "items": [ ... ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalItems": 57,
      "totalPages": 3
    }
  }
}
```

### 6.1.3 Middleware Reference

| Middleware | Import Path | Purpose | Reference |
|---|---|---|---|
| `auth` | `middleware/auth.js` | Validates JWT access token; attaches `req.user` with `{ id, email, role }` | Section 5.6 |
| `roleGuard(role)` | `middleware/roleGuard.js` | Restricts access to specified role(s); reads `req.user.role` | Section 5.7 |

**`auth.js` token extraction order:**

The `auth` middleware extracts the access token from the request in the following priority order:

| Priority | Source | Format | Use Case |
|---|---|---|---|
| 1 | `Authorization` header | `Bearer <token>` | Standard API requests |
| 2 | `token` query parameter | Raw JWT string | SSE endpoints (`EventSource` does not support custom headers) |

If neither source provides a valid token, the middleware returns `401`.

---

## 6.2 Authentication Routes — `routes/auth.js`

All routes in this file are handled by `controllers/authController.js`. Detailed flow logic for each endpoint is defined in Section 5.9.

### 6.2.1 `POST /api/auth/login`

| Property | Value |
|---|---|
| Middleware | None (public) |
| Controller | `authController.login` |
| Content-Type | `application/json` |
| Section 5 Reference | Section 5.9.5 — Login Flow |

**Request Body:**

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `email` | `string` | Yes | Valid email format | User email address |
| `password` | `string` | Yes | Non-empty | User password |

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "accessToken": "<jwt_access_token>",
    "user": {
      "id": 1,
      "email": "admin@institution.edu",
      "name": "Admin",
      "role": "admin",
      "mustChangePassword": true
    }
  }
}
```

The `mustChangePassword` field is present only when `users.must_change_password = 1`. When absent or `false`, no forced password change is required.

**Cookie Set:**

| Cookie | Value | Attributes |
|---|---|---|
| `refreshToken` | Full refresh token JWT | `httpOnly=true`, `Secure=true`, `SameSite=Strict`, `Path=/api/auth`, `Max-Age=604800` |

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Missing `email` or `password` field | `400` | `VALIDATION_ERROR` | `Email and password are required` |
| Invalid email format | `400` | `VALIDATION_ERROR` | `Invalid email format` |
| Email not found in `users` table | `401` | `INVALID_CREDENTIALS` | `Invalid email or password` |
| `users.status = 'invited'` | `401` | `REGISTRATION_INCOMPLETE` | `Please complete registration using your invitation link` |
| `users.status = 'removed'` | `401` | `ACCOUNT_REMOVED` | `This account has been deactivated` |
| Password does not match `users.password_hash` | `401` | `INVALID_CREDENTIALS` | `Invalid email or password` |

---

### 6.2.2 `POST /api/auth/register`

| Property | Value |
|---|---|
| Middleware | None (public) |
| Controller | `authController.register` |
| Content-Type | `application/json` |
| Section 5 Reference | Section 5.9.4 — Student Registration Flow |

**Request Body:**

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `token` | `string` | Yes | Valid invite JWT | Invite token from the registration link URL parameter |
| `name` | `string` | Yes | Non-empty, max 255 characters | Student's full name |
| `password` | `string` | Yes | 8–128 characters | Student's chosen password |

**Success Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "accessToken": "<jwt_access_token>",
    "user": {
      "id": 42,
      "email": "student@institution.edu",
      "name": "Jane Smith",
      "role": "student"
    }
  }
}
```

**Cookie Set:** Same `refreshToken` cookie as login (Section 6.2.1).

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Missing required fields | `400` | `VALIDATION_ERROR` | `Token, name, and password are required` |
| JWT signature invalid | `400` | `INVITE_INVALID` | `Invalid invitation token` |
| Token hash not found in `invite_tokens` (invalidated by resend) | `400` | `INVITE_INVALID` | `Invalid invitation token` |
| `invite_tokens.used = 1` | `400` | `INVITE_ALREADY_USED` | `This invitation has already been used` |
| `invite_tokens.expires_at` has passed | `410` | `INVITE_EXPIRED` | `This invitation has expired` |
| Name is empty | `400` | `NAME_REQUIRED` | `Name is required` |
| Password fewer than 8 characters | `400` | `PASSWORD_TOO_SHORT` | `Password must be at least 8 characters` |
| Password exceeds 128 characters | `400` | `PASSWORD_TOO_LONG` | `Password must not exceed 128 characters` |

The `410 Gone` response for expired tokens includes the additional field `canResend: true`:

```json
{
  "success": false,
  "error": "INVITE_EXPIRED",
  "message": "This invitation has expired",
  "canResend": true
}
```

---

### 6.2.3 `POST /api/auth/refresh`

| Property | Value |
|---|---|
| Middleware | None (public — access token may be expired) |
| Controller | `authController.refresh` |
| Content-Type | N/A (no request body) |
| Section 5 Reference | Section 5.9.6 — Token Refresh Flow |

**Request:** No body. The refresh token is read from the `refreshToken` `httpOnly` cookie.

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "accessToken": "<new_jwt_access_token>"
  }
}
```

**Cookie Set:** New `refreshToken` cookie replacing the old one (same attributes as login).

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| `refreshToken` cookie missing | `401` | `REFRESH_TOKEN_REQUIRED` | `Refresh token is required` |
| JWT signature invalid | `401` | `REFRESH_TOKEN_INVALID` | `Invalid refresh token` |
| Token hash not found in `refresh_tokens` | `401` | `REFRESH_TOKEN_INVALID` | `Invalid refresh token` |
| `refresh_tokens.revoked = 1` | `401` | `REFRESH_TOKEN_REVOKED` | `Refresh token has been revoked` |
| `refresh_tokens.expires_at` has passed | `401` | `REFRESH_TOKEN_EXPIRED` | `Refresh token has expired` |
| `users.status` is not `active` | `401` | `ACCOUNT_INACTIVE` | `Account is no longer active` |

---

### 6.2.4 `POST /api/auth/logout`

| Property | Value |
|---|---|
| Middleware | `auth` |
| Controller | `authController.logout` |
| Content-Type | N/A (no request body) |
| Section 5 Reference | Section 5.9.10 — Logout Flow |

**Request:** No body. The refresh token is read from the `refreshToken` `httpOnly` cookie.

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "message": "LOGGED_OUT"
  }
}
```

**Cookie Cleared:** The `refreshToken` cookie is set with `Max-Age=0` to delete it from the client.

**Error Responses:** None beyond the standard `auth` middleware errors (Section 5.6.2). Logout always succeeds even if the refresh token cookie is missing or already revoked — the endpoint is idempotent.

---

### 6.2.5 `GET /api/auth/invite/validate`

| Property | Value |
|---|---|
| Middleware | None (public) |
| Controller | `authController.validateInvite` |
| Content-Type | N/A (GET request) |
| Section 5 Reference | Section 5.9.3 — Invite Validation Flow |

**Query Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `token` | `string` | Yes | Invite token JWT from the registration link URL |

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "valid": true,
    "email": "student@institution.edu",
    "batchYear": 2024
  }
}
```

The `batchYear` field is `null` if no batch year was assigned during invitation.

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| `token` query parameter missing | `400` | `VALIDATION_ERROR` | `Token is required` |
| JWT signature invalid | `400` | `INVITE_INVALID` | `Invalid invitation token` |
| Token hash not found in `invite_tokens` | `400` | `INVITE_INVALID` | `Invalid invitation token` |
| `invite_tokens.used = 1` | `400` | `INVITE_ALREADY_USED` | `This invitation has already been used` |
| `invite_tokens.expires_at` has passed | `410` | `INVITE_EXPIRED` | `This invitation has expired` |

The `410` response includes `canResend: true` (same structure as Section 6.2.2).

---

### 6.2.6 `POST /api/auth/forgot-password`

| Property | Value |
|---|---|
| Middleware | None (public) |
| Controller | `authController.forgotPassword` |
| Content-Type | `application/json` |
| Section 5 Reference | Section 5.9.8 — Forgot Password Flow |

**Request Body:**

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `email` | `string` | Yes | Valid email format | Email address of the account requesting reset |

**Success Response (always, regardless of email existence):** `200 OK`

```json
{
  "success": true,
  "data": {
    "message": "PASSWORD_RESET_EMAIL_SENT"
  }
}
```

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Missing `email` field | `400` | `VALIDATION_ERROR` | `Email is required` |
| Invalid email format | `400` | `VALIDATION_ERROR` | `Invalid email format` |

No error is returned for non-existent emails — the endpoint always returns `200 OK` to prevent user enumeration (Section 5.9.8).

---

### 6.2.7 `POST /api/auth/reset-password`

| Property | Value |
|---|---|
| Middleware | None (public) |
| Controller | `authController.resetPassword` |
| Content-Type | `application/json` |
| Section 5 Reference | Section 5.9.9 — Reset Password Flow |

**Request Body:**

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `token` | `string` | Yes | Non-empty | Raw password reset token (64-char hex string) from the email link |
| `newPassword` | `string` | Yes | 8–128 characters | New password |

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "message": "PASSWORD_RESET_SUCCESSFUL"
  }
}
```

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Missing required fields | `400` | `VALIDATION_ERROR` | `Token and new password are required` |
| Token hash not found in `password_reset_tokens` | `400` | `TOKEN_INVALID` | `Invalid password reset token` |
| `password_reset_tokens.used = 1` | `400` | `TOKEN_USED` | `This reset token has already been used` |
| `password_reset_tokens.expires_at` has passed | `400` | `TOKEN_EXPIRED` | `This reset token has expired` |
| Password fewer than 8 characters | `400` | `PASSWORD_TOO_SHORT` | `Password must be at least 8 characters` |
| Password exceeds 128 characters | `400` | `PASSWORD_TOO_LONG` | `Password must not exceed 128 characters` |

---

### 6.2.8 `PUT /api/auth/password`

| Property | Value |
|---|---|
| Middleware | `auth` |
| Controller | `authController.changePassword` |
| Content-Type | `application/json` |
| Section 5 Reference | Section 5.9.7 — Change Password Flow |

**Request Body:**

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `currentPassword` | `string` | Yes | Non-empty | Current password |
| `newPassword` | `string` | Yes | 8–128 characters | New password |

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "message": "PASSWORD_CHANGED"
  }
}
```

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Missing required fields | `400` | `VALIDATION_ERROR` | `Current password and new password are required` |
| Current password incorrect | `401` | `CURRENT_PASSWORD_INCORRECT` | `Current password is incorrect` |
| New password fewer than 8 characters | `400` | `PASSWORD_TOO_SHORT` | `Password must be at least 8 characters` |
| New password exceeds 128 characters | `400` | `PASSWORD_TOO_LONG` | `Password must not exceed 128 characters` |

---

### 6.2.9 `POST /api/auth/phpmyadmin/verify` (Internal Only)

| Property | Value |
|---|---|
| Middleware | None (not externally accessible — Nginx blocks this path with `deny all; return 403;`; called only from phpMyAdmin `signon.php` within the Docker network via `host.docker.internal:{BACKEND_PORT}`) |
| Controller | `authController.verifyPhpMyAdminSession` |
| Content-Type | `application/json` |

**Request Body:**

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `token` | `string` | Yes | Valid JWT access token | The student's current access token, passed by phpMyAdmin `signon.php` |
| `databaseId` | `integer` | Yes | Valid `databases.id` | The database the student is trying to access |

**Behavior:**

1. Verify the JWT access token. If invalid or expired, return `401`.
2. Extract `userId` from the token claims.
3. Verify `databases.id = databaseId` AND `databases.user_id = userId`. If the student does not own this database, return `403`.
4. Decrypt the database password from `databases.db_password_encrypted` using `DB_ENCRYPTION_KEY`.
5. Return the decrypted credentials.

**Success Response:** `200 OK`

```json
{
  "valid": true,
  "dbUser": "u42_mydb",
  "dbPassword": "decrypted_plain_password",
  "dbHost": "127.0.0.1",
  "dbName": "s42_mydb"
}
```

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Missing `token` or `databaseId` | `400` | `VALIDATION_ERROR` | `Token and databaseId are required` |
| Token is invalid or expired | `401` | `TOKEN_INVALID` | `Invalid or expired token` |
| Database not found or not owned by student | `403` | `ACCESS_DENIED` | `Access denied to this database` |

**Security:** This endpoint is blocked from external access by Nginx. Both the `acadhost.com` and `admin.acadhost.com` server blocks include:

```nginx
location = /api/auth/phpmyadmin/verify {
    deny all;
    return 403;
}
```

This `location` block uses exact match (`=`) for highest priority, checked before `location /api/`. phpMyAdmin's `signon.php` calls the endpoint directly via `host.docker.internal:{BACKEND_PORT}/api/auth/phpmyadmin/verify`, bypassing Nginx entirely.

---

### 6.2.10 Auth Routes Summary

| Method | Path | Middleware | Controller Function | Description |
|---|---|---|---|---|
| `POST` | `/api/auth/login` | None | `authController.login` | User login |
| `POST` | `/api/auth/register` | None | `authController.register` | Student registration via invite link |
| `POST` | `/api/auth/refresh` | None | `authController.refresh` | Token refresh |
| `POST` | `/api/auth/logout` | `auth` | `authController.logout` | Logout (revoke refresh token) |
| `GET` | `/api/auth/invite/validate` | None | `authController.validateInvite` | Validate invite token |
| `POST` | `/api/auth/forgot-password` | None | `authController.forgotPassword` | Request password reset email |
| `POST` | `/api/auth/reset-password` | None | `authController.resetPassword` | Reset password with token |
| `PUT` | `/api/auth/password` | `auth` | `authController.changePassword` | Change password (authenticated) |
| `POST` | `/api/auth/phpmyadmin/verify` | None (internal only) | `authController.verifyPhpMyAdminSession` | phpMyAdmin signon verify (Nginx blocks external access) |

---

## 6.3 Student Routes — `routes/student.js`

All routes in this file require `auth` → `roleGuard('student')` middleware and are handled by `controllers/studentController.js`.

### 6.3.1 `GET /api/student/profile`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('student')` |
| Controller | `studentController.getProfile` |

**Request:** No body or query parameters. User identified from `req.user.id`.

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 42,
    "email": "student@institution.edu",
    "name": "Jane Smith",
    "role": "student",
    "batchYear": 2024,
    "darkMode": false,
    "cpuQuota": 2.00,
    "ramQuotaMb": 1024,
    "storageQuotaMb": 2560,
    "maxProjects": 4,
    "maxDatabases": 4,
    "cpuUsed": 1.00,
    "ramUsedMb": 512,
    "storageUsedMb": 1280,
    "projectCount": 2,
    "databaseCount": 1,
    "storageWarning": false
  }
}
```

**Computed fields (not stored directly in `users` table):**

| Field | Source | Description |
|---|---|---|
| `cpuUsed` | Sum of `projects.cpu_limit` for all non-deleted projects owned by this student | Total CPU cores in use |
| `ramUsedMb` | Sum of `projects.ram_limit_mb` for all non-deleted projects owned by this student | Total RAM in MB in use |
| `storageUsedMb` | Calculated by `storageService.js` — measures source directories and runtime files under `{PROJECTS_BASE_DIR}/{student_id}/` | Total storage in MB in use |
| `projectCount` | Count of `projects` where `user_id = student_id` and `status != 'deleted'` | Active project count |
| `databaseCount` | Count of `databases` where `user_id = student_id` | Database count |
| `storageWarning` | `true` if `storageUsedMb / storageQuotaMb * 100 >= STORAGE_WARNING_THRESHOLD_PERCENT` | Whether storage warning threshold is reached (default 80%) |

---

### 6.3.2 `PUT /api/student/dark-mode`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('student')` |
| Controller | `studentController.toggleDarkMode` |
| Content-Type | `application/json` |

**Request Body:**

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `darkMode` | `boolean` | Yes | `true` or `false` | `true` for dark mode, `false` for light mode |

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "darkMode": true
  }
}
```

The backend updates `users.dark_mode` to `1` (dark) or `0` (light) for the authenticated student.

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Missing or non-boolean `darkMode` field | `400` | `VALIDATION_ERROR` | `darkMode must be a boolean` |

---

### 6.3.3 Student Routes Summary

| Method | Path | Middleware | Controller Function | Description |
|---|---|---|---|---|
| `GET` | `/api/student/profile` | `auth` → `roleGuard('student')` | `studentController.getProfile` | Get student profile with resource usage |
| `PUT` | `/api/student/dark-mode` | `auth` → `roleGuard('student')` | `studentController.toggleDarkMode` | Toggle dark/light mode |

---

## 6.4 Admin Routes — `routes/admin.js`

All routes in this file require `auth` → `roleGuard('admin')` middleware and are handled by `controllers/adminController.js`.

### 6.4.1 `GET /api/admin/metrics`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('admin')` |
| Controller | `adminController.getMetrics` |

**Request:** No body or query parameters.

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "totalLiveProjects": 23,
    "totalStudents": 50,
    "aggregateCpuUsed": 18.50,
    "aggregateRamUsedMb": 12288,
    "aggregateStorageUsedMb": 45000,
    "totalCpuAllocated": 100.00,
    "totalRamAllocatedMb": 51200,
    "totalStorageAllocatedMb": 128000,
    "pendingResourceRequests": 3
  }
}
```

| Field | Source | Description |
|---|---|---|
| `totalLiveProjects` | Count of `projects` where `status = 'running'` | Currently running projects |
| `totalStudents` | Count of `users` where `role = 'student'` and `status = 'active'` | Active student accounts |
| `aggregateCpuUsed` | Sum of `projects.cpu_limit` for all `status = 'running'` projects | CPU cores in use across all students |
| `aggregateRamUsedMb` | Sum of `projects.ram_limit_mb` for all `status = 'running'` projects | RAM in MB in use across all students |
| `aggregateStorageUsedMb` | Sum of storage used by all active students via `storageService.js` | Total disk usage across all students |
| `totalCpuAllocated` | Sum of `users.cpu_quota` for all active students | Total CPU allocated across all students |
| `totalRamAllocatedMb` | Sum of `users.ram_quota_mb` for all active students | Total RAM allocated across all students |
| `totalStorageAllocatedMb` | Sum of `users.storage_quota_mb` for all active students | Total storage allocated across all students |
| `pendingResourceRequests` | Count of `resource_requests` where `status = 'pending'` | Pending resource requests awaiting admin review |

---

### 6.4.2 `GET /api/admin/students`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('admin')` |
| Controller | `adminController.listStudents` |
| Pagination | Yes (Section 6.1.2) |

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `page` | `integer` | No | `1` | Page number |
| `limit` | `integer` | No | `20` | Items per page (max 100) |
| `status` | `string` | No | All statuses | Filter by `invited`, `active`, or `removed` |
| `batchYear` | `integer` | No | All years | Filter by enrollment year |
| `search` | `string` | No | None | Search by name or email (partial match) |

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 42,
        "email": "student@institution.edu",
        "name": "Jane Smith",
        "role": "student",
        "batchYear": 2024,
        "status": "active",
        "cpuQuota": 2.00,
        "ramQuotaMb": 1024,
        "storageQuotaMb": 2560,
        "maxProjects": 4,
        "maxDatabases": 4,
        "cpuUsed": 1.00,
        "ramUsedMb": 512,
        "projectCount": 2,
        "databaseCount": 1,
        "createdAt": "2024-01-15T10:00:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalItems": 50,
      "totalPages": 3
    }
  }
}
```

---

### 6.4.3 `PUT /api/admin/students/:id/quota`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('admin')` |
| Controller | `adminController.updateStudentQuota` |
| Content-Type | `application/json` |

**Path Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `id` | `integer` | `users.id` of the student |

**Request Body:**

All fields are optional. Only provided fields are updated. At least one field must be present.

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `cpuQuota` | `number` | No | Positive, max 2 decimal places | New CPU cores quota |
| `ramQuotaMb` | `integer` | No | Positive integer | New RAM quota in MB |
| `storageQuotaMb` | `integer` | No | Positive integer | New storage quota in MB |
| `maxProjects` | `integer` | No | Positive integer | New max projects limit |
| `maxDatabases` | `integer` | No | Positive integer | New max databases limit |

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 42,
    "email": "student@institution.edu",
    "cpuQuota": 4.00,
    "ramQuotaMb": 2048,
    "storageQuotaMb": 5120,
    "maxProjects": 6,
    "maxDatabases": 6
  }
}
```

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Student not found or not a student role | `404` | `STUDENT_NOT_FOUND` | `Student not found` |
| No quota fields provided | `400` | `VALIDATION_ERROR` | `At least one quota field is required` |
| Quota value is not positive | `400` | `VALIDATION_ERROR` | `Quota values must be positive` |
| New `maxProjects` is less than student's current active project count | `400` | `QUOTA_BELOW_USAGE` | `Cannot set max projects below current usage ({current} active projects)` |
| New `maxDatabases` is less than student's current database count | `400` | `QUOTA_BELOW_USAGE` | `Cannot set max databases below current usage ({current} databases)` |
| New `cpuQuota` is less than student's current CPU usage | `400` | `QUOTA_BELOW_USAGE` | `Cannot set CPU quota below current usage ({current} cores in use)` |
| New `ramQuotaMb` is less than student's current RAM usage | `400` | `QUOTA_BELOW_USAGE` | `Cannot set RAM quota below current usage ({current} MB in use)` |

---

### 6.4.4 `DELETE /api/admin/students/:id`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('admin')` |
| Controller | `adminController.removeStudent` |

**Path Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `id` | `integer` | `users.id` of the student |

**Pre-delete cleanup sequence** (Section 4.4 critical implementation note):

1. Stop and remove all running Docker containers for the student's projects via `dockerService.js`.
2. Remove all Nginx subdomain-to-port mappings for the student's projects and reload Nginx via `nginxService.js`.
3. Drop all MySQL schemas and restricted users for the student's databases via `databaseProvisioningService.js`.
4. Delete all project source directories under `{PROJECTS_BASE_DIR}/{student_id}/` via `storageService.js`.
5. Delete the `users` row (cascades to `projects`, `databases`, `resource_requests`, `refresh_tokens`, `password_reset_tokens`, `builds`).

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "message": "STUDENT_REMOVED",
    "studentId": 42,
    "email": "student@institution.edu"
  }
}
```

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Student not found or not a student role | `404` | `STUDENT_NOT_FOUND` | `Student not found` |
| Attempting to delete the admin account | `400` | `CANNOT_DELETE_ADMIN` | `Cannot delete the admin account` |

---

### 6.4.5 `POST /api/admin/students/batch-remove`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('admin')` |
| Controller | `adminController.batchRemoveStudents` |
| Content-Type | `application/json` |

**Request Body:**

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `batchYear` | `integer` | Yes | Valid year (e.g., `2022`) | Enrollment year of the batch to remove |

**Behavior:** Finds all `users` where `role = 'student'` and `batch_year = batchYear` and `status != 'removed'`. For each student, performs the same pre-delete cleanup sequence as `DELETE /api/admin/students/:id` (Section 6.4.4). Each student row is deleted after cleanup. Processing is synchronous. If any individual student cleanup fails, that student's ID is recorded in the `failed` array but processing continues for remaining students.

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "message": "BATCH_REMOVED",
    "batchYear": 2022,
    "studentsRemoved": 35,
    "projectsRemoved": 87,
    "databasesRemoved": 42,
    "failed": []
  }
}
```

The `failed` array contains student IDs for which cleanup encountered errors. An empty array indicates all students were successfully removed.

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Missing `batchYear` field | `400` | `VALIDATION_ERROR` | `Batch year is required` |
| `batchYear` is not a valid integer | `400` | `VALIDATION_ERROR` | `Batch year must be a valid integer` |
| No students found for the given batch year | `404` | `NO_STUDENTS_FOUND` | `No students found for batch year {batchYear}` |

---

### 6.4.6 `POST /api/admin/students/invite`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('admin')` |
| Controller | `adminController.inviteStudents` |
| Content-Type | `multipart/form-data` |
| Section 5 Reference | Section 5.9.1 — Student Invitation Flow |
| File Upload | Multer memory storage (Section 6.12) |

**Request Body (multipart):**

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `emails` | `string` | Conditional | Comma-separated valid email addresses | Email addresses entered in text field; at least one of `emails` or `file` must be provided |
| `file` | `file` | Conditional | `.xlsx` or `.xls` file | Excel file containing email addresses; at least one of `emails` or `file` must be provided |
| `batchYear` | `integer` | No | Valid year (e.g., `2024`) | Batch year label assigned to all invited students |

**Excel file format:** The backend reads all non-empty cells in the first column of the first sheet. Each cell value is treated as an email address. Headers are auto-detected and skipped if the first cell does not appear to be a valid email format.

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "invited": [
      "student1@institution.edu",
      "student2@institution.edu"
    ],
    "skipped": [
      {
        "email": "existing@institution.edu",
        "reason": "Email already exists in the system"
      }
    ],
    "invalid": [
      {
        "email": "not-an-email",
        "reason": "Invalid email format"
      }
    ],
    "totalInvited": 2,
    "totalSkipped": 1,
    "totalInvalid": 1
  }
}
```

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Neither `emails` nor `file` provided | `400` | `VALIDATION_ERROR` | `Either emails or an Excel file must be provided` |
| File is not a valid Excel format | `400` | `INVALID_FILE_FORMAT` | `File must be an Excel file (.xlsx or .xls)` |
| No valid emails found after processing | `400` | `NO_VALID_EMAILS` | `No valid email addresses found in the provided input` |

---

### 6.4.7 `POST /api/admin/students/:id/resend-invite`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('admin')` |
| Controller | `adminController.resendInvite` |
| Section 5 Reference | Section 5.9.2 — Invite Resend Flow |

**Path Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `id` | `integer` | `users.id` of the student |

**Request Body:** None.

**Behavior:** The student must have `status = 'invited'`. All existing unused invite tokens for the student's email are deleted (invalidated). A new invite token is generated and sent via email.

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "message": "INVITE_RESENT",
    "email": "student@institution.edu"
  }
}
```

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Student not found | `404` | `STUDENT_NOT_FOUND` | `Student not found` |
| Student `status` is not `invited` | `400` | `ALREADY_REGISTERED` | `Student has already completed registration` |

---

### 6.4.8 `GET /api/admin/projects`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('admin')` |
| Controller | `adminController.listProjects` |
| Pagination | Yes (Section 6.1.2) |

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `page` | `integer` | No | `1` | Page number |
| `limit` | `integer` | No | `20` | Items per page (max 100) |
| `status` | `string` | No | All non-deleted | Filter by `building`, `running`, `stopped`, `failed`, `deleted` |
| `studentId` | `integer` | No | All students | Filter by owning student `users.id` |
| `search` | `string` | No | None | Search by project title or subdomain (partial match) |

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 15,
        "title": "My Portfolio",
        "subdomain": "jane-portfolio",
        "liveUrl": "https://jane-portfolio.acadhost.com",
        "projectType": "frontend",
        "runtime": null,
        "runtimeVersion": null,
        "sourceType": "git",
        "status": "running",
        "cpuLimit": 0.50,
        "ramLimitMb": 256,
        "containerPort": 10005,
        "student": {
          "id": 42,
          "email": "student@institution.edu",
          "name": "Jane Smith"
        },
        "createdAt": "2024-02-10T14:30:00Z",
        "updatedAt": "2024-02-10T14:35:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalItems": 23,
      "totalPages": 2
    }
  }
}
```

The `liveUrl` field is constructed as `https://{subdomain}.{PLATFORM_DOMAIN}`.

---

### 6.4.9 `POST /api/admin/projects/:id/stop`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('admin')` |
| Controller | `adminController.stopProject` |

**Path Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `id` | `integer` | `projects.id` |

**Behavior:**

1. Stop the project's Docker container via `dockerService.js`.
2. Update `projects.status` to `stopped`.
3. Send an automated email notification to the owning student via `emailService.js` informing them that the admin has stopped their project.

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "message": "PROJECT_STOPPED",
    "projectId": 15,
    "title": "My Portfolio",
    "notifiedStudent": "student@institution.edu"
  }
}
```

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Project not found | `404` | `PROJECT_NOT_FOUND` | `Project not found` |
| Project is already stopped | `400` | `PROJECT_ALREADY_STOPPED` | `Project is already stopped` |
| Project status is `deleted` | `400` | `PROJECT_DELETED` | `Cannot stop a deleted project` |
| Project status is `building` | `400` | `PROJECT_BUILDING` | `Cannot stop a project that is currently building` |

---

### 6.4.10 `POST /api/admin/projects/:id/terminate`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('admin')` |
| Controller | `adminController.terminateProject` |

**Path Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `id` | `integer` | `projects.id` |

**Behavior:**

1. Stop and remove the project's Docker container via `dockerService.js` (if running).
2. Remove the old Docker image for this project via `dockerService.js`.
3. Remove the Nginx subdomain-to-port mapping for this project and reload Nginx via `nginxService.js`.
4. Delete the project source directory under `{PROJECTS_BASE_DIR}/{student_id}/{project_id}/` via `storageService.js`.
5. Set `projects.container_id = NULL`, `projects.container_port = NULL`, `projects.subdomain = '_deleted_{project_id}'`, `projects.status = 'deleted'`.
6. Send an automated email notification to the owning student via `emailService.js` informing them that the admin has terminated their project.

This is a soft-delete: the project metadata row is retained in the `projects` table with `status = 'deleted'` for audit purposes. The subdomain is replaced with `_deleted_{project_id}` (e.g., `_deleted_15`) to free the original subdomain for reclamation by other students. The `_deleted_` prefix starts with an underscore, which is invalid for student-submitted subdomains (validated as lowercase alphanumeric and hyphens only), so it can never collide with a real subdomain.

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "message": "PROJECT_TERMINATED",
    "projectId": 15,
    "title": "My Portfolio",
    "notifiedStudent": "student@institution.edu"
  }
}
```

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Project not found | `404` | `PROJECT_NOT_FOUND` | `Project not found` |
| Project already has `status = 'deleted'` | `400` | `PROJECT_ALREADY_DELETED` | `Project has already been terminated` |

---

### 6.4.11 Admin Routes Summary

| Method | Path | Middleware | Controller Function | Description |
|---|---|---|---|---|
| `GET` | `/api/admin/metrics` | `auth` → `roleGuard('admin')` | `adminController.getMetrics` | System-wide metrics |
| `GET` | `/api/admin/students` | `auth` → `roleGuard('admin')` | `adminController.listStudents` | List all students (paginated) |
| `PUT` | `/api/admin/students/:id/quota` | `auth` → `roleGuard('admin')` | `adminController.updateStudentQuota` | Adjust student quotas |
| `DELETE` | `/api/admin/students/:id` | `auth` → `roleGuard('admin')` | `adminController.removeStudent` | Remove individual student |
| `POST` | `/api/admin/students/batch-remove` | `auth` → `roleGuard('admin')` | `adminController.batchRemoveStudents` | Batch remove by enrollment year |
| `POST` | `/api/admin/students/invite` | `auth` → `roleGuard('admin')` | `adminController.inviteStudents` | Invite students (email list or Excel) |
| `POST` | `/api/admin/students/:id/resend-invite` | `auth` → `roleGuard('admin')` | `adminController.resendInvite` | Resend invitation to a student |
| `GET` | `/api/admin/projects` | `auth` → `roleGuard('admin')` | `adminController.listProjects` | List all projects (paginated) |
| `POST` | `/api/admin/projects/:id/stop` | `auth` → `roleGuard('admin')` | `adminController.stopProject` | Stop a project (email notification) |
| `POST` | `/api/admin/projects/:id/terminate` | `auth` → `roleGuard('admin')` | `adminController.terminateProject` | Terminate/delete a project (email notification) |

---

## 6.5 Project Routes — `routes/projects.js`

All routes in this file require `auth` → `roleGuard('student')` middleware and are handled by `controllers/projectController.js`. All project operations are scoped to the authenticated student — a student can only access their own projects. The backend verifies `projects.user_id = req.user.id` on every request that references a project `:id`.

### 6.5.1 `POST /api/projects`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('student')` |
| Controller | `projectController.createProject` |
| Content-Type | `multipart/form-data` |
| File Upload | Multer disk storage (Section 6.12) |

**Request Body (multipart):**

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `title` | `string` | Yes | Non-empty, max 255 characters | Project display title |
| `subdomain` | `string` | Yes | Lowercase alphanumeric and hyphens, 3–63 characters, not reserved, unique among all non-deleted projects | Subdomain under `*.acadhost.com` |
| `projectType` | `string` | Yes | One of `frontend`, `backend`, `combined` | Project type |
| `runtime` | `string` | Conditional | One of `node`, `python` | Required for `backend` and `combined` types; ignored for `frontend` |
| `runtimeVersion` | `string` | No | Node.js: `18`, `20`, `22`, `23`; Python: `3.10`, `3.11`, `3.12`, `3.13` | Runtime version; defaults to `20` for Node.js, `3.11` for Python |
| `sourceType` | `string` | Yes | One of `git`, `zip` | Source upload method |
| `gitUrl` | `string` | Conditional | Valid URL | Git repository URL; required when `sourceType = 'git'`; for `combined` projects, this is the frontend repo URL |
| `gitUrlBackend` | `string` | Conditional | Valid URL | Backend Git repo URL; required when `sourceType = 'git'` and `projectType = 'combined'` |
| `zipFile` | `file` | Conditional | Max 200 MB | ZIP file; required when `sourceType = 'zip'` and `projectType` is `frontend` or `backend` |
| `zipFileFrontend` | `file` | Conditional | Max 200 MB each | Frontend ZIP file; required when `sourceType = 'zip'` and `projectType = 'combined'` |
| `zipFileBackend` | `file` | Conditional | Max 200 MB each | Backend ZIP file; required when `sourceType = 'zip'` and `projectType = 'combined'` |
| `cpuLimit` | `number` | No | Positive, max 2 decimal places | CPU limit for the container; default: `1.00` |
| `ramLimitMb` | `integer` | No | Positive integer | RAM limit in MB for the container; default: `512` |
| `databaseId` | `integer` | No | Valid `databases.id` owned by this student | Database to attach; `NULL` if no database is selected |

**Validation sequence:**

| Step | Check | Error Code | HTTP Status |
|---|---|---|---|
| 1 | Student `status = 'active'` | `ACCOUNT_INACTIVE` | `403` |
| 2 | Student has not reached `max_projects` quota (count non-deleted projects) | `PROJECT_QUOTA_EXCEEDED` | `400` |
| 3 | Subdomain is not reserved (Section 1.11) | `SUBDOMAIN_RESERVED` | `400` |
| 4 | Subdomain is not already taken (unique check against all `projects.subdomain` where `status != 'deleted'`) | `SUBDOMAIN_TAKEN` | `409` |
| 5 | Subdomain format is valid (lowercase alphanumeric and hyphens, 3–63 chars, no leading/trailing hyphens) | `SUBDOMAIN_INVALID` | `400` |
| 6 | CPU limit does not exceed student's remaining CPU quota | `CPU_QUOTA_EXCEEDED` | `400` |
| 7 | RAM limit does not exceed student's remaining RAM quota | `RAM_QUOTA_EXCEEDED` | `400` |
| 8 | If `sourceType = 'zip'`, each ZIP file is under 200 MB (enforced before extraction) | `ZIP_TOO_LARGE` | `400` |
| 9 | If `databaseId` is provided, it must belong to the authenticated student | `DATABASE_NOT_FOUND` | `404` |
| 10 | If `projectType = 'combined'`, `sourceType` must apply to both sources (no mixing Git + ZIP) | `SOURCE_TYPE_MISMATCH` | `400` |
| 11 | Build concurrency check: current active builds < `MAX_CONCURRENT_BUILDS` | `BUILD_QUEUE_FULL` | `429` |

**Behavior upon successful validation:**

1. Allocate a port from the container port pool (10,000 – 20,000) via `portAllocator.js`.
2. Create a `projects` row with `status = 'building'`.
3. Create the project directory structure under `{PROJECTS_BASE_DIR}/{student_id}/{project_id}/`.
4. If `sourceType = 'git'`: clone the repository(ies) into `source/frontend/` and/or `source/backend/`.
5. If `sourceType = 'zip'`: extract the ZIP file(s) into `source/frontend/` and/or `source/backend/` via `zipHandler.js`.
6. If `sourceType = 'git'` and `projectType != 'frontend'`: auto-detect runtime from source files (`package.json` → Node.js, `requirements.txt` → Python). If `runtime` was provided in the request, validate it matches the detected runtime.
7. Select and customize the appropriate Dockerfile template from `backend/templates/`.
8. Start the build asynchronously via `buildService.js`. The endpoint returns immediately.
9. If `sourceType = 'git'`: generate a webhook secret (or two for combined projects), store in `projects.webhook_secret` (and `projects.webhook_secret_backend`).

**Success Response:** `202 Accepted`

```json
{
  "success": true,
  "data": {
    "projectId": 15,
    "title": "My Portfolio",
    "subdomain": "jane-portfolio",
    "status": "building",
    "buildStreamUrl": "/api/projects/15/build-logs/stream"
  }
}
```

The `202 Accepted` status indicates the build has started asynchronously. The client should connect to the SSE endpoint at `buildStreamUrl` to receive real-time build logs.

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Missing required fields | `400` | `VALIDATION_ERROR` | `{field} is required` |
| Invalid project type | `400` | `VALIDATION_ERROR` | `Project type must be frontend, backend, or combined` |
| Invalid source type | `400` | `VALIDATION_ERROR` | `Source type must be git or zip` |
| Invalid runtime | `400` | `VALIDATION_ERROR` | `Runtime must be node or python` |
| Invalid runtime version | `400` | `VALIDATION_ERROR` | `Invalid runtime version for {runtime}` |
| Project quota exceeded | `400` | `PROJECT_QUOTA_EXCEEDED` | `Project limit reached ({current}/{max})` |
| Subdomain reserved | `400` | `SUBDOMAIN_RESERVED` | `Subdomain '{subdomain}' is reserved` |
| Subdomain taken | `409` | `SUBDOMAIN_TAKEN` | `Subdomain '{subdomain}' is already in use` |
| Subdomain invalid format | `400` | `SUBDOMAIN_INVALID` | `Subdomain must be 3-63 characters, lowercase alphanumeric and hyphens` |
| CPU quota exceeded | `400` | `CPU_QUOTA_EXCEEDED` | `CPU limit exceeds available quota ({available} cores remaining)` |
| RAM quota exceeded | `400` | `RAM_QUOTA_EXCEEDED` | `RAM limit exceeds available quota ({available} MB remaining)` |
| ZIP file too large | `400` | `ZIP_TOO_LARGE` | `ZIP file exceeds maximum size of {MAX_ZIP_UPLOAD_SIZE_MB} MB` |
| Database not found or not owned by student | `404` | `DATABASE_NOT_FOUND` | `Database not found` |
| Source type mismatch for combined projects | `400` | `SOURCE_TYPE_MISMATCH` | `Combined projects require both sources to use the same source type` |
| Build queue full | `429` | `BUILD_QUEUE_FULL` | `Build queue is full. Try again later.` |

---

### 6.5.2 `GET /api/projects`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('student')` |
| Controller | `projectController.listProjects` |

**Request:** No body. Scoped to `req.user.id`.

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 15,
        "title": "My Portfolio",
        "subdomain": "jane-portfolio",
        "liveUrl": "https://jane-portfolio.acadhost.com",
        "projectType": "frontend",
        "runtime": null,
        "runtimeVersion": null,
        "sourceType": "git",
        "gitUrl": "https://github.com/jane/portfolio.git",
        "status": "running",
        "cpuLimit": 0.50,
        "ramLimitMb": 256,
        "databaseId": null,
        "createdAt": "2024-02-10T14:30:00Z",
        "updatedAt": "2024-02-10T14:35:00Z"
      }
    ]
  }
}
```

This endpoint returns all projects for the student where `status != 'deleted'`. No pagination — a student has a maximum of `max_projects` (default 4) active projects, so the result set is always small.

---

### 6.5.3 `GET /api/projects/:id`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('student')` |
| Controller | `projectController.getProject` |

**Path Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `id` | `integer` | `projects.id` |

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 15,
    "title": "My Portfolio",
    "subdomain": "jane-portfolio",
    "liveUrl": "https://jane-portfolio.acadhost.com",
    "projectType": "frontend",
    "runtime": null,
    "runtimeVersion": null,
    "sourceType": "git",
    "gitUrl": "https://github.com/jane/portfolio.git",
    "gitUrlBackend": null,
    "webhookSecret": "whsec_abc123...",
    "webhookSecretBackend": null,
    "status": "running",
    "cpuLimit": 0.50,
    "ramLimitMb": 256,
    "containerPort": 10005,
    "databaseId": 3,
    "databaseName": "s42_mydb",
    "createdAt": "2024-02-10T14:30:00Z",
    "updatedAt": "2024-02-10T14:35:00Z"
  }
}
```

The `webhookSecret` and `webhookSecretBackend` fields are included so the student can configure GitHub webhooks. `databaseName` is a convenience field resolved from the attached `databases.db_name` if `databaseId` is non-null.

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Project not found or not owned by student | `404` | `PROJECT_NOT_FOUND` | `Project not found` |

---

### 6.5.4 `PUT /api/projects/:id/database`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('student')` |
| Controller | `projectController.switchDatabase` |
| Content-Type | `application/json` |

**Path Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `id` | `integer` | `projects.id` |

**Request Body:**

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `databaseId` | `integer` or `null` | Yes | Valid `databases.id` owned by this student, or `null` to detach | Database to attach to this project |

**Behavior:**

1. Update `projects.database_id` to the new value.
2. If the project container is running:
   a. Decrypt the new database's password from `databases.db_password_encrypted` using `DB_ENCRYPTION_KEY`.
   b. Recreate the container with the new database credentials injected as `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` environment variables (Section 2.9).
   c. If `databaseId` is `null`, recreate the container without any `DB_*` environment variables.

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "projectId": 15,
    "databaseId": 5,
    "databaseName": "s42_newdb",
    "message": "DATABASE_SWITCHED"
  }
}
```

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Project not found or not owned by student | `404` | `PROJECT_NOT_FOUND` | `Project not found` |
| Project status is `deleted` | `400` | `PROJECT_DELETED` | `Cannot modify a deleted project` |
| Database not found or not owned by student | `404` | `DATABASE_NOT_FOUND` | `Database not found` |

---

### 6.5.5 `PUT /api/projects/:id/resources`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('student')` |
| Controller | `projectController.updateResources` |
| Content-Type | `application/json` |

**Path Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `id` | `integer` | `projects.id` |

**Request Body:**

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `cpuLimit` | `number` | No | Positive, max 2 decimal places | New CPU limit for the container |
| `ramLimitMb` | `integer` | No | Positive integer | New RAM limit in MB for the container |

At least one field must be present.

**Behavior:**

1. Validate the new limits do not exceed the student's remaining quota (accounting for resources freed by reducing this project's current allocation).
2. Update `projects.cpu_limit` and/or `projects.ram_limit_mb`.
3. If the container is running, apply the new resource limits via `docker update --cpus --memory`. If `docker update` fails, fall back to stop/remove/recreate the container with the new limits.

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "projectId": 15,
    "cpuLimit": 1.50,
    "ramLimitMb": 768,
    "message": "RESOURCES_UPDATED"
  }
}
```

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Project not found or not owned by student | `404` | `PROJECT_NOT_FOUND` | `Project not found` |
| Project status is `deleted` | `400` | `PROJECT_DELETED` | `Cannot modify a deleted project` |
| No resource fields provided | `400` | `VALIDATION_ERROR` | `At least one resource field is required` |
| CPU exceeds remaining quota | `400` | `CPU_QUOTA_EXCEEDED` | `CPU limit exceeds available quota ({available} cores remaining)` |
| RAM exceeds remaining quota | `400` | `RAM_QUOTA_EXCEEDED` | `RAM limit exceeds available quota ({available} MB remaining)` |

---

### 6.5.6 `GET /api/projects/:id/logs`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('student')` |
| Controller | `projectController.getLogs` |

**Path Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `id` | `integer` | `projects.id` |

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `tail` | `integer` | No | `100` | Number of most recent log lines to return |

**Behavior:** Executes `docker logs --tail {tail} {container_id}` via `dockerService.js` to retrieve the latest runtime logs. Runtime log retention is ephemeral — logs exist only for the lifetime of the current container.

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "projectId": 15,
    "logs": "Server started on port 3000\nConnected to database\n..."
  }
}
```

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Project not found or not owned by student | `404` | `PROJECT_NOT_FOUND` | `Project not found` |
| Project has no running container (`container_id` is `NULL`) | `400` | `CONTAINER_NOT_RUNNING` | `No running container for this project` |

---

### 6.5.7 `GET /api/projects/:id/build-logs/stream`

| Property | Value |
|---|---|
| Middleware | `auth` (token via query parameter — see Section 6.1.3) → `roleGuard('student')` |
| Controller | `projectController.streamBuildLogs` |
| Content-Type (response) | `text/event-stream` (Server-Sent Events) |

**Path Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `id` | `integer` | `projects.id` |

**Query Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `token` | `string` | Yes | JWT access token (required because `EventSource` does not support custom `Authorization` headers) |

**SSE Response Headers:**

| Header | Value | Purpose |
|---|---|---|
| `Content-Type` | `text/event-stream` | Identifies the response as an SSE stream |
| `Cache-Control` | `no-cache` | Prevents caching of the stream |
| `Connection` | `keep-alive` | Keeps the HTTP connection open |
| `X-Accel-Buffering` | `no` | Disables Nginx response buffering (critical — without this, Nginx buffers SSE events and the client receives them in batches instead of in real time) |

**SSE Event Types:**

| SSE Event Type | `data` Payload | When Emitted | Client Action |
|---|---|---|---|
| `log` | Plain text string (single log line; application-level output only — no internal Docker or system messages) | For each line of build output | Append to log display |
| `status` | One of: `building`, `success`, `failed`, `timeout` | When the build status changes | Update status indicator |
| `complete` | JSON string: `{"status":"success"}` or `{"status":"failed","message":"..."}` or `{"status":"timeout","message":"Build exceeded time limit"}` | When the build finishes | Close the `EventSource` connection; redirect to dashboard on success or show error UI on failure |

**SSE Wire Format:**

Each event is written to the response stream as:

```
event: <event_type>\n
data: <payload>\n
\n
```

**Example SSE stream:**

```
event: log
data: Step 1/8 : FROM node:20-alpine

event: log
data: Step 2/8 : WORKDIR /app

event: log
data: npm install completed successfully

event: status
data: success

event: complete
data: {"status":"success"}
```

**Server-side implementation pattern:**

```javascript
// Set SSE headers
res.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no'
});

// Write a single SSE event
function sendEvent(res, eventType, data) {
  res.write(`event: ${eventType}\n`);
  res.write(`data: ${data}\n`);
  res.write('\n');
}

// Example usage during build
sendEvent(res, 'log', 'Step 1/8 : FROM node:20-alpine');
sendEvent(res, 'status', 'building');
// ... build progresses ...
sendEvent(res, 'complete', JSON.stringify({ status: 'success' }));
res.end();
```

**Client-side consumption pattern (for Section 13 frontend reference):**

```javascript
const eventSource = new EventSource(
  `/api/projects/${projectId}/build-logs/stream?token=${accessToken}`
);

eventSource.addEventListener('log', (e) => {
  appendToLogDisplay(e.data);
});

eventSource.addEventListener('status', (e) => {
  updateStatusIndicator(e.data);
});

eventSource.addEventListener('complete', (e) => {
  const result = JSON.parse(e.data);
  eventSource.close();
  if (result.status === 'success') {
    redirectToDashboard();
  } else {
    showErrorUI(result.message);
  }
});
```

**Behavior when project is not currently building:** If the project is not currently building, the endpoint returns the latest stored build log content as a series of `log` events followed by a `complete` event with the build's final status, then closes the connection.

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Project not found or not owned by student | `404` | `PROJECT_NOT_FOUND` | `Project not found` |

---

### 6.5.8 `GET /api/projects/:id/build-logs`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('student')` |
| Controller | `projectController.getBuildLogs` |

**Path Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `id` | `integer` | `projects.id` |

**Behavior:** Returns the content of the most recent build log file for this project. Reads the latest `builds` row for this `project_id` and returns the content of the file at `builds.log_file_path`.

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "projectId": 15,
    "buildId": 38,
    "status": "success",
    "startedAt": "2024-02-10T14:30:00Z",
    "completedAt": "2024-02-10T14:32:15Z",
    "logs": "Step 1/8 : FROM node:20-alpine\n..."
  }
}
```

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Project not found or not owned by student | `404` | `PROJECT_NOT_FOUND` | `Project not found` |
| No builds exist for this project | `404` | `NO_BUILDS_FOUND` | `No build history found for this project` |
| Build log file not found on disk (expired past 7-day retention) | `404` | `BUILD_LOG_EXPIRED` | `Build log has expired and been removed` |

---

### 6.5.9 `GET /api/projects/:id/storage`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('student')` |
| Controller | `projectController.getStorageUsage` |

**Path Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `id` | `integer` | `projects.id` |

**Behavior:** Calculates the disk usage of the project directory `{PROJECTS_BASE_DIR}/{student_id}/{project_id}/` using `storageService.js`.

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "projectId": 15,
    "storageUsedMb": 45.6,
    "breakdown": {
      "sourceMb": 32.1,
      "buildLogsMb": 2.5,
      "uploadsMb": 0.0,
      "otherMb": 11.0
    }
  }
}
```

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Project not found or not owned by student | `404` | `PROJECT_NOT_FOUND` | `Project not found` |

---

### 6.5.10 `POST /api/projects/:id/restart`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('student')` |
| Controller | `projectController.restartProject` |

**Path Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `id` | `integer` | `projects.id` |

**Request Body:** None.

**Behavior:**

1. Restart the project's Docker container via `dockerService.js` (`docker restart`).
2. Update `projects.status` to `running`.

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "projectId": 15,
    "status": "running",
    "message": "PROJECT_RESTARTED"
  }
}
```

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Project not found or not owned by student | `404` | `PROJECT_NOT_FOUND` | `Project not found` |
| Project status is `deleted` | `400` | `PROJECT_DELETED` | `Cannot restart a deleted project` |
| Project status is `building` | `400` | `PROJECT_BUILDING` | `Cannot restart a project that is currently building` |
| Project has no container (`container_id` is `NULL`) | `400` | `CONTAINER_NOT_FOUND` | `No container exists for this project` |

---

### 6.5.11 `POST /api/projects/:id/stop`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('student')` |
| Controller | `projectController.stopProject` |

**Path Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `id` | `integer` | `projects.id` |

**Request Body:** None.

**Behavior:**

1. Stop the project's Docker container via `dockerService.js` (`docker stop`).
2. Update `projects.status` to `stopped`.

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "projectId": 15,
    "status": "stopped",
    "message": "PROJECT_STOPPED"
  }
}
```

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Project not found or not owned by student | `404` | `PROJECT_NOT_FOUND` | `Project not found` |
| Project already stopped | `400` | `PROJECT_ALREADY_STOPPED` | `Project is already stopped` |
| Project status is `deleted` | `400` | `PROJECT_DELETED` | `Cannot stop a deleted project` |
| Project status is `building` | `400` | `PROJECT_BUILDING` | `Cannot stop a project that is currently building` |

---

### 6.5.12 `DELETE /api/projects/:id`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('student')` |
| Controller | `projectController.deleteProject` |

**Path Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `id` | `integer` | `projects.id` |

**Request Body:** None.

**Behavior (same cleanup sequence as admin terminate, Section 6.4.10):**

1. Stop and remove the project's Docker container via `dockerService.js` (if running).
2. Remove the old Docker image for this project via `dockerService.js`.
3. Remove the Nginx subdomain-to-port mapping for this project and reload Nginx via `nginxService.js`.
4. Delete the project source directory under `{PROJECTS_BASE_DIR}/{student_id}/{project_id}/` via `storageService.js`.
5. Set `projects.container_id = NULL`, `projects.container_port = NULL`, `projects.subdomain = '_deleted_{project_id}'`, `projects.status = 'deleted'`.

This is a soft-delete. The project metadata row persists with `status = 'deleted'`. The subdomain is replaced with `_deleted_{project_id}` (e.g., `_deleted_15`) to free the original subdomain for reclamation. The `_deleted_` prefix starts with an underscore, which is invalid for student-submitted subdomains (alphanumeric and hyphens only), so it can never collide with a real subdomain.

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "projectId": 15,
    "message": "PROJECT_DELETED"
  }
}
```

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Project not found or not owned by student | `404` | `PROJECT_NOT_FOUND` | `Project not found` |
| Project already has `status = 'deleted'` | `400` | `PROJECT_ALREADY_DELETED` | `Project has already been deleted` |

---

### 6.5.13 Project Routes Summary

| Method | Path | Middleware | Controller Function | Description |
|---|---|---|---|---|
| `POST` | `/api/projects` | `auth` → `roleGuard('student')` | `projectController.createProject` | Create project and start build |
| `GET` | `/api/projects` | `auth` → `roleGuard('student')` | `projectController.listProjects` | List student's projects |
| `GET` | `/api/projects/:id` | `auth` → `roleGuard('student')` | `projectController.getProject` | Get project details |
| `PUT` | `/api/projects/:id/database` | `auth` → `roleGuard('student')` | `projectController.switchDatabase` | Switch attached database |
| `PUT` | `/api/projects/:id/resources` | `auth` → `roleGuard('student')` | `projectController.updateResources` | Adjust CPU/RAM limits |
| `GET` | `/api/projects/:id/logs` | `auth` → `roleGuard('student')` | `projectController.getLogs` | Get runtime logs |
| `GET` | `/api/projects/:id/build-logs/stream` | `auth` (query param) → `roleGuard('student')` | `projectController.streamBuildLogs` | SSE stream of build logs |
| `GET` | `/api/projects/:id/build-logs` | `auth` → `roleGuard('student')` | `projectController.getBuildLogs` | Get latest build log |
| `GET` | `/api/projects/:id/storage` | `auth` → `roleGuard('student')` | `projectController.getStorageUsage` | Get project storage usage |
| `POST` | `/api/projects/:id/restart` | `auth` → `roleGuard('student')` | `projectController.restartProject` | Restart project container |
| `POST` | `/api/projects/:id/stop` | `auth` → `roleGuard('student')` | `projectController.stopProject` | Stop project container |
| `DELETE` | `/api/projects/:id` | `auth` → `roleGuard('student')` | `projectController.deleteProject` | Delete project (soft-delete) |

---

## 6.6 Database Routes — `routes/databases.js`

All routes in this file require `auth` → `roleGuard('student')` middleware and are handled by `controllers/databaseController.js`. All database operations are scoped to the authenticated student.

### 6.6.1 `POST /api/databases`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('student')` |
| Controller | `databaseController.createDatabase` |
| Content-Type | `application/json` |

**Request Body:**

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `dbName` | `string` | Yes | Alphanumeric and underscores, 1–64 characters, must not duplicate any of this student's existing databases | Desired database name |

**Behavior:**

1. Validate the student has not reached `max_databases` quota.
2. Validate `dbName` does not duplicate any of this student's existing databases (checked via `uq_databases_user_db_name` composite unique index).
3. Generate the actual MySQL schema name: `s{user_id}_{dbName}` (e.g., `s42_mydb`). This prefixing convention is defined in Section 9.
4. Generate a restricted MySQL username: `u{user_id}_{dbName}` (e.g., `u42_mydb`). This is globally unique (enforced by `uq_databases_db_user`). The naming convention is defined in Section 9.
5. Generate a random password for the restricted MySQL user.
6. Encrypt the password using AES-256-CBC with `DB_ENCRYPTION_KEY` (Section 5.11).
7. Create the MySQL schema and restricted user via `databaseProvisioningService.js` using `MYSQL_ROOT_PASSWORD`.
8. Grant the restricted user full privileges on the created schema only (no access to other schemas).
9. Insert a row into the `databases` table.
10. Return the database info (credentials are not returned in plaintext; the student uses phpMyAdmin or attaches the database to a project).

**Success Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "id": 5,
    "dbName": "mydb",
    "mysqlSchemaName": "s42_mydb",
    "createdAt": "2024-02-15T09:00:00Z"
  }
}
```

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Missing `dbName` field | `400` | `VALIDATION_ERROR` | `Database name is required` |
| Invalid `dbName` format | `400` | `VALIDATION_ERROR` | `Database name must be alphanumeric and underscores, 1-64 characters` |
| Duplicate database name for this student | `409` | `DATABASE_NAME_DUPLICATE` | `You already have a database named '{dbName}'` |
| Database quota exceeded | `400` | `DATABASE_QUOTA_EXCEEDED` | `Database limit reached ({current}/{max})` |

---

### 6.6.2 `GET /api/databases`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('student')` |
| Controller | `databaseController.listDatabases` |

**Request:** No body. Scoped to `req.user.id`.

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 5,
        "dbName": "mydb",
        "mysqlSchemaName": "s42_mydb",
        "phpMyAdminUrl": "http://localhost:8080?server=1&db=s42_mydb&user=u42_mydb",
        "createdAt": "2024-02-15T09:00:00Z"
      }
    ],
    "quota": {
      "used": 1,
      "total": 4
    }
  }
}
```

The `quota` object provides the `n/m` data for the database usage card in the student dashboard.

---

### 6.6.3 `GET /api/databases/:id/phpmyadmin`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('student')` |
| Controller | `databaseController.getPhpMyAdminLink` |

**Path Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `id` | `integer` | `databases.id` |

**Behavior:** Constructs a phpMyAdmin URL scoped to the student's specific database schema. The URL is built using `PHPMYADMIN_URL` (Section 3.2.8). The link includes query parameters for pre-selecting the server, database, and username: `{PHPMYADMIN_URL}?server=1&db={mysql_schema_name}&user={db_user}`. Actual access restriction is enforced at the MySQL level — the restricted user created by `databaseProvisioningService.js` has privileges only on their specific schema. Even if the student navigates to other schemas in phpMyAdmin, they will see an "access denied" error.

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "databaseId": 5,
    "phpMyAdminUrl": "http://localhost:8080?server=1&db=s42_mydb&user=u42_mydb"
  }
}
```

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Database not found or not owned by student | `404` | `DATABASE_NOT_FOUND` | `Database not found` |

---

### 6.6.4 Database Routes Summary

| Method | Path | Middleware | Controller Function | Description |
|---|---|---|---|---|
| `POST` | `/api/databases` | `auth` → `roleGuard('student')` | `databaseController.createDatabase` | Create a new database |
| `GET` | `/api/databases` | `auth` → `roleGuard('student')` | `databaseController.listDatabases` | List student's databases with quota |
| `GET` | `/api/databases/:id/phpmyadmin` | `auth` → `roleGuard('student')` | `databaseController.getPhpMyAdminLink` | Get phpMyAdmin link for a database |

---

## 6.7 Resource Request Routes — `routes/resourceRequests.js`

This route file handles both student submission and admin review of resource requests, distinguished by role-based middleware. Handled by `controllers/resourceRequestController.js`.

### 6.7.1 `POST /api/resource-requests`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('student')` |
| Controller | `resourceRequestController.submitRequest` |
| Content-Type | `application/json` |

**Request Body:**

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `resourceType` | `string` | Yes | One of `cpu`, `ram`, `storage`, `projects`, `databases` | Which resource to increase |
| `requestedValue` | `string` | Yes | Non-empty, max 50 characters | Requested value (e.g., `4` for 4 cores, `2048` for 2048 MB RAM) |
| `description` | `string` | Yes | Non-empty | Justification for the request |

**Success Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "id": 12,
    "resourceType": "cpu",
    "requestedValue": "4",
    "description": "Need more CPU for ML training project",
    "status": "pending",
    "createdAt": "2024-02-20T11:00:00Z"
  }
}
```

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Missing required fields | `400` | `VALIDATION_ERROR` | `{field} is required` |
| Invalid `resourceType` | `400` | `VALIDATION_ERROR` | `Resource type must be one of: cpu, ram, storage, projects, databases` |

---

### 6.7.2 `GET /api/resource-requests`

| Property | Value |
|---|---|
| Middleware | `auth` |
| Controller | `resourceRequestController.listRequests` |
| Pagination | Yes (Section 6.1.2) |

**Behavior:** This endpoint is accessible to both `admin` and `student` roles. The response is scoped by role:

| Role | Scope |
|---|---|
| `student` | Returns only the authenticated student's own requests |
| `admin` | Returns all resource requests across all students |

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `page` | `integer` | No | `1` | Page number |
| `limit` | `integer` | No | `20` | Items per page (max 100) |
| `status` | `string` | No | All statuses | Filter by `pending`, `approved`, `denied` |

**Success Response (admin):** `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 12,
        "resourceType": "cpu",
        "requestedValue": "4",
        "description": "Need more CPU for ML training project",
        "status": "pending",
        "adminNotes": null,
        "reviewedAt": null,
        "createdAt": "2024-02-20T11:00:00Z",
        "student": {
          "id": 42,
          "email": "student@institution.edu",
          "name": "Jane Smith"
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalItems": 3,
      "totalPages": 1
    }
  }
}
```

The `student` object is included only in admin responses. Student responses omit it (the student is always the authenticated user).

---

### 6.7.3 `PUT /api/resource-requests/:id`

| Property | Value |
|---|---|
| Middleware | `auth` → `roleGuard('admin')` |
| Controller | `resourceRequestController.reviewRequest` |
| Content-Type | `application/json` |

**Path Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `id` | `integer` | `resource_requests.id` |

**Request Body:**

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `status` | `string` | Yes | One of `approved`, `denied` | Admin's decision |
| `adminNotes` | `string` | No | Max 1000 characters | Admin's response or notes |

**Behavior:**

1. Update `resource_requests.status` to `approved` or `denied`.
2. Set `resource_requests.admin_notes` if provided.
3. Set `resource_requests.reviewed_at` to `NOW()`.
4. If `approved`: automatically apply the requested quota change to the student's `users` row. The `requestedValue` is the desired new **absolute total** for the quota (not an additive delta). For example, if a student with 2 CPU cores requests `"4"`, approval sets `cpu_quota = 4`, not `cpu_quota += 4`. The `resource_type` and `requested_value` map to the corresponding `users` column:

| `resource_type` | `users` Column Updated | Value Applied |
|---|---|---|
| `cpu` | `cpu_quota` | `requested_value` parsed as `DECIMAL` |
| `ram` | `ram_quota_mb` | `requested_value` parsed as `INT` |
| `storage` | `storage_quota_mb` | `requested_value` parsed as `INT` |
| `projects` | `max_projects` | `requested_value` parsed as `INT` |
| `databases` | `max_databases` | `requested_value` parsed as `INT` |

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 12,
    "status": "approved",
    "adminNotes": "Approved for ML project deadline",
    "reviewedAt": "2024-02-21T09:30:00Z",
    "quotaApplied": true
  }
}
```

When `status = 'denied'`, the `quotaApplied` field is `false`.

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Request not found | `404` | `REQUEST_NOT_FOUND` | `Resource request not found` |
| Request already reviewed (`status != 'pending'`) | `400` | `REQUEST_ALREADY_REVIEWED` | `This request has already been reviewed` |
| Invalid `status` value | `400` | `VALIDATION_ERROR` | `Status must be approved or denied` |

---

### 6.7.4 Resource Request Routes Summary

| Method | Path | Middleware | Controller Function | Description |
|---|---|---|---|---|
| `POST` | `/api/resource-requests` | `auth` → `roleGuard('student')` | `resourceRequestController.submitRequest` | Submit resource request |
| `GET` | `/api/resource-requests` | `auth` | `resourceRequestController.listRequests` | List requests (role-scoped) |
| `PUT` | `/api/resource-requests/:id` | `auth` → `roleGuard('admin')` | `resourceRequestController.reviewRequest` | Review resource request |

---

## 6.8 Webhook Routes — `routes/webhooks.js`

### 6.8.1 `POST /api/webhooks/github/:projectId`

| Property | Value |
|---|---|
| Middleware | None (authenticated via webhook secret, not JWT) |
| Handler | `webhookService.handleGithubWebhook` |
| Content-Type | `application/json` (GitHub webhook payload) |

**Path Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `projectId` | `integer` | `projects.id` |

**Headers (set by GitHub):**

| Header | Description |
|---|---|
| `X-Hub-Signature-256` | HMAC-SHA256 signature of the request body, computed using the webhook secret as the key; format: `sha256=<hex_digest>` |
| `X-GitHub-Event` | GitHub event type (e.g., `push`, `ping`) |
| `X-GitHub-Delivery` | Unique delivery ID |

**Behavior:**

1. Look up the project by `projectId`.
2. If the project is not found, has `status = 'deleted'`, or `source_type = 'zip'`, return `404`.
3. Determine which webhook secret to use for validation:
   a. Extract the repository URL from the payload (`payload.repository.clone_url` or `payload.repository.html_url`).
   b. If the repo URL matches `projects.git_url`, use `projects.webhook_secret`.
   c. If the repo URL matches `projects.git_url_backend` (combined projects), use `projects.webhook_secret_backend`.
   d. If neither matches, return `400`.
4. Validate the `X-Hub-Signature-256` header against the request body using the determined webhook secret.
5. If validation fails, return `401`.
6. If `X-GitHub-Event` is `ping`, return `200` with `{ "success": true, "data": { "message": "pong" } }`.
7. If `X-GitHub-Event` is `push`:
   a. Pull the new code for the matched repository (frontend, backend, or both).
   b. Rebuild the Docker image from scratch.
   c. Stop and remove the old container.
   d. Spin up a fresh container with all the same configuration — port assignment, subdomain routing, CPU and RAM limits, and database credentials — re-injected automatically.
   e. No Nginx reconfiguration required (same port, same subdomain).
   f. Delete the old Docker image.
   g. Update `projects.container_id` with the new container ID.
8. Return `200 OK` to GitHub within a reasonable time; the rebuild runs asynchronously.

**Success Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "message": "REBUILD_TRIGGERED",
    "projectId": 15
  }
}
```

**Error Responses:**

| Condition | HTTP Status | Error Code | Message |
|---|---|---|---|
| Project not found or deleted | `404` | `PROJECT_NOT_FOUND` | `Project not found` |
| Project uses ZIP source type | `400` | `WEBHOOK_NOT_SUPPORTED` | `Webhooks are not supported for ZIP-based projects` |
| Repository URL does not match project's Git URLs | `400` | `REPOSITORY_MISMATCH` | `Repository URL does not match this project` |
| Webhook signature validation failed | `401` | `WEBHOOK_SIGNATURE_INVALID` | `Invalid webhook signature` |

---

## 6.9 Express.js Server Route Registration — `server.js`

Route files are registered in `server.js` in the following order:

```javascript
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/student');
const adminRoutes = require('./routes/admin');
const projectRoutes = require('./routes/projects');
const databaseRoutes = require('./routes/databases');
const resourceRequestRoutes = require('./routes/resourceRequests');
const webhookRoutes = require('./routes/webhooks');

const app = express();

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN,
  credentials: true  // Required for httpOnly cookies
}));
app.use(cookieParser());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/databases', databaseRoutes);
app.use('/api/resource-requests', resourceRequestRoutes);
app.use('/api/webhooks', webhookRoutes);
```

**Key configuration notes:**

| Setting | Value | Purpose |
|---|---|---|
| `cors.origin` | `CORS_ORIGIN` env var | Allows cross-origin requests from the frontend dashboards |
| `cors.credentials` | `true` | Allows cookies (refresh token) to be sent cross-origin |
| `cookieParser()` | Applied globally | Parses the `refreshToken` `httpOnly` cookie on auth routes |
| `express.json()` | Applied globally | Parses JSON request bodies |

**Note on multipart/form-data:** Routes that accept file uploads (`POST /api/projects`, `POST /api/admin/students/invite`) use `multer` middleware applied at the route level, not globally. Configuration details are in Section 6.12.

---

## 6.10 Complete Route Registry

All 39 API endpoints across all route files:

| # | Method | Path | Middleware | Controller Function | Description |
|---|---|---|---|---|---|
| 1 | `POST` | `/api/auth/login` | None | `authController.login` | User login |
| 2 | `POST` | `/api/auth/register` | None | `authController.register` | Student registration via invite |
| 3 | `POST` | `/api/auth/refresh` | None | `authController.refresh` | Token refresh |
| 4 | `POST` | `/api/auth/logout` | `auth` | `authController.logout` | Logout |
| 5 | `GET` | `/api/auth/invite/validate` | None | `authController.validateInvite` | Validate invite token |
| 6 | `POST` | `/api/auth/forgot-password` | None | `authController.forgotPassword` | Request password reset |
| 7 | `POST` | `/api/auth/reset-password` | None | `authController.resetPassword` | Reset password with token |
| 8 | `PUT` | `/api/auth/password` | `auth` | `authController.changePassword` | Change password |
| 9 | `GET` | `/api/student/profile` | `auth` → `roleGuard('student')` | `studentController.getProfile` | Student profile with usage |
| 10 | `PUT` | `/api/student/dark-mode` | `auth` → `roleGuard('student')` | `studentController.toggleDarkMode` | Toggle dark/light mode |
| 11 | `GET` | `/api/admin/metrics` | `auth` → `roleGuard('admin')` | `adminController.getMetrics` | System-wide metrics |
| 12 | `GET` | `/api/admin/students` | `auth` → `roleGuard('admin')` | `adminController.listStudents` | List all students |
| 13 | `PUT` | `/api/admin/students/:id/quota` | `auth` → `roleGuard('admin')` | `adminController.updateStudentQuota` | Adjust student quotas |
| 14 | `DELETE` | `/api/admin/students/:id` | `auth` → `roleGuard('admin')` | `adminController.removeStudent` | Remove student |
| 15 | `POST` | `/api/admin/students/batch-remove` | `auth` → `roleGuard('admin')` | `adminController.batchRemoveStudents` | Batch remove by year |
| 16 | `POST` | `/api/admin/students/invite` | `auth` → `roleGuard('admin')` | `adminController.inviteStudents` | Invite students |
| 17 | `POST` | `/api/admin/students/:id/resend-invite` | `auth` → `roleGuard('admin')` | `adminController.resendInvite` | Resend invitation |
| 18 | `GET` | `/api/admin/projects` | `auth` → `roleGuard('admin')` | `adminController.listProjects` | List all projects |
| 19 | `POST` | `/api/admin/projects/:id/stop` | `auth` → `roleGuard('admin')` | `adminController.stopProject` | Stop project (email) |
| 20 | `POST` | `/api/admin/projects/:id/terminate` | `auth` → `roleGuard('admin')` | `adminController.terminateProject` | Terminate project (email) |
| 21 | `POST` | `/api/projects` | `auth` → `roleGuard('student')` | `projectController.createProject` | Create project |
| 22 | `GET` | `/api/projects` | `auth` → `roleGuard('student')` | `projectController.listProjects` | List student's projects |
| 23 | `GET` | `/api/projects/:id` | `auth` → `roleGuard('student')` | `projectController.getProject` | Get project details |
| 24 | `PUT` | `/api/projects/:id/database` | `auth` → `roleGuard('student')` | `projectController.switchDatabase` | Switch database |
| 25 | `PUT` | `/api/projects/:id/resources` | `auth` → `roleGuard('student')` | `projectController.updateResources` | Adjust CPU/RAM |
| 26 | `GET` | `/api/projects/:id/logs` | `auth` → `roleGuard('student')` | `projectController.getLogs` | Get runtime logs |
| 27 | `GET` | `/api/projects/:id/build-logs/stream` | `auth` (query param) → `roleGuard('student')` | `projectController.streamBuildLogs` | SSE build log stream |
| 28 | `GET` | `/api/projects/:id/build-logs` | `auth` → `roleGuard('student')` | `projectController.getBuildLogs` | Get latest build log |
| 29 | `GET` | `/api/projects/:id/storage` | `auth` → `roleGuard('student')` | `projectController.getStorageUsage` | Get storage usage |
| 30 | `POST` | `/api/projects/:id/restart` | `auth` → `roleGuard('student')` | `projectController.restartProject` | Restart project |
| 31 | `POST` | `/api/projects/:id/stop` | `auth` → `roleGuard('student')` | `projectController.stopProject` | Stop project |
| 32 | `DELETE` | `/api/projects/:id` | `auth` → `roleGuard('student')` | `projectController.deleteProject` | Delete project |
| 33 | `POST` | `/api/databases` | `auth` → `roleGuard('student')` | `databaseController.createDatabase` | Create database |
| 34 | `GET` | `/api/databases` | `auth` → `roleGuard('student')` | `databaseController.listDatabases` | List databases with quota |
| 35 | `GET` | `/api/databases/:id/phpmyadmin` | `auth` → `roleGuard('student')` | `databaseController.getPhpMyAdminLink` | Get phpMyAdmin link |
| 36 | `POST` | `/api/resource-requests` | `auth` → `roleGuard('student')` | `resourceRequestController.submitRequest` | Submit resource request |
| 37 | `GET` | `/api/resource-requests` | `auth` | `resourceRequestController.listRequests` | List requests (role-scoped) |
| 38 | `PUT` | `/api/resource-requests/:id` | `auth` → `roleGuard('admin')` | `resourceRequestController.reviewRequest` | Review resource request |
| 39 | `POST` | `/api/webhooks/github/:projectId` | None | `webhookService.handleGithubWebhook` | GitHub webhook |
| 40 | `POST` | `/api/auth/phpmyadmin/verify` | None (internal only) | `authController.verifyPhpMyAdminSession` | phpMyAdmin signon verify (Nginx blocks external) |

---

## 6.11 Ambiguity Decisions Registry

| # | Ambiguity | Decision | Rationale |
|---|---|---|---|
| 1 | Spec does not define a standard response envelope | `{ "success": true/false, "data": {}, "error": "CODE", "message": "..." }` | Consistent parsing interface for frontend |
| 2 | Spec does not define pagination for list endpoints | Optional pagination with `page` (default 1) and `limit` (default 20, max 100) | Prevents unbounded response sizes |
| 3 | Spec does not define per-project default CPU and RAM values for project creation | Default `cpuLimit = 1.00`, `ramLimitMb = 512` | Allows 2 projects at default allocations within default student quotas |
| 4 | Spec does not define transport mechanism for real-time build logs | Server-Sent Events (SSE) via `GET /api/projects/:id/build-logs/stream` | Simpler than WebSocket for unidirectional streaming; natively supported by browsers |
| 5 | Spec says admin can "stop or terminate" projects but does not define the difference | Stop = stop container (can be restarted); Terminate = full cleanup and soft-delete (`status = 'deleted'`) | Consistent with student "stop" vs "delete" actions; admin "terminate" is equivalent to student "delete" |
| 6 | Spec does not specify how phpMyAdmin is scoped to a specific schema | Link includes query parameters for pre-selection; actual access restriction enforced by MySQL restricted user privileges | MySQL-level security is the real enforcement; the link is a convenience |
| 7 | Spec does not specify whether the webhook URL includes the project ID | `POST /api/webhooks/github/:projectId` includes project ID in path | More explicit; avoids ambiguous repository URL matching |
| 8 | Spec does not define filter/search parameters for admin list endpoints | Added `status`, `batchYear`, `search`, `studentId` query parameters where appropriate | Standard list filtering for admin usability |
| 9 | Spec mentions resource requests can be "reviewed and acted upon" but does not define whether approval auto-applies the quota change | Approval auto-applies the `requestedValue` (absolute total, not delta) to the student's quota column | Reduces admin workflow; the admin approves the specific value the student requested |
| 10 | Spec does not define an admin endpoint for viewing resource requests separately from the `routes/resourceRequests.js` file | Admin accesses requests via `GET /api/resource-requests` with role-based scoping and `PUT /api/resource-requests/:id` for review; all in `routes/resourceRequests.js` | Matches Section 2.3 which places both student and admin resource request operations in `routes/resourceRequests.js` |
| 11 | `EventSource` does not support custom `Authorization` headers for the SSE build log endpoint | `auth.js` middleware checks for access token in query parameter (`?token=`) as fallback after checking `Authorization` header | Standard workaround for SSE/WebSocket endpoints; token is short-lived (15 min) |
| 12 | Spec does not define the subdomain format after soft-delete | Subdomain replaced with `_deleted_{project_id}` on soft-delete to free the original subdomain for reclamation | Underscore prefix is invalid for student subdomains; can never collide |

---

## 6.12 File Upload Configuration (Multer)

File uploads are handled by the `multer` npm package, configured at the route level (not globally). Two storage strategies are used depending on the file type:

| Storage Strategy | Used For | Reason |
|---|---|---|
| Disk storage | ZIP file uploads (project creation) | ZIP files can be up to 200 MB; storing in memory would exhaust server RAM |
| Memory storage | Excel file uploads (student invitation) | Excel files are small; parsing in memory via `xlsx` package is simpler |

### 6.12.1 Multer Configuration for Project Creation (`routes/projects.js`)

| Setting | Value |
|---|---|
| Storage | `multer.diskStorage` |
| Destination | `os.tmpdir()` (system temp directory; files are moved to `{PROJECTS_BASE_DIR}/{student_id}/{project_id}/uploads/` by `zipHandler.js` after validation, then deleted after extraction) |
| File size limit | `MAX_ZIP_UPLOAD_SIZE_MB * 1024 * 1024` bytes (default: 200 MB) |
| File filter | Accept only `.zip` files (MIME type `application/zip` or `application/x-zip-compressed`) |

**Field configuration by project type:**

| Project Type | Multer Fields |
|---|---|
| `frontend` or `backend` with `sourceType = 'zip'` | `upload.single('zipFile')` — single file field named `zipFile` |
| `combined` with `sourceType = 'zip'` | `upload.fields([{ name: 'zipFileFrontend', maxCount: 1 }, { name: 'zipFileBackend', maxCount: 1 }])` — two named file fields |
| Any project with `sourceType = 'git'` | No file fields; multer is not invoked (request is parsed as JSON or multipart without files) |

### 6.12.2 Multer Configuration for Student Invitation (`routes/admin.js`)

| Setting | Value |
|---|---|
| Storage | `multer.memoryStorage()` |
| File size limit | `5 * 1024 * 1024` bytes (5 MB — sufficient for any Excel file containing email addresses) |
| File filter | Accept only `.xlsx` and `.xls` files (MIME types `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and `application/vnd.ms-excel`) |
| Field name | `upload.single('file')` — single file field named `file` |

### 6.12.3 Multer Error Handling

| Multer Error | HTTP Status | Error Code | Message |
|---|---|---|---|
| `LIMIT_FILE_SIZE` | `400` | `ZIP_TOO_LARGE` (for ZIP) or `FILE_TOO_LARGE` (for Excel) | `File exceeds maximum size` |
| `LIMIT_UNEXPECTED_FILE` | `400` | `UNEXPECTED_FILE` | `Unexpected file field` |
| File filter rejection | `400` | `INVALID_FILE_TYPE` | `Invalid file type. Expected: {expected_types}` |