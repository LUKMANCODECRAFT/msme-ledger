import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import express from 'express';
import cookieParser from 'cookie-parser';

import {
  RefreshToken,
  refreshTokenSchema
} from '../../server/src/models/target/refreshTokenModel.js';

import {
  ReplayCacheService,
  ReplayCacheIntegrityError
} from '../../server/src/services/replayCacheService.js';

import {
  generateRefreshToken,
  hashRefreshToken,
  RefreshTokenService,
  InMemoryRefreshTokenStore,
  RefreshTokenError
} from '../../server/src/services/refreshTokenService.js';

import {
  createCsrfProtectionMiddleware,
  DEFAULT_ALLOWED_ORIGINS
} from '../../server/src/middleware/csrfProtection.js';

import {
  createAuthSessionController,
  REFRESH_COOKIE_NAME,
  getRefreshCookieOptions,
  extractRefreshTokenFromRequest
} from '../../server/src/controllers/authSessionController.js';

import {
  createAuthSessionRouter
} from '../../server/src/routes/authSessionRoutes.js';

import {
  verifyAccessToken,
  generateTestRsaKeyPair
} from '../../server/src/services/jwtService.js';

describe('Stage 4.1B: Refresh Token Lifecycle, Rotation, Replay Detection & Session Endpoints', () => {

  // =========================================================================
  // SECTION 1: Refresh Token Persistence Model & Target Schema
  // =========================================================================
  describe('Persistence Model & Target Schema Verification', () => {
    it('defines target RefreshToken schema with all required fields', () => {
      const paths = refreshTokenSchema.paths;
      expect(paths.id).toBeDefined();
      expect(paths.userId).toBeDefined();
      expect(paths.tokenHash).toBeDefined();
      expect(paths.familyId).toBeDefined();
      expect(paths.status).toBeDefined();
      expect(paths.replacedByHash).toBeDefined();
      expect(paths.replacedByTokenHash).toBeDefined();
      expect(paths.consumedAt).toBeDefined();
      expect(paths.revokedAt).toBeDefined();
      expect(paths.revocationReason).toBeDefined();
      expect(paths.reuseDetectedAt).toBeDefined();
      expect(paths.expiresAt).toBeDefined();
      expect(paths.userAgent).toBeDefined();
      expect(paths.ipAddress).toBeDefined();
      expect(paths.createdAt).toBeDefined();
      expect(paths.updatedAt).toBeDefined();
    });

    it('enforces status enum [active, consumed, revoked, delivery_terminated] with default active', () => {
      const statusField = refreshTokenSchema.paths.status;
      expect(statusField.enumValues).toEqual(['active', 'consumed', 'revoked', 'delivery_terminated']);
      expect(statusField.defaultValue).toBe('active');
    });

    it('declares compound index on { familyId: 1, status: 1 } and { userId: 1, status: 1 }', () => {
      const indexes = refreshTokenSchema.indexes();
      const familyStatusIndex = indexes.find(
        ([fields]) => fields.familyId === 1 && fields.status === 1
      );
      expect(familyStatusIndex).toBeDefined();

      const userStatusIndex = indexes.find(
        ([fields]) => fields.userId === 1 && fields.status === 1
      );
      expect(userStatusIndex).toBeDefined();
    });

    it('declares unique index on tokenHash', () => {
      const tokenHashField = refreshTokenSchema.paths.tokenHash;
      expect(tokenHashField.options.unique).toBe(true);
    });

    it('declares TTL index on expiresAt with expires: 0', () => {
      const expiresAtField = refreshTokenSchema.paths.expiresAt;
      expect(expiresAtField.options.index).toEqual({ expires: 0 });
    });
  });

  // =========================================================================
  // SECTION 2: Cryptographically Secure Token Generation & Hashing
  // =========================================================================
  describe('Cryptographically Secure Token Generation & Hashing', () => {
    it('generates 32 cryptographically random bytes encoded in base64url', () => {
      const { rawToken, tokenHash } = generateRefreshToken();

      expect(typeof rawToken).toBe('string');
      // 32 bytes base64url encoded is 43 characters
      expect(rawToken.length).toBe(43);
      // Valid base64url character set: [A-Za-z0-9-_]
      expect(/^[A-Za-z0-9_-]+$/.test(rawToken)).toBe(true);

      // SHA-256 hex digest is exactly 64 hex characters
      expect(tokenHash.length).toBe(64);
      expect(/^[0-9a-f]{64}$/.test(tokenHash)).toBe(true);
    });

    it('produces distinct tokens across repeated calls (256 bits entropy)', () => {
      const tokens = new Set();
      for (let i = 0; i < 50; i++) {
        const { rawToken } = generateRefreshToken();
        expect(tokens.has(rawToken)).toBe(false);
        tokens.add(rawToken);
      }
      expect(tokens.size).toBe(50);
    });

    it('computes consistent SHA-256 hex hash from raw token', () => {
      const { rawToken, tokenHash } = generateRefreshToken();
      const recomputed = hashRefreshToken(rawToken);
      expect(recomputed).toBe(tokenHash);

      const manualHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      expect(tokenHash).toBe(manualHash);
    });

    it('rejects empty or invalid token inputs in hashRefreshToken', () => {
      expect(() => hashRefreshToken('')).toThrow(RefreshTokenError);
      expect(() => hashRefreshToken(null)).toThrow(RefreshTokenError);
      expect(() => hashRefreshToken(123)).toThrow(RefreshTokenError);
      expect(() => hashRefreshToken('   ')).toThrow(RefreshTokenError);
    });
  });

  // =========================================================================
  // SECTION 3: Authenticated Ephemeral Replay Cache (AES-256-GCM)
  // =========================================================================
  describe('Replay Cache Service (AES-256-GCM)', () => {
    let cacheService;

    beforeEach(() => {
      cacheService = new ReplayCacheService();
    });

    it('encrypts and decrypts payloads round-trip using AES-256-GCM', async () => {
      const payload = {
        accessToken: 'mock-jwt-access-token',
        refreshToken: 'mock-raw-refresh-token',
        expiresIn: 900
      };

      const encrypted = cacheService.encryptPayload(payload);
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.authTag).toBeDefined();
      expect(encrypted.ciphertext).toBeDefined();

      const decrypted = cacheService.decryptPayload(encrypted);
      expect(decrypted).toEqual(payload);
    });

    it('fails closed with ReplayCacheIntegrityError if ciphertext is tampered', () => {
      const payload = { secret: 'sensitive-token' };
      const encrypted = cacheService.encryptPayload(payload);

      // Tamper ciphertext
      const rawCipher = Buffer.from(encrypted.ciphertext, 'base64');
      rawCipher[0] = rawCipher[0] ^ 0xFF; // Flip bits
      encrypted.ciphertext = rawCipher.toString('base64');

      expect(() => cacheService.decryptPayload(encrypted)).toThrow(ReplayCacheIntegrityError);
    });

    it('fails closed with ReplayCacheIntegrityError if auth tag is modified', () => {
      const payload = { secret: 'sensitive-token' };
      const encrypted = cacheService.encryptPayload(payload);

      // Modify auth tag
      const rawTag = Buffer.from(encrypted.authTag, 'base64');
      rawTag[0] = rawTag[0] ^ 0xFF;
      encrypted.authTag = rawTag.toString('base64');

      expect(() => cacheService.decryptPayload(encrypted)).toThrow(ReplayCacheIntegrityError);
    });

    it('stores and retrieves cached responses with TTL expiry', async () => {
      const tokenHash = 'test-token-hash-12345';
      const payload = { accessToken: 'jwt-1', refreshToken: 'ref-1' };

      await cacheService.setCachedResponse(tokenHash, payload, 30);
      const retrieved = await cacheService.getCachedResponse(tokenHash);
      expect(retrieved).toEqual(payload);

      // Simulate expired item
      const entry = cacheService.store.get(tokenHash);
      entry.expiresAt = Date.now() - 1000;
      const expired = await cacheService.getCachedResponse(tokenHash);
      expect(expired).toBeNull();
    });

    it('returns null safely when simulated outage is enabled', async () => {
      const tokenHash = 'test-token-hash-outage';
      const payload = { accessToken: 'jwt-2', refreshToken: 'ref-2' };

      await cacheService.setCachedResponse(tokenHash, payload, 30);
      cacheService.setSimulateOutage(true);

      const retrieved = await cacheService.getCachedResponse(tokenHash);
      expect(retrieved).toBeNull();
    });
  });

  // =========================================================================
  // SECTION 4: Refresh Token Lifecycle & Rotation
  // =========================================================================
  describe('RefreshTokenService Lifecycle, Rotation & Invariants', () => {
    let store;
    let cacheService;
    let rsaKeys;
    let tokenService;

    const testUser = {
      id: 'usr_test_merchant_001',
      email: 'merchant@example.com',
      defaultBusinessId: 'biz_default_100'
    };

    beforeEach(() => {
      store = new InMemoryRefreshTokenStore();
      store.addUser(testUser);
      cacheService = new ReplayCacheService();
      rsaKeys = generateTestRsaKeyPair('service-test-kid-1');

      tokenService = new RefreshTokenService({
        store,
        replayCache: cacheService,
        signingKey: rsaKeys.privateKey,
        kid: rsaKeys.kid
      });
    });

    it('creates an initial session with 30-day expiry and valid RS256 access token', async () => {
      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email,
        defaultBusinessId: testUser.defaultBusinessId
      });

      expect(session.familyId).toBeDefined();
      expect(session.refreshToken).toBeDefined();
      expect(session.accessToken).toBeDefined();
      expect(session.expiresIn).toBe(900);

      // Verify stored record
      const tokenHash = hashRefreshToken(session.refreshToken);
      const stored = await store.findByTokenHash(tokenHash);
      expect(stored).toBeDefined();
      expect(stored.userId).toBe(testUser.id);
      expect(stored.familyId).toBe(session.familyId);
      expect(stored.status).toBe('active');
      expect(stored.tokenHash).toBe(tokenHash);

      // Verify expiration is ~30 days in future
      const deltaDays = (new Date(stored.expiresAt).getTime() - Date.now()) / (24 * 3600 * 1000);
      expect(Math.round(deltaDays)).toBe(30);

      // Verify access token signature and claims
      const decoded = await verifyAccessToken(session.accessToken, rsaKeys.publicKey, {
        expectedKid: rsaKeys.kid
      });
      expect(decoded.sub).toBe(testUser.id);
      expect(decoded.email).toBe(testUser.email);
      expect(decoded.defaultBusinessId).toBe(testUser.defaultBusinessId);
    });

    it('performs atomic rotation on active token, creating successor R2 in same family', async () => {
      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email
      });

      const r1Raw = session.refreshToken;
      const r1Hash = hashRefreshToken(r1Raw);

      const rotated = await tokenService.rotateRefreshToken(r1Raw);
      expect(rotated.refreshToken).toBeDefined();
      expect(rotated.refreshToken).not.toBe(r1Raw);
      expect(rotated.accessToken).toBeDefined();
      expect(rotated.expiresIn).toBe(900);

      // R1 should now be consumed
      const r1Doc = await store.findByTokenHash(r1Hash);
      expect(r1Doc.status).toBe('consumed');
      expect(r1Doc.consumedAt).toBeInstanceOf(Date);
      expect(r1Doc.replacedByHash).toBe(hashRefreshToken(rotated.refreshToken));

      // R2 should be active in the same family
      const r2Hash = hashRefreshToken(rotated.refreshToken);
      const r2Doc = await store.findByTokenHash(r2Hash);
      expect(r2Doc.status).toBe('active');
      expect(r2Doc.familyId).toBe(session.familyId);
      expect(r2Doc.userId).toBe(testUser.id);

      // Access token must be valid
      const decoded = await verifyAccessToken(rotated.accessToken, rsaKeys.publicKey, {
        expectedKid: rsaKeys.kid
      });
      expect(decoded.sub).toBe(testUser.id);
    });

    it('rejects rotation for expired refresh token with 401 REFRESH_TOKEN_EXPIRED', async () => {
      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email
      });

      // Advance time beyond 30 days
      const thirtyOneDaysLater = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);

      await expect(
        tokenService.rotateRefreshToken(session.refreshToken, { now: thirtyOneDaysLater })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'REFRESH_TOKEN_EXPIRED',
          statusCode: 401
        })
      );
    });

    it('rejects rotation for unknown token with 401 INVALID_REFRESH_TOKEN', async () => {
      const fakeToken = crypto.randomBytes(32).toString('base64url');

      await expect(
        tokenService.rotateRefreshToken(fakeToken)
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'INVALID_REFRESH_TOKEN',
          statusCode: 401
        })
      );
    });

    it('verifies plaintext refresh token is NEVER persisted in store or token documents', async () => {
      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email
      });

      const r1Raw = session.refreshToken;
      const rotation = await tokenService.rotateRefreshToken(r1Raw);
      const r2Raw = rotation.refreshToken;

      for (const tok of store.tokens.values()) {
        expect(tok.rawToken).toBeUndefined();
        expect(tok.tokenHash).toBeDefined();
        expect(tok.tokenHash).not.toBe(r1Raw);
        expect(tok.tokenHash).not.toBe(r2Raw);
        // Ensure serialization contains zero raw tokens
        const json = JSON.stringify(tok);
        expect(json.includes(r1Raw)).toBe(false);
        expect(json.includes(r2Raw)).toBe(false);
      }
    });
  });

  // =========================================================================
  // SECTION 5: Two-Tier Concurrency, Recovery & Replay Detection
  // =========================================================================
  describe('Two-Tier Concurrency & Malicious Replay Detection Contract', () => {
    let store;
    let cacheService;
    let rsaKeys;
    let tokenService;

    const testUser = {
      id: 'usr_concurrency_001',
      email: 'concurrency@example.com'
    };

    beforeEach(() => {
      store = new InMemoryRefreshTokenStore();
      store.addUser(testUser);
      cacheService = new ReplayCacheService();
      rsaKeys = generateTestRsaKeyPair('service-test-kid-2');

      tokenService = new RefreshTokenService({
        store,
        replayCache: cacheService,
        signingKey: rsaKeys.privateKey,
        kid: rsaKeys.kid
      });
    });

    it('simultaneous concurrent refresh calls cannot fork competing active branches', async () => {
      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email
      });

      const r1 = session.refreshToken;

      // Run two concurrent rotations
      const [res1, res2] = await Promise.allSettled([
        tokenService.rotateRefreshToken(r1),
        tokenService.rotateRefreshToken(r1)
      ]);

      // At least one must succeed
      expect(res1.status === 'fulfilled' || res2.status === 'fulfilled').toBe(true);

      // Check active tokens in family: exactly ONE active token must exist in the family
      let activeCount = 0;
      for (const tok of store.tokens.values()) {
        if (tok.familyId === session.familyId && tok.status === 'active') {
          activeCount++;
        }
      }
      expect(activeCount).toBe(1);
    });

    it('Tier 1 / 2 (<= 30s): Idempotently returns cached successor payload on reuse', async () => {
      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email
      });

      const r1 = session.refreshToken;
      const initialRotation = await tokenService.rotateRefreshToken(r1);

      // Immediate retry (e.g. Tab B or dropped network delivery 2 seconds later)
      const twoSecondsLater = new Date(Date.now() + 2000);
      const retryResult = await tokenService.rotateRefreshToken(r1, { now: twoSecondsLater });

      expect(retryResult.isReplay).toBe(true);
      expect(retryResult.accessToken).toBe(initialRotation.accessToken);
      expect(retryResult.refreshToken).toBe(initialRotation.refreshToken);

      // Token family is NOT revoked
      const isRevoked = await store.isFamilyRevoked(session.familyId);
      expect(isRevoked).toBe(false);
    });

    it('Tier 1 (<= 10s): Returns 409 CONCURRENT_REFRESH_IN_PROGRESS on cache miss without revoking family', async () => {
      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email
      });

      const r1 = session.refreshToken;
      const r1Hash = hashRefreshToken(r1);
      await tokenService.rotateRefreshToken(r1);

      // Simulate cache miss / eviction
      await cacheService.deleteCachedResponse(r1Hash);

      // Tab B arrives 3 seconds after rotation
      const threeSecondsLater = new Date(Date.now() + 3000);

      await expect(
        tokenService.rotateRefreshToken(r1, { now: threeSecondsLater })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'CONCURRENT_REFRESH_IN_PROGRESS',
          statusCode: 409,
          retryAfter: 1
        })
      );

      // Crucial security invariant: Family must NOT be revoked!
      const isRevoked = await store.isFamilyRevoked(session.familyId);
      expect(isRevoked).toBe(false);
    });

    it('Tier 2 (10s - 30s): Terminates branch with 401 REFRESH_DELIVERY_FAILED_REAUTH_REQUIRED on cache outage without revoking family', async () => {
      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email
      });

      const r1 = session.refreshToken;
      const r1Hash = hashRefreshToken(r1);
      await tokenService.rotateRefreshToken(r1);

      // Simulate cache outage / miss
      await cacheService.deleteCachedResponse(r1Hash);

      // Retry arrives 15 seconds after rotation
      const fifteenSecondsLater = new Date(Date.now() + 15000);

      await expect(
        tokenService.rotateRefreshToken(r1, { now: fifteenSecondsLater })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'REFRESH_DELIVERY_FAILED_REAUTH_REQUIRED',
          statusCode: 401
        })
      );

      // Token marked delivery_terminated
      const tokenDoc = await store.findByTokenHash(r1Hash);
      expect(tokenDoc.status).toBe('delivery_terminated');

      // Crucial: Family must NOT be falsely revoked!
      const isRevoked = await store.isFamilyRevoked(session.familyId);
      expect(isRevoked).toBe(false);

      // Subsequent presentation of terminated token fails with REAUTH_REQUIRED
      await expect(
        tokenService.rotateRefreshToken(r1, { now: fifteenSecondsLater })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'REFRESH_DELIVERY_FAILED_REAUTH_REQUIRED',
          statusCode: 401
        })
      );
    });

    it('Tier 3 (> 30s): Revokes entire token family on suspicious replay attack', async () => {
      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email
      });

      const r1 = session.refreshToken;
      const rotation = await tokenService.rotateRefreshToken(r1);
      const r2 = rotation.refreshToken;

      // Replay attack occurs 45 seconds later
      const fortyFiveSecondsLater = new Date(Date.now() + 45000);

      await expect(
        tokenService.rotateRefreshToken(r1, { now: fortyFiveSecondsLater })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'TOKEN_FAMILY_COMPROMISED',
          statusCode: 401
        })
      );

      // ENTIRE FAMILY MUST BE REVOKED
      const isRevoked = await store.isFamilyRevoked(session.familyId);
      expect(isRevoked).toBe(true);

      const r1Doc = await store.findByTokenHash(hashRefreshToken(r1));
      expect(r1Doc.status).toBe('revoked');
      expect(r1Doc.revocationReason).toBe('REPLAY_DETECTED');
      expect(r1Doc.reuseDetectedAt).toBeDefined();

      const r2Doc = await store.findByTokenHash(hashRefreshToken(r2));
      expect(r2Doc.status).toBe('revoked');

      // Attempting to use the legitimate R2 token must now ALSO be rejected
      await expect(
        tokenService.rotateRefreshToken(r2, { now: fortyFiveSecondsLater })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'TOKEN_FAMILY_ALREADY_REVOKED',
          statusCode: 401
        })
      );
    });
  });

  // =========================================================================
  // SECTION 6: CSRF Protection Middleware
  // =========================================================================
  describe('CSRF Protection Middleware Multi-Layer Defense', () => {
    let app;
    let csrfMiddleware;

    beforeEach(() => {
      csrfMiddleware = createCsrfProtectionMiddleware({
        allowedOrigins: ['http://localhost:5173', 'https://merchant.example.com']
      });

      app = express();
      app.use(express.json());
      app.use(csrfMiddleware);

      app.get('/test-safe', (req, res) => res.json({ ok: true }));
      app.post('/test-action', (req, res) => res.json({ action: 'success' }));
    });

    it('allows safe methods (GET, HEAD, OPTIONS) without CSRF evaluation', async () => {
      const mockReq = {
        method: 'GET',
        headers: {}
      };
      const mockRes = {
        status: () => mockRes,
        json: () => {}
      };
      let nextCalled = false;

      csrfMiddleware(mockReq, mockRes, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
    });

    it('rejects POST with Sec-Fetch-Site: cross-site with 403 CSRF_CROSS_SITE', () => {
      const mockReq = {
        method: 'POST',
        headers: {
          'sec-fetch-site': 'cross-site',
          origin: 'http://localhost:5173',
          'x-requested-with': 'XMLHttpRequest'
        }
      };
      let statusSent = null;
      let jsonSent = null;
      const mockRes = {
        status: (s) => { statusSent = s; return mockRes; },
        json: (j) => { jsonSent = j; }
      };

      csrfMiddleware(mockReq, mockRes, () => {});
      expect(statusSent).toBe(403);
      expect(jsonSent.error).toBe('CSRF_CROSS_SITE');
    });

    it('rejects POST with missing Origin and Referer with 403 CSRF_INVALID_ORIGIN', () => {
      const mockReq = {
        method: 'POST',
        headers: {
          'x-requested-with': 'XMLHttpRequest'
        }
      };
      let statusSent = null;
      let jsonSent = null;
      const mockRes = {
        status: (s) => { statusSent = s; return mockRes; },
        json: (j) => { jsonSent = j; }
      };

      csrfMiddleware(mockReq, mockRes, () => {});
      expect(statusSent).toBe(403);
      expect(jsonSent.error).toBe('CSRF_INVALID_ORIGIN');
    });

    it('rejects POST with unlisted Origin with 403 CSRF_INVALID_ORIGIN', () => {
      const mockReq = {
        method: 'POST',
        headers: {
          origin: 'http://evil-attacker.com',
          'x-requested-with': 'XMLHttpRequest'
        }
      };
      let statusSent = null;
      let jsonSent = null;
      const mockRes = {
        status: (s) => { statusSent = s; return mockRes; },
        json: (j) => { jsonSent = j; }
      };

      csrfMiddleware(mockReq, mockRes, () => {});
      expect(statusSent).toBe(403);
      expect(jsonSent.error).toBe('CSRF_INVALID_ORIGIN');
    });

    it('rejects POST missing custom request header with 403 CSRF_MISSING_HEADER', () => {
      const mockReq = {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173'
        }
      };
      let statusSent = null;
      let jsonSent = null;
      const mockRes = {
        status: (s) => { statusSent = s; return mockRes; },
        json: (j) => { jsonSent = j; }
      };

      csrfMiddleware(mockReq, mockRes, () => {});
      expect(statusSent).toBe(403);
      expect(jsonSent.error).toBe('CSRF_MISSING_HEADER');
    });

    it('permits POST with valid Origin and custom header (X-Requested-With / X-SB-Client)', () => {
      const mockReq = {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'x-requested-with': 'XMLHttpRequest',
          'sec-fetch-site': 'same-origin'
        }
      };
      let nextCalled = false;
      const mockRes = {};

      csrfMiddleware(mockReq, mockRes, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
    });
  });

  // =========================================================================
  // SECTION 7: Session Endpoints (POST /refresh & POST /logout)
  // =========================================================================
  describe('Session Endpoints Integration (POST /refresh & POST /logout)', () => {
    let store;
    let tokenService;
    let controller;
    let rsaKeys;

    const testUser = {
      id: 'usr_controller_001',
      email: 'merchant_ctrl@example.com'
    };

    beforeEach(() => {
      store = new InMemoryRefreshTokenStore();
      store.addUser(testUser);
      rsaKeys = generateTestRsaKeyPair('service-test-kid-3');

      tokenService = new RefreshTokenService({
        store,
        signingKey: rsaKeys.privateKey,
        kid: rsaKeys.kid
      });

      controller = createAuthSessionController(tokenService);
    });

    it('extractRefreshTokenFromRequest reads from req.cookies or raw header', () => {
      const reqFromCookie = { cookies: { sb_refresh_token: 'cookie-tok-123' } };
      expect(extractRefreshTokenFromRequest(reqFromCookie)).toBe('cookie-tok-123');

      const reqFromHeader = { headers: { cookie: 'other=1; sb_refresh_token=header-tok-456; foo=bar' } };
      expect(extractRefreshTokenFromRequest(reqFromHeader)).toBe('header-tok-456');

      const reqEmpty = { headers: {} };
      expect(extractRefreshTokenFromRequest(reqEmpty)).toBeNull();
    });

    it('POST /refresh returns 401 MISSING_REFRESH_TOKEN if cookie is absent', async () => {
      const req = {
        cookies: {},
        headers: {}
      };
      let statusCode = null;
      let jsonPayload = null;
      const res = {
        status: (code) => { statusCode = code; return res; },
        json: (payload) => { jsonPayload = payload; }
      };

      await controller.refresh(req, res);
      expect(statusCode).toBe(401);
      expect(jsonPayload.error).toBe('MISSING_REFRESH_TOKEN');
    });

    it('POST /refresh successfully rotates token, sets HttpOnly cookie, and returns access token', async () => {
      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email
      });

      const req = {
        cookies: { sb_refresh_token: session.refreshToken },
        headers: { 'user-agent': 'TestBrowser/1.0' },
        ip: '127.0.0.1'
      };

      let statusCode = null;
      let jsonPayload = null;
      let setCookieName = null;
      let setCookieValue = null;
      let setCookieOpts = null;

      const res = {
        status: (code) => { statusCode = code; return res; },
        json: (payload) => { jsonPayload = payload; },
        cookie: (name, val, opts) => {
          setCookieName = name;
          setCookieValue = val;
          setCookieOpts = opts;
        }
      };

      await controller.refresh(req, res);

      expect(statusCode).toBe(200);
      expect(jsonPayload.success).toBe(true);
      expect(jsonPayload.data.accessToken).toBeDefined();
      expect(jsonPayload.data.tokenType).toBe('Bearer');
      expect(jsonPayload.data.expiresIn).toBe(900);

      // Verify cookie attributes
      expect(setCookieName).toBe(REFRESH_COOKIE_NAME);
      expect(setCookieValue).not.toBe(session.refreshToken);
      expect(setCookieOpts.httpOnly).toBe(true);
      expect(setCookieOpts.sameSite).toBe('strict');
      expect(setCookieOpts.path).toBe('/api/v2/auth');
      expect(setCookieOpts.maxAge).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it('POST /refresh clears cookie on 401 authentication failure', async () => {
      const req = {
        cookies: { sb_refresh_token: 'bogus-token' },
        headers: {}
      };

      let statusCode = null;
      let clearedCookieName = null;
      let clearedCookieOpts = null;

      const res = {
        status: (code) => { statusCode = code; return res; },
        json: () => {},
        clearCookie: (name, opts) => {
          clearedCookieName = name;
          clearedCookieOpts = opts;
        }
      };

      await controller.refresh(req, res);

      expect(statusCode).toBe(401);
      expect(clearedCookieName).toBe(REFRESH_COOKIE_NAME);
      expect(clearedCookieOpts.httpOnly).toBe(true);
      expect(clearedCookieOpts.path).toBe('/api/v2/auth');
    });

    it('POST /logout revokes the token family, clears the cookie, and returns 200', async () => {
      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email
      });

      const req = {
        cookies: { sb_refresh_token: session.refreshToken },
        headers: {}
      };

      let statusCode = null;
      let jsonPayload = null;
      let clearedCookieName = null;

      const res = {
        status: (code) => { statusCode = code; return res; },
        json: (payload) => { jsonPayload = payload; },
        clearCookie: (name) => {
          clearedCookieName = name;
        }
      };

      await controller.logout(req, res);

      expect(statusCode).toBe(200);
      expect(jsonPayload.success).toBe(true);
      expect(clearedCookieName).toBe(REFRESH_COOKIE_NAME);

      // Verify family is now revoked in store
      const isRevoked = await store.isFamilyRevoked(session.familyId);
      expect(isRevoked).toBe(true);
    });

    it('POST /logout is idempotent when called without a cookie', async () => {
      const req = { cookies: {}, headers: {} };
      let statusCode = null;
      let clearedCookieName = null;

      const res = {
        status: (code) => { statusCode = code; return res; },
        json: () => {},
        clearCookie: (name) => {
          clearedCookieName = name;
        }
      };

      await controller.logout(req, res);
      expect(statusCode).toBe(200);
      expect(clearedCookieName).toBe(REFRESH_COOKIE_NAME);
    });

    it('end-to-end router integration: processes refresh through createAuthSessionRouter pipeline', async () => {
      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email
      });

      const router = createAuthSessionRouter({ tokenService });

      // Simulate Express dispatch
      let responseStatus = null;
      let responseBody = null;
      let setCookie = null;

      const mockReq = {
        method: 'POST',
        url: '/refresh',
        headers: {
          origin: 'http://localhost:5173',
          'x-requested-with': 'XMLHttpRequest',
          'sec-fetch-site': 'same-origin',
          cookie: `sb_refresh_token=${session.refreshToken}`
        },
        cookies: {
          sb_refresh_token: session.refreshToken
        }
      };

      const mockRes = {
        status: (code) => { responseStatus = code; return mockRes; },
        set: () => mockRes,
        json: (data) => { responseBody = data; return mockRes; },
        cookie: (name, val, opts) => { setCookie = { name, val, opts }; },
        clearCookie: () => {}
      };

      await new Promise((resolve) => {
        router.handle(mockReq, mockRes, () => resolve());
        // Since handler terminates with json, resolve after short tick
        setTimeout(resolve, 50);
      });

      expect(responseStatus).toBe(200);
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.accessToken).toBeDefined();
      expect(setCookie.name).toBe(REFRESH_COOKIE_NAME);
    });
  });
});
