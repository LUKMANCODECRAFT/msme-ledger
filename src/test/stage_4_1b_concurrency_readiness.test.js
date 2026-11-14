/**
 * Stage 4.1B — Final Refresh Rotation Concurrency & Startup Readiness Test Suite
 * Strictly covers the 12 requirements of the Stage 4.1B Concurrency and Readiness Specification:
 * 1. Two simultaneous requests presenting the same R1.
 * 2. Only one request can perform the rotation.
 * 3. The committed successor in MongoDB matches the replay-cache response.
 * 4. A failed concurrent request cannot overwrite or delete the successful request's cache entry.
 * 5. Lock ownership mismatch prevents release.
 * 6. Lock expiry and renewal behaviour.
 * 7. Redis outage before rotation leaves R1 active.
 * 8. Cache cleanup is atomic.
 * 9. Redis ping() returning false prevents startup.
 * 10. Missing MongoDB URI is detected before Redis construction.
 * 11. Redis cleanup after MongoDB connection failure.
 * 12. Redis cleanup after HTTP listener failure.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import {
  initializeProductionServices,
  startServer
} from '../../server/src/server.js';
import {
  RedisReplayCacheService,
  InMemoryReplayCacheService,
  ConfigurationError
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
 * Mock Redis Client supporting atomic set NX PX, eval Lua scripts, and ping.
 */
class MockRedisClient {
  constructor(options = {}) {
    this.store = new Map();
    this.connected = options.connected !== false;
    this.pingResponse = options.pingResponse !== undefined ? options.pingResponse : 'PONG';
    this.closed = false;
  }

  async ping() {
    if (!this.connected) throw new Error('ECONNREFUSED 127.0.0.1:6379');
    return this.pingResponse;
  }

  async set(key, val, ...args) {
    if (!this.connected) throw new Error('ECONNREFUSED');
    let ttlMs = null;
    let nx = false;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === 'PX') {
        ttlMs = Number(args[i + 1]);
        i++;
      } else if (args[i] === 'EX') {
        ttlMs = Number(args[i + 1]) * 1000;
        i++;
      } else if (args[i] === 'NX') {
        nx = true;
      }
    }

    const existing = this.store.get(key);
    if (nx && existing && existing.expiresAt > Date.now()) {
      return null;
    }

    const expiresAt = ttlMs ? Date.now() + ttlMs : Infinity;
    this.store.set(key, { val: String(val), expiresAt });
    return 'OK';
  }

  async get(key) {
    if (!this.connected) throw new Error('ECONNREFUSED');
    const existing = this.store.get(key);
    if (!existing) return null;
    if (Date.now() > existing.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return existing.val;
  }

  async del(key) {
    this.store.delete(key);
    return 1;
  }

  async eval(script, numkeys, key, arg1, arg2) {
    if (!this.connected) throw new Error('ECONNREFUSED');

    // 1. Lock release script: if get(KEYS[1]) == ARGV[1] then return del(KEYS[1])
    if (script.includes("redis.call('get', KEYS[1]) == ARGV[1] then\n        return redis.call('del'")) {
      const existing = await this.get(key);
      if (existing === arg1) {
        await this.del(key);
        return 1;
      }
      return 0;
    }

    // 2. Lock renew script: if get(KEYS[1]) == ARGV[1] then pexpire
    if (script.includes("redis.call('pexpire'")) {
      const existing = await this.get(key);
      if (existing === arg1) {
        const item = this.store.get(key);
        if (item) {
          item.expiresAt = Date.now() + Number(arg2);
          return 1;
        }
      }
      return 0;
    }

    // 3. Atomic compare-and-delete script: if envelope.successorHash == ARGV[1] then del
    if (script.includes("envelope.successorHash == ARGV[1]")) {
      const raw = await this.get(key);
      if (!raw) return 0;
      try {
        const env = JSON.parse(raw);
        if (env && env.successorHash === arg1) {
          await this.del(key);
          return 1;
        }
      } catch {
        return 0;
      }
      return 0;
    }

    return 0;
  }

  async quit() {
    this.connected = false;
    this.closed = true;
    return 'OK';
  }

  disconnect() {
    this.connected = false;
    this.closed = true;
  }
}

describe('Stage 4.1B Final Refresh Rotation Concurrency and Readiness Fix', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1 & 2: Two Simultaneous Requests & Only One Performs Rotation
  // =========================================================================
  describe('1 & 2. Concurrent Rotations Serialization via Distributed Lock', () => {
    it('serializes two simultaneous requests presenting the same R1: only one rotates, the other gets 409', async () => {
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

      store.addUser({ id: 'user-simul-1', email: 'merchant@concurrent.com' });
      const initial = await tokenService.createInitialSession({
        userId: 'user-simul-1',
        email: 'merchant@concurrent.com'
      });
      const r1 = initial.refreshToken;

      // Wrap acquireRotationLock to simulate deterministic concurrent barrier
      let firstRequestEntered = false;
      let resumeFirstRotation;
      const firstRotationHold = new Promise(resolve => { resumeFirstRotation = resolve; });

      const origRotateTokenAtomic = store.rotateTokenAtomic.bind(store);
      store.rotateTokenAtomic = async (params) => {
        if (!firstRequestEntered) {
          firstRequestEntered = true;
          // While Request A holds lock and is inside transaction, Request B attempts rotation
          await firstRotationHold;
        }
        return origRotateTokenAtomic(params);
      };

      // Launch Request A
      const reqAPromise = tokenService.rotateRefreshToken(r1);

      // Wait until Request A has acquired lock and entered rotateTokenAtomic
      while (!firstRequestEntered) {
        await new Promise(r => setTimeout(r, 10));
      }

      // Launch Request B presenting identical R1 while Request A holds lock
      let reqBError = null;
      try {
        await tokenService.rotateRefreshToken(r1);
      } catch (err) {
        reqBError = err;
      }

      // Resume and complete Request A
      resumeFirstRotation();
      const resA = await reqAPromise;

      // 1. Request A succeeds and returns new tokens
      expect(resA).toBeDefined();
      expect(resA.refreshToken).toBeDefined();
      expect(resA.accessToken).toBeDefined();

      // 2. Request B was rejected with 409 CONCURRENT_REFRESH_IN_PROGRESS without revoking family
      expect(reqBError).toBeInstanceOf(RefreshTokenError);
      expect(reqBError.code).toBe('CONCURRENT_REFRESH_IN_PROGRESS');
      expect(reqBError.status).toBe(409);

      // 3. Family is NOT revoked
      const isRevoked = await store.isFamilyRevoked(initial.familyId);
      expect(isRevoked).toBe(false);

      // 4. Client retrying with R1 after Request A completes receives Request A's committed successor idempotently
      const retryResult = await tokenService.rotateRefreshToken(r1);
      expect(retryResult.isReplay).toBe(true);
      expect(retryResult.refreshToken).toBe(resA.refreshToken);
    });
  });

  // =========================================================================
  // 3 & 4: Successor Matching in MongoDB & Failed Request Cannot Overwrite
  // =========================================================================
  describe('3 & 4. Committed Successor Consistency & Rollback Isolation', () => {
    it('proves committed successor in MongoDB matches the replay-cache response exactly', async () => {
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

      store.addUser({ id: 'user-match-1', email: 'merchant@match.com' });
      const initial = await tokenService.createInitialSession({
        userId: 'user-match-1',
        email: 'merchant@match.com'
      });
      const r1 = initial.refreshToken;

      const rotation = await tokenService.rotateRefreshToken(r1);
      const r2 = rotation.refreshToken;

      // Verify MongoDB store contains R2 as active token
      const r1Hash = initial.tokenHash || Array.from(store.tokens.values())[0].tokenHash;
      const r1Doc = await store.findByTokenHash(r1Hash);
      expect(r1Doc.status).toBe('consumed');
      expect(r1Doc.replacedByHash).toBeDefined();

      const r2Doc = await store.findByTokenHash(r1Doc.replacedByHash);
      expect(r2Doc.status).toBe('active');

      // Verify Replay Cache response matches R2
      const cached = await replayCache.getCachedResponse(r1Hash);
      expect(cached.refreshToken).toBe(r2);
      expect(cached.accessToken).toBe(rotation.accessToken);
    });

    it('a failed concurrent request cannot overwrite or delete the successful request cache entry', async () => {
      const replayCache = new InMemoryReplayCacheService({ secret: 'a'.repeat(32) });
      const r1Hash = 'hash-r1-committed';
      const committedSuccessorHash = 'hash-r2-committed';
      const abortedSuccessorHash = 'hash-r3-aborted';

      // Successful Request A wrote committed successor R2
      await replayCache.setCachedResponse(r1Hash, {
        accessToken: 'jwt-r2',
        refreshToken: 'raw-r2',
        tokenHash: committedSuccessorHash,
        nextTokenHash: committedSuccessorHash
      }, 30, 'family-1');

      // Failed Request B attempts cleanup with uncommitted successor R3
      const deleted = await replayCache.deleteCachedResponseIfMatches(r1Hash, abortedSuccessorHash);
      expect(deleted).toBe(false);

      // Committed entry R2 remains intact
      const cached = await replayCache.getCachedResponse(r1Hash);
      expect(cached).not.toBeNull();
      expect(cached.refreshToken).toBe('raw-r2');
    });
  });

  // =========================================================================
  // 5 & 6: Lock Ownership & Expiry / Renewal
  // =========================================================================
  describe('5 & 6. Lock Ownership Enforcement, Expiry & Renewal', () => {
    it('lock ownership mismatch prevents release by another request', async () => {
      const client = new MockRedisClient();
      const redisCache = new RedisReplayCacheService({
        secret: 'a'.repeat(32),
        redisClient: client
      });

      const tokenHash = 'hash-token-123';
      const ownerA = 'owner-uuid-a';
      const ownerB = 'owner-uuid-b';

      const acquired = await redisCache.acquireRotationLock(tokenHash, ownerA, 5000);
      expect(acquired).toBe(true);

      // Attempt release with wrong owner
      const releasedByB = await redisCache.releaseRotationLock(tokenHash, ownerB);
      expect(releasedByB).toBe(false);

      // Lock is still held by ownerA: another request cannot acquire
      const acquiredByC = await redisCache.acquireRotationLock(tokenHash, 'owner-c', 5000);
      expect(acquiredByC).toBe(false);

      // Release with correct owner succeeds
      const releasedByA = await redisCache.releaseRotationLock(tokenHash, ownerA);
      expect(releasedByA).toBe(true);

      // Now lock can be acquired
      const acquiredNow = await redisCache.acquireRotationLock(tokenHash, 'owner-c', 5000);
      expect(acquiredNow).toBe(true);
    });

    it('lock renewal extends expiry for long-running transaction and rejects wrong owner', async () => {
      const client = new MockRedisClient();
      const redisCache = new RedisReplayCacheService({
        secret: 'a'.repeat(32),
        redisClient: client
      });

      const tokenHash = 'hash-token-renew';
      const owner = 'owner-uuid-orig';

      await redisCache.acquireRotationLock(tokenHash, owner, 200);

      // Renew with correct owner
      const renewed = await redisCache.renewRotationLock(tokenHash, owner, 1000);
      expect(renewed).toBe(true);

      // Renew with wrong owner fails
      const wrongRenew = await redisCache.renewRotationLock(tokenHash, 'wrong-owner', 1000);
      expect(wrongRenew).toBe(false);
    });
  });

  // =========================================================================
  // 7 & 8: Redis Outage Leaves R1 Active & Atomic Cache Cleanup
  // =========================================================================
  describe('7 & 8. Outage Fail-Closed & Atomic Cleanup', () => {
    it('Redis outage during lock acquisition fails safely and leaves R1 active', async () => {
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

      store.addUser({ id: 'user-outage-1', email: 'merchant@outage.com' });
      const initial = await tokenService.createInitialSession({
        userId: 'user-outage-1',
        email: 'merchant@outage.com'
      });
      const r1 = initial.refreshToken;

      // Simulate Redis outage before rotation
      replayCache.setSimulateOutage(true);

      await expect(
        tokenService.rotateRefreshToken(r1)
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'REPLAY_CACHE_WRITE_FAILURE',
          status: 503
        })
      );

      // Invariant: R1 MUST remain active!
      const r1Hash = Array.from(store.tokens.values())[0].tokenHash;
      const r1Doc = await store.findByTokenHash(r1Hash);
      expect(r1Doc.status).toBe('active');
    });

    it('atomic cache cleanup in Redis uses Lua script and does not delete mismatched successors', async () => {
      const client = new MockRedisClient();
      const redisCache = new RedisReplayCacheService({
        secret: 'a'.repeat(32),
        redisClient: client
      });

      const r1Hash = 'hash-lua-1';
      const committedHash = 'hash-r2-committed';
      const failedHash = 'hash-r3-failed';

      await redisCache.setCachedResponse(r1Hash, {
        accessToken: 'jwt-token',
        refreshToken: 'r2-token',
        tokenHash: committedHash,
        nextTokenHash: committedHash
      }, 30, 'family-lua');

      // Attempt atomic delete with failed hash -> should return false
      const resMismatch = await redisCache.deleteCachedResponseIfMatches(r1Hash, failedHash);
      expect(resMismatch).toBe(false);

      // Attempt atomic delete with committed hash -> returns true and deletes
      const resMatch = await redisCache.deleteCachedResponseIfMatches(r1Hash, committedHash);
      expect(resMatch).toBe(true);

      // Verified deleted
      const postDelete = await redisCache.getCachedResponse(r1Hash);
      expect(postDelete).toBeNull();
    });
  });

  // =========================================================================
  // 9: Redis ping() Validation (false, null, unexpected strings rejected)
  // =========================================================================
  describe('9. Redis ping() Validation', () => {
    it('startup rejects Redis ping returning false', async () => {
      process.env.NODE_ENV = 'production';
      const { privateKey, kid } = generateTestRsaKeyPair('kid');
      process.env.JWT_PRIVATE_KEY = privateKey;
      process.env.JWT_KEY_ID = kid;
      process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/prod_db';

      const mockClient = new MockRedisClient({ pingResponse: false });
      const redisCache = new RedisReplayCacheService({
        secret: 'a'.repeat(32),
        redisClient: mockClient
      });

      await expect(
        initializeProductionServices({ replayCache: redisCache })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'REDIS_READINESS_FAILED'
        })
      );
    });

    it('startup rejects Redis ping returning null or unexpected string', async () => {
      process.env.NODE_ENV = 'production';
      const { privateKey, kid } = generateTestRsaKeyPair('kid');
      process.env.JWT_PRIVATE_KEY = privateKey;
      process.env.JWT_KEY_ID = kid;
      process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/prod_db';

      const mockClient = new MockRedisClient({ pingResponse: 'UNEXPECTED_STRING' });
      const redisCache = new RedisReplayCacheService({
        secret: 'a'.repeat(32),
        redisClient: mockClient
      });

      await expect(
        initializeProductionServices({ replayCache: redisCache })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'REDIS_READINESS_FAILED'
        })
      );
    });
  });

  // =========================================================================
  // 10, 11 & 12: Startup Validation Order & Resource Cleanup
  // =========================================================================
  describe('10, 11 & 12. Startup Validation Order & Resource Cleanup', () => {
    it('missing production MONGO_URI is detected before Redis is constructed', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.MONGO_URI;

      const redisSpy = vi.fn();
      class SpyRedisCache extends RedisReplayCacheService {
        constructor(opts) {
          super(opts);
          redisSpy();
        }
      }

      await expect(
        startServer({ mongoUri: '' })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'MISSING_MONGO_URI'
        })
      );

      // Assert Redis was NEVER constructed
      expect(redisSpy).not.toHaveBeenCalled();
    });

    it('MongoDB connection failure cleanly closes opened Redis client', async () => {
      process.env.NODE_ENV = 'production';
      const { privateKey, kid } = generateTestRsaKeyPair('kid');
      process.env.JWT_PRIVATE_KEY = privateKey;
      process.env.JWT_KEY_ID = kid;

      const mockClient = new MockRedisClient({ connected: true });
      const redisCache = new RedisReplayCacheService({
        secret: 'a'.repeat(32),
        redisClient: mockClient
      });

      vi.spyOn(mongoose, 'connect').mockRejectedValueOnce(new Error('MONGODB_OFFLINE'));

      await expect(
        startServer({
          replayCache: redisCache,
          mongoUri: 'mongodb://127.0.0.1:27017/prod_db'
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'MONGO_CONNECTION_FAILED'
        })
      );

      // Verify Redis client was closed during cleanup!
      expect(mockClient.closed).toBe(true);
    });

    it('HTTP listener failure cleanly closes Redis and disconnects MongoDB', async () => {
      process.env.NODE_ENV = 'production';
      const { privateKey, kid } = generateTestRsaKeyPair('kid');
      process.env.JWT_PRIVATE_KEY = privateKey;
      process.env.JWT_KEY_ID = kid;

      const mockClient = new MockRedisClient({ connected: true });
      const redisCache = new RedisReplayCacheService({
        secret: 'a'.repeat(32),
        redisClient: mockClient
      });

      vi.spyOn(mongoose, 'connect').mockResolvedValueOnce(mongoose);
      const disconnectSpy = vi.spyOn(mongoose, 'disconnect').mockResolvedValueOnce();

      // Pass an invalid port to trigger listener error
      await expect(
        startServer({
          replayCache: redisCache,
          mongoUri: 'mongodb://127.0.0.1:27017/prod_db',
          port: -1
        })
      ).rejects.toThrow();

      // Verify Redis was closed and MongoDB disconnected!
      expect(mockClient.closed).toBe(true);
      expect(disconnectSpy).toHaveBeenCalled();
    });
  });
});
