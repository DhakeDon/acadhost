# Section 3 — Environment Variables

## 3.1 Overview

All environment variables are defined in a single `.env` file located at the repository root. This file is not committed to version control. A `.env.example` file is provided as a template listing all required variables with placeholder values.

The `.env` file must have file permissions `600` (owner read/write only) on the production VM. This applies to all `.env` files on the production VM. Run:

```bash
chmod 600 /opt/acadhost/backend/.env
```

Environment variables fall into the following categories:

| Category | Description |
|---|---|
| Server Configuration | Express.js backend server settings |
| Database Configuration | MySQL connection settings for the platform's own database |
| Authentication & Tokens | JWT secrets, encryption keys, and token expiry durations |
| File Paths | Configurable file system paths (no hardcoded paths anywhere) |
| Docker & Build Configuration | Container management, port pool, build settings |
| Nginx Configuration | Reverse proxy config path and reload command |
| Email Configuration | Gmail SMTP settings |
| phpMyAdmin Configuration | phpMyAdmin deployment settings |
| Admin Account | Seed script configuration |
| Resource Defaults | Default quotas assigned to new students |
| Application Settings | General application-level settings |

## 3.2 Complete Variable Reference

### 3.2.1 Server Configuration

| Variable | Description | Required | Default | Example |
|---|---|---|---|---|
| `NODE_ENV` | Runtime environment identifier | Yes | `development` | `production` |
| `BACKEND_PORT` | Port on which the Express.js backend listens | Yes | `3000` | `3000` |
| `CORS_ORIGIN` | Allowed CORS origin(s) for frontend dashboards | Yes | `http://localhost:3000` | `https://acadhost.com` |

### 3.2.2 Database Configuration (Platform Database)

These variables configure the backend's own connection to the host MySQL server. They are distinct from the `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` variables injected into student containers at runtime (defined in Section 2.9).

| Variable | Description | Required | Default | Example |
|---|---|---|---|---|
| `MYSQL_HOST` | MySQL server hostname for the platform database | Yes | `localhost` | `localhost` |
| `MYSQL_PORT` | MySQL server port for the platform database | Yes | `3306` | `3306` |
| `MYSQL_USER` | MySQL username for the platform database | Yes | None | `acadhost_admin` |
| `MYSQL_PASSWORD` | MySQL password for the platform database | Yes | None | `strongpassword123` |
| `MYSQL_DATABASE` | MySQL database name for the platform's own schema | Yes | None | `acadhost` |
| `MYSQL_ROOT_PASSWORD` | MySQL root password; used by `docker-compose.yml` to initialize the MySQL container in development and by `databaseProvisioningService.js` to create student databases and restricted users | Yes | None | `rootpassword123` |

**Security consideration:** The backend process has access to `MYSQL_ROOT_PASSWORD` because `databaseProvisioningService.js` requires root-level privileges to create student databases and restricted users. This is inherent to the architecture. To mitigate risk, use a dedicated `acadhost_admin` MySQL user with `CREATE`, `CREATE USER`, and `GRANT` privileges instead of the root account where possible. `MYSQL_USER` should reference this dedicated user for the platform's own database operations. Reserve `MYSQL_ROOT_PASSWORD` strictly for provisioning operations that require root.

### 3.2.3 Authentication & Tokens

| Variable | Description | Required | Default | Example |
|---|---|---|---|---|
| `JWT_ACCESS_SECRET` | Secret key for signing JWT access tokens | Yes | None | `a1b2c3d4e5f6...` |
| `JWT_REFRESH_SECRET` | Secret key for signing JWT refresh tokens | Yes | None | `f6e5d4c3b2a1...` |
| `JWT_INVITE_SECRET` | Secret key for signing JWT invite tokens | Yes | None | `9z8y7x6w5v4u...` |
| `ACCESS_TOKEN_EXPIRY` | Access token expiry duration | Yes | `15m` | `15m` |
| `REFRESH_TOKEN_EXPIRY` | Refresh token expiry duration | Yes | `7d` | `7d` |
| `INVITE_TOKEN_EXPIRY` | Invite link token expiry duration | Yes | `2h` | `2h` |
| `PASSWORD_RESET_TOKEN_EXPIRY_HOURS` | Password reset token expiry duration in hours | Yes | `1` | `1` |
| `DB_ENCRYPTION_KEY` | AES-256 encryption key used to encrypt and decrypt student database passwords stored in the `databases.db_password_encrypted` column | Yes | None | `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6` |

**Format note:** The expiry values `ACCESS_TOKEN_EXPIRY`, `REFRESH_TOKEN_EXPIRY`, and `INVITE_TOKEN_EXPIRY` use the `ms` npm package format. The `jsonwebtoken` library accepts these formats natively via the `ms` package it depends on. No additional parsing library is needed. Valid format examples: `15m` (15 minutes), `7d` (7 days), `2h` (2 hours), `1y` (1 year).

### 3.2.4 File Paths

All file system paths are configurable via environment variables. No paths are hardcoded anywhere in the application. This ensures the same codebase runs on both Windows development and Linux production without any code changes.

| Variable | Description | Required | Production Default | Windows Dev Default |
|---|---|---|---|---|
| `PROJECTS_BASE_DIR` | Base directory for all student project files | Yes | `/home/acadhost/projects` | `C:/acadhost/projects` |
| `NGINX_CONF_DIR` | Directory where `nginxService.js` writes per-project Nginx config files; static platform configs are also placed here during deployment; Nginx includes all `*.conf` files in this directory | Yes | `/etc/nginx/conf.d/acadhost` | `./nginx/conf.d/acadhost` |
| `STUDENT_DASHBOARD_DIST` | Directory containing the built student dashboard React app; served as static files by Nginx on the root domain | Yes | `/var/www/acadhost/student` | `../frontend/student-dashboard/dist` |
| `ADMIN_DASHBOARD_DIST` | Directory containing the built admin dashboard React app; served as static files by Nginx on the admin subdomain | Yes | `/var/www/acadhost/admin` | `../frontend/admin-dashboard/dist` |

### 3.2.5 Docker & Build Configuration

| Variable | Description | Required | Default | Example |
|---|---|---|---|---|
| `CONTAINER_PORT_RANGE_START` | Start of the container port pool (inclusive) | Yes | `10000` | `10000` |
| `CONTAINER_PORT_RANGE_END` | End of the container port pool (inclusive) | Yes | `20000` | `20000` |
| `BUILD_TIMEOUT_MINUTES` | Maximum duration in minutes for a single project build before it is killed | Yes | `10` | `10` |
| `MAX_CONCURRENT_BUILDS` | Maximum number of project builds that can run simultaneously | Yes | `4` | `4` |
| `DOCKER_SOCKET_PATH` | Path to the Docker daemon socket | Yes | `/var/run/docker.sock` | `/var/run/docker.sock` |
| `CONTAINER_INTERNAL_PORT` | Fixed internal port that all student containers listen on; used in Dockerfile `EXPOSE`, `ENV PORT`, and the `-p {containerPort}:{CONTAINER_INTERNAL_PORT}` mapping in `dockerService.js`; applies to all container types including frontend Nginx containers | Yes | `8080` | `8080` |
| `NGINX_PROXY_HOST` | Hostname used by `nginxService.js` in `proxy_pass` directives for student project containers; in production, native Nginx reaches containers at `127.0.0.1`; in development, the Nginx Docker container reaches host-exposed ports via `host.docker.internal` | Yes | `127.0.0.1` | `host.docker.internal` |

### 3.2.6 Nginx Configuration

| Variable | Description | Required | Default | Example |
|---|---|---|---|---|
| `NGINX_RELOAD_CMD` | Shell command executed by `nginxService.js` to reload Nginx after configuration changes | Yes | `nginx -s reload` | `docker exec acadhost-nginx nginx -s reload` |
| `NGINX_TEST_CMD` | Shell command to validate Nginx configuration before reload | Yes | `nginx -t` | `docker exec acadhost-nginx nginx -t` |

**Security consideration:** `NGINX_RELOAD_CMD` is a shell command executed by the backend. If the `.env` file is compromised, an attacker could inject arbitrary commands. The `.env` file must have file permissions `600` (owner read/write only) on the production VM. This permission rule applies to all environment files across the deployment, not only for `NGINX_RELOAD_CMD` but for all secrets stored in `.env`.

### 3.2.7 Email Configuration

Gmail SMTP (`smtp.gmail.com:587`) using an App Password, with a daily limit of 500 emails.

| Variable | Description | Required | Default | Example |
|---|---|---|---|---|
| `SMTP_HOST` | SMTP server hostname | Yes | `smtp.gmail.com` | `smtp.gmail.com` |
| `SMTP_PORT` | SMTP server port | Yes | `587` | `587` |
| `SMTP_USER` | Gmail email address used as the sender | Yes | None | `acadhost@institution.edu` |
| `SMTP_PASSWORD` | Gmail App Password for SMTP authentication | Yes | None | `abcd efgh ijkl mnop` |
| `SMTP_FROM_NAME` | Display name in the "From" field of sent emails | Yes | `AcadHost` | `AcadHost` |
| `SMTP_DAILY_LIMIT` | Maximum number of emails the system will send per day | Yes | `500` | `500` |

### 3.2.8 phpMyAdmin Configuration

phpMyAdmin runs as a standalone container. These variables configure its deployment and the links generated by the backend.

| Variable | Description | Required | Default | Example |
|---|---|---|---|---|
| `PHPMYADMIN_PORT` | Port on which phpMyAdmin is accessible on the host | Yes | `8080` | `8080` |
| `PHPMYADMIN_BASE_PATH` | Base URL path for phpMyAdmin | Yes | `/phpmyadmin` | `/phpmyadmin` |
| `PHPMYADMIN_URL` | Full base URL used by the backend to construct phpMyAdmin links for students | Yes | `http://localhost:8080` | `https://phpmyadmin.acadhost.com` |

### 3.2.9 Admin Account

| Variable | Description | Required | Default | Example |
|---|---|---|---|---|
| `ADMIN_EMAIL` | Email address for the single fixed admin account; used by `seeds/adminSeed.js` on first deployment | Yes | None | `admin@institution.edu` |
| `ADMIN_DEFAULT_PASSWORD` | Initial password for the admin account; set during seed and must be changed on first login | Yes | None | `changeme123!` |

The backend must enforce a password change on the admin's first login via the `must_change_password` flag in the `users` table. The `ADMIN_DEFAULT_PASSWORD` value is used only once by the seed script on first deployment. After first deployment and the admin's first login with password change, this variable can be removed from the `.env` file. It is only read by the seed script on first deployment and is never referenced again at runtime.

### 3.2.10 Resource Defaults

These variables define the default resource quotas assigned to every newly invited student. The admin can adjust individual quotas after creation via the admin dashboard.

| Variable | Description | Required | Default | Unit |
|---|---|---|---|---|
| `DEFAULT_CPU_CORES` | Default CPU cores allocated per student | Yes | `2` | Cores |
| `DEFAULT_RAM_MB` | Default RAM allocated per student | Yes | `1024` | MB |
| `DEFAULT_STORAGE_MB` | Default storage allocated per student | Yes | `2560` | MB |
| `DEFAULT_MAX_PROJECTS` | Default maximum number of projects per student | Yes | `4` | Count |
| `DEFAULT_MAX_DATABASES` | Default maximum number of databases per student | Yes | `4` | Count |
| `STORAGE_WARNING_THRESHOLD_PERCENT` | Percentage of storage quota at which a warning is triggered | Yes | `80` | Percent |

RAM and storage defaults are stored in MB (`1024` and `2560` respectively) for precision. MB avoids floating-point issues (e.g., 2.5 GB as a float) and is the standard unit for Docker `--memory` flags and quota calculations.

### 3.2.11 Application Settings

| Variable | Description | Required | Default | Example |
|---|---|---|---|---|
| `MAX_ZIP_UPLOAD_SIZE_MB` | Maximum allowed ZIP file upload size in MB; enforced before extraction | Yes | `200` | `200` |
| `BUILD_LOG_RETENTION_DAYS` | Number of days to retain build log files before automatic cleanup | Yes | `7` | `7` |
| `PLATFORM_DOMAIN` | Base domain for the platform; used for constructing subdomain URLs | Yes | `acadhost.com` | `acadhost.com` |
| `PLATFORM_URL` | Full base URL of the platform; used in invitation emails and links | Yes | `http://localhost:3000` | `https://acadhost.com` |
| `FRONTEND_URL` | Base URL of the student-facing frontend; used to construct password reset links in emails (e.g., `{FRONTEND_URL}/reset-password?token=<raw_token>`) | Yes | `http://localhost:5173` | `https://acadhost.com` |

### 3.2.12 Database Credential Variables (Injected into Student Containers)

These variables are **not** defined in the `.env` file. They are dynamically injected by `dockerService.js` into each student container at runtime during container creation. They are listed here for completeness and to lock their names across all sections.

| Variable | Injected Value | Source |
|---|---|---|
| `DB_HOST` | `host.docker.internal` (allows the container to reach the host MySQL server) | Constant value injected by the backend |
| `DB_PORT` | MySQL server port (typically `3306`) | Platform configuration |
| `DB_USER` | Restricted MySQL username scoped to the student's specific database | Generated by `databaseProvisioningService.js` during database provisioning |
| `DB_PASSWORD` | Password for the restricted MySQL user | Generated by `databaseProvisioningService.js` during database provisioning; stored encrypted in `databases.db_password_encrypted`; decrypted at injection time |
| `DB_NAME` | Name of the student's specific database schema | Provided by the student during database creation |

When a student switches the attached database for a project via the project settings dropdown, the container is recreated with the new database's `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` values injected.

**Critical distinction — two different `DB_HOST` contexts:**

| Context | Variable | Value | Purpose |
|---|---|---|---|
| Backend `.env` file | `MYSQL_HOST` | `127.0.0.1` | The platform backend's own connection to the host MySQL server |
| Injected into student containers | `DB_HOST` | `host.docker.internal` | Allows student containers to reach the host MySQL server from inside Docker |

These are two completely different variables serving two different purposes. `MYSQL_HOST` is read by the backend from `.env`. `DB_HOST` is injected by `dockerService.js` into student containers at runtime. The injected `DB_HOST` value is always `host.docker.internal` — this resolves to the host machine from within any Docker container on both Docker Desktop (Windows/Mac) and Linux (with `--add-host=host.docker.internal:host-gateway`). Section 9 documents the full provisioning flow.

**Note on `MYSQL_HOST` value:** `MYSQL_HOST` is set to `localhost` in the `.env.example` template (Section 3.4) and in the environment-specific values table (Section 3.5). `127.0.0.1` and `localhost` are functionally equivalent for MySQL connections via TCP. The platform uses `localhost` consistently across all environments. The earlier reference to `127.0.0.1` in this section's distinction table was illustrative of the IP-level resolution — the actual configured value in `.env` is `localhost`.

## 3.3 Reserved Subdomains

The following subdomains are reserved and cannot be claimed by students. These are validated by `utils/subdomainValidator.js`. This list is hardcoded in the validator (not an environment variable) because it is a fixed security rule, not a configurable path or value.

| Reserved Subdomain |
|---|
| `admin` |
| `api` |
| `www` |
| `mail` |
| `ftp` |
| `smtp` |
| `static` |
| `app` |
| `phpmyadmin` |

## 3.4 `.env.example` Template

```env
# ============================================================
# AcadHost — Environment Variables
# ============================================================
# Copy this file to .env and fill in all values.
# Do NOT commit .env to version control.
# Production: chmod 600 .env
# ============================================================

# --- Server Configuration ---
NODE_ENV=development
BACKEND_PORT=3000
CORS_ORIGIN=http://localhost:3000

# --- Database Configuration (Platform Database) ---
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=acadhost_admin
MYSQL_PASSWORD=
MYSQL_DATABASE=acadhost
MYSQL_ROOT_PASSWORD=

# --- Authentication & Tokens ---
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_INVITE_SECRET=
ACCESS_TOKEN_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=7d
INVITE_TOKEN_EXPIRY=2h
PASSWORD_RESET_TOKEN_EXPIRY_HOURS=1
DB_ENCRYPTION_KEY=

# --- File Paths ---
# Production: /home/acadhost/projects
# Windows Dev: C:/acadhost/projects
PROJECTS_BASE_DIR=C:/acadhost/projects
# Production: /etc/nginx/conf.d/acadhost
# Windows Dev: ./nginx/conf.d/acadhost
NGINX_CONF_DIR=./nginx/conf.d/acadhost
# Production: /var/www/acadhost/student
# Windows Dev: ../frontend/student-dashboard/dist
STUDENT_DASHBOARD_DIST=../frontend/student-dashboard/dist
# Production: /var/www/acadhost/admin
# Windows Dev: ../frontend/admin-dashboard/dist
ADMIN_DASHBOARD_DIST=../frontend/admin-dashboard/dist

# --- Docker & Build Configuration ---
CONTAINER_PORT_RANGE_START=10000
CONTAINER_PORT_RANGE_END=20000
BUILD_TIMEOUT_MINUTES=10
MAX_CONCURRENT_BUILDS=4
DOCKER_SOCKET_PATH=/var/run/docker.sock
CONTAINER_INTERNAL_PORT=8080
# Production: 127.0.0.1
# Windows Dev: host.docker.internal
NGINX_PROXY_HOST=host.docker.internal

# --- Nginx Configuration ---
# Production: nginx -s reload
# Windows Dev: docker exec acadhost-nginx nginx -s reload
NGINX_RELOAD_CMD=docker exec acadhost-nginx nginx -s reload
# Production: nginx -t
# Windows Dev: docker exec acadhost-nginx nginx -t
NGINX_TEST_CMD=docker exec acadhost-nginx nginx -t

# --- Email Configuration (Gmail SMTP) ---
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM_NAME=AcadHost
SMTP_DAILY_LIMIT=500

# --- phpMyAdmin Configuration ---
PHPMYADMIN_PORT=8080
PHPMYADMIN_BASE_PATH=/phpmyadmin
PHPMYADMIN_URL=http://localhost:8080

# --- Admin Account ---
ADMIN_EMAIL=
ADMIN_DEFAULT_PASSWORD=

# --- Resource Defaults ---
DEFAULT_CPU_CORES=2
DEFAULT_RAM_MB=1024
DEFAULT_STORAGE_MB=2560
DEFAULT_MAX_PROJECTS=4
DEFAULT_MAX_DATABASES=4
STORAGE_WARNING_THRESHOLD_PERCENT=80

# --- Application Settings ---
MAX_ZIP_UPLOAD_SIZE_MB=200
BUILD_LOG_RETENTION_DAYS=7
PLATFORM_DOMAIN=acadhost.com
PLATFORM_URL=http://localhost:3000
FRONTEND_URL=http://localhost:5173
```

## 3.5 Environment-Specific Value Summary

This table shows the concrete values for variables that differ between development and production.

| Variable | Development Value | Production Value |
|---|---|---|
| `NODE_ENV` | `development` | `production` |
| `CORS_ORIGIN` | `http://localhost:3000` | `https://acadhost.com` |
| `MYSQL_HOST` | `localhost` (or `mysql` if backend runs inside Docker network) | `localhost` (MySQL runs natively) |
| `PROJECTS_BASE_DIR` | `C:/acadhost/projects` | `/home/acadhost/projects` |
| `NGINX_CONF_DIR` | `./nginx/conf.d/acadhost` | `/etc/nginx/conf.d/acadhost` |
| `STUDENT_DASHBOARD_DIST` | `../frontend/student-dashboard/dist` | `/var/www/acadhost/student` |
| `ADMIN_DASHBOARD_DIST` | `../frontend/admin-dashboard/dist` | `/var/www/acadhost/admin` |
| `DOCKER_SOCKET_PATH` | `/var/run/docker.sock` | `/var/run/docker.sock` |
| `NGINX_PROXY_HOST` | `host.docker.internal` | `127.0.0.1` |
| `NGINX_RELOAD_CMD` | `docker exec acadhost-nginx nginx -s reload` | `nginx -s reload` |
| `NGINX_TEST_CMD` | `docker exec acadhost-nginx nginx -t` | `nginx -t` |
| `PHPMYADMIN_URL` | `http://localhost:8080` | `https://phpmyadmin.acadhost.com` |
| `PLATFORM_URL` | `http://localhost:3000` | `https://acadhost.com` |
| `FRONTEND_URL` | `http://localhost:5173` | `https://acadhost.com` |

## 3.6 Variable Validation Rules

The backend must validate all environment variables at startup. If any required variable is missing or invalid, the server must refuse to start and log a clear error message identifying the missing variable.

| Variable | Validation Rule |
|---|---|
| `NODE_ENV` | Must be one of: `development`, `production` |
| `BACKEND_PORT` | Must be a positive integer |
| `CORS_ORIGIN` | Must be a valid URL or comma-separated list of valid URLs |
| `MYSQL_HOST` | Must be a non-empty string |
| `MYSQL_PORT` | Must be a positive integer |
| `MYSQL_USER` | Must be a non-empty string |
| `MYSQL_PASSWORD` | Must be a non-empty string |
| `MYSQL_DATABASE` | Must be a non-empty string |
| `MYSQL_ROOT_PASSWORD` | Must be a non-empty string |
| `JWT_ACCESS_SECRET` | Must be a non-empty string; minimum 32 characters recommended |
| `JWT_REFRESH_SECRET` | Must be a non-empty string; minimum 32 characters recommended |
| `JWT_INVITE_SECRET` | Must be a non-empty string; minimum 32 characters recommended |
| `ACCESS_TOKEN_EXPIRY` | Must be a valid duration string (e.g., `15m`, `1h`) |
| `REFRESH_TOKEN_EXPIRY` | Must be a valid duration string (e.g., `7d`, `24h`) |
| `INVITE_TOKEN_EXPIRY` | Must be a valid duration string (e.g., `2h`, `30m`) |
| `PASSWORD_RESET_TOKEN_EXPIRY_HOURS` | Must be a positive integer |
| `DB_ENCRYPTION_KEY` | Must be a non-empty string; must be exactly 32 characters (256 bits) for AES-256 |
| `PROJECTS_BASE_DIR` | Must be a non-empty string; directory must exist or be creatable |
| `NGINX_CONF_DIR` | Must be a non-empty string; directory must exist or be creatable |
| `STUDENT_DASHBOARD_DIST` | Must be a non-empty string; directory must exist |
| `ADMIN_DASHBOARD_DIST` | Must be a non-empty string; directory must exist |
| `CONTAINER_PORT_RANGE_START` | Must be a positive integer; must be less than `CONTAINER_PORT_RANGE_END` |
| `CONTAINER_PORT_RANGE_END` | Must be a positive integer; must be greater than `CONTAINER_PORT_RANGE_START` |
| `BUILD_TIMEOUT_MINUTES` | Must be a positive integer |
| `MAX_CONCURRENT_BUILDS` | Must be a positive integer |
| `DOCKER_SOCKET_PATH` | Must be a non-empty string; path must exist |
| `CONTAINER_INTERNAL_PORT` | Must be a positive integer |
| `NGINX_PROXY_HOST` | Must be a non-empty string |
| `NGINX_RELOAD_CMD` | Must be a non-empty string |
| `NGINX_TEST_CMD` | Must be a non-empty string |
| `SMTP_HOST` | Must be a non-empty string |
| `SMTP_PORT` | Must be a positive integer |
| `SMTP_USER` | Must be a non-empty string |
| `SMTP_PASSWORD` | Must be a non-empty string |
| `SMTP_FROM_NAME` | Must be a non-empty string |
| `SMTP_DAILY_LIMIT` | Must be a positive integer |
| `PHPMYADMIN_PORT` | Must be a positive integer |
| `PHPMYADMIN_BASE_PATH` | Must be a non-empty string starting with `/` |
| `PHPMYADMIN_URL` | Must be a valid URL |
| `ADMIN_EMAIL` | Must be a valid email address |
| `ADMIN_DEFAULT_PASSWORD` | Must be a non-empty string; minimum 8 characters recommended |
| `DEFAULT_CPU_CORES` | Must be a positive number |
| `DEFAULT_RAM_MB` | Must be a positive integer |
| `DEFAULT_STORAGE_MB` | Must be a positive integer |
| `DEFAULT_MAX_PROJECTS` | Must be a positive integer |
| `DEFAULT_MAX_DATABASES` | Must be a positive integer |
| `STORAGE_WARNING_THRESHOLD_PERCENT` | Must be an integer between 1 and 100 |
| `MAX_ZIP_UPLOAD_SIZE_MB` | Must be a positive integer |
| `BUILD_LOG_RETENTION_DAYS` | Must be a positive integer |
| `PLATFORM_DOMAIN` | Must be a non-empty string; must be a valid domain name |
| `PLATFORM_URL` | Must be a valid URL |
| `FRONTEND_URL` | Must be a valid URL |