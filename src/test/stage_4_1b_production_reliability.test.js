/**
 * Stage 4.1B — Production Configuration, Secret Redaction, Session Cleanup & Cache Invariant Test Suite
 * Strictly conforms to Stage 4.1B Audit Corrections:
 * 1. Production dependency-injection bypass prevention (Redis adapter & MongooseRefreshTokenStore enforcement).
 * 2. Redaction of Redis/MongoDB credentials from error messages and logs.
 * 3. Explicit production MONGO_URI configuration requirement.
 * 4. Guaranteed MongoDB session cleanup across all lifecycle failure modes.
 * 5. Replay-cache abort isolation and concurrent rotation invariant verification.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import {
  initializeProductionServices,
  startServer,
  createApp
} from '../../server/src/server.js';
import {
  RedisReplayCacheService,
  InMemoryReplayCacheService,
  ConfigurationError,
  sanitizeErrorMessage,
  redactSensitiveUrl
} from '../../server/src/services/replayCacheService.js';
import {
  RefreshTokenService,
  MongooseRefreshTokenStore,
  InMemoryRefreshTokenStore,
  RefreshTokenError
} from '../../server/src/services/refreshTokenService.js';
import {
  generateTestRsaKeyPair
} from '../../server/src/services/jwtService.js';

/**
 * Mock Redis client supporting ping and simulated failures.
 */
class MockRedisClient {
  constructor(options = {}) {
    this.store = new Map();
    this.connected = options.connected !== false;
    this.pingThrows = Boolean(options.pingThrows);
    this.pingErrorMessage = options.pingErrorMessage || 'ECONNREFUSED 127.0.0.1:6379';
  }

  async ping() {
    if (!this.connected || this.pingThrows) {
      throw new Error(this.pingErrorMessage);
    }
    return 'PONG';
  }

  async set(key, val, ex, ttl) {
    if (!this.connected) throw new Error('ECONNREFUSED');
    this.store.set(key, { val: String(val), expiresAt: Date.now() + ttl * 1000 });
    return 'OK';
  }

  async get(key) {
    if (!this.connected) throw new Error('ECONNREFUSED');
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return item.val;
  }

  async del(key) {
    this.store.delete(key);
    return 1;
  }

  async quit() {
    this.connected = false;
    return 'OK';
  }

  disconnect() {
    this.connected = false;
  }
}

describe('Stage 4.1B Production Configuration and Reliability Corrections', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SECTION 1: Close Production Dependency-Injection Bypasses
  // =========================================================================
  describe('1. Production Dependency-Injection Bypass Prevention', () => {
    it('production startup rejects an InMemoryReplayCacheService instance', async () => {
      // Instantiate before switching environment to test DI rejection in initializeProductionServices
      const inMemoryCache = new InMemoryReplayCacheService({ secret: 'a'.repeat(32) });

      process.env.NODE_ENV = 'production';
      const { privateKey, kid } = generateTestRsaKeyPair('kid');
      process.env.JWT_PRIVATE_KEY = privateKey;
      process.env.JWT_KEY_ID = kid;

      await expect(
        initializeProductionServices({ replayCache: inMemoryCache })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'INVALID_PRODUCTION_REPLAY_CACHE',
          message: expect.stringContaining('An approved RedisReplayCacheService is required in production')
        })
      );
    });

    it('production startup rejects an arbitrary fake/duck-typed replay cache', async () => {
      process.env.NODE_ENV = 'production';
      const { privateKey, kid } = generateTestRsaKeyPair('kid');
      process.env.JWT_PRIVATE_KEY = privateKey;
      process.env.JWT_KEY_ID = kid;

      const fakeCache = {
        ping: async () => true,
        getCachedResponse: async () => null,
        setCachedResponse: async () => {},
        deleteCachedResponse: async () => {}
      };

      await expect(
        initializeProductionServices({ replayCache: fakeCache })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'INVALID_PRODUCTION_REPLAY_CACHE'
        })
      );
    });

    it('production startup still executes live ping() on an injected RedisReplayCacheService', async () => {
      process.env.NODE_ENV = 'production';
      const { privateKey, kid } = generateTestRsaKeyPair('kid');
      process.env.JWT_PRIVATE_KEY = privateKey;
      process.env.JWT_KEY_ID = kid;

      const failingClient = new MockRedisClient({ pingThrows: true });
      const failingRedisCache = new RedisReplayCacheService({
        secret: 'a'.repeat(32),
        redisClient: failingClient
      });

      await expect(
        initializeProductionServices({ replayCache: failingRedisCache })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'REDIS_READINESS_FAILED'
        })
      );
    });

    it('production startup rejects an InMemoryRefreshTokenStore', async () => {
      process.env.NODE_ENV = 'production';
      const { privateKey, kid } = generateTestRsaKeyPair('kid');
      process.env.JWT_PRIVATE_KEY = privateKey;
      process.env.JWT_KEY_ID = kid;
      process.env.REDIS_URL = 'redis://127.0.0.1:6379';
      process.env.REPLAY_CACHE_SECRET = 'a'.repeat(32);

      const healthyClient = new MockRedisClient({ connected: true });
      const validRedisCache = new RedisReplayCacheService({
        secret: 'a'.repeat(32),
        redisClient: healthyClient
      });

      const inMemoryStore = new InMemoryRefreshTokenStore();

      await expect(
        initializeProductionServices({
          replayCache: validRedisCache,
          store: inMemoryStore
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'INVALID_PRODUCTION_TOKEN_STORE',
          message: expect.stringContaining('An approved persistent MongooseRefreshTokenStore is required in production')
        })
      );
    });

    it('production startup rejects an arbitrary non-persistent token store', async () => {
      process.env.NODE_ENV = 'production';
      const { privateKey, kid } = generateTestRsaKeyPair('kid');
      process.env.JWT_PRIVATE_KEY = privateKey;
      process.env.JWT_KEY_ID = kid;

      const healthyClient = new MockRedisClient({ connected: true });
      const validRedisCache = new RedisReplayCacheService({
        secret: 'a'.repeat(32),
        redisClient: healthyClient
      });

      const fakeStore = {
        findByTokenHash: async () => null,
        rotateTokenAtomic: async () => ({ success: true })
      };

      await expect(
        initializeProductionServices({
          replayCache: validRedisCache,
          store: fakeStore
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'INVALID_PRODUCTION_TOKEN_STORE'
        })
      );
    });

    it('production startup accepts valid RedisReplayCacheService and MongooseRefreshTokenStore', async () => {
      process.env.NODE_ENV = 'production';
      const { privateKey, kid } = generateTestRsaKeyPair('kid');
      process.env.JWT_PRIVATE_KEY = privateKey;
      process.env.JWT_KEY_ID = kid;

      const healthyClient = new MockRedisClient({ connected: true });
      const validRedisCache = new RedisReplayCacheService({
        secret: 'a'.repeat(32),
        redisClient: healthyClient
      });
      const validStore = new MongooseRefreshTokenStore();

      const services = await initializeProductionServices({
        replayCache: validRedisCache,
        store: validStore
      });

      expect(services.tokenService).toBeInstanceOf(RefreshTokenService);
      expect(services.replayCache).toBe(validRedisCache);
    });

    it('non-production environment permits in-memory dependency injection for test isolation', async () => {
      process.env.NODE_ENV = 'test';
      const inMemoryCache = new InMemoryReplayCacheService({ secret: 'a'.repeat(32) });
      const inMemoryStore = new InMemoryRefreshTokenStore();

      const services = await initializeProductionServices({
        replayCache: inMemoryCache,
        store: inMemoryStore,
        allowTestKeyFallback: true
      });

      expect(services.tokenService).toBeInstanceOf(RefreshTokenService);
      expect(services.replayCache).toBe(inMemoryCache);
    });
  });

  // =========================================================================
  // SECTION 2: Prevent Redis & Database Credentials from Entering Logs
  // =========================================================================
  describe('2. Secret & Credential Redaction in Errors and Logs', () => {
    it('redactSensitiveUrl replaces username and password with ***:***', () => {
      const urlWithCreds = 'redis://my_user:SuperSecretPassword123@cluster.redis.cache:6379/0';
      const redacted = redactSensitiveUrl(urlWithCreds);

      expect(redacted).toBe('redis://***:***@cluster.redis.cache:6379/0');
      expect(redacted).not.toContain('my_user');
      expect(redacted).not.toContain('SuperSecretPassword123');
    });

    it('sanitizeErrorMessage redacts URLs containing credentials and sensitive query params', () => {
      const rawMessage = 'Failed to connect to redis://admin:topSecretPassword@10.0.0.5:6379 with secret=xyz123 and token=abc';
      const sanitized = sanitizeErrorMessage(rawMessage);

      expect(sanitized).not.toContain('admin');
      expect(sanitized).not.toContain('topSecretPassword');
      expect(sanitized).not.toContain('xyz123');
      expect(sanitized).not.toContain('abc');
      expect(sanitized).toContain('redis://***:***@10.0.0.5:6379');
      expect(sanitized).toContain('secret=***');
      expect(sanitized).toContain('token=***');
    });

    it('production Redis readiness failure does not disclose URL credentials in thrown error', async () => {
      process.env.NODE_ENV = 'production';
      const { privateKey, kid } = generateTestRsaKeyPair('kid');
      process.env.JWT_PRIVATE_KEY = privateKey;
      process.env.JWT_KEY_ID = kid;
      process.env.REPLAY_CACHE_SECRET = 'a'.repeat(32);

      const sensitiveUser = 'sensitive_admin_user';
      const sensitivePassword = 'VeryHighEntropySecretPassword_987!';
      const sensitiveUrl = `redis://${sensitiveUser}:${sensitivePassword}@redis-prod.internal:6379/0`;
      process.env.REDIS_URL = sensitiveUrl;

      const failingClient = new MockRedisClient({
        pingThrows: true,
        pingErrorMessage: `Connection attempt to ${sensitiveUrl} failed: ECONNREFUSED`
      });

      try {
        await initializeProductionServices({ redisClient: failingClient });
        expect.unreachable('Should have thrown ConfigurationError');
      } catch (err) {
        expect(err.code).toBe('REDIS_READINESS_FAILED');
        expect(err.message).not.toContain(sensitiveUser);
        expect(err.message).not.toContain(sensitivePassword);
        expect(err.message).toContain('redis://***:***@redis-prod.internal:6379/0');
      }
    });
  });

  // =========================================================================
  // SECTION 3: Explicit Production MongoDB Configuration
  // =========================================================================
  describe('3. Explicit Production MongoDB Configuration', () => {
    it('startServer in production rejects missing MONGO_URI before accepting traffic', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.MONGO_URI;

      const { privateKey, kid } = generateTestRsaKeyPair('kid');
      process.env.JWT_PRIVATE_KEY = privateKey;
      process.env.JWT_KEY_ID = kid;
      process.env.REDIS_URL = 'redis://127.0.0.1:6379';
      process.env.REPLAY_CACHE_SECRET = 'a'.repeat(32);

      const healthyClient = new MockRedisClient({ connected: true });
      const validRedisCache = new RedisReplayCacheService({
        secret: 'a'.repeat(32),
        redisClient: healthyClient
      });

      await expect(
        startServer({
          replayCache: validRedisCache,
          mongoUri: ''
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'MISSING_MONGO_URI',
          message: expect.stringContaining('MONGO_URI must be explicitly configured')
        })
      );
    });

    it('startServer in production rejects empty or whitespace-only MONGO_URI', async () => {
      process.env.NODE_ENV = 'production';
      process.env.MONGO_URI = '   ';

      const { privateKey, kid } = generateTestRsaKeyPair('kid');
      process.env.JWT_PRIVATE_KEY = privateKey;
      process.env.JWT_KEY_ID = kid;

      const healthyClient = new MockRedisClient({ connected: true });
      const validRedisCache = new RedisReplayCacheService({
        secret: 'a'.repeat(32),
        redisClient: healthyClient
      });

      await expect(
        startServer({ replayCache: validRedisCache })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'MISSING_MONGO_URI'
        })
      );
    });

    it('startServer in production sanitizes credentials when connection fails', async () => {
      process.env.NODE_ENV = 'production';
      const { privateKey, kid } = generateTestRsaKeyPair('kid');
      process.env.JWT_PRIVATE_KEY = privateKey;
      process.env.JWT_KEY_ID = kid;

      const healthyClient = new MockRedisClient({ connected: true });
      const validRedisCache = new RedisReplayCacheService({
        secret: 'a'.repeat(32),
        redisClient: healthyClient
      });

      const mongoUser = 'mongo_admin';
      const mongoPass = 'UltraSecureDatabasePassword!';
      const sensitiveMongoUri = `mongodb://${mongoUser}:${mongoPass}@mongo.internal:27017/sb_prod?replicaSet=rs0`;

      vi.spyOn(mongoose, 'connect').mockRejectedValueOnce(
        new Error(`Failed to connect to ${sensitiveMongoUri}: queryTxt ETIMEOUT`)
      );

      try {
        await startServer({
          replayCache: validRedisCache,
          mongoUri: sensitiveMongoUri
        });
        expect.unreachable('Should have failed connect');
      } catch (err) {
        expect(err.code).toBe('MONGO_CONNECTION_FAILED');
        expect(err.message).not.toContain(mongoUser);
        expect(err.message).not.toContain(mongoPass);
        expect(err.message).toContain('mongodb://***:***@mongo.internal:27017/sb_prod');
      }
    });

    it('startServer in development preserves localhost fallback without error', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.MONGO_URI;

      const connectSpy = vi.spyOn(mongoose, 'connect').mockResolvedValueOnce(mongoose);

      const fakeServer = {
        close: (cb) => cb(),
        on: () => {}
      };
      const inMemoryCache = new InMemoryReplayCacheService({ secret: 'a'.repeat(32) });
      const inMemoryStore = new InMemoryRefreshTokenStore();

      const result = await startServer({
        replayCache: inMemoryCache,
        store: inMemoryStore,
        allowTestKeyFallback: true,
        port: 0
      });

      expect(connectSpy).toHaveBeenCalledWith('mongodb://127.0.0.1:27017/msme_ledger');
      await result.shutdown();
    });
  });

  // =========================================================================
  // SECTION 4: Ensure MongoDB Sessions Are Always Released
  // =========================================================================
  describe('4. MongoDB Session Lifecycle & Guaranteed Cleanup', () => {
    class MockSession {
      constructor(options = {}) {
        this.transactionStarted = false;
        this.startTransactionThrows = Boolean(options.startTransactionThrows);
        this.commitThrows = Boolean(options.commitThrows);
        this.commitErrorLabels = options.commitErrorLabels || [];
        this.aborted = false;
        this.ended = false;
        this.endSessionCallCount = 0;
        this.abortTransactionCallCount = 0;
        this.commitTransactionCallCount = 0;
      }

      startTransaction() {
        if (this.startTransactionThrows) {
          throw new Error('START_TRANSACTION_FAILED');
        }
        this.transactionStarted = true;
      }

      async commitTransaction() {
        this.commitTransactionCallCount++;
        if (this.commitThrows) {
          const err = new Error('COMMIT_NETWORK_DROPPED');
          err.errorLabels = this.commitErrorLabels;
          err.hasErrorLabel = (l) => this.commitErrorLabels.includes(l);
          throw err;
        }
      }

      async abortTransaction() {
        this.abortTransactionCallCount++;
        this.aborted = true;
      }

      async endSession() {
        this.endSessionCallCount++;
        this.ended = true;
      }
    }

    class MockMongooseModel {
      constructor(sessionFactory) {
        this.sessionFactory = sessionFactory;
        this.db = {
          startSession: async () => this.sessionFactory()
        };
      }

      findOne() {
        return {
          session: () => Promise.resolve(null)
        };
      }

      async findOneAndUpdate() {
        return { id: 'tok-1', status: 'consumed' };
      }

      async create([doc]) {
        return [{ ...doc }];
      }
    }

    it('startSession failure propagates error without session leak', async () => {
      const store = new MongooseRefreshTokenStore();
      store.model = {
        db: {
          startSession: async () => {
            throw new Error('CONNECTION_POOL_EXHAUSTED');
          }
        }
      };

      await expect(
        store.rotateTokenAtomic({
          currentTokenId: 'c1',
          familyId: 'f1',
          oldTokenHash: 'h1',
          nextTokenHash: 'h2',
          successorDoc: { id: 's1' },
          now: new Date()
        })
      ).rejects.toThrow('CONNECTION_POOL_EXHAUSTED');
    });

    it('startTransaction failure cleans up session without calling abortTransaction', async () => {
      let createdSession = null;
      const store = new MongooseRefreshTokenStore();
      store.model = new MockMongooseModel(() => {
        createdSession = new MockSession({ startTransactionThrows: true });
        return createdSession;
      });

      await expect(
        store.rotateTokenAtomic({
          currentTokenId: 'c1',
          familyId: 'f1',
          oldTokenHash: 'h1',
          nextTokenHash: 'h2',
          successorDoc: { id: 's1' },
          now: new Date()
        })
      ).rejects.toThrow('START_TRANSACTION_FAILED');

      expect(createdSession).not.toBeNull();
      expect(createdSession.endSessionCallCount).toBe(1);
      expect(createdSession.abortTransactionCallCount).toBe(0);
    });

    it('transaction body failure aborts transaction and ends session exactly once', async () => {
      let createdSession = null;
      const store = new MongooseRefreshTokenStore();
      store.model = new MockMongooseModel(() => {
        createdSession = new MockSession();
        return createdSession;
      });

      // Inject a preCommitHook that throws
      await expect(
        store.rotateTokenAtomic({
          currentTokenId: 'c1',
          familyId: 'f1',
          oldTokenHash: 'h1',
          nextTokenHash: 'h2',
          successorDoc: { id: 's1' },
          now: new Date(),
          preCommitHook: async () => {
            throw new Error('PRE_COMMIT_HOOK_FAILED');
          }
        })
      ).rejects.toThrow('PRE_COMMIT_HOOK_FAILED');

      expect(createdSession.abortTransactionCallCount).toBe(1);
      expect(createdSession.endSessionCallCount).toBe(1);
    });

    it('successful rotation commits transaction and ends session exactly once', async () => {
      let createdSession = null;
      const store = new MongooseRefreshTokenStore();
      store.model = new MockMongooseModel(() => {
        createdSession = new MockSession();
        return createdSession;
      });

      const res = await store.rotateTokenAtomic({
        currentTokenId: 'c1',
        familyId: 'f1',
        oldTokenHash: 'h1',
        nextTokenHash: 'h2',
        successorDoc: { id: 's1' },
        now: new Date()
      });

      expect(res.success).toBe(true);
      expect(createdSession.commitTransactionCallCount).toBe(1);
      expect(createdSession.abortTransactionCallCount).toBe(0);
      expect(createdSession.endSessionCallCount).toBe(1);
    });

    it('transient transaction error cleans up session per attempt across retries', async () => {
      const createdSessions = [];
      const store = new MongooseRefreshTokenStore();
      store.model = new MockMongooseModel(() => {
        const s = new MockSession();
        createdSessions.push(s);
        return s;
      });

      let attempts = 0;
      await expect(
        store.rotateTokenAtomic({
          currentTokenId: 'c1',
          familyId: 'f1',
          oldTokenHash: 'h1',
          nextTokenHash: 'h2',
          successorDoc: { id: 's1' },
          now: new Date(),
          preCommitHook: async () => {
            attempts++;
            const transientErr = new Error('WriteConflict');
            transientErr.errorLabels = ['TransientTransactionError'];
            transientErr.hasErrorLabel = (l) => l === 'TransientTransactionError';
            throw transientErr;
          }
        })
      ).rejects.toThrow('WriteConflict');

      expect(attempts).toBe(3); // 3 bounded retries
      expect(createdSessions.length).toBe(3);
      for (const s of createdSessions) {
        expect(s.endSessionCallCount).toBe(1);
        expect(s.abortTransactionCallCount).toBe(1);
      }
    });
  });

  // =========================================================================
  // SECTION 5: Replay Cache Abort Isolation & Concurrency Invariant Proof
  // =========================================================================
  describe('5. Replay Cache Abort Isolation & Concurrency Invariant Proof', () => {
    it('transaction abort leaves R1 active; subsequent rotation request succeeds and delivers successor', async () => {
      const store = new InMemoryRefreshTokenStore();
      const replayCache = new InMemoryReplayCacheService({ secret: 'a'.repeat(32) });
      const { privateKey, kid } = generateTestRsaKeyPair('kid');

      const tokenService = new RefreshTokenService({
        store,
        replayCache,
        signingKey: privateKey,
        kid,
        allowTestKeyFallback: true
      });

      // 1. Create initial active session
      store.addUser({ id: 'user-invariant-1', email: 'merchant@store.com' });
      const initial = await tokenService.createInitialSession({
        userId: 'user-invariant-1',
        email: 'merchant@store.com'
      });
      const r1 = initial.refreshToken;

      // 2. Simulate transaction commit failure during rotation of R1
      store.simulateUnknownCommitResultCount = 5; // exceeds max 3 retries -> transaction fails!

      await expect(
        tokenService.rotateRefreshToken(r1)
      ).rejects.toThrow('UnknownTransactionCommitResult');

      // 3. Verify database state: R1 MUST remain active!
      const r1Doc = await store.findByTokenHash(initial.tokenHash || store.tokens.values().next().value.tokenHash);
      expect(r1Doc.status).toBe('active');

      // 4. Client retries with R1: rotation succeeds because R1 is active!
      store.simulateUnknownCommitResultCount = 0; // cleared
      const secondRotation = await tokenService.rotateRefreshToken(r1);

      expect(secondRotation).toBeDefined();
      expect(secondRotation.accessToken).toBeDefined();
      expect(secondRotation.refreshToken).toBeDefined();
      expect(secondRotation.isReplay).toBeFalsy();

      // 5. Subsequent presentation of R1 returns the committed successor from cache idempotently
      const replayResult = await tokenService.rotateRefreshToken(r1);
      expect(replayResult.isReplay).toBe(true);
      expect(replayResult.refreshToken).toBe(secondRotation.refreshToken);
    });

    it('failed concurrent request does not delete a successful concurrent request cached entry', async () => {
      const replayCache = new InMemoryReplayCacheService({ secret: 'a'.repeat(32) });
      const oldTokenHash = 'hash-old-r1';
      const validSuccessorHash = 'hash-committed-r2';
      const failedSuccessorHash = 'hash-aborted-r3';

      // 1. Request A committed successor R2 to replay cache
      await replayCache.setCachedResponse(oldTokenHash, {
        accessToken: 'valid-jwt',
        refreshToken: 'raw-r2',
        tokenHash: validSuccessorHash,
        nextTokenHash: validSuccessorHash
      }, 30, 'family-1');

      // 2. Request B aborts and attempts safe rollback cleanup for its uncommitted successor R3
      const deleted = await replayCache.deleteCachedResponseIfMatches(oldTokenHash, failedSuccessorHash);

      expect(deleted).toBe(false);

      // 3. Request A's valid cached response remains completely intact!
      const cached = await replayCache.getCachedResponse(oldTokenHash);
      expect(cached).not.toBeNull();
      expect(cached.tokenHash).toBe(validSuccessorHash);
    });
  });
});
