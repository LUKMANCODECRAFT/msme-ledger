/**
 * Argon2id Password Service
 * Strictly conforms to SB Manager Rebuild Blueprint v2.1 Section 14.1 and Phase 4 Architecture Plan Section 4.1.
 * 
 * Cryptographic Parameters:
 * - Algorithm: Argon2id (type 2)
 * - Memory cost (m): 65,536 KiB (64 MiB)
 * - Time cost (t): 3 iterations
 * - Parallelism (p): 4 threads
 * - Salt: 16 cryptographically random bytes via crypto.randomBytes(16)
 * - Format: Standard Modular Crypt Format ($argon2id$v=19$m=65536,t=3,p=4$...)
 * 
 * Note: Under NO circumstances should plaintext passwords, generated salts, or raw hashes be logged.
 */

import argon2 from 'argon2';
import crypto from 'crypto';

export const ARGON2_CONFIG = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,       // 3 iterations
  parallelism: 4,    // 4 threads
  saltLength: 16     // 16 bytes
});

// Pre-computed constant dummy Argon2id hash with matching parameters for constant-time lookup failure mitigation
const DUMMY_ARGON2_HASH = '$argon2id$v=19$m=65536,t=3,p=4$Xiw5R65BD1J9p/pQyXZF8w$lDtoK7zxQBjYQvFHK7IUjcnWo7inYfNAGEPBOKRObqU';

/**
 * Hashes a plaintext password using Argon2id with strict Blueprint v2.1 parameters.
 * 
 * @param {string} password - The plaintext password to hash
 * @returns {Promise<string>} - The standard modular crypt format hash string
 * @throws {TypeError} - If password is not a valid string
 * @throws {Error} - If password fails minimum length requirement
 */
export async function hashPassword(password) {
  if (typeof password !== 'string') {
    throw new TypeError('Password must be a string.');
  }

  if (password.length < 8) {
    throw new Error('PASSWORD_TOO_SHORT: Password must be at least 8 characters long.');
  }

  // Generate cryptographically secure random 16-byte salt
  const salt = crypto.randomBytes(ARGON2_CONFIG.saltLength);

  return await argon2.hash(password, {
    type: ARGON2_CONFIG.type,
    memoryCost: ARGON2_CONFIG.memoryCost,
    timeCost: ARGON2_CONFIG.timeCost,
    parallelism: ARGON2_CONFIG.parallelism,
    salt
  });
}

/**
 * Verifies a candidate plaintext password against an Argon2id hash.
 * Safely handles invalid or malformed hash inputs without unhandled exceptions or info leakage.
 * 
 * @param {string} hash - The stored Argon2id hash string
 * @param {string} candidatePassword - The plaintext password attempt
 * @returns {Promise<boolean>} - True if password matches, false otherwise
 */
export async function verifyPassword(hash, candidatePassword) {
  if (typeof hash !== 'string' || typeof candidatePassword !== 'string') {
    return false;
  }

  // Quick sanity check on Modular Crypt Format prefix
  if (!hash.startsWith('$argon2id$')) {
    return false;
  }

  try {
    return await argon2.verify(hash, candidatePassword);
  } catch {
    // Malformed hash, corrupt encoding, or internal verification error
    return false;
  }
}

/**
 * Executes a dummy Argon2id verification against a pre-computed hash.
 * Used during login when a user email is not found to prevent timing-based user enumeration attacks.
 * 
 * @param {string} candidatePassword - The candidate password supplied by the caller
 * @returns {Promise<boolean>} - Always returns false
 */
export async function verifyDummyPassword(candidatePassword) {
  try {
    const candidate = typeof candidatePassword === 'string' ? candidatePassword : 'dummy';
    await argon2.verify(DUMMY_ARGON2_HASH, candidate);
  } catch {
    // Silently suppress
  }
  return false;
}
