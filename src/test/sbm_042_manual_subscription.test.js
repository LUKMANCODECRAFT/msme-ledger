/**
 * SBM-042: Manual Bank-Transfer Subscription & Entitlement Test Suite
 * Strictly adheres to SB Manager Rebuild Blueprint v2.1 Section 15.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SubscriptionService,
  SubscriptionError,
  APPROVED_SUBSCRIPTION_PLANS
} from '../../server/src/services/subscriptionService.js';
import {
  verifyEntitlementOffline,
  unpackEntitlementToken
} from '../domain/subscription/entitlementVerifier.js';
import { generateTestRsaKeyPair } from '../../server/src/services/jwtService.js';
import { createSubscriptionController } from '../../server/src/controllers/subscriptionController.js';

function createMockResponse() {
  let statusSent = 200;
  let jsonSent = null;

  const res = {
    status(s) {
      statusSent = s;
      return res;
    },
    json(j) {
      jsonSent = j;
      return res;
    },
    getStatus: () => statusSent,
    getBody: () => jsonSent
  };
  return res;
}

describe('SBM-042: Manual Subscription & Offline Entitlements Suite', () => {
  let mockSubscriptionModel;
  let mockAuditService;
  let testKeyPair;
  let subscriptionStore;
  let auditLogs;
  let subscriptionService;

  beforeEach(() => {
    subscriptionStore = new Map();
    auditLogs = [];
    testKeyPair = generateTestRsaKeyPair('test-entitlement-kid');

    class MockSubscriptionDoc {
      constructor(data) {
        Object.assign(this, data);
      }
      async save() {
        subscriptionStore.set(this.id, this);
        return this;
      }
    }

    MockSubscriptionDoc.findOne = vi.fn(async (query) => {
      for (const item of subscriptionStore.values()) {
        let match = true;
        for (const [k, v] of Object.entries(query)) {
          if (k === 'expiresAt' && v && v.$gt) {
            if (!(item.expiresAt > v.$gt)) match = false;
          } else if (item[k] !== v) {
            match = false;
          }
        }
        if (match) return item;
      }
      return null;
    });

    MockSubscriptionDoc.find = vi.fn(async (query) => {
      const results = [];
      for (const item of subscriptionStore.values()) {
        let match = true;
        for (const [k, v] of Object.entries(query)) {
          if (item[k] !== v) match = false;
        }
        if (match) results.push(item);
      }
      return {
        sort: () => results
      };
    });

    mockSubscriptionModel = MockSubscriptionDoc;

    mockAuditService = {
      recordEvent: vi.fn(async (event) => {
        auditLogs.push(event);
        return event;
      })
    };

    subscriptionService = new SubscriptionService({
      subscriptionModel: mockSubscriptionModel,
      auditService: mockAuditService,
      signingKey: testKeyPair.privateKey,
      kid: testKeyPair.kid,
      allowTestKeyFallback: true
    });
  });

  describe('1. Dynamic Instructions & Reference Generation', () => {
    it('returns dynamic bank details and unique reference code', () => {
      const instructions = subscriptionService.getInstructions({ businessId: 'biz_sample' });

      expect(instructions.bankDetails).toBeDefined();
      expect(instructions.bankDetails.bankName).toBe('UBA');
      expect(instructions.bankDetails.accountNumber).toBe('2453591351');
      expect(instructions.paymentReference).toMatch(/^REF-SB-[A-F0-9]{8}$/);
      expect(instructions.plans.length).toBe(2);
      expect(instructions.plans[0].id).toBe('pro');
      expect(instructions.plans[0].priceKobo).toBe(500000); // 5,000 NGN
    });
  });

  describe('2. Proof Submission & Invariant Defense', () => {
    it('accepts valid payment proof with pending_verification status', async () => {
      const sub = await subscriptionService.submitProof({
        businessId: 'biz_merch_1',
        userId: 'usr_merch_1',
        planId: 'pro',
        paymentReference: 'REF-SB-ABCD1234',
        amount: 500000,
        proofImageUrl: 'https://storage.test/receipts/proof_1.png'
      });

      expect(sub).toBeDefined();
      expect(sub.status).toBe('pending_verification');
      expect(sub.paymentReference).toBe('REF-SB-ABCD1234');
      expect(sub.paymentAmount).toBe(500000);
      expect(sub.paymentMethod).toBe('bank_transfer');
      expect(auditLogs.length).toBe(1);
      expect(auditLogs[0].action).toBe('SUBSCRIPTION_PROOF_SUBMITTED');
    });

    it('rejects duplicate payment references with 409 Conflict', async () => {
      await subscriptionService.submitProof({
        businessId: 'biz_merch_1',
        userId: 'usr_merch_1',
        planId: 'pro',
        paymentReference: 'REF-SB-DUPLICATE',
        amount: 500000
      });

      await expect(
        subscriptionService.submitProof({
          businessId: 'biz_merch_2',
          userId: 'usr_merch_2',
          planId: 'pro',
          paymentReference: 'REF-SB-DUPLICATE',
          amount: 500000
        })
      ).rejects.toThrow(SubscriptionError);
    });

    it('strictly rejects unapproved plans or Paystack recurring charges', async () => {
      await expect(
        subscriptionService.submitProof({
          businessId: 'biz_merch_1',
          userId: 'usr_merch_1',
          planId: 'paystack_recurring_vip',
          paymentReference: 'REF-SB-UNAPPROVED',
          amount: 999999
        })
      ).rejects.toThrow(/not an approved subscription plan/);
    });

    it('rejects invalid or non-integer amounts', async () => {
      await expect(
        subscriptionService.submitProof({
          businessId: 'biz_merch_1',
          userId: 'usr_merch_1',
          planId: 'pro',
          paymentReference: 'REF-SB-INVALIDAMT',
          amount: 5000.50 // Not integer Kobo!
        })
      ).rejects.toThrow(/positive integer in Kobo/);
    });
  });

  describe('3. Admin Review & Self-Approval Prevention', () => {
    it('blocks self-approval when admin tries to approve their own submission', async () => {
      const sub = await subscriptionService.submitProof({
        businessId: 'biz_admin_personal',
        userId: 'usr_admin_john',
        planId: 'pro',
        paymentReference: 'REF-SB-SELFAPPR',
        amount: 500000
      });

      await expect(
        subscriptionService.reviewSubscription({
          subscriptionId: sub.id,
          adminId: 'usr_admin_john', // Same user!
          decision: 'approve'
        })
      ).rejects.toThrow(/Self-approval is strictly forbidden/);
    });

    it('allows independent administrator to approve and issue RS256 entitlement token', async () => {
      const sub = await subscriptionService.submitProof({
        businessId: 'biz_merchant_mary',
        userId: 'usr_mary',
        planId: 'pro',
        paymentReference: 'REF-SB-MARY0001',
        amount: 500000
      });

      const approved = await subscriptionService.reviewSubscription({
        subscriptionId: sub.id,
        adminId: 'usr_admin_independent',
        decision: 'approve'
      });

      expect(approved.status).toBe('active');
      expect(approved.reviewedBy).toBe('usr_admin_independent');
      expect(approved.activeFrom).toBeInstanceOf(Date);
      expect(approved.expiresAt).toBeInstanceOf(Date);
      expect(approved.gracePeriodUntil).toBeInstanceOf(Date);
      expect(approved.entitlementToken).toBeDefined();

      // Verify token unpacks cryptographically
      const unpacked = unpackEntitlementToken(approved.entitlementToken, testKeyPair.publicKey);
      expect(unpacked.sub).toBe('biz_merchant_mary');
      expect(unpacked.plan).toBe('pro');
      expect(unpacked.features).toContain('inventory_valuation');

      // Verify audit entry
      expect(auditLogs.some(l => l.action === 'SUBSCRIPTION_APPROVED')).toBe(true);
    });

    it('records administrative rejection and stores reason', async () => {
      const sub = await subscriptionService.submitProof({
        businessId: 'biz_merchant_fake',
        userId: 'usr_fake',
        planId: 'pro',
        paymentReference: 'REF-SB-FAKE0001',
        amount: 500000
      });

      const rejected = await subscriptionService.reviewSubscription({
        subscriptionId: sub.id,
        adminId: 'usr_admin_independent',
        decision: 'reject',
        rejectionReason: 'Bank receipt does not match transaction statement.'
      });

      expect(rejected.status).toBe('rejected');
      expect(rejected.rejectionReason).toBe('Bank receipt does not match transaction statement.');
      expect(auditLogs.some(l => l.action === 'SUBSCRIPTION_REJECTED')).toBe(true);
    });
  });

  describe('4. Offline Entitlement Verification & Anti-Clock-Tampering (Blueprint Section 15.2)', () => {
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const expiresAt = now + 10 * ONE_DAY_MS;
    const gracePeriodUntil = expiresAt + 7 * ONE_DAY_MS;

    const entitlement = {
      expiresAt,
      gracePeriodUntil
    };

    it('detects clock tampering when device clock is behind last known server time', () => {
      const lastKnownServerTime = now;
      const tamperedLocalClock = now - 5 * ONE_DAY_MS; // Clock rolled back 5 days!

      const outcome = verifyEntitlementOffline(entitlement, tamperedLocalClock, lastKnownServerTime);

      expect(outcome.status).toBe('clock_tampered_locked');
      expect(outcome.readOnly).toBe(true);
    });

    it('returns active status when clock is within valid subscription period', () => {
      const lastKnownServerTime = now;
      const currentLocalClock = now + 1 * ONE_DAY_MS;

      const outcome = verifyEntitlementOffline(entitlement, currentLocalClock, lastKnownServerTime);

      expect(outcome.status).toBe('active');
      expect(outcome.readOnly).toBe(false);
    });

    it('returns in_grace_period status when clock exceeds expiresAt but remains within grace period', () => {
      const lastKnownServerTime = now;
      const currentLocalClock = expiresAt + 2 * ONE_DAY_MS; // 2 days past expiry

      const outcome = verifyEntitlementOffline(entitlement, currentLocalClock, lastKnownServerTime);

      expect(outcome.status).toBe('in_grace_period');
      expect(outcome.readOnly).toBe(false); // Retains full access during grace period
    });

    it('returns expired status when clock exceeds grace period', () => {
      const lastKnownServerTime = now;
      const currentLocalClock = gracePeriodUntil + 1 * ONE_DAY_MS; // 1 day past grace period

      const outcome = verifyEntitlementOffline(entitlement, currentLocalClock, lastKnownServerTime);

      expect(outcome.status).toBe('expired');
      expect(outcome.readOnly).toBe(true);
    });

    it('returns unsubscribed status when entitlement is absent', () => {
      const outcome = verifyEntitlementOffline(null, now, now - 1000);
      expect(outcome.status).toBe('unsubscribed');
      expect(outcome.readOnly).toBe(true);
    });
  });

  describe('5. HTTP Controller Integration', () => {
    it('returns instructions via GET /api/v2/subscription/instructions', async () => {
      const controller = createSubscriptionController(subscriptionService);
      const req = { tenant: { businessId: 'biz_http_test' } };
      const res = createMockResponse();

      await controller.getInstructions(req, res);

      expect(res.getStatus()).toBe(200);
      expect(res.getBody().success).toBe(true);
      expect(res.getBody().bankDetails).toBeDefined();
    });

    it('blocks non-admin users from viewing pending admin queue', async () => {
      const controller = createSubscriptionController(subscriptionService);
      const req = { user: { id: 'usr_regular', role: 'owner', isPlatformAdmin: false } };
      const res = createMockResponse();

      await controller.getPendingAdmin(req, res);

      expect(res.getStatus()).toBe(403);
      expect(res.getBody().error).toBe('FORBIDDEN_PLATFORM_ADMIN_REQUIRED');
    });
  });
});
