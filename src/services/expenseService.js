import { sb_db } from '../config/db.js';
import { getShopId } from '../utils/shopIdentity.js';

export class ExpensePersistenceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ExpensePersistenceError';
    this.code = code;
    this.details = details;
  }
}

export const EXPENSE_CATEGORIES = [
  'Electricity & Utilities',
  'Rent & Shop Lease',
  'Transportation & Logistics',
  'Staff Wages & Allowances',
  'Packaging & Supplies',
  'Equipment Repairs',
  'Generator Fuel',
  'Marketing & Signage',
  'Miscellaneous Overhead'
];

/**
 * Creates and records an operational expense in the normalized target database (sb_db.expenses)
 * alongside its corresponding syncQueue entry in a single atomic Dexie transaction.
 * Strictly guarantees multi-tenant tenant-awareness (businessId) and indexed categoryId.
 * Never swallows or silences write failures.
 * 
 * @param {Object} expenseData
 * @param {string} expenseData.category
 * @param {number} expenseData.amountKobo - Integer Kobo
 * @param {'cash' | 'bank_transfer' | 'pos'} [expenseData.paymentMethod]
 * @param {string} [expenseData.notes]
 * @param {Date|string} [expenseData.expenseDate]
 * @param {string} [expenseData.operationId] - Optional stable operation ID for idempotent retries
 * @returns {Promise<Object>} The newly created or idempotently retrieved expense record
 */
export async function recordExpense({
  category,
  amountKobo,
  paymentMethod = 'cash',
  notes = '',
  expenseDate = new Date(),
  operationId
}) {
  if (!category || typeof category !== 'string' || !category.trim()) {
    throw new ExpensePersistenceError('INVALID_CATEGORY', 'A valid expense category is required.');
  }

  const parsedAmount = parseInt(amountKobo, 10);
  if (isNaN(parsedAmount) || !Number.isInteger(parsedAmount) || parsedAmount <= 0) {
    throw new ExpensePersistenceError('INVALID_AMOUNT', 'Expense amount must be a valid positive integer in Kobo.');
  }

  const validMethods = ['cash', 'bank_transfer', 'pos'];
  const normalizedMethod = validMethods.includes(paymentMethod) ? paymentMethod : 'cash';

  const businessId = getShopId();
  if (!businessId) {
    throw new ExpensePersistenceError(
      'MISSING_BUSINESS_ID',
      'Cannot write target expense record: Business tenant identity is missing.'
    );
  }

  const categoryId = category
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const expenseId = crypto.randomUUID();
  const opId = operationId || `op_exp_${expenseId}`;

  const expenseRecord = {
    id: expenseId,
    businessId,
    categoryId,
    category: category.trim(),
    amount: parsedAmount,
    notes: notes ? notes.trim() : '',
    paymentMethod: normalizedMethod,
    paymentStatus: 'paid',
    expenseDate: new Date(expenseDate),
    createdAt: new Date(),
    updatedAt: new Date(),
    sync_status: 'pending'
  };

  const queueRecord = {
    operationId: opId,
    entityType: 'expense',
    entityId: expenseId,
    clientRevision: 1,
    status: 'queued',
    queuedAt: new Date().toISOString()
  };

  let resultRecord = expenseRecord;

  // Atomically write expense and syncQueue within a single target transaction
  try {
    await sb_db.transaction('rw', [sb_db.expenses, sb_db.syncQueue], async () => {
      // Check for idempotent retry
      const existingOp = await sb_db.syncQueue.get(opId);
      if (existingOp && existingOp.entityId) {
        const existingExpense = await sb_db.expenses.get(existingOp.entityId);
        if (existingExpense) {
          resultRecord = existingExpense;
          return;
        }
      }

      await sb_db.expenses.put(expenseRecord);
      await sb_db.syncQueue.put(queueRecord);
    });
  } catch (err) {
    if (err instanceof ExpensePersistenceError) {
      throw err;
    }
    throw new ExpensePersistenceError(
      'TARGET_PERSISTENCE_FAILED',
      `Target database expense write failed: ${err.message}`,
      { originalError: err }
    );
  }

  return resultRecord;
}
