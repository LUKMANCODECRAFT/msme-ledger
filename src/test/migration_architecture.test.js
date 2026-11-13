import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Dexie from 'dexie';
import { createSbDatabase } from '../config/db.js';
import {
  LegacyReadOnlyAdapter,
  MigrationCheckpointManager,
  MigrationQuarantineManager,
  MigrationOrchestrator,
  MigrationVersionMismatchError,
  CURRENT_MIGRATION_VERSION,
  classifyCurrency,
  CURRENCY_CLASSIFICATION
} from '../domain/migration/index.js';

describe('SBM-030: Controlled Migration Architecture & Remediations', () => {
  let syntheticLegacyDb;
  let targetDb;
  const businessId = 'biz-synthetic-001';

  beforeEach(async () => {
    // 1. Create isolated synthetic legacy database
    syntheticLegacyDb = new Dexie(`synthetic_legacy_${Date.now()}`);
    syntheticLegacyDb.version(2).stores({
      customers: 'id, phone, sync_status, updatedAt',
      inventory: 'id, name, sync_status, updatedAt',
      sales: 'id, customerId, paymentStatus, sync_status, date',
      transactions: 'id, customerId, type, date, sync_status'
    });
    await syntheticLegacyDb.open();

    // 2. Create isolated destination database (with migrationQuarantine store)
    targetDb = createSbDatabase(`synthetic_target_${Date.now()}`);
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

  describe('3.1 Database Isolation & Read-Only Adapter Boundaries (SBM-030-B)', () => {
    it('strictly encapsulates raw Dexie instance via private field #db and prohibits writes/lifecycle', async () => {
      const adapter = new LegacyReadOnlyAdapter(syntheticLegacyDb);

      // Verify public interface provides ONLY safe query methods
      expect(typeof adapter.inspectSource).toBe('function');
      expect(typeof adapter.fetchCustomers).toBe('function');
      expect(typeof adapter.fetchInventory).toBe('function');
      expect(typeof adapter.fetchSales).toBe('function');
      expect(typeof adapter.fetchTransactions).toBe('function');

      // SBM-030-B: Verify raw database instance is NOT exposed publicly
      expect(adapter._db).toBeUndefined();
      expect(adapter.rawDb).toBeUndefined();
      expect(Object.keys(adapter)).toEqual([]);
      expect(Object.getOwnPropertyNames(adapter)).toEqual([]);

      // Verify dangerous lifecycle methods are NOT exposed on adapter
      expect(adapter.delete).toBeUndefined();
      expect(adapter.version).toBeUndefined();
      expect(adapter.open).toBeUndefined();
      expect(adapter.close).toBeUndefined();
      expect(adapter.transaction).toBeUndefined();
      expect(adapter.table).toBeUndefined();

      // Seed a customer in legacy
      await syntheticLegacyDb.customers.add({
        id: 'cust-iso-01',
        name: 'Isolation Test Merchant',
        totalDebt: 100000
      });

      // Verify adapter fetches deep-cloned records
      const fetched = await adapter.fetchCustomers();
      expect(fetched.length).toBe(1);
      expect(fetched[0].name).toBe('Isolation Test Merchant');

      // Mutating the fetched in-memory object must not alter legacy Dexie record
      fetched[0].name = 'MUTATED IN MEMORY';
      const originalInDb = await syntheticLegacyDb.customers.get('cust-iso-01');
      expect(originalInDb.name).toBe('Isolation Test Merchant');
    });
  });

  describe('3.3 Durable Migration Checkpoints & Version Invalidation (SBM-030-D)', () => {
    it('tracks stage progression, records resumption points, and skips completed stages under matching version', async () => {
      const checkpointManager = new MigrationCheckpointManager(targetDb, 'run_chk_01', 1);

      // 1. Start stage
      const cp1 = await checkpointManager.startStage('customers_and_debt', 50);
      expect(cp1.status).toBe('in_progress');
      expect(cp1.totalRecords).toBe(50);
      expect(cp1.migrationVersion).toBe(1);

      // 2. Update progress
      await checkpointManager.updateProgress('customers_and_debt', {
        processedRecords: 25,
        successfulRecords: 24,
        quarantinedRecords: 1,
        lastProcessedId: 'cust-uuid-025'
      });

      const updated = await checkpointManager.getCheckpoint('customers_and_debt');
      expect(updated.processedRecords).toBe(25);
      expect(updated.lastProcessedId).toBe('cust-uuid-025');

      // 3. Complete stage
      await checkpointManager.completeStage('customers_and_debt', {
        processedRecords: 50,
        successfulRecords: 48,
        quarantinedRecords: 2
      });

      expect(await checkpointManager.isStageCompleted('customers_and_debt')).toBe(true);

      // 4. Starting an already completed stage returns completed without overwriting
      const restarted = await checkpointManager.startStage('customers_and_debt', 50);
      expect(restarted.status).toBe('completed');
    });

    it('records failure details when a stage fails', async () => {
      const checkpointManager = new MigrationCheckpointManager(targetDb, 'run_fail_01');
      await checkpointManager.startStage('inventory_and_stock', 10);
      await checkpointManager.failStage('inventory_and_stock', new Error('Simulated network timeout'));

      const failedCp = await checkpointManager.getCheckpoint('inventory_and_stock');
      expect(failedCp.status).toBe('failed');
      expect(failedCp.errorDetails.message).toBe('Simulated network timeout');
    });

    it('rejects completed stages recorded under incompatible migration version (SBM-030-D)', async () => {
      // Step 1: Complete stage with version 1
      const managerV1 = new MigrationCheckpointManager(targetDb, 'run_v1', 1);
      await managerV1.startStage('customers_and_debt', 10);
      await managerV1.completeStage('customers_and_debt', { successfulRecords: 10 });

      expect(await managerV1.isStageCompleted('customers_and_debt')).toBe(true);

      // Step 2: Initialize manager with version 2 (upgraded engine)
      const managerV2 = new MigrationCheckpointManager(targetDb, 'run_v2', 2);

      // isStageCompleted must throw MigrationVersionMismatchError rather than silently reusing
      await expect(managerV2.isStageCompleted('customers_and_debt')).rejects.toThrow(
        MigrationVersionMismatchError
      );

      // startStage must also reject incompatible version
      await expect(managerV2.startStage('customers_and_debt', 10)).rejects.toThrow(
        /Migration version mismatch for stage "customers_and_debt"/
      );

      // Explicit reset clears the incompatible checkpoint
      await managerV2.resetCheckpoint('customers_and_debt');
      expect(await managerV2.isStageCompleted('customers_and_debt')).toBe(false);

      // Now can start cleanly on version 2
      const cpV2 = await managerV2.startStage('customers_and_debt', 10);
      expect(cpV2.migrationVersion).toBe(2);
      expect(cpV2.status).toBe('in_progress');
    });
  });

  describe('3.5 Dedicated Migration Quarantine Storage (SBM-030-A)', () => {
    it('persists individual quarantine records into migrationQuarantine table with indexing and resolution history', async () => {
      const quarantine = new MigrationQuarantineManager('run_quar_01');

      // Quarantine two different entity types
      const badCust = { id: 'cust-bad-99', name: '', totalDebt: -9999 };
      quarantine.quarantineRecord({
        sourceEntity: 'customers',
        sourceId: 'cust-bad-99',
        rawRecord: badCust,
        reason: 'MALFORMED_CUSTOMER_DATA',
        validationErrors: ['Name is empty', 'Debt is negative']
      });

      const badSale = { id: 'sale-bad-01', totalAmount: 'one million' };
      quarantine.quarantineRecord({
        sourceEntity: 'sales',
        sourceId: 'sale-bad-01',
        rawRecord: badSale,
        reason: 'NON_NUMERIC_AMOUNT',
        validationErrors: ['Amount is string']
      });

      expect(quarantine.getCount()).toBe(2);

      // Persist to target DB dedicated table
      await quarantine.persistQuarantine(targetDb);

      // 1. Verify table counts and primary key lookup
      expect(await targetDb.migrationQuarantine.count()).toBe(2);
      const custRecord = await MigrationQuarantineManager.loadPersistedQuarantine(targetDb, {
        quarantineId: 'quar_customers_cust-bad-99'
      });
      expect(custRecord).toBeDefined();
      expect(custRecord.sourceEntity).toBe('customers');
      expect(custRecord.sourceId).toBe('cust-bad-99');
      expect(custRecord.rawRecord.totalDebt).toBe(-9999);
      expect(custRecord.resolutionStatus).toBe('unresolved');

      // 2. Verify indexed queries by sourceEntity
      const salesQuarantined = await MigrationQuarantineManager.loadPersistedQuarantine(targetDb, {
        sourceEntity: 'sales'
      });
      expect(salesQuarantined.length).toBe(1);
      expect(salesQuarantined[0].sourceId).toBe('sale-bad-01');

      // 3. Resolve single record and verify audit history
      const resolved = await MigrationQuarantineManager.resolveQuarantine(
        targetDb,
        'quar_customers_cust-bad-99',
        {
          resolutionStatus: 'resolved',
          resolvedBy: 'lead_accountant',
          notes: 'Customer debt verified as ₦0 opening balance',
          resolvedPayload: { totalDebt: 0 }
        }
      );

      expect(resolved.resolutionStatus).toBe('resolved');
      expect(resolved.resolutionHistory.length).toBe(1);
      expect(resolved.resolutionHistory[0].previousStatus).toBe('unresolved');
      expect(resolved.resolutionHistory[0].newStatus).toBe('resolved');
      expect(resolved.resolutionHistory[0].resolvedBy).toBe('lead_accountant');

      // Ensure other record remains untouched
      const saleRecord = await MigrationQuarantineManager.loadPersistedQuarantine(targetDb, {
        quarantineId: 'quar_sales_sale-bad-01'
      });
      expect(saleRecord.resolutionStatus).toBe('unresolved');
      expect(saleRecord.resolutionHistory.length).toBe(0);

      // 4. Repeated migration run preserves existing resolution status and history!
      const quarantineRun2 = new MigrationQuarantineManager('run_quar_02');
      quarantineRun2.quarantineRecord({
        sourceEntity: 'customers',
        sourceId: 'cust-bad-99',
        rawRecord: badCust,
        reason: 'MALFORMED_CUSTOMER_DATA',
        validationErrors: ['Name is empty', 'Debt is negative']
      });

      await quarantineRun2.persistQuarantine(targetDb);

      const reloadedCust = await MigrationQuarantineManager.loadPersistedQuarantine(targetDb, {
        quarantineId: 'quar_customers_cust-bad-99'
      });
      // Prior resolution status and history MUST NOT be reset to unresolved
      expect(reloadedCust.resolutionStatus).toBe('resolved');
      expect(reloadedCust.resolutionHistory.length).toBe(1);
    });

    it('handles deterministic duplicate quarantine records within a single run', () => {
      const quarantine = new MigrationQuarantineManager('run_dup_01');

      const raw = { id: 'cust-01', name: '' };
      quarantine.quarantineRecord({
        sourceEntity: 'customers',
        sourceId: 'cust-01',
        rawRecord: raw,
        reason: 'MISSING_NAME',
        validationErrors: ['Name missing']
      });

      // Second identical call
      quarantine.quarantineRecord({
        sourceEntity: 'customers',
        sourceId: 'cust-01',
        rawRecord: raw,
        reason: 'MISSING_NAME',
        validationErrors: ['Name missing', 'Additional check failed']
      });

      // Must deduplicate to 1 record with combined validation errors
      expect(quarantine.getCount()).toBe(1);
      const record = quarantine.getQuarantined('customers')[0];
      expect(record.validationErrors).toEqual(['Name missing', 'Additional check failed']);
    });
  });

  describe('3.6 Legacy Currency Classifier Rules', () => {
    it('enforces the non-negotiable rule: never assume integer >= 50 represents Kobo without evidence', () => {
      // Uncorroborated integer with expectedUnit AUTO and no linked evidence -> AMBIGUOUS
      const result = classifyCurrency(500, { expectedUnit: 'AUTO', hasLinkedEvidence: false });
      expect(result.status).toBe(CURRENCY_CLASSIFICATION.AMBIGUOUS_QUARANTINE);
      expect(result.reason).toBe('AMBIGUOUS_CURRENCY_MAGNITUDE_NO_EVIDENCE');

      // With linked transaction evidence -> VERIFIED_KOBO
      const verifiedResult = classifyCurrency(500, { expectedUnit: 'AUTO', hasLinkedEvidence: true });
      expect(verifiedResult.status).toBe(CURRENCY_CLASSIFICATION.VERIFIED_KOBO);
      expect(verifiedResult.koboAmount).toBe(500);

      // Explicit KOBO contract -> VERIFIED_KOBO
      const koboContract = classifyCurrency(950000, { expectedUnit: 'KOBO' });
      expect(koboContract.status).toBe(CURRENCY_CLASSIFICATION.VERIFIED_KOBO);
      expect(koboContract.koboAmount).toBe(950000);

      // Explicit NAIRA contract -> converts x100
      const nairaContract = classifyCurrency(5000, { expectedUnit: 'NAIRA' });
      expect(nairaContract.status).toBe(CURRENCY_CLASSIFICATION.VERIFIED_NAIRA);
      expect(nairaContract.koboAmount).toBe(500000);

      // Zero is always verified
      expect(classifyCurrency(0).status).toBe(CURRENCY_CLASSIFICATION.ZERO_BALANCE);

      // Fractional decimal -> AMBIGUOUS_QUARANTINE
      expect(classifyCurrency(50.5).status).toBe(CURRENCY_CLASSIFICATION.AMBIGUOUS_QUARANTINE);
    });
  });

  describe('3.2, 3.7 & SBM-030-C Full Synthetic Migration Pipeline & Failure Trapping', () => {
    it('executes end-to-end synthetic migration with multi-store transactions, stock movements, and zero variance', async () => {
      // 1. Seed synthetic legacy dataset
      await syntheticLegacyDb.customers.bulkAdd([
        { id: 'c1', name: 'Alhaji Gambo', phone: '08012345678', totalDebt: 1000000, updatedAt: new Date() }, // ₦10,000 debt
        { id: 'c2', name: 'Mrs Adebayo', phone: '08087654321', totalDebt: 0, updatedAt: new Date() },          // ₦0 debt
        { id: 'c3', name: '', totalDebt: 500000 } // INVALID: missing name -> will quarantine
      ]);

      await syntheticLegacyDb.inventory.bulkAdd([
        { id: 'inv1', name: 'Cement 50kg', price: 950000, stockCount: 20, updatedAt: new Date() }, // 20 units @ ₦9,500
        { id: 'inv2', name: 'Iron Rod 12mm', price: 450000, stockCount: 0, updatedAt: new Date() }  // 0 stock
      ]);

      await syntheticLegacyDb.transactions.bulkAdd([
        { id: 'tx1', customerId: 'c1', type: 'PAYMENT', amount: 300000, date: new Date(), paymentMethod: 'cash' } // ₦3,000 repayment
      ]);

      await syntheticLegacyDb.sales.bulkAdd([
        {
          id: 'sale1',
          customerId: 'c1',
          totalAmount: 1900000, // ₦19,000
          amountPaid: 900000,   // ₦9,000 paid
          balance: 1000000,     // ₦10,000 debt
          paymentStatus: 'partial',
          date: new Date()
        }
      ]);

      const adapter = new LegacyReadOnlyAdapter(syntheticLegacyDb);
      const orchestrator = new MigrationOrchestrator({
        legacyAdapter: adapter,
        targetDb,
        businessId,
        options: {
          migrationRunId: 'test_pipeline_run_01',
          currencyContext: { expectedUnit: 'KOBO', hasLinkedEvidence: true }
        }
      });

      // 2. Run migration
      const result = await orchestrator.run();

      expect(result.isSuccess).toBe(true);
      expect(result.quarantinedCount).toBe(1); // Customer c3 quarantined

      // Verify quarantine record in dedicated table
      const quarCust = await MigrationQuarantineManager.loadPersistedQuarantine(targetDb, {
        quarantineId: 'quar_customers_c3'
      });
      expect(quarCust).toBeDefined();
      expect(quarCust.sourceId).toBe('c3');

      // 3. Verify destination records
      const destCustomers = await targetDb.customers.toArray();
      expect(destCustomers.length).toBe(2);

      // Debt reconciliation (SBM-031):
      const destCreditEntries = await targetDb.creditEntries.toArray();
      expect(destCreditEntries.length).toBe(1);
      expect(destCreditEntries[0].customerId).toBe('c1');
      expect(destCreditEntries[0].originalAmount).toBe(1000000);
      expect(destCreditEntries[0].remainingBalance).toBe(1000000);
      expect(destCreditEntries[0].settledAmount).toBe(0);

      // Historical repayment preserved as unallocated
      const destCreditPayments = await targetDb.creditPayments.toArray();
      expect(destCreditPayments.length).toBe(1);
      expect(destCreditPayments[0].id).toBe('cpay_legacy_tx1');
      expect(destCreditPayments[0].amount).toBe(300000);
      expect(destCreditPayments[0].allocationStatus).toBe('unallocated_legacy_historical');

      // Products & Stock Movements:
      const destProducts = await targetDb.products.toArray();
      expect(destProducts.length).toBe(2);
      const cement = destProducts.find(p => p.id === 'inv1');
      expect(cement.currentStock).toBe(20000);
      expect(cement.hasVerifiedCost).toBe(false);

      const destMovements = await targetDb.stockMovements.toArray();
      expect(destMovements.length).toBe(1);
      expect(destMovements[0].productId).toBe('inv1');
      expect(destMovements[0].movementType).toBe('opening_balance');
      expect(destMovements[0].quantityDelta).toBe(20000);

      // Sales & SalePayments:
      const destSales = await targetDb.sales.toArray();
      expect(destSales.length).toBe(1);
      expect(destSales[0].id).toBe('sale1');

      const destSalePayments = await targetDb.salePayments.toArray();
      expect(destSalePayments.length).toBe(1);
      expect(destSalePayments[0].amount).toBe(900000);

      // Reconciliation report financial checks:
      const recon = result.reconciliation;
      expect(recon.financials.sourceAuthoritativeDebtKobo).toBe(1000000);
      expect(recon.financials.destinationOpeningCreditKobo).toBe(1000000);
      expect(recon.financials.debtVarianceKobo).toBe(0);
      expect(recon.isReconciled).toBe(true);

      // 4. Verify idempotence: Re-running on same destination does NOT duplicate records
      const secondRunResult = await orchestrator.run();
      expect(secondRunResult.isSuccess).toBe(true);
      expect(await targetDb.customers.count()).toBe(2);
      expect(await targetDb.creditEntries.count()).toBe(1);
      expect(await targetDb.creditPayments.count()).toBe(1);
      expect(await targetDb.products.count()).toBe(2);
      expect(await targetDb.stockMovements.count()).toBe(1);
      expect(await targetDb.migrationQuarantine.count()).toBe(1);
    });

    it('traps unexpected stage exceptions, records failed checkpoint, and sanitizes error details (SBM-030-C)', async () => {
      // Create adapter with broken method to simulate unexpected mid-pipeline failure
      const brokenAdapter = new LegacyReadOnlyAdapter(syntheticLegacyDb);
      brokenAdapter.fetchCustomers = async () => {
        throw new Error('Database connection reset during customer extraction for user sensitive@merchant.com with card 4111-2222-3333-4444');
      };

      const orchestrator = new MigrationOrchestrator({
        legacyAdapter: brokenAdapter,
        targetDb,
        businessId,
        options: { migrationRunId: 'run_failure_test' }
      });

      // Must re-throw the original error to caller
      await expect(orchestrator.run()).rejects.toThrow(/Database connection reset/);

      // Verify checkpoint was marked as failed
      const failedCp = await targetDb.migrationCheckpoints.get('customers_and_debt');
      expect(failedCp).toBeDefined();
      expect(failedCp.status).toBe('failed');

      // Verify error message was sanitized of sensitive strings
      expect(failedCp.errorDetails.message).toContain('[REDACTED_EMAIL]');
      expect(failedCp.errorDetails.message).toContain('[REDACTED_CARD]');
      expect(failedCp.errorDetails.message).not.toContain('sensitive@merchant.com');
      expect(failedCp.errorDetails.message).not.toContain('4111-2222-3333-4444');

      // Destination records for that stage were rolled back / never written
      expect(await targetDb.customers.count()).toBe(0);
    });

    it('executes dry-run mode without modifying destination database', async () => {
      await syntheticLegacyDb.customers.add({
        id: 'c-dry',
        name: 'Dry Run Customer',
        totalDebt: 500000
      });

      const adapter = new LegacyReadOnlyAdapter(syntheticLegacyDb);
      const orchestrator = new MigrationOrchestrator({
        legacyAdapter: adapter,
        targetDb,
        businessId,
        options: {
          migrationRunId: 'dry_run_01',
          dryRun: true,
          currencyContext: { expectedUnit: 'KOBO', hasLinkedEvidence: true }
        }
      });

      const result = await orchestrator.run();
      expect(result.isSuccess).toBe(true);

      // Verify zero destination records were written
      expect(await targetDb.customers.count()).toBe(0);
      expect(await targetDb.creditEntries.count()).toBe(0);
      expect(await targetDb.products.count()).toBe(0);
      expect(await targetDb.migrationQuarantine.count()).toBe(0);
    });
  });
});
