/**
 * Manual Subscription & Entitlement Service — SBM-042
 * Strictly adheres to SB Manager Rebuild Blueprint v2.1 Section 15.
 * 
 * Rules:
 * 1. Zero Paystack recurring charges or unapproved payment gateways.
 * 2. Dynamic bank instruction retrieval with unique references (REF-SB-XXXX).
 * 3. Administrative proof verification with self-approval prevention.
 * 4. RS256 offline entitlement token issuance with grace period enforcement.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Subscription } from '../models/target/subscriptionModel.js';
import { defaultAuditLogService } from './auditLogService.js';
import { generateTestRsaKeyPair } from './jwtService.js';

export const APPROVED_SUBSCRIPTION_PLANS = Object.freeze({
  pro: {
    id: 'pro',
    name: 'Professional Merchant',
    priceKobo: 500000, // 5,000 NGN in Kobo
    durationDays: 30,
    gracePeriodDays: 7,
    features: ['multi_user', 'inventory_valuation', 'financial_reports', 'csv_export']
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise Multi-Shop',
    priceKobo: 1500000, // 15,000 NGN in Kobo
    durationDays: 30,
    gracePeriodDays: 7,
    features: ['all', 'multi_shop', 'priority_support', 'audit_export']
  }
});

export class SubscriptionError extends Error {
  constructor(code, statusCode, message, details = {}) {
    super(message);
    this.name = 'SubscriptionError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class SubscriptionService {
  /**
   * @param {Object} [options]
   * @param {import('mongoose').Model} [options.subscriptionModel]
   * @param {import('./auditLogService.js').AuditLogService} [options.auditService]
   * @param {string} [options.signingKey]
   * @param {string} [options.kid]
   * @param {boolean} [options.allowTestKeyFallback=false]
   * @param {Object} [options.bankConfig]
   */
  constructor(options = {}) {
    this.SubscriptionModel = options.subscriptionModel || Subscription;
    this.auditService = options.auditService || defaultAuditLogService;

    const isProduction = process.env.NODE_ENV === 'production';
    this.kid = options.kid || process.env.JWT_KEY_ID || 'entitlement-key-1';
    this.signingKey = options.signingKey || process.env.JWT_PRIVATE_KEY;

    if (!this.signingKey) {
      if (isProduction || !options.allowTestKeyFallback) {
        throw new Error('MISSING_SIGNING_KEY: SubscriptionService requires an explicit signingKey for entitlement tokens.');
      }
      const pair = generateTestRsaKeyPair(this.kid);
      this.signingKey = pair.privateKey;
      this.kid = pair.kid;
    }

    this.bankConfig = Object.freeze({
      bankName: process.env.BANK_NAME || options.bankConfig?.bankName || 'Zenith Bank PLC',
      accountName: process.env.BANK_ACCOUNT_NAME || options.bankConfig?.accountName || 'MSME Ledger Technologies Ltd',
      accountNumber: process.env.BANK_ACCOUNT_NUMBER || options.bankConfig?.accountNumber || '1012345678'
    });
  }

  /**
   * Returns dynamic bank account details and generates a unique payment reference.
   * Zero bank details hardcoded in client.
   * 
   * @param {Object} params
   * @param {string} params.businessId
   * @returns {Object}
   */
  getInstructions({ businessId }) {
    if (!businessId || typeof businessId !== 'string') {
      throw new SubscriptionError('INVALID_BUSINESS_ID', 400, 'businessId is required.');
    }

    const randomSuffix = crypto.randomBytes(4).toString('hex').toUpperCase();
    const reference = `REF-SB-${randomSuffix}`;

    return {
      bankDetails: {
        bankName: this.bankConfig.bankName,
        accountName: this.bankConfig.accountName,
        accountNumber: this.bankConfig.accountNumber
      },
      paymentReference: reference,
      plans: Object.values(APPROVED_SUBSCRIPTION_PLANS).map(p => ({
        id: p.id,
        name: p.name,
        priceKobo: p.priceKobo,
        durationDays: p.durationDays,
        gracePeriodDays: p.gracePeriodDays,
        features: p.features
      }))
    };
  }

  /**
   * Submits a manual bank-transfer payment proof for administrative verification.
   * 
   * @param {Object} params
   * @param {string} params.businessId
   * @param {string} params.userId
   * @param {string} params.planId
   * @param {string} params.paymentReference
   * @param {number} params.amount
   * @param {string} [params.proofImageUrl]
   * @returns {Promise<Object>}
   */
  async submitProof({ businessId, userId, planId, paymentReference, amount, proofImageUrl = null }) {
    if (!businessId || !userId) {
      throw new SubscriptionError('UNAUTHORIZED', 401, 'Authenticated user and tenant required.');
    }

    const plan = APPROVED_SUBSCRIPTION_PLANS[planId];
    if (!plan) {
      throw new SubscriptionError(
        'INVALID_PLAN',
        400,
        `Plan "${planId}" is not an approved subscription plan. Unapproved or legacy plans cannot be purchased.`
      );
    }

    if (!paymentReference || !/^REF-SB-[A-Z0-9_-]+$/i.test(paymentReference.trim())) {
      throw new SubscriptionError(
        'INVALID_PAYMENT_REFERENCE',
        400,
        'A valid REF-SB-XXXX reference code is required.'
      );
    }

    const cleanRef = paymentReference.trim().toUpperCase();

    // Verify uniqueness of reference code
    const existing = await this.SubscriptionModel.findOne({ paymentReference: cleanRef });
    if (existing) {
      throw new SubscriptionError(
        'DUPLICATE_PAYMENT_REFERENCE',
        409,
        `Payment reference "${cleanRef}" has already been submitted.`
      );
    }

    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
      throw new SubscriptionError(
        'INVALID_AMOUNT',
        400,
        'Payment amount must be a positive integer in Kobo.'
      );
    }

    const subscription = new this.SubscriptionModel({
      id: crypto.randomUUID(),
      businessId,
      planId,
      status: 'pending_verification',
      paymentReference: cleanRef,
      paymentAmount: amount,
      paymentMethod: 'bank_transfer',
      proofImageUrl,
      submittedBy: userId,
      submittedAt: new Date()
    });

    await subscription.save();

    await this.auditService.recordEvent({
      actorId: userId,
      actorRole: 'owner',
      businessId,
      action: 'SUBSCRIPTION_PROOF_SUBMITTED',
      targetType: 'subscription',
      targetId: subscription.id,
      metadata: { planId, amount, paymentReference: cleanRef }
    });

    return subscription;
  }

  /**
   * Retrieves pending subscriptions awaiting review.
   * 
   * @returns {Promise<Array>}
   */
  async getPendingSubscriptions() {
    return this.SubscriptionModel.find({ status: 'pending_verification' }).sort({ submittedAt: -1 });
  }

  /**
   * Reviews and decides on a pending subscription.
   * Enforces self-approval prevention: administrators cannot approve their own submissions.
   * 
   * @param {Object} params
   * @param {string} params.subscriptionId
   * @param {string} params.adminId
   * @param {'approve'|'reject'} params.decision
   * @param {string} [params.rejectionReason]
   * @returns {Promise<Object>}
   */
  async reviewSubscription({ subscriptionId, adminId, decision, rejectionReason = null }) {
    if (!subscriptionId || !adminId) {
      throw new SubscriptionError('INVALID_INPUT', 400, 'subscriptionId and adminId are required.');
    }

    const subscription = await this.SubscriptionModel.findOne({ id: subscriptionId });
    if (!subscription) {
      throw new SubscriptionError('SUBSCRIPTION_NOT_FOUND', 404, 'Subscription record not found.');
    }

    if (subscription.status !== 'pending_verification') {
      throw new SubscriptionError(
        'INVALID_SUBSCRIPTION_STATE',
        400,
        `Subscription status is "${subscription.status}", only pending_verification can be reviewed.`
      );
    }

    // CRITICAL: Self-Approval Prevention
    if (subscription.submittedBy === adminId) {
      throw new SubscriptionError(
        'FORBIDDEN_SELF_APPROVAL',
        403,
        'Self-approval is strictly forbidden. An independent administrator must review and approve this subscription.'
      );
    }

    const plan = APPROVED_SUBSCRIPTION_PLANS[subscription.planId];
    const now = new Date();

    if (decision === 'approve') {
      const expiresAt = new Date(now.getTime() + (plan ? plan.durationDays : 30) * 86400000);
      const gracePeriodUntil = new Date(expiresAt.getTime() + (plan ? plan.gracePeriodDays : 7) * 86400000);

      // Sign offline RS256 entitlement JWT
      const entitlementPayload = {
        iss: 'sb-manager-entitlement',
        sub: subscription.businessId,
        plan: subscription.planId,
        expiresAt: Math.floor(expiresAt.getTime() / 1000),
        gracePeriodUntil: Math.floor(gracePeriodUntil.getTime() / 1000),
        features: plan ? plan.features : ['basic'],
        jti: crypto.randomUUID(),
        iat: Math.floor(now.getTime() / 1000)
      };

      const entitlementToken = jwt.sign(entitlementPayload, this.signingKey, {
        algorithm: 'RS256',
        keyid: this.kid
      });

      subscription.status = 'active';
      subscription.reviewedBy = adminId;
      subscription.reviewedAt = now;
      subscription.activeFrom = now;
      subscription.expiresAt = expiresAt;
      subscription.gracePeriodUntil = gracePeriodUntil;
      subscription.entitlementToken = entitlementToken;

      await subscription.save();

      await this.auditService.recordEvent({
        actorId: adminId,
        actorRole: 'platform_admin',
        businessId: subscription.businessId,
        action: 'SUBSCRIPTION_APPROVED',
        targetType: 'subscription',
        targetId: subscription.id,
        metadata: {
          planId: subscription.planId,
          expiresAt: expiresAt.toISOString(),
          gracePeriodUntil: gracePeriodUntil.toISOString()
        }
      });

      return subscription;
    } else if (decision === 'reject') {
      subscription.status = 'rejected';
      subscription.reviewedBy = adminId;
      subscription.reviewedAt = now;
      subscription.rejectionReason = rejectionReason || 'Payment verification failed.';

      await subscription.save();

      await this.auditService.recordEvent({
        actorId: adminId,
        actorRole: 'platform_admin',
        businessId: subscription.businessId,
        action: 'SUBSCRIPTION_REJECTED',
        targetType: 'subscription',
        targetId: subscription.id,
        metadata: { rejectionReason: subscription.rejectionReason }
      });

      return subscription;
    } else {
      throw new SubscriptionError('INVALID_DECISION', 400, 'Decision must be "approve" or "reject".');
    }
  }

  /**
   * Retrieves active subscription and entitlement token for a tenant.
   * 
   * @param {string} businessId
   * @returns {Promise<Object|null>}
   */
  async getActiveSubscription(businessId) {
    if (!businessId) {
      throw new SubscriptionError('INVALID_BUSINESS_ID', 400, 'businessId is required.');
    }
    return this.SubscriptionModel.findOne({
      businessId,
      status: 'active',
      expiresAt: { $gt: new Date() }
    });
  }
}
