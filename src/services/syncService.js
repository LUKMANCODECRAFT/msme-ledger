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
 * Strictly adheres to Phase 4 & FE-01R data-integrity requirements:
 * 1. Checks all pending local record types across both databases.
 * 2. Never claims success if synchronization is rejected or unavailable.
 * 3. Handles HTTP 410 as SYNC_UNAVAILABLE, never marking records as synced.
 * 4. Preserves unsupported records locally in 'pending' status.
 * 5. Accurately distinguishes full success, partial success, failure, unavailable, and no pending.
 * 
 * @returns {Promise<{ success: boolean, status: 'success' | 'partial' | 'no_pending' | 'unavailable' | 'failed', message: string, pendingCount: number, syncedCount: number, details?: any }>}
 */
export async function pushPendingData() {
  // 1. Audit pending counts across all local stores
  const pendingSummary = await getAllPendingSyncCounts();

  // Exit early with clean status if nothing is pending
  if (pendingSummary.total === 0) {
    return {
      success: true,
      status: 'no_pending',
      message: 'No pending records exist. All local records are clean.',
      pendingCount: 0,
      syncedCount: 0
    };
  }

  // 2. Query pending records from local stores
  const customers = await msme_ledger_db.customers.where('sync_status').equals('pending').toArray();
  const inventory = await msme_ledger_db.inventory.where('sync_status').equals('pending').toArray();
  const sales = await msme_ledger_db.sales.where('sync_status').equals('pending').toArray();
  const transactions = msme_ledger_db.transactions
    ? await msme_ledger_db.transactions.where('sync_status').equals('pending').toArray()
    : [];
  const expenses = sb_db.expenses
    ? await sb_db.expenses.where('sync_status').equals('pending').toArray()
    : [];

  const apiUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
    ? import.meta.env.VITE_API_URL
    : (typeof process !== 'undefined' && process.env?.VITE_API_URL
      ? process.env.VITE_API_URL
      : 'http://localhost:3000');

  // 3. Attempt API request
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

  // 4. Handle HTTP 410 Gone (Retired endpoint)
  if (response.status === 410) {
    throw new SyncError(
      'SYNC_UNAVAILABLE',
      'Cloud synchronization is unavailable: The legacy /api/v1/sync endpoint has been permanently retired (HTTP 410) and the authenticated v2 cloud synchronization backend is pending integration. All records remain safely preserved on this device.',
      { status: 410, pendingCount: pendingSummary.total, breakdown: pendingSummary.breakdown }
    );
  }

  // 5. Handle other non-200 responses
  if (response.status !== 200) {
    throw new SyncError(
      'SYNC_FAILED',
      `Cloud synchronization rejected by server with HTTP ${response.status}. Local records remain in pending queue.`,
      { status: response.status, pendingCount: pendingSummary.total, breakdown: pendingSummary.breakdown }
    );
  }

  // 6. If response is 200, only the legacy payloads (customers, inventory, sales) could be synchronized.
  // Repayments (transactions) and expenses have no backend sync route and must NOT be marked synced!
  await msme_ledger_db.transaction(
    'rw',
    [msme_ledger_db.customers, msme_ledger_db.inventory, msme_ledger_db.sales],
    async () => {
      const syncedCustomers = customers.map(record => ({ ...record, sync_status: 'synced' }));
      const syncedInventory = inventory.map(record => ({ ...record, sync_status: 'synced' }));
      const syncedSales = sales.map(record => ({ ...record, sync_status: 'synced' }));

      if (syncedCustomers.length > 0) await msme_ledger_db.customers.bulkPut(syncedCustomers);
      if (syncedInventory.length > 0) await msme_ledger_db.inventory.bulkPut(syncedInventory);
      if (syncedSales.length > 0) await msme_ledger_db.sales.bulkPut(syncedSales);
    }
  );

  const syncedCount = customers.length + inventory.length + sales.length;
  const unsupportedPending = transactions.length + expenses.length;

  if (unsupportedPending > 0) {
    return {
      success: true,
      status: 'partial',
      message: `Synchronization partially succeeded (${syncedCount} records synced). ${unsupportedPending} records (repayments / expenses) remain pending locally because cloud sync for them is currently unavailable.`,
      syncedCount,
      pendingCount: unsupportedPending,
      details: {
        syncedCount,
        unsupportedPending,
        breakdown: {
          transactions: transactions.length,
          expenses: expenses.length
        }
      }
    };
  }

  return {
    success: true,
    status: 'success',
    message: `Synchronization succeeded. ${syncedCount} records synced.`,
    syncedCount,
    pendingCount: 0
  };
}
