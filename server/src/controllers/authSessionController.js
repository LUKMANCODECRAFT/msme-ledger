/**
 * Auth Session Controller
 * Strictly conforms to SB Manager Rebuild Blueprint v2.1 Section 14 and Phase 4 Architecture Plan Section 4.3.
 * 
 * Endpoints:
 * - POST /api/v2/auth/refresh
 * - POST /api/v2/auth/logout
 * 
 * Cookie Security Invariants:
 * - Cookie name: sb_refresh_token
 * - HttpOnly: true (inaccessible to JavaScript)
 * - Secure: true in production (HTTPS-only)
 * - SameSite: Strict (never sent with cross-site requests)
 * - Path: /api/v2/auth (scoped strictly to auth endpoints)
 * - MaxAge: 30 days (2,592,000,000 ms)
 */

import { defaultRefreshTokenService, RefreshTokenError } from '../services/refreshTokenService.js';
import { ConfigurationError } from '../services/replayCacheService.js';

export const REFRESH_COOKIE_NAME = 'sb_refresh_token';

/**
 * Resolves standard secure cookie options for the refresh token.
 * 
 * @param {Object} [overrides]
 * @returns {import('express').CookieOptions}
 */
export function getRefreshCookieOptions(overrides = {}) {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    path: '/api/v2/auth',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    ...overrides
  };
}

/**
 * Extracts the raw refresh token from cookies, falling back to header parsing.
 * 
 * @param {import('express').Request} req
 * @returns {string|null}
 */
export function extractRefreshTokenFromRequest(req) {
  if (req.cookies && req.cookies[REFRESH_COOKIE_NAME]) {
    return req.cookies[REFRESH_COOKIE_NAME];
  }

  // Fallback parsing if cookie-parser middleware was bypassed
  const cookieHeader = req.headers?.cookie;
  if (cookieHeader && typeof cookieHeader === 'string') {
    const pairs = cookieHeader.split(';').map(c => c.trim());
    for (const pair of pairs) {
      const [key, ...valParts] = pair.split('=');
      if (key === REFRESH_COOKIE_NAME) {
        return decodeURIComponent(valParts.join('='));
      }
    }
  }

  return null;
}

/**
 * Creates controller actions bound to a given RefreshTokenService instance.
 * 
 * @param {import('../services/refreshTokenService.js').RefreshTokenService} [tokenService]
 */
export function createAuthSessionController(tokenService) {
  const isProduction = process.env.NODE_ENV === 'production';
  const resolvedService = tokenService || defaultRefreshTokenService;

  if (!resolvedService) {
    if (isProduction) {
      throw new ConfigurationError(
        'MISSING_TOKEN_SERVICE',
        'createAuthSessionController requires an explicitly injected tokenService in production.'
      );
    }
  }

  return {
    /**
     * POST /api/v2/auth/refresh
     * Rotates the refresh token and returns a fresh RS256 access token.
     */
    async refresh(req, res) {
      const rawToken = extractRefreshTokenFromRequest(req);

      if (!rawToken) {
        return res.status(401).json({
          success: false,
          error: 'MISSING_REFRESH_TOKEN',
          message: 'Refresh token cookie is required.'
        });
      }

      const clientIp = req.ip || req.connection?.remoteAddress;
      const userAgent = req.headers['user-agent'] || null;

      try {
        const result = await tokenService.rotateRefreshToken(rawToken, {
          ipAddress: clientIp,
          userAgent
        });

        // Set the new successor token in the HttpOnly cookie
        res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, getRefreshCookieOptions());

        return res.status(200).json({
          success: true,
          data: {
            accessToken: result.accessToken,
            tokenType: result.tokenType || 'Bearer',
            expiresIn: result.expiresIn || 900
          }
        });
      } catch (err) {
        // Clear cookie options (remove maxAge)
        const clearOptions = {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          path: '/api/v2/auth'
        };

        if (err.code === 'CONCURRENT_REFRESH_IN_PROGRESS') {
          // Tier 1 concurrency: tell client to pause and retry without clearing cookie
          return res.status(409).set('Retry-After', String(err.retryAfter || 1)).json({
            success: false,
            error: err.code,
            message: err.message
          });
        }

        if (err.code === 'REPLAY_CACHE_WRITE_FAILURE') {
          // Safe abort: cache write failed so R1 remains active. Do not clear cookie.
          return res.status(503).json({
            success: false,
            error: err.code,
            message: err.message
          });
        }

        // On authentication failures (expired, compromised, revoked, delivery failure), clear cookie
        res.clearCookie(REFRESH_COOKIE_NAME, clearOptions);

        const status = err.statusCode || 401;
        return res.status(status).json({
          success: false,
          error: err.code || 'UNAUTHORIZED',
          message: err.message
        });
      }
    },

    /**
     * POST /api/v2/auth/logout
     * Revokes the active session/token family and clears the refresh cookie.
     * Fails closed on database revocation errors without falsely returning 200 OK.
     */
    async logout(req, res) {
      const clearOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/api/v2/auth'
      };

      // Always clear the browser cookie first
      res.clearCookie(REFRESH_COOKIE_NAME, clearOptions);

      const rawToken = extractRefreshTokenFromRequest(req);

      if (!rawToken) {
        return res.status(200).json({
          success: true,
          message: 'Logged out successfully.'
        });
      }

      try {
        await tokenService.revokeSessionByToken(rawToken);

        return res.status(200).json({
          success: true,
          message: 'Logged out successfully.'
        });
      } catch (err) {
        // Operational log with zero secrets and zero raw tokens
        console.error('[AUTH_LOGOUT_ERROR] Server-side session revocation failed:', err.message);

        return res.status(500).json({
          success: false,
          error: 'LOGOUT_REVOCATION_FAILED',
          message: 'Failed to revoke session on server. Browser cookie cleared.'
        });
      }
    }
  };
}

let defaultController = null;
if (process.env.NODE_ENV !== 'production' && defaultRefreshTokenService) {
  defaultController = createAuthSessionController(defaultRefreshTokenService);
}

export const refreshSession = (req, res) => {
  if (!defaultController) {
    throw new ConfigurationError('MISSING_TOKEN_SERVICE', 'createAuthSessionController requires an explicitly injected tokenService in production.');
  }
  return defaultController.refresh(req, res);
};

export const logoutSession = (req, res) => {
  if (!defaultController) {
    throw new ConfigurationError('MISSING_TOKEN_SERVICE', 'createAuthSessionController requires an explicitly injected tokenService in production.');
  }
  return defaultController.logout(req, res);
};
