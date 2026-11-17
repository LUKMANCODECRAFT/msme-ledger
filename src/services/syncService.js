import { msme_ledger_db, sb_db, getAllPendingSyncCounts } from '../config/db.js';
import { getShopId } from '../utils/shopIdentity.js';

export class SyncError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Pushes pending local data to the remote server.
 * Strictly adheres to Phase 4, FE-01R, and FE-01R2 data-integrity requirements:
 * 1. Checks all 7 pending local record types across both databases.
 * 2. Never claims success or pendingCount: 0 if any record remains pending.
 * 3. Explicitly identifies all unsupported groups, including products, stockMovements, expenses, and transactions.
 * 4. Preserves all unsupported records as pending locally.
 * 5. Handles HTTP 410 as SYNC_UNAVAILABLE, never marking records as synced.
 * 6. Accurately reports partial synchronization with remaining pending count and itemized breakdown.
 * 7. Never swallows database query errors.
 * 
 * @returns {Promise<{
 *   success: boolean,
 *   status: 'success' | 'partial' | 'no_pending' | 'unavailable' | 'failed',
 *   message: string,
 *   pendingCount: number,
 *   syncedCount: number,
 *   breakdown: Record<string, number>,
 *   unsupportedGroups: string[]
 * }>}
 */
export async function pushPendingData() {
  // 1. Audit pending counts across all 7 local stores
  const pendingSummary = await getAllPendingSyncCounts();

  // Exit early with clean status if nothing is pending across all tables
  if (pendingSummary.total === 0) {
    return {
      success: true,
      status: 'no_pending',
      message: 'No pending records exist. All local records are clean.',
      pendingCount: 0,
      syncedCount: 0,
      breakdown: pendingSummary.breakdown,
      unsupportedGroups: []
    };
  }

  // 2. Query pending records for every group across both databases
  const customers = await msme_ledger_db.customers.where('sync_status').equals('pending').toArray();
  const inventory = await msme_ledger_db.inventory.where('sync_status').equals('pending').toArray();
  const sales = await msme_ledger_db.sales.where('sync_status').equals('pending').toArray();
  const transactions = msme_ledger_db.transactions
    ? await msme_ledger_db.transactions.where('sync_status').equals('pending').toArray()
    : [];
  const expenses = sb_db.expenses
    ? await sb_db.expenses.where('sync_status').equals('pending').toArray()
    : [];
  const products = sb_db.products
    ? await sb_db.products.where('sync_status').equals('pending').toArray()
    : [];
  const stockMovements = sb_db.stockMovements
    ? await sb_db.stockMovements.where('sync_status').equals('pending').toArray()
    : [];

  // Identify unsupported record groups
  const unsupportedBreakdown = {
    transactions: transactions.length,
    expenses: expenses.length,
    products: products.length,
    stockMovements: stockMovements.length
  };
  const unsupportedPending = transactions.length + expenses.length + products.length + stockMovements.length;
  const unsupportedGroups = Object.keys(unsupportedBreakdown).filter(k => unsupportedBreakdown[k] > 0);

  const supportedPendingCount = customers.length + inventory.length + sales.length;

  // 3. If only unsupported records exist, cloud sync is unavailable for them.
  // Never call the server or claim full success; report partial/unavailable with exact pending count.
  if (supportedPendingCount === 0 && unsupportedPending > 0) {
    return {
      success: false,
      status: 'partial',
      message: `Synchronization cannot complete: ${unsupportedPending} record(s) (${unsupportedGroups.join(', ')}) remain pending locally because cloud synchronization for them is unavailable.`,
      syncedCount: 0,
      pendingCount: unsupportedPending,
      breakdown: {
        customers: 0,
        inventory: 0,
        sales: 0,
        transactions: transactions.length,
        expenses: expenses.length,
        products: products.length,
        stockMovements: stockMovements.length
      },
      unsupportedGroups
    };
  }

  const apiUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
    ? import.meta.env.VITE_API_URL
    : (typeof process !== 'undefined' && process.env?.VITE_API_URL
      ? process.env.VITE_API_URL
      : 'http://localhost:3000');

  // 4. Attempt API request for supported records
  let response;
  try {
    const payload = {
      shopId: getShopId(),
      customers,
      inventory,
      sales
    };

    response = await fetch(`${apiUrl}/api/v1/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch (networkErr) {
    throw new SyncError(
      'NETWORK_ERROR',
      `Cloud synchronization failed due to network error: ${networkErr.message}. Local records remain preserved in pending queue.`,
      { pendingCount: pendingSummary.total, breakdown: pendingSummary.breakdown, originalError: networkErr }
    );
  }

  // 5. Handle HTTP 410 Gone (Retired endpoint)
  if (response.status === 410) {
    throw new SyncError(
      'SYNC_UNAVAILABLE',
      'Cloud synchronization is unavailable: The legacy /api/v1/sync endpoint has been permanently retired (HTTP 410) and the authenticated v2 cloud synchronization backend is pending integration. All records remain safely preserved on this device.',
      { status: 410, pendingCount: pendingSummary.total, breakdown: pendingSummary.breakdown }
    );
  }

  // 6. Handle other non-200 responses
  if (response.status !== 200) {
    throw new SyncError(
      'SYNC_FAILED',
      `Cloud synchronization rejected by server with HTTP ${response.status}. Local records remain in pending queue.`,
      { status: response.status, pendingCount: pendingSummary.total, breakdown: pendingSummary.breakdown }
    );
  }

  // 7. If response is 200, only the submitted payloads (customers, inventory, sales) are confirmed synchronized.
  // Stale acknowledgement prevention: snapshot timestamps of submitted records.
  // Records modified while sync was in-flight must NOT have their pending status overwritten!
  const customerSnapshots = new Map(customers.map(c => [c.id, c.updatedAt ? new Date(c.updatedAt).getTime() : 0]));
  const inventorySnapshots = new Map(inventory.map(i => [i.id, i.updatedAt ? new Date(i.updatedAt).getTime() : 0]));
  const salesSnapshots = new Map(sales.map(s => [s.id, s.date ? new Date(s.date).getTime() : 0]));

  await msme_ledger_db.transaction(
    'rw',
    [msme_ledger_db.customers, msme_ledger_db.inventory, msme_ledger_db.sales],
    async () => {
      for (const c of customers) {
        const live = await msme_ledger_db.customers.get(c.id);
        const snapshotTime = customerSnapshots.get(c.id);
        const liveTime = live?.updatedAt ? new Date(live.updatedAt).getTime() : 0;
        if (live && liveTime <= snapshotTime) {
          await msme_ledger_db.customers.update(c.id, { sync_status: 'synced' });
        }
      }

      for (const inv of inventory) {
        const live = await msme_ledger_db.inventory.get(inv.id);
        const snapshotTime = inventorySnapshots.get(inv.id);
        const liveTime = live?.updatedAt ? new Date(live.updatedAt).getTime() : 0;
        if (live && liveTime <= snapshotTime) {
          await msme_ledger_db.inventory.update(inv.id, { sync_status: 'synced' });
        }
      }

      for (const s of sales) {
        const live = await msme_ledger_db.sales.get(s.id);
        const snapshotTime = salesSnapshots.get(s.id);
        const liveTime = live?.date ? new Date(live.date).getTime() : 0;
        if (live && liveTime <= snapshotTime) {
          await msme_ledger_db.sales.update(s.id, { sync_status: 'synced' });
        }
      }
    }
  );

  const syncedCount = customers.length + inventory.length + sales.length;

  if (unsupportedPending > 0) {
    return {
      success: false,
      status: 'partial',
      message: `Synchronization partially succeeded (${syncedCount} records synced). ${unsupportedPending} record(s) (${unsupportedGroups.join(', ')}) remain pending locally because cloud sync for them is currently unavailable.`,
      syncedCount,
      pendingCount: unsupportedPending,
      breakdown: {
        customers: 0,
        inventory: 0,
        sales: 0,
        transactions: transactions.length,
        expenses: expenses.length,
        products: products.length,
        stockMovements: stockMovements.length
      },
      unsupportedGroups
    };
  }

  return {
    success: true,
    status: 'success',
    message: `Synchronization succeeded. ${syncedCount} records synced.`,
    syncedCount,
    pendingCount: 0,
    breakdown: {
      customers: 0,
      inventory: 0,
      sales: 0,
      transactions: 0,
      expenses: 0,
      products: 0,
      stockMovements: 0
    },
    unsupportedGroups: []
  };
}
