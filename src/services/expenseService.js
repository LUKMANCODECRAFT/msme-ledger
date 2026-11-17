import { sb_db } from '../config/db.js';
import { getShopId } from '../utils/shopIdentity.js';
import { computePayloadHash } from '../utils/hash.js';

export class ExpensePersistenceError extends Error {
  constructor(code, message, details = {}) {
    super(`[${code}] ${message}`);
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

export const VALID_PAYMENT_METHODS = ['cash', 'bank_transfer', 'pos'];

/**
 * Creates and records an operational expense in the normalized target database (sb_db.expenses)
 * alongside its corresponding syncQueue entry in a single atomic Dexie transaction.
 * Strictly guarantees multi-tenant tenant-awareness (businessId), indexed categoryId,
 * strict payment method validation, and payload-verified idempotency.
 * 
 * @param {Object} expenseData
 * @param {string} expenseData.category
 * @param {number} expenseData.amountKobo - Integer Kobo
 * @param {'cash' | 'bank_transfer' | 'pos'} [expenseData.paymentMethod='cash']
 * @param {string} [expenseData.notes]
 * @param {Date|string} [expenseData.expenseDate]
 * @param {string} [expenseData.operationId] - Optional stable operation ID for idempotent retries
 * @param {string} [expenseData.businessId] - Optional explicit tenant identity
 * @returns {Promise<Object>} The newly created or idempotently retrieved expense record
 */
export async function recordExpense({
  category,
  amountKobo,
  paymentMethod = 'cash',
  notes = '',
  expenseDate = new Date(),
  operationId,
  businessId
}) {
  if (!category || typeof category !== 'string' || !category.trim()) {
    throw new ExpensePersistenceError('INVALID_CATEGORY', 'A valid expense category is required.');
  }

  const parsedAmount = parseInt(amountKobo, 10);
  if (isNaN(parsedAmount) || !Number.isInteger(parsedAmount) || parsedAmount <= 0) {
    throw new ExpensePersistenceError('INVALID_AMOUNT', 'Expense amount must be a valid positive integer in Kobo.');
  }

  if (paymentMethod !== undefined && paymentMethod !== null && !VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    throw new ExpensePersistenceError(
      'INVALID_PAYMENT_METHOD',
      `Invalid payment method "${paymentMethod}". Must be one of: ${VALID_PAYMENT_METHODS.join(', ')}`
    );
  }
  const normalizedMethod = paymentMethod || 'cash';

  const tenantId = businessId || getShopId();
  if (!tenantId) {
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

  const payloadObj = {
    action: 'RECORD_EXPENSE',
    category: category.trim(),
    amountKobo: parsedAmount,
    paymentMethod: normalizedMethod,
    notes: notes ? notes.trim() : ''
  };
  const payloadHash = await computePayloadHash(payloadObj);

  const expenseRecord = {
    id: expenseId,
    businessId: tenantId,
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
    businessId: tenantId,
    entityType: 'expense',
    entityId: expenseId,
    payloadHash,
    payload: payloadObj,
    sagaState: 'operational_committed',
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
      if (existingOp) {
        if (existingOp.businessId && existingOp.businessId !== tenantId) {
          throw new ExpensePersistenceError(
            'IDEMPOTENCY_TENANT_MISMATCH',
            `Operation ID "${opId}" belongs to a different business tenant.`
          );
        }
        if (existingOp.payloadHash && existingOp.payloadHash !== payloadHash) {
          throw new ExpensePersistenceError(
            'IDEMPOTENCY_PAYLOAD_MISMATCH',
            `Operation ID "${opId}" was already executed with a different expense payload.`
          );
        }
        if (existingOp.entityId) {
          const existingExpense = await sb_db.expenses.get(existingOp.entityId);
          if (existingExpense) {
            resultRecord = existingExpense;
            return;
          }
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
