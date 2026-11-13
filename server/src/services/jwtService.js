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
 *   - sub: string (non-empty user ID)
 *   - iat: integer Unix seconds
 *   - exp: integer Unix seconds (strictly > iat; lifetime <= 900 seconds / 15 minutes)
 *   - jti: string (non-empty unique identifier, UUIDv4)
 *   - token_use: 'access'
 *   - token_type: 'merchant_access'
 *   - email: string (valid, normalized lowercase email)
 *   - defaultBusinessId: string (non-empty) or null
 * 
 * Security Invariants:
 * - Rejects any token signed with HS256, none, or any non-RS256 algorithm.
 * - Key-ID enforcement: A token's kid must strictly identify the exact public key.
 * - Static public-key configurations require an explicit expectedKid.
 * - Unknown or mismatched kid values are strictly rejected.
 * - Never accepts an arbitrary kid merely because a supplied public key verifies the signature.
 * - All mandatory claims are explicitly validated even if cryptographic signature is valid.
 * - Future-issued tokens beyond clock tolerance (5s) are rejected.
 * - Access-token lifetime cannot exceed 900 seconds.
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { normalizeEmail, isValidEmail } from '../utils/emailNormalization.js';

export const JWT_CONFIG = Object.freeze({
  ALGORITHM: 'RS256',
  ISSUER: 'sb-manager-auth',
  AUDIENCE: 'sb-manager-client',
  MAX_ACCESS_TOKEN_TTL_SECONDS: 900, // 15 minutes
  DEFAULT_CLOCK_TOLERANCE_SECONDS: 5,
  TOKEN_USE: 'access',
  TOKEN_TYPE: 'merchant_access'
});

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
 * Requires an explicitly configured key ID (via options.kid or process.env.JWT_KEY_ID).
 * 
 * @param {Object} params
 * @param {string} params.sub - User identifier (required, non-empty string)
 * @param {string} params.email - Normalized email (required)
 * @param {string|null} [params.defaultBusinessId=null] - Optional default business id (non-empty string or null)
 * @param {string} privateKeyPem - RSA private key in PEM format (server-side only)
 * @param {Object} [options]
 * @param {string} [options.kid] - Key ID header (falls back to process.env.JWT_KEY_ID)
 * @param {number} [options.expiresInSeconds] - Token lifetime in seconds (defaults to 900)
 * @param {number} [options.nowSeconds] - Optional override for current timestamp (for testing)
 * @returns {string} - Signed JWT string
 */
export function signAccessToken(params, privateKeyPem, options = {}) {
  if (!params || typeof params !== 'object') {
    throw new TypeError('JWT params must be an object.');
  }

  const { sub, email, defaultBusinessId = null } = params;

  if (!sub || typeof sub !== 'string' || !sub.trim()) {
    throw new Error('INVALID_TOKEN_SUBJECT: sub is required and must be a non-empty string.');
  }

  if (!email || typeof email !== 'string' || !isValidEmail(email)) {
    throw new Error('INVALID_TOKEN_EMAIL: email is required and must be a valid email address.');
  }

  if (defaultBusinessId !== null && (typeof defaultBusinessId !== 'string' || !defaultBusinessId.trim())) {
    throw new Error('INVALID_TOKEN_BUSINESS_ID: defaultBusinessId must be a non-empty string or null.');
  }

  if (!privateKeyPem || typeof privateKeyPem !== 'string') {
    throw new TypeError('privateKeyPem must be a valid PEM-encoded private key string.');
  }

  // Require explicit key ID configuration rather than silent hardcoded default
  const kid = options.kid || process.env.JWT_KEY_ID;
  if (!kid || typeof kid !== 'string' || !kid.trim()) {
    throw new Error('MISSING_KEY_ID: Signing requires an explicitly configured key ID (options.kid or process.env.JWT_KEY_ID).');
  }

  const ttlSeconds = typeof options.expiresInSeconds === 'number'
    ? Math.floor(options.expiresInSeconds)
    : JWT_CONFIG.MAX_ACCESS_TOKEN_TTL_SECONDS;

  const nowSeconds = typeof options.nowSeconds === 'number'
    ? Math.floor(options.nowSeconds)
    : Math.floor(Date.now() / 1000);

  const expSeconds = nowSeconds + ttlSeconds;
  const jti = crypto.randomUUID();

  const payload = {
    iss: options.issuer || process.env.JWT_ISSUER || JWT_CONFIG.ISSUER,
    aud: options.audience || process.env.JWT_AUDIENCE || JWT_CONFIG.AUDIENCE,
    sub: sub.trim(),
    email: normalizeEmail(email),
    defaultBusinessId: defaultBusinessId ? defaultBusinessId.trim() : null,
    token_use: JWT_CONFIG.TOKEN_USE,
    token_type: JWT_CONFIG.TOKEN_TYPE,
    jti,
    iat: nowSeconds,
    exp: expSeconds
  };

  return jwt.sign(payload, privateKeyPem, {
    algorithm: JWT_CONFIG.ALGORITHM,
    keyid: kid.trim(),
    header: {
      alg: JWT_CONFIG.ALGORITHM,
      typ: 'JWT',
      kid: kid.trim()
    }
  });
}

/**
 * Resolves a public key given a key resolver and a kid.
 * Strictly verifies that the token's kid identifies the exact key used for verification.
 * 
 * Supported resolver structures:
 * 1. Object map: { [kid]: pemString } -> Matches exact kid key
 * 2. Object with expectedKid: { publicKey: pemString, expectedKid: string } -> Verifies kid === expectedKid
 * 3. Resolver function: async (kid) => pemString -> Must return PEM for the requested kid
 * 4. Static PEM string: Requires options.expectedKid or process.env.JWT_KEY_ID
 * 
 * @param {string|Function|Object} publicKeyResolver - Key resolver configuration
 * @param {string} kid - Key ID from token header
 * @param {Object} [options]
 * @param {string} [options.expectedKid] - Expected key ID when using a static public key
 * @returns {Promise<string>} - Resolves to public key PEM string
 */
async function resolvePublicKey(publicKeyResolver, kid, options = {}) {
  // Option 1: Object with explicit { publicKey, expectedKid }
  if (publicKeyResolver && typeof publicKeyResolver === 'object' && 'publicKey' in publicKeyResolver && 'expectedKid' in publicKeyResolver) {
    if (kid !== publicKeyResolver.expectedKid) {
      const err = new Error(`MISMATCHED_KEY_ID: Expected key ID '${publicKeyResolver.expectedKid}', but token specified '${kid}'.`);
      err.code = 'MISMATCHED_KEY_ID';
      throw err;
    }
    return publicKeyResolver.publicKey;
  }

  // Option 2: Object mapping kid => PEM
  if (publicKeyResolver && typeof publicKeyResolver === 'object' && !('publicKey' in publicKeyResolver)) {
    if (!Object.prototype.hasOwnProperty.call(publicKeyResolver, kid) || !publicKeyResolver[kid]) {
      const err = new Error(`UNKNOWN_KEY_ID: Unrecognized key ID '${kid}'.`);
      err.code = 'UNKNOWN_KEY_ID';
      throw err;
    }
    return publicKeyResolver[kid];
  }

  // Option 3: Resolver function (kid => pem)
  if (typeof publicKeyResolver === 'function') {
    const key = await publicKeyResolver(kid);
    if (!key) {
      const err = new Error(`UNKNOWN_KEY_ID: Public key resolver returned null/undefined for key ID '${kid}'.`);
      err.code = 'UNKNOWN_KEY_ID';
      throw err;
    }
    return key;
  }

  // Option 4: Static PEM string - MUST have an expectedKid configured
  if (typeof publicKeyResolver === 'string') {
    const expectedKid = options.expectedKid || process.env.JWT_KEY_ID;
    if (!expectedKid) {
      const err = new Error('STATIC_KEY_MISSING_EXPECTED_KID: A static public key must be accompanied by an explicitly configured expectedKid.');
      err.code = 'STATIC_KEY_MISSING_EXPECTED_KID';
      throw err;
    }

    if (kid !== expectedKid) {
      const err = new Error(`MISMATCHED_KEY_ID: Expected key ID '${expectedKid}', but token specified '${kid}'.`);
      err.code = 'MISMATCHED_KEY_ID';
      throw err;
    }
    return publicKeyResolver;
  }

  const err = new TypeError('INVALID_KEY_RESOLVER: publicKeyResolver must be a key map object, { publicKey, expectedKid } object, resolver function, or static PEM with expectedKid.');
  err.code = 'INVALID_KEY_RESOLVER';
  throw err;
}

/**
 * Verifies an RS256 access token with complete claim and key-ID validation.
 * 
 * @param {string} token - Raw JWT string
 * @param {string|Function|Object} publicKeyResolver - Public key resolver
 * @param {Object} [options]
 * @param {string} [options.expectedKid] - Expected key ID (required when publicKeyResolver is a static string)
 * @param {string} [options.expectedAudience] - Expected audience (defaults to JWT_CONFIG.AUDIENCE)
 * @param {string} [options.expectedIssuer] - Expected issuer (defaults to JWT_CONFIG.ISSUER)
 * @param {number} [options.clockToleranceSeconds=5] - Allowed clock skew tolerance in seconds
 * @param {number} [options.maxLifetimeSeconds=900] - Maximum allowed access token lifetime in seconds
 * @param {number} [options.nowSeconds] - Optional override for current timestamp (for testing)
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

  // Step 2.1: Strict header typ enforcement - require header.typ === 'JWT'
  if (header.typ !== 'JWT') {
    const err = new Error(`INVALID_TOKEN_HEADER_TYPE: Header typ must be strictly 'JWT', received '${header.typ}'.`);
    err.code = 'INVALID_TOKEN_HEADER_TYPE';
    throw err;
  }

  // Step 3: Mandatory Key ID (kid) enforcement
  if (!header.kid || typeof header.kid !== 'string' || !header.kid.trim()) {
    const err = new Error('MISSING_KID: Token header must contain a valid non-empty kid.');
    err.code = 'MISSING_KID';
    throw err;
  }

  const tokenKid = header.kid.trim();

  // Step 3.1: Validate integer Unix timestamps on unverified payload before signature / expiry check
  const rawPayload = decodedComplete.payload;
  if (!rawPayload || typeof rawPayload !== 'object' || !Number.isInteger(rawPayload.iat) || !Number.isInteger(rawPayload.exp)) {
    const err = new Error('INVALID_TOKEN_TIMESTAMPS: iat and exp claims must be integer Unix seconds.');
    err.code = 'INVALID_TOKEN_TIMESTAMPS';
    throw err;
  }

  // Step 4: Resolve public key (enforces that kid matches the exact key used for verification)
  const publicKeyPem = await resolvePublicKey(publicKeyResolver, tokenKid, options);

  // Step 5: Cryptographic signature verification
  const expectedAudience = options.expectedAudience || process.env.JWT_AUDIENCE || JWT_CONFIG.AUDIENCE;
  const expectedIssuer = options.expectedIssuer || process.env.JWT_ISSUER || JWT_CONFIG.ISSUER;
  const clockTolerance = typeof options.clockToleranceSeconds === 'number'
    ? options.clockToleranceSeconds
    : JWT_CONFIG.DEFAULT_CLOCK_TOLERANCE_SECONDS;

  let payload;
  try {
    payload = jwt.verify(token, publicKeyPem, {
      algorithms: [JWT_CONFIG.ALGORITHM],
      issuer: expectedIssuer,
      audience: expectedAudience,
      clockTolerance
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

  // Step 6: Complete Claims Validation
  // 6.1: token_use
  if (payload.token_use !== JWT_CONFIG.TOKEN_USE) {
    const err = new Error(`INVALID_TOKEN_USE: Expected token_use '${JWT_CONFIG.TOKEN_USE}', received '${payload.token_use}'.`);
    err.code = 'INVALID_TOKEN_USE';
    throw err;
  }

  // 6.2: token_type
  if (payload.token_type !== JWT_CONFIG.TOKEN_TYPE) {
    const err = new Error(`INVALID_TOKEN_TYPE: Expected token_type '${JWT_CONFIG.TOKEN_TYPE}', received '${payload.token_type}'.`);
    err.code = 'INVALID_TOKEN_TYPE';
    throw err;
  }

  // 6.3: Subject (sub)
  if (!payload.sub || typeof payload.sub !== 'string' || !payload.sub.trim()) {
    const err = new Error('INVALID_TOKEN_SUBJECT: Token sub must be a non-empty string.');
    err.code = 'INVALID_TOKEN_SUBJECT';
    throw err;
  }

  // 6.4: Unique Token ID (jti) - must be a valid RFC 4122 UUIDv4 string
  if (!payload.jti || typeof payload.jti !== 'string' || !UUID_V4_REGEX.test(payload.jti.trim())) {
    const err = new Error('INVALID_TOKEN_JTI: Token jti must be a valid RFC 4122 UUIDv4 identifier string.');
    err.code = 'INVALID_TOKEN_JTI';
    throw err;
  }

  // 6.5: Email validation and normalization check
  if (!payload.email || typeof payload.email !== 'string' || !isValidEmail(payload.email)) {
    const err = new Error('INVALID_TOKEN_EMAIL: Token email must be a valid email address.');
    err.code = 'INVALID_TOKEN_EMAIL';
    throw err;
  }
  if (payload.email !== normalizeEmail(payload.email)) {
    const err = new Error('INVALID_TOKEN_EMAIL: Token email is not in canonical normalized form.');
    err.code = 'INVALID_TOKEN_EMAIL';
    throw err;
  }

  // 6.6: defaultBusinessId (must be a non-empty string or null)
  if (payload.defaultBusinessId !== null && (typeof payload.defaultBusinessId !== 'string' || !payload.defaultBusinessId.trim())) {
    const err = new Error('INVALID_TOKEN_BUSINESS_ID: Token defaultBusinessId must be a non-empty string or null.');
    err.code = 'INVALID_TOKEN_BUSINESS_ID';
    throw err;
  }

  // 6.7: Integer Unix timestamps
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) {
    const err = new Error('INVALID_TOKEN_TIMESTAMPS: iat and exp claims must be integer Unix seconds.');
    err.code = 'INVALID_TOKEN_TIMESTAMPS';
    throw err;
  }

  // 6.8: Expiry must be strictly greater than issued-at
  if (payload.exp <= payload.iat) {
    const err = new Error(`INVALID_TOKEN_EXPIRY: Token exp (${payload.exp}) must be strictly greater than iat (${payload.iat}).`);
    err.code = 'INVALID_TOKEN_EXPIRY';
    throw err;
  }

  // 6.9: Future-issued check beyond clock tolerance
  const nowSeconds = typeof options.nowSeconds === 'number'
    ? Math.floor(options.nowSeconds)
    : Math.floor(Date.now() / 1000);

  if (payload.iat > (nowSeconds + clockTolerance)) {
    const err = new Error(`TOKEN_ISSUED_IN_FUTURE: Token iat (${payload.iat}) is in the future beyond clock tolerance (${nowSeconds + clockTolerance}).`);
    err.code = 'TOKEN_ISSUED_IN_FUTURE';
    throw err;
  }

  // 6.10: Blueprint 900-second absolute access-token lifetime ceiling
  // An optional lower maximum may be configured, but can never exceed the absolute 900-second blueprint ceiling.
  // Invalid, negative, zero, or non-numeric configuration values safely fall back to the 900-second ceiling.
  const configuredMax = typeof options.maxLifetimeSeconds === 'number' && Number.isFinite(options.maxLifetimeSeconds) && options.maxLifetimeSeconds > 0
    ? Math.floor(options.maxLifetimeSeconds)
    : JWT_CONFIG.MAX_ACCESS_TOKEN_TTL_SECONDS;

  const maxLifetime = Math.min(configuredMax, JWT_CONFIG.MAX_ACCESS_TOKEN_TTL_SECONDS);

  const tokenLifetime = payload.exp - payload.iat;
  if (tokenLifetime > maxLifetime) {
    const err = new Error(`TOKEN_LIFETIME_EXCEEDED: Token lifetime (${tokenLifetime}s) exceeds maximum allowed access-token lifetime of ${maxLifetime}s.`);
    err.code = 'TOKEN_LIFETIME_EXCEEDED';
    throw err;
  }

  return payload;
}
