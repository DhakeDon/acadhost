# Section 4 — Database Schema

## 4.1 Overview

All platform data is stored in a single MySQL database on the host MySQL server. The database name is configured via the `MYSQL_DATABASE` environment variable (default: `acadhost`). The backend connects using `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, and `MYSQL_PASSWORD` from the `.env` file (defined in Section 3.2.2).

This schema stores platform metadata only. Student application databases are separate schemas created by `databaseProvisioningService.js` with restricted credentials — they are not defined here.

The schema consists of eight tables:

| Table | Model File (Section 2.3) | Purpose |
|---|---|---|
| `users` | `models/User.js` | Students and admin account |
| `projects` | `models/Project.js` | Deployed student projects |
| `databases` | `models/Database.js` | Student-provisioned MySQL databases |
| `resource_requests` | `models/ResourceRequest.js` | Student requests for quota increases |
| `refresh_tokens` | (managed within `utils/tokenHelper.js`) | JWT refresh token tracking and revocation |
| `invite_tokens` | (managed within `controllers/authController.js`) | Time-limited registration invite links |
| `builds` | (managed within `services/buildService.js`) | Build history and log file references per project |
| `password_reset_tokens` | (managed within `controllers/authController.js`) | Time-limited password reset tokens |

## 4.2 Table Definitions

### 4.2.1 `users`

Stores both student accounts and the single admin account. The `role` column distinguishes between them.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| `id` | `INT UNSIGNED` | No | Auto-increment | `PRIMARY KEY`, `AUTO_INCREMENT` | Unique user identifier |
| `email` | `VARCHAR(255)` | No | — | `UNIQUE`, `NOT NULL` | User email address; used for login |
| `password_hash` | `VARCHAR(255)` | Yes | `NULL` | — | Bcrypt-hashed password; `NULL` for invited-but-not-yet-registered students |
| `name` | `VARCHAR(255)` | Yes | `NULL` | — | Student's full name; set during registration; admin name set during seed |
| `role` | `ENUM('admin', 'student')` | No | `'student'` | `NOT NULL` | Account role |
| `batch_year` | `SMALLINT UNSIGNED` | Yes | `NULL` | — | Enrollment year label (e.g., `2022`, `2023`); `NULL` for admin; used for batch removal |
| `dark_mode` | `TINYINT(1)` | No | `0` | `NOT NULL` | Dark mode preference; `0` = light mode (default), `1` = dark mode |
| `cpu_quota` | `DECIMAL(5,2)` | No | Value of `DEFAULT_CPU_CORES` env var | `NOT NULL` | Total CPU cores allocated to this student |
| `ram_quota_mb` | `INT UNSIGNED` | No | Value of `DEFAULT_RAM_MB` env var | `NOT NULL` | Total RAM in MB allocated to this student |
| `storage_quota_mb` | `INT UNSIGNED` | No | Value of `DEFAULT_STORAGE_MB` env var | `NOT NULL` | Total storage in MB allocated to this student |
| `max_projects` | `INT UNSIGNED` | No | Value of `DEFAULT_MAX_PROJECTS` env var | `NOT NULL` | Maximum number of projects this student can create |
| `max_databases` | `INT UNSIGNED` | No | Value of `DEFAULT_MAX_DATABASES` env var | `NOT NULL` | Maximum number of databases this student can create |
| `must_change_password` | `TINYINT(1)` | No | `0` | `NOT NULL` | `1` forces password change on next login; set to `1` for admin on seed |
| `status` | `ENUM('invited', 'active', 'removed')` | No | `'invited'` | `NOT NULL` | Account status; `invited` = invite sent but not yet registered; `active` = registered and usable; `removed` = removed by admin |
| `created_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | `NOT NULL` | Record creation time |
| `updated_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` | `NOT NULL` | Last modification time |

**Indexes:**

| Index Name | Columns | Type | Purpose |
|---|---|---|---|
| `PRIMARY` | `id` | Primary Key | Row identifier |
| `uq_users_email` | `email` | Unique | Prevents duplicate email addresses |
| `idx_users_role` | `role` | Non-unique | Filter by role (admin vs. student) |
| `idx_users_batch_year` | `batch_year` | Non-unique | Batch removal by enrollment year |
| `idx_users_status` | `status` | Non-unique | Filter by account status |

**SQL:**

```sql
CREATE TABLE `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `password_hash` VARCHAR(255) NULL DEFAULT NULL,
  `name` VARCHAR(255) NULL DEFAULT NULL,
  `role` ENUM('admin', 'student') NOT NULL DEFAULT 'student',
  `batch_year` SMALLINT UNSIGNED NULL DEFAULT NULL,
  `dark_mode` TINYINT(1) NOT NULL DEFAULT 0,
  `cpu_quota` DECIMAL(5,2) NOT NULL DEFAULT 2.00,
  `ram_quota_mb` INT UNSIGNED NOT NULL DEFAULT 1024,
  `storage_quota_mb` INT UNSIGNED NOT NULL DEFAULT 2560,
  `max_projects` INT UNSIGNED NOT NULL DEFAULT 4,
  `max_databases` INT UNSIGNED NOT NULL DEFAULT 4,
  `must_change_password` TINYINT(1) NOT NULL DEFAULT 0,
  `status` ENUM('invited', 'active', 'removed') NOT NULL DEFAULT 'invited',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_users_role` (`role`),
  KEY `idx_users_batch_year` (`batch_year`),
  KEY `idx_users_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Notes on `users` table:**

- The admin account is seeded into this table by `seeds/adminSeed.js` with `role = 'admin'`, `status = 'active'`, `must_change_password = 1`, and `ADMIN_EMAIL` / `ADMIN_DEFAULT_PASSWORD` from environment variables.
- Quota columns (`cpu_quota`, `ram_quota_mb`, `storage_quota_mb`, `max_projects`, `max_databases`) are per-student limits. The admin can adjust them individually via the admin dashboard. For the admin row these columns are not enforced but are still populated with defaults.
- `password_hash` is `NULL` for students who have been invited but have not yet completed registration (status = `invited`).
- `batch_year` is `NULL` for the admin account. For students it is set when the admin invites them with a batch year label.
- `cpu_quota` uses `DECIMAL(5,2)` to allow fractional core allocations (e.g., `0.50` cores) if the admin adjusts quotas to sub-core values. Docker `--cpus` accepts decimal values. The default is `2.00` (whole cores) per the spec, but the schema allows finer-grained allocation if the admin chooses.

---

### 4.2.2 `projects`

Stores metadata for every student project. Each project has a unique subdomain and an assigned container port.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| `id` | `INT UNSIGNED` | No | Auto-increment | `PRIMARY KEY`, `AUTO_INCREMENT` | Unique project identifier |
| `user_id` | `INT UNSIGNED` | No | — | `NOT NULL`, `FOREIGN KEY → users(id)` | Owning student |
| `title` | `VARCHAR(255)` | No | — | `NOT NULL` | Project display title |
| `subdomain` | `VARCHAR(63)` | No | — | `UNIQUE`, `NOT NULL` | Subdomain under `*.acadhost.com`; validated against reserved list and existing projects |
| `project_type` | `ENUM('frontend', 'backend', 'combined')` | No | — | `NOT NULL` | Frontend only, backend only, or frontend + backend |
| `runtime` | `ENUM('node', 'python')` | Yes | `NULL` | — | Detected or selected runtime; `NULL` for frontend-only projects (no server runtime) |
| `runtime_version` | `VARCHAR(10)` | Yes | `NULL` | — | Selected runtime version (e.g., `18`, `20`, `22`, `23` for Node.js; `3.10`, `3.11`, `3.12`, `3.13` for Python); `NULL` for frontend-only projects |
| `source_type` | `ENUM('git', 'zip')` | No | — | `NOT NULL` | How source code was provided |
| `git_url` | `VARCHAR(2048)` | Yes | `NULL` | — | Git repository URL; `NULL` if `source_type = 'zip'` |
| `git_url_backend` | `VARCHAR(2048)` | Yes | `NULL` | — | Second Git repository URL for combined projects (backend repo); `NULL` for non-combined projects or if `source_type = 'zip'` |
| `webhook_secret` | `VARCHAR(255)` | Yes | `NULL` | — | Secret for validating GitHub webhook payloads; `NULL` if `source_type = 'zip'` |
| `webhook_secret_backend` | `VARCHAR(255)` | Yes | `NULL` | — | Webhook secret for the backend repo in combined projects; `NULL` for non-combined or ZIP projects |
| `container_id` | `VARCHAR(64)` | Yes | `NULL` | — | Docker container ID; `NULL` if container is not running or has been removed |
| `container_port` | `INT UNSIGNED` | Yes | `NULL` | — | Assigned port from the container port pool (10,000 – 20,000); `NULL` before first deployment or after deletion |
| `cpu_limit` | `DECIMAL(5,2)` | No | — | `NOT NULL` | CPU core limit for this project's container |
| `ram_limit_mb` | `INT UNSIGNED` | No | — | `NOT NULL` | RAM limit in MB for this project's container |
| `database_id` | `INT UNSIGNED` | Yes | `NULL` | `FOREIGN KEY → databases(id) ON DELETE SET NULL` | Attached database; `NULL` if no database is attached |
| `status` | `ENUM('building', 'running', 'stopped', 'failed', 'deleted')` | No | `'building'` | `NOT NULL` | Current project lifecycle status |
| `created_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | `NOT NULL` | Record creation time |
| `updated_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` | `NOT NULL` | Last modification time |

**Indexes:**

| Index Name | Columns | Type | Purpose |
|---|---|---|---|
| `PRIMARY` | `id` | Primary Key | Row identifier |
| `uq_projects_subdomain` | `subdomain` | Unique | Prevents duplicate subdomains |
| `idx_projects_user_id` | `user_id` | Non-unique | List all projects for a student |
| `idx_projects_status` | `status` | Non-unique | Filter projects by lifecycle status |
| `idx_projects_database_id` | `database_id` | Non-unique | Find projects attached to a specific database |
| `uq_projects_container_port` | `container_port` | Unique (allows NULLs) | Prevents port collisions; MySQL unique indexes allow multiple NULLs |

**SQL:**

```sql
CREATE TABLE `projects` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `subdomain` VARCHAR(63) NOT NULL,
  `project_type` ENUM('frontend', 'backend', 'combined') NOT NULL,
  `runtime` ENUM('node', 'python') NULL DEFAULT NULL,
  `runtime_version` VARCHAR(10) NULL DEFAULT NULL,
  `source_type` ENUM('git', 'zip') NOT NULL,
  `git_url` VARCHAR(2048) NULL DEFAULT NULL,
  `git_url_backend` VARCHAR(2048) NULL DEFAULT NULL,
  `webhook_secret` VARCHAR(255) NULL DEFAULT NULL,
  `webhook_secret_backend` VARCHAR(255) NULL DEFAULT NULL,
  `container_id` VARCHAR(64) NULL DEFAULT NULL,
  `container_port` INT UNSIGNED NULL DEFAULT NULL,
  `cpu_limit` DECIMAL(5,2) NOT NULL,
  `ram_limit_mb` INT UNSIGNED NOT NULL,
  `database_id` INT UNSIGNED NULL DEFAULT NULL,
  `status` ENUM('building', 'running', 'stopped', 'failed', 'deleted') NOT NULL DEFAULT 'building',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_projects_subdomain` (`subdomain`),
  UNIQUE KEY `uq_projects_container_port` (`container_port`),
  KEY `idx_projects_user_id` (`user_id`),
  KEY `idx_projects_status` (`status`),
  KEY `idx_projects_database_id` (`database_id`),
  CONSTRAINT `fk_projects_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_projects_database_id` FOREIGN KEY (`database_id`) REFERENCES `databases` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Notes on `projects` table:**

- `runtime` is `NULL` for frontend-only projects because static sites do not require a server runtime. For backend-only and combined projects, `runtime` is auto-detected from `package.json` (Node.js) or `requirements.txt` (Python) as defined in Section 1.12.
- `runtime_version` stores the version string selected by the student. Valid values for Node.js: `18`, `20`, `22`, `23`. Valid values for Python: `3.10`, `3.11`, `3.12`, `3.13`.
- Combined projects can have two Git URLs (`git_url` for the frontend repo, `git_url_backend` for the backend repo) or two ZIP files. If `source_type = 'zip'`, both `git_url` and `git_url_backend` are `NULL` — the ZIP files are stored on disk under `source/frontend/` and `source/backend/` as defined in Section 2.6.
- Mixing source types (one Git + one ZIP) is not allowed. The `source_type` column is a single value (`git` or `zip`) that applies to both sources in a combined project.
- `webhook_secret` and `webhook_secret_backend` are populated only when `source_type = 'git'`. For combined projects with two Git repos, each repo has its own webhook secret. For non-combined Git projects, only `webhook_secret` is used.
- `container_port` is allocated from the pool defined by `CONTAINER_PORT_RANGE_START` (10,000) to `CONTAINER_PORT_RANGE_END` (20,000). The unique index prevents port collisions. MySQL allows multiple `NULL` values in a unique index, so projects without a port (pre-deployment or deleted) do not conflict.
- `container_port` must be set to `NULL` when a project is deleted to return the port to the pool.
- `database_id` uses `ON DELETE SET NULL` so that if a database record is removed, the project is not deleted — it simply loses its database attachment.
- `ON DELETE CASCADE` on `user_id` ensures all projects are removed when a student is deleted.
- `status = 'deleted'` is a soft-delete. The row is retained for audit purposes. The container and source files are cleaned up on disk, but the metadata row persists.
- The random subdomain generation logic (offered when a requested subdomain is taken) is application-level, handled by `utils/subdomainValidator.js`. The schema only enforces uniqueness via the `uq_projects_subdomain` index. The generation format is defined in Section 12 (Business Logic & Edge Cases).
- All project types — frontend, backend, and combined — are deployed as Docker containers. `container_id` and `container_port` are populated for all project types after successful deployment. There is no project type that skips container creation or runs without an assigned port. The `NULL` state for these columns applies only to pre-deployment (status = `building` or `failed`) and post-deletion (status = `deleted`) states, never based on project type.

---

### 4.2.3 `databases`

Stores metadata for student-provisioned MySQL databases. Each row represents a separate MySQL schema created on the host MySQL server with restricted credentials.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| `id` | `INT UNSIGNED` | No | Auto-increment | `PRIMARY KEY`, `AUTO_INCREMENT` | Unique database record identifier |
| `user_id` | `INT UNSIGNED` | No | — | `NOT NULL`, `FOREIGN KEY → users(id)` | Owning student |
| `db_name` | `VARCHAR(64)` | No | — | `NOT NULL` | MySQL schema name; unique per student (validated at application level) |
| `db_user` | `VARCHAR(32)` | No | — | `UNIQUE`, `NOT NULL` | Restricted MySQL username created for this database; globally unique across all students |
| `db_password_encrypted` | `VARCHAR(512)` | No | — | `NOT NULL` | Encrypted password for the restricted MySQL user; encrypted at rest using AES-256 with `DB_ENCRYPTION_KEY`; decrypted by the backend when injecting `DB_PASSWORD` into containers |
| `created_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | `NOT NULL` | Record creation time |

**Indexes:**

| Index Name | Columns | Type | Purpose |
|---|---|---|---|
| `PRIMARY` | `id` | Primary Key | Row identifier |
| `uq_databases_db_user` | `db_user` | Unique | Prevents duplicate MySQL usernames |
| `idx_databases_user_id` | `user_id` | Non-unique | List all databases for a student |
| `uq_databases_user_db_name` | `user_id`, `db_name` | Unique (composite) | Prevents a student from creating two databases with the same name |

**SQL:**

```sql
CREATE TABLE `databases` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `db_name` VARCHAR(64) NOT NULL,
  `db_user` VARCHAR(32) NOT NULL,
  `db_password_encrypted` VARCHAR(512) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_databases_db_user` (`db_user`),
  UNIQUE KEY `uq_databases_user_db_name` (`user_id`, `db_name`),
  KEY `idx_databases_user_id` (`user_id`),
  CONSTRAINT `fk_databases_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Notes on `databases` table:**

- `db_name` uniqueness is enforced per student via the composite unique index `uq_databases_user_db_name`. The spec states "the platform validates that the name does not duplicate any of the student's existing databases." Two different students may have databases with the same name — they will have different MySQL schemas because the actual MySQL schema name is prefixed (e.g., `s{user_id}_{db_name}`). The naming convention is defined in Section 9 (Database Provisioning Flow).
- `db_user` is globally unique because MySQL usernames are server-wide. The format is defined in Section 9.
- `db_password_encrypted` stores the password encrypted at rest using AES-256 with the `DB_ENCRYPTION_KEY` environment variable. The backend decrypts it when injecting `DB_PASSWORD` into a student container.
- `ON DELETE CASCADE` on `user_id` ensures all database records are removed when a student is deleted. The corresponding MySQL schemas and users are cleaned up by application logic in `databaseProvisioningService.js`.

---

### 4.2.4 `resource_requests`

Stores student requests for resource quota increases, reviewed by the admin.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| `id` | `INT UNSIGNED` | No | Auto-increment | `PRIMARY KEY`, `AUTO_INCREMENT` | Unique request identifier |
| `user_id` | `INT UNSIGNED` | No | — | `NOT NULL`, `FOREIGN KEY → users(id)` | Requesting student |
| `resource_type` | `ENUM('cpu', 'ram', 'storage', 'projects', 'databases')` | No | — | `NOT NULL` | Which resource the student wants increased |
| `requested_value` | `VARCHAR(50)` | No | — | `NOT NULL` | The value the student is requesting (e.g., `4` for 4 cores, `2048` for 2048 MB RAM, `5120` for 5 GB storage, `6` for 6 projects, `6` for 6 databases) |
| `description` | `TEXT` | No | — | `NOT NULL` | Student's justification for the request |
| `status` | `ENUM('pending', 'approved', 'denied')` | No | `'pending'` | `NOT NULL` | Current request status |
| `admin_notes` | `TEXT` | Yes | `NULL` | — | Admin's response or notes when acting on the request |
| `reviewed_at` | `TIMESTAMP` | Yes | `NULL` | — | Timestamp when the admin acted on the request |
| `created_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | `NOT NULL` | Request submission time |
| `updated_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` | `NOT NULL` | Last modification time |

**Indexes:**

| Index Name | Columns | Type | Purpose |
|---|---|---|---|
| `PRIMARY` | `id` | Primary Key | Row identifier |
| `idx_resource_requests_user_id` | `user_id` | Non-unique | List all requests for a student |
| `idx_resource_requests_status` | `status` | Non-unique | Filter by pending/approved/denied |

**SQL:**

```sql
CREATE TABLE `resource_requests` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `resource_type` ENUM('cpu', 'ram', 'storage', 'projects', 'databases') NOT NULL,
  `requested_value` VARCHAR(50) NOT NULL,
  `description` TEXT NOT NULL,
  `status` ENUM('pending', 'approved', 'denied') NOT NULL DEFAULT 'pending',
  `admin_notes` TEXT NULL DEFAULT NULL,
  `reviewed_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_resource_requests_user_id` (`user_id`),
  KEY `idx_resource_requests_status` (`status`),
  CONSTRAINT `fk_resource_requests_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Notes on `resource_requests` table:**

- `resource_type` enum values map directly to the spec: "CPU, RAM, storage, databases, or projects."
- `requested_value` is stored as `VARCHAR(50)` rather than a numeric type because different resource types use different units (cores, MB, count). The application layer parses and validates the value based on `resource_type`.
- `ON DELETE CASCADE` on `user_id` removes all requests when a student is deleted.
- `admin_notes` and `reviewed_at` are populated when the admin acts on the request.

---

### 4.2.5 `refresh_tokens`

Stores hashed refresh tokens for JWT authentication. Used to validate refresh requests and support token revocation.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| `id` | `INT UNSIGNED` | No | Auto-increment | `PRIMARY KEY`, `AUTO_INCREMENT` | Unique token record identifier |
| `user_id` | `INT UNSIGNED` | No | — | `NOT NULL`, `FOREIGN KEY → users(id)` | User who owns this refresh token |
| `token_hash` | `VARCHAR(255)` | No | — | `UNIQUE`, `NOT NULL` | SHA-256 hash of the refresh token; the raw token is never stored |
| `expires_at` | `TIMESTAMP` | No | — | `NOT NULL` | Token expiry time (7 days from issuance per `REFRESH_TOKEN_EXPIRY`) |
| `revoked` | `TINYINT(1)` | No | `0` | `NOT NULL` | `0` = active, `1` = revoked (e.g., on logout, password change, or token rotation) |
| `created_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | `NOT NULL` | Token issuance time |

**Indexes:**

| Index Name | Columns | Type | Purpose |
|---|---|---|---|
| `PRIMARY` | `id` | Primary Key | Row identifier |
| `uq_refresh_tokens_token_hash` | `token_hash` | Unique | Fast lookup by token hash during refresh |
| `idx_refresh_tokens_user_id` | `user_id` | Non-unique | Revoke all tokens for a user (e.g., on password change or reset) |
| `idx_refresh_tokens_expires_at` | `expires_at` | Non-unique | Periodic cleanup of expired tokens |

**SQL:**

```sql
CREATE TABLE `refresh_tokens` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `expires_at` TIMESTAMP NOT NULL,
  `revoked` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_refresh_tokens_token_hash` (`token_hash`),
  KEY `idx_refresh_tokens_user_id` (`user_id`),
  KEY `idx_refresh_tokens_expires_at` (`expires_at`),
  CONSTRAINT `fk_refresh_tokens_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Notes on `refresh_tokens` table:**

- Refresh tokens are stored as SHA-256 hashes, not raw values. The raw token is returned to the client and never persisted on the server.
- `ON DELETE CASCADE` on `user_id` removes all tokens when a user is deleted.
- Expired and revoked tokens should be periodically cleaned up via a scheduled task.
- On token refresh, the old token is revoked and a new one is issued (token rotation).
- On password change (`PUT /api/auth/password`), all refresh tokens for the user are revoked except the current active session token.
- On password reset (`POST /api/auth/reset-password`), all refresh tokens for the user are revoked.

---

### 4.2.6 `invite_tokens`

Stores time-limited invitation tokens sent to students by the admin. Each token corresponds to a registration link.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| `id` | `INT UNSIGNED` | No | Auto-increment | `PRIMARY KEY`, `AUTO_INCREMENT` | Unique invite record identifier |
| `email` | `VARCHAR(255)` | No | — | `NOT NULL` | Email address the invitation was sent to |
| `token_hash` | `VARCHAR(255)` | No | — | `UNIQUE`, `NOT NULL` | SHA-256 hash of the invite token |
| `batch_year` | `SMALLINT UNSIGNED` | Yes | `NULL` | — | Batch year label assigned by the admin during invitation |
| `expires_at` | `TIMESTAMP` | No | — | `NOT NULL` | Token expiry time (2 hours from issuance per `INVITE_TOKEN_EXPIRY`) |
| `used` | `TINYINT(1)` | No | `0` | `NOT NULL` | `0` = unused, `1` = student has registered using this token |
| `created_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | `NOT NULL` | Token issuance time |

**Indexes:**

| Index Name | Columns | Type | Purpose |
|---|---|---|---|
| `PRIMARY` | `id` | Primary Key | Row identifier |
| `uq_invite_tokens_token_hash` | `token_hash` | Unique | Fast lookup by token hash during registration |
| `idx_invite_tokens_email` | `email` | Non-unique | Find all invites for a specific email (supports resend logic) |
| `idx_invite_tokens_expires_at` | `expires_at` | Non-unique | Periodic cleanup of expired tokens |

**SQL:**

```sql
CREATE TABLE `invite_tokens` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `batch_year` SMALLINT UNSIGNED NULL DEFAULT NULL,
  `expires_at` TIMESTAMP NOT NULL,
  `used` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_invite_tokens_token_hash` (`token_hash`),
  KEY `idx_invite_tokens_email` (`email`),
  KEY `idx_invite_tokens_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Notes on `invite_tokens` table:**

- The `email` column is not unique because a student can be re-invited (admin resends invitation). When the admin resends, the previous token is invalidated (its row is deleted or marked) and a new row is inserted. The spec states: "the admin to resend the invitation, which invalidates the previous token before issuing a new one."
- `batch_year` is carried from the invite token to the `users` table when the student registers, so the batch year label persists on the student's account.
- Invite tokens are stored as SHA-256 hashes, not raw values. The raw token is sent in the invitation email link.
- When an expired invite link is accessed, the platform returns a `410 Gone` response with a `canResend: true` flag (spec requirement). The `expires_at` and `used` columns are checked to determine this response.
- `invite_tokens` does not have a foreign key to `users` because the user row (with `status = 'invited'`) is created when the invitation is sent, but the invite token is a separate entity. The link between them is the `email` column.

---

### 4.2.7 `builds`

Stores build history for each project. Each build attempt creates one row. Build log files are stored on disk (Section 2.6); this table stores metadata and file references.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| `id` | `INT UNSIGNED` | No | Auto-increment | `PRIMARY KEY`, `AUTO_INCREMENT` | Unique build record identifier |
| `project_id` | `INT UNSIGNED` | No | — | `NOT NULL`, `FOREIGN KEY → projects(id)` | Project being built |
| `status` | `ENUM('building', 'success', 'failed', 'timeout')` | No | `'building'` | `NOT NULL` | Build outcome |
| `log_file_path` | `VARCHAR(512)` | No | — | `NOT NULL` | Relative path to the build log file under `{PROJECTS_BASE_DIR}/{student_id}/{project_id}/build/logs/{build_timestamp}.log` |
| `started_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | `NOT NULL` | Build start time |
| `completed_at` | `TIMESTAMP` | Yes | `NULL` | — | Build completion time; `NULL` while build is in progress |

**Indexes:**

| Index Name | Columns | Type | Purpose |
|---|---|---|---|
| `PRIMARY` | `id` | Primary Key | Row identifier |
| `idx_builds_project_id` | `project_id` | Non-unique | List all builds for a project |
| `idx_builds_started_at` | `started_at` | Non-unique | Build log retention cleanup (7-day retention) |

**SQL:**

```sql
CREATE TABLE `builds` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` INT UNSIGNED NOT NULL,
  `status` ENUM('building', 'success', 'failed', 'timeout') NOT NULL DEFAULT 'building',
  `log_file_path` VARCHAR(512) NOT NULL,
  `started_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_builds_project_id` (`project_id`),
  KEY `idx_builds_started_at` (`started_at`),
  CONSTRAINT `fk_builds_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Notes on `builds` table:**

- Build log files are stored on disk at `{PROJECTS_BASE_DIR}/{student_id}/{project_id}/build/logs/{build_timestamp}.log` as defined in Section 2.6. This table stores the relative file path for retrieval.
- `status = 'timeout'` is set when a build exceeds `BUILD_TIMEOUT_MINUTES` (default 10 minutes).
- Build log retention is 7 days (`BUILD_LOG_RETENTION_DAYS`). A periodic cleanup task deletes both the log file on disk and the corresponding `builds` row.
- `ON DELETE CASCADE` on `project_id` removes all build records when a project is deleted.

---

### 4.2.8 `password_reset_tokens`

Stores time-limited password reset tokens. Each token corresponds to a forgot-password request.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| `id` | `INT UNSIGNED` | No | Auto-increment | `PRIMARY KEY`, `AUTO_INCREMENT` | Unique reset token record identifier |
| `user_id` | `INT UNSIGNED` | No | — | `NOT NULL`, `FOREIGN KEY → users(id)` | User requesting the password reset |
| `token_hash` | `VARCHAR(255)` | No | — | `UNIQUE`, `NOT NULL` | SHA-256 hash of the reset token; raw token sent in email link |
| `expires_at` | `TIMESTAMP` | No | — | `NOT NULL` | Token expiry time (1 hour from issuance per `PASSWORD_RESET_TOKEN_EXPIRY_HOURS`) |
| `used` | `TINYINT(1)` | No | `0` | `NOT NULL` | `0` = unused, `1` = password has been reset using this token |
| `created_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | `NOT NULL` | Token issuance time |

**Indexes:**

| Index Name | Columns | Type | Purpose |
|---|---|---|---|
| `PRIMARY` | `id` | Primary Key | Row identifier |
| `uq_password_reset_tokens_token_hash` | `token_hash` | Unique | Fast lookup by token hash during reset |
| `idx_password_reset_tokens_user_id` | `user_id` | Non-unique | Find all reset tokens for a user |
| `idx_password_reset_tokens_expires_at` | `expires_at` | Non-unique | Periodic cleanup of expired tokens |

**SQL:**

```sql
CREATE TABLE `password_reset_tokens` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `expires_at` TIMESTAMP NOT NULL,
  `used` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_password_reset_tokens_token_hash` (`token_hash`),
  KEY `idx_password_reset_tokens_user_id` (`user_id`),
  KEY `idx_password_reset_tokens_expires_at` (`expires_at`),
  CONSTRAINT `fk_password_reset_tokens_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Notes on `password_reset_tokens` table:**

- Password reset tokens are stored as SHA-256 hashes, not raw values. The raw token (32 bytes hex) is sent in the password reset email link: `{FRONTEND_URL}/reset-password?token=<raw_token>`.
- `POST /api/auth/forgot-password` always returns `200 OK` regardless of whether the email exists in the system (prevents user enumeration).
- `POST /api/auth/reset-password` verifies the token hash, checks expiry, checks `used = 0`, then updates the user's `password_hash`, marks the token `used = 1`, and revokes all existing refresh tokens for that user.
- Error codes: `TOKEN_INVALID`, `TOKEN_EXPIRED`, `TOKEN_USED`, `PASSWORD_TOO_SHORT`, `PASSWORD_TOO_LONG`.
- `ON DELETE CASCADE` on `user_id` removes all reset tokens when a user is deleted.

---

## 4.3 Entity Relationship Summary

```
users (1) ──────< (N) projects
users (1) ──────< (N) databases
users (1) ──────< (N) resource_requests
users (1) ──────< (N) refresh_tokens
users (1) ──────< (N) password_reset_tokens
databases (1) ──o< (N) projects        [projects.database_id → databases.id, nullable]
projects (1) ──────< (N) builds
invite_tokens ──── (linked by email) ──── users
```

| Relationship | Type | Foreign Key | On Delete |
|---|---|---|---|
| `users` → `projects` | One-to-many | `projects.user_id` → `users.id` | `CASCADE` |
| `users` → `databases` | One-to-many | `databases.user_id` → `users.id` | `CASCADE` |
| `users` → `resource_requests` | One-to-many | `resource_requests.user_id` → `users.id` | `CASCADE` |
| `users` → `refresh_tokens` | One-to-many | `refresh_tokens.user_id` → `users.id` | `CASCADE` |
| `users` → `password_reset_tokens` | One-to-many | `password_reset_tokens.user_id` → `users.id` | `CASCADE` |
| `databases` → `projects` | One-to-many (optional) | `projects.database_id` → `databases.id` | `SET NULL` |
| `projects` → `builds` | One-to-many | `builds.project_id` → `projects.id` | `CASCADE` |
| `invite_tokens` → `users` | Logical (via email) | No foreign key | Application-managed |

## 4.4 Foreign Key Cascade Behavior Summary

| Parent Table | Child Table | On Delete Parent Row | Rationale |
|---|---|---|---|
| `users` | `projects` | `CASCADE` — all student projects are deleted | When a student is removed, their projects are cleaned up |
| `users` | `databases` | `CASCADE` — all student database records are deleted | When a student is removed, their database records are cleaned up; MySQL schemas/users are cleaned by application logic |
| `users` | `resource_requests` | `CASCADE` — all student requests are deleted | Requests are meaningless without the student |
| `users` | `refresh_tokens` | `CASCADE` — all tokens are deleted | Tokens are meaningless without the user |
| `users` | `password_reset_tokens` | `CASCADE` — all reset tokens are deleted | Tokens are meaningless without the user |
| `databases` | `projects` | `SET NULL` — `database_id` is set to `NULL` | Deleting a database should not delete the project; the project continues without a database |
| `projects` | `builds` | `CASCADE` — all build records are deleted | Build history is meaningless without the project |

**Critical implementation note:** `ON DELETE CASCADE` handles database-level cleanup only. Before deleting a `users` row, the application layer (`adminController.js`) must:

1. Stop and remove all running Docker containers for the student's projects via `dockerService.js`.
2. Remove all Nginx subdomain-to-port mappings for the student's projects and reload Nginx via `nginxService.js`.
3. Drop all MySQL schemas and restricted users for the student's databases via `databaseProvisioningService.js`.
4. Delete all project source directories under `{PROJECTS_BASE_DIR}/{student_id}/` via `storageService.js`.
5. Only then delete the `users` row, which cascades to `projects`, `databases`, `resource_requests`, `refresh_tokens`, `password_reset_tokens`, and `builds`.

The same pre-delete cleanup applies when removing a single project or database — application logic must precede the SQL delete.

## 4.5 Schema Creation Order

Tables must be created in this order to satisfy foreign key dependencies:

| Order | Table | Depends On |
|---|---|---|
| 1 | `users` | None |
| 2 | `databases` | `users` |
| 3 | `projects` | `users`, `databases` |
| 4 | `resource_requests` | `users` |
| 5 | `refresh_tokens` | `users` |
| 6 | `invite_tokens` | None |
| 7 | `builds` | `projects` |
| 8 | `password_reset_tokens` | `users` |