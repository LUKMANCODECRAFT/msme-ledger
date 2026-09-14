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

export { msme_ledger_db };

/**
 * Custom hook to get the total count of pending sync records across all stores.
 * @returns {number} Aggregate count of records where sync_status is 'pending'.
 */
export function usePendingSyncCount() {
  return useLiveQuery(async () => {
    const [customersPending, inventoryPending, salesPending] = await Promise.all([
      msme_ledger_db.customers.where('sync_status').equals('pending').count(),
      msme_ledger_db.inventory.where('sync_status').equals('pending').count(),
      msme_ledger_db.sales.where('sync_status').equals('pending').count()
    ]);

    return customersPending + inventoryPending + salesPending;
  }, [], 0);
}
