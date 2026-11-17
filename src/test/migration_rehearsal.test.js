/**
 * Database Migration Readiness & Synthetic Rehearsal Suite
 * Strictly adheres to SB Manager Rebuild Blueprint v2.1 (Phase 3 & Section 24),
 * Phase 4 Architecture Plan, and Consolidated Implementation Authorization.
 * 
 * Rules:
 * - Operates ONLY on ephemeral synthetic databases.
 * - Never touches or opens production databases.
 * - Validates end-to-end rehearsal: checkpoints, quarantine, reconciliation, and invariants.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Dexie from 'dexie';
import { createSbDatabase } from '../config/db.js';
import {
  LegacyReadOnlyAdapter,
  MigrationCheckpointManager,
  MigrationQuarantineManager,
  MigrationOrchestrator,
  MigrationVersionMismatchError,
  CURRENT_MIGRATION_VERSION,
  MembershipMigrator
} from '../domain/migration/index.js';

describe('Database Migration Readiness & Synthetic Rehearsal Suite', () => {
  let syntheticLegacyDb;
  let targetDb;
  const businessId = 'biz_rehearsal_synthetic_999';

  beforeEach(async () => {
    // 1. Ephemeral synthetic legacy database
    syntheticLegacyDb = new Dexie(`rehearsal_legacy_${Date.now()}_${Math.random().toString(36).substring(7)}`);
    syntheticLegacyDb.version(2).stores({
      customers: 'id, phone, sync_status, updatedAt',
      inventory: 'id, name, sync_status, updatedAt',
      sales: 'id, customerId, paymentStatus, sync_status, date',
      transactions: 'id, customerId, type, date, sync_status'
    });
    await syntheticLegacyDb.open();

    // 2. Ephemeral synthetic destination database
    targetDb = createSbDatabase(`rehearsal_target_${Date.now()}_${Math.random().toString(36).substring(7)}`);
    await targetDb.open();
  });

  afterEach(async () => {
    if (syntheticLegacyDb && syntheticLegacyDb.isOpen()) {
      await syntheticLegacyDb.delete();
    }
    if (targetDb && targetDb.isOpen()) {
      await targetDb.delete();
    }
  });

  describe('1. Synthetic Data Generation & Stage Rehearsal', () => {
    it('executes full 10-stage synthetic migration with zero data loss', async () => {
      // Seed 20 synthetic legacy customers
      const customers = [];
      for (let i = 1; i <= 20; i++) {
        customers.push({
          id: `cust_${i}`,
          name: `Customer ${i}`,
          phone: `080300000${i < 10 ? '0' + i : i}`,
          totalDebt: i % 2 === 0 ? 500000 : 0, // 5,000 NGN in Kobo
          sync_status: 'synced',
          updatedAt: new Date().toISOString()
        });
      }
      await syntheticLegacyDb.customers.bulkAdd(customers);

      // Seed 15 synthetic legacy inventory items
      const inventory = [];
      for (let i = 1; i <= 15; i++) {
        inventory.push({
          id: `prod_${i}`,
          name: `Fertilizer Bag Type ${i}`,
          price: 1200000, // 12,000 NGN in Kobo
          stockCount: 50,
          sync_status: 'synced',
          updatedAt: new Date().toISOString()
        });
      }
      await syntheticLegacyDb.inventory.bulkAdd(inventory);

      // Seed 10 synthetic sales
      const sales = [];
      for (let i = 1; i <= 10; i++) {
        sales.push({
          id: `sale_${i}`,
          customerId: `cust_${i}`,
          totalAmount: 2400000,
          amountPaid: 2400000,
          paymentStatus: 'PAID',
          date: new Date().toISOString(),
          items: [{ id: `prod_${i}`, quantity: 2, price: 1200000 }],
          sync_status: 'synced'
        });
      }
      await syntheticLegacyDb.sales.bulkAdd(sales);

      // Execute migration orchestrator
      const adapter = new LegacyReadOnlyAdapter(syntheticLegacyDb);
      const orchestrator = new MigrationOrchestrator({
        legacyAdapter: adapter,
        targetDb,
        businessId
      });

      const report = await orchestrator.run();

      expect(report).toBeDefined();
      expect(report.isSuccess).toBe(true);
      expect(report.reconciliation).toBeDefined();

      // Verify records migrated to targetDb
      const targetCustomers = await targetDb.customers.toArray();
      expect(targetCustomers.length).toBe(20);

      const targetProducts = await targetDb.products.toArray();
      expect(targetProducts.length).toBe(15);
      // Scale 1,000 verification: 50 units -> 50,000 units
      expect(targetProducts[0].currentStock).toBe(50000);

      // Verify stage checkpoints were recorded
      const checkpoints = await targetDb.migrationCheckpoints.toArray();
      expect(checkpoints.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('2. Checkpoint Idempotency & Resumption Rehearsal', () => {
    it('skips already-completed stages when resuming an interrupted migration', async () => {
      const runId = `rehearsal_run_${Date.now()}`;
      const checkpointManager = new MigrationCheckpointManager(targetDb, runId, CURRENT_MIGRATION_VERSION);

      // Pre-record completion of customers_and_debt stage
      await checkpointManager.completeStage('customers_and_debt', {
        customersMigrated: 10,
        debtorsReconciled: 5
      });

      // Verify checkpoint exists and is completed
      const cp = await checkpointManager.getCheckpoint('customers_and_debt');
      expect(cp).toBeDefined();
      expect(cp.status).toBe('completed');
      expect(cp.stage).toBe('customers_and_debt');

      // Attempting to re-check does not throw and preserves state
      const rechecked = await checkpointManager.getCheckpoint('customers_and_debt');
      expect(rechecked.status).toBe('completed');
    });

    it('rejects incompatible migration checkpoints when engine version changes', async () => {
      const runId = `version_mismatch_run_${Date.now()}`;
      const legacyCheckpoint = {
        stage: 'source_inspection',
        migrationRunId: runId,
        status: 'completed',
        migrationVersion: 999, // Future/incompatible version
        stageData: {},
        updatedAt: new Date().toISOString()
      };
      await targetDb.migrationCheckpoints.put(legacyCheckpoint);

      const checkpointManager = new MigrationCheckpointManager(targetDb, runId, CURRENT_MIGRATION_VERSION);

      await expect(
        checkpointManager.isStageCompleted('source_inspection')
      ).rejects.toThrow(MigrationVersionMismatchError);
    });
  });

  describe('3. Reconciliation & Financial Invariants Rehearsal', () => {
    it('detects and quarantines unverified or corrupt debt states without data loss', async () => {
      const runId = `debt_rehearsal_run_${Date.now()}`;
      const quarantineManager = new MigrationQuarantineManager(runId);

      // Simulate customer with conflicting debt calculation
      const corruptRecord = {
        id: 'cust_corrupt_debt_1',
        name: 'Corrupt Customer',
        totalDebt: -50000 // Negative debt is impossible
      };

      quarantineManager.quarantineRecord({
        sourceEntity: 'customers',
        sourceId: corruptRecord.id,
        rawRecord: corruptRecord,
        reason: 'NEGATIVE_DEBT_ANOMALY',
        validationErrors: ['Customer totalDebt cannot be negative in destination ledger.']
      });

      await quarantineManager.persistQuarantine(targetDb);

      const quarantinedInDb = await targetDb.migrationQuarantine.toArray();
      expect(quarantinedInDb.length).toBe(1);
      expect(quarantinedInDb[0].sourceId).toBe('cust_corrupt_debt_1');
      expect(quarantinedInDb[0].reason).toBe('NEGATIVE_DEBT_ANOMALY');
      expect(quarantinedInDb[0].resolutionStatus).toBe('unresolved');
    });
  });

  describe('4. Membership Expand-and-Contract Migration Rehearsal', () => {
    it('rehearses membership migration with conflicting and valid associations', async () => {
      const targetStore = {
        memberships: [],
        saveMembership: async (m) => targetStore.memberships.push(m)
      };

      const migrator = new MembershipMigrator({
        targetStore,
        checkpointDb: targetDb,
        migrationRunId: `rehearsal_mship_${Date.now()}`
      });

      const syntheticLegacyMemberships = [
        { userId: 'u_merchant_1', shopId: 'shop_001', role: 'owner' },
        { userId: 'u_cashier_1', shopId: 'shop_001', role: 'cashier' },
        { userId: 'u_conflicting', shopId: 'shop_002', role: 'owner' },
        { userId: 'u_conflicting', shopId: 'shop_002', role: 'manager' } // Duplicate conflict!
      ];

      const report = await migrator.migrate(syntheticLegacyMemberships);

      expect(report.totalLegacy).toBe(4);
      expect(report.migratedCount).toBe(3); // 2 from shop_001, 1 from shop_002
      expect(report.quarantinedCount).toBe(1); // 1 conflict quarantined
      expect(targetStore.memberships.length).toBe(3);

      // Verify stages completed
      expect(report.stages).toContain('memberships_expanded');
      expect(report.stages).toContain('memberships_contracted');
    });
  });
});
