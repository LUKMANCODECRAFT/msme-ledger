import Dexie from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';

/**
 * @typedef {Object} Customer
 * @property {string} id - String UUID generated via crypto.randomUUID()
 * @property {string} name
 * @property {string} phone
 * @property {number} totalDebt - Kobo (integer)
 * @property {'pending' | 'synced'} sync_status
 * @property {Date} updatedAt
 */

/**
 * @typedef {Object} Inventory
 * @property {string} id - String UUID generated via crypto.randomUUID()
 * @property {string} itemName
 * @property {number} price - Kobo (integer)
 * @property {number} stockCount
 * @property {'pending' | 'synced'} sync_status
 * @property {Date} updatedAt
 */

/**
 * @typedef {Object} Sale
 * @property {string} id - String UUID generated via crypto.randomUUID()
 * @property {string} customerId - String UUID generated via crypto.randomUUID()
 * @property {Array<any>} items
 * @property {number} totalAmount - Kobo (integer)
 * @property {number} amountPaid - Kobo (integer)
 * @property {number} balance - Kobo (integer)
 * @property {'paid' | 'partial' | 'unpaid'} paymentStatus
 * @property {'pending' | 'synced'} sync_status
 * @property {Date} date
 */

const msme_ledger_db = new Dexie('msme_ledger_db');

// Define database schema
// Note: Only properties used in .where() or .orderBy() are indexed.
// id is not auto-incrementing to prevent collision; client will use UUID.
msme_ledger_db.version(1).stores({
  customers: 'id, phone, sync_status, updatedAt',
  inventory: 'id, name, sync_status, updatedAt',
  sales: 'id, customerId, paymentStatus, sync_status, date'
});

msme_ledger_db.version(2).stores({
  customers: 'id, phone, sync_status, updatedAt',
  inventory: 'id, name, sync_status, updatedAt',
  sales: 'id, customerId, paymentStatus, sync_status, date',
  transactions: 'id, customerId, type, date, sync_status'
});

/**
 * 1. Source Database (Legacy): Completely frozen read-only legacy instance.
 * Preserved for historical reference and future client-side migration worker.
 */
export const legacy_db = msme_ledger_db;
export { msme_ledger_db };

/**
 * 2. Destination Database (SB Manager v1): Clean, normalized multi-tenant database.
 * Conforms to SB Manager Rebuild Blueprint V2.1 specification.
 */
export const sb_db = new Dexie('sb_manager_db_v1');

/**
 * Phase 2 Baseline Schema (Version 1): 24 normalized multi-tenant stores.
 */
export const SB_DB_STORES_V1 = {
  businesses: 'id, type, identityStatus, updatedAt',
  users: 'id, email',
  memberships: 'id, businessId, userId',
  customers: 'id, businessId, phone, name, isArchived, sync_status, updatedAt',
  products: 'id, businessId, name, sku, hasVerifiedCost, isArchived, sync_status, updatedAt',
  services: 'id, businessId, name, isArchived, sync_status, updatedAt',
  inventoryPurchases: 'id, businessId, purchaseNumber, paymentStatus, purchaseDate, sync_status',
  purchasePayments: 'id, purchaseId, businessId, paymentDate, sync_status',
  stockMovements: 'id, businessId, productId, movementType, referenceId, movementDate, sync_status',
  sales: 'id, businessId, customerId, saleDate, paymentStatus, sync_status, clientRevision, updatedAt',
  salePayments: 'id, saleId, businessId, paymentMethod, paymentDate, sync_status',
  creditEntries: 'id, businessId, customerId, saleId, status, dueDate, sync_status, updatedAt',
  creditPayments: 'id, creditEntryId, customerId, businessId, allocationStatus, paymentDate, sync_status',
  creditAdjustments: 'id, creditEntryId, businessId, adjustmentType, adjustedAt, sync_status',
  expenses: 'id, businessId, categoryId, paymentStatus, expenseDate, sync_status, updatedAt',
  expensePayments: 'id, expenseId, businessId, paymentDate, sync_status',
  expenseCategories: 'id, businessId, name',
  incomeEntries: 'id, businessId, source, receivedDate, sync_status',
  ownerEquityTransactions: 'id, businessId, transactionType, transactionDate, sync_status',
  financialReversals: 'id, businessId, targetEntityType, targetEntityId, reversedAt, sync_status',
  auditLogs: 'id, businessId, entityType, entityId, timestamp',
  settings: 'id, businessId, updatedAt',
  syncQueue: 'operationId, entityType, entityId, clientRevision, status, queuedAt',
  migrationCheckpoints: 'stage'
};

/**
 * Phase 3 Remediated Schema (Version 2): 25 stores, adding dedicated migrationQuarantine store.
 */
export const SB_DB_STORES_V2 = {
  ...SB_DB_STORES_V1,
  migrationQuarantine: 'quarantineId, migrationRunId, sourceEntity, sourceId, resolutionStatus, detectedAt'
};

// Canonical export representing active schema
export const SB_DB_STORES = SB_DB_STORES_V2;

// Explicit Version Declarations:
// Version 1: Phase 2 baseline 24 stores
sb_db.version(1).stores(SB_DB_STORES_V1);
// Version 2: Phase 3 additive upgrade adding dedicated migrationQuarantine store
sb_db.version(2).stores({
  migrationQuarantine: 'quarantineId, migrationRunId, sourceEntity, sourceId, resolutionStatus, detectedAt'
});

/**
 * Helper to create an isolated SB Manager Dexie instance with custom name (for tests).
 * Enforces explicit versioning: Version 1 (24 stores) and Version 2 (25 stores).
 * @param {string} dbName
 * @returns {Dexie}
 */
export function createSbDatabase(dbName = 'sb_manager_db_v1') {
  const db = new Dexie(dbName);
  db.version(1).stores(SB_DB_STORES_V1);
  db.version(2).stores({
    migrationQuarantine: 'quarantineId, migrationRunId, sourceEntity, sourceId, resolutionStatus, detectedAt'
  });
  return db;
}

/**
 * Scoped read-only access wrapper for legacy Dexie database.
 * Intercepts mutating operations and throws an explicit error.
 * Used by migration and audit consumers to guarantee frozen legacy storage.
 *
 * @param {Dexie} targetDb
 * @returns {Proxy<Dexie>}
 */
export function getReadOnlyLegacyDb(targetDb = legacy_db) {
  const prohibitedMethods = new Set([
    'add', 'put', 'update', 'delete', 'bulkAdd', 'bulkPut', 'bulkDelete', 'clear', 'modify'
  ]);

  function wrapTable(table) {
    return new Proxy(table, {
      get(tableTarget, tableProp) {
        if (prohibitedMethods.has(tableProp)) {
          return () => {
            throw new Error(`Write operation '${String(tableProp)}' is prohibited on legacy_db store '${tableTarget.name}'. The legacy database is frozen.`);
          };
        }
        const val = Reflect.get(tableTarget, tableProp);
        if (typeof val === 'function') {
          return val.bind(tableTarget);
        }
        return val;
      }
    });
  }

  return new Proxy(targetDb, {
    get(target, prop, receiver) {
      if (prop === 'transaction') {
        return (mode, ...args) => {
          if (mode === 'rw' || (typeof mode === 'string' && mode.includes('w'))) {
            throw new Error('Write transactions are prohibited on legacy_db. The legacy database is frozen.');
          }
          return target.transaction(mode, ...args);
        };
      }

      if (prop === 'table') {
        return (tableName) => wrapTable(target.table(tableName));
      }

      const value = Reflect.get(target, prop, receiver);
      // If accessing a Table property (e.g. target.customers, target.inventory)
      if (value && typeof value === 'object' && typeof value.schema === 'object' && typeof value.add === 'function') {
        return wrapTable(value);
      }

      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    }
  });
}

/**
 * Queries all pending sync records across both local databases (msme_ledger_db and sb_db).
 * Returns total pending count and an itemized breakdown.
 *
 * @returns {Promise<{ total: number, breakdown: Record<string, number> }>}
 */
export async function getAllPendingSyncCounts() {
  const [
    customersPending,
    inventoryPending,
    salesPending,
    transactionsPending,
    expensesPending,
    productsPending,
    stockMovementsPending
  ] = await Promise.all([
    msme_ledger_db.customers ? msme_ledger_db.customers.where('sync_status').equals('pending').count().catch(() => 0) : 0,
    msme_ledger_db.inventory ? msme_ledger_db.inventory.where('sync_status').equals('pending').count().catch(() => 0) : 0,
    msme_ledger_db.sales ? msme_ledger_db.sales.where('sync_status').equals('pending').count().catch(() => 0) : 0,
    msme_ledger_db.transactions ? msme_ledger_db.transactions.where('sync_status').equals('pending').count().catch(() => 0) : 0,
    sb_db.expenses ? sb_db.expenses.where('sync_status').equals('pending').count().catch(() => 0) : 0,
    sb_db.products ? sb_db.products.where('sync_status').equals('pending').count().catch(() => 0) : 0,
    sb_db.stockMovements ? sb_db.stockMovements.where('sync_status').equals('pending').count().catch(() => 0) : 0
  ]);

  const total = customersPending +
    inventoryPending +
    salesPending +
    transactionsPending +
    expensesPending +
    productsPending +
    stockMovementsPending;

  return {
    total,
    breakdown: {
      customers: customersPending,
      inventory: inventoryPending,
      sales: salesPending,
      transactions: transactionsPending,
      expenses: expensesPending,
      products: productsPending,
      stockMovements: stockMovementsPending
    }
  };
}

/**
 * Custom hook to get the total count of pending sync records across all local stores.
 * Accounts for customers, inventory, sales, repayments, expenses, products, and stock movements.
 *
 * @returns {number} Aggregate count of records where sync_status is 'pending'.
 */
export function usePendingSyncCount() {
  return useLiveQuery(async () => {
    const { total } = await getAllPendingSyncCounts();
    return total;
  }, [], 0);
}
