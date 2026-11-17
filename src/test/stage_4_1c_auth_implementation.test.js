/**
 * Stage 4.1C / SBM-040: Complete Authentication Implementation Test Suite
 * 
 * Verifies:
 * 1. Merchant Registration:
 *    - Valid registration creates User, Business, Membership, issues RS256 token and refresh cookie.
 *    - Case-insensitive email uniqueness enforcement (409 Conflict).
 *    - Strict server-side input validation (email format, 8-character password, full name).
 * 2. Merchant Login & Side-Channel Defenses:
 *    - Valid login returns tokens and resets failed attempt counters.
 *    - Non-existent email executes constant-time dummy Argon2id verification (timing attack defense).
 *    - Invalid password returns 401 INVALID_CREDENTIALS.
 * 3. Approved Rate Limiting & Account Lockout (Blueprint v2.1 Section 23):
 *    - 5 login attempts per IP per minute (429 TOO_MANY_REQUESTS).
 *    - Account lockout after 10 failed login attempts (423 ACCOUNT_LOCKED).
 * 4. Session Version Enforcement:
 *    - Incremented sessionVersion invalidates outstanding access tokens.
 * 5. CSRF & Origin Validation:
 *    - Rejects unauthorized origins on sensitive auth endpoints.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthService, AuthError } from '../../server/src/services/authService.js';
import { LoginRateLimitService } from '../../server/src/services/loginRateLimitService.js';
import { RefreshTokenService, InMemoryRefreshTokenStore } from '../../server/src/services/refreshTokenService.js';
import { InMemoryReplayCacheService } from '../../server/src/services/replayCacheService.js';
import { generateTestRsaKeyPair, verifyAccessToken } from '../../server/src/services/jwtService.js';
import { createAuthMiddleware } from '../../server/src/middleware/authMiddleware.js';
import { createCsrfProtectionMiddleware } from '../../server/src/middleware/csrfProtection.js';
import { createAuthController } from '../../server/src/controllers/authController.js';
import { REFRESH_COOKIE_NAME } from '../../server/src/controllers/authSessionController.js';

// In-Memory Model Mock for Unit Testing Isolation
function createMockModel(name) {
  const store = new Map();

  class MockDoc {
    constructor(data) {
      Object.assign(this, data);
    }
    async save() {
      store.set(this.id, this);
      return this;
    }
  }

  MockDoc.findOne = vi.fn(async (query) => {
    for (const doc of store.values()) {
      let match = true;
      for (const [k, v] of Object.entries(query)) {
        if (k === 'email') {
          if (doc.email?.toLowerCase() !== v?.toLowerCase()) match = false;
        } else if (doc[k] !== v) {
          match = false;
        }
      }
      if (match) return doc;
    }
    return null;
  });

  MockDoc.find = vi.fn(async (query) => {
    const results = [];
    for (const doc of store.values()) {
      let match = true;
      for (const [k, v] of Object.entries(query)) {
        if (k === 'id' && v && v.$in) {
          if (!v.$in.includes(doc.id)) match = false;
        } else if (doc[k] !== v) {
          match = false;
        }
      }
      if (match) results.push(doc);
    }
    return results;
  });

  MockDoc.clear = () => store.clear();
  MockDoc.count = () => store.size;

  return MockDoc;
}

function createMockResponse() {
  let statusSent = 200;
  let jsonSent = null;
  const cookiesSet = {};
  const cookiesCleared = {};

  const res = {
    status(s) {
      statusSent = s;
      return res;
    },
    json(j) {
      jsonSent = j;
      return res;
    },
    cookie(name, val, opts) {
      cookiesSet[name] = { val, opts };
      return res;
    },
    clearCookie(name, opts) {
      cookiesCleared[name] = opts;
      return res;
    },
    get statusSent() {
      return statusSent;
    },
    get jsonSent() {
      return jsonSent;
    },
    get cookiesSet() {
      return cookiesSet;
    },
    get cookiesCleared() {
      return cookiesCleared;
    }
  };
  return res;
}

describe('Stage 4.1C / SBM-040: Authentication Implementation', () => {
  let MockUser;
  let MockBusiness;
  let MockMembership;
  let keyPair;
  let tokenService;
  let rateLimiter;
  let authService;
  let authController;
  let csrfMiddleware;
  let authMiddleware;

  beforeEach(() => {
    MockUser = createMockModel('User');
    MockBusiness = createMockModel('Business');
    MockMembership = createMockModel('Membership');

    keyPair = generateTestRsaKeyPair('stage-4-1c-key');

    const tokenStore = new InMemoryRefreshTokenStore();
    const replayCache = new InMemoryReplayCacheService();

    tokenService = new RefreshTokenService({
      store: tokenStore,
      replayCache,
      signingKey: keyPair.privateKey,
      kid: keyPair.kid,
      allowTestKeyFallback: true
    });

    rateLimiter = new LoginRateLimitService({
      maxAttemptsPerIp: 5,
      windowSeconds: 60,
      lockoutThreshold: 10,
      defaultLockoutDurationMs: 15 * 60 * 1000 // 15 mins
    });

    authService = new AuthService({
      userModel: MockUser,
      businessModel: MockBusiness,
      membershipModel: MockMembership,
      tokenService,
      rateLimitService: rateLimiter,
      signingKey: keyPair.privateKey,
      kid: keyPair.kid,
      allowTestKeyFallback: true
    });

    authController = createAuthController(authService);
    csrfMiddleware = createCsrfProtectionMiddleware();

    authMiddleware = createAuthMiddleware(keyPair.publicKey, {
      expectedKid: keyPair.kid,
      validateSessionVersion: async (userId, tokenVersion) => {
        const user = await MockUser.findOne({ id: userId });
        return user ? (user.sessionVersion || 1) === tokenVersion : false;
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Merchant Registration (B1 & B3)
  // =========================================================================
  describe('1. Merchant Registration', () => {
    it('successfully registers a merchant, creates entities, and sets HttpOnly refresh cookie', async () => {
      const req = {
        body: {
          email: 'Merchant.Owner@Example.COM',
          password: 'Password123!',
          fullName: 'Chidi Mokeme',
          businessName: 'Chidi Provisions Hub'
        }
      };
      const res = createMockResponse();

      await authController.register(req, res);

      expect(res.statusSent).toBe(201);
      expect(res.jsonSent.success).toBe(true);
      expect(res.jsonSent.user.email).toBe('merchant.owner@example.com');
      expect(res.jsonSent.user.fullName).toBe('Chidi Mokeme');
      expect(res.jsonSent.user.defaultBusinessId).toBeDefined();
      expect(res.jsonSent.accessToken).toBeDefined();

      // Check cookie
      expect(res.cookiesSet[REFRESH_COOKIE_NAME]).toBeDefined();
      expect(res.cookiesSet[REFRESH_COOKIE_NAME].opts.httpOnly).toBe(true);
      expect(res.cookiesSet[REFRESH_COOKIE_NAME].opts.sameSite).toBe('strict');

      // Verify RS256 JWT
      const verified = await verifyAccessToken(res.jsonSent.accessToken, keyPair.publicKey, {
        expectedKid: keyPair.kid
      });
      expect(verified.sub).toBe(res.jsonSent.user.id);
      expect(verified.email).toBe('merchant.owner@example.com');
      expect(verified.role).toBe('owner');
      expect(verified.sessionVersion).toBe(1);

      // Verify User entity in DB
      expect(MockUser.count()).toBe(1);
      expect(MockBusiness.count()).toBe(1);
      expect(MockMembership.count()).toBe(1);
    });

    it('rejects registration with case-insensitive duplicate email (409 Conflict)', async () => {
      await authService.register({
        email: 'duplicate@store.ng',
        password: 'ValidPassword1!',
        fullName: 'First Owner'
      });

      const req = {
        body: {
          email: 'DUPLICATE@STORE.NG', // Same email, uppercase!
          password: 'AnotherPassword2!',
          fullName: 'Second Owner'
        }
      };
      const res = createMockResponse();

      await authController.register(req, res);

      expect(res.statusSent).toBe(409);
      expect(res.jsonSent.error).toBe('EMAIL_ALREADY_EXISTS');
    });

    it('rejects weak password under 8 characters with 400 WEAK_PASSWORD', async () => {
      const req = {
        body: {
          email: 'valid@store.ng',
          password: 'short', // 5 chars
          fullName: 'Valid Name'
        }
      };
      const res = createMockResponse();

      await authController.register(req, res);

      expect(res.statusSent).toBe(400);
      expect(res.jsonSent.error).toBe('WEAK_PASSWORD');
    });

    it('rejects malformed email format with 400 INVALID_EMAIL', async () => {
      const req = {
        body: {
          email: 'not-an-email',
          password: 'ValidPassword123!',
          fullName: 'Valid Name'
        }
      };
      const res = createMockResponse();

      await authController.register(req, res);

      expect(res.statusSent).toBe(400);
      expect(res.jsonSent.error).toBe('INVALID_EMAIL');
    });
  });

  // =========================================================================
  // 2. Merchant Login & Side-Channel Timing Defenses (B1 & B3)
  // =========================================================================
  describe('2. Merchant Login & Side-Channel Timing Defenses', () => {
    beforeEach(async () => {
      await authService.register({
        email: 'active.merchant@ledger.ng',
        password: 'CorrectSecret99!',
        fullName: 'Folake Solanke'
      });
    });

    it('successful login returns 200, user data, access token and refresh cookie', async () => {
      const req = {
        body: {
          email: 'Active.Merchant@Ledger.NG',
          password: 'CorrectSecret99!'
        },
        ip: '127.0.0.1'
      };
      const res = createMockResponse();

      await authController.login(req, res);

      expect(res.statusSent).toBe(200);
      expect(res.jsonSent.success).toBe(true);
      expect(res.jsonSent.user.email).toBe('active.merchant@ledger.ng');
      expect(res.jsonSent.accessToken).toBeDefined();
      expect(res.cookiesSet[REFRESH_COOKIE_NAME]).toBeDefined();
    });

    it('non-existent email performs dummy verification and returns 401 INVALID_CREDENTIALS', async () => {
      const dummySpy = vi.spyOn(rateLimiter, 'performDummyVerification');

      const req = {
        body: {
          email: 'ghost.user@doesnotexist.ng',
          password: 'SomePassword123!'
        },
        ip: '127.0.0.1'
      };
      const res = createMockResponse();

      await authController.login(req, res);

      expect(res.statusSent).toBe(401);
      expect(res.jsonSent.error).toBe('INVALID_CREDENTIALS');
      expect(dummySpy).toHaveBeenCalled();
    });

    it('invalid password returns 401 INVALID_CREDENTIALS', async () => {
      const req = {
        body: {
          email: 'active.merchant@ledger.ng',
          password: 'WRONG_PASSWORD'
        },
        ip: '127.0.0.1'
      };
      const res = createMockResponse();

      await authController.login(req, res);

      expect(res.statusSent).toBe(401);
      expect(res.jsonSent.error).toBe('INVALID_CREDENTIALS');
    });
  });

  // =========================================================================
  // 3. Approved Rate Limiting & Account Lockout (Blueprint v2.1 Section 23)
  // =========================================================================
  describe('3. Rate Limiting & Account Lockout (Blueprint v2.1 Section 23)', () => {
    beforeEach(async () => {
      await authService.register({
        email: 'lockout.target@msme.ng',
        password: 'TargetPassword123!',
        fullName: 'Target Merchant'
      });
    });

    it('enforces 5 login attempts per IP per minute (Blueprint Section 23)', async () => {
      const testIp = '192.168.1.100';

      // 5 attempts allowed
      for (let i = 0; i < 5; i++) {
        const req = {
          body: { email: 'lockout.target@msme.ng', password: 'wrong' },
          ip: testIp
        };
        const res = createMockResponse();
        await authController.login(req, res);
        expect(res.statusSent).toBe(401);
      }

      // 6th attempt must be rejected with 429 TOO_MANY_REQUESTS
      const blockedReq = {
        body: { email: 'lockout.target@msme.ng', password: 'wrong' },
        ip: testIp
      };
      const blockedRes = createMockResponse();
      await authController.login(blockedReq, blockedRes);

      expect(blockedRes.statusSent).toBe(429);
      expect(blockedRes.jsonSent.error).toBe('TOO_MANY_REQUESTS');
      expect(blockedRes.jsonSent.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('locks account after 10 failed login attempts (Blueprint Section 23)', async () => {
      const user = await MockUser.findOne({ email: 'lockout.target@msme.ng' });

      // Simulate 10 failed attempts across rotating IPs
      for (let i = 1; i <= 10; i++) {
        const req = {
          body: { email: 'lockout.target@msme.ng', password: 'bad_password' },
          ip: `10.0.0.${i}`
        };
        const res = createMockResponse();
        await authController.login(req, res);

        if (i < 10) {
          expect(res.statusSent).toBe(401);
        } else {
          // Exactly on 10th attempt, account is locked!
          expect(res.statusSent).toBe(423);
          expect(res.jsonSent.error).toBe('ACCOUNT_LOCKED');
          expect(res.jsonSent.lockoutUntil).toBeDefined();
        }
      }

      // 11th attempt even with correct password is locked out
      const lockedReq = {
        body: { email: 'lockout.target@msme.ng', password: 'TargetPassword123!' },
        ip: '10.0.0.99'
      };
      const lockedRes = createMockResponse();
      await authController.login(lockedReq, lockedRes);

      expect(lockedRes.statusSent).toBe(423);
      expect(lockedRes.jsonSent.error).toBe('ACCOUNT_LOCKED');
    });

    it('successful login resets failed login attempts counter', async () => {
      const user = await MockUser.findOne({ email: 'lockout.target@msme.ng' });

      // 3 failed attempts
      for (let i = 1; i <= 3; i++) {
        const req = {
          body: { email: 'lockout.target@msme.ng', password: 'wrong' },
          ip: `172.16.0.${i}`
        };
        const res = createMockResponse();
        await authController.login(req, res);
      }
      expect(user.failedLoginAttempts).toBe(3);

      // Now log in with correct password
      const okReq = {
        body: { email: 'lockout.target@msme.ng', password: 'TargetPassword123!' },
        ip: '172.16.0.4'
      };
      const okRes = createMockResponse();
      await authController.login(okReq, okRes);

      expect(okRes.statusSent).toBe(200);
      expect(user.failedLoginAttempts).toBe(0);
      expect(user.lockoutUntil).toBeNull();
    });
  });

  // =========================================================================
  // 4. Session Version Enforcement (B3)
  // =========================================================================
  describe('4. Session Version Enforcement', () => {
    it('revoked sessionVersion rejects previously issued access token with 401 SESSION_REVOKED', async () => {
      const regResult = await authService.register({
        email: 'session.test@msme.ng',
        password: 'ValidPassword123!',
        fullName: 'Session User'
      });

      const tokenV1 = regResult.accessToken;

      // Accessing with valid sessionVersion 1
      const req1 = {
        headers: { authorization: `Bearer ${tokenV1}` }
      };
      const res1 = createMockResponse();
      let nextCalled1 = false;

      await authMiddleware(req1, res1, () => { nextCalled1 = true; });
      expect(nextCalled1).toBe(true);
      expect(req1.user.email).toBe('session.test@msme.ng');

      // Now increment sessionVersion on user (e.g. password reset or global logout)
      const user = await MockUser.findOne({ email: 'session.test@msme.ng' });
      user.sessionVersion = 2;
      await user.save();

      // Accessing with old tokenV1 must fail!
      const req2 = {
        headers: { authorization: `Bearer ${tokenV1}` }
      };
      const res2 = createMockResponse();
      let nextCalled2 = false;

      await authMiddleware(req2, res2, () => { nextCalled2 = true; });
      expect(nextCalled2).toBe(false);
      expect(res2.statusSent).toBe(401);
      expect(res2.jsonSent.error).toBe('SESSION_REVOKED');
    });
  });

  // =========================================================================
  // 5. CSRF & Origin Validation
  // =========================================================================
  describe('5. CSRF & Origin Validation', () => {
    it('rejects cross-site request with unapproved Origin header (403 CSRF_INVALID_ORIGIN)', () => {
      const req = {
        method: 'POST',
        headers: {
          origin: 'https://malicious-attacker.com',
          'x-requested-with': 'XMLHttpRequest'
        }
      };
      const res = createMockResponse();
      let nextCalled = false;

      csrfMiddleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.statusSent).toBe(403);
      expect(res.jsonSent.error).toBe('CSRF_INVALID_ORIGIN');
    });
  });
});
