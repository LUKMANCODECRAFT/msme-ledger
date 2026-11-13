import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import express from 'express';

import {
  RefreshTokenService,
  InMemoryRefreshTokenStore,
  MongooseRefreshTokenStore,
  createTestRefreshTokenService,
  hashRefreshToken,
  RefreshTokenError
} from '../../server/src/services/refreshTokenService.js';

import {
  RedisReplayCacheService,
  InMemoryReplayCacheService,
  createReplayCacheService,
  resolveReplayCacheKey,
  ReplayCacheIntegrityError,
  ReplayCacheOutageError,
  ConfigurationError
} from '../../server/src/services/replayCacheService.js';

import {
  validatePrivateKey,
  generateTestRsaKeyPair,
  signAccessToken
} from '../../server/src/services/jwtService.js';

import {
  createAuthSessionController,
  REFRESH_COOKIE_NAME
} from '../../server/src/controllers/authSessionController.js';

import {
  resolveAllowedOrigins
} from '../../server/src/middleware/csrfProtection.js';

/**
 * Mock Redis Client simulating shared multi-instance Redis cluster storage.
 */
class MockRedisClient {
  constructor(sharedStore = new Map()) {
    this.store = sharedStore; // Map: key -> { value, expiresAt }
    this.connected = true;
    this.shouldTimeout = false;
  }

  async set(key, val, exFlag, ttlSeconds) {
    if (!this.connected) {
      throw new Error('ECONNREFUSED: Connection to Redis failed.');
    }
    if (this.shouldTimeout) {
      throw new Error('ETIMEDOUT: Redis command timed out after 5000ms.');
    }
    const expiresAt = Date.now() + (ttlSeconds * 1000);
    this.store.set(key, { val: String(val), expiresAt });
    return 'OK';
  }

  async get(key) {
    if (!this.connected) {
      throw new Error('ECONNREFUSED: Connection to Redis failed.');
    }
    if (this.shouldTimeout) {
      throw new Error('ETIMEDOUT: Redis command timed out after 5000ms.');
    }
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return item.val;
  }

  async del(key) {
    if (!this.connected) {
      throw new Error('ECONNREFUSED: Connection to Redis failed.');
    }
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

describe('Stage 4.1B Security Remediation Test Suite', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // =========================================================================
  // REMEDIATION A: Transactionally Atomic Token Rotation
  // =========================================================================
  describe('Critical Correction A: Transactionally Atomic Token Rotation', () => {
    let store;
    let tokenService;
    let rsaKeys;

    const merchantUser = {
      id: 'usr_atomic_tx_001',
      email: 'atomic_tx@example.com',
      defaultBusinessId: 'biz_tx_100'
    };

    beforeEach(() => {
      store = new InMemoryRefreshTokenStore();
      store.addUser(merchantUser);
      rsaKeys = generateTestRsaKeyPair('tx-test-kid');

      tokenService = new RefreshTokenService({
        store,
        signingKey: rsaKeys.privateKey,
        kid: rsaKeys.kid,
        allowTestKeyFallback: true
      });
    });

    it('rolls back completely if failure occurs after R1 update but before R2 insertion', async () => {
      const session = await tokenService.createInitialSession({
        userId: merchantUser.id,
        email: merchantUser.email
      });

      const r1 = session.refreshToken;
      const r1Hash = hashRefreshToken(r1);

      // Instruct store to simulate a transaction failure midway
      store.failAfterR1Update = true;

      await expect(
        tokenService.rotateRefreshToken(r1)
      ).rejects.toThrow('SIMULATED_TRANSACTION_FAILURE_BEFORE_R2');

      // VERIFY TRANSACTION ROLLBACK:
      // 1. R1 MUST remain 'active'
      const r1Doc = await store.findByTokenHash(r1Hash);
      expect(r1Doc.status).toBe('active');
      expect(r1Doc.consumedAt).toBeNull();
      expect(r1Doc.replacedByHash).toBeNull();

      // 2. NO successor R2 must exist
      expect(store.tokens.size).toBe(1);
    });

    it('rolls back transaction on duplicate successor token hash conflict (E11000)', async () => {
      const session = await tokenService.createInitialSession({
        userId: merchantUser.id,
        email: merchantUser.email
      });

      const r1 = session.refreshToken;
      const r1Hash = hashRefreshToken(r1);

      // Mock generateRefreshToken to produce an already existing tokenHash
      const existingHash = r1Hash;
      vi.spyOn(crypto, 'randomBytes').mockReturnValue(Buffer.alloc(32, 0xAA));

      // First create a conflict token in store
      const conflictHash = crypto.createHash('sha256').update(Buffer.alloc(32, 0xAA).toString('base64url')).digest('hex');
      await store.createToken({
        id: crypto.randomUUID(),
        userId: 'other_user',
        familyId: 'other_family',
        tokenHash: conflictHash,
        status: 'active',
        expiresAt: new Date(Date.now() + 100000)
      });

      await expect(
        tokenService.rotateRefreshToken(r1)
      ).rejects.toThrow(/E11000 duplicate key error/);

      // R1 must still be active!
      const r1Doc = await store.findByTokenHash(r1Hash);
      expect(r1Doc.status).toBe('active');
    });

    it('competing concurrent refresh requests cannot both consume R1', async () => {
      const session = await tokenService.createInitialSession({
        userId: merchantUser.id,
        email: merchantUser.email
      });

      const r1 = session.refreshToken;

      // Launch 5 concurrent refresh attempts on the same R1 token
      const results = await Promise.allSettled([
        tokenService.rotateRefreshToken(r1),
        tokenService.rotateRefreshToken(r1),
        tokenService.rotateRefreshToken(r1),
        tokenService.rotateRefreshToken(r1),
        tokenService.rotateRefreshToken(r1)
      ]);

      // Exactly ONE primary rotation committed
      const activeSuccessors = [];
      for (const tok of store.tokens.values()) {
        if (tok.familyId === session.familyId && tok.status === 'active') {
          activeSuccessors.push(tok);
        }
      }
      expect(activeSuccessors.length).toBe(1);

      // Successful requests either received the single successor or 409 concurrency response
      for (const res of results) {
        if (res.status === 'fulfilled') {
          // If fulfilled, successor token matches the single active successor
          expect(hashRefreshToken(res.value.refreshToken)).toBe(activeSuccessors[0].tokenHash);
        } else {
          expect(res.reason.code).toBe('CONCURRENT_REFRESH_IN_PROGRESS');
        }
      }
    });

    it('rejects with MONGODB_TOPOLOGY_UNSUPPORTED when transaction is attempted on unsupported standalone deployment', async () => {
      const session = await tokenService.createInitialSession({
        userId: merchantUser.id,
        email: merchantUser.email
      });

      store.simulateTopologyUnsupported = true;

      await expect(
        tokenService.rotateRefreshToken(session.refreshToken)
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'MONGODB_TOPOLOGY_UNSUPPORTED',
          statusCode: 500
        })
      );
    });
  });

  // =========================================================================
  // REMEDIATION B: Production Shared Redis Replay Cache Adapter
  // =========================================================================
  describe('Critical Correction B: Production Shared Redis Replay Cache Adapter', () => {
    let sharedRedisStore;
    let mockRedisClient;
    const testSecret = crypto.randomBytes(32);

    beforeEach(() => {
      sharedRedisStore = new Map();
      mockRedisClient = new MockRedisClient(sharedRedisStore);
    });

    it('enforces Redis TTL with maximum ceiling of 30 seconds', async () => {
      const redisCache = new RedisReplayCacheService({
        redisClient: mockRedisClient,
        secret: testSecret,
        defaultTtlSeconds: 60 // Requests 60s, must be clamped to 30s
      });

      const tokenHash = 'test_hash_clamped_ttl';
      await redisCache.setCachedResponse(tokenHash, { accessToken: 'jwt-1' }, 120);

      const rawEntry = sharedRedisStore.get(`replay:${tokenHash}`);
      expect(rawEntry).toBeDefined();

      // Delta between now and expiresAt must be <= 30000ms
      const ttlMs = rawEntry.expiresAt - Date.now();
      expect(ttlMs).toBeLessThanOrEqual(30000);
      expect(ttlMs).toBeGreaterThan(25000);
    });

    it('multiple service instances share the exact same Redis cache', async () => {
      const instanceA = new RedisReplayCacheService({
        redisClient: new MockRedisClient(sharedRedisStore),
        secret: testSecret
      });

      const instanceB = new RedisReplayCacheService({
        redisClient: new MockRedisClient(sharedRedisStore),
        secret: testSecret
      });

      const tokenHash = 'shared_hash_between_instances';
      const payload = { accessToken: 'jwt-cluster-shared', refreshToken: 'successor-token-cluster' };

      // Instance A writes
      await instanceA.setCachedResponse(tokenHash, payload, 30, 'family_cluster_1');

      // Instance B reads
      const retrievedByB = await instanceB.getCachedResponse(tokenHash, 'family_cluster_1');
      expect(retrievedByB).toMatchObject(payload);
    });

    it('cache entries survive application restart simulation for remaining TTL', async () => {
      // Instance 1 writes
      const instance1 = new RedisReplayCacheService({
        redisClient: new MockRedisClient(sharedRedisStore),
        secret: testSecret
      });

      const tokenHash = 'hash_survival_after_restart';
      await instance1.setCachedResponse(tokenHash, { accessToken: 'jwt-pre-restart' }, 20);

      // App process dies (instance1 is garbage collected/closed)
      await instance1.close();

      // App process restarts (instance 2 connects to same Redis)
      const instance2 = new RedisReplayCacheService({
        redisClient: new MockRedisClient(sharedRedisStore),
        secret: testSecret
      });

      const retrievedAfterRestart = await instance2.getCachedResponse(tokenHash);
      expect(retrievedAfterRestart.accessToken).toBe('jwt-pre-restart');
    });

    it('fails closed with ReplayCacheIntegrityError on encryption key mismatch', async () => {
      const keyA = crypto.randomBytes(32);
      const keyB = crypto.randomBytes(32);

      const cacheA = new RedisReplayCacheService({
        redisClient: new MockRedisClient(sharedRedisStore),
        secret: keyA
      });

      const cacheB = new RedisReplayCacheService({
        redisClient: new MockRedisClient(sharedRedisStore),
        secret: keyB
      });

      const tokenHash = 'hash_key_mismatch';
      await cacheA.setCachedResponse(tokenHash, { accessToken: 'jwt-key-a' });

      // Cache B tries to read with keyB
      await expect(
        cacheB.getCachedResponse(tokenHash)
      ).rejects.toThrow(ReplayCacheIntegrityError);
    });

    it('fails closed with ReplayCacheIntegrityError if ciphertext or auth tag is tampered in Redis', async () => {
      const cache = new RedisReplayCacheService({
        redisClient: mockRedisClient,
        secret: testSecret
      });

      const tokenHash = 'hash_tampered_redis';
      await cache.setCachedResponse(tokenHash, { accessToken: 'jwt-untampered' });

      // Attacker tampers with value in Redis
      const stored = sharedRedisStore.get(`replay:${tokenHash}`);
      const envelope = JSON.parse(stored.val);

      // Tamper ciphertext
      const cipherBuf = Buffer.from(envelope.ciphertext, 'base64');
      cipherBuf[0] = cipherBuf[0] ^ 0x01;
      envelope.ciphertext = cipherBuf.toString('base64');
      stored.val = JSON.stringify(envelope);

      await expect(
        cache.getCachedResponse(tokenHash)
      ).rejects.toThrow(ReplayCacheIntegrityError);
    });

    it('fails safely with null on Redis connection failure or timeout without crashing process', async () => {
      const cache = new RedisReplayCacheService({
        redisClient: mockRedisClient,
        secret: testSecret
      });

      // Simulate connection drop
      mockRedisClient.connected = false;

      // Reading from broken Redis returns null (cache miss fallback) rather than uncaught crash
      const result = await cache.getCachedResponse('any_hash');
      expect(result).toBeNull();
    });

    it('production mode throws ConfigurationError when REDIS_URL or REPLAY_CACHE_SECRET is missing', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.REDIS_URL;
      delete process.env.REPLAY_CACHE_SECRET;

      expect(() => {
        new RedisReplayCacheService({ secret: 'a'.repeat(32) });
      }).toThrowError(
        expect.objectContaining({
          code: 'MISSING_REDIS_URL'
        })
      );

      expect(() => {
        new RedisReplayCacheService({ redisUrl: 'redis://127.0.0.1:6379' });
      }).toThrowError(
        expect.objectContaining({
          code: 'MISSING_REPLAY_CACHE_SECRET'
        })
      );
    });

    it('strictly forbids InMemoryReplayCacheService in production', () => {
      process.env.NODE_ENV = 'production';

      expect(() => {
        new InMemoryReplayCacheService();
      }).toThrowError(
        expect.objectContaining({
          code: 'IN_MEMORY_CACHE_PROHIBITED_IN_PROD'
        })
      );

      expect(() => {
        createReplayCacheService({ adapter: 'memory' });
      }).toThrowError(
        expect.objectContaining({
          code: 'IN_MEMORY_CACHE_PROHIBITED_IN_PROD'
        })
      );
    });
  });

  // =========================================================================
  // REMEDIATION C: Production Signing Key Fail-Closed Behavior
  // =========================================================================
  describe('Critical Correction C: Production Signing Fail-Closed Behavior', () => {
    it('validates valid RSA private key successfully', () => {
      const { privateKey, kid } = generateTestRsaKeyPair('valid-rsa-kid');
      expect(validatePrivateKey(privateKey, kid)).toBe(true);
    });

    it('rejects missing or empty private key with MISSING_PRIVATE_KEY', () => {
      expect(() => validatePrivateKey('', 'kid-1')).toThrow(/MISSING_PRIVATE_KEY/);
      expect(() => validatePrivateKey(null, 'kid-1')).toThrow(/MISSING_PRIVATE_KEY/);
    });

    it('rejects missing or empty key ID with MISSING_KEY_ID', () => {
      const { privateKey } = generateTestRsaKeyPair('kid-1');
      expect(() => validatePrivateKey(privateKey, '')).toThrow(/MISSING_KEY_ID/);
      expect(() => validatePrivateKey(privateKey, '   ')).toThrow(/MISSING_KEY_ID/);
    });

    it('rejects malformed or non-RSA private key material', () => {
      expect(() => validatePrivateKey('-----BEGIN RSA PRIVATE KEY-----\nBOGUS\n-----END RSA PRIVATE KEY-----', 'kid-1'))
        .toThrow(/MALFORMED_PRIVATE_KEY/);

      // Symmetric key or non-RSA EC key
      const ecKey = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });
      expect(() => validatePrivateKey(ecKey.privateKey, 'kid-1'))
        .toThrow(/INVALID_KEY_TYPE/);
    });

    it('RefreshTokenService in production throws ConfigurationError if JWT_PRIVATE_KEY is missing', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.JWT_PRIVATE_KEY;
      process.env.JWT_KEY_ID = 'prod-kid-1';

      expect(() => {
        new RefreshTokenService({ kid: 'prod-kid-1', replayCache: new MockRedisClient() });
      }).toThrowError(
        expect.objectContaining({
          code: 'MISSING_JWT_PRIVATE_KEY'
        })
      );
    });

    it('RefreshTokenService in production throws ConfigurationError if JWT_KEY_ID is missing', () => {
      process.env.NODE_ENV = 'production';
      const { privateKey } = generateTestRsaKeyPair('test-kid');
      process.env.JWT_PRIVATE_KEY = privateKey;
      delete process.env.JWT_KEY_ID;

      expect(() => {
        new RefreshTokenService({ signingKey: privateKey, replayCache: new MockRedisClient() });
      }).toThrowError(
        expect.objectContaining({
          code: 'MISSING_JWT_KEY_ID'
        })
      );
    });

    it('RefreshTokenService in production NEVER falls back to ephemeral test key generation', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.JWT_PRIVATE_KEY;
      delete process.env.JWT_KEY_ID;

      expect(() => {
        new RefreshTokenService({ allowTestKeyFallback: true, replayCache: new MockRedisClient() });
      }).toThrowError(
        expect.objectContaining({
          code: 'MISSING_JWT_PRIVATE_KEY'
        })
      );
    });
  });

  // =========================================================================
  // REMEDIATION D: Replay Cache Failure Handling in Rotation
  // =========================================================================
  describe('High-Priority Correction D: Cache Failure Handling During Rotation', () => {
    let store;
    let cacheService;
    let rsaKeys;
    let tokenService;

    const user = {
      id: 'usr_cache_fail_001',
      email: 'cache_fail@example.com'
    };

    beforeEach(() => {
      store = new InMemoryRefreshTokenStore();
      store.addUser(user);
      cacheService = new InMemoryReplayCacheService();
      rsaKeys = generateTestRsaKeyPair('cache-fail-kid');

      tokenService = new RefreshTokenService({
        store,
        replayCache: cacheService,
        signingKey: rsaKeys.privateKey,
        kid: rsaKeys.kid,
        allowTestKeyFallback: true
      });
    });

    it('aborts rotation and rolls back database if replay cache write fails', async () => {
      const session = await tokenService.createInitialSession({
        userId: user.id,
        email: user.email
      });

      const r1 = session.refreshToken;
      const r1Hash = hashRefreshToken(r1);

      // Simulate replay cache service outage during rotation write
      cacheService.setSimulateOutage(true);

      // Spy on console.error to verify sanitized logging
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        tokenService.rotateRefreshToken(r1)
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'REPLAY_CACHE_WRITE_FAILURE',
          statusCode: 503
        })
      );

      // VERIFY SAFETY INVARIANTS:
      // 1. R1 MUST REMAIN ACTIVE (NOT consumed)
      const r1Doc = await store.findByTokenHash(r1Hash);
      expect(r1Doc.status).toBe('active');
      expect(r1Doc.consumedAt).toBeNull();

      // 2. No orphaned successor was created
      expect(store.tokens.size).toBe(1);

      // 3. Family is NOT revoked
      expect(await store.isFamilyRevoked(session.familyId)).toBe(false);

      // 4. Operational event was logged without raw tokens
      expect(consoleSpy).toHaveBeenCalled();
      const logOutput = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(logOutput.includes(r1)).toBe(false); // Zero raw tokens logged!
    });
  });

  // =========================================================================
  // REMEDIATION E: Logout Revocation Reliability
  // =========================================================================
  describe('High-Priority Correction E: Logout Reliability & Error Propagation', () => {
    let store;
    let tokenService;
    let controller;
    let rsaKeys;

    const user = {
      id: 'usr_logout_001',
      email: 'logout_test@example.com'
    };

    beforeEach(() => {
      store = new InMemoryRefreshTokenStore();
      store.addUser(user);
      rsaKeys = generateTestRsaKeyPair('logout-kid');

      tokenService = new RefreshTokenService({
        store,
        signingKey: rsaKeys.privateKey,
        kid: rsaKeys.kid,
        allowTestKeyFallback: true
      });

      controller = createAuthSessionController(tokenService);
    });

    it('returns 500 LOGOUT_REVOCATION_FAILED when database revocation fails while clearing cookie', async () => {
      const session = await tokenService.createInitialSession({
        userId: user.id,
        email: user.email
      });

      // Simulate database revocation failure
      store.failOnRevocation = true;

      const req = {
        cookies: { sb_refresh_token: session.refreshToken },
        headers: {}
      };

      let statusSent = null;
      let jsonSent = null;
      let cookieCleared = false;

      const res = {
        status: (s) => { statusSent = s; return res; },
        json: (j) => { jsonSent = j; },
        clearCookie: (name) => {
          if (name === REFRESH_COOKIE_NAME) cookieCleared = true;
        }
      };

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await controller.logout(req, res);

      // Must NOT return 200 OK!
      expect(statusSent).toBe(500);
      expect(jsonSent.error).toBe('LOGOUT_REVOCATION_FAILED');
      // Cookie MUST be cleared
      expect(cookieCleared).toBe(true);

      // Error must be logged without raw token
      expect(consoleSpy).toHaveBeenCalled();
      const log = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(log.includes(session.refreshToken)).toBe(false);
    });

    it('succeeds with 200 OK idempotently when logging out with unknown token', async () => {
      const req = {
        cookies: { sb_refresh_token: crypto.randomBytes(32).toString('base64url') },
        headers: {}
      };

      let statusSent = null;
      let jsonSent = null;

      const res = {
        status: (s) => { statusSent = s; return res; },
        json: (j) => { jsonSent = j; },
        clearCookie: () => {}
      };

      await controller.logout(req, res);
      expect(statusSent).toBe(200);
      expect(jsonSent.success).toBe(true);
    });

    it('succeeds with 200 OK idempotently when logging out an already revoked family', async () => {
      const session = await tokenService.createInitialSession({
        userId: user.id,
        email: user.email
      });

      await tokenService.revokeFamily(session.familyId);

      const req = {
        cookies: { sb_refresh_token: session.refreshToken },
        headers: {}
      };

      let statusSent = null;
      const res = {
        status: (s) => { statusSent = s; return res; },
        json: () => {},
        clearCookie: () => {}
      };

      await controller.logout(req, res);
      expect(statusSent).toBe(200);
    });
  });

  // =========================================================================
  // ADDITIONAL SECURITY REVIEW: CSRF, Cookies & Response Privacy
  // =========================================================================
  describe('Additional Security Review Hardening', () => {
    it('CSRF origin resolver in production never allows localhost defaults without configuration', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ALLOWED_ORIGINS;
      delete process.env.CORS_ALLOWED_ORIGINS;
      delete process.env.CLIENT_URL;

      const resolved = resolveAllowedOrigins();
      expect(resolved).toEqual([]);
      expect(resolved.includes('http://localhost:5173')).toBe(false);
    });

    it('POST /refresh response JSON strictly excludes refresh token (never exposed in body)', async () => {
      const store = new InMemoryRefreshTokenStore();
      const rsaKeys = generateTestRsaKeyPair('privacy-kid');
      store.addUser({ id: 'usr_privacy', email: 'privacy@test.com' });

      const service = new RefreshTokenService({
        store,
        signingKey: rsaKeys.privateKey,
        kid: rsaKeys.kid,
        allowTestKeyFallback: true
      });
      const controller = createAuthSessionController(service);

      const session = await service.createInitialSession({
        userId: 'usr_privacy',
        email: 'privacy@test.com'
      });

      let jsonSent = null;
      const res = {
        status: () => res,
        cookie: () => {},
        json: (payload) => { jsonSent = payload; }
      };

      await controller.refresh({
        cookies: { sb_refresh_token: session.refreshToken },
        headers: {}
      }, res);

      expect(jsonSent.success).toBe(true);
      expect(jsonSent.data.accessToken).toBeDefined();
      expect(jsonSent.data.refreshToken).toBeUndefined(); // NEVER in JSON
      expect(JSON.stringify(jsonSent).includes('ref_')).toBe(false);
    });
  });
});
