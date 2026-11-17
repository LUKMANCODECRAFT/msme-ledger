/**
 * Authentication Controller — Stage 4.1C / SBM-040
 * 
 * Express request handlers for:
 * - POST /api/v2/auth/register
 * - POST /api/v2/auth/login
 * - GET  /api/v2/auth/me
 */

import { AuthService, AuthError } from '../services/authService.js';
import { RateLimitError } from '../services/loginRateLimitService.js';
import { REFRESH_COOKIE_NAME, getRefreshCookieOptions } from './authSessionController.js';

export function createAuthController(authService) {
  if (!authService || !(authService instanceof AuthService)) {
    throw new TypeError('createAuthController requires an AuthService instance.');
  }

  return {
    /**
     * Handles merchant registration.
     */
    async register(req, res) {
      try {
        const { email, password, fullName, businessName } = req.body || {};
        const result = await authService.register({
          email,
          password,
          fullName,
          businessName
        });

        // Set HttpOnly, Secure, SameSite=Strict cookie for refresh token
        if (result.rawRefreshToken) {
          res.cookie(REFRESH_COOKIE_NAME, result.rawRefreshToken, getRefreshCookieOptions());
        }

        return res.status(201).json({
          success: true,
          user: result.user,
          accessToken: result.accessToken
        });
      } catch (err) {
        if (err instanceof AuthError) {
          const status = err.code === 'EMAIL_ALREADY_EXISTS' ? 409 : 400;
          return res.status(status).json({
            error: err.code,
            message: err.message
          });
        }

        return res.status(500).json({
          error: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred during registration.'
        });
      }
    },

    /**
     * Handles merchant login with rate limits, lockout, and session issuance.
     */
    async login(req, res) {
      try {
        const { email, password } = req.body || {};
        const clientIp = req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || '127.0.0.1';

        const result = await authService.login({
          email,
          password,
          ip: clientIp
        });

        if (result.rawRefreshToken) {
          res.cookie(REFRESH_COOKIE_NAME, result.rawRefreshToken, getRefreshCookieOptions());
        }

        return res.status(200).json({
          success: true,
          user: result.user,
          accessToken: result.accessToken
        });
      } catch (err) {
        if (err instanceof RateLimitError) {
          return res.status(429).json({
            error: err.code,
            message: err.message,
            retryAfterSeconds: err.details.retryAfterSeconds
          });
        }

        if (err instanceof AuthError) {
          if (err.code === 'ACCOUNT_LOCKED') {
            return res.status(423).json({
              error: err.code,
              message: err.message,
              lockoutUntil: err.details.lockoutUntil
            });
          }

          if (err.code === 'INVALID_CREDENTIALS') {
            return res.status(401).json({
              error: err.code,
              message: err.message
            });
          }

          return res.status(400).json({
            error: err.code,
            message: err.message
          });
        }

        return res.status(500).json({
          error: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred during login.'
        });
      }
    },

    /**
     * Handles retrieving the authenticated user's profile and active memberships.
     */
    async me(req, res) {
      try {
        const userId = req.user?.id;
        if (!userId) {
          return res.status(401).json({
            error: 'UNAUTHORIZED',
            message: 'Authentication required.'
          });
        }

        const profile = await authService.getMe(userId);
        return res.status(200).json({
          success: true,
          ...profile
        });
      } catch (err) {
        if (err instanceof AuthError) {
          return res.status(404).json({
            error: err.code,
            message: err.message
          });
        }

        return res.status(500).json({
          error: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to retrieve profile.'
        });
      }
    }
  };
}
