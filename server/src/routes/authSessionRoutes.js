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

/**
 * Creates an Express router configured with auth session routes and CSRF middleware.
 * 
 * @param {Object} [options]
 * @param {import('../services/refreshTokenService.js').RefreshTokenService} [options.tokenService]
 * @param {import('express').RequestHandler} [options.csrfMiddleware]
 * @returns {Router}
 */
export function createAuthSessionRouter(options = {}) {
  const router = Router();
  const csrf = options.csrfMiddleware || createCsrfProtectionMiddleware();
  const controller = options.tokenService ? createAuthSessionController(options.tokenService) : { refresh: refreshSession, logout: logoutSession };

  router.post('/refresh', csrf, controller.refresh);
  router.post('/logout', csrf, controller.logout);

  return router;
}

const defaultAuthSessionRouter = createAuthSessionRouter();
export default defaultAuthSessionRouter;
