/**
 * RS256 JWT Token Service
 * Strictly conforms to SB Manager Rebuild Blueprint v2.1 Section 14 and Phase 4 Architecture Plan Section 4.2.
 * 
 * Cryptographic & Token Specifications:
 * - Algorithm: RS256 exclusively (asymmetric RSA with SHA-256)
 * - Required Header: { alg: 'RS256', typ: 'JWT', kid: string }
 * - Mandatory Claims:
 *   - iss: 'sb-manager-auth'
 *   - aud: 'sb-manager-client'
 *   - sub: string (user ID)
 *   - iat: integer Unix seconds
 *   - exp: integer Unix seconds (lifetime: 900 seconds / 15 minutes)
 *   - jti: string (UUIDv4)
 *   - token_use: 'access'
 *   - token_type: 'merchant_access'
 *   - email: string (normalized lowercase email)
 *   - defaultBusinessId: string or null
 * 
 * Security Invariants:
 * - Rejects any token signed with HS256, none, or any non-RS256 algorithm.
 * - Rejects any token without a valid kid header.
 * - Rejects expired tokens, tokens with wrong issuer/audience, or invalid token types.
 * - Server private key is strictly isolated; verification only requires public key.
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export const JWT_CONFIG = Object.freeze({
  ALGORITHM: 'RS256',
  ISSUER: 'sb-manager-auth',
  AUDIENCE: 'sb-manager-client',
  DEFAULT_ACCESS_TOKEN_TTL_SECONDS: 900, // 15 minutes
  DEFAULT_KID: 'sb-auth-2026-v1',
  TOKEN_USE: 'access',
  TOKEN_TYPE: 'merchant_access'
});

/**
 * Generates an ephemeral RSA 2048-bit key pair for testing or isolated environments.
 * Ensures zero production private keys or secrets are stored in repository files.
 * 
 * @param {string} [kid='test-auth-key-1'] - Optional key identifier
 * @returns {{ privateKey: string, publicKey: string, kid: string }}
 */
export function generateTestRsaKeyPair(kid = 'test-auth-key-1') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });

  return { privateKey, publicKey, kid };
}

/**
 * Signs an RS256 access token.
 * 
 * @param {Object} params
 * @param {string} params.sub - User identifier (required)
 * @param {string} params.email - Normalized email (required)
 * @param {string|null} [params.defaultBusinessId=null] - Optional default business id
 * @param {string} privateKeyPem - RSA private key in PEM format (server-side only)
 * @param {Object} [options]
 * @param {string} [options.kid] - Key ID header (defaults to JWT_CONFIG.DEFAULT_KID)
 * @param {number} [options.expiresInSeconds] - Token lifetime in seconds (defaults to 900)
 * @returns {string} - Signed JWT string
 */
export function signAccessToken(params, privateKeyPem, options = {}) {
  if (!params || typeof params !== 'object') {
    throw new TypeError('JWT params must be an object.');
  }

  const { sub, email, defaultBusinessId = null } = params;

  if (!sub || typeof sub !== 'string') {
    throw new Error('INVALID_TOKEN_SUBJECT: sub is required and must be a non-empty string.');
  }

  if (!email || typeof email !== 'string') {
    throw new Error('INVALID_TOKEN_EMAIL: email is required and must be a non-empty string.');
  }

  if (!privateKeyPem || typeof privateKeyPem !== 'string') {
    throw new TypeError('privateKeyPem must be a valid PEM-encoded private key string.');
  }

  const kid = options.kid || JWT_CONFIG.DEFAULT_KID;
  const ttlSeconds = typeof options.expiresInSeconds === 'number'
    ? Math.floor(options.expiresInSeconds)
    : JWT_CONFIG.DEFAULT_ACCESS_TOKEN_TTL_SECONDS;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expSeconds = nowSeconds + ttlSeconds;
  const jti = crypto.randomUUID();

  const payload = {
    iss: JWT_CONFIG.ISSUER,
    aud: JWT_CONFIG.AUDIENCE,
    sub,
    email: email.trim().toLowerCase(),
    defaultBusinessId: defaultBusinessId || null,
    token_use: JWT_CONFIG.TOKEN_USE,
    token_type: JWT_CONFIG.TOKEN_TYPE,
    jti,
    iat: nowSeconds,
    exp: expSeconds
  };

  return jwt.sign(payload, privateKeyPem, {
    algorithm: JWT_CONFIG.ALGORITHM,
    keyid: kid,
    header: {
      alg: JWT_CONFIG.ALGORITHM,
      typ: 'JWT',
      kid
    }
  });
}

/**
 * Resolves a public key given a key resolver and a kid.
 * 
 * @param {string|Function|Object} publicKeyResolver - Public key PEM string, resolver function, or kid-key map
 * @param {string} kid - Key ID from token header
 * @returns {Promise<string>} - Resolves to public key PEM string
 */
async function resolvePublicKey(publicKeyResolver, kid) {
  if (typeof publicKeyResolver === 'string') {
    return publicKeyResolver;
  }

  if (typeof publicKeyResolver === 'function') {
    const key = await publicKeyResolver(kid);
    if (!key) {
      throw new Error(`UNKNOWN_KEY_ID: Public key resolver returned null/undefined for kid '${kid}'`);
    }
    return key;
  }

  if (publicKeyResolver && typeof publicKeyResolver === 'object') {
    const key = publicKeyResolver[kid];
    if (!key) {
      throw new Error(`UNKNOWN_KEY_ID: No public key registered for kid '${kid}'`);
    }
    return key;
  }

  throw new TypeError('publicKeyResolver must be a PEM string, a resolver function, or an object mapping kid to PEM.');
}

/**
 * Verifies an RS256 access token.
 * 
 * @param {string} token - Raw JWT string
 * @param {string|Function|Object} publicKeyResolver - Public key PEM, resolver function (kid => pem), or map
 * @param {Object} [options]
 * @param {string} [options.expectedAudience] - Expected audience (defaults to JWT_CONFIG.AUDIENCE)
 * @param {string} [options.expectedIssuer] - Expected issuer (defaults to JWT_CONFIG.ISSUER)
 * @returns {Promise<Object>} - Verified token payload
 */
export async function verifyAccessToken(token, publicKeyResolver, options = {}) {
  if (!token || typeof token !== 'string') {
    const err = new Error('INVALID_TOKEN: Token must be a non-empty string.');
    err.code = 'INVALID_TOKEN';
    throw err;
  }

  // Step 1: Decode header without verifying to inspect alg and kid
  const decodedComplete = jwt.decode(token, { complete: true });
  if (!decodedComplete || !decodedComplete.header) {
    const err = new Error('MALFORMED_TOKEN: Unable to parse JWT header.');
    err.code = 'MALFORMED_TOKEN';
    throw err;
  }

  const { header } = decodedComplete;

  // Step 2: Strict algorithm enforcement - reject HS256, none, or any non-RS256 algorithm
  if (header.alg !== JWT_CONFIG.ALGORITHM) {
    const err = new Error(`INVALID_ALGORITHM: Algorithm '${header.alg}' is not permitted. Only RS256 is accepted.`);
    err.code = 'INVALID_ALGORITHM';
    throw err;
  }

  // Step 3: Mandatory Key ID (kid) enforcement
  if (!header.kid || typeof header.kid !== 'string' || !header.kid.trim()) {
    const err = new Error('MISSING_KID: Token header must contain a valid non-empty kid.');
    err.code = 'MISSING_KID';
    throw err;
  }

  // Step 4: Resolve public key
  const publicKeyPem = await resolvePublicKey(publicKeyResolver, header.kid);

  // Step 5: Cryptographic signature and claim verification
  const expectedAudience = options.expectedAudience || JWT_CONFIG.AUDIENCE;
  const expectedIssuer = options.expectedIssuer || JWT_CONFIG.ISSUER;

  let payload;
  try {
    payload = jwt.verify(token, publicKeyPem, {
      algorithms: [JWT_CONFIG.ALGORITHM],
      issuer: expectedIssuer,
      audience: expectedAudience
    });
  } catch (jwtErr) {
    if (jwtErr.name === 'TokenExpiredError') {
      const err = new Error(`TOKEN_EXPIRED: Access token expired at ${jwtErr.expiredAt}.`);
      err.code = 'TOKEN_EXPIRED';
      err.expiredAt = jwtErr.expiredAt;
      throw err;
    }
    if (jwtErr.name === 'JsonWebTokenError') {
      const err = new Error(`INVALID_TOKEN: ${jwtErr.message}`);
      err.code = 'INVALID_TOKEN';
      throw err;
    }
    throw jwtErr;
  }

  // Step 6: Validate mandatory token_use and token_type claims
  if (payload.token_use !== JWT_CONFIG.TOKEN_USE) {
    const err = new Error(`INVALID_TOKEN_USE: Expected '${JWT_CONFIG.TOKEN_USE}', received '${payload.token_use}'.`);
    err.code = 'INVALID_TOKEN_USE';
    throw err;
  }

  if (payload.token_type !== JWT_CONFIG.TOKEN_TYPE) {
    const err = new Error(`INVALID_TOKEN_TYPE: Expected '${JWT_CONFIG.TOKEN_TYPE}', received '${payload.token_type}'.`);
    err.code = 'INVALID_TOKEN_TYPE';
    throw err;
  }

  // Step 7: Validate integer Unix timestamps
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) {
    const err = new Error('INVALID_TOKEN_TIMESTAMPS: iat and exp claims must be integer Unix seconds.');
    err.code = 'INVALID_TOKEN_TIMESTAMPS';
    throw err;
  }

  return payload;
}
