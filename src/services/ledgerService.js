import { msme_ledger_db } from '../config/db.js';

export const SUPPORTED_PAYMENT_METHODS = ['cash', 'bank_transfer', 'pos'];

/**
 * Record a new sale transaction.
 * Ensures atomicity across sales, inventory, and customers tables.
 * Strictly adheres to FE-01R financial requirements:
 * 1. Integer-kobo calculations.
 * 2. Explicit semantics for total, tendered, change returned, amount applied, and credit.
 * 3. Cash collected (amountPaid) never includes returned change and never exceeds totalAmount.
 * 4. Credit sales require explicit opt-in (allowCredit: true).
 * 5. Payment method is persisted and validated.
 * 6. Overpayment in cash returns change and never alters unrelated debt balances.
 * 
 * @param {Object} saleData
 * @param {string} saleData.customerId
 * @param {Array<{inventoryId: string, quantity: number, price: number}>} saleData.items
 * @param {number} [saleData.amountTendered] - Kobo (integer) tendered by customer
 * @param {number} [saleData.amountPaid] - Legacy fallback for amountTendered in Kobo (integer)
 * @param {'cash' | 'bank_transfer' | 'pos'} [saleData.paymentMethod] - Selected payment method
 * @param {boolean} [saleData.allowCredit] - Whether credit extension is explicitly allowed for shortfall
 * @returns {Promise<string>} The new sale ID
 */
export async function recordSale({
  customerId,
  items,
  amountTendered,
  amountPaid,
  paymentMethod = 'cash',
  allowCredit = false
}) {
  if (!customerId || typeof customerId !== 'string') {
    throw new Error('customerId is required.');
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('items must be a non-empty array.');
  }

  const rawTender = amountTendered !== undefined ? amountTendered : amountPaid;
  const parsedTenderKobo = parseInt(rawTender, 10);

  if (isNaN(parsedTenderKobo) || parsedTenderKobo < 0) {
    throw new Error('amountPaid / amountTendered must be a valid non-negative integer representing Kobo.');
  }

  // Validate payment method
  const normalizedPaymentMethod = SUPPORTED_PAYMENT_METHODS.includes(paymentMethod)
    ? paymentMethod
    : 'cash';

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

        if (isNaN(parsedPrice) || isNaN(parsedQuantity) || parsedQuantity <= 0) {
          throw new Error('Item price and quantity must be valid positive numbers.');
        }

        const inventoryRecord = await msme_ledger_db.inventory.get(item.inventoryId);
        
        if (!inventoryRecord) {
          throw new Error(`Inventory item with ID ${item.inventoryId} not found.`);
        }

        if (inventoryRecord.stockCount < parsedQuantity) {
          throw new Error(
            `Insufficient stock for inventory item "${inventoryRecord.itemName}". Available: ${inventoryRecord.stockCount}, Requested: ${parsedQuantity}.`
          );
        }

        // Deduct quantity
        inventoryRecord.stockCount -= parsedQuantity;
        inventoryRecord.updatedAt = new Date();
        inventoryRecord.sync_status = 'pending';
        await msme_ledger_db.inventory.put(inventoryRecord);

        totalAmount += (parsedPrice * parsedQuantity);
      }

      // Calculate amount applied to sale, change returned, and remaining balance
      // Financial Invariant: Amount applied to sale can NEVER exceed totalAmount!
      const amountApplied = Math.min(totalAmount, parsedTenderKobo);
      const changeReturned = normalizedPaymentMethod === 'cash'
        ? Math.max(0, parsedTenderKobo - totalAmount)
        : 0;
      const balance = totalAmount - amountApplied;

      // Credit enforcement: shortfall requires explicit authorization
      if (balance > 0) {
        if (!allowCredit) {
          throw new Error(
            'Payment is insufficient for full settlement. You must explicitly allow a credit sale to record the remaining balance as customer debt.'
          );
        }

        const customerRecord = await msme_ledger_db.customers.get(customerId);
        if (!customerRecord) {
          throw new Error(`Customer with ID ${customerId} not found.`);
        }

        customerRecord.totalDebt = (customerRecord.totalDebt || 0) + balance;
        customerRecord.updatedAt = new Date();
        customerRecord.sync_status = 'pending';
        await msme_ledger_db.customers.put(customerRecord);
      }

      // Determine payment status
      let paymentStatus = 'unpaid';
      if (balance === 0) {
        paymentStatus = 'paid';
      } else if (amountApplied > 0) {
        paymentStatus = 'partial';
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
        amountPaid: amountApplied, // strictly amount applied to the sale, excluding change!
        amountTendered: parsedTenderKobo,
        changeReturned,
        balance,
        paymentStatus,
        paymentMethod: normalizedPaymentMethod,
        sync_status: 'pending',
        date: new Date()
      };

      await msme_ledger_db.sales.add(saleRecord);

      return saleId;
    }
  );
}

/**
 * Records a customer debt repayment atomically.
 * Updates customer.totalDebt and inserts a PAYMENT transaction in a single Dexie transaction.
 * If either write fails, the entire operation is rolled back.
 * Never creates a sale record.
 *
 * @param {Object} repaymentData
 * @param {string} repaymentData.customerId
 * @param {number} repaymentData.amountKobo - Integer Kobo
 * @param {'cash' | 'bank_transfer' | 'pos'} [repaymentData.paymentMethod]
 * @param {string} [repaymentData.notes]
 * @returns {Promise<{ transactionId: string, customerId: string, amountKobo: number, remainingDebt: number }>}
 */
export async function recordCustomerRepayment({
  customerId,
  amountKobo,
  paymentMethod = 'cash',
  notes = ''
}) {
  if (!customerId || typeof customerId !== 'string') {
    throw new Error('customerId is required.');
  }

  const parsedAmount = parseInt(amountKobo, 10);
  if (isNaN(parsedAmount) || !Number.isInteger(parsedAmount) || parsedAmount <= 0) {
    throw new Error('Repayment amount must be a valid positive integer in Kobo.');
  }

  const normalizedMethod = SUPPORTED_PAYMENT_METHODS.includes(paymentMethod)
    ? paymentMethod
    : 'cash';

  return await msme_ledger_db.transaction(
    'rw',
    [msme_ledger_db.customers, msme_ledger_db.transactions],
    async () => {
      const customer = await msme_ledger_db.customers.get(customerId);
      if (!customer) {
        throw new Error(`Customer with ID ${customerId} not found.`);
      }

      const currentDebt = customer.totalDebt || 0;
      if (parsedAmount > currentDebt) {
        throw new Error(
          `Repayment amount of ${parsedAmount} Kobo exceeds outstanding debt of ${currentDebt} Kobo.`
        );
      }

      const remainingDebt = currentDebt - parsedAmount;

      // 1. Update customer debt
      customer.totalDebt = remainingDebt;
      customer.updatedAt = new Date();
      customer.sync_status = 'pending';
      await msme_ledger_db.customers.put(customer);

      // 2. Insert auditable transaction event
      const transactionId = crypto.randomUUID();
      const txRecord = {
        id: transactionId,
        customerId,
        type: 'PAYMENT',
        amount: parsedAmount,
        paymentMethod: normalizedMethod,
        notes: notes ? notes.trim() : undefined,
        date: new Date().toISOString(),
        sync_status: 'pending'
      };

      await msme_ledger_db.transactions.add(txRecord);

      return {
        transactionId,
        customerId,
        amountKobo: parsedAmount,
        remainingDebt
      };
    }
  );
}

/**
 * Clears a customer's entire outstanding debt atomically.
 * Updates customer.totalDebt to 0 and records an auditable PAYMENT transaction event.
 * If the customer has 0 debt, returns without mutation.
 *
 * @param {Object} clearData
 * @param {string} clearData.customerId
 * @param {'cash' | 'bank_transfer' | 'pos'} [clearData.paymentMethod]
 * @param {string} [clearData.notes]
 * @returns {Promise<{ transactionId: string|null, customerId: string, clearedAmount: number, remainingDebt: number }>}
 */
export async function clearCustomerDebt({
  customerId,
  paymentMethod = 'cash',
  notes = 'Full debt settlement'
}) {
  if (!customerId || typeof customerId !== 'string') {
    throw new Error('customerId is required.');
  }

  const normalizedMethod = SUPPORTED_PAYMENT_METHODS.includes(paymentMethod)
    ? paymentMethod
    : 'cash';

  return await msme_ledger_db.transaction(
    'rw',
    [msme_ledger_db.customers, msme_ledger_db.transactions],
    async () => {
      const customer = await msme_ledger_db.customers.get(customerId);
      if (!customer) {
        throw new Error(`Customer with ID ${customerId} not found.`);
      }

      const debtToClear = customer.totalDebt || 0;
      if (debtToClear <= 0) {
        return {
          transactionId: null,
          customerId,
          clearedAmount: 0,
          remainingDebt: 0
        };
      }

      // 1. Reset debt to zero
      customer.totalDebt = 0;
      customer.updatedAt = new Date();
      customer.sync_status = 'pending';
      await msme_ledger_db.customers.put(customer);

      // 2. Create auditable transaction event
      const transactionId = crypto.randomUUID();
      const txRecord = {
        id: transactionId,
        customerId,
        type: 'PAYMENT',
        amount: debtToClear,
        paymentMethod: normalizedMethod,
        notes: notes ? notes.trim() : 'Full debt settlement',
        date: new Date().toISOString(),
        sync_status: 'pending'
      };

      await msme_ledger_db.transactions.add(txRecord);

      return {
        transactionId,
        customerId,
        clearedAmount: debtToClear,
        remainingDebt: 0
      };
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
