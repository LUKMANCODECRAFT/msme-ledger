import { Customer, Inventory, Sale } from '../models/Ledger.js';
import { License } from '../models/License.js';

/**
 * Helper function to map an array of records to Mongoose bulkWrite upsert operations.
 * @param {Array} dataArray - The array of records from the sync payload
 * @param {string} shopId - The verified persistent shop identifier
 * @returns {Array} - Array of Mongoose updateOne operations
 */
const buildBulkOps = (dataArray, shopId) => {
  return dataArray.map(item => ({
    updateOne: {
      filter: { id: item.id, shopId },
      update: { $set: { ...item, shopId } },
      upsert: true
    }
  }));
};

/**
 * Controller to process incoming sync payloads from the offline-first frontend.
 * Enforces atomic-style concurrent processing and idempotent writes.
 */
export const processSync = async (req, res) => {
  try {
    const { shopId, customers, inventory, sales } = req.body;
    
    // Security Check: Enforce Multi-Tenant Data Isolation
    if (!shopId) {
      return res.status(400).json({ success: false, message: 'Bad Request: Missing shopId' });
    }

    // Backend Firewall: Enforce Read-Only Mode for Expired Licenses
    const license = await License.findOne({ shopId });
    if (license && license.status === 'expired') {
      return res.status(403).json({ success: false, message: 'Subscription expired. Read-only mode enforced.' });
    }

    // Track our concurrent bulk operations
    const bulkPromises = [];

    if (customers && customers.length > 0) {
      const customerOps = buildBulkOps(customers, shopId);
      bulkPromises.push(Customer.bulkWrite(customerOps));
    }

    if (inventory && inventory.length > 0) {
      const inventoryOps = buildBulkOps(inventory, shopId);
      bulkPromises.push(Inventory.bulkWrite(inventoryOps));
    }

    if (sales && sales.length > 0) {
      const salesOps = buildBulkOps(sales, shopId);
      bulkPromises.push(Sale.bulkWrite(salesOps));
    }

    // Execute all bulk writes concurrently to minimize database connection lock time
    if (bulkPromises.length > 0) {
      await Promise.all(bulkPromises);
    }

    return res.status(200).json({
      success: true,
      message: "Sync processed successfully"
    });
    
  } catch (error) {
    console.error("Error processing sync payload:", error);
    
    return res.status(500).json({
      success: false,
      message: "Internal Server Error: Failed to process sync payload"
    });
  }
};
