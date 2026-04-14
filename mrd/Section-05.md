# Section 5 — Authentication & Authorization

## 5.1 Overview

AcadHost uses a JWT-based authentication system with role-based authorization. The system has exactly two roles: `admin` and `student`. There is one fixed admin account created via a seed script; all student accounts are created through an admin-initiated invitation flow. There is no self-registration for either role.

The authentication system comprises five key components:

| Component | File (Section 2.3) | Responsibility |
|---|---|---|
| JWT access token verification middleware | `middleware/auth.js` | Validates and decodes JWT access tokens on protected routes |
| Role-based authorization middleware | `middleware/roleGuard.js` | Restricts routes to `admin` or `student` roles |
| Token utility functions | `utils/tokenHelper.js` | Access token generation, refresh token generation, invite token generation, password reset token generation |
| Authentication controller | `controllers/authController.js` | Login, registration, token refresh, invite link validation, forgot password, reset password, change password |
| Admin seed script | `seeds/adminSeed.js` | Creates the single fixed admin account on first deployment |

## 5.2 Roles and Account Types

| Role | Count | Creation Method | Status Flow |
|---|---|---|---|
| `admin` | Exactly 1 | Created by `seeds/adminSeed.js` on first deployment; `ADMIN_EMAIL` and `ADMIN_DEFAULT_PASSWORD` from environment variables | Seeded as `active` with `must_change_password = 1` |
| `student` | 0 to N | Created by admin invitation; user row inserted with `status = 'invited'` when invite is sent; transitions to `active` when student completes registration via invite link | `invited` → `active` → `removed` (if admin removes) |

### 5.2.1 Account Status Definitions

| Status | `users.status` Value | Meaning | Can Log In |
|---|---|---|---|
| Invited | `invited` | Admin has sent an invitation email; student has not yet registered (set name and password) | No — `password_hash` is `NULL` |
| Active | `active` | Student has completed registration or admin account is seeded | Yes |
| Removed | `removed` | Admin has removed the student from the platform | No |

### 5.2.2 Login Eligibility Rules

A user may log in only if all of the following conditions are met:

| Condition | Check |
|---|---|
| `users.status` is `active` | User has completed registration and has not been removed |
| `users.password_hash` is not `NULL` | User has set a password |
| Email and password match | Bcrypt comparison of submitted password against `users.password_hash` |

If `users.status` is `invited`, login is rejected because the student has not completed registration. If `users.status` is `removed`, login is rejected because the admin has removed the student.

## 5.3 Password Hashing

All passwords are hashed using bcrypt before storage in the `users.password_hash` column.

| Parameter | Value |
|---|---|
| Hashing algorithm | bcrypt |
| Salt rounds | 12 |
| Storage column | `users.password_hash` — `VARCHAR(255)` |
| Nullable | Yes — `NULL` for invited-but-not-yet-registered students |

### 5.3.1 Password Validation Rules

| Rule | Constraint |
|---|---|
| Minimum length | 8 characters |
| Maximum length | 128 characters |
| Allowed characters | Any printable UTF-8 characters |

### 5.3.2 Error Codes for Password Validation

| Error Code | Condition |
|---|---|
| `PASSWORD_TOO_SHORT` | Password is fewer than 8 characters |
| `PASSWORD_TOO_LONG` | Password exceeds 128 characters |

These error codes are used by `POST /api/auth/register`, `PUT /api/auth/password`, and `POST /api/auth/reset-password`.

## 5.4 Token System

AcadHost uses four distinct token types. Three are JWTs; one is a cryptographically random hex string.

| Token Type | Format | Signing Secret | Expiry | Storage (Server) | Storage (Client) |
|---|---|---|---|---|---|
| Access token | JWT | `JWT_ACCESS_SECRET` | 15 minutes (`ACCESS_TOKEN_EXPIRY`) | Not stored on server | Stored in memory (JavaScript variable) by the frontend; never in `localStorage` or cookies |
| Refresh token | JWT | `JWT_REFRESH_SECRET` | 7 days (`REFRESH_TOKEN_EXPIRY`) | SHA-256 hash stored in `refresh_tokens.token_hash` | Stored in an `httpOnly`, `Secure`, `SameSite=Strict` cookie |
| Invite token | JWT | `JWT_INVITE_SECRET` | 2 hours (`INVITE_TOKEN_EXPIRY`) | SHA-256 hash stored in `invite_tokens.token_hash` | Sent in invitation email link; not stored by any client |
| Password reset token | Random 32 bytes (hex-encoded, 64 characters) | N/A (not a JWT) | 1 hour (`PASSWORD_RESET_TOKEN_EXPIRY_HOURS`) | SHA-256 hash stored in `password_reset_tokens.token_hash` | Sent in password reset email link; not stored by any client |

Access tokens are stored in JavaScript memory (a variable in React state/context) and sent via the `Authorization: Bearer <token>` header. Refresh tokens are stored in an `httpOnly`, `Secure`, `SameSite=Strict` cookie. This prevents XSS attacks from accessing the refresh token (httpOnly) and prevents CSRF attacks (SameSite=Strict). Access tokens in memory are inherently safe from XSS-based theft via localStorage. The `Secure` flag ensures the cookie is only sent over HTTPS (in production via Cloudflare SSL). During development over HTTP on localhost, browsers typically still send `Secure` cookies to `localhost`.

Because access tokens are stored in JavaScript memory, they are lost on page refresh. The frontend must call `POST /api/auth/refresh` on every page load/refresh to obtain a new access token. This produces a brief loading state while the token is re-obtained — an accepted trade-off for the security benefit of in-memory storage. Section 13 (Student Dashboard) must implement this behavior.

### 5.4.1 Access Token — JWT Claims

| Claim | Type | Description |
|---|---|---|
| `sub` | `string` (numeric) | `users.id` — the user's unique identifier |
| `email` | `string` | `users.email` — the user's email address |
| `role` | `string` | `users.role` — either `admin` or `student` |
| `iat` | `number` | Issued-at timestamp (set automatically by `jsonwebtoken`) |
| `exp` | `number` | Expiry timestamp (15 minutes from `iat`, controlled by `ACCESS_TOKEN_EXPIRY`) |

**Example access token payload:**

```json
{
  "sub": "42",
  "email": "student@institution.edu",
  "role": "student",
  "iat": 1700000000,
  "exp": 1700000900
}
```

### 5.4.2 Refresh Token — JWT Claims

| Claim | Type | Description |
|---|---|---|
| `sub` | `string` (numeric) | `users.id` — the user's unique identifier |
| `jti` | `string` | Unique token identifier (UUID v4); used to look up the corresponding `refresh_tokens` row via SHA-256 hash of the full token |
| `iat` | `number` | Issued-at timestamp |
| `exp` | `number` | Expiry timestamp (7 days from `iat`, controlled by `REFRESH_TOKEN_EXPIRY`) |

The refresh token is a full JWT string. The server stores `SHA256(full_jwt_string)` in `refresh_tokens.token_hash`. On refresh, the server:

1. Verifies the JWT signature using `JWT_REFRESH_SECRET`.
2. Computes `SHA256(full_jwt_string)` and looks up the hash in `refresh_tokens.token_hash`.
3. Checks that `refresh_tokens.revoked = 0` and `refresh_tokens.expires_at` has not passed.
4. If all checks pass, the old token is revoked (`revoked = 1`) and a new access token + new refresh token are issued (token rotation).

### 5.4.3 Invite Token — JWT Claims

| Claim | Type | Description |
|---|---|---|
| `email` | `string` | The invited student's email address |
| `batch_year` | `number` or `null` | Batch year label assigned by the admin; `null` if no batch year was specified |
| `iat` | `number` | Issued-at timestamp |
| `exp` | `number` | Expiry timestamp (2 hours from `iat`, controlled by `INVITE_TOKEN_EXPIRY`) |

**Example invite token payload:**

```json
{
  "email": "student@institution.edu",
  "batch_year": 2024,
  "iat": 1700000000,
  "exp": 1700007200
}
```

The invite token is sent in the invitation email as a URL parameter: `{FRONTEND_URL}/register?token=<jwt_string>`. The server stores `SHA256(jwt_string)` in `invite_tokens.token_hash`. On registration, the server:

1. Verifies the JWT signature using `JWT_INVITE_SECRET`.
2. Computes `SHA256(jwt_string)` and looks up the hash in `invite_tokens.token_hash`.
3. Checks that `invite_tokens.used = 0` and `invite_tokens.expires_at` has not passed.
4. If the token is expired, returns `410 Gone` with `{ "error": "INVITE_EXPIRED", "canResend": true }`.
5. If the token is valid and unused, proceeds with registration.

### 5.4.4 Password Reset Token — Format and Handling

Password reset tokens are **not** JWTs. They are cryptographically random 32-byte values, hex-encoded to produce a 64-character string.

| Property | Value |
|---|---|
| Generation method | `crypto.randomBytes(32).toString('hex')` |
| Raw token length | 64 hex characters |
| Server storage | `SHA256(raw_token)` in `password_reset_tokens.token_hash` |
| Expiry tracking | `password_reset_tokens.expires_at` — computed as `NOW() + PASSWORD_RESET_TOKEN_EXPIRY_HOURS` hours |
| Email link format | `{FRONTEND_URL}/reset-password?token=<raw_token>` |

On password reset, the server:

1. Receives the raw token from the request body.
2. Computes `SHA256(raw_token)` and looks up the hash in `password_reset_tokens.token_hash`.
3. Checks that `password_reset_tokens.used = 0` and `password_reset_tokens.expires_at` has not passed.
4. If valid, updates the user's `password_hash`, marks the token `used = 1`, and revokes all refresh tokens for that user.

### 5.4.5 Token Hashing

All tokens stored on the server are hashed using SHA-256 before insertion into the database. The raw token is never persisted.

| Token Type | Hashing Method | Storage Column |
|---|---|---|
| Refresh token | `SHA256(full_jwt_string)` | `refresh_tokens.token_hash` |
| Invite token | `SHA256(full_jwt_string)` | `invite_tokens.token_hash` |
| Password reset token | `SHA256(raw_hex_token)` | `password_reset_tokens.token_hash` |

Implementation in `utils/tokenHelper.js`:

```javascript
const crypto = require('crypto');

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}
```

## 5.5 Token Utility Functions — `utils/tokenHelper.js`

This file provides all token generation and hashing functions used across the authentication system.

| Function | Input | Output | Description |
|---|---|---|---|
| `generateAccessToken(user)` | User object `{ id, email, role }` | JWT string | Signs a JWT with `JWT_ACCESS_SECRET`; expiry controlled by `ACCESS_TOKEN_EXPIRY` (default `15m`); payload contains `sub`, `email`, `role` |
| `generateRefreshToken(user)` | User object `{ id }` | JWT string | Signs a JWT with `JWT_REFRESH_SECRET`; expiry controlled by `REFRESH_TOKEN_EXPIRY` (default `7d`); payload contains `sub`, `jti` (UUID v4) |
| `generateInviteToken(email, batchYear)` | Email string, batch year number or null | JWT string | Signs a JWT with `JWT_INVITE_SECRET`; expiry controlled by `INVITE_TOKEN_EXPIRY` (default `2h`); payload contains `email`, `batch_year` |
| `generatePasswordResetToken()` | None | Raw hex string (64 characters) | Generates 32 cryptographically random bytes via `crypto.randomBytes(32).toString('hex')` |
| `hashToken(rawToken)` | Any raw token string | SHA-256 hex digest string | Computes `SHA256(rawToken)` for server-side storage |
| `verifyAccessToken(token)` | JWT string | Decoded payload or throws error | Verifies signature using `JWT_ACCESS_SECRET`; returns decoded claims |
| `verifyRefreshToken(token)` | JWT string | Decoded payload or throws error | Verifies signature using `JWT_REFRESH_SECRET`; returns decoded claims |
| `verifyInviteToken(token)` | JWT string | Decoded payload or throws error | Verifies signature using `JWT_INVITE_SECRET`; returns decoded claims |

**Dependencies:**

| Package | Purpose |
|---|---|
| `jsonwebtoken` | JWT signing and verification; accepts expiry formats via the `ms` package it depends on (e.g., `15m`, `7d`, `2h`) |
| `uuid` (v4) | Generates unique `jti` claims for refresh tokens |
| `crypto` (Node.js built-in) | SHA-256 hashing and random byte generation for password reset tokens |

## 5.6 Middleware — `middleware/auth.js`

The `auth.js` middleware validates JWT access tokens on all protected routes. It is applied to every route except public endpoints.

### 5.6.1 Behavior

1. Extract the access token from the incoming request using the following priority order:

| Priority | Source | Format | Use Case |
|---|---|---|---|
| 1 | `Authorization` header | `Bearer <token>` | Standard API requests |
| 2 | `token` query parameter | Raw JWT string | SSE endpoints (`EventSource` does not support custom `Authorization` headers) |

2. If neither source provides a token, respond with `401 Unauthorized`.
3. Call `verifyAccessToken(token)` from `utils/tokenHelper.js`.
4. If verification succeeds, attach the decoded payload to `req.user`:
   ```javascript
   req.user = {
     id: decoded.sub,    // INT — users.id
     email: decoded.email, // STRING — users.email
     role: decoded.role    // STRING — 'admin' or 'student'
   };
   ```
5. Call `next()` to proceed to the route handler.
6. If verification fails (malformed token, expired token, invalid signature), respond with `401 Unauthorized`.

### 5.6.2 Error Responses

| Condition | HTTP Status | Response Body |
|---|---|---|
| No token found (neither header nor query parameter) | `401` | `{ "error": "ACCESS_TOKEN_REQUIRED" }` |
| `Authorization` header malformed (not `Bearer <token>`) | `401` | `{ "error": "ACCESS_TOKEN_MALFORMED" }` |
| Token signature invalid | `401` | `{ "error": "ACCESS_TOKEN_INVALID" }` |
| Token expired | `401` | `{ "error": "ACCESS_TOKEN_EXPIRED" }` |

### 5.6.3 Public Routes (No `auth.js` Middleware)

The following routes do not require authentication and must not have `auth.js` applied:

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/login` | `POST` | User login |
| `/api/auth/register` | `POST` | Student registration via invite link |
| `/api/auth/refresh` | `POST` | Token refresh (uses refresh token cookie, not access token) |
| `/api/auth/invite/validate` | `GET` | Validate an invite token (checks if valid, expired, or used) |
| `/api/auth/forgot-password` | `POST` | Request a password reset email |
| `/api/auth/reset-password` | `POST` | Reset password using a reset token |
| `/api/webhooks/github/:projectId` | `POST` | GitHub webhook endpoint (authenticated via webhook secret, not JWT) |

All other routes require the `auth.js` middleware.

## 5.7 Middleware — `middleware/roleGuard.js`

The `roleGuard.js` middleware restricts access to routes based on the user's role. It must always be applied **after** `auth.js` because it reads `req.user.role` set by the auth middleware.

### 5.7.1 Usage Pattern

```javascript
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');

// Admin-only route
router.get('/admin/students', auth, roleGuard('admin'), adminController.listStudents);

// Student-only route
router.get('/student/profile', auth, roleGuard('student'), studentController.getProfile);
```

### 5.7.2 Behavior

1. Accept a required role (or array of roles) as a parameter.
2. Compare `req.user.role` against the required role(s).
3. If the role matches, call `next()`.
4. If the role does not match, respond with `403 Forbidden`.

### 5.7.3 Error Response

| Condition | HTTP Status | Response Body |
|---|---|---|
| `req.user.role` does not match required role(s) | `403` | `{ "error": "FORBIDDEN", "message": "Insufficient permissions" }` |

### 5.7.4 Route Protection Summary

| Route Prefix | Required Role | Middleware Chain |
|---|---|---|
| `/api/auth/*` (public endpoints listed in 5.6.3) | None | No middleware |
| `/api/auth/password` | `admin` or `student` (any authenticated user) | `auth` only |
| `/api/auth/logout` | `admin` or `student` (any authenticated user) | `auth` only |
| `/api/student/*` | `student` | `auth` → `roleGuard('student')` |
| `/api/admin/*` | `admin` | `auth` → `roleGuard('admin')` |
| `/api/projects/*` | `student` | `auth` → `roleGuard('student')` |
| `/api/databases/*` | `student` | `auth` → `roleGuard('student')` |
| `/api/resource-requests` (student submission) | `student` | `auth` → `roleGuard('student')` |
| `/api/resource-requests` (listing) | `admin` or `student` | `auth` only (controller scopes by role) |
| `/api/resource-requests/:id` (admin review) | `admin` | `auth` → `roleGuard('admin')` |
| `/api/webhooks/github/:projectId` | None (webhook secret validation) | No JWT middleware |

## 5.8 Admin Seed — `seeds/adminSeed.js`

The seed script creates the single fixed admin account on first deployment. It is run once during initial setup and is idempotent — running it again does not create duplicate admin accounts.

### 5.8.1 Seed Logic

1. Read `ADMIN_EMAIL` and `ADMIN_DEFAULT_PASSWORD` from environment variables.
2. Check if a user with `email = ADMIN_EMAIL` already exists in the `users` table.
3. If the user already exists, log a message and exit without changes (idempotent).
4. If the user does not exist, create a new row in `users`:

| Column | Value |
|---|---|
| `email` | Value of `ADMIN_EMAIL` env var |
| `password_hash` | Bcrypt hash of `ADMIN_DEFAULT_PASSWORD` env var (12 salt rounds) |
| `name` | `'Admin'` |
| `role` | `'admin'` |
| `batch_year` | `NULL` |
| `dark_mode` | `0` |
| `cpu_quota` | Value of `DEFAULT_CPU_CORES` env var (default `2.00`) |
| `ram_quota_mb` | Value of `DEFAULT_RAM_MB` env var (default `1024`) |
| `storage_quota_mb` | Value of `DEFAULT_STORAGE_MB` env var (default `2560`) |
| `max_projects` | Value of `DEFAULT_MAX_PROJECTS` env var (default `4`) |
| `max_databases` | Value of `DEFAULT_MAX_DATABASES` env var (default `4`) |
| `must_change_password` | `1` |
| `status` | `'active'` |

5. Log a success message confirming the admin account was created.

### 5.8.2 First Login Enforcement

After the admin logs in with `ADMIN_DEFAULT_PASSWORD`, the backend detects `must_change_password = 1` on the user row. The login response includes a `mustChangePassword: true` flag. The frontend must redirect the admin to a password change screen before allowing access to any other functionality. After the admin sets a new password:

1. `users.password_hash` is updated with the bcrypt hash of the new password.
2. `users.must_change_password` is set to `0`.
3. The `ADMIN_DEFAULT_PASSWORD` environment variable is no longer needed and can be removed from the `.env` file.

## 5.9 Authentication Flows

### 5.9.1 Student Invitation Flow

**Trigger:** Admin submits a list of email addresses (via Excel file upload or comma-separated text input) with an optional batch year label.

**Steps:**

1. Admin submits email addresses to the admin invitation endpoint.
2. For each email address:
   a. Validate the email format.
   b. Check if the email already exists in the `users` table. If it does, skip this email and record it in the "skipped" list returned to the admin.
   c. Insert a new row in `users` with `status = 'invited'`, `password_hash = NULL`, `batch_year` from the admin's input, and default quota values from environment variables.
   d. Generate an invite token JWT using `generateInviteToken(email, batchYear)`.
   e. Compute `SHA256(jwt_string)` and insert a row in `invite_tokens` with `token_hash`, `email`, `batch_year`, `expires_at` (2 hours from now), and `used = 0`.
   f. Send an invitation email to the student containing a registration link: `{FRONTEND_URL}/register?token=<jwt_string>`.
3. Return a response to the admin listing:
   - Successfully invited emails.
   - Skipped emails (already exist in the system) with the reason for skipping.

### 5.9.2 Invite Resend Flow

**Trigger:** Admin initiates a resend for a student whose invite link has expired.

**Steps:**

1. Admin requests resend for a specific email address.
2. Backend finds all existing `invite_tokens` rows for that email where `used = 0`.
3. Delete all matching rows (invalidates the previous token as specified by the spec: "invalidates the previous token before issuing a new one").
4. Generate a new invite token JWT.
5. Compute `SHA256(new_jwt_string)` and insert a new row in `invite_tokens`.
6. Send a new invitation email with the new registration link.

### 5.9.3 Invite Validation Flow

**Trigger:** Student clicks the registration link in their invitation email, which hits `GET /api/auth/invite/validate?token=<jwt_string>`.

**Steps and Responses:**

| Condition | HTTP Status | Response Body |
|---|---|---|
| JWT signature invalid | `400` | `{ "error": "INVITE_INVALID" }` |
| JWT signature valid, but no matching hash in `invite_tokens` (token was invalidated by a resend) | `400` | `{ "error": "INVITE_INVALID" }` |
| Token found, `used = 1` | `400` | `{ "error": "INVITE_ALREADY_USED" }` |
| Token found, `expires_at` has passed, `used = 0` | `410` | `{ "error": "INVITE_EXPIRED", "canResend": true }` |
| Token found, not expired, `used = 0` | `200` | `{ "valid": true, "email": "<email>", "batchYear": <batch_year_or_null> }` |

The `410 Gone` response with `canResend: true` is a spec requirement. The frontend displays a message informing the student that their invite link has expired and instructs them to contact the admin for a new one.

### 5.9.4 Student Registration Flow

**Trigger:** Student submits the registration form (reached via a valid invite link) with their name and password.

**Endpoint:** `POST /api/auth/register`

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `token` | `string` | Yes | The invite token JWT from the registration link URL parameter |
| `name` | `string` | Yes | Student's full name |
| `password` | `string` | Yes | Student's chosen password (8–128 characters) |

**Steps:**

1. Verify the invite token JWT signature using `JWT_INVITE_SECRET`.
2. Compute `SHA256(token)` and look up the hash in `invite_tokens`.
3. Validate: `used = 0`, `expires_at` has not passed.
4. If invalid, return the appropriate error from the table in 5.9.3.
5. Validate the password (8–128 characters). If invalid, return `400` with `PASSWORD_TOO_SHORT` or `PASSWORD_TOO_LONG`.
6. Validate the name is a non-empty string. If invalid, return `400` with `{ "error": "NAME_REQUIRED" }`.
7. Hash the password with bcrypt (12 salt rounds).
8. Update the `users` row matching the invite token's `email`:
   - Set `password_hash` to the bcrypt hash.
   - Set `name` to the submitted name.
   - Set `status` to `'active'`.
9. Mark the invite token as used: set `invite_tokens.used = 1`.
10. Generate an access token and refresh token for the newly registered student.
11. Store the refresh token hash in `refresh_tokens`.
12. Return the access token in the response body and set the refresh token in an `httpOnly` cookie.

**Success response:** `201 Created`

```json
{
  "accessToken": "<jwt_access_token>",
  "user": {
    "id": 42,
    "email": "student@institution.edu",
    "name": "Jane Smith",
    "role": "student"
  }
}
```

### 5.9.5 Login Flow

**Endpoint:** `POST /api/auth/login`

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `email` | `string` | Yes | User email address |
| `password` | `string` | Yes | User password |

**Steps:**

1. Look up the user by email in the `users` table.
2. If no user found, return `401` with `{ "error": "INVALID_CREDENTIALS" }`. Do not reveal whether the email exists.
3. If `users.status` is `invited`, return `401` with `{ "error": "REGISTRATION_INCOMPLETE" }`. The student has not completed registration.
4. If `users.status` is `removed`, return `401` with `{ "error": "ACCOUNT_REMOVED" }`.
5. Compare the submitted password against `users.password_hash` using bcrypt.
6. If the password does not match, return `401` with `{ "error": "INVALID_CREDENTIALS" }`.
7. If the password matches, generate an access token and a refresh token.
8. Store the refresh token hash in `refresh_tokens`.
9. Check `users.must_change_password`. If `1`, include `mustChangePassword: true` in the response.
10. Return the access token in the response body and set the refresh token in an `httpOnly` cookie.

**Success response:** `200 OK`

```json
{
  "accessToken": "<jwt_access_token>",
  "user": {
    "id": 1,
    "email": "admin@institution.edu",
    "name": "Admin",
    "role": "admin",
    "mustChangePassword": true
  }
}
```

When `mustChangePassword` is `true`, the frontend must redirect the user to the password change screen and block all other navigation until the password is changed.

**Error responses:**

| Condition | HTTP Status | Response Body |
|---|---|---|
| Email not found | `401` | `{ "error": "INVALID_CREDENTIALS" }` |
| Status is `invited` | `401` | `{ "error": "REGISTRATION_INCOMPLETE" }` |
| Status is `removed` | `401` | `{ "error": "ACCOUNT_REMOVED" }` |
| Password mismatch | `401` | `{ "error": "INVALID_CREDENTIALS" }` |

**Security note:** `INVALID_CREDENTIALS` is returned for both "email not found" and "password mismatch" to prevent user enumeration. The `REGISTRATION_INCOMPLETE` and `ACCOUNT_REMOVED` errors are returned only when the email matches, which reveals the email exists — this is an acceptable trade-off because the admin already knows which emails they have invited, and removed students should be told their account is no longer active rather than receiving a generic "invalid credentials" message.

### 5.9.6 Token Refresh Flow

**Endpoint:** `POST /api/auth/refresh`

**Authentication:** No `auth.js` middleware (the access token may be expired). The refresh token is read from the `httpOnly` cookie.

**Steps:**

1. Read the refresh token from the `httpOnly` cookie named `refreshToken`.
2. If the cookie is missing, return `401` with `{ "error": "REFRESH_TOKEN_REQUIRED" }`.
3. Verify the refresh token JWT signature using `JWT_REFRESH_SECRET`.
4. If the signature is invalid, return `401` with `{ "error": "REFRESH_TOKEN_INVALID" }`.
5. Compute `SHA256(refresh_token_jwt)` and look up the hash in `refresh_tokens.token_hash`.
6. If not found, return `401` with `{ "error": "REFRESH_TOKEN_INVALID" }`.
7. If `refresh_tokens.revoked = 1`, return `401` with `{ "error": "REFRESH_TOKEN_REVOKED" }`.
8. If `refresh_tokens.expires_at` has passed, return `401` with `{ "error": "REFRESH_TOKEN_EXPIRED" }`.
9. Look up the user by `refresh_tokens.user_id` in the `users` table.
10. If the user's `status` is not `active`, return `401` with `{ "error": "ACCOUNT_INACTIVE" }`.
11. **Token rotation:** Revoke the old refresh token by setting `refresh_tokens.revoked = 1`.
12. Generate a new access token and a new refresh token.
13. Store the new refresh token hash in `refresh_tokens`.
14. Return the new access token in the response body and set the new refresh token in an `httpOnly` cookie (replacing the old one).

**Success response:** `200 OK`

```json
{
  "accessToken": "<new_jwt_access_token>"
}
```

**Error responses:**

| Condition | HTTP Status | Response Body |
|---|---|---|
| Cookie missing | `401` | `{ "error": "REFRESH_TOKEN_REQUIRED" }` |
| JWT signature invalid | `401` | `{ "error": "REFRESH_TOKEN_INVALID" }` |
| Hash not found in `refresh_tokens` | `401` | `{ "error": "REFRESH_TOKEN_INVALID" }` |
| Token revoked | `401` | `{ "error": "REFRESH_TOKEN_REVOKED" }` |
| Token expired | `401` | `{ "error": "REFRESH_TOKEN_EXPIRED" }` |
| User account not active | `401` | `{ "error": "ACCOUNT_INACTIVE" }` |

### 5.9.7 Change Password Flow

**Endpoint:** `PUT /api/auth/password`

**Authentication:** Requires `auth.js` middleware (any authenticated user — admin or student).

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `currentPassword` | `string` | Yes | The user's current password |
| `newPassword` | `string` | Yes | The new password (8–128 characters) |

**Steps:**

1. Look up the user by `req.user.id` in the `users` table.
2. Verify `currentPassword` against `users.password_hash` using bcrypt.
3. If the current password does not match, return `401` with `{ "error": "CURRENT_PASSWORD_INCORRECT" }`.
4. Validate the new password (8–128 characters). If invalid, return `400` with `PASSWORD_TOO_SHORT` or `PASSWORD_TOO_LONG`.
5. Hash the new password with bcrypt (12 salt rounds).
6. Update `users.password_hash` with the new hash.
7. If `users.must_change_password = 1`, set it to `0`.
8. Revoke all refresh tokens for this user **except** the current active session token. To identify the current session token: the request includes the access token (via `auth.js`), but the current refresh token is in the cookie. The backend reads the refresh token from the cookie, computes its hash, and revokes all `refresh_tokens` rows for `user_id` where `token_hash != <current_refresh_token_hash>`.
9. Return `200 OK` with `{ "message": "PASSWORD_CHANGED" }`.

**Error responses:**

| Condition | HTTP Status | Response Body |
|---|---|---|
| Current password incorrect | `401` | `{ "error": "CURRENT_PASSWORD_INCORRECT" }` |
| New password too short | `400` | `{ "error": "PASSWORD_TOO_SHORT" }` |
| New password too long | `400` | `{ "error": "PASSWORD_TOO_LONG" }` |

### 5.9.8 Forgot Password Flow

**Endpoint:** `POST /api/auth/forgot-password`

**Authentication:** None (public endpoint).

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `email` | `string` | Yes | Email address of the account requesting reset |

**Steps:**

1. **Always return `200 OK` regardless of whether the email exists in the system.** This prevents user enumeration.
2. Look up the user by email in the `users` table.
3. If no user found, or user `status` is not `active`, return `200 OK` with `{ "message": "PASSWORD_RESET_EMAIL_SENT" }` without sending an email.
4. If the user exists and is `active`:
   a. Generate a password reset token using `generatePasswordResetToken()` — 32 random bytes, hex-encoded (64 characters).
   b. Compute `SHA256(raw_token)` and insert a row in `password_reset_tokens` with `user_id`, `token_hash`, `expires_at` (1 hour from now), and `used = 0`.
   c. Send a password reset email containing the link: `{FRONTEND_URL}/reset-password?token=<raw_token>`.
5. Return `200 OK` with `{ "message": "PASSWORD_RESET_EMAIL_SENT" }`.

**Response (always):** `200 OK`

```json
{
  "message": "PASSWORD_RESET_EMAIL_SENT"
}
```

### 5.9.9 Reset Password Flow

**Endpoint:** `POST /api/auth/reset-password`

**Authentication:** None (public endpoint; authenticated by the reset token).

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `token` | `string` | Yes | The raw password reset token from the email link |
| `newPassword` | `string` | Yes | The new password (8–128 characters) |

**Steps:**

1. Compute `SHA256(token)` and look up the hash in `password_reset_tokens.token_hash`.
2. If not found, return `400` with `{ "error": "TOKEN_INVALID" }`.
3. If `password_reset_tokens.used = 1`, return `400` with `{ "error": "TOKEN_USED" }`.
4. If `password_reset_tokens.expires_at` has passed, return `400` with `{ "error": "TOKEN_EXPIRED" }`.
5. Validate the new password (8–128 characters). If invalid, return `400` with `PASSWORD_TOO_SHORT` or `PASSWORD_TOO_LONG`.
6. Hash the new password with bcrypt (12 salt rounds).
7. Update `users.password_hash` for the user identified by `password_reset_tokens.user_id`.
8. Mark the token as used: set `password_reset_tokens.used = 1`.
9. Revoke **all** refresh tokens for this user (set `revoked = 1` for all `refresh_tokens` rows matching `user_id`). This logs the user out of all sessions.
10. Return `200 OK` with `{ "message": "PASSWORD_RESET_SUCCESSFUL" }`.

**Error responses:**

| Condition | HTTP Status | Response Body |
|---|---|---|
| Token hash not found | `400` | `{ "error": "TOKEN_INVALID" }` |
| Token already used | `400` | `{ "error": "TOKEN_USED" }` |
| Token expired | `400` | `{ "error": "TOKEN_EXPIRED" }` |
| New password too short | `400` | `{ "error": "PASSWORD_TOO_SHORT" }` |
| New password too long | `400` | `{ "error": "PASSWORD_TOO_LONG" }` |

### 5.9.10 Logout Flow

**Endpoint:** `POST /api/auth/logout`

**Authentication:** Requires `auth.js` middleware.

**Steps:**

1. Read the refresh token from the `httpOnly` cookie named `refreshToken`.
2. If the cookie is present, compute `SHA256(refresh_token_jwt)` and find the matching row in `refresh_tokens`.
3. If found, set `refresh_tokens.revoked = 1`.
4. Clear the `refreshToken` cookie by setting it with an expired date.
5. Return `200 OK` with `{ "message": "LOGGED_OUT" }`.

## 5.10 Refresh Token Cookie Configuration

The refresh token is stored in an `httpOnly` cookie with the following attributes:

| Attribute | Value | Purpose |
|---|---|---|
| Name | `refreshToken` | Cookie name |
| Value | The full refresh token JWT string | Token value |
| `httpOnly` | `true` | Prevents JavaScript access (XSS protection) |
| `Secure` | `true` | Cookie sent only over HTTPS (production: Cloudflare SSL; development: browsers typically send `Secure` cookies to `localhost`) |
| `SameSite` | `Strict` | Prevents the cookie from being sent on cross-site requests (CSRF protection); the frontend is a React SPA that explicitly calls `/api/auth/refresh` on page load — no navigation-based cookie sending is needed, so `Strict` is the correct choice |
| `Path` | `/api/auth` | Cookie is sent only for auth-related API endpoints (login, refresh, logout, change password); scoped to minimize unnecessary cookie transmission and reduce attack surface |
| `Max-Age` | `604800` (7 days in seconds) | Matches `REFRESH_TOKEN_EXPIRY` |

## 5.11 Database Password Encryption

Student database passwords (stored in `databases.db_password_encrypted`) are encrypted at rest using AES-256 encryption. This is distinct from password hashing — hashing is one-way (used for user passwords), while encryption is reversible (the backend must decrypt database passwords to inject them into student containers as `DB_PASSWORD` environment variables).

| Parameter | Value |
|---|---|
| Algorithm | AES-256-CBC |
| Key | `DB_ENCRYPTION_KEY` environment variable (exactly 32 characters / 256 bits) |
| IV (Initialization Vector) | 16 cryptographically random bytes, generated per encryption operation |
| Storage format | `<hex_iv>:<hex_ciphertext>` stored in `databases.db_password_encrypted` (`VARCHAR(512)`) |
| Decryption | Split on `:`, extract IV and ciphertext, decrypt using `DB_ENCRYPTION_KEY` |

### 5.11.1 Encryption Function

```javascript
const crypto = require('crypto');

function encryptPassword(plaintext, encryptionKey) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(encryptionKey, 'utf8'), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}
```

### 5.11.2 Decryption Function

```javascript
function decryptPassword(encryptedValue, encryptionKey) {
  const [ivHex, encryptedHex] = encryptedValue.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(encryptionKey, 'utf8'), iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

These functions are used by `services/databaseProvisioningService.js` (encrypt during database creation) and `services/dockerService.js` (decrypt when injecting `DB_PASSWORD` into student containers).

## 5.12 Token Revocation Scenarios

This table summarizes all scenarios in which tokens are revoked, and the scope of revocation.

| Event | Token Type Revoked | Scope | Implemented In |
|---|---|---|---|
| Token refresh (`POST /api/auth/refresh`) | Refresh token | The single old refresh token being rotated (set `revoked = 1`) | `controllers/authController.js` |
| Password change (`PUT /api/auth/password`) | Refresh tokens | All refresh tokens for the user **except** the current session token | `controllers/authController.js` |
| Password reset (`POST /api/auth/reset-password`) | Refresh tokens | **All** refresh tokens for the user (no exceptions) | `controllers/authController.js` |
| Logout (`POST /api/auth/logout`) | Refresh token | The single current refresh token (set `revoked = 1`) | `controllers/authController.js` |
| Admin removes student | Refresh tokens | All refresh tokens for the removed user (handled by `ON DELETE CASCADE` when the user row is deleted) | `controllers/adminController.js` |
| Admin resends invite | Invite tokens | All unused invite tokens for the email (rows are deleted from `invite_tokens`) | `controllers/adminController.js` |

## 5.13 Token Cleanup

Expired and revoked tokens accumulate in the `refresh_tokens`, `invite_tokens`, and `password_reset_tokens` tables over time. A periodic cleanup task removes stale rows.

| Table | Cleanup Condition | Frequency |
|---|---|---|
| `refresh_tokens` | `expires_at < NOW()` OR `revoked = 1` | Daily |
| `invite_tokens` | `expires_at < NOW()` | Daily |
| `password_reset_tokens` | `expires_at < NOW()` OR `used = 1` | Daily |

The specific implementation mechanism (cron job or `setInterval` within the backend process) is deferred to the code phase; the requirement is that stale tokens do not accumulate indefinitely.

## 5.14 Security Considerations Summary

| Security Measure | Implementation |
|---|---|
| Passwords hashed with bcrypt (12 salt rounds) | `users.password_hash` column; never stored in plaintext |
| Tokens stored as SHA-256 hashes on the server | `refresh_tokens.token_hash`, `invite_tokens.token_hash`, `password_reset_tokens.token_hash`; raw tokens never persisted |
| Access tokens in memory only | Frontend stores in JavaScript variable/React state; never in `localStorage` or cookies; lost on page refresh (frontend calls `/api/auth/refresh` on page load to restore) |
| Refresh tokens in `httpOnly` cookie | Prevents XSS-based theft; `Secure` and `SameSite=Strict` flags set |
| Refresh token rotation on every refresh | Old token revoked, new token issued; limits window of exposure for stolen tokens |
| User enumeration prevention on forgot-password | `POST /api/auth/forgot-password` always returns `200 OK` regardless of email existence |
| Invite token invalidation on resend | Previous tokens deleted before new token issued |
| Forced password change for admin on first login | `must_change_password = 1` set during seed |
| Database passwords encrypted at rest | AES-256-CBC with per-operation random IV; `DB_ENCRYPTION_KEY` in `.env` |
| `.env` file permissions | `chmod 600` on production VM (owner read/write only) |
| JWT secrets minimum length | Minimum 32 characters recommended (enforced at startup by variable validation in Section 3.6) |
| Password validation | Minimum 8 characters, maximum 128 characters |
| Separate JWT secrets per token type | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_INVITE_SECRET` are three distinct secrets; compromise of one does not affect the others |
| SSE endpoint auth via query parameter | `auth.js` checks `Authorization` header first, then `token` query parameter as fallback for SSE endpoints; token is short-lived (15 min) |
| All frontend page links use `FRONTEND_URL` | Both invite registration and password reset links use `FRONTEND_URL`, not `PLATFORM_URL`, ensuring correct routing in both development and production |

## 5.15 Ambiguity Decisions Registry

| # | Ambiguity | Decision | Rationale |
|---|---|---|---|
| 1 | Spec does not specify bcrypt salt rounds | 12 salt rounds | Industry standard balancing security and performance |
| 2 | Spec does not define password length limits beyond "minimum 8 characters recommended" for admin seed | Minimum 8 characters, maximum 128 characters, no complexity requirements | Aligns with Section 3.2.9; 128-character max prevents bcrypt truncation issues; follows NIST SP 800-63B guidance against composition rules |
| 3 | Spec does not specify client-side token storage strategy | Access tokens in JavaScript memory; refresh tokens in `httpOnly`/`Secure`/`SameSite=Strict` cookie | Prevents XSS and CSRF attacks; industry best practice for JWT-based auth |
| 4 | Spec does not define admin `name` value during seed | `name = 'Admin'` | Ensures consistency with active accounts; admin can change later |
| 5 | Spec does not state whether login returns specific errors for `invited`/`removed` status or a generic `INVALID_CREDENTIALS` | Specific error codes `REGISTRATION_INCOMPLETE` and `ACCOUNT_REMOVED` | Admin already knows invited emails; specific messages improve UX |
| 6 | Spec does not mention a logout endpoint | Added `POST /api/auth/logout` | Fundamental authentication requirement; without it, refresh token cannot be properly revoked |
| 7 | Spec does not specify AES mode for database password encryption | AES-256-CBC with random 16-byte IV stored as `<hex_iv>:<hex_ciphertext>` | CBC is widely supported; random IV per operation ensures identical passwords produce different ciphertexts |
| 8 | Spec does not specify refresh token cookie `Path` attribute | `Path = /api/auth` | Scopes cookie to auth endpoints only; reduces unnecessary cookie transmission |
| 9 | Spec does not define a token cleanup schedule | Daily cleanup of expired/revoked/used tokens | Prevents unbounded table growth |