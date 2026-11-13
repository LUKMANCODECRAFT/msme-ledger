/**
 * Refresh Token Lifecycle & Rotation Service
 * Strictly conforms to SB Manager Rebuild Blueprint v2.1 Section 14 and Phase 4 Architecture Plan Section 4.3.
 * 
 * Cryptographic & Operational Architecture:
 * - Refresh Token Entropy: 32 cryptographically random bytes (256 bits) encoded in base64url.
 * - Storage Security: Only the SHA-256 hex digest (tokenHash) is persisted in the database.
 * - Plaintext refresh tokens are never stored, logged, or returned in response bodies (only in secure cookies).
 * - Rotation Policy: Atomic rotation on every refresh request.
 * - Concurrency & Replay Protection:
 *   - Tier 1 (0 - 10s): Concurrent refresh window. Returns cached response or 409 Conflict without family revocation.
 *   - Tier 2 (10 - 30s): Delivery loss recovery window. Re-issues cached response or terminates branch with 401 Reauth Required without family revocation.
 *   - Tier 3 (> 30s): Malicious replay attack. Immediately revokes the entire token family.
 */

import crypto from 'crypto';
import { RefreshToken } from '../models/target/refreshTokenModel.js';
import { User } from '../models/target/coreModels.js';
import { signAccessToken, generateTestRsaKeyPair, JWT_CONFIG } from './jwtService.js';
import { defaultReplayCacheService } from './replayCacheService.js';

export class RefreshTokenError extends Error {
  constructor(code, statusCode, message, extra = {}) {
    super(message);
    this.name = 'RefreshTokenError';
    this.code = code;
    this.statusCode = statusCode;
    Object.assign(this, extra);
  }
}

/**
 * Generates a cryptographically secure 32-byte refresh token and its SHA-256 hash.
 * 
 * @returns {{ rawToken: string, tokenHash: string }}
 */
export function generateRefreshToken() {
  const rawBytes = crypto.randomBytes(32);
  const rawToken = rawBytes.toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return { rawToken, tokenHash };
}

/**
 * Computes the SHA-256 hex hash of a raw refresh token.
 * 
 * @param {string} rawToken
 * @returns {string}
 */
export function hashRefreshToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
    throw new RefreshTokenError('INVALID_REFRESH_TOKEN', 401, 'Refresh token must be a non-empty string.');
  }
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
}

/**
 * Default Mongoose persistence store adapter.
 */
export class MongooseRefreshTokenStore {
  constructor(refreshTokenModel = RefreshToken, userModel = User) {
    this.model = refreshTokenModel;
    this.userModel = userModel;
  }

  async findByTokenHash(tokenHash) {
    return this.model.findOne({ tokenHash });
  }

  async findUserById(userId) {
    return this.userModel.findOne({ id: userId });
  }

  async isFamilyRevoked(familyId) {
    const revoked = await this.model.findOne({ familyId, status: 'revoked' });
    return Boolean(revoked);
  }

  async createToken(doc) {
    return this.model.create(doc);
  }

  async consumeToken(id, { consumedAt, replacedByHash }) {
    return this.model.findOneAndUpdate(
      { id, status: 'active' },
      {
        $set: {
          status: 'consumed',
          consumedAt,
          replacedByHash,
          replacedByTokenHash: replacedByHash
        }
      },
      { new: true }
    );
  }

  async markDeliveryTerminated(id) {
    return this.model.updateOne(
      { id },
      { $set: { status: 'delivery_terminated' } }
    );
  }

  async revokeFamily(familyId, { revokedAt, reuseDetectedAt, reason }) {
    return this.model.updateMany(
      { familyId },
      {
        $set: {
          status: 'revoked',
          revokedAt,
          reuseDetectedAt: reuseDetectedAt || null,
          revocationReason: reason
        }
      }
    );
  }
}

/**
 * In-memory persistence store adapter for unit tests and local isolation.
 */
export class InMemoryRefreshTokenStore {
  constructor() {
    this.tokens = new Map(); // id -> tokenDoc
    this.users = new Map();  // id -> userDoc
  }

  addUser(user) {
    this.users.set(user.id, { ...user });
  }

  async findByTokenHash(tokenHash) {
    for (const token of this.tokens.values()) {
      if (token.tokenHash === tokenHash) {
        return { ...token };
      }
    }
    return null;
  }

  async findUserById(userId) {
    const u = this.users.get(userId);
    return u ? { ...u } : null;
  }

  async isFamilyRevoked(familyId) {
    for (const token of this.tokens.values()) {
      if (token.familyId === familyId && token.status === 'revoked') {
        return true;
      }
    }
    return false;
  }

  async createToken(doc) {
    const tokenDoc = {
      ...doc,
      createdAt: doc.createdAt || new Date(),
      updatedAt: doc.updatedAt || new Date()
    };
    this.tokens.set(tokenDoc.id, tokenDoc);
    return { ...tokenDoc };
  }

  async consumeToken(id, { consumedAt, replacedByHash }) {
    const token = this.tokens.get(id);
    if (!token || token.status !== 'active') {
      return null;
    }
    token.status = 'consumed';
    token.consumedAt = consumedAt;
    token.replacedByHash = replacedByHash;
    token.replacedByTokenHash = replacedByHash;
    token.updatedAt = new Date();
    this.tokens.set(id, token);
    return { ...token };
  }

  async markDeliveryTerminated(id) {
    const token = this.tokens.get(id);
    if (token) {
      token.status = 'delivery_terminated';
      token.updatedAt = new Date();
      this.tokens.set(id, token);
    }
  }

  async revokeFamily(familyId, { revokedAt, reuseDetectedAt, reason }) {
    for (const [id, token] of this.tokens.entries()) {
      if (token.familyId === familyId) {
        token.status = 'revoked';
        token.revokedAt = revokedAt;
        token.reuseDetectedAt = reuseDetectedAt || null;
        token.revocationReason = reason;
        token.updatedAt = new Date();
        this.tokens.set(id, token);
      }
    }
  }

  clear() {
    this.tokens.clear();
    this.users.clear();
  }
}

export class RefreshTokenService {
  /**
   * @param {Object} [options]
   * @param {Object} [options.store] - Persistence store adapter
   * @param {Object} [options.replayCache] - Replay cache service instance
   * @param {string} [options.signingKey] - RS256 private key for access tokens
   * @param {string} [options.kid] - Key ID header
   */
  constructor(options = {}) {
    this.store = options.store || new MongooseRefreshTokenStore();
    this.replayCache = options.replayCache || defaultReplayCacheService;
    this.signingKey = options.signingKey || process.env.JWT_PRIVATE_KEY;
    this.kid = options.kid || process.env.JWT_KEY_ID;

    // Fallback to test keypair if no signing key is configured
    if (!this.signingKey || !this.kid) {
      const ephemeralKey = generateTestRsaKeyPair('auth-service-key-1');
      this.signingKey = this.signingKey || ephemeralKey.privateKey;
      this.kid = this.kid || ephemeralKey.kid;
    }
  }

  /**
   * Creates an initial refresh token session for a verified merchant user.
   * 
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.email
   * @param {string} [params.defaultBusinessId]
   * @param {string} [params.userAgent]
   * @param {string} [params.ipAddress]
   * @returns {Promise<{ accessToken: string, refreshToken: string, familyId: string, expiresIn: number }>}
   */
  async createInitialSession(params) {
    const { userId, email, defaultBusinessId = null, userAgent = null, ipAddress = null } = params;

    if (!userId || typeof userId !== 'string') {
      throw new RefreshTokenError('INVALID_USER_ID', 400, 'userId is required.');
    }

    if (!email || typeof email !== 'string') {
      throw new RefreshTokenError('INVALID_EMAIL', 400, 'email is required.');
    }

    const familyId = crypto.randomUUID();
    const { rawToken, tokenHash } = generateRefreshToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await this.store.createToken({
      id: crypto.randomUUID(),
      userId,
      tokenHash,
      familyId,
      status: 'active',
      expiresAt,
      userAgent,
      ipAddress,
      createdAt: now,
      updatedAt: now
    });

    const accessToken = signAccessToken(
      { sub: userId, email, defaultBusinessId },
      this.signingKey,
      { kid: this.kid, expiresInSeconds: JWT_CONFIG.MAX_ACCESS_TOKEN_TTL_SECONDS }
    );

    return {
      accessToken,
      refreshToken: rawToken,
      familyId,
      expiresIn: JWT_CONFIG.MAX_ACCESS_TOKEN_TTL_SECONDS
    };
  }

  /**
   * Rotates an existing refresh token with atomic replacement, concurrency grace window,
   * delivery-loss recovery, and token-family replay detection.
   * 
   * @param {string} rawToken - Presented raw refresh token from cookie
   * @param {Object} [options]
   * @param {string} [options.userAgent]
   * @param {string} [options.ipAddress]
   * @param {Date} [options.now] - Explicit timestamp override for deterministic tests
   * @param {string} [options.email] - Optional fallback user email
   * @returns {Promise<{ accessToken: string, refreshToken: string, expiresIn: number, tokenType: string, isReplay?: boolean }>}
   */
  async rotateRefreshToken(rawToken, options = {}) {
    const tokenHash = hashRefreshToken(rawToken);
    const now = options.now instanceof Date ? options.now : new Date();

    // 1. Look up presented token in persistence store
    const currentToken = await this.store.findByTokenHash(tokenHash);
    if (!currentToken) {
      throw new RefreshTokenError('INVALID_REFRESH_TOKEN', 401, 'Invalid or unrecognized refresh token.');
    }

    // 2. Check token expiration
    if (new Date(currentToken.expiresAt) <= now) {
      throw new RefreshTokenError('REFRESH_TOKEN_EXPIRED', 401, 'Refresh token has expired.');
    }

    // 3. Check delivery termination state
    if (currentToken.status === 'delivery_terminated') {
      throw new RefreshTokenError(
        'REFRESH_DELIVERY_FAILED_REAUTH_REQUIRED',
        401,
        'Previous session rotation delivery failed. Please re-authenticate.'
      );
    }

    // 4. Invariant: Check if family is revoked
    const isRevoked = currentToken.status === 'revoked' || (await this.store.isFamilyRevoked(currentToken.familyId));
    if (isRevoked) {
      throw new RefreshTokenError('TOKEN_FAMILY_ALREADY_REVOKED', 401, 'Token family has been revoked.');
    }

    // =========================================================================
    // CASE A: Token is ACTIVE — Perform Atomic Rotation
    // =========================================================================
    if (currentToken.status === 'active') {
      const { rawToken: nextRawToken, tokenHash: nextTokenHash } = generateRefreshToken();

      // Atomic rotation: conditionally transition status from 'active' to 'consumed'
      const consumedDoc = await this.store.consumeToken(currentToken.id, {
        consumedAt: now,
        replacedByHash: nextTokenHash
      });

      if (!consumedDoc) {
        // A concurrent request won the atomic rotation! Re-read and fall through to consumed path.
        const reRead = await this.store.findByTokenHash(tokenHash);
        if (reRead && reRead.status === 'consumed') {
          return this._handleConsumedToken(reRead, tokenHash, now, options);
        }
        throw new RefreshTokenError('CONCURRENT_ROTATION_RACE', 409, 'Concurrent rotation detected.');
      }

      // Create active successor token in the same family
      const successorExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      await this.store.createToken({
        id: crypto.randomUUID(),
        userId: currentToken.userId,
        familyId: currentToken.familyId,
        tokenHash: nextTokenHash,
        status: 'active',
        expiresAt: successorExpiresAt,
        userAgent: options.userAgent || currentToken.userAgent || null,
        ipAddress: options.ipAddress || currentToken.ipAddress || null,
        createdAt: now,
        updatedAt: now
      });

      // Resolve user for access token claims
      const user = await this.store.findUserById(currentToken.userId);
      const email = user?.email || options.email;
      if (!email) {
        throw new RefreshTokenError('USER_EMAIL_NOT_FOUND', 500, 'Unable to resolve user email for access token signing.');
      }

      const accessToken = signAccessToken(
        {
          sub: currentToken.userId,
          email,
          defaultBusinessId: user?.defaultBusinessId || null
        },
        this.signingKey,
        {
          kid: this.kid,
          expiresInSeconds: JWT_CONFIG.MAX_ACCESS_TOKEN_TTL_SECONDS
        }
      );

      const responsePayload = {
        accessToken,
        refreshToken: nextRawToken,
        tokenType: 'Bearer',
        expiresIn: JWT_CONFIG.MAX_ACCESS_TOKEN_TTL_SECONDS
      };

      // Authenticated Ephemeral Cache: Store encrypted R2 payload for 30s
      try {
        await this.replayCache.setCachedResponse(tokenHash, responsePayload, 30);
      } catch (cacheErr) {
        // Cache errors do not fail the rotation, but are safely swallowed
      }

      return responsePayload;
    }

    // =========================================================================
    // CASE B: Token is CONSUMED — Handle Concurrency, Retries & Replay Attacks
    // =========================================================================
    if (currentToken.status === 'consumed') {
      return this._handleConsumedToken(currentToken, tokenHash, now, options);
    }

    throw new RefreshTokenError('INVALID_TOKEN_STATE', 401, `Invalid token status: ${currentToken.status}`);
  }

  /**
   * Evaluates consumed token reuse against the two-tier timing & recovery contract.
   * 
   * @private
   */
  async _handleConsumedToken(currentToken, tokenHash, now, options) {
    const consumedAtTime = new Date(currentToken.consumedAt).getTime();
    const deltaMs = now.getTime() - consumedAtTime;

    // -----------------------------------------------------------------------
    // TIER 1 & TIER 2: deltaMs <= 30,000ms (Concurrent Refresh & Delivery Loss)
    // -----------------------------------------------------------------------
    if (deltaMs <= 30000) {
      // Query Authenticated Ephemeral Cache
      const cachedResponse = await this.replayCache.getCachedResponse(tokenHash);
      if (cachedResponse) {
        // Idempotently return the exact successor payload
        return {
          ...cachedResponse,
          isReplay: true
        };
      }

      // Cache Miss or Cache Service Outage
      if (deltaMs <= 10000) {
        // Tier 1 (0 - 10s): Concurrent tab race. Do NOT revoke family.
        throw new RefreshTokenError(
          'CONCURRENT_REFRESH_IN_PROGRESS',
          409,
          'Concurrent refresh in progress; retry in 1 second.',
          { retryAfter: 1 }
        );
      } else {
        // Tier 2 (10 - 30s): Delivery loss retry without cached response.
        // Mark branch delivery terminated and require login without revoking family.
        await this.store.markDeliveryTerminated(currentToken.id);
        throw new RefreshTokenError(
          'REFRESH_DELIVERY_FAILED_REAUTH_REQUIRED',
          401,
          'Refresh delivery failed and replay cache is unavailable. Please re-authenticate.'
        );
      }
    }

    // -----------------------------------------------------------------------
    // TIER 3: deltaMs > 30,000ms (Suspicious Replay Attack)
    // -----------------------------------------------------------------------
    // Mark ALL tokens in the family as revoked immediately
    await this.store.revokeFamily(currentToken.familyId, {
      revokedAt: now,
      reuseDetectedAt: now,
      reason: 'REPLAY_DETECTED'
    });

    // Delete any cached entry
    await this.replayCache.deleteCachedResponse(tokenHash);

    throw new RefreshTokenError(
      'TOKEN_FAMILY_COMPROMISED',
      401,
      'Token reuse detected. Entire session revoked for security.'
    );
  }

  /**
   * Revokes an entire token family (e.g. on logout or administrative action).
   * 
   * @param {string} familyId
   * @param {string} [reason='LOGOUT']
   */
  async revokeFamily(familyId, reason = 'LOGOUT') {
    if (!familyId || typeof familyId !== 'string') return;
    const now = new Date();
    await this.store.revokeFamily(familyId, {
      revokedAt: now,
      reason
    });
  }

  /**
   * Revokes the session associated with a presented raw refresh token (used by logout endpoint).
   * 
   * @param {string} rawToken
   */
  async revokeSessionByToken(rawToken) {
    if (!rawToken || typeof rawToken !== 'string') return;
    try {
      const tokenHash = hashRefreshToken(rawToken);
      const token = await this.store.findByTokenHash(tokenHash);
      if (token) {
        await this.revokeFamily(token.familyId, 'LOGOUT');
        await this.replayCache.deleteCachedResponse(tokenHash);
      }
    } catch {
      // Best-effort logout revocation; does not throw
    }
  }
}

export const defaultRefreshTokenService = new RefreshTokenService();
