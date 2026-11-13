/**
 * CSRF Protection Middleware
 * Strictly conforms to SB Manager Rebuild Blueprint v2.1 Section 14 and Phase 4 Architecture Plan Section 9.3.
 * 
 * Multi-Layer Defense in Depth:
 * 1. Safe Method Bypass: Safe read-only methods (GET, HEAD, OPTIONS) bypass CSRF checks.
 * 2. Fetch Metadata Verification: Checks Sec-Fetch-Site header. Rejects any 'cross-site' state-changing request.
 * 3. Strict Origin Validation: Validates HTTP Origin / Referer header against authorized origin allowlist.
 *    Rejects missing or unlisted origins on state-changing requests with 403 Forbidden.
 * 4. Custom Request Header Validation: Mandates presence of custom application headers
 *    (e.g. X-Requested-With, X-SB-Client, X-CSRF-Token), which cannot be forged cross-origin without CORS preflight.
 */

export const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000'
];

/**
 * Resolves the active list of authorized CORS/CSRF origins.
 * 
 * @param {string[]|string} [configuredOrigins]
 * @returns {string[]}
 */
export function resolveAllowedOrigins(configuredOrigins) {
  if (Array.isArray(configuredOrigins) && configuredOrigins.length > 0) {
    return configuredOrigins.map(o => String(o).trim().replace(/\/$/, ''));
  }

  if (typeof configuredOrigins === 'string' && configuredOrigins.trim()) {
    return configuredOrigins.split(',').map(o => o.trim().replace(/\/$/, ''));
  }

  const envOrigins = process.env.ALLOWED_ORIGINS ||
                     process.env.CORS_ALLOWED_ORIGINS ||
                     process.env.CLIENT_URL;

  if (envOrigins && typeof envOrigins === 'string') {
    return envOrigins.split(',').map(o => o.trim().replace(/\/$/, '')).filter(Boolean);
  }

  return DEFAULT_ALLOWED_ORIGINS;
}

/**
 * Creates CSRF protection middleware for Express.
 * 
 * @param {Object} [options]
 * @param {string[]|string} [options.allowedOrigins] - Allowlist of origins
 * @param {boolean} [options.requireCustomHeader=true] - Whether to require custom header
 * @returns {import('express').RequestHandler}
 */
export function createCsrfProtectionMiddleware(options = {}) {
  const allowedOrigins = resolveAllowedOrigins(options.allowedOrigins);
  const requireCustomHeader = options.requireCustomHeader !== false;

  return function csrfProtectionMiddleware(req, res, next) {
    // 1. Safe methods bypass CSRF evaluation
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (safeMethods.includes(req.method.toUpperCase())) {
      return next();
    }

    // 2. Fetch Metadata: verify Sec-Fetch-Site
    const secFetchSite = req.headers['sec-fetch-site'];
    if (secFetchSite && secFetchSite.toLowerCase() === 'cross-site') {
      return res.status(403).json({
        success: false,
        error: 'CSRF_CROSS_SITE',
        message: 'Cross-site request blocked by Fetch Metadata policy.'
      });
    }

    // 3. Strict Allowed-Origin Validation
    let origin = req.headers.origin;
    if (!origin && req.headers.referer) {
      try {
        const parsedReferer = new URL(req.headers.referer);
        origin = parsedReferer.origin;
      } catch {
        origin = null;
      }
    }

    if (!origin || typeof origin !== 'string') {
      return res.status(403).json({
        success: false,
        error: 'CSRF_INVALID_ORIGIN',
        message: 'State-changing requests require a valid Origin or Referer header.'
      });
    }

    const normalizedOrigin = origin.trim().replace(/\/$/, '');
    if (!allowedOrigins.includes(normalizedOrigin)) {
      return res.status(403).json({
        success: false,
        error: 'CSRF_INVALID_ORIGIN',
        message: `Origin '${origin}' is not authorized.`
      });
    }

    // 4. Custom Request Header validation
    if (requireCustomHeader) {
      const hasCustomHeader = req.headers['x-requested-with'] ||
                              req.headers['x-sb-client'] ||
                              req.headers['x-csrf-token'] ||
                              req.headers['x-csrf-protection'];

      if (!hasCustomHeader) {
        return res.status(403).json({
          success: false,
          error: 'CSRF_MISSING_HEADER',
          message: 'Missing required custom security header (e.g. X-Requested-With or X-SB-Client).'
        });
      }
    }

    return next();
  };
}

export const defaultCsrfProtection = createCsrfProtectionMiddleware();
