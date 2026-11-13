/**
 * Authenticated Ephemeral Replay Cache Service
 * Strictly conforms to SB Manager Rebuild Blueprint v2.1 Section 14 and Phase 4 Architecture Plan Section 4.3.
 * 
 * Cryptographic & Operational Architecture:
 * - Employs AES-256-GCM (Galois/Counter Mode) authenticated encryption.
 * - Every cached response is encrypted with a unique 12-byte initialization vector (IV)
 *   and verified against a 16-byte cryptographic authentication tag.
 * - Any bit-level tampering or forgery immediately fails verification and throws an integrity error.
 * - Production Adapter: RedisReplayCacheService backed by ioredis client.
 *   - Shared across all cluster instances.
 *   - Survives application restarts for remaining TTL (capped at 30 seconds).
 *   - Bound to token hash and token family.
 *   - Fails closed on invalid keys, tampering, or Redis outage.
 * - In-Memory Adapter: InMemoryReplayCacheService for isolated unit tests only.
 *   - Strictly prohibited in production environments.
 */

import crypto from 'crypto';
import Redis from 'ioredis';

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

export class ConfigurationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ConfigurationError';
    this.code = code;
  }
}

/**
 * Redacts credentials (username/password) embedded in URLs (e.g. redis://user:pass@host:port).
 * 
 * @param {string} rawUrl
 * @returns {string}
 */
export function redactSensitiveUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return '';
  return rawUrl.replace(/:\/\/([^\s/@]+)@/g, '://***:***@');
}

/**
 * Sanitizes an error message or log string by redacting embedded URLs, secrets, or tokens.
 * 
 * @param {string} message
 * @returns {string}
 */
export function sanitizeErrorMessage(message) {
  if (typeof message !== 'string') return '';
  return message
    .replace(/:\/\/([^\s/@]+)@/g, '://***:***@')
    .replace(/(password|secret|token|key|pwd)=([^\s&]+)/gi, '$1=***');
}

/**
 * Resolves a stable 32-byte Buffer key for AES-256-GCM.
 * In production, fails closed if REPLAY_CACHE_SECRET is missing or invalid.
 * 
 * @param {string|Buffer} [rawSecret]
 * @param {boolean} [isProduction=false]
 * @returns {Buffer}
 */
export function resolveReplayCacheKey(rawSecret, isProduction = process.env.NODE_ENV === 'production') {
  const secret = rawSecret || process.env.REPLAY_CACHE_SECRET;

  if (!secret) {
    if (isProduction) {
      throw new ConfigurationError(
        'MISSING_REPLAY_CACHE_SECRET',
        'Production environment requires an explicitly configured 32-byte REPLAY_CACHE_SECRET.'
      );
    }
    // Only in non-production, allow test fallback key
    return crypto.createHash('sha256').update('sb-manager-dev-replay-cache-secret').digest();
  }

  if (Buffer.isBuffer(secret)) {
    if (secret.length !== 32) {
      throw new ConfigurationError(
        'INVALID_REPLAY_CACHE_SECRET',
        `REPLAY_CACHE_SECRET buffer must be exactly 32 bytes, got ${secret.length} bytes.`
      );
    }
    return secret;
  }

  if (typeof secret === 'string') {
    const trimmed = secret.trim();
    // Support 64-character hex strings directly
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      return Buffer.from(trimmed, 'hex');
    }
    // Or digest any passphrase into 32 bytes
    if (trimmed.length < 16 && isProduction) {
      throw new ConfigurationError(
        'INSUFFICIENT_REPLAY_CACHE_SECRET_ENTROPY',
        'Production REPLAY_CACHE_SECRET passphrase must be at least 16 characters or a 64-hex string.'
      );
    }
    return crypto.createHash('sha256').update(trimmed).digest();
  }

  throw new ConfigurationError('INVALID_REPLAY_CACHE_SECRET', 'REPLAY_CACHE_SECRET must be a string or Buffer.');
}

/**
 * Encrypts a response payload using AES-256-GCM.
 * 
 * @param {Object} payload - Data to encrypt
 * @param {Buffer} key - 32-byte key
 * @returns {{ iv: string, authTag: string, ciphertext: string }}
 */
export function encryptPayload(payload, key) {
  if (!payload || typeof payload !== 'object') {
    throw new TypeError('Payload to encrypt must be an object.');
  }

  const iv = crypto.randomBytes(12); // Standard 96-bit GCM IV
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
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
 * @param {Buffer} key - 32-byte key
 * @returns {Object} Decrypted payload
 */
export function decryptPayload(encryptedObj, key) {
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

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
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
 * Production Redis Replay Cache Service
 * Backed by Redis / ioredis. Shared by all instances, survives app process restarts.
 */
export class RedisReplayCacheService {
  /**
   * @param {Object} options
   * @param {import('ioredis').Redis} [options.redisClient] - Pre-instantiated ioredis client
   * @param {string} [options.redisUrl] - Redis connection URL
   * @param {string|Buffer} [options.secret] - Stable 32-byte secret
   * @param {number} [options.defaultTtlSeconds=30] - TTL in seconds (capped at 30)
   */
  constructor(options = {}) {
    const isProduction = process.env.NODE_ENV === 'production';
    this.key = resolveReplayCacheKey(options.secret, isProduction);
    this.defaultTtlSeconds = Math.min(options.defaultTtlSeconds || 30, 30);
    this.simulatedOutage = false;

    if (options.redisClient) {
      this.client = options.redisClient;
      this.ownsClient = false;
    } else {
      const url = options.redisUrl || process.env.REDIS_URL;
      if (!url && isProduction) {
        throw new ConfigurationError(
          'MISSING_REDIS_URL',
          'Production environment requires an explicitly configured REDIS_URL for the shared replay cache.'
        );
      }
      this.client = new Redis(url || 'redis://127.0.0.1:6379', {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        lazyConnect: true,
        retryStrategy: () => null
      });
      this.client.on('error', () => {});
      this.ownsClient = true;
    }
  }

  encryptPayload(payload) {
    return encryptPayload(payload, this.key);
  }

  decryptPayload(encryptedObj) {
    return decryptPayload(encryptedObj, this.key);
  }

  /**
   * Stores an encrypted response payload in Redis keyed by consumed token hash.
   * 
   * @param {string} tokenHash
   * @param {Object} payload
   * @param {number} [ttlSeconds=30]
   * @param {string} [familyId]
   */
  async setCachedResponse(tokenHash, payload, ttlSeconds = this.defaultTtlSeconds, familyId = null) {
    if (this.simulatedOutage) {
      throw new ReplayCacheOutageError('Simulated Redis outage.');
    }

    if (!tokenHash || typeof tokenHash !== 'string') {
      throw new TypeError('tokenHash must be a non-empty string.');
    }

    const effectiveTtl = Math.min(ttlSeconds, 30);
    const enrichedPayload = {
      ...payload
    };
    if (familyId || payload.familyId) {
      enrichedPayload.familyId = familyId || payload.familyId;
    }

    const encrypted = encryptPayload(enrichedPayload, this.key);
    const envelope = JSON.stringify({
      ...encrypted,
      familyId: enrichedPayload.familyId || null
    });

    const redisKey = `replay:${tokenHash}`;

    try {
      await this.client.set(redisKey, envelope, 'EX', effectiveTtl);
    } catch (err) {
      throw new ReplayCacheOutageError(`Redis set failed: ${sanitizeErrorMessage(err.message)}`);
    }
  }

  /**
   * Retrieves and decrypts the cached response from Redis.
   * 
   * @param {string} tokenHash
   * @param {string} [expectedFamilyId]
   * @returns {Promise<Object|null>}
   */
  async getCachedResponse(tokenHash, expectedFamilyId = null) {
    if (this.simulatedOutage) {
      // In outage mode, returns null so caller can invoke approved concurrency/recovery path
      return null;
    }

    if (!tokenHash || typeof tokenHash !== 'string') {
      return null;
    }

    const redisKey = `replay:${tokenHash}`;
    let rawEnvelope;

    try {
      rawEnvelope = await this.client.get(redisKey);
    } catch (err) {
      // Redis error fails safely without crashing process
      return null;
    }

    if (!rawEnvelope) {
      return null;
    }

    let parsedEnvelope;
    try {
      parsedEnvelope = JSON.parse(rawEnvelope);
    } catch {
      throw new ReplayCacheIntegrityError('Redis cache payload is corrupted JSON.');
    }

    // Verify envelope binding
    if (expectedFamilyId && parsedEnvelope.familyId && parsedEnvelope.familyId !== expectedFamilyId) {
      throw new ReplayCacheIntegrityError('Replay cache familyId mismatch.');
    }

    const decrypted = decryptPayload(parsedEnvelope, this.key);

    if (expectedFamilyId && decrypted.familyId && decrypted.familyId !== expectedFamilyId) {
      throw new ReplayCacheIntegrityError('Decrypted payload familyId mismatch.');
    }

    return decrypted;
  }

  /**
   * Deletes a cached entry from Redis.
   * 
   * @param {string} tokenHash
   */
  async deleteCachedResponse(tokenHash) {
    if (!tokenHash || this.simulatedOutage) return;
    try {
      await this.client.del(`replay:${tokenHash}`);
    } catch {
      // Best effort eviction
    }
  }

  /**
   * Safely deletes a cached response ONLY if the stored payload's successor matches expectedSuccessorHash.
   * Prevents a failed transaction rollback from wiping out a concurrent successful rotation.
   * 
   * @param {string} tokenHash - Consumed token hash (cache key)
   * @param {string} expectedSuccessorHash - The staged successor hash to compare
   * @returns {Promise<boolean>}
   */
  async deleteCachedResponseIfMatches(tokenHash, expectedSuccessorHash) {
    if (!tokenHash || !expectedSuccessorHash || this.simulatedOutage) return false;
    try {
      const cached = await this.getCachedResponse(tokenHash);
      if (cached && (cached.tokenHash === expectedSuccessorHash || cached.nextTokenHash === expectedSuccessorHash || cached.successorTokenHash === expectedSuccessorHash)) {
        await this.deleteCachedResponse(tokenHash);
        return true;
      }
    } catch {
      // Best effort
    }
    return false;
  }

  /**
   * Pings Redis to verify connectivity during startup and health/readiness checks.
   * 
   * @returns {Promise<boolean>}
   */
  async ping() {
    if (this.simulatedOutage) {
      throw new ReplayCacheOutageError('Simulated Redis outage during ping.');
    }
    try {
      const res = await this.client.ping();
      return res === 'PONG' || res === true;
    } catch (err) {
      throw new ReplayCacheOutageError(`Redis ping failed: ${sanitizeErrorMessage(err.message)}`);
    }
  }

  /**
   * Closes connection.
   */
  async close() {
    if (this.client) {
      try {
        if (typeof this.client.quit === 'function') {
          await this.client.quit();
        } else if (typeof this.client.disconnect === 'function') {
          this.client.disconnect();
        }
      } catch {
        this.client.disconnect?.();
      }
    }
  }

  setSimulateOutage(outage) {
    this.simulatedOutage = Boolean(outage);
  }
}

/**
 * In-Memory Replay Cache Service
 * Strictly prohibited in production environments.
 */
export class InMemoryReplayCacheService {
  constructor(options = {}) {
    if (process.env.NODE_ENV === 'production') {
      throw new ConfigurationError(
        'IN_MEMORY_CACHE_PROHIBITED_IN_PROD',
        'InMemoryReplayCacheService is strictly prohibited in production environments.'
      );
    }

    this.defaultTtlSeconds = Math.min(options.defaultTtlSeconds || 30, 30);
    this.simulatedOutage = false;
    this.store = new Map();
    this.key = resolveReplayCacheKey(options.secret, false);
  }

  encryptPayload(payload) {
    return encryptPayload(payload, this.key);
  }

  decryptPayload(encryptedObj) {
    return decryptPayload(encryptedObj, this.key);
  }

  async setCachedResponse(tokenHash, payload, ttlSeconds = this.defaultTtlSeconds, familyId = null) {
    if (this.simulatedOutage) {
      throw new ReplayCacheOutageError('Simulated in-memory cache outage.');
    }

    if (!tokenHash || typeof tokenHash !== 'string') {
      throw new TypeError('tokenHash must be a non-empty string.');
    }

    const effectiveTtl = Math.min(ttlSeconds, 30);
    const enrichedPayload = {
      ...payload
    };
    if (familyId || payload.familyId) {
      enrichedPayload.familyId = familyId || payload.familyId;
    }

    const encrypted = encryptPayload(enrichedPayload, this.key);
    const expiresAt = Date.now() + (effectiveTtl * 1000);

    this.store.set(tokenHash, {
      ...encrypted,
      familyId: enrichedPayload.familyId || null,
      expiresAt
    });
  }

  async getCachedResponse(tokenHash, expectedFamilyId = null) {
    if (this.simulatedOutage || !tokenHash) {
      return null;
    }

    const entry = this.store.get(tokenHash);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(tokenHash);
      return null;
    }

    if (expectedFamilyId && entry.familyId && entry.familyId !== expectedFamilyId) {
      throw new ReplayCacheIntegrityError('Family ID mismatch in cache envelope.');
    }

    const decrypted = decryptPayload(entry, this.key);
    if (expectedFamilyId && decrypted.familyId && decrypted.familyId !== expectedFamilyId) {
      throw new ReplayCacheIntegrityError('Family ID mismatch in decrypted payload.');
    }

    return decrypted;
  }

  async deleteCachedResponse(tokenHash) {
    if (tokenHash) {
      this.store.delete(tokenHash);
    }
  }

  async deleteCachedResponseIfMatches(tokenHash, expectedSuccessorHash) {
    if (!tokenHash || !expectedSuccessorHash || this.simulatedOutage) return false;
    try {
      const cached = await this.getCachedResponse(tokenHash);
      if (cached && (cached.tokenHash === expectedSuccessorHash || cached.nextTokenHash === expectedSuccessorHash || cached.successorTokenHash === expectedSuccessorHash)) {
        await this.deleteCachedResponse(tokenHash);
        return true;
      }
    } catch {
      // Best effort
    }
    return false;
  }

  clear() {
    this.store.clear();
  }

  async ping() {
    if (this.simulatedOutage) {
      throw new ReplayCacheOutageError('Simulated in-memory outage during ping.');
    }
    return true;
  }

  async close() {
    this.clear();
  }

  setSimulateOutage(outage) {
    this.simulatedOutage = Boolean(outage);
  }
}

/**
 * Creates the appropriate ReplayCacheService instance based on configuration and environment.
 * In production, strictly requires Redis configuration and fails closed if missing.
 * 
 * @param {Object} [options]
 * @returns {RedisReplayCacheService|InMemoryReplayCacheService}
 */
export function createReplayCacheService(options = {}) {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    // In production, NEVER allow in-memory fallback
    if (options.adapter === 'memory') {
      throw new ConfigurationError(
        'IN_MEMORY_CACHE_PROHIBITED_IN_PROD',
        'Cannot use in-memory replay cache in production environment.'
      );
    }
    return new RedisReplayCacheService(options);
  }

  // Non-production (dev / test)
  if (options.adapter === 'redis' || options.redisClient || options.redisUrl || process.env.REDIS_URL) {
    return new RedisReplayCacheService(options);
  }

  return new InMemoryReplayCacheService(options);
}

// Backward-compatible alias for existing imports
export const ReplayCacheService = InMemoryReplayCacheService;
export const defaultReplayCacheService = new InMemoryReplayCacheService();
