/**
 * Access Token Authentication Middleware
 * Strictly conforms to SB Manager Rebuild Blueprint v2.1 Section 14 and Phase 4 Architecture Plan Section 4.2.
 * 
 * Verifies RS256 Bearer access tokens on incoming requests.
 * Attaches authenticated user identity (req.user) containing:
 * - id: string (user ID from sub claim)
 * - email: string (canonical email)
 * - defaultBusinessId: string | null
 * - tokenUse: 'access'
 * - tokenType: 'merchant_access'
 * 
 * Security Invariants:
 * - Rejects missing, malformed, non-Bearer, expired, or invalid tokens with HTTP 401 Unauthorized.
 * - Under NO circumstances trusts user IDs, roles, or business IDs supplied in request bodies or query parameters.
 * - Tenant authorization (SBM-041) is strictly separated and NOT evaluated in this authentication middleware.
 */

import { verifyAccessToken } from '../services/jwtService.js';

/**
 * Creates an Express authentication middleware bound to a public key resolver.
 * 
 * @param {string|Function|Object} publicKeyResolver - PEM public key, resolver function (kid => pem), or map
 * @returns {import('express').RequestHandler}
 */
export function createAuthMiddleware(publicKeyResolver) {
  if (!publicKeyResolver) {
    throw new TypeError('createAuthMiddleware requires a valid publicKeyResolver.');
  }

  return async function authenticateAccessToken(req, res, next) {
    // 1. Extract Authorization header (case-insensitive)
    const authHeader = req.headers.authorization || req.headers.Authorization;

    if (!authHeader || typeof authHeader !== 'string') {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Missing Authorization header.'
      });
    }

    // 2. Enforce 'Bearer <token>' schema
    const parts = authHeader.trim().split(/\s+/);
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Malformed Authorization header. Format must be "Bearer <token>".'
      });
    }

    const token = parts[1];
    if (!token) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Bearer token string is empty.'
      });
    }

    // 3. Cryptographically verify the RS256 token
    try {
      const payload = await verifyAccessToken(token, publicKeyResolver);

      // 4. Attach verified authenticated identity to req.user
      // Invariant: Completely ignore and discard any user/tenant claims from req.body or req.query
      req.user = Object.freeze({
        id: payload.sub,
        email: payload.email,
        defaultBusinessId: payload.defaultBusinessId || null,
        tokenUse: payload.token_use,
        tokenType: payload.token_type
      });

      return next();
    } catch (err) {
      // 5. Handle structured rejection codes
      if (err.code === 'TOKEN_EXPIRED') {
        return res.status(401).json({
          error: 'TOKEN_EXPIRED',
          message: 'Access token has expired.',
          expiredAt: err.expiredAt
        });
      }

      return res.status(401).json({
        error: err.code || 'UNAUTHORIZED',
        message: err.message || 'Invalid access token.'
      });
    }
  };
}
