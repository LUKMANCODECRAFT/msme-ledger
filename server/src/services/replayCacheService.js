/**
 * Authenticated Ephemeral Replay Cache Service
 * Strictly conforms to SB Manager Rebuild Blueprint v2.1 Section 14 and Phase 4 Architecture Plan Section 4.3.
 * 
 * Cryptographic & Operational Architecture:
 * - Employs AES-256-GCM (Galois/Counter Mode) authenticated encryption.
 * - Every cached response is encrypted with a unique 12-byte initialization vector (IV)
 *   and verified against a 16-byte cryptographic authentication tag.
 * - Any bit-level tampering or forgery immediately fails verification and throws an integrity error.
 * - Stores ephemeral successor responses (R2 payload) for up to 30 seconds to support:
 *   1. Tier 1 concurrent browser tab races (0 - 10s).
 *   2. Tier 2 dropped network response retries (10s - 30s).
 * - Fails safe on cache miss, eviction, or service outage by forcing fresh re-authentication
 *   without falsely revoking the entire token family.
 */

import crypto from 'crypto';

export class ReplayCacheIntegrityError extends Error {
  constructor(message = 'Replay cache integrity check failed; payload may be tampered.') {
    super(message);
    this.name = 'ReplayCacheIntegrityError';
    this.code = 'REPLAY_CACHE_INTEGRITY_ERROR';
  }
}

export class ReplayCacheOutageError extends Error {
  constructor(message = 'Replay cache service unavailable.') {
    super(message);
    this.name = 'ReplayCacheOutageError';
    this.code = 'REPLAY_CACHE_UNAVAILABLE';
  }
}

export class ReplayCacheService {
  /**
   * @param {Object} [options]
   * @param {string|Buffer} [options.secret] - 32-byte key or secret passphrase
   * @param {number} [options.defaultTtlSeconds=30] - Default TTL in seconds
   */
  constructor(options = {}) {
    this.defaultTtlSeconds = options.defaultTtlSeconds || 30;
    this.simulatedOutage = false;
    this.store = new Map(); // tokenHash -> { iv, authTag, ciphertext, expiresAt }

    // Resolve 32-byte encryption key
    const rawSecret = options.secret || process.env.REPLAY_CACHE_SECRET;
    if (rawSecret) {
      if (Buffer.isBuffer(rawSecret) && rawSecret.length === 32) {
        this.key = rawSecret;
      } else {
        // Deterministically digest any string passphrase into 32 bytes (256 bits)
        this.key = crypto.createHash('sha256').update(String(rawSecret)).digest();
      }
    } else {
      // Ephemeral 32-byte key for local environment / testing
      this.key = crypto.randomBytes(32);
    }
  }

  /**
   * Encrypts a response payload using AES-256-GCM.
   * 
   * @param {Object} payload - Data to encrypt
   * @returns {{ iv: string, authTag: string, ciphertext: string }}
   */
  encryptPayload(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new TypeError('Payload to encrypt must be an object.');
    }

    const iv = crypto.randomBytes(12); // Standard 96-bit GCM IV
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    
    const jsonString = JSON.stringify(payload);
    const ciphertext = Buffer.concat([
      cipher.update(jsonString, 'utf8'),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext: ciphertext.toString('base64')
    };
  }

  /**
   * Decrypts an encrypted payload using AES-256-GCM.
   * 
   * @param {{ iv: string, authTag: string, ciphertext: string }} encryptedObj
   * @returns {Object} Decrypted payload
   */
  decryptPayload(encryptedObj) {
    if (!encryptedObj || !encryptedObj.iv || !encryptedObj.authTag || !encryptedObj.ciphertext) {
      throw new ReplayCacheIntegrityError('Malformed encrypted envelope.');
    }

    try {
      const iv = Buffer.from(encryptedObj.iv, 'base64');
      const authTag = Buffer.from(encryptedObj.authTag, 'base64');
      const ciphertext = Buffer.from(encryptedObj.ciphertext, 'base64');

      if (iv.length !== 12 || authTag.length !== 16) {
        throw new ReplayCacheIntegrityError('Invalid IV or auth tag length.');
      }

      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final()
      ]);

      return JSON.parse(decrypted.toString('utf8'));
    } catch (err) {
      if (err instanceof ReplayCacheIntegrityError) throw err;
      throw new ReplayCacheIntegrityError(`AES-256-GCM decryption failed: ${err.message}`);
    }
  }

  /**
   * Sets cached response for a consumed refresh token hash.
   * 
   * @param {string} tokenHash - SHA-256 hex digest of the consumed token
   * @param {Object} payload - Response package (e.g. { accessToken, refreshToken, expiresIn })
   * @param {number} [ttlSeconds] - Time-to-live in seconds
   */
  async setCachedResponse(tokenHash, payload, ttlSeconds = this.defaultTtlSeconds) {
    if (this.simulatedOutage) {
      throw new ReplayCacheOutageError('Cache service currently offline.');
    }

    if (!tokenHash || typeof tokenHash !== 'string') {
      throw new TypeError('tokenHash must be a non-empty string.');
    }

    const encrypted = this.encryptPayload(payload);
    const expiresAt = Date.now() + (ttlSeconds * 1000);

    this.store.set(tokenHash, {
      ...encrypted,
      expiresAt
    });
  }

  /**
   * Retrieves and decrypts the cached response for a consumed token hash.
   * 
   * @param {string} tokenHash - SHA-256 hex digest of the consumed token
   * @returns {Promise<Object|null>} Decrypted payload or null if absent/expired
   */
  async getCachedResponse(tokenHash) {
    if (this.simulatedOutage) {
      // In outage mode, cache misses or errors fail safely
      return null;
    }

    if (!tokenHash || typeof tokenHash !== 'string') {
      return null;
    }

    const entry = this.store.get(tokenHash);
    if (!entry) {
      return null;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.store.delete(tokenHash);
      return null;
    }

    return this.decryptPayload(entry);
  }

  /**
   * Deletes cached response for a token hash.
   * 
   * @param {string} tokenHash
   */
  async deleteCachedResponse(tokenHash) {
    if (tokenHash) {
      this.store.delete(tokenHash);
    }
  }

  /**
   * Clears all cached entries.
   */
  clear() {
    this.store.clear();
  }

  /**
   * Toggles outage simulation for resilience testing.
   * 
   * @param {boolean} outage
   */
  setSimulateOutage(outage) {
    this.simulatedOutage = Boolean(outage);
  }
}

// Global default instance for convenience
export const defaultReplayCacheService = new ReplayCacheService();
