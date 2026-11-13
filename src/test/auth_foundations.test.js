import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';

// Stage 4.1A Imports
import {
  hashPassword,
  verifyPassword,
  verifyDummyPassword,
  ARGON2_CONFIG
} from '../../server/src/services/passwordService.js';

import {
  normalizeEmail,
  isValidEmail
} from '../../server/src/utils/emailNormalization.js';

import {
  signAccessToken,
  verifyAccessToken,
  generateTestRsaKeyPair,
  JWT_CONFIG
} from '../../server/src/services/jwtService.js';

import {
  createAuthMiddleware
} from '../../server/src/middleware/authMiddleware.js';

import { User } from '../../server/src/models/target/coreModels.js';

describe('Stage 4.1A: Authentication Foundations', () => {

  // =========================================================================
  // SECTION 1: Argon2id Password Security
  // =========================================================================
  describe('Password Security (Argon2id)', () => {
    it('uses Blueprint v2.1 cryptographic configuration parameters', () => {
      expect(ARGON2_CONFIG.memoryCost).toBe(65536); // 64 MiB
      expect(ARGON2_CONFIG.timeCost).toBe(3);       // 3 iterations
      expect(ARGON2_CONFIG.parallelism).toBe(4);    // 4 threads
      expect(ARGON2_CONFIG.saltLength).toBe(16);    // 16 bytes
    });

    it('generates standard Modular Crypt Format hash starting with $argon2id$v=19$m=65536,t=3,p=4$', async () => {
      const plaintext = 'CorrectHorseBatteryStaple2026!';
      const hash = await hashPassword(plaintext);

      expect(typeof hash).toBe('string');
      expect(hash.startsWith('$argon2id$v=19$m=65536,t=3,p=4$')).toBe(true);
      // Ensure plain password is never contained in hash
      expect(hash.includes(plaintext)).toBe(false);
    });

    it('verifies correct password returns true', async () => {
      const plaintext = 'SecretMerchantPass#99';
      const hash = await hashPassword(plaintext);
      const isValid = await verifyPassword(hash, plaintext);
      expect(isValid).toBe(true);
    });

    it('rejects incorrect password returning false', async () => {
      const hash = await hashPassword('OriginalPassword123');
      const isValid = await verifyPassword(hash, 'WrongPassword123');
      expect(isValid).toBe(false);
    });

    it('handles malformed hashes safely without throwing unhandled exceptions', async () => {
      const malformedHashes = [
        'not-a-hash',
        '$argon2i$v=19$m=65536,t=3,p=4$wrongalgo',
        '$argon2id$v=19$corrupted',
        '',
        null,
        undefined,
        12345
      ];

      for (const badHash of malformedHashes) {
        const result = await verifyPassword(badHash, 'SomePassword123');
        expect(result).toBe(false);
      }
    });

    it('handles non-string candidate password safely returning false', async () => {
      const hash = await hashPassword('ValidPassword123');
      expect(await verifyPassword(hash, null)).toBe(false);
      expect(await verifyPassword(hash, undefined)).toBe(false);
      expect(await verifyPassword(hash, 12345)).toBe(false);
    });

    it('enforces password minimum length of 8 characters during hashing', async () => {
      await expect(hashPassword('short')).rejects.toThrow('PASSWORD_TOO_SHORT');
      await expect(hashPassword('')).rejects.toThrow('PASSWORD_TOO_SHORT');
      await expect(hashPassword(null)).rejects.toThrow(TypeError);
      await expect(hashPassword(undefined)).rejects.toThrow(TypeError);
    });

    it('executes timing mitigation dummy verification and always returns false', async () => {
      const dummyResult = await verifyDummyPassword('UnrecognizedUserPasswordAttempt');
      expect(dummyResult).toBe(false);
    });
  });

  // =========================================================================
  // SECTION 2: Email Normalization & Identity Foundations
  // =========================================================================
  describe('Email Identity Foundations', () => {
    it('trims leading and trailing whitespace and lowercases email', () => {
      const input = '   Merchant.Admin@EXAMPLE.Com   ';
      const normalized = normalizeEmail(input);
      expect(normalized).toBe('merchant.admin@example.com');
    });

    it('validates RFC-compliant email formats', () => {
      expect(isValidEmail('valid.user+alias@domain.co.uk')).toBe(true);
      expect(isValidEmail('merchant@sub.domain.ng')).toBe(true);
      expect(isValidEmail('plainaddress')).toBe(false);
      expect(isValidEmail('@missinguser.com')).toBe(false);
      expect(isValidEmail('missingdomain@')).toBe(false);
      expect(isValidEmail('   ')).toBe(false);
      expect(isValidEmail(null)).toBe(false);
    });

    it('rejects invalid email formats with INVALID_EMAIL_FORMAT error', () => {
      expect(() => normalizeEmail('not-an-email')).toThrow('INVALID_EMAIL_FORMAT');
      expect(() => normalizeEmail('')).toThrow('INVALID_EMAIL_FORMAT');
      expect(() => normalizeEmail('   ')).toThrow('INVALID_EMAIL_FORMAT');
      expect(() => normalizeEmail(null)).toThrow(TypeError);
      expect(() => normalizeEmail(undefined)).toThrow(TypeError);
    });

    it('declares case-insensitive collation { locale: "en", strength: 2 } on User email index', () => {
      const indexes = User.schema.indexes();
      const emailIndex = indexes.find(([fields, opts]) => fields.email === 1 && opts?.unique === true);

      expect(emailIndex).toBeDefined();
      expect(emailIndex[1].collation).toEqual({
        locale: 'en',
        strength: 2
      });
    });

    it('preserves existing User schema fields and defaultBusinessId', () => {
      const schemaPaths = Object.keys(User.schema.paths);
      expect(schemaPaths).toContain('id');
      expect(schemaPaths).toContain('email');
      expect(schemaPaths).toContain('passwordHash');
      expect(schemaPaths).toContain('fullName');
      expect(schemaPaths).toContain('defaultBusinessId');
      expect(schemaPaths).toContain('isEmailVerified');
      expect(schemaPaths).toContain('createdAt');
      expect(schemaPaths).toContain('updatedAt');
    });

    it('simulates database-level case-insensitive uniqueness collision (E11000)', () => {
      // Simulating MongoDB unique index behavior under strength 2 collation:
      // In strength 2 collation, 'Merchant@Domain.COM' and 'merchant@domain.com' collide as duplicate keys
      const indexCollator = new Intl.Collator('en', { sensitivity: 'base' });
      const registeredEmails = [];

      function insertUser(email) {
        const normalized = normalizeEmail(email);
        const collision = registeredEmails.find(existing => indexCollator.compare(existing, normalized) === 0);
        if (collision) {
          const err = new Error(`E11000 duplicate key error collection: users index: email_1 dup key: { email: "${email}" }`);
          err.code = 11000;
          throw err;
        }
        registeredEmails.push(normalized);
        return { email: normalized };
      }

      // Initial registration
      insertUser('merchant@example.com');

      // Attempt concurrent/subsequent registration with uppercase variant
      expect(() => insertUser('MERCHANT@EXAMPLE.COM')).toThrow(/E11000/);
      expect(() => insertUser('  Merchant@Example.com  ')).toThrow(/E11000/);
    });
  });

  // =========================================================================
  // SECTION 3: RS256 Access Token Infrastructure
  // =========================================================================
  describe('RS256 Access-Token Infrastructure', () => {
    let testKeys;

    beforeAll(() => {
      testKeys = generateTestRsaKeyPair('sb-test-kid-2026');
    });

    it('generates ephemeral RSA 2048-bit key pairs with valid PEM formatting', () => {
      expect(testKeys.publicKey).toContain('-----BEGIN PUBLIC KEY-----');
      expect(testKeys.privateKey).toContain('-----BEGIN PRIVATE KEY-----');
      expect(testKeys.kid).toBe('sb-test-kid-2026');
    });

    it('issues valid RS256 access token with exact Blueprint claims schema', async () => {
      const token = signAccessToken(
        {
          sub: 'usr_test_12345',
          email: 'Merchant@Shop.NG',
          defaultBusinessId: 'biz_main_001'
        },
        testKeys.privateKey,
        { kid: testKeys.kid, expiresInSeconds: 900 }
      );

      const payload = await verifyAccessToken(token, testKeys.publicKey);

      expect(payload.sub).toBe('usr_test_12345');
      expect(payload.email).toBe('merchant@shop.ng'); // normalized
      expect(payload.defaultBusinessId).toBe('biz_main_001');
      expect(payload.iss).toBe(JWT_CONFIG.ISSUER);     // 'sb-manager-auth'
      expect(payload.aud).toBe(JWT_CONFIG.AUDIENCE);   // 'sb-manager-client'
      expect(payload.token_use).toBe(JWT_CONFIG.TOKEN_USE);   // 'access'
      expect(payload.token_type).toBe(JWT_CONFIG.TOKEN_TYPE); // 'merchant_access'
      expect(typeof payload.jti).toBe('string');
      expect(Number.isInteger(payload.iat)).toBe(true);
      expect(Number.isInteger(payload.exp)).toBe(true);
      expect(payload.exp - payload.iat).toBe(900); // exactly 15 minutes
    });

    it('supports public key resolution via resolver function and key map', async () => {
      const token = signAccessToken(
        { sub: 'usr_func_1', email: 'func@test.com' },
        testKeys.privateKey,
        { kid: testKeys.kid }
      );

      // Resolver function
      const resolverFn = async (kid) => {
        if (kid === testKeys.kid) return testKeys.publicKey;
        return null;
      };
      const verifiedWithFn = await verifyAccessToken(token, resolverFn);
      expect(verifiedWithFn.sub).toBe('usr_func_1');

      // Key map object
      const keyMap = { [testKeys.kid]: testKeys.publicKey };
      const verifiedWithMap = await verifyAccessToken(token, keyMap);
      expect(verifiedWithMap.sub).toBe('usr_func_1');
    });

    // Security Negative Tests
    it('SECURITY: strictly rejects tokens signed with HS256 (algorithm substitution attack)', async () => {
      // Simulate an attacker attempting to use the public key as an HMAC secret
      const jwt = (await import('jsonwebtoken')).default;
      const fakeHsToken = jwt.sign(
        {
          sub: 'attacker_usr',
          email: 'attacker@evil.com',
          iss: JWT_CONFIG.ISSUER,
          aud: JWT_CONFIG.AUDIENCE,
          token_use: JWT_CONFIG.TOKEN_USE,
          token_type: JWT_CONFIG.TOKEN_TYPE
        },
        testKeys.publicKey, // HMAC with public key as secret
        {
          algorithm: 'HS256',
          keyid: testKeys.kid
        }
      );

      await expect(verifyAccessToken(fakeHsToken, testKeys.publicKey)).rejects.toThrow('INVALID_ALGORITHM');
    });

    it('SECURITY: strictly rejects tokens with "none" algorithm', async () => {
      const headerB64 = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT', kid: testKeys.kid })).toString('base64url');
      const payloadB64 = Buffer.from(JSON.stringify({
        sub: 'attacker',
        iss: JWT_CONFIG.ISSUER,
        aud: JWT_CONFIG.AUDIENCE,
        token_use: JWT_CONFIG.TOKEN_USE,
        token_type: JWT_CONFIG.TOKEN_TYPE
      })).toString('base64url');
      const noneToken = `${headerB64}.${payloadB64}.`;

      await expect(verifyAccessToken(noneToken, testKeys.publicKey)).rejects.toThrow('INVALID_ALGORITHM');
    });

    it('SECURITY: strictly rejects tokens without kid header', async () => {
      const jwt = (await import('jsonwebtoken')).default;
      const tokenWithoutKid = jwt.sign(
        {
          sub: 'usr_no_kid',
          email: 'no_kid@test.com',
          iss: JWT_CONFIG.ISSUER,
          aud: JWT_CONFIG.AUDIENCE,
          token_use: JWT_CONFIG.TOKEN_USE,
          token_type: JWT_CONFIG.TOKEN_TYPE
        },
        testKeys.privateKey,
        {
          algorithm: 'RS256',
          header: { alg: 'RS256', typ: 'JWT' } // omit kid
        }
      );

      await expect(verifyAccessToken(tokenWithoutKid, testKeys.publicKey)).rejects.toThrow('MISSING_KID');
    });

    it('SECURITY: rejects expired access tokens with TOKEN_EXPIRED error code', async () => {
      const expiredToken = signAccessToken(
        { sub: 'usr_exp', email: 'exp@test.com' },
        testKeys.privateKey,
        { kid: testKeys.kid, expiresInSeconds: -10 } // already expired
      );

      await expect(verifyAccessToken(expiredToken, testKeys.publicKey)).rejects.toThrow('TOKEN_EXPIRED');
    });

    it('SECURITY: rejects tokens with invalid or tampered signature', async () => {
      const token = signAccessToken(
        { sub: 'usr_valid', email: 'valid@test.com' },
        testKeys.privateKey,
        { kid: testKeys.kid }
      );

      // Corrupt the signature portion
      const parts = token.split('.');
      const tamperedSignature = parts[2].substring(0, parts[2].length - 4) + 'AAAA';
      const tamperedToken = `${parts[0]}.${parts[1]}.${tamperedSignature}`;

      await expect(verifyAccessToken(tamperedToken, testKeys.publicKey)).rejects.toThrow('INVALID_TOKEN');
    });

    it('SECURITY: rejects token if signed with an unmatching private key', async () => {
      const anotherKeypair = generateTestRsaKeyPair('another-kid');
      const forgedToken = signAccessToken(
        { sub: 'usr_forged', email: 'forged@test.com' },
        anotherKeypair.privateKey,
        { kid: testKeys.kid } // using legitimate kid header with wrong key
      );

      await expect(verifyAccessToken(forgedToken, testKeys.publicKey)).rejects.toThrow('INVALID_TOKEN');
    });

    it('SECURITY: rejects token with wrong audience', async () => {
      const jwt = (await import('jsonwebtoken')).default;
      const wrongAudToken = jwt.sign(
        {
          sub: 'usr_1',
          email: 'test@test.com',
          iss: JWT_CONFIG.ISSUER,
          aud: 'wrong-audience',
          token_use: JWT_CONFIG.TOKEN_USE,
          token_type: JWT_CONFIG.TOKEN_TYPE
        },
        testKeys.privateKey,
        {
          algorithm: 'RS256',
          keyid: testKeys.kid
        }
      );

      await expect(verifyAccessToken(wrongAudToken, testKeys.publicKey)).rejects.toThrow('INVALID_TOKEN');
    });

    it('SECURITY: rejects token with wrong issuer', async () => {
      const jwt = (await import('jsonwebtoken')).default;
      const wrongIssToken = jwt.sign(
        {
          sub: 'usr_1',
          email: 'test@test.com',
          iss: 'malicious-issuer',
          aud: JWT_CONFIG.AUDIENCE,
          token_use: JWT_CONFIG.TOKEN_USE,
          token_type: JWT_CONFIG.TOKEN_TYPE
        },
        testKeys.privateKey,
        {
          algorithm: 'RS256',
          keyid: testKeys.kid
        }
      );

      await expect(verifyAccessToken(wrongIssToken, testKeys.publicKey)).rejects.toThrow('INVALID_TOKEN');
    });

    it('SECURITY: rejects token with wrong token_use (e.g. refresh)', async () => {
      const jwt = (await import('jsonwebtoken')).default;
      const refreshToken = jwt.sign(
        {
          sub: 'usr_1',
          email: 'test@test.com',
          iss: JWT_CONFIG.ISSUER,
          aud: JWT_CONFIG.AUDIENCE,
          token_use: 'refresh', // NOT access
          token_type: JWT_CONFIG.TOKEN_TYPE,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 900
        },
        testKeys.privateKey,
        {
          algorithm: 'RS256',
          keyid: testKeys.kid
        }
      );

      await expect(verifyAccessToken(refreshToken, testKeys.publicKey)).rejects.toThrow('INVALID_TOKEN_USE');
    });

    it('SECURITY: rejects token with wrong token_type', async () => {
      const jwt = (await import('jsonwebtoken')).default;
      const adminToken = jwt.sign(
        {
          sub: 'usr_1',
          email: 'test@test.com',
          iss: JWT_CONFIG.ISSUER,
          aud: JWT_CONFIG.AUDIENCE,
          token_use: JWT_CONFIG.TOKEN_USE,
          token_type: 'platform_admin_access', // NOT merchant_access
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 900
        },
        testKeys.privateKey,
        {
          algorithm: 'RS256',
          keyid: testKeys.kid
        }
      );

      await expect(verifyAccessToken(adminToken, testKeys.publicKey)).rejects.toThrow('INVALID_TOKEN_TYPE');
    });
  });

  // =========================================================================
  // SECTION 4: Authentication Middleware Foundations
  // =========================================================================
  describe('Authentication Middleware Foundation', () => {
    let testKeys;
    let authMiddleware;

    beforeAll(() => {
      testKeys = generateTestRsaKeyPair('mw-test-kid-1');
      authMiddleware = createAuthMiddleware(testKeys.publicKey);
    });

    function mockHttp() {
      const req = {
        headers: {},
        body: {},
        query: {}
      };
      let statusCode = 200;
      let jsonBody = null;
      let nextCalled = false;

      const res = {
        status(code) {
          statusCode = code;
          return res;
        },
        json(data) {
          jsonBody = data;
          return res;
        }
      };

      const next = () => {
        nextCalled = true;
      };

      return { req, res, next, getStatus: () => statusCode, getBody: () => jsonBody, isNextCalled: () => nextCalled };
    }

    it('authenticates valid Bearer token and attaches frozen req.user', async () => {
      const token = signAccessToken(
        { sub: 'usr_mw_1', email: 'mw@test.com', defaultBusinessId: 'biz_mw_99' },
        testKeys.privateKey,
        { kid: testKeys.kid }
      );

      const { req, res, next, isNextCalled } = mockHttp();
      req.headers['authorization'] = `Bearer ${token}`;

      await authMiddleware(req, res, next);

      expect(isNextCalled()).toBe(true);
      expect(req.user).toBeDefined();
      expect(req.user.id).toBe('usr_mw_1');
      expect(req.user.email).toBe('mw@test.com');
      expect(req.user.defaultBusinessId).toBe('biz_mw_99');
      expect(req.user.tokenUse).toBe('access');
      expect(req.user.tokenType).toBe('merchant_access');
      expect(Object.isFrozen(req.user)).toBe(true);
    });

    it('SECURITY: completely ignores and prevents req.body and req.query tampering from polluting identity', async () => {
      const token = signAccessToken(
        { sub: 'legitimate_usr', email: 'legit@test.com', defaultBusinessId: 'biz_legit' },
        testKeys.privateKey,
        { kid: testKeys.kid }
      );

      const { req, res, next } = mockHttp();
      req.headers['authorization'] = `Bearer ${token}`;

      // Attacker attempts parameter pollution in body and query
      req.body = { id: 'spoofed_admin_id', role: 'owner', businessId: 'spoofed_biz' };
      req.query = { userId: 'spoofed_user_in_query', defaultBusinessId: 'spoofed_biz_query' };

      await authMiddleware(req, res, next);

      // req.user must reflect ONLY verified JWT claims
      expect(req.user.id).toBe('legitimate_usr');
      expect(req.user.email).toBe('legit@test.com');
      expect(req.user.defaultBusinessId).toBe('biz_legit');
      expect(req.user.role).toBeUndefined(); // Role is not evaluated or set in Stage 4.1A
    });

    it('rejects missing Authorization header with 401 UNAUTHORIZED', async () => {
      const { req, res, next, getStatus, getBody, isNextCalled } = mockHttp();

      await authMiddleware(req, res, next);

      expect(isNextCalled()).toBe(false);
      expect(getStatus()).toBe(401);
      expect(getBody().error).toBe('UNAUTHORIZED');
    });

    it('rejects non-Bearer authorization scheme with 401 UNAUTHORIZED', async () => {
      const { req, res, next, getStatus, getBody, isNextCalled } = mockHttp();
      req.headers['authorization'] = 'Basic dXNlcjpwYXNz';

      await authMiddleware(req, res, next);

      expect(isNextCalled()).toBe(false);
      expect(getStatus()).toBe(401);
      expect(getBody().error).toBe('UNAUTHORIZED');
      expect(getBody().message).toContain('Bearer');
    });

    it('rejects empty Bearer token with 401 UNAUTHORIZED', async () => {
      const { req, res, next, getStatus, getBody, isNextCalled } = mockHttp();
      req.headers['authorization'] = 'Bearer ';

      await authMiddleware(req, res, next);

      expect(isNextCalled()).toBe(false);
      expect(getStatus()).toBe(401);
      expect(getBody().error).toBe('UNAUTHORIZED');
    });

    it('rejects expired access token with 401 TOKEN_EXPIRED', async () => {
      const expiredToken = signAccessToken(
        { sub: 'usr_mw_exp', email: 'exp@test.com' },
        testKeys.privateKey,
        { kid: testKeys.kid, expiresInSeconds: -5 }
      );

      const { req, res, next, getStatus, getBody, isNextCalled } = mockHttp();
      req.headers['authorization'] = `Bearer ${expiredToken}`;

      await authMiddleware(req, res, next);

      expect(isNextCalled()).toBe(false);
      expect(getStatus()).toBe(401);
      expect(getBody().error).toBe('TOKEN_EXPIRED');
    });

    it('rejects invalid or tampered access token with 401', async () => {
      const { req, res, next, getStatus, getBody, isNextCalled } = mockHttp();
      req.headers['authorization'] = 'Bearer eyJhbGciOiJSUzI1NiJ9.tampered.token';

      await authMiddleware(req, res, next);

      expect(isNextCalled()).toBe(false);
      expect(getStatus()).toBe(401);
    });
  });
});
