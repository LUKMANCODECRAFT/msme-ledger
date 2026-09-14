import { msme_ledger_db } from '../config/db.js';
import { getShopId } from '../utils/shopIdentity.js';

/**
 * Pushes pending local data to the remote server and marks it as synced.
 * Designed to be idempotent and safe for network interruption retries.
 * 
 * @returns {Promise<void>}
 */
export async function pushPendingData() {
  try {
    // 1. Query pending records
    const customers = await msme_ledger_db.customers.where('sync_status').equals('pending').toArray();
    const inventory = await msme_ledger_db.inventory.where('sync_status').equals('pending').toArray();
    const sales = await msme_ledger_db.sales.where('sync_status').equals('pending').toArray();

    // 2. Exit early if all three arrays are empty
    if (customers.length === 0 && inventory.length === 0 && sales.length === 0) {
      return;
    }

    // 3. Construct master payload with multi-tenant identity
    const payload = {
      shopId: getShopId(),
      customers,
      inventory,
      sales
    };

    // 4. Execute API request
    const response = await fetch(`${import.meta.env.VITE_API_URL}/api/v1/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    // 5. If successful, transactionally update local records to synced via bulkPut
    if (response.status === 200) {
      await msme_ledger_db.transaction(
        'rw',
        [msme_ledger_db.customers, msme_ledger_db.inventory, msme_ledger_db.sales],
        async () => {
          const syncedCustomers = customers.map(record => ({ ...record, sync_status: 'synced' }));
          const syncedInventory = inventory.map(record => ({ ...record, sync_status: 'synced' }));
          const syncedSales = sales.map(record => ({ ...record, sync_status: 'synced' }));

          if (syncedCustomers.length > 0) {
            await msme_ledger_db.customers.bulkPut(syncedCustomers);
          }
          if (syncedInventory.length > 0) {
            await msme_ledger_db.inventory.bulkPut(syncedInventory);
          }
          if (syncedSales.length > 0) {
            await msme_ledger_db.sales.bulkPut(syncedSales);
          }
        }
      );
    } else {
      console.error(`Sync rejected by backend. Status: ${response.status}`);
    }
  } catch (error) {
    // Graceful failure if the backend is unreachable or network drops halfway
    console.error('Background sync failed due to network or server error.', error);
  }
}
