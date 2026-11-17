/**
 * Subscription Controller — SBM-042
 * Strictly adheres to SB Manager Rebuild Blueprint v2.1 Section 15.
 */

import { SubscriptionError } from '../services/subscriptionService.js';

export function createSubscriptionController(subscriptionService) {
  return {
    async getInstructions(req, res) {
      try {
        const businessId = req.tenant?.businessId;
        const instructions = subscriptionService.getInstructions({ businessId });
        return res.status(200).json({ success: true, ...instructions });
      } catch (err) {
        const statusCode = err.statusCode || 400;
        return res.status(statusCode).json({
          success: false,
          error: err.code || 'BAD_REQUEST',
          message: err.message
        });
      }
    },

    async submitProof(req, res) {
      try {
        const businessId = req.tenant?.businessId;
        const userId = req.user?.id;
        const { planId, paymentReference, amount, proofImageUrl } = req.body || {};

        const subscription = await subscriptionService.submitProof({
          businessId,
          userId,
          planId,
          paymentReference,
          amount,
          proofImageUrl
        });

        return res.status(201).json({
          success: true,
          subscription
        });
      } catch (err) {
        const statusCode = err.statusCode || 400;
        return res.status(statusCode).json({
          success: false,
          error: err.code || 'SUBMISSION_FAILED',
          message: err.message
        });
      }
    },

    async getStatus(req, res) {
      try {
        const businessId = req.tenant?.businessId;
        const subscription = await subscriptionService.getActiveSubscription(businessId);
        return res.status(200).json({
          success: true,
          subscription: subscription || null,
          hasActiveSubscription: Boolean(subscription)
        });
      } catch (err) {
        const statusCode = err.statusCode || 500;
        return res.status(statusCode).json({
          success: false,
          error: err.code || 'STATUS_LOOKUP_FAILED',
          message: err.message
        });
      }
    },

    async getPendingAdmin(req, res) {
      try {
        if (!req.user?.isPlatformAdmin && req.user?.role !== 'platform_admin') {
          return res.status(403).json({
            success: false,
            error: 'FORBIDDEN_PLATFORM_ADMIN_REQUIRED',
            message: 'Platform administrator role required to inspect pending subscription queue.'
          });
        }

        const pending = await subscriptionService.getPendingSubscriptions();
        return res.status(200).json({
          success: true,
          count: pending.length,
          pending
        });
      } catch (err) {
        return res.status(500).json({
          success: false,
          error: 'PENDING_LOOKUP_FAILED',
          message: err.message
        });
      }
    },

    async reviewAdmin(req, res) {
      try {
        if (!req.user?.isPlatformAdmin && req.user?.role !== 'platform_admin') {
          return res.status(403).json({
            success: false,
            error: 'FORBIDDEN_PLATFORM_ADMIN_REQUIRED',
            message: 'Platform administrator role required to review subscriptions.'
          });
        }

        const subscriptionId = req.params?.id;
        const adminId = req.user?.id;
        const { decision, rejectionReason } = req.body || {};

        const subscription = await subscriptionService.reviewSubscription({
          subscriptionId,
          adminId,
          decision,
          rejectionReason
        });

        return res.status(200).json({
          success: true,
          subscription
        });
      } catch (err) {
        const statusCode = err.statusCode || 400;
        return res.status(statusCode).json({
          success: false,
          error: err.code || 'REVIEW_FAILED',
          message: err.message
        });
      }
    }
  };
}
