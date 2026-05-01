'use strict';

// ============================================================
// Container Stats Service — services/containerStatsService.js
//
// Samples live runtime stats from a student's project container using
// `docker stats --no-stream` and returns normalised values.
//
// Returned shape:
//   {
//     running: true,
//     cpuPercent: number,         // 0.0 .. 100.0 per core (can exceed if multi-core)
//     memUsageMb: number,         // absolute MB in use
//     memLimitMb: number,         // container's hard RAM cap
//     memPercent: number,         // 0.0 .. 100.0
//     netRxMb: number,            // inbound network since container start
//     netTxMb: number,            // outbound network since container start
//     sampledAt: ISO timestamp
//   }
//   or { running: false, reason: 'CONTAINER_NOT_FOUND' | 'CONTAINER_NOT_RUNNING' }
//
// Implementation notes:
//   - Relies on the same Docker socket as dockerService.js.
//   - Uses the Docker CLI because it's the simplest zero-dependency path;
//     the output format is stable across versions.
//   - 5 s timeout; returns running:false on failure.
// ============================================================

const { spawn } = require('child_process');

/**
 * Parses a docker-stats unit string like "12.5MiB", "1.2GiB", "800kB" into MB.
 * Returns 0 for unknown formats.
 *
 * @param {string} raw
 * @returns {number}
 */
function parseSizeToMb(raw) {
    if (!raw || typeof raw !== 'string') return 0;
    const m = raw.trim().match(/^([\d.]+)\s*([a-zA-Z]+)$/);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    switch (unit) {
        case 'b':    return n / (1024 * 1024);
        case 'kb':
        case 'kib':  return n / 1024;
        case 'mb':
        case 'mib':  return n;
        case 'gb':
        case 'gib':  return n * 1024;
        case 'tb':
        case 'tib':  return n * 1024 * 1024;
        default:     return 0;
    }
}

function parsePercent(raw) {
    if (!raw || typeof raw !== 'string') return 0;
    return parseFloat(raw.replace('%', '').trim()) || 0;
}

/**
 * Runs `docker stats <container> --no-stream --format <json>` with a timeout.
 * Resolves with parsed JSON object or null on any error.
 *
 * @param {string} containerName
 * @returns {Promise<object|null>}
 */
function runDockerStats(containerName) {
    return new Promise((resolve) => {
        const fmt = '{"cpu":"{{.CPUPerc}}","mem":"{{.MemUsage}}","memPerc":"{{.MemPerc}}","netIO":"{{.NetIO}}","blockIO":"{{.BlockIO}}"}';
        const proc = spawn('docker', ['stats', containerName, '--no-stream', '--format', fmt], {
            windowsHide: true,
        });

        let stdout = '';
        let stderr = '';
        let settled = false;

        const settle = (val) => {
            if (settled) return;
            settled = true;
            try { proc.kill(); } catch (_) { /* noop */ }
            resolve(val);
        };

        proc.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
        proc.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

        proc.on('error', () => settle(null));
        proc.on('close', (code) => {
            if (code !== 0) return settle(null);
            const line = stdout.trim().split('\n').pop();
            try {
                return settle(JSON.parse(line));
            } catch {
                return settle(null);
            }
        });

        // Hard timeout: 5 s
        setTimeout(() => settle(null), 5000);
    });
}

/**
 * Fetches live stats for a project container.
 *
 * @param {string} containerName — the Docker container name (e.g. "acadhost-project-42")
 * @returns {Promise<object>}
 */
async function getContainerStats(containerName) {
    if (!containerName) {
        return { running: false, reason: 'CONTAINER_NOT_FOUND' };
    }

    const raw = await runDockerStats(containerName);
    if (!raw) {
        return { running: false, reason: 'CONTAINER_NOT_RUNNING' };
    }

    // Parse mem: "12.5MiB / 512MiB"
    let memUsageMb = 0;
    let memLimitMb = 0;
    if (raw.mem && raw.mem.includes('/')) {
        const [used, limit] = raw.mem.split('/').map(s => s.trim());
        memUsageMb = parseSizeToMb(used);
        memLimitMb = parseSizeToMb(limit);
    }

    // Parse netIO: "1.2kB / 800B"
    let netRxMb = 0;
    let netTxMb = 0;
    if (raw.netIO && raw.netIO.includes('/')) {
        const [rx, tx] = raw.netIO.split('/').map(s => s.trim());
        netRxMb = parseSizeToMb(rx);
        netTxMb = parseSizeToMb(tx);
    }

    return {
        running:    true,
        cpuPercent: parsePercent(raw.cpu),
        memUsageMb: +memUsageMb.toFixed(1),
        memLimitMb: +memLimitMb.toFixed(1),
        memPercent: parsePercent(raw.memPerc),
        netRxMb:    +netRxMb.toFixed(2),
        netTxMb:    +netTxMb.toFixed(2),
        sampledAt:  new Date().toISOString(),
    };
}

module.exports = { getContainerStats };