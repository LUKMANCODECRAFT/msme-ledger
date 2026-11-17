/**
 * Frontend Remediation (FE-01R3) Comprehensive Test Suite
 * 
 * Tests the 6 major data-integrity and persistence areas:
 * 1. A1: Stable Idempotency across Real UI Operations (tenant-scoped, payload-verified, retry-safe)
 * 2. A2: Crash-Safe Cross-Database Inventory Consistency (saga states, compensation failure, recovery)
 * 3. A3: Concurrent Stock Adjustment Safety (serialized read-modify-write, negative guard under contention)
 * 4. A4: Quantity Precision (Scale 1,000, 3 decimal places, fractional additions, invalid precision rejection)
 * 5. A5: Input & Persistence Validation (strict payment methods, integer kobo, tenant ownership)
 * 6. A6: Synchronization Status Correctness (partial success: false, stale mutation protection)
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { msme_ledger_db, sb_db, getAllPendingSyncCounts } from '../config/db.js';
import {
  createProduct,
  adjustStock,
  reconcileIncompleteOperations,
  InventoryPersistenceError
} from '../services/inventoryService.js';
import {
  recordExpense,
  ExpensePersistenceError
} from '../services/expenseService.js';
import { recordSale } from '../services/ledgerService.js';
import { pushPendingData } from '../services/syncService.js';

describe('MSME Ledger — FE-01R3 Frontend Data-Integrity Suite', () => {
  beforeEach(async () => {
    await msme_ledger_db.customers.clear();
    await msme_ledger_db.inventory.clear();
    await msme_ledger_db.sales.clear();
    if (msme_ledger_db.transactions) await msme_ledger_db.transactions.clear();
    if (sb_db.expenses) await sb_db.expenses.clear();
    if (sb_db.products) await sb_db.products.clear();
    if (sb_db.stockMovements) await sb_db.stockMovements.clear();
    if (sb_db.syncQueue) await sb_db.syncQueue.clear();

    window.localStorage.clear();
    window.localStorage.setItem('shopName', 'Ikeja Food Mart');
    window.localStorage.setItem('shopId', 'tenant-alpha-001');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. A1: Stable Idempotency across Real UI Operations
  // =========================================================================
  describe('1. A1 — Stable Idempotency Across Real UI Operations', () => {
    it('repeated submission with same operationId returns existing record without duplicates', async () => {
      const stableOpId = 'op_prod_stable_ui_001';

      const firstResult = await createProduct({
        name: 'Ovaltine 400g Refill',
        priceKobo: 180000,
        stockCount: 10,
        operationId: stableOpId
      });

      expect(firstResult.isDuplicateRetry).toBe(false);

      // Repeated submission (e.g. UI retry or network duplicate)
      const secondResult = await createProduct({
        name: 'Ovaltine 400g Refill',
        priceKobo: 180000,
        stockCount: 10,
        operationId: stableOpId
      });

      expect(secondResult.isDuplicateRetry).toBe(true);
      expect(secondResult.id).toBe(firstResult.id);

      // Strictly 1 target product and 1 syncQueue entry
      expect(await sb_db.products.count()).toBe(1);
      expect(await sb_db.syncQueue.count()).toBe(1);
      expect(await msme_ledger_db.inventory.count()).toBe(1);
    });

    it('rejects reuse of an operationId with a different product payload', async () => {
      const stableOpId = 'op_prod_payload_test';

      await createProduct({
        name: 'Peak Evaporated Milk',
        priceKobo: 65000,
        stockCount: 20,
        operationId: stableOpId
      });

      // Attempt reuse with different price
      await expect(
        createProduct({
          name: 'Peak Evaporated Milk',
          priceKobo: 70000, // Different payload!
          stockCount: 20,
          operationId: stableOpId
        })
      ).rejects.toThrow(/IDEMPOTENCY_PAYLOAD_MISMATCH/i);

      // Attempt reuse with different name
      await expect(
        createProduct({
          name: 'Three Crowns Milk', // Different payload!
          priceKobo: 65000,
          stockCount: 20,
          operationId: stableOpId
        })
      ).rejects.toThrow(/IDEMPOTENCY_PAYLOAD_MISMATCH/i);
    });

    it('rejects reuse of an operationId under a different tenant identity', async () => {
      const stableOpId = 'op_prod_tenant_isolation_test';

      await createProduct({
        name: 'Bournvita 500g',
        priceKobo: 220000,
        stockCount: 15,
        operationId: stableOpId,
        businessId: 'tenant-alpha-001'
      });

      // Different business attempts to reuse the same operationId
      await expect(
        createProduct({
          name: 'Bournvita 500g',
          priceKobo: 220000,
          stockCount: 15,
          operationId: stableOpId,
          businessId: 'tenant-beta-999'
        })
      ).rejects.toThrow(/IDEMPOTENCY_TENANT_MISMATCH/i);
    });

    it('expense recording strictly enforces tenant scoping and payload integrity on retried operationId', async () => {
      const stableOpId = 'op_exp_diesel_001';

      await recordExpense({
        category: 'Generator Fuel',
        amountKobo: 3500000,
        notes: '20L Diesel for morning shift',
        operationId: stableOpId,
        businessId: 'tenant-alpha-001'
      });

      // Successful identical retry
      const retry = await recordExpense({
        category: 'Generator Fuel',
        amountKobo: 3500000,
        notes: '20L Diesel for morning shift',
        operationId: stableOpId,
        businessId: 'tenant-alpha-001'
      });
      expect(retry).toBeDefined();
      expect(await sb_db.expenses.count()).toBe(1);

      // Reused operationId with different amount
      await expect(
        recordExpense({
          category: 'Generator Fuel',
          amountKobo: 4000000, // Different amount!
          notes: '20L Diesel for morning shift',
          operationId: stableOpId,
          businessId: 'tenant-alpha-001'
        })
      ).rejects.toThrow(/IDEMPOTENCY_PAYLOAD_MISMATCH/i);

      // Reused operationId with different tenant
      await expect(
        recordExpense({
          category: 'Generator Fuel',
          amountKobo: 3500000,
          notes: '20L Diesel for morning shift',
          operationId: stableOpId,
          businessId: 'tenant-gamma-888'
        })
      ).rejects.toThrow(/IDEMPOTENCY_TENANT_MISMATCH/i);
    });

    it('concurrent duplicate submissions with the same operationId do not duplicate records', async () => {
      const stableOpId = 'op_prod_concurrent_dup_001';

      // Fire 5 identical requests simultaneously
      const promises = Array.from({ length: 5 }, () =>
        createProduct({
          name: 'Golden Morn 500g',
          priceKobo: 120000,
          stockCount: 30,
          operationId: stableOpId
        })
      );

      const results = await Promise.all(promises);
      const uniqueIds = new Set(results.map(r => r.id));
      expect(uniqueIds.size).toBe(1);

      expect(await sb_db.products.count()).toBe(1);
      expect(await msme_ledger_db.inventory.count()).toBe(1);
    });
  });

  // =========================================================================
  // 2. A2: Crash-Safe Cross-Database Inventory Consistency & Reconciliation
  // =========================================================================
  describe('2. A2 — Crash-Safe Cross-Database Consistency & Reconciliation', () => {
    it('target commit failure throws TARGET_PERSISTENCE_FAILED and leaves operational database untouched', async () => {
      vi.spyOn(sb_db.products, 'put').mockRejectedValueOnce(
        new Error('Target Dexie Quota Exceeded')
      );

      await expect(
        createProduct({
          name: 'Nescafe Classic 50g',
          priceKobo: 90000,
          stockCount: 10
        })
      ).rejects.toThrow(/TARGET_PERSISTENCE_FAILED/i);

      expect(await sb_db.products.count()).toBe(0);
      expect(await sb_db.syncQueue.count()).toBe(0);
      expect(await msme_ledger_db.inventory.count()).toBe(0);
    });

    it('operational database failure rolls back target database and leaves zero orphaned target records', async () => {
      vi.spyOn(msme_ledger_db.inventory, 'put').mockRejectedValueOnce(
        new Error('Operational disk I/O failure')
      );

      await expect(
        createProduct({
          name: 'St. Louis Sugar',
          priceKobo: 110000,
          stockCount: 25
        })
      ).rejects.toThrow(/LEGACY_PERSISTENCE_FAILED.*target write was verified rolled back/i);

      // Verified clean state
      expect(await sb_db.products.count()).toBe(0);
      expect(await sb_db.syncQueue.count()).toBe(0);
      expect(await msme_ledger_db.inventory.count()).toBe(0);
    });

    it('compensation failure is NEVER silently swallowed and alerts caller with COMPENSATION_FAILED', async () => {
      // Mock legacy write failure
      vi.spyOn(msme_ledger_db.inventory, 'put').mockRejectedValueOnce(
        new Error('Primary disk write fault')
      );

      // Mock rollback failure in target store
      vi.spyOn(sb_db.products, 'delete').mockRejectedValueOnce(
        new Error('Secondary lock failure preventing rollback')
      );

      await expect(
        createProduct({
          name: 'Dangote Salt 1kg',
          priceKobo: 30000,
          stockCount: 50
        })
      ).rejects.toThrow(/COMPENSATION_FAILED.*manual reconciliation/i);

      // Proves compensation error was not swallowed and syncQueue reflects the state
      const queueEntries = await sb_db.syncQueue.toArray();
      expect(queueEntries).toHaveLength(1);
      expect(queueEntries[0].sagaState).toBe('compensation_failed');
    });

    it('reconciles incomplete operations where target committed but operational write crashed', async () => {
      const crashedOpId = 'op_prod_crashed_mid_saga';
      const productId = 'prod_crashed_001';

      // Simulate state where app crashed after Phase 1 commit to target DB
      await sb_db.products.put({
        id: productId,
        businessId: 'tenant-alpha-001',
        name: 'Lipton Yellow Label Tea',
        sellingPrice: 85000,
        currentStock: 40000, // 40 units scaled
        isArchived: false,
        sync_status: 'pending',
        updatedAt: new Date()
      });

      await sb_db.syncQueue.put({
        operationId: crashedOpId,
        businessId: 'tenant-alpha-001',
        entityType: 'product',
        entityId: productId,
        sagaState: 'target_committed',
        clientRevision: 1,
        status: 'queued',
        queuedAt: new Date().toISOString()
      });

      // Operational database does not have it yet
      expect(await msme_ledger_db.inventory.get(productId)).toBeUndefined();

      // Run reconciliation engine
      const reconResult = await reconcileIncompleteOperations({ businessId: 'tenant-alpha-001' });
      expect(reconResult.reconciledCount).toBe(1);
      expect(reconResult.resolvedOperations).toContain(crashedOpId);

      // Operational database now has the product
      const legacyItem = await msme_ledger_db.inventory.get(productId);
      expect(legacyItem).toBeDefined();
      expect(legacyItem.itemName).toBe('Lipton Yellow Label Tea');
      expect(legacyItem.stockCount).toBe(40);

      // syncQueue updated to operational_committed
      const queueItem = await sb_db.syncQueue.get(crashedOpId);
      expect(queueItem.sagaState).toBe('operational_committed');

      // Subsequent reconciliation is a safe no-op (idempotent recovery)
      const secondRecon = await reconcileIncompleteOperations({ businessId: 'tenant-alpha-001' });
      expect(secondRecon.reconciledCount).toBe(0);
    });
  });

  // =========================================================================
  // 3. A3: Concurrent Stock Adjustment Safety
  // =========================================================================
  describe('3. A3 — Concurrent Stock Adjustment Safety', () => {
    it('10 concurrent stock adjustments against the same product result in zero lost updates', async () => {
      // Create initial product with 50 units
      const product = await createProduct({
        name: 'Golden Penny Semovita 2kg',
        priceKobo: 210000,
        stockCount: 50
      });

      // 5 concurrent additions of 4 units (+20 units)
      // 5 concurrent deductions of 2 units (-10 units)
      // Net change: +10 units -> Final expected: 60 units
      const operations = [
        ...Array.from({ length: 5 }, (_, idx) => ({
          productId: product.id,
          delta: 4,
          movementType: 'RESTOCK',
          operationId: `op_concurrent_add_${idx}`
        })),
        ...Array.from({ length: 5 }, (_, idx) => ({
          productId: product.id,
          delta: 2,
          movementType: 'ADJUSTMENT_DAMAGE',
          operationId: `op_concurrent_sub_${idx}`
        }))
      ];

      // Shuffle operations to maximize race conditions
      operations.sort(() => Math.random() - 0.5);

      await Promise.all(operations.map(op => adjustStock(op)));

      // Assert final stock strictly matches committed movements
      const finalItem = await msme_ledger_db.inventory.get(product.id);
      expect(finalItem.stockCount).toBe(60);

      // Exactly 10 stock movements recorded
      const movements = await sb_db.stockMovements.where('productId').equals(product.id).toArray();
      expect(movements).toHaveLength(10);
    });

    it('negative stock guard rejects overdraft under concurrent contending requests', async () => {
      const product = await createProduct({
        name: 'Milo 1kg Tin',
        priceKobo: 480000,
        stockCount: 10
      });

      // Two requests simultaneously try to deduct 8 units from 10 available units
      // First must succeed (reducing stock to 2), second must reject with INSUFFICIENT_STOCK
      const req1 = adjustStock({
        productId: product.id,
        delta: 8,
        movementType: 'ADJUSTMENT_DAMAGE',
        operationId: 'op_contend_1'
      });

      const req2 = adjustStock({
        productId: product.id,
        delta: 8,
        movementType: 'ADJUSTMENT_DAMAGE',
        operationId: 'op_contend_2'
      });

      const results = await Promise.allSettled([req1, req2]);
      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason.message).toMatch(/Cannot reduce stock below zero/i);

      // Stock remains exactly 2 (never negative!)
      const item = await msme_ledger_db.inventory.get(product.id);
      expect(item.stockCount).toBe(2);
    });
  });

  // =========================================================================
  // 4. A4: Quantity Precision (Scale 1,000 & Three Decimal Places)
  // =========================================================================
  describe('4. A4 — Quantity Precision (Scale 1,000 / Three Decimal Places)', () => {
    it('supports valid fractional quantities up to 3 decimal places without floating-point errors', async () => {
      // 1.5 kg initial stock
      const product = await createProduct({
        name: 'Basmati Rice (Loose)',
        priceKobo: 350000,
        stockCount: '1.5'
      });

      expect(product.stockCount).toBe(1.5);

      // Add 0.250 kg
      const adj1 = await adjustStock({
        productId: product.id,
        delta: '0.250',
        movementType: 'RESTOCK'
      });
      expect(adj1.finalCount).toBe(1.75);

      // Deduct 0.125 kg
      const adj2 = await adjustStock({
        productId: product.id,
        delta: '0.125',
        movementType: 'ADJUSTMENT_DAMAGE'
      });
      expect(adj2.finalCount).toBe(1.625);

      // In database
      const item = await msme_ledger_db.inventory.get(product.id);
      expect(item.stockCount).toBe(1.625);
    });

    it('rejects quantities exceeding maximum allowed 3 decimal places', async () => {
      // 4 decimal places: 1.1234
      await expect(
        createProduct({
          name: 'Micro Powder',
          priceKobo: 100000,
          stockCount: '1.1234'
        })
      ).rejects.toThrow(/exceeds maximum allowed 3 decimal places/i);

      // 4 decimal places in stock adjustment
      const prod = await createProduct({
        name: 'Standard Sugar',
        priceKobo: 100000,
        stockCount: 10
      });

      await expect(
        adjustStock({
          productId: prod.id,
          delta: '0.0005',
          movementType: 'RESTOCK'
        })
      ).rejects.toThrow(/exceeds maximum allowed 3 decimal places/i);
    });

    it('POS sales deduction supports fractional quantities with exact kobo pricing', async () => {
      // Create product with 10 units at ₦1,000.00 (100000 kobo) per unit
      const prodId = await createProduct({
        name: 'Cheddar Cheese Block',
        priceKobo: 100000,
        stockCount: 10
      }).then(r => r.id);

      await msme_ledger_db.customers.add({
        id: 'cust-frac-1',
        name: 'Amina Bello',
        phone: '08022223333',
        totalDebt: 0,
        sync_status: 'synced',
        updatedAt: new Date()
      });

      // Sell 1.5 units: Total = 100000 * 1.5 = 150000 kobo (₦1,500.00)
      const saleId = await recordSale({
        customerId: 'cust-frac-1',
        items: [{ inventoryId: prodId, quantity: '1.5', price: 100000 }],
        amountTendered: 150000,
        paymentMethod: 'cash'
      });

      const sale = await msme_ledger_db.sales.get(saleId);
      expect(sale.totalAmount).toBe(150000);
      expect(sale.amountPaid).toBe(150000);

      // Inventory reduced from 10 to 8.5 units
      const item = await msme_ledger_db.inventory.get(prodId);
      expect(item.stockCount).toBe(8.5);
    });
  });

  // =========================================================================
  // 5. A5: Input & Persistence Validation
  // =========================================================================
  describe('5. A5 — Input & Persistence Validation', () => {
    it('rejects invalid payment methods without silently coercing to cash', async () => {
      await expect(
        recordExpense({
          category: 'Rent & Shop Lease',
          amountKobo: 5000000,
          paymentMethod: 'crypto_currency' // Invalid!
        })
      ).rejects.toThrow(/Invalid payment method "crypto_currency"/i);

      await expect(
        recordSale({
          customerId: 'cust-pos-val',
          items: [],
          amountTendered: 1000,
          paymentMethod: 'bitcoin' // Invalid!
        })
      ).rejects.toThrow();
    });

    it('rejects non-positive verified unit costs when supplied', async () => {
      await expect(
        createProduct({
          name: 'Invalid Cost Item',
          priceKobo: 50000,
          stockCount: 5,
          hasVerifiedCost: true,
          verifiedUnitCost: -500 // Negative!
        })
      ).rejects.toThrow(/Verified unit cost must be a valid positive integer/i);
    });
  });

  // =========================================================================
  // 6. A6: Synchronization Status Correctness & Stale Acknowledgement Protection
  // =========================================================================
  describe('6. A6 — Synchronization Status Correctness & Stale Protection', () => {
    it('returns success: false when status is partial', async () => {
      // Seed unsupported product only
      await sb_db.products.put({
        id: 'p-unsupported-1',
        businessId: 'tenant-alpha-001',
        name: 'Target Product Pending',
        sellingPrice: 50000,
        sync_status: 'pending',
        updatedAt: new Date()
      });

      const result = await pushPendingData();

      expect(result.status).toBe('partial');
      expect(result.success).toBe(false); // CRITICAL: Never success: true when partial!
      expect(result.pendingCount).toBe(1);
    });

    it('prevents stale network acknowledgements from overwriting newer local mutations', async () => {
      const originalTime = new Date('2026-11-17T10:00:00Z');
      await msme_ledger_db.customers.add({
        id: 'cust-stale-test',
        name: 'Original Customer Name',
        phone: '08099998888',
        totalDebt: 0,
        sync_status: 'pending',
        updatedAt: originalTime
      });

      // Mock fetch with artificial delay during which a local mutation occurs
      vi.spyOn(global, 'fetch').mockImplementationOnce(async () => {
        // User modifies customer locally during the in-flight network sync
        await msme_ledger_db.customers.update('cust-stale-test', {
          name: 'Updated Customer Name Locally',
          updatedAt: new Date('2026-11-17T10:00:05Z'), // Newer timestamp!
          sync_status: 'pending'
        });

        return {
          status: 200,
          ok: true,
          json: async () => ({ success: true })
        };
      });

      await pushPendingData();

      // Customer must REMAIN pending because it was modified after the payload was constructed!
      const cust = await msme_ledger_db.customers.get('cust-stale-test');
      expect(cust.name).toBe('Updated Customer Name Locally');
      expect(cust.sync_status).toBe('pending');
    });
  });
});
