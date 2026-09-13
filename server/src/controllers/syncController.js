import { Customer, Inventory, Sale } from '../models/Ledger.js';

/**
 * Helper function to map an array of records to Mongoose bulkWrite upsert operations.
 * @param {Array} dataArray - The array of records from the sync payload
 * @returns {Array} - Array of Mongoose updateOne operations
 */
const buildBulkOps = (dataArray) => {
  return dataArray.map(item => ({
    updateOne: {
      filter: { id: item.id },
      update: { $set: item },
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
    const { customers, inventory, sales } = req.body;
    
    // Track our concurrent bulk operations
    const bulkPromises = [];

    if (customers && customers.length > 0) {
      const customerOps = buildBulkOps(customers);
      bulkPromises.push(Customer.bulkWrite(customerOps));
    }

    if (inventory && inventory.length > 0) {
      const inventoryOps = buildBulkOps(inventory);
      bulkPromises.push(Inventory.bulkWrite(inventoryOps));
    }

    if (sales && sales.length > 0) {
      const salesOps = buildBulkOps(sales);
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
