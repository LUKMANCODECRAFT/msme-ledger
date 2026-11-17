/**
 * Auth Session Routes
 * Strictly conforms to SB Manager Rebuild Blueprint v2.1 Section 14 and Phase 4 Architecture Plan Section 4.3.
 * 
 * Endpoints:
 * - POST /api/v2/auth/refresh (CSRF protected, reads sb_refresh_token cookie)
 * - POST /api/v2/auth/logout (CSRF protected, revokes session, clears cookie)
 */

import { Router } from 'express';
import { createCsrfProtectionMiddleware } from '../middleware/csrfProtection.js';
import { createAuthSessionController, refreshSession, logoutSession } from '../controllers/authSessionController.js';
import { AuthService } from '../services/authService.js';
import { createAuthController } from '../controllers/authController.js';
import { ConfigurationError } from '../services/replayCacheService.js';

/**
 * Creates an Express router configured with auth endpoints (register, login, refresh, logout, me) and CSRF middleware.
 * In production, strictly requires an explicitly injected tokenService.
 * 
 * @param {Object} [options]
 * @param {import('../services/refreshTokenService.js').RefreshTokenService} [options.tokenService]
 * @param {AuthService} [options.authService]
 * @param {import('express').RequestHandler} [options.csrfMiddleware]
 * @param {import('express').RequestHandler} [options.authMiddleware]
 * @returns {Router}
 */
export function createAuthSessionRouter(options = {}) {
  const isProduction = process.env.NODE_ENV === 'production';
  const router = Router();
  const csrf = options.csrfMiddleware || createCsrfProtectionMiddleware();

  if (!options.tokenService && !options.authService && isProduction) {
    throw new ConfigurationError(
      'MISSING_TOKEN_SERVICE',
      'createAuthSessionRouter requires an explicitly injected tokenService in production.'
    );
  }

  const sessionController = options.tokenService
    ? createAuthSessionController(options.tokenService)
    : { refresh: refreshSession, logout: logoutSession };

  // Auth Service for register / login / me
  let authService = options.authService || null;
  if (!authService && options.tokenService) {
    try {
      authService = new AuthService({
        tokenService: options.tokenService,
        signingKey: options.signingKey,
        kid: options.kid,
        rateLimitService: options.rateLimitService,
        allowTestKeyFallback: !isProduction
      });
    } catch {}
  }

  const authController = authService ? createAuthController(authService) : null;

  if (authController) {
    router.post('/register', csrf, authController.register);
    router.post('/login', csrf, authController.login);
    if (options.authMiddleware) {
      router.get('/me', options.authMiddleware, authController.me);
    }
  }

  router.post('/refresh', csrf, sessionController.refresh);
  router.post('/logout', csrf, sessionController.logout);

  return router;
}

const defaultAuthSessionRouter = process.env.NODE_ENV === 'production' ? null : createAuthSessionRouter();
export default defaultAuthSessionRouter;
