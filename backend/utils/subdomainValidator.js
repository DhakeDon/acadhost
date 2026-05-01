'use strict';

// ============================================================
// Subdomain Validator — utils/subdomainValidator.js
// Section 3.3, Section 1.11
//
// Validates student-submitted subdomains before they are stored
// in projects.subdomain.  All rules are enforced here:
//   - lowercase alphanumeric + hyphens only
//   - cannot start or end with a hyphen
//   - max 63 characters
//   - not in the hardcoded reserved list
// ============================================================

// Reserved subdomains hardcoded per Section 3.3 / Section 1.11.
// Not an environment variable — this is a fixed security rule.
const RESERVED_SUBDOMAINS = new Set([
  'admin',
  'api',
  'www',
  'mail',
  'ftp',
  'smtp',
  'static',
  'app',
  'phpmyadmin',
]);

// Matches: one or more chars that are lowercase alphanumeric or hyphen,
// with the constraint that the first and last char must be alphanumeric.
// The alternation handles the single-character case (no hyphen at all).
const SUBDOMAIN_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

const MAX_SUBDOMAIN_LENGTH = 63;

/**
 * Validates a subdomain string.
 *
 * Throws a plain object { code, message, httpStatus: 400 } on any violation.
 * Returns true when the subdomain is valid.
 *
 * @param {string} subdomain
 * @returns {true}
 * @throws {{ code: string, message: string, httpStatus: number }}
 */
function validateSubdomain(subdomain) {
  // Length check first (cheap).
  if (typeof subdomain !== 'string' || subdomain.length === 0) {
    throw {
      code: 'SUBDOMAIN_INVALID_FORMAT',
      message: 'Subdomain must be lowercase alphanumeric and hyphens only, cannot start or end with a hyphen',
      httpStatus: 400,
    };
  }

  if (subdomain.length > MAX_SUBDOMAIN_LENGTH) {
    throw {
      code: 'SUBDOMAIN_TOO_LONG',
      message: 'Subdomain cannot exceed 63 characters',
      httpStatus: 400,
    };
  }

  if (!SUBDOMAIN_REGEX.test(subdomain)) {
    throw {
      code: 'SUBDOMAIN_INVALID_FORMAT',
      message: 'Subdomain must be lowercase alphanumeric and hyphens only, cannot start or end with a hyphen',
      httpStatus: 400,
    };
  }

  if (RESERVED_SUBDOMAINS.has(subdomain)) {
    throw {
      code: 'SUBDOMAIN_RESERVED',
      message: 'This subdomain is reserved and cannot be used',
      httpStatus: 400,
    };
  }

  return true;
}

/**
 * Returns true if the subdomain is in the reserved list.
 *
 * @param {string} subdomain
 * @returns {boolean}
 */
function isReserved(subdomain) {
  return RESERVED_SUBDOMAINS.has(subdomain);
}

/**
 * Generates a random 8-character alphanumeric subdomain.
 *
 * @returns {string}
 */
function generateRandomSubdomain() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Returns true if the subdomain matches the valid format:
 * lowercase alphanumeric and hyphens only, no leading/trailing hyphens,
 * between 3 and 63 characters.
 *
 * Does NOT check the reserved list.
 *
 * @param {string} subdomain
 * @returns {boolean}
 */
function isValidSubdomainFormat(subdomain) {
  if (typeof subdomain !== 'string') return false;
  if (subdomain.length < 3 || subdomain.length > MAX_SUBDOMAIN_LENGTH) return false;
  return SUBDOMAIN_REGEX.test(subdomain);
}

module.exports = {
  validateSubdomain,
  RESERVED_SUBDOMAINS,
  isReserved,
  generateRandomSubdomain,
  isValidSubdomainFormat,
};
