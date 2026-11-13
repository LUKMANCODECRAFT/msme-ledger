/**
 * Email Normalization Utility
 * Strictly enforces case-insensitivity and whitespace trimming across all authentication write and query paths.
 * Conforms to SB Manager Rebuild Blueprint v2.1 and Phase 4 Architecture Plan Section 4.1.
 */

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * Checks if a given input is a validly formatted email string.
 * @param {string} email
 * @returns {boolean}
 */
export function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  return EMAIL_REGEX.test(trimmed);
}

/**
 * Normalizes an email address by trimming whitespace and converting to lowercase.
 * Validates basic RFC-compliant email structure.
 * 
 * @param {string} email - Raw user-supplied email address
 * @returns {string} - Trimmed, lowercased, canonical email
 * @throws {TypeError} - If email is not a string
 * @throws {Error} - If email format is invalid
 */
export function normalizeEmail(email) {
  if (typeof email !== 'string') {
    throw new TypeError('Email must be a non-empty string.');
  }

  const trimmed = email.trim();
  if (!trimmed) {
    throw new Error('INVALID_EMAIL_FORMAT: Email cannot be empty.');
  }

  if (trimmed.length > 254 || !EMAIL_REGEX.test(trimmed)) {
    throw new Error('INVALID_EMAIL_FORMAT: Malformed email address.');
  }

  return trimmed.toLowerCase();
}
