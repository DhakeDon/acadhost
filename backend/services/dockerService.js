'use strict';

// ============================================================
// Docker Service — services/dockerService.js
// Section 7.8
//
// Sole interface between the platform backend and the Docker
// daemon.  All operations use child_process (execFile/spawn)
// to invoke the Docker CLI — NOT the dockerode npm package.
//
// All paths and configuration come from process.env.
// Errors from child processes are caught and re-thrown as
// plain objects with { code, message } so callers never receive
// raw child_process exceptions.
// ============================================================

const { execFile, spawn } = require('child_process');
const path                = require('path');
const fs                  = require('fs');

// ── Helpers ──────────────────────────────────────────────────

/**
 * Returns the base environment for spawned docker processes.
 * Passes DOCKER_HOST when DOCKER_SOCKET_PATH is set to a
 * non-default value.
 */
// this code below is used due to dev mode on windows
function getDockerEnv() {
  const env = { ...process.env };

  // ✅ If DOCKER_HOST already provided → use it
  if (process.env.DOCKER_HOST) {
    env.DOCKER_HOST = process.env.DOCKER_HOST;
    return env;
  }

  const socketPath = process.env.DOCKER_SOCKET_PATH;

  // ✅ Only apply unix socket if explicitly valid (Linux case)
  if (socketPath && socketPath === '/var/run/docker.sock') {
    env.DOCKER_HOST = `unix://${socketPath}`;
  }

  return env;
}

//use this when shifiting to linux
//currently its commeted due to trying dev mode on winows uncomment below
// function getDockerEnv() {
//   const socketPath = process.env.DOCKER_SOCKET_PATH;
//   const env = { ...process.env };
//   if (socketPath && socketPath !== '/var/run/docker.sock') {
//     env.DOCKER_HOST = `unix://${socketPath}`;
//   }
//   return env;
// }

/**
 * Promisified execFile wrapper.
 *
 * @param {string}   cmd
 * @param {string[]} args
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env: getDockerEnv(), maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const message = stderr ? stderr.trim() : (err.message || 'Unknown docker error');
        return reject(Object.assign(new Error(message), { stderr, stdout }));
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

// ── buildImage ───────────────────────────────────────────────

/**
 * Builds a Docker image for a student project.
 *
 * Streams build output line-by-line to:
 *   - logStream (a fs.WriteStream to the build log file)
 *   - onLogLine callback (for SSE streaming to the client)
 *
 * Internal Docker progress messages are filtered out before
 * forwarding to onLogLine (kept in the log file in full).
 *
 * @param {number}   projectId
 * @param {number}   studentId
 * @param {fs.WriteStream} logStream
 * @param {Function} onLogLine   — called with each filtered output line
 * @param {AbortSignal} [signal] — optional AbortSignal for timeout
 * @returns {Promise<void>}
 */
function buildImage(projectId, studentId, logStream, onLogLine, signal) {
  return new Promise((resolve, reject) => {
    const projectDir = path.join(
        process.env.PROJECTS_BASE_DIR,
        String(studentId),
        String(projectId)
    );
    const imageName  = `acadhost/project-${projectId}:latest`;
    const dockerfile = path.join(projectDir, 'Dockerfile');

    const args = [
      'build',
      '--no-cache',
      '-t', imageName,
      '-f', dockerfile,
      projectDir,
    ];

    const proc = spawn('docker', args, { env: getDockerEnv() });

    // Internal Docker build step noise to filter from SSE stream
    // (still written to the log file).
    const FILTER_PATTERNS = [
      /^---> [a-f0-9]+/,
      /^---> Running in [a-f0-9]+/,
      /^Removing intermediate container [a-f0-9]+/,
      /^Successfully built [a-f0-9]+/,
    ];

    function handleLine(line) {
      if (!line) return;
      if (logStream) logStream.write(line + '\n');
      const filtered = FILTER_PATTERNS.some(re => re.test(line));
      if (!filtered && onLogLine) onLogLine(line);
    }

    let stdoutBuf = '';
    let stderrBuf = '';

    proc.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop();
      lines.forEach(handleLine);
    });

    proc.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop();
      lines.forEach(handleLine);
    });

    // Handle AbortSignal (timeout).
    // Check signal.aborted immediately — the timeout may have fired before
    // buildImage was called (e.g. during git clone).  In that case the 'abort'
    // event was already dispatched and addEventListener would never fire.
    if (signal) {
      if (signal.aborted) {
        proc.kill('SIGKILL');
      } else {
        signal.addEventListener('abort', () => {
          proc.kill('SIGKILL');
        });
      }
    }

    proc.on('close', (code) => {
      // Flush remaining buffer content
      if (stdoutBuf) handleLine(stdoutBuf);
      if (stderrBuf) handleLine(stderrBuf);

      if (code === 0) {
        resolve();
      } else {
        reject(Object.assign(new Error(`docker build exited with code ${code}`), { code }));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

// ── createAndStartContainer ──────────────────────────────────

/**
 * Creates and starts a student project container.
 *
 * Before creating, any existing container with the same name is
 * force-removed.  This prevents "container name already in use"
 * conflicts that occur when a previous stop/remove sequence was
 * interrupted — e.g. a switchDatabase hot-swap racing with a
 * webhook rebuild, or a crashed rebuild that left a stopped
 * container behind.
 *
 * Full docker create command (Section 7.8.2):
 *   docker create
 *     --name acadhost-project-{projectId}
 *     --restart unless-stopped
 *     --cpus={cpuLimit}
 *     --memory={ramLimitMb}m
 *     -p {containerPort}:8080
 *     --add-host=host.docker.internal:host-gateway
 *     [-e DB_HOST=... -e DB_PORT=... -e DB_USER=... -e DB_PASSWORD=... -e DB_NAME=...]
 *     acadhost/project-{projectId}:latest
 *
 * @param {number} projectId
 * @param {number} containerPort
 * @param {number} cpuLimit       — decimal cores (e.g. 1.00)
 * @param {number} ramLimitMb     — MB (e.g. 512)
 * @param {Object|null} envVars   — { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME }
 *                                  Pass null when no database is attached.
 * @returns {Promise<string>} containerId
 */
async function createAndStartContainer(projectId, containerPort, cpuLimit, ramLimitMb, envVars) {
  const containerName = `acadhost-project-${projectId}`;
  const imageName     = `acadhost/project-${projectId}:latest`;
  const internalPort  = process.env.CONTAINER_INTERNAL_PORT || '8080';

  // FIX (Bug 2): Force-remove any existing container with this name before
  // creating a new one.  Without this, a webhook rebuild that follows a
  // switchDatabase hot-swap (or any interrupted stop/remove sequence) will
  // fail with "Conflict. The container name is already in use."  The image
  // build reports success, but the container never starts — the builds row
  // is already marked 'success' by the time the docker create throws.
  // Silently ignore the error: if no such container exists that is fine.
  try {
    await runCommand('docker', ['rm', '-f', containerName]);
  } catch (_) {
    // Container does not exist — nothing to remove.
  }

  const createArgs = [
    'create',
    '--name', containerName,
    '--restart', 'unless-stopped',
    `--cpus=${cpuLimit}`,
    `--memory=${ramLimitMb}m`,
    '-p', `${containerPort}:${internalPort}`,
    '--add-host=host.docker.internal:host-gateway',
  ];

  // Inject database credentials only when a database is attached
  if (envVars && typeof envVars === 'object') {
    for (const [key, value] of Object.entries(envVars)) {
      createArgs.push('-e', `${key}=${value}`);
    }
  }

  createArgs.push(imageName);

  const { stdout: containerId } = await runCommand('docker', createArgs);

  await runCommand('docker', ['start', containerName]);

  return containerId;
}

// ── stopContainer ────────────────────────────────────────────

/**
 * Stops a running container.
 * @param {string} containerId
 */
async function stopContainer(containerId) {
  await runCommand('docker', ['stop', containerId]);
}

// ── removeContainer ──────────────────────────────────────────

/**
 * Removes a stopped container.
 * @param {string} containerId
 */
async function removeContainer(containerId) {
  await runCommand('docker', ['rm', containerId]);
}

// ── restartContainer ─────────────────────────────────────────

/**
 * Restarts a container.
 * @param {string} containerId
 */
async function restartContainer(containerId) {
  await runCommand('docker', ['restart', containerId]);
}

// ── removeImage ──────────────────────────────────────────────

/**
 * Removes a Docker image by name or ID.
 * Silently ignores "no such image" errors so that callers do not
 * need to check whether an image exists before calling this.
 *
 * @param {string} imageName — tag name OR image ID
 */
async function removeImage(imageName) {
  try {
    await runCommand('docker', ['rmi', '-f', imageName]);
  } catch (err) {
    const msg = err.message || '';
    if (
        msg.includes('No such image') ||
        msg.includes('no such image') ||
        msg.includes('not found')
    ) {
      // Image doesn't exist — not an error
      return;
    }
    throw err;
  }
}

// ── getImageId ───────────────────────────────────────────────

/**
 * Returns the image ID for a given image name/tag, or null if it does not
 * exist.
 *
 * Used by rebuildProject to capture the OLD image's ID *before* running
 * `docker build`, so that the old image can be deleted by ID afterward.
 * This is necessary because `docker build -t name:tag` moves the tag to the
 * new image — after the build, `name:tag` refers to the new image, not the
 * old one.  Deleting by tag would remove the newly built image instead of
 * the stale one, breaking any subsequent `createAndStartContainer` call
 * (e.g. from switchDatabase) that tries to reference the same tag.
 *
 * @param {string} imageName  e.g. "acadhost/project-1:latest"
 * @returns {Promise<string|null>} image ID, or null if not found
 */
async function getImageId(imageName) {
  try {
    const { stdout } = await runCommand('docker', ['images', '-q', imageName]);
    return stdout.trim() || null;
  } catch (_) {
    return null;
  }
}

// ── getContainerLogs ─────────────────────────────────────────

/**
 * Retrieves the most recent log lines from a running container.
 *
 * @param {string} containerId
 * @param {number} [tail=100]
 * @returns {Promise<string>} combined stdout + stderr output
 */
async function getContainerLogs(containerId, tail = 100) {
  try {
    const { stdout, stderr } = await runCommand('docker', [
      'logs',
      '--tail', String(tail),
      containerId,
    ]);
    return [stdout, stderr].filter(Boolean).join('\n');
  } catch (err) {
    throw Object.assign(new Error(`Failed to retrieve container logs: ${err.message}`), {
      code: 'CONTAINER_LOGS_FAILED',
    });
  }
}

// ── updateContainerResources ─────────────────────────────────

/**
 * Updates CPU and RAM limits on a running container without restarting it.
 *
 * Throws on failure so that buildService can trigger the container-recreation
 * fallback (Section 7.8.5).
 *
 * @param {string} containerId
 * @param {number} cpuLimit    — decimal cores
 * @param {number} ramLimitMb  — MB
 */
async function updateContainerResources(containerId, cpuLimit, ramLimitMb) {
  await runCommand('docker', [
    'update',
    `--cpus=${cpuLimit}`,
    `--memory=${ramLimitMb}m`,
    containerId,
  ]);
}

// ── inspectContainer ─────────────────────────────────────────

/**
 * Returns the full docker inspect output for a container as a parsed object.
 *
 * @param {string} containerId
 * @returns {Promise<Object>}
 */
async function inspectContainer(containerId) {
  const { stdout } = await runCommand('docker', ['inspect', containerId]);
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

module.exports = {
  buildImage,
  createAndStartContainer,
  stopContainer,
  removeContainer,
  restartContainer,
  removeImage,
  getImageId,
  getContainerLogs,
  updateContainerResources,
  inspectContainer,
};