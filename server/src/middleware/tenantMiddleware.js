/**
 * Tenant Context & Authorization Middleware — SBM-041
 * Strictly conforms to SB Manager Rebuild Blueprint v2.1 Section 14.3 and Section 23.
 * 
 * Responsibilities:
 * 1. Resolves target tenant (businessId) from X-Business-ID header with fallback to authenticated user default.
 * 2. Defense against parameter pollution & body/query forgery (blocks conflicting businessId or shopId).
 * 3. Enforces database-backed membership verification (User -> Business membership).
 * 4. Attaches immutable `req.tenant = { businessId, role, membershipId }`.
 * 5. Provides role boundary enforcement (owner, manager, cashier).
 * 6. Enforces self-approval prevention and platform admin boundaries.
 */

import { Membership } from '../models/target/coreModels.js';

export function createTenantMiddleware(options = {}) {
  const membershipModel = options.membershipModel || Membership;
  const allowPlatformAdmin = Boolean(options.allowPlatformAdmin);
  const requiredRoles = options.requireRoles
    ? (Array.isArray(options.requireRoles) ? options.requireRoles : [options.requireRoles])
    : null;

  return async function tenantMiddleware(req, res, next) {
    // 1. Verify user authentication is already established
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Authentication required before tenant resolution.'
      });
    }

    // 2. Resolve target businessId
    const headerBusinessId = req.headers['x-business-id'];
    let businessId = null;

    if (typeof headerBusinessId === 'string' && headerBusinessId.trim()) {
      businessId = headerBusinessId.trim();
    } else if (req.user.defaultBusinessId && typeof req.user.defaultBusinessId === 'string') {
      businessId = req.user.defaultBusinessId.trim();
    }

    if (!businessId) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN_TENANT_ACCESS',
        message: 'No target businessId resolved from X-Business-ID header or authenticated profile.'
      });
    }

    // 3. Defense against Parameter Pollution & Forged Identifiers in Body and Query
    if (req.body && typeof req.body === 'object') {
      if (req.body.businessId && req.body.businessId !== businessId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_TENANT_MISMATCH',
          message: 'Request body contains conflicting businessId parameter.'
        });
      }
      if (req.body.shopId && req.body.shopId !== businessId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_TENANT_MISMATCH',
          message: 'Request body contains conflicting shopId parameter.'
        });
      }
      // Sanitize body to prevent downstream handlers reading unvalidated values
      req.body.businessId = businessId;
    }

    if (req.query && typeof req.query === 'object') {
      if (req.query.businessId && req.query.businessId !== businessId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_TENANT_MISMATCH',
          message: 'Request query contains conflicting businessId parameter.'
        });
      }
      if (req.query.shopId && req.query.shopId !== businessId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_TENANT_MISMATCH',
          message: 'Request query contains conflicting shopId parameter.'
        });
      }
      // Sanitize query to prevent downstream handlers reading unvalidated values
      req.query.businessId = businessId;
    }

    // 4. Platform Admin Access Boundary Check
    const isPlatformAdmin = Boolean(req.user.isPlatformAdmin || req.user.role === 'platform_admin');
    if (allowPlatformAdmin && isPlatformAdmin) {
      req.tenant = Object.freeze({
        businessId,
        role: 'platform_admin',
        membershipId: null,
        isPlatformAdmin: true
      });
      return next();
    }

    // 5. Query verified active membership
    try {
      const membership = await membershipModel.findOne({
        userId: req.user.id,
        businessId
      });

      if (!membership) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_TENANT_ACCESS',
          message: 'User does not possess an active membership in the requested business.'
        });
      }

      if (membership.status === 'revoked' || membership.status === 'suspended') {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_MEMBERSHIP_REVOKED',
          message: 'User membership in this tenant has been revoked or suspended.'
        });
      }

      // 6. Role boundary enforcement if specified
      if (requiredRoles && !requiredRoles.includes(membership.role)) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_INSUFFICIENT_ROLE',
          message: `Operation requires one of the following roles: ${requiredRoles.join(', ')}.`
        });
      }

      // 7. Attach immutable tenant context
      req.tenant = Object.freeze({
        businessId,
        role: membership.role,
        membershipId: membership.id || null,
        isPlatformAdmin: false
      });

      return next();
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: 'INTERNAL_TENANT_RESOLUTION_ERROR',
        message: 'Failed to verify tenant membership.'
      });
    }
  };
}

/**
 * Middleware ensuring current tenant role meets specified permissions.
 * 
 * @param {string|string[]} allowedRoles
 */
export function requireTenantRole(allowedRoles) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return function tenantRoleGuard(req, res, next) {
    if (!req.tenant || !req.tenant.role) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN_NO_TENANT_CONTEXT',
        message: 'Tenant context must be established before role verification.'
      });
    }

    if (req.tenant.isPlatformAdmin) {
      return next();
    }

    if (!roles.includes(req.tenant.role)) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN_INSUFFICIENT_ROLE',
        message: `Operation requires one of the following roles: ${roles.join(', ')}.`
      });
    }

    return next();
  };
}

/**
 * Middleware preventing actors from approving their own administrative requests
 * (e.g. self-approving subscription payment proofs, self-elevation of roles).
 * 
 * @param {Object} [options]
 * @param {Function} [options.getTargetUserId] - Resolves target user ID from request
 */
export function preventSelfApproval(options = {}) {
  const getTargetUserId = options.getTargetUserId || (
    (req) => req.body?.userId || req.body?.submittedBy || req.params?.userId || req.query?.userId
  );

  return function selfApprovalGuard(req, res, next) {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Authentication required for approval operations.'
      });
    }

    const targetUserId = getTargetUserId(req);
    if (targetUserId && String(targetUserId) === String(req.user.id)) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN_SELF_APPROVAL',
        message: 'Self-approval is strictly forbidden. An independent administrator must review and approve this action.'
      });
    }

    return next();
  };
}
