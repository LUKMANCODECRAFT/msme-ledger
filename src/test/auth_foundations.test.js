import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import express from 'express';

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

    it('declares case-insensitive collation { locale: "en", strength: 2 } on User email index metadata', () => {
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

    it('simulates application-level case-insensitive uniqueness collision (unit simulation, not a live MongoDB integration test)', () => {
      // NOTE: This is a unit-level simulation of strength 2 collation collision logic.
      // Live database index enforcement against MongoDB requires an active, isolated mongod instance
      // and is explicitly marked as NOT yet integration-tested in local CI without Docker/MongoDB daemon.
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
  // SECTION 3: RS256 Access Token Infrastructure & Key-ID Enforcement
  // =========================================================================
  describe('RS256 Access-Token Infrastructure & Key-ID Enforcement', () => {
    let testKeys;
    let rotationKeys;

    beforeAll(() => {
      testKeys = generateTestRsaKeyPair('sb-auth-key-2026');
      rotationKeys = generateTestRsaKeyPair('sb-auth-key-2027');
    });

    it('generates ephemeral RSA 2048-bit key pairs with valid PEM formatting', () => {
      expect(testKeys.publicKey).toContain('-----BEGIN PUBLIC KEY-----');
      expect(testKeys.privateKey).toContain('-----BEGIN PRIVATE KEY-----');
      expect(testKeys.kid).toBe('sb-auth-key-2026');
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

      const payload = await verifyAccessToken(token, {
        [testKeys.kid]: testKeys.publicKey
      });

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

    it('rejects signing when kid is missing from options and environment', () => {
      const originalEnv = process.env.JWT_KEY_ID;
      delete process.env.JWT_KEY_ID;
      try {
        expect(() => {
          signAccessToken(
            { sub: 'usr_1', email: 'test@example.com' },
            testKeys.privateKey
          );
        }).toThrow('MISSING_KEY_ID');
      } finally {
        if (originalEnv) process.env.JWT_KEY_ID = originalEnv;
      }
    });

    // -----------------------------------------------------------------------
    // Key-ID Enforcement Negative Tests (Requirement 1)
    // -----------------------------------------------------------------------
    it('KEY-ID: rejects token with unknown kid against key map', async () => {
      const token = signAccessToken(
        { sub: 'usr_1', email: 'test@example.com' },
        testKeys.privateKey,
        { kid: 'completely-unknown-kid' }
      );

      const keyMap = { [testKeys.kid]: testKeys.publicKey };
      await expect(verifyAccessToken(token, keyMap)).rejects.toThrow('UNKNOWN_KEY_ID');
    });

    it('KEY-ID: rejects token with mismatched kid against static public key with expectedKid', async () => {
      const token = signAccessToken(
        { sub: 'usr_1', email: 'test@example.com' },
        testKeys.privateKey,
        { kid: 'unmatched-kid' }
      );

      // Configuration specifies expectedKid: testKeys.kid
      await expect(
        verifyAccessToken(token, {
          publicKey: testKeys.publicKey,
          expectedKid: testKeys.kid
        })
      ).rejects.toThrow('MISMATCHED_KEY_ID');
    });

    it('KEY-ID: rejects static public key string if no expectedKid is configured', async () => {
      const token = signAccessToken(
        { sub: 'usr_1', email: 'test@example.com' },
        testKeys.privateKey,
        { kid: testKeys.kid }
      );

      const originalEnv = process.env.JWT_KEY_ID;
      delete process.env.JWT_KEY_ID;
      try {
        // Passing raw PEM string without expectedKid option
        await expect(verifyAccessToken(token, testKeys.publicKey)).rejects.toThrow('STATIC_KEY_MISSING_EXPECTED_KID');
      } finally {
        if (originalEnv) process.env.JWT_KEY_ID = originalEnv;
      }
    });

    it('KEY-ID: rejects token with correct signature but incorrect key ID header', async () => {
      // Attacker signs with testKeys.privateKey, but alters kid header to rotationKeys.kid
      const jwt = (await import('jsonwebtoken')).default;
      const forgedHeaderToken = jwt.sign(
        {
          sub: 'usr_1',
          email: 'test@example.com',
          defaultBusinessId: null,
          iss: JWT_CONFIG.ISSUER,
          aud: JWT_CONFIG.AUDIENCE,
          token_use: JWT_CONFIG.TOKEN_USE,
          token_type: JWT_CONFIG.TOKEN_TYPE,
          jti: crypto.randomUUID(),
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 900
        },
        testKeys.privateKey,
        {
          algorithm: 'RS256',
          keyid: rotationKeys.kid // INCORRECT kid header
        }
      );

      // Verifier has both keys in map
      const multiKeyMap = {
        [testKeys.kid]: testKeys.publicKey,
        [rotationKeys.kid]: rotationKeys.publicKey
      };

      // Since header says rotationKeys.kid, resolver will load rotationKeys.publicKey,
      // and signature verification MUST fail because signature was made with testKeys.privateKey!
      await expect(verifyAccessToken(forgedHeaderToken, multiKeyMap)).rejects.toThrow('INVALID_TOKEN');
    });

    it('KEY-ID: verifies valid key ID and valid signature successfully', async () => {
      const token = signAccessToken(
        { sub: 'usr_valid_kid', email: 'valid@example.com' },
        testKeys.privateKey,
        { kid: testKeys.kid }
      );

      const verified = await verifyAccessToken(token, {
        [testKeys.kid]: testKeys.publicKey
      });
      expect(verified.sub).toBe('usr_valid_kid');
    });

    it('KEY-ID: supports key rotation with two distinct key IDs and public keys', async () => {
      const keyMap = {
        [testKeys.kid]: testKeys.publicKey,
        [rotationKeys.kid]: rotationKeys.publicKey
      };

      // Token 1: signed with 2026 key
      const token2026 = signAccessToken(
        { sub: 'usr_2026', email: 'user2026@example.com' },
        testKeys.privateKey,
        { kid: testKeys.kid }
      );

      // Token 2: signed with 2027 key
      const token2027 = signAccessToken(
        { sub: 'usr_2027', email: 'user2027@example.com' },
        rotationKeys.privateKey,
        { kid: rotationKeys.kid }
      );

      const payload2026 = await verifyAccessToken(token2026, keyMap);
      const payload2027 = await verifyAccessToken(token2027, keyMap);

      expect(payload2026.sub).toBe('usr_2026');
      expect(payload2027.sub).toBe('usr_2027');
    });

    // -----------------------------------------------------------------------
    // Complete JWT Claim Validation Negative Tests (Requirement 2)
    // -----------------------------------------------------------------------
    it('CLAIMS: rejects token missing sub claim or having empty sub', async () => {
      const jwt = (await import('jsonwebtoken')).default;
      const basePayload = {
        email: 'test@example.com',
        defaultBusinessId: null,
        iss: JWT_CONFIG.ISSUER,
        aud: JWT_CONFIG.AUDIENCE,
        token_use: JWT_CONFIG.TOKEN_USE,
        token_type: JWT_CONFIG.TOKEN_TYPE,
        jti: crypto.randomUUID(),
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900
      };

      // Missing sub
      const tokenNoSub = jwt.sign(basePayload, testKeys.privateKey, { algorithm: 'RS256', keyid: testKeys.kid });
      await expect(verifyAccessToken(tokenNoSub, { [testKeys.kid]: testKeys.publicKey })).rejects.toThrow('INVALID_TOKEN_SUBJECT');

      // Empty sub
      const tokenEmptySub = jwt.sign({ ...basePayload, sub: '   ' }, testKeys.privateKey, { algorithm: 'RS256', keyid: testKeys.kid });
      await expect(verifyAccessToken(tokenEmptySub, { [testKeys.kid]: testKeys.publicKey })).rejects.toThrow('INVALID_TOKEN_SUBJECT');
    });

    it('CLAIMS: enforces valid RFC 4122 UUIDv4 for jti, rejecting missing, empty, malformed, and non-v4 values', async () => {
      const jwt = (await import('jsonwebtoken')).default;
      const basePayload = {
        sub: 'usr_1',
        email: 'test@example.com',
        defaultBusinessId: null,
        iss: JWT_CONFIG.ISSUER,
        aud: JWT_CONFIG.AUDIENCE,
        token_use: JWT_CONFIG.TOKEN_USE,
        token_type: JWT_CONFIG.TOKEN_TYPE,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900
      };

      const keyMap = { [testKeys.kid]: testKeys.publicKey };

      // Valid UUIDv4 passes
      const validV4 = 'c9bf9e57-1685-4c89-bafb-ff5af830be8a';
      const tokenValidV4 = jwt.sign({ ...basePayload, jti: validV4 }, testKeys.privateKey, { algorithm: 'RS256', keyid: testKeys.kid });
      const verified = await verifyAccessToken(tokenValidV4, keyMap);
      expect(verified.jti).toBe(validV4);

      // Missing jti
      const tokenNoJti = jwt.sign(basePayload, testKeys.privateKey, { algorithm: 'RS256', keyid: testKeys.kid });
      await expect(verifyAccessToken(tokenNoJti, keyMap)).rejects.toThrow('INVALID_TOKEN_JTI');

      // Empty jti
      const tokenEmptyJti = jwt.sign({ ...basePayload, jti: '' }, testKeys.privateKey, { algorithm: 'RS256', keyid: testKeys.kid });
      await expect(verifyAccessToken(tokenEmptyJti, keyMap)).rejects.toThrow('INVALID_TOKEN_JTI');

      // Arbitrary non-UUID string
      const tokenArbitrary = jwt.sign({ ...basePayload, jti: 'not-a-valid-uuid-identifier' }, testKeys.privateKey, { algorithm: 'RS256', keyid: testKeys.kid });
      await expect(verifyAccessToken(tokenArbitrary, keyMap)).rejects.toThrow('INVALID_TOKEN_JTI');

      // Non-UUID numeric string
      const tokenNumeric = jwt.sign({ ...basePayload, jti: '1234567890' }, testKeys.privateKey, { algorithm: 'RS256', keyid: testKeys.kid });
      await expect(verifyAccessToken(tokenNumeric, keyMap)).rejects.toThrow('INVALID_TOKEN_JTI');

      // UUID with invalid version (Version 1 instead of 4: 13th character is '1')
      const uuidV1 = 'c9bf9e57-1685-1c89-bafb-ff5af830be8a';
      const tokenV1 = jwt.sign({ ...basePayload, jti: uuidV1 }, testKeys.privateKey, { algorithm: 'RS256', keyid: testKeys.kid });
      await expect(verifyAccessToken(tokenV1, keyMap)).rejects.toThrow('INVALID_TOKEN_JTI');

      // UUID with invalid version (Version 5 instead of 4: 13th character is '5')
      const uuidV5 = 'c9bf9e57-1685-5c89-bafb-ff5af830be8a';
      const tokenV5 = jwt.sign({ ...basePayload, jti: uuidV5 }, testKeys.privateKey, { algorithm: 'RS256', keyid: testKeys.kid });
      await expect(verifyAccessToken(tokenV5, keyMap)).rejects.toThrow('INVALID_TOKEN_JTI');

      // UUID with invalid variant bits (17th character is '0', must be 8, 9, a, or b)
      const uuidInvalidVariant = 'c9bf9e57-1685-4c89-0afb-ff5af830be8a';
      const tokenInvalidVariant = jwt.sign({ ...basePayload, jti: uuidInvalidVariant }, testKeys.privateKey, { algorithm: 'RS256', keyid: testKeys.kid });
      await expect(verifyAccessToken(tokenInvalidVariant, keyMap)).rejects.toThrow('INVALID_TOKEN_JTI');

      // UUID with invalid variant bits (17th character is 'c')
      const uuidInvalidVariantC = 'c9bf9e57-1685-4c89-cafb-ff5af830be8a';
      const tokenInvalidVariantC = jwt.sign({ ...basePayload, jti: uuidInvalidVariantC }, testKeys.privateKey, { algorithm: 'RS256', keyid: testKeys.kid });
      await expect(verifyAccessToken(tokenInvalidVariantC, keyMap)).rejects.toThrow('INVALID_TOKEN_JTI');
    });

    it('CLAIMS: rejects token with invalid or unnormalized email', async () => {
      const jwt = (await import('jsonwebtoken')).default;
      const basePayload = {
        sub: 'usr_1',
        defaultBusinessId: null,
        iss: JWT_CONFIG.ISSUER,
        aud: JWT_CONFIG.AUDIENCE,
        token_use: JWT_CONFIG.TOKEN_USE,
        token_type: JWT_CONFIG.TOKEN_TYPE,
        jti: crypto.randomUUID(),
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900
      };

      // Missing email
      const tokenNoEmail = jwt.sign(basePayload, testKeys.privateKey, { algorithm: 'RS256', keyid: testKeys.kid });
      await expect(verifyAccessToken(tokenNoEmail, { [testKeys.kid]: testKeys.publicKey })).rejects.toThrow('INVALID_TOKEN_EMAIL');

      // Malformed email
      const tokenBadEmail = jwt.sign({ ...basePayload, email: 'notanemail' }, testKeys.privateKey, { algorithm: 'RS256', keyid: testKeys.kid });
      await expect(verifyAccessToken(tokenBadEmail, { [testKeys.kid]: testKeys.publicKey })).rejects.toThrow('INVALID_TOKEN_EMAIL');

      // Unnormalized email (uppercase characters present)
      const tokenUnnormalized = jwt.sign({ ...basePayload, email: 'User@Example.COM' }, testKeys.privateKey, { algorithm: 'RS256', keyid: testKeys.kid });
      await expect(verifyAccessToken(tokenUnnormalized, { [testKeys.kid]: testKeys.publicKey })).rejects.toThrow('INVALID_TOKEN_EMAIL');
    });

    it('CLAIMS: accepts null defaultBusinessId and non-empty string, rejects malformed values', async () => {
      const jwt = (await import('jsonwebtoken')).default;
      const makeToken = (bizId) => {
        const payload = {
          sub: 'usr_1',
          email: 'test@example.com',
          defaultBusinessId: bizId,
          iss: JWT_CONFIG.ISSUER,
          aud: JWT_CONFIG.AUDIENCE,
          token_use: JWT_CONFIG.TOKEN_USE,
          token_type: JWT_CONFIG.TOKEN_TYPE,
          jti: crypto.randomUUID(),
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 900
        };
        return jwt.sign(payload, testKeys.privateKey, { algorithm: 'RS256', keyid: testKeys.kid });
      };

      const keyMap = { [testKeys.kid]: testKeys.publicKey };

      // Null is valid
      const tokenNull = makeToken(null);
      const verifiedNull = await verifyAccessToken(tokenNull, keyMap);
      expect(verifiedNull.defaultBusinessId).toBeNull();

      // Non-empty string is valid
      const tokenValidStr = makeToken('biz_001');
      const verifiedStr = await verifyAccessToken(tokenValidStr, keyMap);
      expect(verifiedStr.defaultBusinessId).toBe('biz_001');

      // Empty string is rejected
      const tokenEmptyStr = makeToken('');
      await expect(verifyAccessToken(tokenEmptyStr, keyMap)).rejects.toThrow('INVALID_TOKEN_BUSINESS_ID');

      // Whitespace only is rejected
      const tokenWhitespace = makeToken('   ');
      await expect(verifyAccessToken(tokenWhitespace, keyMap)).rejects.toThrow('INVALID_TOKEN_BUSINESS_ID');

      // Number is rejected
      const tokenNumber = makeToken(12345);
      await expect(verifyAccessToken(tokenNumber, keyMap)).rejects.toThrow('INVALID_TOKEN_BUSINESS_ID');
    });

    it('CLAIMS: rejects non-integer Unix timestamps in iat or exp', async () => {
      const jwt = (await import('jsonwebtoken')).default;
      const basePayload = {
        sub: 'usr_1',
        email: 'test@example.com',
        defaultBusinessId: null,
        iss: JWT_CONFIG.ISSUER,
        aud: JWT_CONFIG.AUDIENCE,
        token_use: JWT_CONFIG.TOKEN_USE,
        token_type: JWT_CONFIG.TOKEN_TYPE,
        jti: crypto.randomUUID()
      };

      const keyMap = { [testKeys.kid]: testKeys.publicKey };

      const now = Math.floor(Date.now() / 1000);
      // Float iat
      const tokenFloatIat = jwt.sign({ ...basePayload, iat: now + 0.5, exp: now + 900 }, testKeys.privateKey, { algorithm: 'RS256', keyid: testKeys.kid });
      await expect(verifyAccessToken(tokenFloatIat, keyMap)).rejects.toThrow('INVALID_TOKEN_TIMESTAMPS');

      // Float exp
      const tokenFloatExp = jwt.sign({ ...basePayload, iat: now, exp: now + 900.8 }, testKeys.privateKey, { algorithm: 'RS256', keyid: testKeys.kid });
      await expect(verifyAccessToken(tokenFloatExp, keyMap)).rejects.toThrow('INVALID_TOKEN_TIMESTAMPS');
    });

    it('CLAIMS: rejects tokens where exp <= iat', async () => {
      const jwt = (await import('jsonwebtoken')).default;
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        sub: 'usr_1',
        email: 'test@example.com',
        defaultBusinessId: null,
        iss: JWT_CONFIG.ISSUER,
        aud: JWT_CONFIG.AUDIENCE,
        token_use: JWT_CONFIG.TOKEN_USE,
        token_type: JWT_CONFIG.TOKEN_TYPE,
        jti: crypto.randomUUID(),
        iat: now,
        exp: now // exp equals iat
      };

      const token = jwt.sign(payload, testKeys.privateKey, { algorithm: 'RS256', keyid: testKeys.kid });
      await expect(verifyAccessToken(token, { [testKeys.kid]: testKeys.publicKey })).rejects.toThrow('INVALID_TOKEN_EXPIRY');
    });

    it('CLAIMS: rejects future-issued tokens beyond clock tolerance', async () => {
      const now = Math.floor(Date.now() / 1000);
      const futureIat = now + 120; // 2 minutes into future (tolerance is 5s)

      const jwt = (await import('jsonwebtoken')).default;
      const payload = {
        sub: 'usr_1',
        email: 'test@example.com',
        defaultBusinessId: null,
        iss: JWT_CONFIG.ISSUER,
        aud: JWT_CONFIG.AUDIENCE,
        token_use: JWT_CONFIG.TOKEN_USE,
        token_type: JWT_CONFIG.TOKEN_TYPE,
        jti: crypto.randomUUID(),
        iat: futureIat,
        exp: futureIat + 900
      };

      const token = jwt.sign(payload, testKeys.privateKey, { algorithm: 'RS256', keyid: testKeys.kid });
      await expect(
        verifyAccessToken(token, { [testKeys.kid]: testKeys.publicKey }, { nowSeconds: now, clockToleranceSeconds: 5 })
      ).rejects.toThrow('TOKEN_ISSUED_IN_FUTURE');
    });

    it('CLAIMS: enforces default Blueprint 900-second access-token lifetime ceiling', async () => {
      const now = Math.floor(Date.now() / 1000);
      const jwt = (await import('jsonwebtoken')).default;
      const makeToken = (lifetime) => jwt.sign(
        {
          sub: 'usr_1',
          email: 'test@example.com',
          defaultBusinessId: null,
          iss: JWT_CONFIG.ISSUER,
          aud: JWT_CONFIG.AUDIENCE,
          token_use: JWT_CONFIG.TOKEN_USE,
          token_type: JWT_CONFIG.TOKEN_TYPE,
          jti: crypto.randomUUID(),
          iat: now,
          exp: now + lifetime
        },
        testKeys.privateKey,
        { algorithm: 'RS256', keyid: testKeys.kid }
      );

      const keyMap = { [testKeys.kid]: testKeys.publicKey };

      // Lifetime of exactly 900 seconds passes by default
      const token900 = makeToken(900);
      const verified900 = await verifyAccessToken(token900, keyMap);
      expect(verified900.sub).toBe('usr_1');

      // Lifetime of 901 seconds is rejected by default
      const token901 = makeToken(901);
      await expect(verifyAccessToken(token901, keyMap)).rejects.toThrow('TOKEN_LIFETIME_EXCEEDED');
    });

    it('CLAIMS: allows a lower configured maximum lifetime (e.g. 300 seconds)', async () => {
      const now = Math.floor(Date.now() / 1000);
      const jwt = (await import('jsonwebtoken')).default;
      const makeToken = (lifetime) => jwt.sign(
        {
          sub: 'usr_1',
          email: 'test@example.com',
          defaultBusinessId: null,
          iss: JWT_CONFIG.ISSUER,
          aud: JWT_CONFIG.AUDIENCE,
          token_use: JWT_CONFIG.TOKEN_USE,
          token_type: JWT_CONFIG.TOKEN_TYPE,
          jti: crypto.randomUUID(),
          iat: now,
          exp: now + lifetime
        },
        testKeys.privateKey,
        { algorithm: 'RS256', keyid: testKeys.kid }
      );

      const keyMap = { [testKeys.kid]: testKeys.publicKey };

      // Token with 300s lifetime passes under maxLifetimeSeconds: 300
      const token300 = makeToken(300);
      const verified300 = await verifyAccessToken(token300, keyMap, { maxLifetimeSeconds: 300 });
      expect(verified300.sub).toBe('usr_1');

      // Token with 301s lifetime is rejected under maxLifetimeSeconds: 300
      const token301 = makeToken(301);
      await expect(
        verifyAccessToken(token301, keyMap, { maxLifetimeSeconds: 300 })
      ).rejects.toThrow('TOKEN_LIFETIME_EXCEEDED');
    });

    it('CLAIMS: enforces absolute 900-second ceiling even if a higher maximum is configured (e.g. 1800s)', async () => {
      const now = Math.floor(Date.now() / 1000);
      const jwt = (await import('jsonwebtoken')).default;
      const makeToken = (lifetime) => jwt.sign(
        {
          sub: 'usr_1',
          email: 'test@example.com',
          defaultBusinessId: null,
          iss: JWT_CONFIG.ISSUER,
          aud: JWT_CONFIG.AUDIENCE,
          token_use: JWT_CONFIG.TOKEN_USE,
          token_type: JWT_CONFIG.TOKEN_TYPE,
          jti: crypto.randomUUID(),
          iat: now,
          exp: now + lifetime
        },
        testKeys.privateKey,
        { algorithm: 'RS256', keyid: testKeys.kid }
      );

      const keyMap = { [testKeys.kid]: testKeys.publicKey };

      // Caller attempts to configure 1800 seconds (30 mins), but token has 901s lifetime
      const token901 = makeToken(901);
      await expect(
        verifyAccessToken(token901, keyMap, { maxLifetimeSeconds: 1800 })
      ).rejects.toThrow('TOKEN_LIFETIME_EXCEEDED');

      // Caller attempts to configure 3600 seconds, token has 1200s lifetime
      const token1200 = makeToken(1200);
      await expect(
        verifyAccessToken(token1200, keyMap, { maxLifetimeSeconds: 3600 })
      ).rejects.toThrow('TOKEN_LIFETIME_EXCEEDED');
    });

    it('CLAIMS: safely falls back to 900-second ceiling when invalid maxLifetimeSeconds values are passed', async () => {
      const now = Math.floor(Date.now() / 1000);
      const jwt = (await import('jsonwebtoken')).default;
      const token901 = jwt.sign(
        {
          sub: 'usr_1',
          email: 'test@example.com',
          defaultBusinessId: null,
          iss: JWT_CONFIG.ISSUER,
          aud: JWT_CONFIG.AUDIENCE,
          token_use: JWT_CONFIG.TOKEN_USE,
          token_type: JWT_CONFIG.TOKEN_TYPE,
          jti: crypto.randomUUID(),
          iat: now,
          exp: now + 901
        },
        testKeys.privateKey,
        { algorithm: 'RS256', keyid: testKeys.kid }
      );

      const keyMap = { [testKeys.kid]: testKeys.publicKey };

      // Negative value
      await expect(verifyAccessToken(token901, keyMap, { maxLifetimeSeconds: -50 })).rejects.toThrow('TOKEN_LIFETIME_EXCEEDED');
      // Zero
      await expect(verifyAccessToken(token901, keyMap, { maxLifetimeSeconds: 0 })).rejects.toThrow('TOKEN_LIFETIME_EXCEEDED');
      // NaN
      await expect(verifyAccessToken(token901, keyMap, { maxLifetimeSeconds: NaN })).rejects.toThrow('TOKEN_LIFETIME_EXCEEDED');
      // Non-number string
      await expect(verifyAccessToken(token901, keyMap, { maxLifetimeSeconds: 'invalid' })).rejects.toThrow('TOKEN_LIFETIME_EXCEEDED');
      // Null
      await expect(verifyAccessToken(token901, keyMap, { maxLifetimeSeconds: null })).rejects.toThrow('TOKEN_LIFETIME_EXCEEDED');
    });

    // -----------------------------------------------------------------------
    // Core Security Invariants
    // -----------------------------------------------------------------------
    it('SECURITY: strictly rejects tokens signed with HS256 (algorithm substitution attack)', async () => {
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
        testKeys.publicKey,
        {
          algorithm: 'HS256',
          keyid: testKeys.kid
        }
      );

      await expect(
        verifyAccessToken(fakeHsToken, { [testKeys.kid]: testKeys.publicKey })
      ).rejects.toThrow('INVALID_ALGORITHM');
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

      await expect(
        verifyAccessToken(noneToken, { [testKeys.kid]: testKeys.publicKey })
      ).rejects.toThrow('INVALID_ALGORITHM');
    });

    it('HEADER: verifies token with valid typ: "JWT"', async () => {
      const token = signAccessToken(
        { sub: 'usr_typ_ok', email: 'typ@example.com' },
        testKeys.privateKey,
        { kid: testKeys.kid }
      );
      const verified = await verifyAccessToken(token, { [testKeys.kid]: testKeys.publicKey });
      expect(verified.sub).toBe('usr_typ_ok');
    });

    it('HEADER: strictly rejects tokens missing typ header before key resolution', async () => {
      // Craft a token whose header explicitly omits typ (alg and kid only)
      const headerB64 = Buffer.from(JSON.stringify({ alg: 'RS256', kid: testKeys.kid })).toString('base64url');
      const payloadB64 = Buffer.from(JSON.stringify({
        sub: 'usr_no_typ',
        email: 'no_typ@example.com',
        defaultBusinessId: null,
        iss: JWT_CONFIG.ISSUER,
        aud: JWT_CONFIG.AUDIENCE,
        token_use: JWT_CONFIG.TOKEN_USE,
        token_type: JWT_CONFIG.TOKEN_TYPE,
        jti: crypto.randomUUID(),
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900
      })).toString('base64url');

      const sigB64 = crypto.sign('RSA-SHA256', Buffer.from(`${headerB64}.${payloadB64}`), testKeys.privateKey).toString('base64url');
      const tokenWithoutTyp = `${headerB64}.${payloadB64}.${sigB64}`;

      // Rejection should occur even if resolver is empty or throws, because typ check executes before key resolution
      await expect(
        verifyAccessToken(tokenWithoutTyp, {})
      ).rejects.toThrow('INVALID_TOKEN_HEADER_TYPE');
    });

    it('HEADER: strictly rejects tokens with empty typ header', async () => {
      const jwt = (await import('jsonwebtoken')).default;
      const tokenEmptyTyp = jwt.sign(
        {
          sub: 'usr_empty_typ',
          email: 'empty_typ@example.com',
          defaultBusinessId: null,
          iss: JWT_CONFIG.ISSUER,
          aud: JWT_CONFIG.AUDIENCE,
          token_use: JWT_CONFIG.TOKEN_USE,
          token_type: JWT_CONFIG.TOKEN_TYPE,
          jti: crypto.randomUUID(),
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 900
        },
        testKeys.privateKey,
        {
          algorithm: 'RS256',
          header: { alg: 'RS256', typ: '', kid: testKeys.kid }
        }
      );

      await expect(
        verifyAccessToken(tokenEmptyTyp, { [testKeys.kid]: testKeys.publicKey })
      ).rejects.toThrow('INVALID_TOKEN_HEADER_TYPE');
    });

    it('HEADER: strictly rejects tokens with incorrect typ header (e.g. JOSE or lowercase jwt)', async () => {
      const jwt = (await import('jsonwebtoken')).default;
      const makeBadTypToken = (typVal) => jwt.sign(
        {
          sub: 'usr_bad_typ',
          email: 'bad_typ@example.com',
          defaultBusinessId: null,
          iss: JWT_CONFIG.ISSUER,
          aud: JWT_CONFIG.AUDIENCE,
          token_use: JWT_CONFIG.TOKEN_USE,
          token_type: JWT_CONFIG.TOKEN_TYPE,
          jti: crypto.randomUUID(),
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 900
        },
        testKeys.privateKey,
        {
          algorithm: 'RS256',
          header: { alg: 'RS256', typ: typVal, kid: testKeys.kid }
        }
      );

      await expect(
        verifyAccessToken(makeBadTypToken('JOSE'), { [testKeys.kid]: testKeys.publicKey })
      ).rejects.toThrow('INVALID_TOKEN_HEADER_TYPE');

      await expect(
        verifyAccessToken(makeBadTypToken('jwt'), { [testKeys.kid]: testKeys.publicKey })
      ).rejects.toThrow('INVALID_TOKEN_HEADER_TYPE');

      await expect(
        verifyAccessToken(makeBadTypToken('application/jwt'), { [testKeys.kid]: testKeys.publicKey })
      ).rejects.toThrow('INVALID_TOKEN_HEADER_TYPE');
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

      await expect(
        verifyAccessToken(tokenWithoutKid, { [testKeys.kid]: testKeys.publicKey })
      ).rejects.toThrow('MISSING_KID');
    });

    it('SECURITY: rejects expired access tokens with TOKEN_EXPIRED error code', async () => {
      const expiredToken = signAccessToken(
        { sub: 'usr_exp', email: 'exp@test.com' },
        testKeys.privateKey,
        { kid: testKeys.kid, expiresInSeconds: -10 }
      );

      await expect(
        verifyAccessToken(expiredToken, { [testKeys.kid]: testKeys.publicKey })
      ).rejects.toThrow('TOKEN_EXPIRED');
    });

    it('SECURITY: rejects tokens with invalid or tampered signature', async () => {
      const token = signAccessToken(
        { sub: 'usr_valid', email: 'valid@test.com' },
        testKeys.privateKey,
        { kid: testKeys.kid }
      );

      const parts = token.split('.');
      const tamperedSignature = parts[2].substring(0, parts[2].length - 4) + 'AAAA';
      const tamperedToken = `${parts[0]}.${parts[1]}.${tamperedSignature}`;

      await expect(
        verifyAccessToken(tamperedToken, { [testKeys.kid]: testKeys.publicKey })
      ).rejects.toThrow('INVALID_TOKEN');
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
          token_type: JWT_CONFIG.TOKEN_TYPE,
          jti: crypto.randomUUID(),
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 900
        },
        testKeys.privateKey,
        {
          algorithm: 'RS256',
          keyid: testKeys.kid
        }
      );

      await expect(
        verifyAccessToken(wrongAudToken, { [testKeys.kid]: testKeys.publicKey })
      ).rejects.toThrow('INVALID_TOKEN');
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
          token_type: JWT_CONFIG.TOKEN_TYPE,
          jti: crypto.randomUUID(),
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 900
        },
        testKeys.privateKey,
        {
          algorithm: 'RS256',
          keyid: testKeys.kid
        }
      );

      await expect(
        verifyAccessToken(wrongIssToken, { [testKeys.kid]: testKeys.publicKey })
      ).rejects.toThrow('INVALID_TOKEN');
    });

    it('SECURITY: rejects token with wrong token_use (e.g. refresh)', async () => {
      const jwt = (await import('jsonwebtoken')).default;
      const refreshToken = jwt.sign(
        {
          sub: 'usr_1',
          email: 'test@test.com',
          defaultBusinessId: null,
          iss: JWT_CONFIG.ISSUER,
          aud: JWT_CONFIG.AUDIENCE,
          token_use: 'refresh',
          token_type: JWT_CONFIG.TOKEN_TYPE,
          jti: crypto.randomUUID(),
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 900
        },
        testKeys.privateKey,
        {
          algorithm: 'RS256',
          keyid: testKeys.kid
        }
      );

      await expect(
        verifyAccessToken(refreshToken, { [testKeys.kid]: testKeys.publicKey })
      ).rejects.toThrow('INVALID_TOKEN_USE');
    });

    it('SECURITY: rejects token with wrong token_type', async () => {
      const jwt = (await import('jsonwebtoken')).default;
      const adminToken = jwt.sign(
        {
          sub: 'usr_1',
          email: 'test@test.com',
          defaultBusinessId: null,
          iss: JWT_CONFIG.ISSUER,
          aud: JWT_CONFIG.AUDIENCE,
          token_use: JWT_CONFIG.TOKEN_USE,
          token_type: 'platform_admin_access',
          jti: crypto.randomUUID(),
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 900
        },
        testKeys.privateKey,
        {
          algorithm: 'RS256',
          keyid: testKeys.kid
        }
      );

      await expect(
        verifyAccessToken(adminToken, { [testKeys.kid]: testKeys.publicKey })
      ).rejects.toThrow('INVALID_TOKEN_TYPE');
    });
  });

  // =========================================================================
  // SECTION 4: Authentication Middleware Foundations (Unit Mock Tests)
  // =========================================================================
  describe('Authentication Middleware Foundation (Unit Mock Tests)', () => {
    let testKeys;
    let authMiddleware;

    beforeAll(() => {
      testKeys = generateTestRsaKeyPair('mw-test-kid-1');
      authMiddleware = createAuthMiddleware({ [testKeys.kid]: testKeys.publicKey });
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

  // =========================================================================
  // SECTION 5: Express Middleware Live HTTP Integration Test (Requirement 5)
  // =========================================================================
  describe('Express Middleware Live HTTP Integration Test', () => {
    let testKeys;
    let expressServer;
    let baseUrl;

    beforeAll(async () => {
      testKeys = generateTestRsaKeyPair('express-mw-test-kid-1');
      const app = express();
      app.use(express.json());
      app.use(express.urlencoded({ extended: true }));

      const authMiddleware = createAuthMiddleware({ [testKeys.kid]: testKeys.publicKey });

      // Mount protected test routes (does not add production auth routes)
      app.get('/api/v2/test/protected', authMiddleware, (req, res) => {
        res.status(200).json({ success: true, user: req.user });
      });

      app.post('/api/v2/test/protected', authMiddleware, (req, res) => {
        res.status(200).json({ success: true, user: req.user, bodyEcho: req.body, queryEcho: req.query });
      });

      // Start on ephemeral port
      await new Promise((resolve) => {
        expressServer = app.listen(0, '127.0.0.1', () => {
          const port = expressServer.address().port;
          baseUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      });
    });

    afterAll(async () => {
      if (expressServer) {
        await new Promise((resolve) => expressServer.close(resolve));
      }
    });

    it('INTEGRATION: valid token reaches protected endpoint over HTTP with 200 OK', async () => {
      const token = signAccessToken(
        { sub: 'usr_express_1', email: 'merchant@domain.ng', defaultBusinessId: 'biz_exp_9' },
        testKeys.privateKey,
        { kid: testKeys.kid }
      );

      const res = await fetch(`${baseUrl}/api/v2/test/protected`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.user.id).toBe('usr_express_1');
      expect(data.user.email).toBe('merchant@domain.ng');
      expect(data.user.defaultBusinessId).toBe('biz_exp_9');
      expect(data.user.tokenUse).toBe('access');
      expect(data.user.tokenType).toBe('merchant_access');
    });

    it('INTEGRATION: missing token returns HTTP 401 UNAUTHORIZED', async () => {
      const res = await fetch(`${baseUrl}/api/v2/test/protected`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('UNAUTHORIZED');
    });

    it('INTEGRATION: expired token returns HTTP 401 TOKEN_EXPIRED', async () => {
      const expiredToken = signAccessToken(
        { sub: 'usr_exp_http', email: 'exp@test.com' },
        testKeys.privateKey,
        { kid: testKeys.kid, expiresInSeconds: -10 }
      );

      const res = await fetch(`${baseUrl}/api/v2/test/protected`, {
        headers: {
          'Authorization': `Bearer ${expiredToken}`
        }
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('TOKEN_EXPIRED');
    });

    it('INTEGRATION: invalid signature returns HTTP 401 INVALID_TOKEN', async () => {
      const token = signAccessToken(
        { sub: 'usr_valid_sig', email: 'valid@test.com' },
        testKeys.privateKey,
        { kid: testKeys.kid }
      );

      const parts = token.split('.');
      const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -6)}ZZZZZZ`;

      const res = await fetch(`${baseUrl}/api/v2/test/protected`, {
        headers: {
          'Authorization': `Bearer ${tampered}`
        }
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('INVALID_TOKEN');
    });

    it('INTEGRATION: wrong token type returns HTTP 401 INVALID_TOKEN_TYPE', async () => {
      const jwt = (await import('jsonwebtoken')).default;
      const wrongTypeToken = jwt.sign(
        {
          sub: 'usr_wrong_type',
          email: 'wrong@test.com',
          defaultBusinessId: null,
          iss: JWT_CONFIG.ISSUER,
          aud: JWT_CONFIG.AUDIENCE,
          token_use: JWT_CONFIG.TOKEN_USE,
          token_type: 'platform_admin_access', // NOT merchant_access
          jti: crypto.randomUUID(),
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 900
        },
        testKeys.privateKey,
        {
          algorithm: 'RS256',
          keyid: testKeys.kid
        }
      );

      const res = await fetch(`${baseUrl}/api/v2/test/protected`, {
        headers: {
          'Authorization': `Bearer ${wrongTypeToken}`
        }
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('INVALID_TOKEN_TYPE');
    });

    it('INTEGRATION: unknown key ID returns HTTP 401 UNKNOWN_KEY_ID', async () => {
      const tokenWithUnknownKid = signAccessToken(
        { sub: 'usr_unknown_kid', email: 'unknown@test.com' },
        testKeys.privateKey,
        { kid: 'unregistered-key-id-999' }
      );

      const res = await fetch(`${baseUrl}/api/v2/test/protected`, {
        headers: {
          'Authorization': `Bearer ${tokenWithUnknownKid}`
        }
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('UNKNOWN_KEY_ID');
    });

    it('INTEGRATION: request-body and query-string identity manipulation cannot alter authenticated identity', async () => {
      const token = signAccessToken(
        { sub: 'real_merchant_user', email: 'real@merchant.ng', defaultBusinessId: 'biz_real_1' },
        testKeys.privateKey,
        { kid: testKeys.kid }
      );

      // Attacker attempts to spoof user ID, role, and business ID in both query string and JSON body
      const res = await fetch(`${baseUrl}/api/v2/test/protected?userId=spoofed_query_user&defaultBusinessId=spoofed_query_biz`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          id: 'spoofed_admin_id',
          userId: 'spoofed_body_user',
          role: 'super_admin',
          defaultBusinessId: 'spoofed_body_biz'
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      // Protected endpoint received req.user strictly reflecting verified token claims
      expect(data.user.id).toBe('real_merchant_user');
      expect(data.user.email).toBe('real@merchant.ng');
      expect(data.user.defaultBusinessId).toBe('biz_real_1');
      expect(data.user.role).toBeUndefined(); // Role is never populated or trusted from body/query
    });
  });
});
