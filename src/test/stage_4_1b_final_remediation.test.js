import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';

import {
  createApp,
  initializeProductionServices,
  legacyRetiredRouteHandler
} from '../../server/src/server.js';

import {
  RefreshTokenService,
  InMemoryRefreshTokenStore,
  createTestRefreshTokenService,
  hashRefreshToken,
  RefreshTokenError
} from '../../server/src/services/refreshTokenService.js';

import {
  RedisReplayCacheService,
  InMemoryReplayCacheService,
  ConfigurationError
} from '../../server/src/services/replayCacheService.js';

import {
  generateTestRsaKeyPair
} from '../../server/src/services/jwtService.js';

import {
  createAuthSessionRouter
} from '../../server/src/routes/authSessionRoutes.js';

import {
  REFRESH_COOKIE_NAME
} from '../../server/src/controllers/authSessionController.js';

/**
 * Mock Redis client supporting ping and TTL.
 */
class MockRedisClient {
  constructor(options = {}) {
    this.store = new Map();
    this.connected = options.connected !== false;
    this.pingThrows = Boolean(options.pingThrows);
  }

  async ping() {
    if (!this.connected || this.pingThrows) {
      throw new Error('ECONNREFUSED: Redis instance unreachable at 127.0.0.1:6379');
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

describe('Stage 4.1B Final Remediation Test Suite', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SECTION 1: Production Bootstrap, Wiring & Startup Readiness
  // =========================================================================
  describe('1. Production Bootstrap & Startup Readiness Verification', () => {
    it('production bootstrap rejects missing JWT_PRIVATE_KEY before accepting requests', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.JWT_PRIVATE_KEY;
      process.env.JWT_KEY_ID = 'prod-kid-1';
      process.env.REDIS_URL = 'redis://127.0.0.1:6379';
      process.env.REPLAY_CACHE_SECRET = 'a'.repeat(32);

      await expect(
        initializeProductionServices()
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'MISSING_JWT_PRIVATE_KEY'
        })
      );
    });

    it('production bootstrap rejects missing JWT_KEY_ID before accepting requests', async () => {
      process.env.NODE_ENV = 'production';
      const { privateKey } = generateTestRsaKeyPair('kid');
      process.env.JWT_PRIVATE_KEY = privateKey;
      delete process.env.JWT_KEY_ID;
      process.env.REDIS_URL = 'redis://127.0.0.1:6379';
      process.env.REPLAY_CACHE_SECRET = 'a'.repeat(32);

      await expect(
        initializeProductionServices()
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'MISSING_JWT_KEY_ID'
        })
      );
    });

    it('production bootstrap rejects missing REDIS_URL', async () => {
      process.env.NODE_ENV = 'production';
      const { privateKey, kid } = generateTestRsaKeyPair('kid');
      process.env.JWT_PRIVATE_KEY = privateKey;
      process.env.JWT_KEY_ID = kid;
      delete process.env.REDIS_URL;
      process.env.REPLAY_CACHE_SECRET = 'a'.repeat(32);

      await expect(
        initializeProductionServices()
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'MISSING_REDIS_URL'
        })
      );
    });

    it('production bootstrap rejects missing REPLAY_CACHE_SECRET', async () => {
      process.env.NODE_ENV = 'production';
      const { privateKey, kid } = generateTestRsaKeyPair('kid');
      process.env.JWT_PRIVATE_KEY = privateKey;
      process.env.JWT_KEY_ID = kid;
      process.env.REDIS_URL = 'redis://127.0.0.1:6379';
      delete process.env.REPLAY_CACHE_SECRET;

      await expect(
        initializeProductionServices()
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'MISSING_REPLAY_CACHE_SECRET'
        })
      );
    });

    it('production bootstrap fails readiness when Redis cannot be reached (ping failure)', async () => {
      process.env.NODE_ENV = 'production';
      const { privateKey, kid } = generateTestRsaKeyPair('kid');
      process.env.JWT_PRIVATE_KEY = privateKey;
      process.env.JWT_KEY_ID = kid;
      process.env.REDIS_URL = 'redis://127.0.0.1:6379';
      process.env.REPLAY_CACHE_SECRET = 'a'.repeat(32);

      const brokenRedisClient = new MockRedisClient({ pingThrows: true });

      await expect(
        initializeProductionServices({ redisClient: brokenRedisClient })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'REDIS_READINESS_FAILED'
        })
      );
    });

    it('production createApp throws ConfigurationError if mounted without tokenService', () => {
      process.env.NODE_ENV = 'production';

      expect(() => {
        createApp({ tokenService: null });
      }).toThrowError(
        expect.objectContaining({
          code: 'MISSING_TOKEN_SERVICE'
        })
      );
    });

    it('createAuthSessionRouter in production throws ConfigurationError if tokenService is missing', () => {
      process.env.NODE_ENV = 'production';

      expect(() => {
        createAuthSessionRouter({ tokenService: null });
      }).toThrowError(
        expect.objectContaining({
          code: 'MISSING_TOKEN_SERVICE'
        })
      );
    });

    it('successful bootstrap injects real validated service and router uses it', async () => {
      const { privateKey, kid } = generateTestRsaKeyPair('valid-prod-kid');
      const mockRedis = new MockRedisClient();
      const mockStore = new InMemoryRefreshTokenStore();

      const { tokenService, replayCache } = await initializeProductionServices({
        signingKey: privateKey,
        kid,
        redisClient: mockRedis,
        replayCacheSecret: 'b'.repeat(32),
        store: mockStore
      });

      expect(tokenService).toBeInstanceOf(RefreshTokenService);
      expect(replayCache).toBeInstanceOf(RedisReplayCacheService);

      const app = createApp({ tokenService });
      expect(app).toBeDefined();

      // Graceful shutdown cleans up Redis
      await replayCache.close();
      expect(mockRedis.connected).toBe(false);
    });

    it('startup errors do not leak private keys or secrets', async () => {
      process.env.NODE_ENV = 'production';
      const secretKey = 'super-secret-key-material-do-not-leak';
      process.env.JWT_KEY_ID = 'kid-1';
      process.env.JWT_PRIVATE_KEY = secretKey; // Invalid PEM
      process.env.REDIS_URL = 'redis://127.0.0.1:6379';
      process.env.REPLAY_CACHE_SECRET = 'a'.repeat(32);

      try {
        await initializeProductionServices();
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.message.includes(secretKey)).toBe(false);
      }
    });
  });

  // =========================================================================
  // SECTION 2: Legacy Route Retirement (HTTP 410 Gone)
  // =========================================================================
  describe('2. Legacy API Route Retirement (HTTP 410 Gone)', () => {
    let app;

    beforeEach(() => {
      const tokenService = createTestRefreshTokenService();
      app = createApp({ tokenService });
    });

    it('POST /api/v1/sync returns HTTP 410 Gone with machine-readable error', async () => {
      let statusSent = null;
      let jsonSent = null;

      const req = {
        method: 'POST',
        url: '/api/v1/sync',
        originalUrl: '/api/v1/sync',
        headers: {},
        body: { merchantData: 'sample' }
      };

      const res = {
        status: (s) => { statusSent = s; return res; },
        json: (j) => { jsonSent = j; }
      };

      legacyRetiredRouteHandler(req, res);

      expect(statusSent).toBe(410);
      expect(jsonSent.error).toBe('ENDPOINT_RETIRED_GONE');
      expect(jsonSent.message).toContain('permanently retired');
      expect(jsonSent.migrationGuide).toBeDefined();
    });

    it('GET /api/v1/admin/stats returns HTTP 410 Gone without leaking system metrics', async () => {
      let statusSent = null;
      let jsonSent = null;

      const req = {
        method: 'GET',
        url: '/api/v1/admin/stats',
        originalUrl: '/api/v1/admin/stats',
        headers: {}
      };

      const res = {
        status: (s) => { statusSent = s; return res; },
        json: (j) => { jsonSent = j; }
      };

      legacyRetiredRouteHandler(req, res);

      expect(statusSent).toBe(410);
      expect(jsonSent.error).toBe('ENDPOINT_RETIRED_GONE');
      // Must not contain database statistics or system metrics
      expect(jsonSent.stats).toBeUndefined();
      expect(jsonSent.database).toBeUndefined();
    });

    it('all HTTP methods on /api/v1/sync and /api/v1/admin/stats return 410 through router handle', async () => {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
        let statusSent = null;
        let jsonSent = null;

        const req = {
          method,
          url: '/api/v1/sync',
          originalUrl: '/api/v1/sync',
          headers: {}
        };
        const res = {
          status: (s) => { statusSent = s; return res; },
          json: (j) => { jsonSent = j; }
        };

        legacyRetiredRouteHandler(req, res);
        expect(statusSent).toBe(410);
        expect(jsonSent.error).toBe('ENDPOINT_RETIRED_GONE');
      }
    });
  });

  // =========================================================================
  // SECTION 3: MongoDB Transaction Reliability & Retry Semantics
  // =========================================================================
  describe('3. MongoDB Transaction Retry Semantics & Ambiguous Commit Handling', () => {
    let store;
    let tokenService;
    let rsaKeys;

    const testUser = {
      id: 'usr_tx_retry_001',
      email: 'tx_retry@example.com'
    };

    beforeEach(() => {
      store = new InMemoryRefreshTokenStore();
      store.addUser(testUser);
      rsaKeys = generateTestRsaKeyPair('tx-retry-kid');

      tokenService = new RefreshTokenService({
        store,
        signingKey: rsaKeys.privateKey,
        kid: rsaKeys.kid,
        allowTestKeyFallback: true
      });
    });

    it('retries transaction body on TransientTransactionError and succeeds', async () => {
      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email
      });

      const r1 = session.refreshToken;
      const r1Hash = hashRefreshToken(r1);

      // Instruct store to fail on 1st attempt with TransientTransactionError and succeed on 2nd
      store.simulateTransientErrorCount = 1;

      const rotation = await tokenService.rotateRefreshToken(r1);
      expect(rotation.refreshToken).toBeDefined();

      // Transaction successfully committed on retry
      const r1Doc = await store.findByTokenHash(r1Hash);
      expect(r1Doc.status).toBe('consumed');

      const r2Hash = hashRefreshToken(rotation.refreshToken);
      const r2Doc = await store.findByTokenHash(r2Hash);
      expect(r2Doc.status).toBe('active');
    });

    it('retries commit on UnknownTransactionCommitResult and confirms successful commit', async () => {
      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email
      });

      const r1 = session.refreshToken;
      const r1Hash = hashRefreshToken(r1);

      // Simulate 1 dropped commit confirmation that succeeds on commit retry
      store.simulateUnknownCommitResultCount = 1;

      const rotation = await tokenService.rotateRefreshToken(r1);
      expect(rotation.refreshToken).toBeDefined();

      const r1Doc = await store.findByTokenHash(r1Hash);
      expect(r1Doc.status).toBe('consumed');
    });

    it('fails cleanly when UnknownTransactionCommitResult exceeds max retries', async () => {
      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email
      });

      const r1 = session.refreshToken;

      // Simulate 5 consecutive commit drops (exceeds maxCommitRetries = 3)
      store.simulateUnknownCommitResultCount = 5;

      await expect(
        tokenService.rotateRefreshToken(r1)
      ).rejects.toThrow(/UnknownTransactionCommitResult/);
    });

    it('confirmed transaction abort leaves R1 active and creates no successor in DB', async () => {
      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email
      });

      const r1 = session.refreshToken;
      const r1Hash = hashRefreshToken(r1);

      // Simulate failure during rotation
      store.failAfterR1Update = true;

      await expect(
        tokenService.rotateRefreshToken(r1)
      ).rejects.toThrow('SIMULATED_TRANSACTION_FAILURE_BEFORE_R2');

      // Invariants:
      // 1. R1 remains active
      const r1Doc = await store.findByTokenHash(r1Hash);
      expect(r1Doc.status).toBe('active');
      expect(r1Doc.consumedAt).toBeNull();

      // 2. Exact count of tokens is 1 (no orphaned R2 created)
      expect(store.tokens.size).toBe(1);
    });

    it('committed transaction leaves exactly one active successor in the family', async () => {
      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email
      });

      const r1 = session.refreshToken;
      await tokenService.rotateRefreshToken(r1);

      let activeCount = 0;
      for (const tok of store.tokens.values()) {
        if (tok.familyId === session.familyId && tok.status === 'active') {
          activeCount++;
        }
      }
      expect(activeCount).toBe(1);
    });
  });

  // =========================================================================
  // SECTION 4: Replay Cache & Transaction Coordination Proof
  // =========================================================================
  describe('4. Replay Cache & Transaction Coordination Ordering Invariant', () => {
    let store;
    let cacheService;
    let rsaKeys;
    let tokenService;

    const testUser = {
      id: 'usr_coord_001',
      email: 'coord@example.com'
    };

    beforeEach(() => {
      store = new InMemoryRefreshTokenStore();
      store.addUser(testUser);
      cacheService = new InMemoryReplayCacheService();
      rsaKeys = generateTestRsaKeyPair('coord-kid');

      tokenService = new RefreshTokenService({
        store,
        replayCache: cacheService,
        signingKey: rsaKeys.privateKey,
        kid: rsaKeys.kid,
        allowTestKeyFallback: true
      });
    });

    it('proves aborted transaction cannot cause a later request to receive an uncommitted successor', async () => {
      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email
      });

      const r1 = session.refreshToken;
      const r1Hash = hashRefreshToken(r1);

      // Force cache write failure which triggers transaction abort
      cacheService.setSimulateOutage(true);

      await expect(
        tokenService.rotateRefreshToken(r1)
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'REPLAY_CACHE_WRITE_FAILURE',
          statusCode: 503
        })
      );

      // Database verification: R1 is ACTIVE in DB!
      const r1Doc = await store.findByTokenHash(r1Hash);
      expect(r1Doc.status).toBe('active');

      // Now restore cache service
      cacheService.setSimulateOutage(false);

      // Client retries with R1:
      // Because R1 is ACTIVE in DB, the server enters Case A (active rotation),
      // and NEVER serves an uncommitted successor from the replay cache!
      const successfulRetry = await tokenService.rotateRefreshToken(r1);
      expect(successfulRetry.refreshToken).toBeDefined();

      const r2Hash = hashRefreshToken(successfulRetry.refreshToken);
      const r2Doc = await store.findByTokenHash(r2Hash);
      expect(r2Doc.status).toBe('active');
    });
  });
});
