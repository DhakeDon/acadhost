# Section 7 — Docker & Container Management

## 7.1 Overview

Docker is the containerization layer for all student-deployed projects on AcadHost. Every project — regardless of type (frontend, backend, or combined) — runs as an isolated Docker container on the host VM. The platform interacts with Docker exclusively through two backend services: `dockerService.js` (low-level Docker CLI/API operations) and `buildService.js` (build orchestration). Student containers are created from project-specific Dockerfiles generated from five templates stored in `backend/templates/`.

### Key Principles

| Principle | Detail |
|---|---|
| Every project is a container | Frontend-only, backend-only, and combined projects all run as Docker containers; no project type is served directly by the host Nginx |
| Multi-stage builds | All Dockerfile templates use Docker multi-stage builds to minimize final image size |
| One container per project | Each project runs exactly one container; combined projects merge frontend and backend into a single container |
| Host-network isolation | Student containers do not share the Docker bridge network with platform infrastructure containers; each container publishes a single port to the host |
| Unified internal port | All student containers listen on port `8080` internally (`CONTAINER_INTERNAL_PORT`); the host maps each container's assigned port to `8080` |
| Environment-variable-driven paths | All file paths used by Docker operations are read from environment variables; no paths are hardcoded |

### Docker-Related Environment Variables (Locked in Section 3)

| Variable | Value | Source Section |
|---|---|---|
| `CONTAINER_PORT_RANGE_START` | `10000` | Section 3.2.5 |
| `CONTAINER_PORT_RANGE_END` | `20000` | Section 3.2.5 |
| `BUILD_TIMEOUT_MINUTES` | `10` | Section 3.2.5 |
| `MAX_CONCURRENT_BUILDS` | `4` | Section 3.2.5 |
| `DOCKER_SOCKET_PATH` | `/var/run/docker.sock` | Section 3.2.5 |
| `CONTAINER_INTERNAL_PORT` | `8080` | Section 3.2.5 |
| `PROJECTS_BASE_DIR` | `/home/acadhost/projects` (production) | Section 3.2.4 |
| `NGINX_CONF_DIR` | `/etc/nginx/conf.d/acadhost` (production) | Section 3.2.4 |
| `NGINX_RELOAD_CMD` | `nginx -s reload` (production) | Section 3.2.6 |
| `NGINX_TEST_CMD` | `nginx -t` (production) | Section 3.2.6 |
| `NGINX_PROXY_HOST` | `127.0.0.1` (production) | Section 3.2.5 |

### Docker-Related Database Columns (Locked in Section 4)

| Column | Table | Type | Purpose |
|---|---|---|---|
| `container_id` | `projects` | `VARCHAR(64)` | Docker container ID; `NULL` if no container exists |
| `container_port` | `projects` | `INT UNSIGNED` | Assigned port from the pool; `NULL` before deployment or after deletion |
| `cpu_limit` | `projects` | `DECIMAL(5,2)` | CPU core limit for the container |
| `ram_limit_mb` | `projects` | `INT UNSIGNED` | RAM limit in MB for the container |
| `status` | `projects` | `ENUM('building', 'running', 'stopped', 'failed', 'deleted')` | Project lifecycle status |

---

## 7.2 Container Naming Convention

AMBIGUITY DETECTED: The spec does not define a container naming convention for student project containers.
My decision: Use the format `acadhost-project-{project_id}` where `{project_id}` is the numeric `projects.id` value. This ensures uniqueness (since `projects.id` is a primary key auto-increment), readability in `docker ps` output, and easy correlation between containers and database rows.

| Container Type | Naming Pattern | Example |
|---|---|---|
| Student project container | `acadhost-project-{project_id}` | `acadhost-project-15` |
| Platform MySQL (dev only) | `acadhost-mysql` | `acadhost-mysql` |
| Platform Nginx (dev only) | `acadhost-nginx` | `acadhost-nginx` |
| Platform phpMyAdmin (dev only) | `acadhost-phpmyadmin` | `acadhost-phpmyadmin` |
| Platform backend (dev only) | `acadhost-backend` | `acadhost-backend` |

---

## 7.3 Image Naming Convention

AMBIGUITY DETECTED: The spec does not define a Docker image naming convention for student project images.
My decision: Use the format `acadhost/project-{project_id}:latest`. A single `latest` tag is used because only one image per project exists at any time — the old image is deleted immediately after every successful rebuild (Section 1.9).

| Image Type | Naming Pattern | Example |
|---|---|---|
| Student project image | `acadhost/project-{project_id}:latest` | `acadhost/project-15:latest` |

### Image Storage

| Parameter | Value |
|---|---|
| Image storage location | `/var/lib/docker/` (host level, managed by Docker daemon) |
| Image attribution to quotas | Images are **not** attributed to student storage quotas |
| Old image cleanup | The old image for a project is deleted immediately after every successful rebuild to prevent unbounded disk growth |
| Quota tracking scope | Student quotas track only the contents of their source directories (`{PROJECTS_BASE_DIR}/{student_id}/{project_id}/`) and runtime-generated files |

---

## 7.4 Container Restart Policy

| Parameter | Value |
|---|---|
| Restart policy | `--restart unless-stopped` |
| Crash recovery | Automatic; Docker uses exponential backoff on repeated failures |
| Intentional stop behavior | When stopped via student dashboard (`POST /api/projects/:id/stop`) or admin dashboard (`POST /api/admin/projects/:id/stop`), the container remains stopped; the `unless-stopped` policy respects this |
| Docker daemon restart behavior | On host reboot or Docker daemon restart, all containers that were running (not explicitly stopped) are automatically restarted |

---

## 7.5 Port Allocation — `utils/portAllocator.js`

### Port Pool

| Parameter | Value |
|---|---|
| Range start (inclusive) | `CONTAINER_PORT_RANGE_START` (default `10000`) |
| Range end (inclusive) | `CONTAINER_PORT_RANGE_END` (default `20000`) |
| Total available ports | `CONTAINER_PORT_RANGE_END - CONTAINER_PORT_RANGE_START + 1` = `10,001` with defaults |
| Uniqueness enforcement | `uq_projects_container_port` unique index on `projects.container_port` (Section 4.2.2); MySQL allows multiple `NULL` values in unique indexes |

### Allocation Algorithm

`portAllocator.js` allocates an available port from the container port pool.

```
function allocatePort():
  1. Query all `projects.container_port` values WHERE `container_port IS NOT NULL`
     to get the set of currently in-use ports.
  2. Iterate from `CONTAINER_PORT_RANGE_START` to `CONTAINER_PORT_RANGE_END`.
  3. Return the first port that is NOT in the in-use set.
  4. If no port is available, throw an error with code `PORT_POOL_EXHAUSTED`.
```

On a duplicate key error for `container_port` (race condition where two simultaneous requests allocate the same port), retry allocation with a fresh query. Maximum 3 retry attempts before returning an error.

### Port Lifecycle

| Event | Port Action |
|---|---|
| Project creation (`POST /api/projects`) | Port allocated from pool; stored in `projects.container_port` |
| Project rebuild (webhook push) | Same port is reused; no new allocation; no Nginx reconfiguration required |
| Project stop (`POST /api/projects/:id/stop`) | Port remains assigned; container is stopped but port is held |
| Project restart (`POST /api/projects/:id/restart`) | Same port; container restarts on the same port |
| Project delete (`DELETE /api/projects/:id`) | `projects.container_port` set to `NULL`; port returned to pool |
| Project terminate (`POST /api/admin/projects/:id/terminate`) | `projects.container_port` set to `NULL`; port returned to pool |
| Student removal (`DELETE /api/admin/students/:id`) | All project ports set to `NULL` as part of cascade; ports returned to pool |
| Database switch (container recreation) | Same port is reused; container is recreated on the same port |
| Resource update fallback (container recreation) | Same port is reused; container is recreated on the same port |

---

## 7.6 Environment Variable Injection into Containers

When a student container is created, `dockerService.js` injects environment variables using Docker's `-e` flag. The injected variables depend on whether a database is attached to the project.

### Always-Injected Variables

No environment variables are unconditionally injected into every student container. Database credentials are injected only when a database is attached.

### Database Credential Variables (Injected When `projects.database_id IS NOT NULL`)

| Variable | Value | Source |
|---|---|---|
| `DB_HOST` | `host.docker.internal` | Constant value; allows the container to reach the host MySQL server |
| `DB_PORT` | Value of `MYSQL_PORT` from platform `.env` (typically `3306`) | Platform configuration |
| `DB_USER` | Restricted MySQL username from `databases.db_user` | Generated by `databaseProvisioningService.js` |
| `DB_PASSWORD` | Decrypted password from `databases.db_password_encrypted` | Decrypted at injection time using `DB_ENCRYPTION_KEY` via AES-256-CBC |
| `DB_NAME` | MySQL schema name from `databases.db_name` | Provided by the student during database creation |

### When No Database Is Attached (`projects.database_id IS NULL`)

No `DB_*` environment variables are injected into the container. If a student later attaches a database via `PUT /api/projects/:id/database`, the container is recreated with the new credentials injected.

### When a Database Is Detached (`databaseId = null` in `PUT /api/projects/:id/database`)

The container is recreated without any `DB_*` environment variables.

### `host.docker.internal` Resolution

| Platform | Resolution Method |
|---|---|
| Docker Desktop (Windows/macOS) | `host.docker.internal` resolves natively to the host IP; no additional configuration needed |
| Linux (production) | `--add-host=host.docker.internal:host-gateway` flag is added to the `docker create` command; this maps `host.docker.internal` to the host's gateway IP |

---

## 7.7 Dockerfile Templates

All Dockerfile templates are stored in `backend/templates/` (Section 2.3). During project creation, `buildService.js` copies the appropriate template to `{PROJECTS_BASE_DIR}/{student_id}/{project_id}/Dockerfile` and customizes it with the selected runtime version.

### Template Selection Logic

| Project Type | Runtime | Template File |
|---|---|---|
| `frontend` | N/A (no server runtime) | `templates/Dockerfile.frontend` |
| `backend` | `node` | `templates/Dockerfile.node` |
| `backend` | `python` | `templates/Dockerfile.python` |
| `combined` | `node` | `templates/Dockerfile.combined.node` |
| `combined` | `python` | `templates/Dockerfile.combined.python` |

### Runtime Version Parameterization

Each template uses a placeholder `{{RUNTIME_VERSION}}` that `buildService.js` replaces with the student's selected version before writing the Dockerfile to the project directory.

| Runtime | Valid Versions | Default |
|---|---|---|
| Node.js | `18`, `20`, `22`, `23` | `20` |
| Python | `3.10`, `3.11`, `3.12`, `3.13` | `3.11` |

For frontend-only projects, no runtime version substitution is needed — the template uses a fixed Node.js image for the build stage and a fixed Nginx image for the runtime stage.

### Unified Internal Port

All student containers — regardless of project type or runtime — expose and listen on port `8080` internally (`CONTAINER_INTERNAL_PORT`). The host Docker port mapping is always `-p {containerPort}:8080`. This eliminates per-runtime port logic in `dockerService.js`.

AMBIGUITY DETECTED: The spec does not define which Node.js version to use for building frontend assets in frontend-only and combined project Dockerfiles.
My decision: Use `node:20-alpine` as the build-stage base image for frontend asset compilation in `Dockerfile.frontend`, `Dockerfile.combined.node`, and `Dockerfile.combined.python`. Node.js 20 is the default runtime version per Section 1.12 and is an LTS release suitable for running `npm run build`.

### 7.7.1 `templates/Dockerfile.frontend`

Multi-stage build: first stage builds frontend assets using Node.js, second stage copies the build output into an Nginx image that serves static files. The resulting container runs its own internal Nginx instance listening on port `8080`. The host Nginx reverse-proxies to this container's assigned port exactly like any other project container.

```dockerfile
# Stage 1: Build frontend assets
FROM node:20-alpine AS build

WORKDIR /app

COPY source/frontend/package*.json ./
RUN npm ci --production=false

COPY source/frontend/ ./
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine

# Remove default Nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Custom Nginx config to serve on port 8080 inside the container
RUN echo 'server { \
    listen 8080; \
    server_name _; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
```

**Notes:**

- The `COPY source/frontend/` path is relative to the Docker build context, which is set to `{PROJECTS_BASE_DIR}/{student_id}/{project_id}/` during the build command.
- The internal Nginx listens on port `8080` inside the container. The host Docker port mapping (`-p {containerPort}:8080`) maps the assigned container port to this internal port.
- The `try_files` directive supports single-page application (SPA) routing by falling back to `index.html` for all unmatched paths.
- `npm run build` is assumed to output to `./build/`. If the frontend framework outputs to a different directory (e.g., `./dist/`), the student must configure their build script accordingly. This is documented as a known assumption.

AMBIGUITY DETECTED: The spec does not define whether the frontend build output directory is `build/` or `dist/` or another path.
My decision: Use `build` as the default assumption (standard for Create React App). The Dockerfile template will use `/app/build`. If a framework outputs to `dist/` (e.g., Vite), the student's `package.json` build script should be configured to output to `build/`, or this can be extended in Section 12 (Business Logic & Edge Cases) with support for detecting the output directory.

### 7.7.2 `templates/Dockerfile.node`

Multi-stage build for Node.js backend-only projects.

```dockerfile
# Stage 1: Install dependencies
FROM node:{{RUNTIME_VERSION}}-alpine AS deps

WORKDIR /app

COPY source/backend/package*.json ./
RUN npm ci --production

# Stage 2: Runtime
FROM node:{{RUNTIME_VERSION}}-alpine

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY source/backend/ ./

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
```

**Notes:**

- `{{RUNTIME_VERSION}}` is replaced by `buildService.js` with one of `18`, `20`, `22`, `23`.
- `ENV PORT=8080` sets the `PORT` environment variable inside the container. The student's application must read `process.env.PORT` (or the `PORT` env var) to know which port to listen on. This is standard practice for containerized Node.js applications.
- `CMD ["npm", "start"]` delegates entry point control to the student's `package.json` `start` script. The student must define a `start` script in `package.json` (e.g., `"start": "node server.js"` or `"start": "node index.js"`). If no `start` script exists, `npm start` will fail with a clear error during container startup.
- `npm ci --production` installs only production dependencies, excluding devDependencies.

### 7.7.3 `templates/Dockerfile.python`

Multi-stage build for Python backend-only projects.

```dockerfile
# Stage 1: Install dependencies
FROM python:{{RUNTIME_VERSION}}-slim AS deps

WORKDIR /app

COPY source/backend/requirements.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Stage 2: Runtime
FROM python:{{RUNTIME_VERSION}}-slim

WORKDIR /app

COPY --from=deps /install /usr/local
COPY source/backend/ ./

ENV PORT=8080
EXPOSE 8080

CMD ["python", "app.py"]
```

**Notes:**

- `{{RUNTIME_VERSION}}` is replaced by `buildService.js` with one of `3.10`, `3.11`, `3.12`, `3.13`.
- `ENV PORT=8080` sets the `PORT` environment variable inside the container. The student's Python application must read `os.environ.get('PORT', 8080)` to determine the listen port. For example, Flask: `app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 8080)))`. For FastAPI/Uvicorn: `uvicorn.run(app, host='0.0.0.0', port=int(os.environ.get('PORT', 8080)))`.
- `pip install --prefix=/install` installs dependencies into a separate directory, which is then copied into the runtime stage. This avoids carrying build tools into the final image.
- `CMD ["python", "app.py"]` is the default entry point. `buildService.js` checks for common entry points (`app.py`, `main.py`, `server.py`, `wsgi.py`) and uses the first one found. If none is found, defaults to `app.py`. This detection logic is applied during Dockerfile customization.

### 7.7.4 `templates/Dockerfile.combined.node`

Multi-stage build for combined frontend + Node.js backend projects. The frontend is built first, its output is placed into the backend directory, and the combined application is deployed as a single container.

```dockerfile
# Stage 1: Build frontend assets
FROM node:20-alpine AS frontend-build

WORKDIR /app

COPY source/frontend/package*.json ./
RUN npm ci --production=false

COPY source/frontend/ ./
RUN npm run build

# Stage 2: Install backend dependencies
FROM node:{{RUNTIME_VERSION}}-alpine AS backend-deps

WORKDIR /app

COPY source/backend/package*.json ./
RUN npm ci --production

# Stage 3: Runtime — combined
FROM node:{{RUNTIME_VERSION}}-alpine

WORKDIR /app

COPY --from=backend-deps /app/node_modules ./node_modules
COPY source/backend/ ./
COPY --from=frontend-build /app/build ./public

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
```

**Notes:**

- The frontend build output is copied into `./public` inside the backend's working directory. The student's backend server must serve static files from this `./public` directory (e.g., using `express.static('public')` in Express.js).
- `{{RUNTIME_VERSION}}` applies only to the backend stages. The frontend build stage uses the fixed `node:20-alpine` image.
- Same `ENV PORT=8080` and `CMD ["npm", "start"]` convention as `Dockerfile.node`. The student's `package.json` must define a `start` script.

### 7.7.5 `templates/Dockerfile.combined.python`

Multi-stage build for combined frontend + Python backend projects.

```dockerfile
# Stage 1: Build frontend assets
FROM node:20-alpine AS frontend-build

WORKDIR /app

COPY source/frontend/package*.json ./
RUN npm ci --production=false

COPY source/frontend/ ./
RUN npm run build

# Stage 2: Install backend dependencies
FROM python:{{RUNTIME_VERSION}}-slim AS backend-deps

WORKDIR /app

COPY source/backend/requirements.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Stage 3: Runtime — combined
FROM python:{{RUNTIME_VERSION}}-slim

WORKDIR /app

COPY --from=backend-deps /install /usr/local
COPY source/backend/ ./
COPY --from=frontend-build /app/build ./static

ENV PORT=8080
EXPOSE 8080

CMD ["python", "app.py"]
```

**Notes:**

- The frontend build output is copied into `./static` inside the backend's working directory. The student's Python backend must serve static files from this `./static` directory (e.g., using Flask's `static_folder` parameter or FastAPI's `StaticFiles` mount).
- `{{RUNTIME_VERSION}}` applies only to the Python backend stages.
- Same `ENV PORT=8080` and entry point detection convention as `Dockerfile.python`.

### 7.7.6 `backend/Dockerfile` (Platform Backend — Development Only)

This Dockerfile is for the Express.js API server itself, used by `docker-compose.yml` to build and run the backend during development. It is distinct from the project templates in `backend/templates/`.

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
```

**Notes:**

- This Dockerfile is not used in production. In production, the backend runs directly on the host (not in a container).
- The `docker-compose.yml` bind-mounts `./backend:/app` over this image, enabling live code reloading during development.
- This Dockerfile exposes port `3000` (the backend API port), not `8080`. The `8080` internal port applies only to student project containers.

---

## 7.8 `dockerService.js` — Docker CLI Operations

`dockerService.js` is the sole interface between the platform backend and the Docker daemon. It executes Docker CLI commands via Node.js `child_process` (using `execFile` or `spawn`). All Docker operations go through this service.

### 7.8.1 Functions

| Function | Docker Command(s) | Description |
|---|---|---|
| `buildImage(projectId, buildContext)` | `docker build -t acadhost/project-{projectId}:latest -f {buildContext}/Dockerfile {buildContext}` | Builds a Docker image from the project's Dockerfile |
| `createAndStartContainer(projectId, port, cpuLimit, ramLimitMb, envVars)` | `docker create` + `docker start` | Creates and starts a container with resource limits and environment variables |
| `stopContainer(containerId)` | `docker stop {containerId}` | Stops a running container |
| `removeContainer(containerId)` | `docker rm {containerId}` | Removes a stopped container |
| `restartContainer(containerId)` | `docker restart {containerId}` | Restarts a container |
| `removeImage(imageName)` | `docker rmi {imageName}` | Removes a Docker image |
| `getContainerLogs(containerId, tail)` | `docker logs --tail {tail} {containerId}` | Retrieves the most recent log lines from a container |
| `updateContainerResources(containerId, cpuLimit, ramLimitMb)` | `docker update --cpus={cpuLimit} --memory={ramLimitMb}m {containerId}` | Updates CPU and RAM limits on a running container |
| `inspectContainer(containerId)` | `docker inspect {containerId}` | Returns container state and configuration as JSON |

### 7.8.2 `createAndStartContainer` — Full Command Construction

The `createAndStartContainer` function constructs and executes the following Docker CLI commands:

**Step 1 — `docker create`:**

```bash
docker create \
  --name acadhost-project-{projectId} \
  --restart unless-stopped \
  --cpus={cpuLimit} \
  --memory={ramLimitMb}m \
  -p {containerPort}:8080 \
  --add-host=host.docker.internal:host-gateway \
  -e DB_HOST=host.docker.internal \
  -e DB_PORT={mysqlPort} \
  -e DB_USER={dbUser} \
  -e DB_PASSWORD={dbPassword} \
  -e DB_NAME={dbName} \
  acadhost/project-{projectId}:latest
```

**Step 2 — `docker start`:**

```bash
docker start acadhost-project-{projectId}
```

### Parameter Details

| Parameter | Value | Source |
|---|---|---|
| `--name` | `acadhost-project-{projectId}` | Container naming convention (Section 7.2) |
| `--restart` | `unless-stopped` | Restart policy (Section 1.8) |
| `--cpus` | `projects.cpu_limit` value (e.g., `1.00`, `0.50`) | From project creation request or resource update |
| `--memory` | `projects.ram_limit_mb` value with `m` suffix (e.g., `512m`, `1024m`) | From project creation request or resource update |
| `-p` | `{containerPort}:8080` | `containerPort` from `portAllocator.js`; internal port is always `8080` (`CONTAINER_INTERNAL_PORT`) |
| `--add-host` | `host.docker.internal:host-gateway` | Required on Linux to resolve `host.docker.internal` to host IP; harmless on Docker Desktop where it already resolves natively |
| `-e` flags | Database credential variables | Injected only when `projects.database_id IS NOT NULL` (Section 7.6) |

### Internal Port Mapping — All Project Types

| Project Type | Template | Internal Port | Port Mapping |
|---|---|---|---|
| `frontend` | `Dockerfile.frontend` | `8080` | `-p {containerPort}:8080` |
| `backend` (Node.js) | `Dockerfile.node` | `8080` | `-p {containerPort}:8080` |
| `backend` (Python) | `Dockerfile.python` | `8080` | `-p {containerPort}:8080` |
| `combined` (Node.js) | `Dockerfile.combined.node` | `8080` | `-p {containerPort}:8080` |
| `combined` (Python) | `Dockerfile.combined.python` | `8080` | `-p {containerPort}:8080` |

All student containers — regardless of project type or runtime — expose and listen on port `8080` internally. The host Docker port mapping is always `-p {containerPort}:8080`. This eliminates per-runtime port logic in `dockerService.js`.

### 7.8.3 `buildImage` — Build Command Construction

```bash
docker build \
  -t acadhost/project-{projectId}:latest \
  -f {PROJECTS_BASE_DIR}/{studentId}/{projectId}/Dockerfile \
  {PROJECTS_BASE_DIR}/{studentId}/{projectId}/
```

| Parameter | Purpose |
|---|---|
| `-t` | Tags the built image with the naming convention from Section 7.3 |
| `-f` | Points to the generated Dockerfile in the project directory |
| Build context (last argument) | Set to the project root directory so that `COPY source/...` paths in the Dockerfiles resolve correctly |

### 7.8.4 `removeImage` — Image Cleanup

```bash
docker rmi acadhost/project-{projectId}:latest
```

Called after a successful rebuild to delete the old image. Also called during project deletion and termination. If the image does not exist (e.g., build failed before image was created), the error is caught and silently ignored.

### 7.8.5 `updateContainerResources` — Live Resource Update

```bash
docker update \
  --cpus={cpuLimit} \
  --memory={ramLimitMb}m \
  {containerId}
```

This command updates resource limits on a running container without restarting it. If `docker update` fails (e.g., on older Docker versions or unsupported configurations), the fallback is to stop, remove, and recreate the container with the new limits. The fallback flow is:

1. `docker stop {containerId}`
2. `docker rm {containerId}`
3. `docker create` with new `--cpus` and `--memory` values (all other parameters unchanged)
4. `docker start {newContainerId}`
5. Update `projects.container_id` with the new container ID

### 7.8.6 `getContainerLogs` — Runtime Log Retrieval

```bash
docker logs --tail {tail} {containerId}
```

| Parameter | Default | Source |
|---|---|---|
| `tail` | `100` | Query parameter on `GET /api/projects/:id/logs` (Section 6.5.6) |

Runtime logs are ephemeral — they exist only for the lifetime of the current container. When a container is recreated (e.g., on rebuild, database switch, or resource update fallback), the previous runtime logs are lost.

---

## 7.9 `buildService.js` — Build Orchestration

`buildService.js` orchestrates the end-to-end build process for a project. It coordinates source code acquisition, Dockerfile generation, image building, container creation, and status tracking.

### 7.9.1 Build Concurrency

| Parameter | Value |
|---|---|
| Max concurrent builds | `MAX_CONCURRENT_BUILDS` (default `4`) |
| Enforcement | Before starting a build, `buildService.js` counts `builds` rows where `status = 'building'`. If the count equals or exceeds `MAX_CONCURRENT_BUILDS`, the build is rejected with `BUILD_QUEUE_FULL` (HTTP `429`) |
| Tracking | Each build attempt creates a row in the `builds` table with `status = 'building'` at the start and updates to `success`, `failed`, or `timeout` upon completion |

### 7.9.2 Build Timeout

| Parameter | Value |
|---|---|
| Timeout duration | `BUILD_TIMEOUT_MINUTES` (default `10` minutes) |
| Enforcement | `buildService.js` spawns the `docker build` process and starts a timer. If the timer expires before the build completes, the build process is killed |
| On timeout | Set `builds.status = 'timeout'`, set `builds.completed_at`, set `projects.status = 'failed'`, emit SSE event `{ event: 'status', data: 'timeout' }` followed by `{ event: 'complete', data: '{"status":"timeout","message":"Build exceeded time limit"}' }` |

### 7.9.3 Build Flow — Initial Deployment

This is the sequence executed by `buildService.js` when a new project is created via `POST /api/projects` (Section 6.5.1):

```
1. Receive build request with project metadata (projectId, studentId,
   projectType, runtime, runtimeVersion, sourceType, databaseId).

2. Create a `builds` row:
   - project_id = {projectId}
   - status = 'building'
   - log_file_path = '{studentId}/{projectId}/build/logs/{timestamp}.log'
   - started_at = NOW()

3. Create project directory structure:
   {PROJECTS_BASE_DIR}/{studentId}/{projectId}/
   ├── source/
   │   ├── frontend/    (if projectType is 'frontend' or 'combined')
   │   └── backend/     (if projectType is 'backend' or 'combined')
   ├── build/
   │   └── logs/
   └── uploads/

4. Acquire source code:
   - If sourceType = 'git':
     - Clone git_url into source/frontend/ (frontend or combined)
     - Clone git_url or git_url_backend into source/backend/ (backend or combined)
   - If sourceType = 'zip':
     - Extract ZIP file(s) into source/frontend/ and/or source/backend/
       via zipHandler.js
     - Delete the uploaded ZIP file(s) from uploads/ after extraction

5. Auto-detect runtime (if sourceType = 'git' and projectType != 'frontend'):
   - Check source/backend/ for package.json → runtime = 'node'
   - Check source/backend/ for requirements.txt → runtime = 'python'
   - If runtime was provided in the request, validate it matches detection

6. Select Dockerfile template based on projectType and runtime
   (Section 7.7 Template Selection Logic table).

7. Customize the template:
   - Replace {{RUNTIME_VERSION}} with the selected version
   - For Python templates: detect entry point (check for app.py,
     main.py, server.py, wsgi.py — use first found, default app.py)
   - Write the customized Dockerfile to:
     {PROJECTS_BASE_DIR}/{studentId}/{projectId}/Dockerfile

8. Execute docker build via dockerService.buildImage():
   - Stream build output to the log file at log_file_path
   - Stream application-level output (not internal Docker messages)
     to the SSE connection as `event: log` events
   - Start the BUILD_TIMEOUT_MINUTES timer

9. On build success:
   a. Create and start the container via
      dockerService.createAndStartContainer():
      - Assign port from portAllocator.js
      - Apply CPU and RAM limits
      - Inject database credentials (if database attached)
      - Use --restart unless-stopped
      - Use --add-host=host.docker.internal:host-gateway
      - Map port: -p {containerPort}:8080
   b. Update projects row:
      - container_id = {new container ID}
      - status = 'running'
   c. Update builds row:
      - status = 'success'
      - completed_at = NOW()
   d. Write Nginx per-project config file via nginxService.addProjectConfig(subdomain, containerPort)
      to {NGINX_CONF_DIR}/{subdomain}.conf and reload Nginx
   e. Emit SSE events:
      - event: status, data: success
      - event: complete, data: {"status":"success"}

   ON CONTAINER CREATION FAILURE (any of steps 9a–9d fails):
   a. Set projects.status = 'failed'.
   b. Set builds.status = 'failed'.
   c. Set builds.completed_at = NOW().
   d. Emit SSE event: event: status, data: failed.
   e. Emit SSE event: event: complete, data:
      {"status":"failed","message":"Container creation failed
      after successful build"}.
   f. Attempt cleanup: remove the built Docker image
      (docker rmi acadhost/project-{projectId}:latest)
      since the container was never started successfully.
      If image removal also fails, log the error and continue.
   g. The allocated port remains assigned in projects.container_port.
      On the student's next deployment attempt (e.g., after
      fixing whatever caused the Docker failure), the same port
      is reused — no new allocation is needed.

10. On build failure:
    a. Update projects row:
       - status = 'failed'
    b. Update builds row:
       - status = 'failed'
       - completed_at = NOW()
    c. Emit SSE events:
       - event: status, data: failed
       - event: complete, data: {"status":"failed","message":"..."}

11. On build timeout:
    a. Kill the docker build process
    b. Update projects row:
       - status = 'failed'
    c. Update builds row:
       - status = 'timeout'
       - completed_at = NOW()
    d. Emit SSE events:
       - event: status, data: timeout
       - event: complete, data: {"status":"timeout","message":"Build exceeded time limit"}
```

### 7.9.4 Build Flow — Webhook Rebuild

This is the sequence executed by `webhookService.js` when a GitHub push event is received (Section 6.8.1):

```
1. Validate the webhook payload and signature (handled by webhookService.js
   before invoking buildService.js).

1a. Concurrency guard: Check if a build is already in progress
    for this project by querying the `builds` table WHERE
    `project_id = {projectId}` AND `status = 'building'`.
    If a build is already in progress:
    - Log the event: "Webhook received for project {projectId}
      but a build is already in progress. Skipping."
    - Return 200 OK to GitHub immediately with:
      {
        "success": true,
        "data": {
          "message": "BUILD_ALREADY_IN_PROGRESS",
          "projectId": {projectId}
        }
      }
    - Do not start a new build. The 200 response prevents
      GitHub from retrying the webhook delivery.

2. Determine which source to update:
   - If the repo URL matches projects.git_url → update source/frontend/
     (for frontend/combined) or source/backend/ (for backend-only)
   - If the repo URL matches projects.git_url_backend → update
     source/backend/ (combined projects only)
   - For combined projects where the frontend repo pushed: rebuild
     pulls new frontend code and rebuilds the entire image
   - For combined projects where the backend repo pushed: rebuild
     pulls new backend code and rebuilds the entire image

3. Pull the new code:
   - git pull in the appropriate source directory
   - Or git clone fresh if the directory state is inconsistent

4. Record the old container ID and old image name for cleanup.

5. Create a new `builds` row with status = 'building'.

6. Rebuild the Docker image from scratch via dockerService.buildImage()
   (same Dockerfile, same build context — the source has been updated).

7. On successful rebuild:
   a. Stop the old container: docker stop {oldContainerId}
   b. Remove the old container: docker rm {oldContainerId}
   c. Create and start a new container with ALL the same configuration:
      - Same port assignment (projects.container_port — no change)
      - Same CPU limit (projects.cpu_limit)
      - Same RAM limit (projects.ram_limit_mb)
      - Same database credentials (if database attached)
      - Same restart policy (--restart unless-stopped)
      - Same --add-host flag
      - Same port mapping: -p {containerPort}:8080
   d. Delete the old Docker image: docker rmi {oldImageName}
   e. Update projects.container_id with the new container ID
   f. Update builds row: status = 'success', completed_at = NOW()
   g. No Nginx reconfiguration required (same port, same subdomain)

   ON CONTAINER CREATION FAILURE DURING WEBHOOK REBUILD:
   If docker create or docker start fails for the new container
   after the old container was already stopped:
   a. The old container has already been stopped and removed —
      the project is now offline.
   b. Set projects.status = 'failed'.
   c. Set projects.container_id = NULL.
   d. Set builds.status = 'failed'.
   e. Set builds.completed_at = NOW().
   f. Attempt to remove the new image. The old image was already
      deleted in step 7d.
   g. Log the error for admin investigation.
   Note: This is a severe edge case. The project is now offline
   with no running container. The student or admin must trigger
   a new build to recover.

8. On failed rebuild:
   a. The old container remains running (it was not stopped because
      the new image build failed before the swap)
   b. Update builds row: status = 'failed', completed_at = NOW()
   c. projects.status remains 'running' (old container is still serving)
```

**Critical rebuild ordering:** The old container is NOT stopped until the new image is successfully built. This ensures the project continues serving traffic on the old container if the rebuild fails. The downtime window is only the brief period between stopping the old container and starting the new one.

### 7.9.5 Build Log Streaming

| Parameter | Value |
|---|---|
| Log file location | `{PROJECTS_BASE_DIR}/{studentId}/{projectId}/build/logs/{build_timestamp}.log` |
| Log file format | `{build_timestamp}` uses ISO 8601 format with underscores replacing colons and periods (e.g., `2024-02-10T14_30_00_000Z.log`) |
| SSE event type for log lines | `log` |
| Content filter | Application-level output only; internal Docker build step messages (e.g., `---> Running in abc123`, `Removing intermediate container`) are filtered out before streaming |
| Log retention | `BUILD_LOG_RETENTION_DAYS` (default `7` days) |
| Retention enforcement | A periodic cleanup task deletes both the log file on disk and the corresponding `builds` row for builds older than `BUILD_LOG_RETENTION_DAYS` |

### 7.9.6 Build Log Retention Cleanup

The cleanup task runs periodically and performs:

```
1. Query all `builds` rows WHERE `started_at < NOW() - INTERVAL {BUILD_LOG_RETENTION_DAYS} DAY`.
2. For each expired build:
   a. Delete the log file at builds.log_file_path from disk.
   b. Delete the builds row from the database.
3. Log the number of expired builds cleaned up.
```

AMBIGUITY DETECTED: The spec does not define the mechanism for running the periodic build log cleanup task (cron job, application timer, or startup task).
My decision: Use a Node.js `setInterval` timer within the backend process that runs the cleanup once every 24 hours. The timer is started when the backend server starts. This avoids external dependencies on system cron and keeps the cleanup logic within the application boundary.

---

## 7.10 Container Lifecycle State Machine

The project's `status` column in the `projects` table tracks the container lifecycle. The following state transitions are valid:

```
                    ┌──────────────────┐
                    │     building     │
                    └────────┬─────────┘
                             │
                   ┌─────────┼─────────┐
                   │ (success)         │ (failure/timeout)
                   ▼                   ▼
            ┌────────────┐      ┌────────────┐
            │   running  │      │   failed   │
            └──────┬─────┘      └────────────┘
                   │                   │
          ┌────────┼────────┐          │ (rebuild from failed)
          │ (stop) │        │          │
          ▼        │        │          ▼
   ┌────────────┐  │  ┌─────┴──────────────┐
   │   stopped  │  │  │     building       │
   └──────┬─────┘  │  │   (rebuild)        │
          │        │  └────────────────────┘
          │(restart)│
          │        │
          ▼        │
   ┌────────────┐  │
   │   running  │◄─┘
   └────────────┘
          │
          │ (delete/terminate)
          ▼
   ┌────────────┐
   │   deleted  │
   └────────────┘
```

### Valid State Transitions

| From | To | Trigger |
|---|---|---|
| `building` | `running` | Build succeeds and container starts |
| `building` | `failed` | Build fails, times out, or container creation fails after successful build |
| `running` | `stopped` | Student stop (`POST /api/projects/:id/stop`) or admin stop (`POST /api/admin/projects/:id/stop`) |
| `running` | `running` | Webhook-triggered rebuild (old container continues serving until new image is built; status remains `running` throughout) |
| `running` | `failed` | Container creation fails during webhook rebuild after old container was already stopped (severe edge case) |
| `running` | `deleted` | Student delete (`DELETE /api/projects/:id`) or admin terminate (`POST /api/admin/projects/:id/terminate`) |
| `stopped` | `running` | Student restart (`POST /api/projects/:id/restart`) |
| `stopped` | `deleted` | Student delete (`DELETE /api/projects/:id`) or admin terminate (`POST /api/admin/projects/:id/terminate`) |
| `failed` | `building` | Student initiates a new build (e.g., updates source and redeploys) |
| `failed` | `deleted` | Student delete or admin terminate |

During a webhook-triggered rebuild, `projects.status` remains `running` while the new image is being built (because the old container is still serving traffic). The `builds` table tracks the rebuild progress separately via its own `status` column.

---

## 7.11 Container Recreation Scenarios

There are three scenarios where a container is destroyed and recreated with the same configuration (same port, same subdomain, same resource limits):

### 7.11.1 Database Switch

Triggered by `PUT /api/projects/:id/database` (Section 6.5.4).

```
1. Stop the current container: docker stop {containerId}
2. Remove the current container: docker rm {containerId}
3. Decrypt the new database password (or prepare no DB_* vars
   if databaseId is null)
4. Create a new container with:
   - Same image: acadhost/project-{projectId}:latest
   - Same port: -p {containerPort}:8080
   - Same CPU limit: projects.cpu_limit
   - Same RAM limit: projects.ram_limit_mb
   - New (or no) database credentials
   - Same restart policy and --add-host flag
5. Start the new container
6. Update projects.container_id with new container ID
```

### 7.11.2 Resource Update Fallback

Triggered when `docker update` fails during `PUT /api/projects/:id/resources` (Section 6.5.5).

```
1. Stop the current container: docker stop {containerId}
2. Remove the current container: docker rm {containerId}
3. Create a new container with:
   - Same image: acadhost/project-{projectId}:latest
   - Same port: -p {containerPort}:8080
   - New CPU limit
   - New RAM limit
   - Same database credentials (if any)
   - Same restart policy and --add-host flag
4. Start the new container
5. Update projects.container_id with new container ID
```

### 7.11.3 Webhook Rebuild

Triggered by `POST /api/webhooks/github/:projectId` (Section 6.8.1). Documented in detail in Section 7.9.4.

---

## 7.12 Container Cleanup Sequences

### 7.12.1 Project Delete (Student) / Project Terminate (Admin)

Triggered by `DELETE /api/projects/:id` (Section 6.5.12) or `POST /api/admin/projects/:id/terminate` (Section 6.4.10).

```
1. Stop the container (if running):    docker stop {containerId}
2. Remove the container:                docker rm {containerId}
3. Remove the Docker image:             docker rmi acadhost/project-{projectId}:latest
4. Delete Nginx config file:             nginxService.removeProjectConfig(subdomain)
                                         (deletes {NGINX_CONF_DIR}/{subdomain}.conf and reloads Nginx)
5. Delete project source directory:     rm -rf {PROJECTS_BASE_DIR}/{studentId}/{projectId}/
6. Update projects row:
   - container_id = NULL
   - container_port = NULL
   - subdomain = '_deleted_{projectId}'
   - status = 'deleted'
```

### 7.12.2 Student Removal

Triggered by `DELETE /api/admin/students/:id` (Section 6.4.4) or batch removal (Section 6.4.5).

For each project belonging to the student:

```
1. Stop the container (if running):    docker stop {containerId}
2. Remove the container:                docker rm {containerId}
3. Remove the Docker image:             docker rmi acadhost/project-{projectId}:latest
```

Then:

```
4. Delete all Nginx config files for the student's projects via
   nginxService.removeMultipleProjectConfigs(subdomains)
   (deletes {NGINX_CONF_DIR}/{subdomain}.conf for each project; reloads Nginx once)
5. Drop all MySQL schemas and restricted users (databaseProvisioningService.js)
6. Delete the student's entire directory:  rm -rf {PROJECTS_BASE_DIR}/{studentId}/
7. Delete the users row (cascades to projects, databases, etc.)
```

---

## 7.13 Docker Socket Access

| Parameter | Value |
|---|---|
| Docker socket path | `DOCKER_SOCKET_PATH` (default `/var/run/docker.sock`) |
| Access method | `dockerService.js` executes Docker CLI commands which communicate with the daemon via the socket |
| Permission requirement | The user running the backend process must have read/write access to the Docker socket (typically by being in the `docker` group on Linux) |
| Development environment | Docker Desktop manages the socket automatically; no special permissions needed |

---

## 7.14 Development vs. Production Docker Differences

| Aspect | Development | Production |
|---|---|---|
| Platform MySQL | Docker container (`acadhost-mysql`) via `docker-compose.yml` | Runs natively on the Ubuntu VM |
| Platform Nginx | Docker container (`acadhost-nginx`) via `docker-compose.yml` | Runs natively on the Ubuntu VM |
| Platform phpMyAdmin | Docker container (`acadhost-phpmyadmin`) via `docker-compose.yml` | Standalone Docker container managed directly |
| Platform backend | Docker container (`acadhost-backend`) via `docker-compose.yml` | Runs directly on the VM (no container) |
| `docker-compose.yml` | Used to orchestrate MySQL, Nginx, phpMyAdmin, and backend | **NOT used**; each service runs natively or as a managed container |
| `NGINX_RELOAD_CMD` | `docker exec acadhost-nginx nginx -s reload` | `nginx -s reload` |
| `NGINX_TEST_CMD` | `docker exec acadhost-nginx nginx -t` | `nginx -t` |
| `NGINX_CONF_DIR` | `./nginx/conf.d/acadhost` | `/etc/nginx/conf.d/acadhost` |
| `NGINX_PROXY_HOST` | `host.docker.internal` | `127.0.0.1` |
| `host.docker.internal` | Resolves natively (Docker Desktop) | Requires `--add-host=host.docker.internal:host-gateway` |
| Student containers | Created via `dockerService.js` (same as production) | Created via `dockerService.js` (same as development) |
| Docker socket | `/var/run/docker.sock` | `/var/run/docker.sock` |
| Student container internal port | `8080` (same across all environments) | `8080` (same across all environments) |

---

## 7.15 Ambiguity Decisions Registry

| # | Ambiguity | Decision | Rationale |
|---|---|---|---|
| 1 | Spec does not define a container naming convention | `acadhost-project-{projectId}` | `projectId` is immutable PK; ensures uniqueness and readability |
| 2 | Spec does not define an image naming convention | `acadhost/project-{projectId}:latest` | Single `latest` tag; only one image per project exists at any time |
| 3 | Spec does not define frontend build output directory | Default `build/` (Create React App standard) | Vite users must configure output to `build/` or extended in Section 12 |
| 4 | Spec does not define Python entry point detection | Check `app.py`, `main.py`, `server.py`, `wsgi.py`; default `app.py` | Covers Flask, FastAPI, Django, WSGI patterns |
| 5 | Spec does not define which Node.js version for frontend build stage | `node:20-alpine` | Node 20 is LTS and the default runtime per Section 1.12 |
| 6 | Spec does not define base image variants | `node:*-alpine` and `python:*-slim` | Minimize image size; consistent with multi-stage build strategy |
| 7 | Spec does not define build log filename format | ISO 8601 with underscores (e.g., `2024-02-10T14_30_00_000Z.log`) | Filesystem-safe; avoids colons and periods |
| 8 | Spec does not define build log cleanup mechanism | `setInterval` in backend process (24-hour cycle) | App-level timer avoids external cron dependency |
| 9 | Spec does not define whether `projects.status` changes during webhook rebuild | Stays `running` during build; `builds` table tracks progress | Old container still serves traffic; `running` is accurate |
| 10 | Spec does not specify `--add-host` behavior on Docker Desktop | Always apply `--add-host=host.docker.internal:host-gateway` | Harmless on Docker Desktop; simplifies command construction |
| 11 | Spec does not define static file directory names for combined projects | Node.js: `./public`; Python: `./static` | Follows framework conventions (Express `public/`, Flask `static/`) |
| 12 | Spec does not define a `PORT_POOL_EXHAUSTED` error | Error code added; HTTP 503 | Necessary for edge case when all ports are in use |