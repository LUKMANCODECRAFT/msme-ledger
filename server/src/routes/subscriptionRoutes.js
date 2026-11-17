/**
 * Subscription Routes — SBM-042
 * Strictly adheres to SB Manager Rebuild Blueprint v2.1 Section 15.
 */

import express from 'express';
import { createSubscriptionController } from '../controllers/subscriptionController.js';
import { preventSelfApproval } from '../middleware/tenantMiddleware.js';

export function createSubscriptionRouter({
  subscriptionService,
  authMiddleware,
  tenantMiddleware
}) {
  const router = express.Router();
  const controller = createSubscriptionController(subscriptionService);

  // Merchant Endpoints (requires JWT auth + Tenant context)
  router.get(
    '/instructions',
    authMiddleware,
    tenantMiddleware,
    controller.getInstructions
  );

  router.post(
    '/submit',
    authMiddleware,
    tenantMiddleware,
    controller.submitProof
  );

  router.get(
    '/status',
    authMiddleware,
    tenantMiddleware,
    controller.getStatus
  );

  // Platform Admin Endpoints
  router.get(
    '/admin/pending',
    authMiddleware,
    controller.getPendingAdmin
  );

  router.post(
    '/admin/:id/review',
    authMiddleware,
    preventSelfApproval({
      getTargetUserId: (req) => req.body?.submittedBy
    }),
    controller.reviewAdmin
  );

  return router;
}
