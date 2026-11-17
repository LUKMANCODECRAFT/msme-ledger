/**
 * SBM-041: Tenant Context, Authorization Middleware & Membership Migration Test Suite
 * Strictly adheres to SB Manager Rebuild Blueprint v2.1 Section 14.3, Section 23 and Phase 4 Architecture Plan.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createTenantMiddleware,
  requireTenantRole,
  preventSelfApproval
} from '../../server/src/middleware/tenantMiddleware.js';
import { AuditLogService } from '../../server/src/services/auditLogService.js';
import { MembershipMigrator } from '../domain/migration/membershipMigrator.js';

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

describe('SBM-041: Tenant Context & Authorization Suite', () => {
  let mockMembershipModel;
  let mockAuditModel;
  let tenantStore;
  let auditStore;

  beforeEach(() => {
    tenantStore = new Map();
    auditStore = [];

    mockMembershipModel = {
      findOne: vi.fn(async (query) => {
        for (const item of tenantStore.values()) {
          let match = true;
          for (const [k, v] of Object.entries(query)) {
            if (item[k] !== v) match = false;
          }
          if (match) return item;
        }
        return null;
      })
    };

    class MockAuditDoc {
      constructor(data) {
        Object.assign(this, data);
      }
      async save() {
        auditStore.push(this);
        return this;
      }
    }
    MockAuditDoc.find = vi.fn(async (q) => {
      const results = auditStore.filter(a => !q.businessId || a.businessId === q.businessId);
      return {
        sort: () => ({
          limit: (n) => results.slice(0, n)
        })
      };
    });
    mockAuditModel = MockAuditDoc;
  });

  describe('1. Tenant Resolution & Identity Derivation', () => {
    it('resolves businessId from X-Business-ID header', async () => {
      tenantStore.set('m_1', {
        id: 'm_1',
        userId: 'usr_1',
        businessId: 'biz_alpha',
        role: 'owner',
        status: 'active'
      });

      const middleware = createTenantMiddleware({ membershipModel: mockMembershipModel });
      const req = {
        headers: { 'x-business-id': 'biz_alpha' },
        user: { id: 'usr_1', defaultBusinessId: 'biz_default' },
        body: {},
        query: {}
      };
      const res = createMockResponse();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
      expect(req.tenant).toBeDefined();
      expect(req.tenant.businessId).toBe('biz_alpha');
      expect(req.tenant.role).toBe('owner');
    });

    it('falls back to req.user.defaultBusinessId when X-Business-ID is absent', async () => {
      tenantStore.set('m_2', {
        id: 'm_2',
        userId: 'usr_2',
        businessId: 'biz_default',
        role: 'manager',
        status: 'active'
      });

      const middleware = createTenantMiddleware({ membershipModel: mockMembershipModel });
      const req = {
        headers: {},
        user: { id: 'usr_2', defaultBusinessId: 'biz_default' },
        body: {},
        query: {}
      };
      const res = createMockResponse();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
      expect(req.tenant.businessId).toBe('biz_default');
      expect(req.tenant.role).toBe('manager');
    });

    it('rejects with 401 UNAUTHORIZED when req.user is absent', async () => {
      const middleware = createTenantMiddleware({ membershipModel: mockMembershipModel });
      const req = { headers: { 'x-business-id': 'biz_1' } };
      const res = createMockResponse();

      await middleware(req, res, () => {});

      expect(res.getStatus()).toBe(401);
      expect(res.getBody().error).toBe('UNAUTHORIZED');
    });

    it('rejects with 403 FORBIDDEN_TENANT_ACCESS when no businessId can be resolved', async () => {
      const middleware = createTenantMiddleware({ membershipModel: mockMembershipModel });
      const req = {
        headers: {},
        user: { id: 'usr_3', defaultBusinessId: null },
        body: {},
        query: {}
      };
      const res = createMockResponse();

      await middleware(req, res, () => {});

      expect(res.getStatus()).toBe(403);
      expect(res.getBody().error).toBe('FORBIDDEN_TENANT_ACCESS');
    });
  });

  describe('2. Parameter Pollution & Body/Query Forgery Defense', () => {
    it('rejects with 403 FORBIDDEN_TENANT_MISMATCH when req.body.businessId conflicts', async () => {
      const middleware = createTenantMiddleware({ membershipModel: mockMembershipModel });
      const req = {
        headers: { 'x-business-id': 'biz_valid' },
        user: { id: 'usr_1', defaultBusinessId: 'biz_valid' },
        body: { businessId: 'biz_forged_other' },
        query: {}
      };
      const res = createMockResponse();

      await middleware(req, res, () => {});

      expect(res.getStatus()).toBe(403);
      expect(res.getBody().error).toBe('FORBIDDEN_TENANT_MISMATCH');
    });

    it('rejects with 403 FORBIDDEN_TENANT_MISMATCH when req.body.shopId conflicts', async () => {
      const middleware = createTenantMiddleware({ membershipModel: mockMembershipModel });
      const req = {
        headers: { 'x-business-id': 'biz_valid' },
        user: { id: 'usr_1', defaultBusinessId: 'biz_valid' },
        body: { shopId: 'biz_spoofed' },
        query: {}
      };
      const res = createMockResponse();

      await middleware(req, res, () => {});

      expect(res.getStatus()).toBe(403);
      expect(res.getBody().error).toBe('FORBIDDEN_TENANT_MISMATCH');
    });

    it('rejects with 403 FORBIDDEN_TENANT_MISMATCH when req.query.businessId conflicts', async () => {
      const middleware = createTenantMiddleware({ membershipModel: mockMembershipModel });
      const req = {
        headers: { 'x-business-id': 'biz_valid' },
        user: { id: 'usr_1', defaultBusinessId: 'biz_valid' },
        body: {},
        query: { businessId: 'biz_spoofed_query' }
      };
      const res = createMockResponse();

      await middleware(req, res, () => {});

      expect(res.getStatus()).toBe(403);
      expect(res.getBody().error).toBe('FORBIDDEN_TENANT_MISMATCH');
    });
  });

  describe('3. Membership Verification & Revocation Handling', () => {
    it('rejects with 403 FORBIDDEN_TENANT_ACCESS when user has no membership in tenant', async () => {
      const middleware = createTenantMiddleware({ membershipModel: mockMembershipModel });
      const req = {
        headers: { 'x-business-id': 'biz_unauthorized' },
        user: { id: 'usr_intruder', defaultBusinessId: 'biz_unauthorized' },
        body: {},
        query: {}
      };
      const res = createMockResponse();

      await middleware(req, res, () => {});

      expect(res.getStatus()).toBe(403);
      expect(res.getBody().error).toBe('FORBIDDEN_TENANT_ACCESS');
    });

    it('rejects with 403 FORBIDDEN_MEMBERSHIP_REVOKED when membership status is revoked', async () => {
      tenantStore.set('m_revoked', {
        id: 'm_revoked',
        userId: 'usr_revoked',
        businessId: 'biz_revoked',
        role: 'cashier',
        status: 'revoked'
      });

      const middleware = createTenantMiddleware({ membershipModel: mockMembershipModel });
      const req = {
        headers: { 'x-business-id': 'biz_revoked' },
        user: { id: 'usr_revoked', defaultBusinessId: 'biz_revoked' },
        body: {},
        query: {}
      };
      const res = createMockResponse();

      await middleware(req, res, () => {});

      expect(res.getStatus()).toBe(403);
      expect(res.getBody().error).toBe('FORBIDDEN_MEMBERSHIP_REVOKED');
    });
  });

  describe('4. Role Enforcement & Guards', () => {
    it('allows access when user holds required role', () => {
      const guard = requireTenantRole(['owner', 'manager']);
      const req = { tenant: { role: 'owner' } };
      const res = createMockResponse();
      let nextCalled = false;

      guard(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('rejects with 403 FORBIDDEN_INSUFFICIENT_ROLE when user holds insufficient role', () => {
      const guard = requireTenantRole(['owner', 'manager']);
      const req = { tenant: { role: 'cashier' } };
      const res = createMockResponse();
      let nextCalled = false;

      guard(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.getStatus()).toBe(403);
      expect(res.getBody().error).toBe('FORBIDDEN_INSUFFICIENT_ROLE');
    });
  });

  describe('5. PlatformAdmin Boundaries & Self-Approval Prevention', () => {
    it('blocks self-approval when actor tries to approve their own request', () => {
      const guard = preventSelfApproval();
      const req = {
        user: { id: 'usr_admin_1' },
        body: { userId: 'usr_admin_1' }
      };
      const res = createMockResponse();
      let nextCalled = false;

      guard(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.getStatus()).toBe(403);
      expect(res.getBody().error).toBe('FORBIDDEN_SELF_APPROVAL');
    });

    it('allows approval when reviewer is independent from target user', () => {
      const guard = preventSelfApproval();
      const req = {
        user: { id: 'usr_admin_reviewer' },
        body: { userId: 'usr_merchant_applicant' }
      };
      const res = createMockResponse();
      let nextCalled = false;

      guard(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });
  });

  describe('6. Append-Only Audit Logging', () => {
    it('records immutable audit events with actor, target and metadata', async () => {
      const auditService = new AuditLogService({ auditModel: mockAuditModel });

      const entry = await auditService.recordEvent({
        actorId: 'usr_owner_1',
        actorRole: 'owner',
        businessId: 'biz_audit_test',
        action: 'MEMBERSHIP_ROLE_UPDATED',
        targetType: 'membership',
        targetId: 'm_target_99',
        metadata: { oldRole: 'cashier', newRole: 'manager' },
        ipAddress: '192.168.1.100'
      });

      expect(entry).toBeDefined();
      expect(entry.action).toBe('MEMBERSHIP_ROLE_UPDATED');
      expect(auditStore.length).toBe(1);
      expect(auditStore[0].targetId).toBe('m_target_99');
      expect(auditStore[0].metadata.newRole).toBe('manager');
    });
  });

  describe('7. Membership Migrator (Expand-and-Contract)', () => {
    it('migrates valid legacy user-shop associations and normalizes roles', async () => {
      const targetSaved = [];
      const targetStore = {
        saveMembership: async (m) => targetSaved.push(m)
      };

      const migrator = new MembershipMigrator({ targetStore });
      const legacyData = [
        { userId: 'u_1', shopId: 'shop_A', role: 'owner' },
        { userId: 'u_2', shopId: 'shop_A', role: 'staff' },
        { userId: 'u_3', shopId: 'shop_B', role: 'admin' }
      ];

      const report = await migrator.migrate(legacyData);

      expect(report.migratedCount).toBe(3);
      expect(report.quarantinedCount).toBe(0);
      expect(targetSaved.length).toBe(3);
      expect(targetSaved[1].role).toBe('cashier'); // 'staff' normalized to 'cashier'
      expect(targetSaved[2].role).toBe('owner'); // 'admin' normalized to 'owner'
    });

    it('isolates conflicting memberships into quarantine without data loss', async () => {
      const targetSaved = [];
      const targetStore = {
        saveMembership: async (m) => targetSaved.push(m)
      };

      const migrator = new MembershipMigrator({ targetStore });
      const legacyData = [
        { userId: 'u_conflict', shopId: 'shop_C', role: 'owner' },
        { userId: 'u_conflict', shopId: 'shop_C', role: 'cashier' } // Conflicting role for same pair!
      ];

      const report = await migrator.migrate(legacyData);

      expect(report.migratedCount).toBe(1);
      expect(report.quarantinedCount).toBe(1);
      expect(report.quarantinedRecords.length).toBe(1);
      expect(report.quarantinedRecords[0].reason).toBe('DUPLICATE_MEMBERSHIP_CONFLICT');
    });

    it('quarantines records with missing required references', async () => {
      const targetSaved = [];
      const targetStore = {
        saveMembership: async (m) => targetSaved.push(m)
      };

      const migrator = new MembershipMigrator({ targetStore });
      const legacyData = [
        { userId: '', shopId: 'shop_D', role: 'owner' },
        { userId: 'u_valid', shopId: null, role: 'owner' }
      ];

      const report = await migrator.migrate(legacyData);

      expect(report.migratedCount).toBe(0);
      expect(report.quarantinedCount).toBe(2);
    });

    it('enforces invariant that migrated businesses retain at least one owner', async () => {
      const targetSaved = [];
      const targetStore = {
        saveMembership: async (m) => targetSaved.push(m)
      };

      const migrator = new MembershipMigrator({ targetStore });
      // shop_no_owner only has cashier, no owner!
      const legacyData = [
        { userId: 'u_only_cashier', shopId: 'shop_no_owner', role: 'cashier' }
      ];

      const report = await migrator.migrate(legacyData);

      expect(report.quarantinedCount).toBe(1);
      expect(report.quarantinedRecords.some(r => r.reason === 'BUSINESS_LACKS_OWNER_INVARIANT_VIOLATION')).toBe(true);
    });
  });
});
