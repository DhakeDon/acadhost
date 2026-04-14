# Section 9 — Database Provisioning Flow

## 9.1 Overview

AcadHost allows students to provision isolated MySQL databases on the host MySQL server. Each database is a separate MySQL schema with a restricted MySQL user that has privileges scoped exclusively to that schema. The entire provisioning lifecycle — creation, credential management, injection into containers, and teardown — is handled by `services/databaseProvisioningService.js`.

This section documents the complete provisioning flow, naming conventions, MySQL command sequences, credential lifecycle, and teardown procedures. It is the authoritative reference for all database provisioning behavior deferred to "Section 9" by Sections 3, 4, 5, 6, and 7.

### Key Architectural Principles

| Principle | Detail |
|---|---|
| One schema per database record | Each row in the `databases` table corresponds to exactly one MySQL schema on the host MySQL server |
| One restricted user per database record | Each row in the `databases` table corresponds to exactly one MySQL user with privileges on exactly one schema |
| Root-level connection for provisioning | `databaseProvisioningService.js` connects to MySQL using `MYSQL_ROOT_PASSWORD` for all provisioning operations (`CREATE DATABASE`, `CREATE USER`, `GRANT`, `DROP USER`, `DROP DATABASE`, `REVOKE`) |
| Platform connection for metadata | The platform backend connects using `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` for all reads and writes to the `databases` table (and all other platform tables) |
| Encryption at rest | Database passwords are encrypted using AES-256-CBC before storage in `databases.db_password_encrypted` (Section 5.11) |
| Decryption at injection time | Passwords are decrypted only when injecting `DB_PASSWORD` into student containers (Section 7.6) or when returning credentials to phpMyAdmin `signon.php` (Section 6.2.9) |
| Application-layer cleanup before SQL delete | MySQL schemas and users must be dropped before the corresponding `databases` row is deleted (Section 4.4) |

## 9.2 Service File — `services/databaseProvisioningService.js`

This service is defined in Section 2.3. It is the only file in the codebase that executes MySQL provisioning commands (`CREATE DATABASE`, `CREATE USER`, `GRANT`, `DROP DATABASE`, `DROP USER`, `REVOKE`).

### 9.2.1 Root Connection

`databaseProvisioningService.js` establishes a dedicated MySQL connection using root credentials for provisioning operations. This connection is separate from the platform's connection pool defined in `config/db.js`.

| Parameter | Value | Source |
|---|---|---|
| Host | Value of `MYSQL_HOST` | `.env` (Section 3.2.2); default `localhost` |
| Port | Value of `MYSQL_PORT` | `.env` (Section 3.2.2); default `3306` |
| User | `root` | Hardcoded; provisioning requires root privileges |
| Password | Value of `MYSQL_ROOT_PASSWORD` | `.env` (Section 3.2.2) |

```javascript
const mysql = require('mysql2/promise');

async function getRootConnection() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT, 10),
    user: 'root',
    password: process.env.MYSQL_ROOT_PASSWORD,
  });
  return connection;
}
```

**Security note (Section 3.2.2):** The backend process has access to `MYSQL_ROOT_PASSWORD` because `databaseProvisioningService.js` requires root-level privileges to create student databases and restricted users. To mitigate risk, use a dedicated `acadhost_admin` MySQL user with `CREATE`, `CREATE USER`, and `GRANT` privileges instead of the root account where possible. `MYSQL_ROOT_PASSWORD` is reserved strictly for provisioning operations.

### 9.2.2 Exported Functions

| Function | Purpose | Called By |
|---|---|---|
| `provisionDatabase(userId, dbName)` | Creates a MySQL schema, restricted user, and grants privileges; returns the schema name, username, and encrypted password | `databaseController.createDatabase` (Section 6.6.1) |
| `dropDatabase(dbNameColumn, dbUser)` | Revokes privileges, drops the restricted user, and drops the MySQL schema | `databaseController` (implicit in delete flow), `adminController.removeStudent` (Section 6.4.4), `adminController.batchRemoveStudents` (Section 6.4.5) |
| `dropAllDatabasesForStudent(userId)` | Queries all `databases` rows for the student and calls `dropDatabase` for each | `adminController.removeStudent` (Section 6.4.4), `adminController.batchRemoveStudents` (Section 6.4.5) |
| `encryptPassword(plaintext)` | Encrypts a plaintext password using AES-256-CBC with `DB_ENCRYPTION_KEY`; returns `<hex_iv>:<hex_ciphertext>` | `provisionDatabase` |
| `decryptPassword(encryptedValue)` | Decrypts `<hex_iv>:<hex_ciphertext>` back to plaintext using `DB_ENCRYPTION_KEY` | `dockerService.js` (Section 7.6), `authController.verifyPhpMyAdminSession` (Section 6.2.9) |

## 9.3 Naming Conventions

All naming conventions are locked as established in Section 4 (notes) and Section 6 (Section 6.6.1 behavior).

### 9.3.1 MySQL Schema Name

| Property | Value |
|---|---|
| Format | `s{user_id}_{dbName}` |
| Example | Student with `users.id = 42` creates a database with display name `mydb` → MySQL schema name is `s42_mydb` |
| Stored in | `databases.db_name` column (`VARCHAR(64)`) |
| Character set | Schema name inherits the characters from the student's input (`dbName`), which is constrained to alphanumeric and underscores, 1–64 characters (Section 6.6.1). The `s{user_id}_` prefix adds a fixed overhead. |
| Maximum length | The `db_name` column is `VARCHAR(64)`. Given the prefix `s{user_id}_`, the student's `dbName` input is constrained to 1–64 characters at the API validation layer (Section 6.6.1). The generated schema name `s{user_id}_{dbName}` may exceed 64 characters for very large user IDs combined with long `dbName` inputs. MySQL supports schema names up to 64 characters. |

AMBIGUITY DETECTED: The `databases.db_name` column description in Section 4.2.3 states "MySQL schema name" while the Section 4 notes use `db_name` as the student's input name in the formula `s{user_id}_{db_name}`. The Section 6.6.2 API response returns both `dbName: "mydb"` (display name) and `mysqlSchemaName: "s42_mydb"` (actual schema name) as separate fields.
My decision: `databases.db_name` stores the **actual MySQL schema name** (e.g., `s42_mydb`), consistent with the column description "MySQL schema name" and with Section 7.6 which injects `DB_NAME` directly from `databases.db_name`. The student's display name (`dbName: "mydb"` in API responses) is derived by stripping the `s{user_id}_` prefix from the stored value. This is the interpretation that makes Section 7.6 injection work without recomputation.

### 9.3.2 MySQL Username

| Property | Value |
|---|---|
| Format | `u{user_id}_{dbName}` |
| Example | Student with `users.id = 42` creates a database with display name `mydb` → MySQL username is `u42_mydb` |
| Stored in | `databases.db_user` column (`VARCHAR(32)`) |
| Global uniqueness | Enforced by the `uq_databases_db_user` unique index (Section 4.2.3). MySQL usernames are server-wide; no two databases across any students can share the same MySQL username. The `u{user_id}_` prefix inherently prevents collisions between different students using the same `dbName`, and the per-student `dbName` uniqueness constraint (`uq_databases_user_db_name`) prevents collisions within the same student. |
| Maximum length | The `db_user` column is `VARCHAR(32)`. MySQL supports usernames up to 32 characters. Given the prefix `u{user_id}_`, the usable characters for `dbName` are limited. |

AMBIGUITY DETECTED: The `dbUser` field in the `POST /api/auth/phpmyadmin/verify` response (Section 6.2.9) shows `"dbUser": "s42_user_mydb"` which does not match the established username format `u{user_id}_{dbName}` (e.g., `u42_mydb`).
My decision: The value `s42_user_mydb` in Section 6.2.9 is treated as an illustrative placeholder that is inconsistent with the naming convention established in Section 6.6.1. The authoritative username format is `u{user_id}_{dbName}` (e.g., `u42_mydb`). Code generation must use the `u{user_id}_{dbName}` convention.

### 9.3.3 Naming Convention Summary Table

| Artifact | Format | Example (user_id=42, dbName=mydb) | Stored In |
|---|---|---|---|
| MySQL schema name | `s{user_id}_{dbName}` | `s42_mydb` | `databases.db_name` |
| MySQL username | `u{user_id}_{dbName}` | `u42_mydb` | `databases.db_user` |
| Encrypted password | `<hex_iv>:<hex_ciphertext>` | `a1b2c3...d4e5f6:7g8h9i...0j1k2l` | `databases.db_password_encrypted` |

### 9.3.4 Length Validation

The generated MySQL schema name and username must fit within their respective MySQL and column limits. The service must validate lengths before issuing MySQL commands.

| Artifact | MySQL Limit | Column Limit | Validation |
|---|---|---|---|
| Schema name (`s{user_id}_{dbName}`) | 64 characters | `databases.db_name` — `VARCHAR(64)` | If the generated schema name exceeds 64 characters, return an error before executing any MySQL commands |
| Username (`u{user_id}_{dbName}`) | 32 characters | `databases.db_user` — `VARCHAR(32)` | If the generated username exceeds 32 characters, return an error before executing any MySQL commands |

| Error Condition | Error Handling |
|---|---|
| Schema name exceeds 64 characters | Throw an application error; do not execute `CREATE DATABASE`. The API layer returns `400` with `VALIDATION_ERROR` and message `Generated database name exceeds maximum length` |
| Username exceeds 32 characters | Throw an application error; do not execute `CREATE USER`. The API layer returns `400` with `VALIDATION_ERROR` and message `Generated username exceeds maximum length` |

## 9.4 Password Generation

A random password is generated for each new restricted MySQL user.

| Parameter | Value |
|---|---|
| Generation method | `crypto.randomBytes(24).toString('base64url')` |
| Output length | 32 characters (24 bytes → 32 base64url characters) |
| Character set | `A-Z`, `a-z`, `0-9`, `-`, `_` (base64url alphabet; no special characters that could break shell escaping in Docker `-e` flags) |
| When generated | Once per `provisionDatabase` call; never regenerated |
| Storage | Encrypted via AES-256-CBC and stored in `databases.db_password_encrypted` (Section 5.11) |

```javascript
const crypto = require('crypto');

function generateDatabasePassword() {
  return crypto.randomBytes(24).toString('base64url');
}
```

**Why `base64url`:** The generated password is injected into student containers via Docker `-e DB_PASSWORD={password}` flags (Section 7.8.2). Using `base64url` encoding avoids characters like `+`, `/`, `=`, `'`, `"`, `$`, `` ` ``, and `\` that could cause shell escaping issues in Docker CLI commands.

## 9.5 Password Encryption and Decryption

Password encryption and decryption use the functions defined in Section 5.11. They are re-stated here for completeness in the context of database provisioning.

### 9.5.1 Encryption (During Provisioning)

Called by `provisionDatabase` after generating the random password.

| Parameter | Value |
|---|---|
| Algorithm | AES-256-CBC |
| Key | `DB_ENCRYPTION_KEY` environment variable (exactly 32 characters / 256 bits) (Section 3.2.3) |
| IV | 16 cryptographically random bytes, generated per encryption operation |
| Storage format | `<hex_iv>:<hex_ciphertext>` stored in `databases.db_password_encrypted` (`VARCHAR(512)`) |

```javascript
function encryptPassword(plaintext) {
  const key = process.env.DB_ENCRYPTION_KEY;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}
```

### 9.5.2 Decryption (During Injection and phpMyAdmin Verify)

Called by `dockerService.js` (Section 7.6) when injecting `DB_PASSWORD` into student containers, and by `authController.verifyPhpMyAdminSession` (Section 6.2.9) when returning credentials for phpMyAdmin `signon.php`.

```javascript
function decryptPassword(encryptedValue) {
  const key = process.env.DB_ENCRYPTION_KEY;
  const [ivHex, encryptedHex] = encryptedValue.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

### 9.5.3 Decryption Consumers

| Consumer | When | Purpose |
|---|---|---|
| `dockerService.js` → `createAndStartContainer` | Container creation (Section 7.8.2) | Injects `DB_PASSWORD` as Docker `-e` flag |
| `dockerService.js` → container recreation | Database switch (Section 7.11.1), resource update fallback (Section 7.11.2) | Re-injects `DB_PASSWORD` with new or same credentials |
| `authController.verifyPhpMyAdminSession` | `POST /api/auth/phpmyadmin/verify` (Section 6.2.9) | Returns decrypted password to phpMyAdmin `signon.php` for automatic login |

## 9.6 Complete Provisioning Flow — `provisionDatabase(userId, dbName)`

This is the complete step-by-step flow executed when a student creates a new database via `POST /api/databases` (Section 6.6.1). The controller (`databaseController.createDatabase`) performs validation steps 1–2, then delegates to `databaseProvisioningService.provisionDatabase` for steps 3–9.

### 9.6.1 Pre-Provisioning Validation (Controller Layer)

These steps are performed by `databaseController.createDatabase` before calling the provisioning service.

| Step | Action | Reference |
|---|---|---|
| 1 | Validate the student has not reached `max_databases` quota | `users.max_databases`; error `DATABASE_QUOTA_EXCEEDED` (Section 6.6.1) |
| 2 | Validate `dbName` does not duplicate any of this student's existing databases | `uq_databases_user_db_name` composite unique index; error `DATABASE_NAME_DUPLICATE` (Section 6.6.1) |

### 9.6.2 Provisioning Steps (Service Layer)

```
function provisionDatabase(userId, dbName):

  Step 3: Generate naming artifacts
    schemaName = 's' + userId + '_' + dbName      // e.g., 's42_mydb'
    mysqlUser  = 'u' + userId + '_' + dbName      // e.g., 'u42_mydb'

  Step 4: Validate generated name lengths
    IF length(schemaName) > 64:
      THROW error: 'Generated database name exceeds maximum length'
    IF length(mysqlUser) > 32:
      THROW error: 'Generated username exceeds maximum length'

  Step 5: Generate random password
    password = crypto.randomBytes(24).toString('base64url')  // 32 characters

  Step 6: Encrypt the password
    encryptedPassword = encryptPassword(password)  // '<hex_iv>:<hex_ciphertext>'

  Step 7: Obtain root MySQL connection
    connection = getRootConnection()

  Step 8: Create the MySQL schema
    Execute: CREATE DATABASE `{schemaName}`
             CHARACTER SET utf8mb4
             COLLATE utf8mb4_unicode_ci

  Step 9: Create the restricted MySQL user
    Execute: CREATE USER '{mysqlUser}'@'%'
             IDENTIFIED BY '{password}'

  Step 10: Grant privileges scoped to this schema only
    Execute: GRANT ALL PRIVILEGES
             ON `{schemaName}`.*
             TO '{mysqlUser}'@'%'

  Step 11: Flush privileges
    Execute: FLUSH PRIVILEGES

  Step 12: Insert metadata row into databases table
    INSERT INTO databases (user_id, db_name, db_user, db_password_encrypted)
    VALUES (userId, schemaName, mysqlUser, encryptedPassword)

  Step 13: Close root connection
    connection.close()

  Step 14: Return result
    RETURN {
      id: <inserted row id>,
      dbName: dbName,                // student's display name
      mysqlSchemaName: schemaName,   // actual MySQL schema name
      createdAt: <timestamp>
    }
```

### 9.6.3 MySQL Commands — Exact SQL

```sql
-- Step 8: Create database
CREATE DATABASE `s42_mydb` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Step 9: Create restricted user
CREATE USER 'u42_mydb'@'%' IDENTIFIED BY 'randomBase64urlPassword32Chars';

-- Step 10: Grant privileges (schema-scoped only)
GRANT ALL PRIVILEGES ON `s42_mydb`.* TO 'u42_mydb'@'%';

-- Step 11: Flush privileges
FLUSH PRIVILEGES;
```

### 9.6.4 User Host Specifier

| Property | Value |
|---|---|
| Host specifier | `'%'` (any host) |
| Reason | Student containers connect from Docker's internal network via `host.docker.internal`, which resolves to the host machine's IP. The connecting IP varies depending on Docker's network mode and the OS. Using `'%'` ensures the restricted user can connect regardless of the source IP. |
| Security mitigation | The restricted user has privileges on exactly one schema. Even with `'%'` host access, they cannot read or modify any other schema. Network-level protection is provided by the host firewall — MySQL port `3306` is not exposed to the public internet. Only processes on the same host (the backend, Docker containers via `host.docker.internal`) can connect. |

### 9.6.5 Grant Scope

| Property | Value |
|---|---|
| Privilege level | `ALL PRIVILEGES ON \`{schemaName}\`.*` |
| What `ALL PRIVILEGES` includes at schema level | `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `DROP`, `INDEX`, `ALTER`, `CREATE TEMPORARY TABLES`, `LOCK TABLES`, `EXECUTE`, `CREATE VIEW`, `SHOW VIEW`, `CREATE ROUTINE`, `ALTER ROUTINE`, `EVENT`, `TRIGGER`, `REFERENCES` |
| What it does NOT include | `GRANT OPTION` (the restricted user cannot grant privileges to other users), `SUPER`, `FILE`, `PROCESS`, `RELOAD`, `SHUTDOWN`, `CREATE USER`, `REPLICATION CLIENT`, `REPLICATION SLAVE` — all server-wide or global privileges are excluded |
| Effect | The student can create tables, insert data, create views, stored procedures, triggers, and events within their schema. They cannot access any other schema, create new databases, or manage MySQL users. |

### 9.6.6 Error Handling During Provisioning

If any MySQL command fails during provisioning, the service must roll back all previous MySQL commands to avoid leaving orphaned schemas or users.

| Failure Point | Cleanup Required |
|---|---|
| `CREATE DATABASE` fails | No cleanup; nothing was created. Throw error. |
| `CREATE USER` fails | `DROP DATABASE \`{schemaName}\``. Throw error. |
| `GRANT ALL PRIVILEGES` fails | `DROP USER '{mysqlUser}'@'%'`, then `DROP DATABASE \`{schemaName}\``. Throw error. |
| `INSERT INTO databases` fails | `DROP USER '{mysqlUser}'@'%'`, then `DROP DATABASE \`{schemaName}\``. Throw error. |

```
function provisionDatabase(userId, dbName):
  connection = getRootConnection()
  schemaCreated = false
  userCreated = false

  TRY:
    // Steps 3-6: naming and password generation (no MySQL operations)
    ...

    // Step 8: Create schema
    await connection.execute('CREATE DATABASE ...')
    schemaCreated = true

    // Step 9: Create user
    await connection.execute('CREATE USER ...')
    userCreated = true

    // Step 10: Grant privileges
    await connection.execute('GRANT ALL PRIVILEGES ...')

    // Step 11: Flush privileges
    await connection.execute('FLUSH PRIVILEGES')

    // Step 12: Insert metadata row (uses platform DB connection, not root)
    result = await platformDb.execute('INSERT INTO databases ...')

    RETURN result

  CATCH (error):
    // Rollback MySQL operations in reverse order
    IF userCreated:
      await connection.execute('DROP USER IF EXISTS ...')
    IF schemaCreated:
      await connection.execute('DROP DATABASE IF EXISTS ...')

    THROW error

  FINALLY:
    connection.close()
```

### 9.6.7 Transaction Note

The `INSERT INTO databases` statement uses the platform's MySQL connection pool (`config/db.js`), not the root connection. The MySQL provisioning commands (`CREATE DATABASE`, `CREATE USER`, `GRANT`) are DDL statements that implicitly commit in MySQL and cannot be rolled back within a transaction. Therefore, the rollback logic in Section 9.6.6 uses explicit `DROP` commands rather than MySQL transactions.

## 9.7 Credential Injection into Containers

After a database is provisioned, its credentials are injected into student containers when a project has a database attached. This injection is performed by `dockerService.js` and is documented in detail in Section 7.6. This section summarizes the flow for cross-reference.

### 9.7.1 Injection Trigger

Credentials are injected whenever `dockerService.js` creates or recreates a container for a project where `projects.database_id IS NOT NULL` (Section 7.6).

| Trigger | Section |
|---|---|
| Initial project deployment | Section 7.8.2 (`createAndStartContainer`) |
| Database switch | Section 7.11.1 (container recreation with new credentials) |
| Resource update fallback | Section 7.11.2 (container recreation with same credentials) |
| Webhook rebuild | Section 7.9.4 (new container from rebuilt image with same credentials) |

### 9.7.2 Injected Environment Variables

| Variable | Value | Source |
|---|---|---|
| `DB_HOST` | `host.docker.internal` | Constant value (Section 3.2.12) |
| `DB_PORT` | Value of `MYSQL_PORT` from platform `.env` (typically `3306`) | Section 3.2.2 |
| `DB_USER` | Value of `databases.db_user` (e.g., `u42_mydb`) | Generated by `databaseProvisioningService.js` |
| `DB_PASSWORD` | Decrypted plaintext password from `databases.db_password_encrypted` | Decrypted at injection time via `decryptPassword()` (Section 9.5.2) |
| `DB_NAME` | Value of `databases.db_name` (e.g., `s42_mydb`) | Generated by `databaseProvisioningService.js` |

### 9.7.3 Injection Method

Docker CLI `-e` flags on `docker create` (Section 7.8.2):

```bash
docker create \
  ... \
  -e DB_HOST=host.docker.internal \
  -e DB_PORT=3306 \
  -e DB_USER=u42_mydb \
  -e DB_PASSWORD=randomBase64urlPassword32Chars \
  -e DB_NAME=s42_mydb \
  ...
```

### 9.7.4 No Database Attached

When `projects.database_id IS NULL`, no `DB_*` environment variables are injected (Section 7.6). The student application is responsible for handling the absence of these variables.

### 9.7.5 Database Switch

When a student switches the attached database via `PUT /api/projects/:id/database` (Section 6.5.4), the container is destroyed and recreated with the new database's credentials (or no `DB_*` variables if `databaseId` is `null`). The same port, subdomain, image, and resource limits are reused. No Nginx reconfiguration is required (Section 8.6.5).

## 9.8 Database Deletion Flow — `dropDatabase(dbNameColumn, dbUser)`

This flow is executed when a database record needs to be removed. Per Section 4.4, application-layer MySQL cleanup must occur **before** the `databases` row is deleted.

### 9.8.1 Deletion Triggers

| Trigger | Who Calls | When |
|---|---|---|
| Student deletes own database | Implicit in database management (no explicit delete endpoint is defined in Section 6.6 — see Section 9.8.2) |
| Admin removes a student | `adminController.removeStudent` (Section 6.4.4) — calls `dropAllDatabasesForStudent` |
| Admin batch-removes students | `adminController.batchRemoveStudents` (Section 6.4.5) — calls `dropAllDatabasesForStudent` per student |

AMBIGUITY DETECTED: Section 6.6 (Database Routes) does not define a `DELETE /api/databases/:id` endpoint. The only database routes are `POST /api/databases`, `GET /api/databases`, and `GET /api/databases/:id/phpmyadmin` (Section 6.6.4). There is no route for a student to delete their own database.
My decision: Students cannot delete their own databases via the API. Database deletion occurs only as part of student removal (admin action). This matches the spec which describes database creation and phpMyAdmin access for students but does not mention student-initiated database deletion. If a student needs a database removed, they contact the admin.

### 9.8.2 Pre-Deletion Check — Attached Projects

Before dropping a database, the service must check if any projects are attached to it (`projects.database_id` references this database). If any projects are attached:

| Scenario | Behavior |
|---|---|
| Student removal (all databases dropped) | All projects are being deleted in the same operation (Section 7.12.2); container cleanup happens before database cleanup. No conflict. |
| Standalone database deletion (if added in future) | The `database_id` foreign key uses `ON DELETE SET NULL` (Section 4.2.2), so deleting the `databases` row would set `projects.database_id = NULL`. Running containers would retain the injected `DB_*` variables until recreated. |

### 9.8.3 Teardown Steps

```
function dropDatabase(dbNameColumn, dbUser):

  Step 1: Obtain root MySQL connection
    connection = getRootConnection()

  Step 2: Revoke all privileges from the restricted user
    Execute: REVOKE ALL PRIVILEGES, GRANT OPTION
             FROM '{dbUser}'@'%'

  Step 3: Drop the restricted MySQL user
    Execute: DROP USER IF EXISTS '{dbUser}'@'%'

  Step 4: Drop the MySQL schema
    Execute: DROP DATABASE IF EXISTS `{dbNameColumn}`

  Step 5: Flush privileges
    Execute: FLUSH PRIVILEGES

  Step 6: Close root connection
    connection.close()
```

### 9.8.4 MySQL Commands — Exact SQL (Teardown)

```sql
-- Step 2: Revoke privileges
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'u42_mydb'@'%';

-- Step 3: Drop user
DROP USER IF EXISTS 'u42_mydb'@'%';

-- Step 4: Drop database
DROP DATABASE IF EXISTS `s42_mydb`;

-- Step 5: Flush privileges
FLUSH PRIVILEGES;
```

### 9.8.5 `IF EXISTS` Usage

Both `DROP USER` and `DROP DATABASE` use `IF EXISTS` to prevent errors if the MySQL user or schema was already removed (e.g., by a previous failed cleanup attempt or manual intervention). This makes the teardown idempotent.

### 9.8.6 Error Handling During Teardown

| Failure Point | Behavior |
|---|---|
| `REVOKE` fails (user doesn't exist) | Log warning; continue to `DROP USER` |
| `DROP USER` fails | Log error; continue to `DROP DATABASE` (schema should still be cleaned up) |
| `DROP DATABASE` fails | Log error; throw exception (caller must handle) |
| Any MySQL connection failure | Log error; throw exception (caller records in `failed` array for batch operations per Section 6.4.5) |

Teardown is best-effort: each step attempts to execute even if the previous step failed. This prevents cascading failures from leaving orphaned MySQL artifacts.

## 9.9 Student Removal — `dropAllDatabasesForStudent(userId)`

Called during student removal (Section 6.4.4) and batch removal (Section 6.4.5) as step 3 of the pre-delete cleanup sequence (Section 4.4).

### 9.9.1 Complete Student Removal Sequence (Database Portion)

The full pre-delete cleanup sequence from Section 4.4 is:

| Order | Step | Service | Section |
|---|---|---|---|
| 1 | Stop and remove all Docker containers for the student's projects | `dockerService.js` | Section 7.12.2 |
| 2 | Remove all Nginx configs for the student's projects and reload | `nginxService.js` | Section 8.6.5 |
| **3** | **Drop all MySQL schemas and restricted users for the student's databases** | **`databaseProvisioningService.js`** | **Section 9.9** |
| 4 | Delete all project source directories | `storageService.js` | Section 7.12.2 |
| 5 | Delete the `users` row (cascades to `databases`, `projects`, etc.) | SQL `DELETE` | Section 4.4 |

### 9.9.2 Implementation

```
function dropAllDatabasesForStudent(userId):

  Step 1: Query all database records for this student
    SELECT db_name, db_user FROM databases WHERE user_id = {userId}

  Step 2: For each database record, call dropDatabase
    FOR EACH record IN results:
      TRY:
        dropDatabase(record.db_name, record.db_user)
      CATCH (error):
        Log error with record details
        Continue to next record (do not abort the loop)

  Step 3: Return summary
    RETURN {
      totalDatabases: results.length,
      droppedSuccessfully: <count of successful drops>,
      failed: <array of db_name values that failed>
    }
```

### 9.9.3 Failure Handling

If any individual database teardown fails, the service logs the error and continues with the remaining databases. The caller (`adminController`) includes failed database IDs in error reporting. For batch removal (Section 6.4.5), if database cleanup fails for a student, that student's ID is recorded in the `failed` array but processing continues for remaining students.

### 9.9.4 Order Dependency

Database cleanup (step 3) must happen **after** container cleanup (step 1) because running containers may have active MySQL connections to the schemas being dropped. Dropping a schema while a container holds an active connection does not cause a MySQL error (the connection is severed), but stopping containers first ensures a clean teardown.

Database cleanup must happen **before** the SQL `DELETE FROM users` (step 5) because `ON DELETE CASCADE` removes the `databases` rows, after which the service would have no metadata to identify which MySQL schemas and users to drop.

## 9.10 phpMyAdmin Access Scoping

phpMyAdmin access is scoped at the MySQL privilege level, not the phpMyAdmin configuration level (Section 6.6.3).

### 9.10.1 How Scoping Works

| Layer | Mechanism |
|---|---|
| MySQL privileges | The restricted user (e.g., `u42_mydb`) has `ALL PRIVILEGES` on exactly one schema (e.g., `s42_mydb`). If the student navigates to any other schema in phpMyAdmin, MySQL returns an "access denied" error. |
| phpMyAdmin URL pre-selection | The phpMyAdmin link includes query parameters for convenience: `{PHPMYADMIN_URL}?server=1&db={schemaName}&user={dbUser}` (Section 6.6.3). This pre-selects the correct schema and username but does not enforce access. |
| phpMyAdmin signon authentication | The `POST /api/auth/phpmyadmin/verify` endpoint (Section 6.2.9) verifies that the student owns the database, then returns the decrypted credentials. phpMyAdmin's `signon.php` uses these credentials to establish a session. |

### 9.10.2 phpMyAdmin Verify Endpoint — Credential Return

When `POST /api/auth/phpmyadmin/verify` is called (Section 6.2.9), the endpoint:

1. Verifies the student's JWT access token.
2. Confirms the student owns the requested `databaseId`.
3. Decrypts `databases.db_password_encrypted` using `decryptPassword()`.
4. Returns the decrypted credentials:

```json
{
  "valid": true,
  "dbUser": "u42_mydb",
  "dbPassword": "<decrypted_plain_password>",
  "dbHost": "127.0.0.1",
  "dbName": "s42_mydb"
}
```

| Field | Value | Source |
|---|---|---|
| `dbUser` | `databases.db_user` (e.g., `u42_mydb`) | Section 9.3.2 |
| `dbPassword` | Decrypted plaintext from `databases.db_password_encrypted` | `decryptPassword()` (Section 9.5.2) |
| `dbHost` | `127.0.0.1` | phpMyAdmin connects to MySQL on the same host; this is the MySQL server address from phpMyAdmin's perspective, NOT `host.docker.internal` (which is used by student containers) |
| `dbName` | `databases.db_name` (e.g., `s42_mydb`) | Section 9.3.1 |

**Note on `dbHost`:** The `dbHost` returned by the phpMyAdmin verify endpoint is `127.0.0.1`, not `host.docker.internal`. phpMyAdmin runs as a Docker container in development and connects to MySQL at `host.docker.internal`, but the signon response uses the MySQL server address that phpMyAdmin's configuration already knows. In production where phpMyAdmin runs on the host, `127.0.0.1` is correct. The phpMyAdmin container's own MySQL connection host is configured in its environment (not by this endpoint). This endpoint returns credentials (user, password, database name) and the host for informational purposes.

## 9.11 Cross-Section Reference Map

This table maps every database provisioning touchpoint to its authoritative section.

| Concern | Authoritative Section | Key Details |
|---|---|---|
| `databases` table schema | Section 4.2.3 | Column definitions, indexes, constraints |
| `databases` foreign keys and cascade behavior | Section 4.3, Section 4.4 | `ON DELETE CASCADE` from `users`, application-layer cleanup |
| Environment variables for provisioning | Section 3.2.2 | `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_ROOT_PASSWORD` |
| Encryption key | Section 3.2.3 | `DB_ENCRYPTION_KEY` |
| AES-256-CBC encrypt/decrypt functions | Section 5.11 | `encryptPassword()`, `decryptPassword()` implementations |
| `POST /api/databases` — creation endpoint | Section 6.6.1 | Validation, request/response format, error codes |
| `GET /api/databases` — list endpoint | Section 6.6.2 | Response format including quota |
| `GET /api/databases/:id/phpmyadmin` — link endpoint | Section 6.6.3 | phpMyAdmin URL construction |
| `POST /api/auth/phpmyadmin/verify` — credential endpoint | Section 6.2.9 | Internal-only; returns decrypted credentials |
| Container credential injection | Section 7.6 | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` |
| `docker create` command with `-e` flags | Section 7.8.2 | Full command construction |
| Container recreation on database switch | Section 7.11.1 | Same port, subdomain, image; new credentials |
| Container cleanup on student removal | Section 7.12.2 | Full cleanup sequence |
| Nginx behavior on database switch | Section 8.6.5 | No config change; same port and subdomain |
| `databaseProvisioningService.js` file location | Section 2.3 | `backend/services/databaseProvisioningService.js` |
| `databaseController.js` file location | Section 2.3 | `backend/controllers/databaseController.js` |
| `Database.js` model file location | Section 2.3 | `backend/models/Database.js` |
| Injected container variables definition | Section 2.9 | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` |

## 9.12 Complete MySQL Artifact Lifecycle Summary

| Phase | MySQL Commands | Application Actions |
|---|---|---|
| **Provisioning** | `CREATE DATABASE`, `CREATE USER`, `GRANT ALL PRIVILEGES`, `FLUSH PRIVILEGES` | Generate names, generate password, encrypt password, insert `databases` row |
| **Runtime (injection)** | None | Decrypt `db_password_encrypted`, inject as `-e DB_PASSWORD` into container |
| **Runtime (phpMyAdmin)** | None | Decrypt `db_password_encrypted`, return to `signon.php` via verify endpoint |
| **Runtime (database switch)** | None | Decrypt new DB credentials, recreate container with new `-e` flags |
| **Teardown (single database)** | `REVOKE ALL PRIVILEGES`, `DROP USER`, `DROP DATABASE`, `FLUSH PRIVILEGES` | Delete `databases` row (via cascade or explicit delete) |
| **Teardown (student removal)** | Same as single, repeated for each database | Loop over all student databases; delete `users` row after (cascades `databases`) |
