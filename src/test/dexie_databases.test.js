import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Dexie from 'dexie';
import { 
  legacy_db, 
  msme_ledger_db, 
  sb_db, 
  createSbDatabase, 
  getReadOnlyLegacyDb, 
  SB_DB_STORES,
  SB_DB_STORES_V1,
  SB_DB_STORES_V2
} from '../config/db.js';

describe('SBM-020: Dual-Database Dexie Declaration', () => {
  let testDb;

  afterEach(async () => {
    if (testDb && testDb.isOpen()) {
      await testDb.delete();
    }
  });

  it('1. verifies legacy_db and msme_ledger_db export compatibility and frozen schema', () => {
    expect(legacy_db).toBeDefined();
    expect(msme_ledger_db).toBeDefined();
    expect(legacy_db).toBe(msme_ledger_db);
    expect(legacy_db.name).toBe('msme_ledger_db');

    const storeNames = legacy_db.tables.map(t => t.name).sort();
    expect(storeNames).toEqual(['customers', 'inventory', 'sales', 'transactions']);

    // Check indexes on legacy stores
    const customerTable = legacy_db.customers;
    expect(customerTable.schema.primKey.name).toBe('id');
    const customerIndexes = customerTable.schema.indexes.map(i => i.name).sort();
    expect(customerIndexes).toEqual(['phone', 'sync_status', 'updatedAt']);

    const txTable = legacy_db.transactions;
    expect(txTable.schema.primKey.name).toBe('id');
    const txIndexes = txTable.schema.indexes.map(i => i.name).sort();
    expect(txIndexes).toEqual(['customerId', 'date', 'sync_status', 'type']);
  });

  it('2. verifies sb_db destination database name, separation, verno 2, and all 25 normalized stores', () => {
    expect(sb_db).toBeDefined();
    expect(sb_db.name).toBe('sb_manager_db_v1');
    expect(sb_db.name).not.toBe(legacy_db.name);
    expect(sb_db.verno).toBe(2);

    const expectedStores = [
      'businesses',
      'users',
      'memberships',
      'customers',
      'products',
      'services',
      'inventoryPurchases',
      'purchasePayments',
      'stockMovements',
      'sales',
      'salePayments',
      'creditEntries',
      'creditPayments',
      'creditAdjustments',
      'expenses',
      'expensePayments',
      'expenseCategories',
      'incomeEntries',
      'ownerEquityTransactions',
      'financialReversals',
      'auditLogs',
      'settings',
      'syncQueue',
      'migrationCheckpoints',
      'migrationQuarantine'
    ].sort();

    const actualStores = sb_db.tables.map(t => t.name).sort();
    expect(actualStores).toEqual(expectedStores);
    expect(actualStores.length).toBe(25);
  });

  it('3. verifies primary keys and key indexes across normalized stores in sb_db', () => {
    // Products table indexes
    const products = sb_db.products;
    expect(products.schema.primKey.name).toBe('id');
    const productIdx = products.schema.indexes.map(i => i.name).sort();
    expect(productIdx).toEqual(['businessId', 'hasVerifiedCost', 'isArchived', 'name', 'sku', 'sync_status', 'updatedAt']);

    // Stock movements table indexes
    const movements = sb_db.stockMovements;
    expect(movements.schema.primKey.name).toBe('id');
    const movIdx = movements.schema.indexes.map(i => i.name).sort();
    expect(movIdx).toEqual(['businessId', 'movementDate', 'movementType', 'productId', 'referenceId', 'sync_status']);

    // Inventory purchases table indexes
    const purchases = sb_db.inventoryPurchases;
    expect(purchases.schema.primKey.name).toBe('id');
    const purIdx = purchases.schema.indexes.map(i => i.name).sort();
    expect(purIdx).toEqual(['businessId', 'paymentStatus', 'purchaseDate', 'purchaseNumber', 'sync_status']);

    // Memberships compound reference indexes
    const memberships = sb_db.memberships;
    expect(memberships.schema.primKey.name).toBe('id');
    const memIdx = memberships.schema.indexes.map(i => i.name).sort();
    expect(memIdx).toEqual(['businessId', 'userId']);

    // syncQueue primary key and indexes
    const syncQueue = sb_db.syncQueue;
    expect(syncQueue.schema.primKey.name).toBe('operationId');
    const syncIdx = syncQueue.schema.indexes.map(i => i.name).sort();
    expect(syncIdx).toEqual(['clientRevision', 'entityId', 'entityType', 'queuedAt', 'status']);

    // migrationCheckpoints primary key
    const checkpoints = sb_db.migrationCheckpoints;
    expect(checkpoints.schema.primKey.name).toBe('stage');

    // migrationQuarantine primary key and indexes (SBM-030-A)
    const quarantine = sb_db.migrationQuarantine;
    expect(quarantine.schema.primKey.name).toBe('quarantineId');
    const quarIdx = quarantine.schema.indexes.map(i => i.name).sort();
    expect(quarIdx).toEqual(['detectedAt', 'migrationRunId', 'resolutionStatus', 'sourceEntity', 'sourceId']);
  });

  it('4. performs isolated writes and reads on sb_db stores', async () => {
    testDb = createSbDatabase('test_sb_db_writes_' + Date.now());
    await testDb.open();

    const testBusiness = {
      id: 'biz-uuid-001',
      name: 'Alpha Supermarket',
      type: 'retail',
      currency: 'NGN',
      identityStatus: 'verified_claimed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1
    };
    await testDb.businesses.add(testBusiness);

    const testProduct = {
      id: 'prod-uuid-100',
      businessId: 'biz-uuid-001',
      name: 'Golden Penny Flour 50kg',
      sku: 'GP-FLOUR-50',
      barcode: '6151234567890',
      sellingPrice: 4500000, // ₦45,000.00 in Kobo
      costPrice: 3800000,    // ₦38,000.00 in Kobo
      hasVerifiedCost: true,
      currentStock: 10000,   // 10.000 units in scale 1,000
      reorderPoint: 5000,
      isArchived: false,
      sync_status: 'pending',
      updatedAt: new Date().toISOString(),
      version: 1
    };
    await testDb.products.add(testProduct);

    // Read back
    const retrievedBiz = await testDb.businesses.get('biz-uuid-001');
    expect(retrievedBiz).toBeDefined();
    expect(retrievedBiz.name).toBe('Alpha Supermarket');

    const retrievedProd = await testDb.products.get('prod-uuid-100');
    expect(retrievedProd).toBeDefined();
    expect(retrievedProd.name).toBe('Golden Penny Flour 50kg');
    expect(retrievedProd.sellingPrice).toBe(4500000);
    expect(retrievedProd.currentStock).toBe(10000);
  });

  it('5. confirms database separation: opening sb_db does not touch or populate legacy_db', async () => {
    // Ensure legacy tables have distinct records
    await legacy_db.customers.clear();
    await legacy_db.customers.add({
      id: 'legacy-cust-01',
      name: 'Legacy Only Customer',
      phone: '08000000001',
      totalDebt: 100000,
      sync_status: 'synced',
      updatedAt: new Date()
    });

    // Write to sb_db
    testDb = createSbDatabase('test_db_isolation_' + Date.now());
    await testDb.open();
    await testDb.customers.add({
      id: 'new-cust-01',
      businessId: 'biz-01',
      name: 'New Platform Customer',
      phone: '08000000002',
      isArchived: false,
      sync_status: 'pending',
      updatedAt: new Date().toISOString()
    });

    // Verify separation
    const legacyRecords = await legacy_db.customers.toArray();
    expect(legacyRecords.length).toBe(1);
    expect(legacyRecords[0].id).toBe('legacy-cust-01');

    const newRecords = await testDb.customers.toArray();
    expect(newRecords.length).toBe(1);
    expect(newRecords[0].id).toBe('new-cust-01');

    // Clean up
    await legacy_db.customers.clear();
  });

  it('6. validates read-only wrapper on legacy_db blocks mutating operations', async () => {
    const readOnlyLegacy = getReadOnlyLegacyDb(legacy_db);

    // Reads are allowed
    const count = await readOnlyLegacy.customers.count();
    expect(typeof count).toBe('number');

    // Mutating methods must throw
    expect(() => {
      readOnlyLegacy.customers.add({ id: 'bad-01', name: 'Illegal Write' });
    }).toThrow(/Write operation 'add' is prohibited on legacy_db/);

    expect(() => {
      readOnlyLegacy.customers.put({ id: 'bad-02', name: 'Illegal Put' });
    }).toThrow(/Write operation 'put' is prohibited on legacy_db/);

    expect(() => {
      readOnlyLegacy.customers.delete('bad-01');
    }).toThrow(/Write operation 'delete' is prohibited on legacy_db/);

    expect(() => {
      readOnlyLegacy.customers.clear();
    }).toThrow(/Write operation 'clear' is prohibited on legacy_db/);

    expect(() => {
      readOnlyLegacy.transaction('rw', readOnlyLegacy.customers, async () => {});
    }).toThrow(/Write transactions are prohibited on legacy_db/);
  });

  it('7. verifies explicit additive upgrade from Phase 2 Version 1 schema to Version 2 schema without SchemaDiff warning', async () => {
    const upgradeDbName = 'test_additive_upgrade_' + Date.now();

    // Step 1: Initialize database using Phase 2 Version 1 schema (24 stores)
    const dbV1 = new Dexie(upgradeDbName);
    dbV1.version(1).stores(SB_DB_STORES_V1);
    await dbV1.open();

    expect(dbV1.verno).toBe(1);
    expect(dbV1.tables.length).toBe(24);
    expect(dbV1.tables.some(t => t.name === 'migrationQuarantine')).toBe(false);

    // Step 2: Seed representative data across multiple stores
    await dbV1.businesses.add({
      id: 'biz-up-1',
      name: 'Upgrade Store',
      type: 'retail',
      currency: 'NGN',
      identityStatus: 'verified_claimed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1
    });

    await dbV1.customers.add({
      id: 'cust-up-1',
      businessId: 'biz-up-1',
      name: 'Original Customer',
      phone: '08012345678',
      isArchived: false,
      sync_status: 'synced',
      updatedAt: new Date().toISOString()
    });

    await dbV1.products.add({
      id: 'prod-up-1',
      businessId: 'biz-up-1',
      name: 'Original Product',
      sku: 'ORIG-1',
      hasVerifiedCost: true,
      currentStock: 10000,
      isArchived: false,
      sync_status: 'synced',
      updatedAt: new Date().toISOString(),
      version: 1
    });

    await dbV1.sales.add({
      id: 'sale-up-1',
      businessId: 'biz-up-1',
      customerId: 'cust-up-1',
      totalAmount: 50000,
      saleDate: new Date().toISOString(),
      paymentStatus: 'paid',
      clientRevision: 1,
      sync_status: 'synced',
      updatedAt: new Date().toISOString()
    });

    await dbV1.migrationCheckpoints.add({
      stage: 'customers_and_debt',
      status: 'completed',
      migrationVersion: 1
    });

    // Step 3: Close database
    await dbV1.close();

    // Step 4: Reopen using createSbDatabase (declaring Version 1 and Version 2)
    const upgradedDb = createSbDatabase(upgradeDbName);
    await upgradedDb.open();

    // Step 5: Verify clean upgrade to Version 2
    expect(upgradedDb.verno).toBe(2);
    expect(upgradedDb.tables.length).toBe(25);

    // Step 6: Verify all original records remain intact
    const biz = await upgradedDb.businesses.get('biz-up-1');
    expect(biz).toBeDefined();
    expect(biz.name).toBe('Upgrade Store');

    const cust = await upgradedDb.customers.get('cust-up-1');
    expect(cust).toBeDefined();
    expect(cust.name).toBe('Original Customer');

    const prod = await upgradedDb.products.get('prod-up-1');
    expect(prod).toBeDefined();
    expect(prod.name).toBe('Original Product');
    expect(prod.currentStock).toBe(10000);

    const sale = await upgradedDb.sales.get('sale-up-1');
    expect(sale).toBeDefined();
    expect(sale.totalAmount).toBe(50000);

    const cp = await upgradedDb.migrationCheckpoints.get('customers_and_debt');
    expect(cp).toBeDefined();
    expect(cp.status).toBe('completed');

    // Step 7: Verify migrationQuarantine exists with required PK and indexes
    expect(upgradedDb.migrationQuarantine).toBeDefined();
    expect(upgradedDb.migrationQuarantine.schema.primKey.name).toBe('quarantineId');
    const quarIdx = upgradedDb.migrationQuarantine.schema.indexes.map(i => i.name).sort();
    expect(quarIdx).toEqual(['detectedAt', 'migrationRunId', 'resolutionStatus', 'sourceEntity', 'sourceId']);

    // Step 8: Can write and query migrationQuarantine on the upgraded database
    await upgradedDb.migrationQuarantine.add({
      quarantineId: 'quar_test_up_01',
      migrationRunId: 'run_up_01',
      sourceEntity: 'customers',
      sourceId: 'cust-bad-up',
      rawRecord: { id: 'cust-bad-up' },
      reason: 'TEST_UPGRADE',
      validationErrors: [],
      detectedAt: new Date().toISOString(),
      resolutionStatus: 'unresolved',
      resolutionHistory: []
    });

    const quarRecord = await upgradedDb.migrationQuarantine.get('quar_test_up_01');
    expect(quarRecord).toBeDefined();
    expect(quarRecord.reason).toBe('TEST_UPGRADE');

    // Clean up
    await upgradedDb.delete();
  });
});

