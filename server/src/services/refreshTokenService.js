/**
 * Refresh Token Lifecycle & Rotation Service
 * Strictly conforms to SB Manager Rebuild Blueprint v2.1 Section 14 and Phase 4 Architecture Plan Section 4.3.
 * 
 * Cryptographic & Operational Architecture:
 * - Refresh Token Entropy: 32 cryptographically random bytes (256 bits) encoded in base64url.
 * - Storage Security: Only the SHA-256 hex digest (tokenHash) is persisted in the database.
 * - Plaintext refresh tokens are never stored, logged, or returned in response bodies (only in secure cookies).
 * - Transactionally Atomic Rotation: Uses MongoDB transactions (or session-aware persistence adapter)
 *   to ensure that either both R1 is consumed AND R2 is created, or neither occurs.
 * - Replay Cache Integrity: Pre-commit cache write hook guarantees that an active rotation is committed
 *   ONLY IF the encrypted successor package is safely stored in the shared replay cache.
 * - Fail-Closed Configuration: In production, requires explicit JWT_PRIVATE_KEY, JWT_KEY_ID, and shared Redis cache.
 * - Logout Reliability: Server-side revocation failures propagate as errors, clear the browser cookie,
 *   and do not falsely claim 200 OK.
 */

import crypto from 'crypto';
import { RefreshToken } from '../models/target/refreshTokenModel.js';
import { User } from '../models/target/coreModels.js';
import {
  signAccessToken,
  validatePrivateKey,
  generateTestRsaKeyPair,
  JWT_CONFIG
} from './jwtService.js';
import {
  defaultReplayCacheService,
  createReplayCacheService,
  ConfigurationError
} from './replayCacheService.js';

export class RefreshTokenError extends Error {
  constructor(code, statusCode, message, extra = {}) {
    super(message);
    this.name = 'RefreshTokenError';
    this.code = code;
    this.statusCode = statusCode;
    this.status = statusCode;
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
 * Mongoose persistence store adapter supporting MongoDB replica-set transactions.
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

  /**
   * Executes an atomic multi-document token rotation inside a MongoDB session transaction.
   * Enforces that R1 transitions to 'consumed' AND R2 is created, or neither commits.
   * 
   * @param {Object} params
   * @param {string} params.currentTokenId
   * @param {string} params.familyId
   * @param {string} params.oldTokenHash
   * @param {string} params.nextTokenHash
   * @param {Object} params.successorDoc
   * @param {Date} params.now
   * @param {Function} [params.preCommitHook]
   * @returns {Promise<{ success: boolean, concurrentRace?: boolean, consumedDoc?: Object, successorDoc?: Object }>}
   */
  async rotateTokenAtomic({
    currentTokenId,
    familyId,
    oldTokenHash,
    nextTokenHash,
    successorDoc,
    now,
    preCommitHook,
    onRollbackHook
  }) {
    const db = this.model.db;
    const maxTxnRetries = 3;
    const maxCommitRetries = 3;

    for (let txnAttempt = 1; txnAttempt <= maxTxnRetries; txnAttempt++) {
      let session = null;
      let transactionStarted = false;
      let sessionEnded = false;
      let commitOutcomeUnknown = false;

      const cleanupSession = async () => {
        if (session && !sessionEnded) {
          sessionEnded = true;
          try {
            await session.endSession();
          } catch {
            // Guard against masking root cause during cleanup
          }
        }
      };

      try {
        try {
          session = await db.startSession();
        } catch (err) {
          if (err.message?.includes('replica set') || err.code === 20) {
            throw new RefreshTokenError(
              'MONGODB_TOPOLOGY_UNSUPPORTED',
              500,
              'MongoDB transactions require a replica set or sharded cluster topology. Standalone MongoDB deployments cannot guarantee atomic multi-document token rotation.'
            );
          }
          throw err;
        }

        try {
          session.startTransaction({
            readConcern: { level: 'majority' },
            writeConcern: { w: 'majority' }
          });
          transactionStarted = true;
        } catch (txnStartErr) {
          if (txnStartErr.message?.includes('replica set') || txnStartErr.code === 20) {
            throw new RefreshTokenError(
              'MONGODB_TOPOLOGY_UNSUPPORTED',
              500,
              'MongoDB transactions require a replica set or sharded cluster topology. Standalone MongoDB deployments cannot guarantee atomic multi-document token rotation.'
            );
          }
          throw txnStartErr;
        }

        let createdSuccessor = null;
        let consumedDoc = null;

        // 1. Invariant check inside transaction: verify family is not revoked
        const isRevoked = await this.model.findOne({ familyId, status: 'revoked' }).session(session);
        if (isRevoked) {
          await session.abortTransaction().catch(() => {});
          transactionStarted = false;
          throw new RefreshTokenError('TOKEN_FAMILY_ALREADY_REVOKED', 401, 'Token family has been revoked.');
        }

        // 2. Conditionally update current token from 'active' to 'consumed'
        consumedDoc = await this.model.findOneAndUpdate(
          { id: currentTokenId, status: 'active' },
          {
            $set: {
              status: 'consumed',
              consumedAt: now,
              replacedByHash: nextTokenHash,
              replacedByTokenHash: nextTokenHash
            }
          },
          { new: true, session }
        );

        if (!consumedDoc) {
          // Race condition: another concurrent request consumed this active token
          await session.abortTransaction().catch(() => {});
          transactionStarted = false;
          return { concurrentRace: true };
        }

        // 3. Insert successor active token document
        const [inserted] = await this.model.create([successorDoc], { session });
        createdSuccessor = inserted;

        // 4. Pre-commit hook (e.g. authenticated replay-cache persistence)
        if (typeof preCommitHook === 'function') {
          await preCommitHook({ session, successorDoc: createdSuccessor, consumedDoc });
        }

        // 5. Commit transaction atomically with UnknownTransactionCommitResult retry
        let commitAttempt = 0;
        commitOutcomeUnknown = false;

        while (true) {
          try {
            await session.commitTransaction();
            transactionStarted = false; // Confirmed commit
            break;
          } catch (commitErr) {
            commitAttempt++;
            const isUnknownCommitResult = commitErr.hasErrorLabel?.('UnknownTransactionCommitResult') ||
                                         commitErr.errorLabels?.includes('UnknownTransactionCommitResult');
            if (isUnknownCommitResult && commitAttempt < maxCommitRetries) {
              continue; // Retry commit operation
            }
            if (isUnknownCommitResult) {
              commitOutcomeUnknown = true;
            }
            throw commitErr;
          }
        }

        return {
          success: true,
          consumedDoc,
          successorDoc: createdSuccessor
        };
      } catch (err) {
        const isUnknownCommit = commitOutcomeUnknown ||
          err.hasErrorLabel?.('UnknownTransactionCommitResult') ||
          err.errorLabels?.includes('UnknownTransactionCommitResult');

        if (isUnknownCommit) {
          // Exhausted UnknownTransactionCommitResult:
          // Transaction outcome is ambiguous. It may have committed on the primary, but network acknowledgement was lost.
          // Invariants:
          // 1. Do NOT call session.abortTransaction() (it cannot reverse an unknown or committed transaction)
          transactionStarted = false;
          // 2. Do NOT run onRollbackHook() (preserve encrypted successor in replay cache in case commit succeeded)
          // 3. Clean up the MongoDB session safely
          await cleanupSession();
          // 4. Propagate structured MONGODB_COMMIT_OUTCOME_UNKNOWN error with HTTP 503
          throw new RefreshTokenError(
            'MONGODB_COMMIT_OUTCOME_UNKNOWN',
            503,
            'Transaction commit status unknown: UnknownTransactionCommitResult. Replay cache preserved for potential recovery.',
            {
              originalError: err,
              errorLabels: ['UnknownTransactionCommitResult'],
              hasErrorLabel: (label) => label === 'UnknownTransactionCommitResult'
            }
          );
        }

        if (transactionStarted && session) {
          await session.abortTransaction().catch(() => {});
          transactionStarted = false;
        }

        if (typeof onRollbackHook === 'function') {
          try {
            await onRollbackHook();
          } catch {
            // Ignore rollback hook errors
          }
        }

        // Check if TransientTransactionError and retry attempt remains
        const isTransient = err.hasErrorLabel?.('TransientTransactionError') ||
                            err.errorLabels?.includes('TransientTransactionError');

        if (isTransient && txnAttempt < maxTxnRetries) {
          await cleanupSession();
          continue; // Retry whole transaction
        }

        throw err;
      } finally {
        await cleanupSession();
      }
    }
  }
}

/**
 * In-memory persistence store adapter supporting transactional rollback simulation for isolated testing.
 */
export class InMemoryRefreshTokenStore {
  constructor() {
    this.tokens = new Map(); // id -> tokenDoc
    this.users = new Map();  // id -> userDoc
    this.simulateTopologyUnsupported = false;
    this.failAfterR1Update = false;
    this.failOnRevocation = false;
    this.simulateTransientErrorCount = 0;
    this.simulateUnknownCommitResultCount = 0;
    this.unknownCommitOutcome = 'commit_aborted'; // 'commit_succeeded' (Scenario A) or 'commit_aborted' (Scenario B)
    this.unknownCommitActuallyCommitted = null;    // optional boolean override
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
      consumedAt: null,
      replacedByHash: null,
      replacedByTokenHash: null,
      revokedAt: null,
      revocationReason: null,
      reuseDetectedAt: null,
      ...doc,
      createdAt: doc.createdAt || new Date(),
      updatedAt: doc.updatedAt || new Date()
    };
    this.tokens.set(tokenDoc.id, tokenDoc);
    return { ...tokenDoc };
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
    if (this.failOnRevocation) {
      throw new Error('SIMULATED_DATABASE_REVOCATION_FAILURE');
    }

    let modified = 0;
    for (const [id, token] of this.tokens.entries()) {
      if (token.familyId === familyId) {
        token.status = 'revoked';
        token.revokedAt = revokedAt;
        token.reuseDetectedAt = reuseDetectedAt || null;
        token.revocationReason = reason;
        token.updatedAt = new Date();
        this.tokens.set(id, token);
        modified++;
      }
    }
    return { modifiedCount: modified };
  }

  /**
   * Transactional atomic rotation simulation.
   */
  async rotateTokenAtomic({
    currentTokenId,
    familyId,
    oldTokenHash,
    nextTokenHash,
    successorDoc,
    now,
    preCommitHook,
    onRollbackHook
  }) {
    if (this.simulateTopologyUnsupported) {
      throw new RefreshTokenError(
        'MONGODB_TOPOLOGY_UNSUPPORTED',
        500,
        'MongoDB transactions require a replica set or sharded cluster topology. Standalone MongoDB deployments cannot guarantee atomic multi-document token rotation.'
      );
    }

    const maxTxnRetries = 3;
    const maxCommitRetries = 3;

    for (let txnAttempt = 1; txnAttempt <= maxTxnRetries; txnAttempt++) {
      if (await this.isFamilyRevoked(familyId)) {
        throw new RefreshTokenError('TOKEN_FAMILY_ALREADY_REVOKED', 401, 'Token family has been revoked.');
      }

      const current = this.tokens.get(currentTokenId);
      if (!current || current.status !== 'active') {
        return { concurrentRace: true };
      }

      // Check duplicate successor tokenHash conflict
      for (const tok of this.tokens.values()) {
        if (tok.tokenHash === nextTokenHash) {
          const dupErr = new Error(`E11000 duplicate key error: tokenHash_${nextTokenHash}`);
          dupErr.code = 11000;
          throw dupErr;
        }
      }

      // Snapshot state for transaction rollback simulation
      const snapshotCurrent = { ...current };

      // 1. Stage update R1 -> consumed
      current.status = 'consumed';
      current.consumedAt = now;
      current.replacedByHash = nextTokenHash;
      current.replacedByTokenHash = nextTokenHash;
      current.updatedAt = now;
      this.tokens.set(currentTokenId, current);

      // 2. Simulate failure after R1 update but before R2 insertion
      if (this.failAfterR1Update) {
        this.tokens.set(currentTokenId, snapshotCurrent);
        throw new Error('SIMULATED_TRANSACTION_FAILURE_BEFORE_R2');
      }

      // 2b. Simulated TransientTransactionError
      if (this.simulateTransientErrorCount && this.simulateTransientErrorCount > 0) {
        this.simulateTransientErrorCount--;
        this.tokens.set(currentTokenId, snapshotCurrent);
        const transientErr = new Error('WriteConflict: transient transaction conflict.');
        transientErr.errorLabels = ['TransientTransactionError'];
        transientErr.hasErrorLabel = (label) => label === 'TransientTransactionError';

        if (txnAttempt < maxTxnRetries) {
          continue; // Retry transaction
        }
        throw transientErr;
      }

      // 3. Stage insert R2
      const createdSuccessor = {
        ...successorDoc,
        createdAt: now,
        updatedAt: now
      };
      this.tokens.set(createdSuccessor.id, createdSuccessor);

      // 4. Pre-commit hook (e.g. replay cache write)
      if (typeof preCommitHook === 'function') {
        try {
          await preCommitHook({ successorDoc: createdSuccessor, consumedDoc: current });
        } catch (hookErr) {
          // Rollback transaction completely! Confirmed failure before commit.
          this.tokens.set(currentTokenId, snapshotCurrent);
          this.tokens.delete(createdSuccessor.id);
          if (typeof onRollbackHook === 'function') {
            try {
              await onRollbackHook();
            } catch {}
          }
          throw hookErr;
        }
      }

      // 5. Commit phase with UnknownTransactionCommitResult simulation
      if (this.simulateUnknownCommitResultCount && this.simulateUnknownCommitResultCount > 0) {
        let commitConfirmed = false;
        for (let commitAttempt = 1; commitAttempt <= maxCommitRetries; commitAttempt++) {
          if (this.simulateUnknownCommitResultCount > 0) {
            this.simulateUnknownCommitResultCount--;
            if (commitAttempt < maxCommitRetries) {
              continue; // Retry commit!
            } else {
              // Retry limit exceeded! Commit outcome is ambiguous.
              const isScenarioA = (this.unknownCommitActuallyCommitted === true) ||
                                  (this.unknownCommitOutcome === 'commit_succeeded') ||
                                  (this.unknownCommitOutcome === 'scenario_a');

              if (isScenarioA) {
                // Scenario A — Commit actually succeeded, acknowledgement lost
                // - R1 remains consumed (already staged on this.tokens)
                // - R2 exists and is active (already staged on this.tokens)
                // - onRollbackHook is NOT called!
                // - Replay cache entry remains intact
              } else {
                // Scenario B — Commit did not succeed
                // - R1 remains active
                this.tokens.set(currentTokenId, snapshotCurrent);
                // - R2 does not exist
                this.tokens.delete(createdSuccessor.id);
                // - onRollbackHook is NOT called! (Ambiguous commit outcome must never be treated as confirmed rollback)
              }

              const unknownCommitErr = new RefreshTokenError(
                'MONGODB_COMMIT_OUTCOME_UNKNOWN',
                503,
                'Transaction commit status unknown: UnknownTransactionCommitResult. Replay cache preserved for potential recovery.',
                {
                  errorLabels: ['UnknownTransactionCommitResult'],
                  hasErrorLabel: (label) => label === 'UnknownTransactionCommitResult'
                }
              );
              throw unknownCommitErr;
            }
          } else {
            commitConfirmed = true;
            break;
          }
        }
      }

      return {
        success: true,
        consumedDoc: { ...current },
        successorDoc: { ...createdSuccessor }
      };
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
   * @param {boolean} [options.allowTestKeyFallback=false] - Explicit flag for testing
   */
  constructor(options = {}) {
    const isProduction = process.env.NODE_ENV === 'production';

    this.signingKey = options.signingKey || process.env.JWT_PRIVATE_KEY;
    this.kid = options.kid || process.env.JWT_KEY_ID;

    if (isProduction) {
      // Production signing must fail closed: never generate or accept ephemeral fallback keys
      if (!this.signingKey) {
        throw new ConfigurationError(
          'MISSING_JWT_PRIVATE_KEY',
          'Production environment requires an explicitly configured JWT_PRIVATE_KEY.'
        );
      }
      if (!this.kid) {
        throw new ConfigurationError(
          'MISSING_JWT_KEY_ID',
          'Production environment requires an explicitly configured JWT_KEY_ID.'
        );
      }
      validatePrivateKey(this.signingKey, this.kid);
    } else {
      // In non-production, validate key if provided; otherwise only allow test fallback if explicitly permitted
      if (this.signingKey) {
        if (!this.kid) {
          throw new ConfigurationError('MISSING_JWT_KEY_ID', 'JWT signing key requires an explicitly configured key ID.');
        }
        validatePrivateKey(this.signingKey, this.kid);
      } else if (!options.allowTestKeyFallback) {
        throw new ConfigurationError(
          'MISSING_JWT_SIGNING_CONFIG',
          'Signing configuration missing. Provide signingKey & kid or use createTestRefreshTokenService() for testing.'
        );
      } else {
        const ephemeralKey = generateTestRsaKeyPair('test-service-key-1');
        this.signingKey = ephemeralKey.privateKey;
        this.kid = ephemeralKey.kid;
      }
    }

    this.store = options.store || new MongooseRefreshTokenStore();
    this.replayCache = options.replayCache || (
      isProduction ? createReplayCacheService() : defaultReplayCacheService
    );
  }

  /**
   * Creates an initial refresh token session for a verified merchant user.
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
   * Rotates an existing refresh token with transactional atomic replacement,
   * safe pre-commit cache persistence, and two-tier recovery.
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
    // CASE A: Token is ACTIVE — Perform Transactionally Atomic Rotation
    // =========================================================================
    if (currentToken.status === 'active') {
      const lockOwner = crypto.randomUUID();
      let lockAcquired = false;

      // 1. Acquire distributed per-token rotation lock in Redis
      if (this.replayCache && typeof this.replayCache.acquireRotationLock === 'function') {
        try {
          lockAcquired = await this.replayCache.acquireRotationLock(tokenHash, lockOwner, 5000);
        } catch (lockErr) {
          // Outage during lock acquisition: fail safely without consuming R1
          console.error('[AUTH_ROTATION_LOCK_ERROR] Failed to acquire rotation lock:', lockErr.message);
          throw new RefreshTokenError(
            'REPLAY_CACHE_WRITE_FAILURE',
            503,
            'Replay cache lock unavailable. Rotation aborted to prevent race condition.'
          );
        }

        if (!lockAcquired) {
          // Another concurrent request is actively rotating this exact token!
          // Follow approved Tier 1 concurrency response contract: do not revoke family.
          throw new RefreshTokenError(
            'CONCURRENT_REFRESH_IN_PROGRESS',
            409,
            'Concurrent refresh in progress; retry in 1 second.',
            { retryAfter: 1 }
          );
        }
      }

      try {
        const { rawToken: nextRawToken, tokenHash: nextTokenHash } = generateRefreshToken();

        // Resolve user for access token claims before database commit
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
          expiresIn: JWT_CONFIG.MAX_ACCESS_TOKEN_TTL_SECONDS,
          tokenHash: nextTokenHash,
          nextTokenHash
        };

        const successorExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        let cacheWriteSucceeded = false;

        // Execute transactionally atomic rotation with pre-commit cache write hook
        const rotationResult = await this.store.rotateTokenAtomic({
          currentTokenId: currentToken.id,
          familyId: currentToken.familyId,
          oldTokenHash: tokenHash,
          nextTokenHash: nextTokenHash,
          successorDoc: {
            id: crypto.randomUUID(),
            userId: currentToken.userId,
            familyId: currentToken.familyId,
            tokenHash: nextTokenHash,
            status: 'active',
            expiresAt: successorExpiresAt,
            userAgent: options.userAgent || currentToken.userAgent || null,
            ipAddress: options.ipAddress || currentToken.ipAddress || null
          },
          now,
          preCommitHook: async () => {
            // Replay cache persistence hook:
            // Rotation is committed ONLY IF the response package is successfully cached!
            try {
              await this.replayCache.setCachedResponse(tokenHash, responsePayload, 30, currentToken.familyId);
              cacheWriteSucceeded = true;
            } catch (cacheErr) {
              // Log sanitized error: zero tokens, zero keys
              console.error('[AUTH_REPLAY_CACHE_ERROR] Failed to write encrypted response to replay cache:', cacheErr.message);
              throw new RefreshTokenError(
                'REPLAY_CACHE_WRITE_FAILURE',
                503,
                'Replay cache write failed. Rotation aborted to prevent delivery loss vulnerability.'
              );
            }
          },
          onRollbackHook: async () => {
            if (cacheWriteSucceeded && typeof this.replayCache.deleteCachedResponseIfMatches === 'function') {
              await this.replayCache.deleteCachedResponseIfMatches(tokenHash, nextTokenHash);
            }
          }
        });

        if (rotationResult.concurrentRace) {
          if (cacheWriteSucceeded && typeof this.replayCache.deleteCachedResponseIfMatches === 'function') {
            await this.replayCache.deleteCachedResponseIfMatches(tokenHash, nextTokenHash);
          }
          const reRead = await this.store.findByTokenHash(tokenHash);
          if (reRead && reRead.status === 'consumed') {
            return this._handleConsumedToken(reRead, tokenHash, now, options);
          }
          throw new RefreshTokenError('CONCURRENT_ROTATION_RACE', 409, 'Concurrent rotation detected.');
        }

        return responsePayload;
      } finally {
        if (lockAcquired && typeof this.replayCache.releaseRotationLock === 'function') {
          await this.replayCache.releaseRotationLock(tokenHash, lockOwner).catch(() => {});
        }
      }
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
      let cachedResponse = null;
      try {
        cachedResponse = await this.replayCache.getCachedResponse(tokenHash, currentToken.familyId);
      } catch (cacheErr) {
        // Cache read error fails safely without false family revocation
        console.error('[AUTH_REPLAY_CACHE_READ_ERROR] Error reading replay cache:', cacheErr.message);
        cachedResponse = null;
      }

      if (cachedResponse) {
        // Idempotently return the exact successor payload
        return {
          ...cachedResponse,
          isReplay: true
        };
      }

      // Cache Miss or Cache Outage
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
   * Does NOT swallow database errors. Propagates failures so caller can return 500 error.
   * 
   * @param {string} rawToken
   * @returns {Promise<{ revoked: boolean, alreadyRevoked?: boolean, reason?: string, familyId?: string }>}
   */
  async revokeSessionByToken(rawToken) {
    if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
      return { revoked: false, reason: 'NO_TOKEN' };
    }

    const tokenHash = hashRefreshToken(rawToken);
    const token = await this.store.findByTokenHash(tokenHash);
    if (!token) {
      // Idempotent: token doesn't exist, session already terminated or never existed
      return { revoked: false, reason: 'TOKEN_NOT_FOUND' };
    }

    if (token.status === 'revoked' || (await this.store.isFamilyRevoked(token.familyId))) {
      // Idempotent: already revoked
      return { revoked: true, alreadyRevoked: true, familyId: token.familyId };
    }

    // Revoke family in persistence store — errors are NOT caught here, they propagate
    await this.store.revokeFamily(token.familyId, {
      revokedAt: new Date(),
      reason: 'LOGOUT'
    });

    try {
      await this.replayCache.deleteCachedResponse(tokenHash);
    } catch {
      // Cache cleanup failure does not prevent successful logout
    }

    return { revoked: true, familyId: token.familyId };
  }
}

/**
 * Creates an explicitly configured test instance of RefreshTokenService.
 * Strictly forbidden in production.
 * 
 * @param {Object} [options]
 * @returns {RefreshTokenService}
 */
export function createTestRefreshTokenService(options = {}) {
  if (process.env.NODE_ENV === 'production') {
    throw new ConfigurationError('TEST_FACTORY_PROHIBITED_IN_PROD', 'createTestRefreshTokenService is forbidden in production.');
  }
  const ephemeralKey = generateTestRsaKeyPair(options.kid || 'test-service-kid');
  return new RefreshTokenService({
    signingKey: ephemeralKey.privateKey,
    kid: ephemeralKey.kid,
    allowTestKeyFallback: true,
    ...options
  });
}

// In non-production, create default test-permitted service for backward compatibility
export const defaultRefreshTokenService = process.env.NODE_ENV === 'production'
  ? null
  : createTestRefreshTokenService();
