'use strict';

// ============================================================
// Port Allocator — utils/portAllocator.js
// Section 7.5
//
// Allocates an available host port from the container port pool
// defined by CONTAINER_PORT_RANGE_START … CONTAINER_PORT_RANGE_END.
//
// Algorithm:
//   1. Query all in-use ports from projects.container_port.
//   2. Iterate the range and return the first port not in use.
//   3. Throw PORT_POOL_EXHAUSTED (HTTP 503) if the pool is full.
//
// Race-condition handling: callers (buildService) should retry up to
// 3 times on a MySQL duplicate-key error for container_port.
// allocatePort() is stateless — it re-queries on every call.
// ============================================================

const Project = require('../models/Project');

const DEFAULT_PORT_START = 10000;
const DEFAULT_PORT_END   = 20000;

/**
 * Returns the next available host port from the container port pool.
 *
 * @returns {Promise<number>}
 * @throws {{ code: string, message: string, httpStatus: number }}
 */
async function allocatePort() {
  const rangeStart = parseInt(process.env.CONTAINER_PORT_RANGE_START, 10) || DEFAULT_PORT_START;
  const rangeEnd   = parseInt(process.env.CONTAINER_PORT_RANGE_END,   10) || DEFAULT_PORT_END;

  const usedPorts = await Project.getUsedPorts();
  const usedSet   = new Set(usedPorts);

  for (let port = rangeStart; port <= rangeEnd; port++) {
    if (!usedSet.has(port)) {
      return port;
    }
  }

  throw {
    code: 'PORT_POOL_EXHAUSTED',
    message: 'No ports available in the container port pool',
    httpStatus: 503,
  };
}

module.exports = { allocatePort };
