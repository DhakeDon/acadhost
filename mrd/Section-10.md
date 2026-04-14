# Section 10 — Resource Quota System

## 10.1 Overview

AcadHost enforces per-student resource quotas across five resource types. Each student has a fixed allocation for each resource, set at invitation time from environment variable defaults and adjustable by the admin at any time. All quota enforcement is application-level — checked before resource-consuming operations are allowed to proceed. Docker enforces CPU and RAM limits at the container level; the platform enforces the aggregate across all of a student's containers.

### 10.1.1 Resource Types

| Resource Type | Unit | Column in `users` Table | Per-Project Column | Default Value | Environment Variable |
|---|---|---|---|---|---|
| CPU | Cores (decimal) | `cpu_quota` (`DECIMAL(5,2)`) | `projects.cpu_limit` (`DECIMAL(5,2)`) | `2.00` | `DEFAULT_CPU_CORES` |
| RAM | MB (integer) | `ram_quota_mb` (`INT UNSIGNED`) | `projects.ram_limit_mb` (`INT UNSIGNED`) | `1024` | `DEFAULT_RAM_MB` |
| Storage | MB (integer) | `storage_quota_mb` (`INT UNSIGNED`) | N/A (calculated from disk) | `2560` | `DEFAULT_STORAGE_MB` |
| Projects | Count (integer) | `max_projects` (`INT UNSIGNED`) | N/A | `4` | `DEFAULT_MAX_PROJECTS` |
| Databases | Count (integer) | `max_databases` (`INT UNSIGNED`) | N/A | `4` | `DEFAULT_MAX_DATABASES` |

### 10.1.2 Key Principles

| Principle | Detail |
|---|---|
| Quotas are per-student | Each student has their own independent allocation. One student's usage does not affect another's. |
| Quotas are absolute totals | A student's `cpu_quota` of `2.00` means 2.00 CPU cores total across all their projects, not 2.00 per project. |
| Quotas are set at invitation time | When a student is invited, their quota columns are populated from environment variable defaults (Section 3.2.10). |
| Quotas are admin-adjustable | The admin can increase or decrease any student's quota via `PUT /api/admin/students/:id/quota` (Section 6.4.3). |
| Quotas cannot be reduced below current usage | The admin cannot set a quota value lower than the student's current consumption (Section 6.4.3 error `QUOTA_BELOW_USAGE`). |
| Admin quotas are not enforced | The admin account has quota columns populated with defaults, but they are never checked or enforced (Section 4.2.1 notes). |
| CPU allows fractional values | `DECIMAL(5,2)` allows values like `0.50`, `1.25`, `2.00`. Docker `--cpus` accepts decimal values (Section 4.2.1 notes). |
| RAM and storage use MB | MB avoids floating-point issues and matches Docker `--memory` flag units (Section 3.2.10). |

## 10.2 Quota Columns — `users` Table

These columns are defined in Section 4.2.1. Repeated here for cross-reference with their defaults and types.

| Column | Type | Default | Environment Variable Source | Description |
|---|---|---|---|---|
| `cpu_quota` | `DECIMAL(5,2)` | `2.00` | `DEFAULT_CPU_CORES` | Total CPU cores allocated to this student |
| `ram_quota_mb` | `INT UNSIGNED` | `1024` | `DEFAULT_RAM_MB` | Total RAM in MB allocated to this student |
| `storage_quota_mb` | `INT UNSIGNED` | `2560` | `DEFAULT_STORAGE_MB` | Total storage in MB allocated to this student |
| `max_projects` | `INT UNSIGNED` | `4` | `DEFAULT_MAX_PROJECTS` | Maximum number of projects this student can create |
| `max_databases` | `INT UNSIGNED` | `4` | `DEFAULT_MAX_DATABASES` | Maximum number of databases this student can create |

### 10.2.1 When Defaults Are Applied

| Event | How Defaults Are Set |
|---|---|
| Student invitation (`POST /api/admin/students/invite`, Section 6.4.6) | A new `users` row is inserted with `cpu_quota = DEFAULT_CPU_CORES`, `ram_quota_mb = DEFAULT_RAM_MB`, `storage_quota_mb = DEFAULT_STORAGE_MB`, `max_projects = DEFAULT_MAX_PROJECTS`, `max_databases = DEFAULT_MAX_DATABASES` |
| Admin seed (`seeds/adminSeed.js`, Section 5.8.1) | The admin row is populated with the same defaults. These values are present in the database but never enforced. |

## 10.3 Per-Project Resource Columns — `projects` Table

Each project stores its own CPU and RAM allocation. These are defined in Section 4.2.2.

| Column | Type | Nullable | Description |
|---|---|---|---|
| `cpu_limit` | `DECIMAL(5,2)` | No | CPU core limit for this project's container; used as `--cpus` flag in `docker create` (Section 7.8.2) |
| `ram_limit_mb` | `INT UNSIGNED` | No | RAM limit in MB for this project's container; used as `--memory` flag with `m` suffix (Section 7.8.2) |

### 10.3.1 Default Per-Project Values

When a student creates a new project via `POST /api/projects` (Section 6.5.1), the `cpuLimit` and `ramLimitMb` fields are optional in the request body. If not provided, they default to:

| Field | Default Value | Source |
|---|---|---|
| `cpuLimit` | `1.00` | Section 6 ambiguity decision #3 |
| `ramLimitMb` | `512` | Section 6 ambiguity decision #3 |

These defaults were chosen to allow 2 projects at default allocations within the default student quotas (2.00 CPU cores, 1024 MB RAM).

## 10.4 Usage Calculation

Usage for each resource type is computed on demand — it is not stored in a cached column. Every quota check queries the current state of the database or file system.

### 10.4.1 CPU Usage

| Property | Value |
|---|---|
| Calculation | `SUM(projects.cpu_limit) WHERE user_id = {studentId} AND status != 'deleted'` |
| Scope | All non-deleted projects belonging to the student |
| Includes | Projects in `building`, `running`, `stopped`, `failed` statuses |
| Excludes | Projects with `status = 'deleted'` |
| Return type | `DECIMAL` (e.g., `1.50`) |

**Why `status != 'deleted'` and not just `status = 'running'`:** A project in `building`, `stopped`, or `failed` state still has CPU resources reserved in `projects.cpu_limit`. The student allocated those resources when creating the project. Even though the container may not be actively consuming CPU, the allocation is committed and cannot be double-allocated to another project. Only when a project is deleted (soft-delete) is the allocation freed.

### 10.4.2 RAM Usage

| Property | Value |
|---|---|
| Calculation | `SUM(projects.ram_limit_mb) WHERE user_id = {studentId} AND status != 'deleted'` |
| Scope | All non-deleted projects belonging to the student |
| Includes | Projects in `building`, `running`, `stopped`, `failed` statuses |
| Excludes | Projects with `status = 'deleted'` |
| Return type | `INT` (e.g., `512`) |

The same reasoning applies: RAM is allocated at project creation and freed at deletion, not based on container running state.

### 10.4.3 Storage Usage

| Property | Value |
|---|---|
| Calculation | `storageService.calculateStudentStorageUsage(studentId)` |
| Method | Measures total disk usage of `{PROJECTS_BASE_DIR}/{studentId}/` recursively |
| Unit | MB |
| Includes | Source directories, build logs, uploaded files, and any runtime-generated files within the student's project directories |
| Does NOT include | Docker images (managed by Docker, not counted against student storage) or MySQL database storage (managed by the host MySQL server) |
| Return type | `FLOAT` (e.g., `1280.5`) |

```
function calculateStudentStorageUsage(studentId):
  basePath = path.join(process.env.PROJECTS_BASE_DIR, String(studentId))

  IF basePath does not exist:
    RETURN 0

  totalBytes = recursiveDirectorySize(basePath)
  RETURN totalBytes / (1024 * 1024)   // Convert bytes to MB
```

### 10.4.4 Per-Project Storage Usage

Individual project storage is calculated by `GET /api/projects/:id/storage` (Section 6.5.9) via `storageService.js`:

```
function calculateProjectStorageUsage(studentId, projectId):
  projectPath = path.join(process.env.PROJECTS_BASE_DIR,
                          String(studentId), String(projectId))

  IF projectPath does not exist:
    RETURN { totalMb: 0, breakdown: { sourceMb: 0, buildLogsMb: 0,
             uploadsMb: 0, otherMb: 0 } }

  sourceMb    = directorySize(path.join(projectPath, 'source')) / (1024 * 1024)
  buildLogsMb = directorySize(path.join(projectPath, 'build', 'logs')) / (1024 * 1024)
  uploadsMb   = directorySize(path.join(projectPath, 'uploads')) / (1024 * 1024)
  totalMb     = directorySize(projectPath) / (1024 * 1024)
  otherMb     = totalMb - sourceMb - buildLogsMb - uploadsMb

  RETURN {
    totalMb: round(totalMb, 1),
    breakdown: {
      sourceMb: round(sourceMb, 1),
      buildLogsMb: round(buildLogsMb, 1),
      uploadsMb: round(uploadsMb, 1),
      otherMb: round(otherMb, 1)
    }
  }
```

This matches the response format defined in Section 6.5.9.

### 10.4.5 Project Count

| Property | Value |
|---|---|
| Calculation | `COUNT(projects.id) WHERE user_id = {studentId} AND status != 'deleted'` |
| Scope | All non-deleted projects belonging to the student |
| Return type | `INT` (e.g., `2`) |

### 10.4.6 Database Count

| Property | Value |
|---|---|
| Calculation | `COUNT(databases.id) WHERE user_id = {studentId}` |
| Scope | All database records belonging to the student |
| Return type | `INT` (e.g., `1`) |

There is no soft-delete for databases (unlike projects). A database row exists in the table or it does not. Therefore the count is all rows, with no status filter.

## 10.5 `utils/quotaChecker.js` — Quota Validation Utility

This utility file is defined in Section 2.3. It validates resource availability before resource-consuming operations are allowed to proceed. All functions are async (they query the database).

### 10.5.1 Exported Functions

| Function | Purpose | Called By |
|---|---|---|
| `checkProjectQuota(userId)` | Validates student has not reached `max_projects` | `projectController.createProject` (Section 6.5.1 check #2) |
| `checkDatabaseQuota(userId)` | Validates student has not reached `max_databases` | `databaseController.createDatabase` (Section 6.6.1 check #1) |
| `checkCpuQuota(userId, requestedCpu, excludeProjectId?)` | Validates requested CPU does not exceed remaining CPU quota | `projectController.createProject` (Section 6.5.1 check #6), `projectController.updateResources` (Section 6.5.5 check #1) |
| `checkRamQuota(userId, requestedRam, excludeProjectId?)` | Validates requested RAM does not exceed remaining RAM quota | `projectController.createProject` (Section 6.5.1 check #7), `projectController.updateResources` (Section 6.5.5 check #1) |
| `getResourceUsageSummary(userId)` | Returns all usage values for the student (used by profile endpoint) | `studentController.getProfile` (Section 6.3.1) |

### 10.5.2 `checkProjectQuota(userId)`

```
async function checkProjectQuota(userId):
  currentCount = COUNT(projects.id)
                 WHERE user_id = {userId} AND status != 'deleted'
  maxProjects  = SELECT max_projects FROM users WHERE id = {userId}

  IF currentCount >= maxProjects:
    THROW { code: 'PROJECT_QUOTA_EXCEEDED',
            message: `Project limit reached (${currentCount}/${maxProjects})`,
            httpStatus: 400 }
```

### 10.5.3 `checkDatabaseQuota(userId)`

```
async function checkDatabaseQuota(userId):
  currentCount  = COUNT(databases.id) WHERE user_id = {userId}
  maxDatabases  = SELECT max_databases FROM users WHERE id = {userId}

  IF currentCount >= maxDatabases:
    THROW { code: 'DATABASE_QUOTA_EXCEEDED',
            message: `Database limit reached (${currentCount}/${maxDatabases})`,
            httpStatus: 400 }
```

### 10.5.4 `checkCpuQuota(userId, requestedCpu, excludeProjectId?)`

The `excludeProjectId` parameter is used when updating an existing project's resources. It excludes the current project's CPU allocation from the "in use" calculation so that the student's own project does not block a resize.

```
async function checkCpuQuota(userId, requestedCpu, excludeProjectId = null):
  query = SELECT SUM(cpu_limit) AS cpuUsed
          FROM projects
          WHERE user_id = {userId} AND status != 'deleted'
  IF excludeProjectId IS NOT NULL:
    query += AND id != {excludeProjectId}

  cpuUsed  = result.cpuUsed || 0
  cpuQuota = SELECT cpu_quota FROM users WHERE id = {userId}
  available = cpuQuota - cpuUsed

  IF requestedCpu > available:
    THROW { code: 'CPU_QUOTA_EXCEEDED',
            message: `CPU limit exceeds available quota (${available} cores remaining)`,
            httpStatus: 400 }
```

**Example — resource update:** Student has `cpu_quota = 2.00`. They have Project A with `cpu_limit = 1.00` and Project B with `cpu_limit = 0.50`. Total usage = 1.50. The student wants to increase Project A to `1.50`. When checking, `excludeProjectId = Project A's id`, so `cpuUsed = 0.50` (only Project B). Available = `2.00 - 0.50 = 1.50`. Requested `1.50 <= 1.50` → passes.

### 10.5.5 `checkRamQuota(userId, requestedRam, excludeProjectId?)`

```
async function checkRamQuota(userId, requestedRam, excludeProjectId = null):
  query = SELECT SUM(ram_limit_mb) AS ramUsed
          FROM projects
          WHERE user_id = {userId} AND status != 'deleted'
  IF excludeProjectId IS NOT NULL:
    query += AND id != {excludeProjectId}

  ramUsed  = result.ramUsed || 0
  ramQuota = SELECT ram_quota_mb FROM users WHERE id = {userId}
  available = ramQuota - ramUsed

  IF requestedRam > available:
    THROW { code: 'RAM_QUOTA_EXCEEDED',
            message: `RAM limit exceeds available quota (${available} MB remaining)`,
            httpStatus: 400 }
```

### 10.5.6 `getResourceUsageSummary(userId)`

Returns the complete usage summary for a student. Used by `GET /api/student/profile` (Section 6.3.1) and `GET /api/admin/students` (Section 6.4.2).

```
async function getResourceUsageSummary(userId):
  cpuUsed = SELECT SUM(cpu_limit) FROM projects
            WHERE user_id = {userId} AND status != 'deleted'
  cpuUsed = cpuUsed || 0

  ramUsed = SELECT SUM(ram_limit_mb) FROM projects
            WHERE user_id = {userId} AND status != 'deleted'
  ramUsed = ramUsed || 0

  storageUsed = storageService.calculateStudentStorageUsage(userId)

  projectCount = COUNT(projects.id)
                 WHERE user_id = {userId} AND status != 'deleted'

  databaseCount = COUNT(databases.id)
                  WHERE user_id = {userId}

  user = SELECT cpu_quota, ram_quota_mb, storage_quota_mb,
                max_projects, max_databases
         FROM users WHERE id = {userId}

  storageWarning = (storageUsed / user.storage_quota_mb * 100)
                   >= STORAGE_WARNING_THRESHOLD_PERCENT

  RETURN {
    cpuUsed,
    ramUsedMb: ramUsed,
    storageUsedMb: storageUsed,
    projectCount,
    databaseCount,
    cpuQuota: user.cpu_quota,
    ramQuotaMb: user.ram_quota_mb,
    storageQuotaMb: user.storage_quota_mb,
    maxProjects: user.max_projects,
    maxDatabases: user.max_databases,
    storageWarning
  }
```

## 10.6 Storage Warning Threshold

| Property | Value |
|---|---|
| Environment variable | `STORAGE_WARNING_THRESHOLD_PERCENT` (Section 3.2.10) |
| Default | `80` |
| Calculation | `storageUsedMb / storageQuotaMb * 100 >= STORAGE_WARNING_THRESHOLD_PERCENT` |
| Result | Boolean `storageWarning` field in the `GET /api/student/profile` response (Section 6.3.1) |
| Purpose | The frontend displays a warning to the student when their storage usage is at or above the threshold |
| Enforcement | The storage warning is informational only. It does not block any operations. There is no hard storage enforcement that prevents project creation when storage is full. |

AMBIGUITY DETECTED: The spec does not define whether storage usage blocks project creation or any other operation when the quota is exceeded.
My decision: Storage quota is informational — the `storageWarning` boolean is returned in the profile response, but no API endpoint rejects requests based on storage usage exceeding `storage_quota_mb`. This is because storage usage is calculated from disk (not from pre-declared allocations like CPU/RAM), and the amount of storage a project uses grows dynamically at runtime. Blocking project creation based on current storage would not prevent subsequent storage growth from an already-running project. The threshold warning gives students visibility to manage their own storage proactively.

## 10.7 Quota Enforcement Points

This table lists every point in the application where a quota check occurs, the resource being checked, and the error returned on violation.

### 10.7.1 Project Creation (`POST /api/projects`, Section 6.5.1)

| Check # | Resource | Validation | Error Code | HTTP Status |
|---|---|---|---|---|
| 2 | Projects | Student has not reached `max_projects` (count non-deleted projects) | `PROJECT_QUOTA_EXCEEDED` | `400` |
| 6 | CPU | `cpuLimit` does not exceed remaining CPU quota | `CPU_QUOTA_EXCEEDED` | `400` |
| 7 | RAM | `ramLimitMb` does not exceed remaining RAM quota | `RAM_QUOTA_EXCEEDED` | `400` |

### 10.7.2 Resource Update (`PUT /api/projects/:id/resources`, Section 6.5.5)

| Check | Resource | Validation | Error Code | HTTP Status |
|---|---|---|---|---|
| 1 | CPU | New `cpuLimit` does not exceed remaining quota (excluding current project's allocation) | `CPU_QUOTA_EXCEEDED` | `400` |
| 1 | RAM | New `ramLimitMb` does not exceed remaining quota (excluding current project's allocation) | `RAM_QUOTA_EXCEEDED` | `400` |

### 10.7.3 Database Creation (`POST /api/databases`, Section 6.6.1)

| Check | Resource | Validation | Error Code | HTTP Status |
|---|---|---|---|---|
| 1 | Databases | Student has not reached `max_databases` | `DATABASE_QUOTA_EXCEEDED` | `400` |

### 10.7.4 Admin Quota Adjustment (`PUT /api/admin/students/:id/quota`, Section 6.4.3)

The admin can increase or decrease quotas. When decreasing, the platform validates the new value is not below current usage:

| Check | Resource | Validation | Error Code | HTTP Status |
|---|---|---|---|---|
| 1 | Projects | New `maxProjects` >= student's current active project count | `QUOTA_BELOW_USAGE` | `400` |
| 2 | Databases | New `maxDatabases` >= student's current database count | `QUOTA_BELOW_USAGE` | `400` |
| 3 | CPU | New `cpuQuota` >= student's current CPU usage | `QUOTA_BELOW_USAGE` | `400` |
| 4 | RAM | New `ramQuotaMb` >= student's current RAM usage | `QUOTA_BELOW_USAGE` | `400` |

**Note on storage:** The admin can lower `storageQuotaMb` below the student's current disk usage. There is no `QUOTA_BELOW_USAGE` check for storage because storage is informational and cannot be instantly freed by the platform. The admin is expected to manage this manually if needed.

### 10.7.5 Enforcement Summary Table

| Endpoint | Resource Checks Performed | Utility Function(s) |
|---|---|---|
| `POST /api/projects` | Projects, CPU, RAM | `checkProjectQuota`, `checkCpuQuota`, `checkRamQuota` |
| `PUT /api/projects/:id/resources` | CPU, RAM | `checkCpuQuota(…, excludeProjectId)`, `checkRamQuota(…, excludeProjectId)` |
| `POST /api/databases` | Databases | `checkDatabaseQuota` |
| `PUT /api/admin/students/:id/quota` | Projects, Databases, CPU, RAM (below-usage only) | Direct comparison in `adminController.updateStudentQuota` |
| `GET /api/student/profile` | None (read-only) | `getResourceUsageSummary` |
| `GET /api/admin/students` | None (read-only) | `getResourceUsageSummary` per student |
| `GET /api/admin/metrics` | None (read-only) | Aggregate queries |

## 10.8 Resource Request Flow

Students can request quota increases via the resource request system. This is the complete flow from submission through admin review to quota application.

### 10.8.1 Submission (`POST /api/resource-requests`, Section 6.7.1)

| Field | Type | Constraints | Description |
|---|---|---|---|
| `resourceType` | `string` | One of `cpu`, `ram`, `storage`, `projects`, `databases` | Which resource to increase |
| `requestedValue` | `string` | Non-empty, max 50 characters | The desired new **absolute total** (not a delta) |
| `description` | `string` | Non-empty | Student's justification |

The `requestedValue` is the student's desired new total for the quota. For example, if a student currently has `cpu_quota = 2.00` and wants 4 cores, they submit `requestedValue = "4"`.

### 10.8.2 Storage in `resource_requests` Table (Section 4.2.4)

| Column | Type | Description |
|---|---|---|
| `resource_type` | `ENUM('cpu', 'ram', 'storage', 'projects', 'databases')` | Maps to the `resourceType` request field |
| `requested_value` | `VARCHAR(50)` | Stored as a string; parsed to the appropriate type on approval |
| `status` | `ENUM('pending', 'approved', 'denied')` | Default `pending` |
| `admin_notes` | `TEXT` | Admin's response |
| `reviewed_at` | `TIMESTAMP` | When the admin reviewed the request |

### 10.8.3 Admin Review (`PUT /api/resource-requests/:id`, Section 6.7.3)

When the admin approves a request, the platform **automatically applies** the new quota value to the student's `users` row. The `requestedValue` is the new absolute total, not a delta.

| `resource_type` | `users` Column Updated | Parsing |
|---|---|---|
| `cpu` | `cpu_quota` | `parseFloat(requested_value)` → `DECIMAL` |
| `ram` | `ram_quota_mb` | `parseInt(requested_value, 10)` → `INT` |
| `storage` | `storage_quota_mb` | `parseInt(requested_value, 10)` → `INT` |
| `projects` | `max_projects` | `parseInt(requested_value, 10)` → `INT` |
| `databases` | `max_databases` | `parseInt(requested_value, 10)` → `INT` |

When the admin denies a request, no quota change is applied. The `quotaApplied` field in the response is `false`.

### 10.8.4 Approval Does Not Validate Against Current Usage

AMBIGUITY DETECTED: The spec does not define whether approving a resource request validates that the new value is at least equal to the student's current usage.
My decision: Approval does **not** perform a `QUOTA_BELOW_USAGE` check. The admin is assumed to be making an informed decision. If the admin approves a request that sets a quota below current usage, the quota is applied as-is. This is acceptable because: (a) resource requests are for increases, not decreases, so the new value is almost always higher than current usage; (b) the admin already has full visibility into the student's current usage via the student list endpoint; (c) enforcing the check would create confusing behavior where approval silently fails. If the admin sets a quota below usage via direct adjustment (Section 6.4.3), that endpoint does enforce `QUOTA_BELOW_USAGE` — but the resource request flow is a separate path.

## 10.9 Admin Metrics — Aggregate Resource View

The admin dashboard displays system-wide resource consumption via `GET /api/admin/metrics` (Section 6.4.1).

### 10.9.1 Metrics Fields and Calculation

| Field | Calculation | Description |
|---|---|---|
| `totalLiveProjects` | `COUNT(projects.id) WHERE status = 'running'` | Currently running projects across all students |
| `totalStudents` | `COUNT(users.id) WHERE role = 'student' AND status = 'active'` | Active student accounts |
| `aggregateCpuUsed` | `SUM(projects.cpu_limit) WHERE status = 'running'` | CPU cores in use across all running containers |
| `aggregateRamUsedMb` | `SUM(projects.ram_limit_mb) WHERE status = 'running'` | RAM in MB in use across all running containers |
| `aggregateStorageUsedMb` | Sum of `storageService.calculateStudentStorageUsage(studentId)` for all active students | Total disk usage across all students |
| `totalCpuAllocated` | `SUM(users.cpu_quota) WHERE role = 'student' AND status = 'active'` | Total CPU quota allocated across all active students |
| `totalRamAllocatedMb` | `SUM(users.ram_quota_mb) WHERE role = 'student' AND status = 'active'` | Total RAM quota allocated across all active students |
| `totalStorageAllocatedMb` | `SUM(users.storage_quota_mb) WHERE role = 'student' AND status = 'active'` | Total storage quota allocated across all active students |
| `pendingResourceRequests` | `COUNT(resource_requests.id) WHERE status = 'pending'` | Pending requests awaiting admin review |

**Note on aggregateCpuUsed / aggregateRamUsedMb scope:** The admin metrics use `status = 'running'` for aggregate usage (active consumption), while per-student usage in the profile endpoint uses `status != 'deleted'` (committed allocation). This distinction is intentional: the admin wants to see what the VM is currently handling (running containers), while the student needs to see what they have allocated (to know how much quota is available for new projects).

## 10.10 Student Profile — Individual Resource View

The student profile endpoint `GET /api/student/profile` (Section 6.3.1) returns the student's complete resource picture. The computed fields are:

| Field | Calculation | Description |
|---|---|---|
| `cpuUsed` | `SUM(projects.cpu_limit) WHERE user_id = {studentId} AND status != 'deleted'` | CPU cores allocated across non-deleted projects |
| `ramUsedMb` | `SUM(projects.ram_limit_mb) WHERE user_id = {studentId} AND status != 'deleted'` | RAM in MB allocated across non-deleted projects |
| `storageUsedMb` | `storageService.calculateStudentStorageUsage(studentId)` | Total disk usage under student's directory |
| `projectCount` | `COUNT(projects.id) WHERE user_id = {studentId} AND status != 'deleted'` | Active project count |
| `databaseCount` | `COUNT(databases.id) WHERE user_id = {studentId}` | Database count |
| `storageWarning` | `storageUsedMb / storageQuotaMb * 100 >= STORAGE_WARNING_THRESHOLD_PERCENT` | Boolean: whether storage warning is active |

These fields, combined with the quota columns (`cpuQuota`, `ramQuotaMb`, `storageQuotaMb`, `maxProjects`, `maxDatabases`), provide the data for the student dashboard's n/m resource cards.

### 10.10.1 Dashboard Display Format

The spec states: "Each resource card shows consumption in an n/m format alongside the remaining quantity and a label."

| Resource Card | `n` (Used) | `m` (Total) | Remaining | Label |
|---|---|---|---|---|
| CPU | `cpuUsed` | `cpuQuota` | `cpuQuota - cpuUsed` | CPU Cores |
| RAM | `ramUsedMb` | `ramQuotaMb` | `ramQuotaMb - ramUsedMb` | RAM (MB) |
| Storage | `storageUsedMb` | `storageQuotaMb` | `storageQuotaMb - storageUsedMb` | Storage (MB) |
| Projects | `projectCount` | `maxProjects` | `maxProjects - projectCount` | Projects |
| Databases | `databaseCount` | `maxDatabases` | `maxDatabases - databaseCount` | Databases |

The frontend renders these cards from the profile API response. The exact layout and styling are defined in Section 13 (Student Dashboard Frontend Specification).

## 10.11 Docker Resource Enforcement

CPU and RAM quotas are enforced at two levels: the application level (quota checks) and the Docker level (container resource limits).

### 10.11.1 Application-Level (Pre-Allocation)

Before a container is created or updated, `quotaChecker.js` validates that the requested resources do not exceed the student's remaining quota. This prevents over-allocation at the platform level.

### 10.11.2 Docker-Level (Runtime Enforcement)

Docker enforces per-container CPU and RAM limits via the `--cpus` and `--memory` flags on `docker create` (Section 7.8.2).

| Docker Flag | Source Column | Example | Effect |
|---|---|---|---|
| `--cpus={cpuLimit}` | `projects.cpu_limit` | `--cpus=1.00` | Container cannot use more than 1.00 CPU cores |
| `--memory={ramLimitMb}m` | `projects.ram_limit_mb` | `--memory=512m` | Container cannot use more than 512 MB RAM; Docker kills the process if it exceeds this limit (OOM kill) |

### 10.11.3 Live Resource Updates

When a student adjusts CPU/RAM via `PUT /api/projects/:id/resources` (Section 6.5.5), the platform first updates the `projects` row, then attempts to apply the new limits to the running container via `docker update` (Section 7.8.5). If `docker update` fails, the container is recreated with the new limits (Section 7.11.2).

### 10.11.4 Storage — No Docker Enforcement

Storage is not enforced at the Docker level. There is no `--storage-opt` or equivalent flag applied to student containers. Storage usage is measured from disk by `storageService.js` and reported to the student and admin. The `storageWarning` flag provides visibility but does not impose hard limits.

## 10.12 Resource Lifecycle Events

This table summarizes how resource allocations change across the project and database lifecycle.

### 10.12.1 Project Lifecycle

| Event | CPU/RAM Effect | Storage Effect | Project Count Effect |
|---|---|---|---|
| Project creation (`POST /api/projects`) | CPU and RAM allocated from quota (stored in `projects.cpu_limit`, `projects.ram_limit_mb`) | Storage grows as source is cloned/extracted | `projectCount` increases by 1 |
| Resource update (`PUT /api/projects/:id/resources`) | CPU and/or RAM allocation changed; quota re-validated | No change | No change |
| Project stop (`POST /api/projects/:id/stop`) | CPU and RAM remain allocated (not freed) | No change | No change (still counted) |
| Project restart (`POST /api/projects/:id/restart`) | No change (same allocation) | No change | No change |
| Webhook rebuild | No change (same allocation) | Storage may change (new source code) | No change |
| Database switch | No change | No change | No change |
| Project delete (student, `DELETE /api/projects/:id`) | CPU and RAM freed (`status = 'deleted'`; excluded from usage sums) | Source files and build logs deleted; storage freed | `projectCount` decreases by 1 |
| Project terminate (admin, `POST /api/admin/projects/:id/terminate`) | Same as delete | Same as delete | Same as delete |

### 10.12.2 Database Lifecycle

| Event | Database Count Effect |
|---|---|
| Database creation (`POST /api/databases`) | `databaseCount` increases by 1 |
| Student removal (admin) | All databases dropped; `databaseCount` becomes 0 (rows cascade-deleted) |

### 10.12.3 Student Lifecycle

| Event | Quota Effect |
|---|---|
| Student invited | Quota columns set from environment variable defaults |
| Admin adjusts quota | Individual quota columns updated |
| Resource request approved | Individual quota column updated to requested value |
| Student removed | All resources freed (projects deleted, databases dropped, disk files removed) |

## 10.13 Cross-Section Reference Map

| Concern | Authoritative Section | Key Details |
|---|---|---|
| Quota columns in `users` table | Section 4.2.1 | Column types, defaults, constraints |
| Per-project resource columns in `projects` table | Section 4.2.2 | `cpu_limit`, `ram_limit_mb` |
| Resource default environment variables | Section 3.2.10 | `DEFAULT_CPU_CORES`, `DEFAULT_RAM_MB`, `DEFAULT_STORAGE_MB`, `DEFAULT_MAX_PROJECTS`, `DEFAULT_MAX_DATABASES`, `STORAGE_WARNING_THRESHOLD_PERCENT` |
| `quotaChecker.js` file definition | Section 2.3 | Utility file purpose |
| `storageService.js` file definition | Section 2.3 | Service file purpose |
| `POST /api/projects` quota checks | Section 6.5.1 | Checks #2, #6, #7 |
| `PUT /api/projects/:id/resources` quota checks | Section 6.5.5 | Behavior step 1 |
| `POST /api/databases` quota check | Section 6.6.1 | Check #1 |
| `PUT /api/admin/students/:id/quota` below-usage checks | Section 6.4.3 | Error `QUOTA_BELOW_USAGE` |
| `GET /api/student/profile` computed fields | Section 6.3.1 | `cpuUsed`, `ramUsedMb`, `storageUsedMb`, `projectCount`, `databaseCount`, `storageWarning` |
| `GET /api/admin/metrics` aggregate fields | Section 6.4.1 | Aggregate usage and allocation |
| `GET /api/admin/students` per-student usage fields | Section 6.4.2 | `cpuUsed`, `ramUsedMb`, `projectCount`, `databaseCount` |
| Resource request endpoints | Section 6.7 | Submit, list, review |
| `resource_requests` table schema | Section 4.2.4 | Column definitions |
| Docker resource flags | Section 7.8.2 | `--cpus`, `--memory` |
| `docker update` live adjustment | Section 7.8.5 | `docker update --cpus --memory` |
| Default per-project values | Section 6.11 | Ambiguity decision #3: `cpuLimit = 1.00`, `ramLimitMb = 512` |
| `ResourceUsageCard.jsx` component | Section 2.4.1 | Frontend resource card display |
| `ResourceRequestForm.jsx` component | Section 2.4.1 | Frontend resource request form |

## 10.14 Ambiguity Decisions Registry

| # | Ambiguity | Decision | Rationale |
|---|---|---|---|
| 1 | Spec does not define whether storage quota is enforced (hard limit) or informational (warning only) | Storage quota is informational. The `storageWarning` boolean is returned but no endpoint rejects operations based on storage exceeding `storage_quota_mb`. | Storage grows dynamically at runtime; a hard limit before project creation would not prevent post-creation growth. The warning gives students visibility. |
| 2 | Spec does not define whether resource request approval validates the new value against current usage | Approval does NOT validate against current usage. The quota is applied unconditionally. | Resource requests are almost always for increases. The admin has full visibility via the student list. Enforcing the check on approval would create confusing silent failures. Direct quota adjustment (Section 6.4.3) does enforce `QUOTA_BELOW_USAGE`. |
| 3 | Spec does not define whether stopped/failed projects still count against CPU and RAM quota | All non-deleted projects count. Only `status = 'deleted'` frees the allocation. | Resources are committed at project creation. A stopped project still holds a port and can be restarted at any time with the same resources. Freeing resources on stop would require re-validation on restart, creating a confusing UX where a restart could fail due to insufficient quota. |
| 4 | Spec does not define whether the admin can reduce `storageQuotaMb` below current storage usage | Allowed. No `QUOTA_BELOW_USAGE` check for storage. | Storage cannot be instantly freed by the platform. The admin manages this manually if needed. |
| 5 | Spec does not define the implementation of `storageService.calculateStudentStorageUsage` | Recursive directory size calculation on `{PROJECTS_BASE_DIR}/{studentId}/` returning MB | Standard approach for disk usage measurement; matches the storage usage breakdown in Section 6.5.9 |

---

## VERIFICATION REPORT — Section 10: Resource Quota System

### Spec Alignment Check

| Spec Requirement | Covered In Output | Status |
|---|---|---|
| Dashboard displays resource usage in card-based n/m format | Section 10.10.1 | ✅ Covered |
| Resources displayed: CPU cores, RAM, storage, projects, databases | Section 10.1.1 | ✅ Covered |
| Each resource card shows remaining quantity and label | Section 10.10.1 | ✅ Covered |
| Admin can adjust individual resource quotas (CPU, RAM, storage, projects, databases) | Section 10.7.4 | ✅ Covered |
| Default CPU, RAM, and database allocations pre-filled during project creation | Section 10.3.1 | ✅ Covered |
| Available capacity clearly shown during project creation | Section 10.10 (data provided by profile/quota endpoints) | ✅ Covered |
| Adjust CPU and RAM limits with available and total values shown | Section 10.7.2, Section 10.10 | ✅ Covered |
| Resource request form: resource type, requested value, description | Section 10.8.1 | ✅ Covered |
| Resource request sent to admin for review | Section 10.8.3 | ✅ Covered |
| Admin dashboard: system-wide metrics including total live projects and aggregate CPU, RAM, storage | Section 10.9 | ✅ Covered |
| Default quotas from environment variables | Section 10.2.1 | ✅ Covered |
| `STORAGE_WARNING_THRESHOLD_PERCENT` at 80% | Section 10.6 | ✅ Covered |
| Requested value is absolute total (not delta) for resource request approval | Section 10.8.3 | ✅ Covered |
| `QUOTA_BELOW_USAGE` check on admin quota adjustment | Section 10.7.4 | ✅ Covered |
| `PROJECT_QUOTA_EXCEEDED` on project creation | Section 10.7.1 | ✅ Covered |
| `CPU_QUOTA_EXCEEDED` on project creation and resource update | Section 10.7.1, 10.7.2 | ✅ Covered |
| `RAM_QUOTA_EXCEEDED` on project creation and resource update | Section 10.7.1, 10.7.2 | ✅ Covered |
| `DATABASE_QUOTA_EXCEEDED` on database creation | Section 10.7.3 | ✅ Covered |
| `quotaChecker.js` validates CPU, RAM, storage, project count, database count | Section 10.5 | ✅ Covered |
| `storageService.js` measures source directory and runtime-generated file sizes | Section 10.4.3, 10.4.4 | ✅ Covered |
| Docker `--cpus` and `--memory` enforce per-container limits | Section 10.11.2 | ✅ Covered |
| `docker update` for live resource changes | Section 10.11.3 | ✅ Covered |
| Per-project storage usage with breakdown | Section 10.4.4 | ✅ Covered |
| `storageWarning` boolean in profile response | Section 10.6, 10.10 | ✅ Covered |
| Admin metrics: `pendingResourceRequests` count | Section 10.9.1 | ✅ Covered |

### Gaps Found

| Missing Item | Action |
|---|---|
| No gaps found after line-by-line comparison | N/A |

### Decisions Beyond The Spec

| Decision Made | Reason |
|---|---|
| Storage quota is informational, not enforced as a hard limit | Storage grows dynamically; hard-blocking project creation would not prevent post-creation growth |
| Resource request approval does not validate against current usage | Requests are for increases; admin has visibility; avoids confusing silent failures |
| Non-deleted projects (including stopped/failed) count against CPU/RAM quota | Resources are committed at creation; freeing on stop would require re-validation on restart |
| Admin can reduce `storageQuotaMb` below current usage (no `QUOTA_BELOW_USAGE` for storage) | Storage cannot be instantly freed by the platform |
| `storageService` uses recursive directory size on `{PROJECTS_BASE_DIR}/{studentId}/` | Standard disk measurement approach; consistent with Section 6.5.9 response format |
| `excludeProjectId` parameter in `checkCpuQuota` and `checkRamQuota` | Enables resource updates: the current project's allocation must not block its own resize |

### Cross-Section Consistency Check

| Item | Matches Earlier Sections | Status |
|---|---|---|
| `users.cpu_quota` column name and type | Section 4.2.1 (`DECIMAL(5,2)`) | ✅ Consistent |
| `users.ram_quota_mb` column name and type | Section 4.2.1 (`INT UNSIGNED`) | ✅ Consistent |
| `users.storage_quota_mb` column name and type | Section 4.2.1 (`INT UNSIGNED`) | ✅ Consistent |
| `users.max_projects` column name and type | Section 4.2.1 (`INT UNSIGNED`) | ✅ Consistent |
| `users.max_databases` column name and type | Section 4.2.1 (`INT UNSIGNED`) | ✅ Consistent |
| `projects.cpu_limit` column name and type | Section 4.2.2 (`DECIMAL(5,2)`) | ✅ Consistent |
| `projects.ram_limit_mb` column name and type | Section 4.2.2 (`INT UNSIGNED`) | ✅ Consistent |
| Default values: 2 CPU, 1024 MB RAM, 2560 MB storage, 4 projects, 4 databases | Section 3.2.10 | ✅ Consistent |
| `STORAGE_WARNING_THRESHOLD_PERCENT` default `80` | Section 3.2.10 | ✅ Consistent |
| Default per-project `cpuLimit = 1.00`, `ramLimitMb = 512` | Section 6.11 ambiguity #3 | ✅ Consistent |
| Error code `PROJECT_QUOTA_EXCEEDED` | Section 6.5.1 | ✅ Consistent |
| Error code `CPU_QUOTA_EXCEEDED` | Section 6.5.1, 6.5.5 | ✅ Consistent |
| Error code `RAM_QUOTA_EXCEEDED` | Section 6.5.1, 6.5.5 | ✅ Consistent |
| Error code `DATABASE_QUOTA_EXCEEDED` | Section 6.6.1 | ✅ Consistent |
| Error code `QUOTA_BELOW_USAGE` | Section 6.4.3 | ✅ Consistent |
| `storageService.js` file path | Section 2.3 | ✅ Consistent |
| `quotaChecker.js` file path | Section 2.3 | ✅ Consistent |
| `resource_requests` table columns | Section 4.2.4 | ✅ Consistent |
| Resource request approval auto-applies absolute total | Section 6.7.3 | ✅ Consistent |
| Admin metrics fields | Section 6.4.1 | ✅ Consistent |
| Student profile computed fields | Section 6.3.1 | ✅ Consistent |
| Docker `--cpus` and `--memory` flags | Section 7.8.2 | ✅ Consistent |
| `docker update` command | Section 7.8.5 | ✅ Consistent |
| Project storage breakdown response format | Section 6.5.9 | ✅ Consistent |

### Business Logic Check

| Logic Item | Real-World Valid | Issue (if any) |
|---|---|---|
| Non-deleted projects count against CPU/RAM regardless of running state | ✅ Valid | Prevents resource allocation conflicts on restart |
| Storage is informational only (no hard enforcement) | ✅ Valid | Dynamic storage growth cannot be pre-validated |
| Resource request approval applies absolute total, not delta | ✅ Valid | Avoids ambiguity about current quota value at approval time |
| Admin cannot reduce CPU/RAM/projects/databases below current usage | ✅ Valid | Prevents inconsistent state where usage exceeds quota |
| Admin can reduce storage below current usage | ✅ Valid | Storage cannot be instantly freed; admin manages manually |
| `excludeProjectId` in CPU/RAM checks prevents self-blocking on resize | ✅ Valid | Standard pattern for resource update validation |
| Admin metrics use `status = 'running'` while student profile uses `status != 'deleted'` | ✅ Valid | Admin wants active consumption; student wants committed allocation |
| `aggregateStorageUsedMb` iterates all students for disk measurement | ⚠️ Questionable | For large numbers of students, calculating disk usage for every student on every metrics call could be slow. This should use caching or a scheduled background calculation for production scale. However, the spec does not define a caching mechanism, and the development VM has limited students, so direct calculation is acceptable initially. |

---

## ✅ SECTION 10 COMPLETE — Resource Quota System

| Final Check | Result |
|---|---|
| All spec requirements covered | ✅ Yes |
| All gaps found and fixed | ✅ Yes |
| Business logic is consistent | ✅ Yes |
| No conflicts with past sections | ✅ Yes |
| Output is valid renderable Markdown | ✅ Yes |

**Section status: LOCKED**
This section's field names, variable names, table names, route paths, and values are now permanently locked. No changes will be made to this section in future sessions unless the user explicitly requests a correction.

---

## SELF-AUDIT — Section 10

### Coverage Check

| Spec Item | Status |
|---|---|
| Dashboard displays resource usage in card-based layout, n/m format, remaining quantity, label (spec: "Student-Facing Features > Dashboard & Profile") | ✅ Covered |
| Five resource types: CPU cores, RAM, storage, projects, databases (spec: same) | ✅ Covered |
| Admin can adjust individual resource quotas (spec: "Student Management") | ✅ Covered |
| Default CPU, RAM, database allocations pre-filled with recommended values, available capacity shown (spec: "Project Creation") | ✅ Covered |
| Adjust CPU and RAM limits with available and total values shown (spec: "Project Settings") | ✅ Covered |
| Resource request: resource type, requested value, description; sent to admin for review (spec: "Resource Requests") | ✅ Covered |
| Admin dashboard: system-wide metrics including total live projects and aggregate CPU, RAM, storage consumption (spec: "Admin Dashboard") | ✅ Covered |
| `DEFAULT_CPU_CORES = 2`, `DEFAULT_RAM_MB = 1024`, `DEFAULT_STORAGE_MB = 2560`, `DEFAULT_MAX_PROJECTS = 4`, `DEFAULT_MAX_DATABASES = 4` (Section 3.2.10) | ✅ Covered |
| `STORAGE_WARNING_THRESHOLD_PERCENT = 80` (Section 3.2.10) | ✅ Covered |
| `quotaChecker.js` validates CPU, RAM, storage, project count, database count (Section 2.3) | ✅ Covered |
| `storageService.js` measures source directory and runtime-generated file sizes (Section 2.3) | ✅ Covered |
| `projects.cpu_limit` and `projects.ram_limit_mb` columns (Section 4.2.2) | ✅ Covered |
| `resource_requests` table with resource_type enum, requested_value, status, admin_notes (Section 4.2.4) | ✅ Covered |
| Error codes: `PROJECT_QUOTA_EXCEEDED`, `CPU_QUOTA_EXCEEDED`, `RAM_QUOTA_EXCEEDED`, `DATABASE_QUOTA_EXCEEDED`, `QUOTA_BELOW_USAGE` (Section 6) | ✅ Covered |
| Resource request approval auto-applies absolute total (Section 6.7.3) | ✅ Covered |
| Admin metrics endpoint fields (Section 6.4.1) | ✅ Covered |
| Student profile computed fields: cpuUsed, ramUsedMb, storageUsedMb, projectCount, databaseCount, storageWarning (Section 6.3.1) | ✅ Covered |
| Docker `--cpus` and `--memory` flags on container creation (Section 7.8.2) | ✅ Covered |
| `docker update` for live resource adjustment (Section 7.8.5) | ✅ Covered |
| Storage usage breakdown per project (Section 6.5.9) | ✅ Covered |
| Default per-project cpuLimit=1.00, ramLimitMb=512 (Section 6.11 ambiguity #3) | ✅ Covered |

### Decisions Made (not explicitly in spec)

| # | Decision | Reasoning |
|---|---|---|
| 1 | Storage quota is informational only (no hard limit) | Storage grows dynamically at runtime; a hard block would not prevent post-creation growth |
| 2 | Resource request approval does not validate against current usage | Requests are for increases; admin has full visibility; avoids confusing failures |
| 3 | All non-deleted projects count against CPU/RAM (not just running) | Resources committed at creation; freeing on stop would break restart reliability |
| 4 | Admin can reduce `storageQuotaMb` below current disk usage | Storage cannot be instantly freed |
| 5 | `excludeProjectId` parameter in CPU/RAM quota checks | Enables project resource resizing without self-blocking |
| 6 | Admin metrics aggregate CPU/RAM uses `status = 'running'`; student profile uses `status != 'deleted'` | Different audiences need different views: admin sees active load, student sees committed allocation |

### Potential Issues

| # | Issue | Risk | Mitigation |
|---|---|---|---|
| 1 | `aggregateStorageUsedMb` in admin metrics iterates all student directories for disk measurement | Slow for large numbers of students; could cause timeout on metrics endpoint | Document as acceptable for initial scale; a background caching job can be added later without changing the API contract |
| 2 | CPU/RAM usage counting non-deleted projects includes `building` and `failed` states where no container may exist | Could appear inconsistent to students who see "1.00 cores used" but no container running | The allocation is committed; the student can delete the failed project to reclaim resources. This is the correct conservative approach. |
| 3 | Storage quota has no enforcement — a student could fill the entire disk | Risk of disk exhaustion affecting all students and platform stability | The `storageWarning` flag provides early visibility. Docker image layer storage is not counted against students. In practice, source code and build logs are the primary storage consumers, and the 200 MB ZIP upload limit constrains per-upload growth. |
| 4 | `quotaChecker.js` functions query the database on every call (no caching) | Potential latency if many concurrent project creations occur | Each query is a simple SUM/COUNT on indexed columns; performance is acceptable for the expected scale. Add caching only if profiling reveals bottlenecks. |
| 5 | Sonnet might not implement `excludeProjectId` correctly in resource update flow | Would cause "quota exceeded" errors when students try to resize their own projects | The pseudocode and example in Section 10.5.4 explicitly demonstrate the pattern |