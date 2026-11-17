/**
 * Login Rate Limiting & Account Lockout Service — Stage 4.1C / SBM-040
 * 
 * Strictly implements the approved Blueprint v2.1 Section 23 policy:
 * 1. 5 login attempts per IP per minute.
 * 2. Account lockout after 10 failed login attempts.
 * 3. Constant-time dummy verification for non-existent accounts to eliminate timing side-channels.
 * 4. Configurable lockout duration with safe defaults, documenting unresolved specifications.
 */

import { verifyPassword } from './passwordService.js';

// Pre-computed valid Argon2id hash for constant-time dummy verification on unknown emails
// Matches approved parameters: m=65536, t=3, p=4
export const DUMMY_ARGON2_HASH = '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$R9guVu2r4Hg2+qmsc0Mm88yK1U5wVbZk2s0lG9mGg98';

export class RateLimitError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RateLimitError';
    this.code = code;
    this.details = details;
  }
}

export class LoginRateLimitService {
  /**
   * @param {Object} [options]
   * @param {any} [options.redisClient] - Optional Redis client for multi-instance deployments
   * @param {number} [options.maxAttemptsPerIp=5] - Maximum attempts per IP per minute (Blueprint: 5)
   * @param {number} [options.windowSeconds=60] - Window size in seconds (Blueprint: 1 minute)
   * @param {number} [options.lockoutThreshold=10] - Failed attempt threshold before lockout (Blueprint: 10)
   * @param {number} [options.defaultLockoutDurationMs=900000] - Default 15 minutes (configurable)
   */
  constructor(options = {}) {
    this.redis = options.redisClient || null;
    this.maxAttemptsPerIp = options.maxAttemptsPerIp || 5;
    this.windowSeconds = options.windowSeconds || 60;
    this.lockoutThreshold = options.lockoutThreshold || 10;
    this.defaultLockoutDurationMs = options.defaultLockoutDurationMs || 15 * 60 * 1000;

    // In-memory store for environments without live Redis (e.g. tests, single-instance)
    this.inMemoryIpBuckets = new Map();
  }

  /**
   * Checks whether the given IP has exceeded the allowed login attempts.
   * 
   * @param {string} ip
   * @throws {RateLimitError} with code 'TOO_MANY_REQUESTS' and retryAfterSeconds
   */
  async checkIpRateLimit(ip) {
    const clientIp = ip || 'unknown_ip';
    const key = `ratelimit:login:ip:${clientIp}`;
    const now = Date.now();

    if (this.redis) {
      try {
        const count = await this.redis.incr(key);
        if (count === 1) {
          await this.redis.expire(key, this.windowSeconds);
        }
        if (count > this.maxAttemptsPerIp) {
          const ttl = await this.redis.ttl(key);
          throw new RateLimitError(
            'TOO_MANY_REQUESTS',
            `Too many login attempts from this IP address. Please try again in ${ttl > 0 ? ttl : this.windowSeconds} seconds.`,
            { retryAfterSeconds: ttl > 0 ? ttl : this.windowSeconds, ip: clientIp }
          );
        }
        return;
      } catch (err) {
        if (err instanceof RateLimitError) throw err;
        // In Redis failure, fall back to in-memory to fail safely
      }
    }

    // In-memory fallback
    let bucket = this.inMemoryIpBuckets.get(clientIp);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + (this.windowSeconds * 1000) };
      this.inMemoryIpBuckets.set(clientIp, bucket);
    }

    bucket.count++;
    if (bucket.count > this.maxAttemptsPerIp) {
      const remainingSeconds = Math.ceil((bucket.resetAt - now) / 1000);
      throw new RateLimitError(
        'TOO_MANY_REQUESTS',
        `Too many login attempts from this IP address. Please try again in ${remainingSeconds} seconds.`,
        { retryAfterSeconds: remainingSeconds, ip: clientIp }
      );
    }
  }

  /**
   * Evaluates if a user account is currently locked.
   * 
   * @param {Object} user
   * @returns {boolean}
   */
  isAccountLocked(user) {
    if (!user || !user.lockoutUntil) {
      return false;
    }
    const lockoutDate = new Date(user.lockoutUntil);
    return lockoutDate.getTime() > Date.now();
  }

  /**
   * Records a failed login attempt for an existing user and enforces account lockout.
   * 
   * @param {Object} user - User document
   * @returns {Promise<{ isLocked: boolean, failedAttempts: number, lockoutUntil: Date|null }>}
   */
  async recordFailedAttempt(user) {
    if (!user) {
      return { isLocked: false, failedAttempts: 0, lockoutUntil: null };
    }

    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;

    let isLocked = false;
    if (user.failedLoginAttempts >= this.lockoutThreshold) {
      const durationMs = process.env.AUTH_LOCKOUT_DURATION_MS
        ? parseInt(process.env.AUTH_LOCKOUT_DURATION_MS, 10)
        : this.defaultLockoutDurationMs;

      user.lockoutUntil = new Date(Date.now() + durationMs);
      isLocked = true;
    }

    if (typeof user.save === 'function') {
      await user.save();
    }

    return {
      isLocked,
      failedAttempts: user.failedLoginAttempts,
      lockoutUntil: user.lockoutUntil
    };
  }

  /**
   * Resets failed login attempts and unlocks account upon successful credential verification.
   * 
   * @param {Object} user
   */
  async resetFailedAttempts(user) {
    if (!user) return;
    if (user.failedLoginAttempts > 0 || user.lockoutUntil !== null) {
      user.failedLoginAttempts = 0;
      user.lockoutUntil = null;
      if (typeof user.save === 'function') {
        await user.save();
      }
    }
  }

  /**
   * Executes a constant-time dummy password verification to neutralize email enumeration.
   * 
   * @param {string} passwordAttempt
   */
  async performDummyVerification(passwordAttempt) {
    try {
      await verifyPassword(DUMMY_ARGON2_HASH, passwordAttempt || 'dummy_password');
    } catch {}
  }
}

export const defaultLoginRateLimitService = new LoginRateLimitService();
