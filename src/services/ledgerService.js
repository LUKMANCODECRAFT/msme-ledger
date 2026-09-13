import { msme_ledger_db } from '../config/db.js';

/**
 * Record a new sale transaction.
 * Ensures atomicity across sales, inventory, and customers tables.
 * 
 * @param {Object} saleData
 * @param {string} saleData.customerId
 * @param {Array<{inventoryId: string, quantity: number, price: number}>} saleData.items
 * @param {number} saleData.amountPaid - Kobo (integer)
 * @returns {Promise<string>} The new sale ID
 */
export async function recordSale({ customerId, items, amountPaid }) {
  const parsedAmountPaid = parseInt(amountPaid, 10);
  
  if (isNaN(parsedAmountPaid)) {
    throw new Error('amountPaid must be a valid number representing Kobo.');
  }

  // Wrap logic in a read-write transaction covering all affected tables
  return await msme_ledger_db.transaction(
    'rw', 
    [msme_ledger_db.sales, msme_ledger_db.inventory, msme_ledger_db.customers], 
    async () => {
      let totalAmount = 0;

      // Process inventory items
      for (const item of items) {
        const parsedPrice = parseInt(item.price, 10);
        const parsedQuantity = parseInt(item.quantity, 10);

        if (isNaN(parsedPrice) || isNaN(parsedQuantity)) {
          throw new Error('Item price and quantity must be valid numbers.');
        }

        const inventoryRecord = await msme_ledger_db.inventory.get(item.inventoryId);
        
        if (!inventoryRecord) {
          throw new Error(`Inventory item with ID ${item.inventoryId} not found.`);
        }

        if (inventoryRecord.stockCount < parsedQuantity) {
          throw new Error(
            `Insufficient stock for inventory item ${inventoryRecord.itemName}. Available: ${inventoryRecord.stockCount}, Requested: ${parsedQuantity}.`
          );
        }

        // Deduct quantity
        inventoryRecord.stockCount -= parsedQuantity;
        inventoryRecord.updatedAt = new Date();
        inventoryRecord.sync_status = 'pending';
        await msme_ledger_db.inventory.put(inventoryRecord);

        totalAmount += (parsedPrice * parsedQuantity);
      }

      const balance = totalAmount - parsedAmountPaid;

      // Determine payment status
      let paymentStatus = 'unpaid';
      if (parsedAmountPaid >= totalAmount) {
        paymentStatus = 'paid';
      } else if (parsedAmountPaid > 0) {
        paymentStatus = 'partial';
      }

      // Update customer debt if balance > 0
      if (balance > 0) {
        const customerRecord = await msme_ledger_db.customers.get(customerId);
        if (!customerRecord) {
          throw new Error(`Customer with ID ${customerId} not found.`);
        }

        customerRecord.totalDebt += balance;
        customerRecord.updatedAt = new Date();
        customerRecord.sync_status = 'pending';
        await msme_ledger_db.customers.put(customerRecord);
      }

      // Insert the final sale record
      const saleId = crypto.randomUUID();
      const saleRecord = {
        id: saleId,
        customerId,
        items: items.map(item => ({
          inventoryId: item.inventoryId,
          quantity: parseInt(item.quantity, 10),
          price: parseInt(item.price, 10)
        })),
        totalAmount,
        amountPaid: parsedAmountPaid,
        balance,
        paymentStatus,
        sync_status: 'pending',
        date: new Date()
      };

      await msme_ledger_db.sales.add(saleRecord);

      return saleId;
    }
  );
}

/**
 * Create a new customer record.
 * 
 * @param {Object} customerData
 * @param {string} customerData.name
 * @param {string} customerData.phone
 * @returns {Promise<string>} The new customer ID
 */
export async function createCustomer(customerData) {
  const customerId = crypto.randomUUID();
  
  const customerRecord = {
    id: customerId,
    name: customerData.name,
    phone: customerData.phone,
    totalDebt: 0,
    sync_status: 'pending',
    updatedAt: new Date()
  };

  await msme_ledger_db.customers.add(customerRecord);
  return customerId;
}

/**
 * Add a new inventory item.
 * 
 * @param {Object} inventoryData
 * @param {string} inventoryData.itemName
 * @param {number|string} inventoryData.price - Kobo
 * @param {number|string} inventoryData.stockCount
 * @returns {Promise<string>} The new inventory ID
 */
export async function addInventory(inventoryData) {
  const inventoryId = crypto.randomUUID();
  
  const parsedPrice = parseInt(inventoryData.price, 10);
  const parsedStockCount = parseInt(inventoryData.stockCount, 10);

  if (isNaN(parsedPrice) || isNaN(parsedStockCount)) {
    throw new Error('Inventory price and stockCount must be valid numbers.');
  }
  
  const inventoryRecord = {
    id: inventoryId,
    itemName: inventoryData.itemName,
    price: parsedPrice,
    stockCount: parsedStockCount,
    sync_status: 'pending',
    updatedAt: new Date()
  };

  await msme_ledger_db.inventory.add(inventoryRecord);
  return inventoryId;
}
