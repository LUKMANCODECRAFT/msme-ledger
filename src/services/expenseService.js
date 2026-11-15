import { sb_db } from '../config/db.js';
import { getShopId } from '../utils/shopIdentity.js';

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
 * Creates and records an operational expense in the normalized target database (sb_db.expenses).
 * Strictly guarantees multi-tenant tenant-awareness (businessId) and indexed categoryId.
 * Never swallows or silences write failures.
 * 
 * @param {Object} expenseData
 * @param {string} expenseData.category
 * @param {number} expenseData.amountKobo - Integer Kobo
 * @param {'cash' | 'bank_transfer' | 'pos'} [expenseData.paymentMethod]
 * @param {string} [expenseData.notes]
 * @param {Date|string} [expenseData.expenseDate]
 * @returns {Promise<Object>} The newly created expense record
 */
export async function recordExpense({
  category,
  amountKobo,
  paymentMethod = 'cash',
  notes = '',
  expenseDate = new Date()
}) {
  if (!category || typeof category !== 'string' || !category.trim()) {
    throw new Error('A valid expense category is required.');
  }

  const parsedAmount = parseInt(amountKobo, 10);
  if (isNaN(parsedAmount) || !Number.isInteger(parsedAmount) || parsedAmount <= 0) {
    throw new Error('Expense amount must be a valid positive integer in Kobo.');
  }

  const validMethods = ['cash', 'bank_transfer', 'pos'];
  const normalizedMethod = validMethods.includes(paymentMethod) ? paymentMethod : 'cash';

  const businessId = getShopId();
  if (!businessId) {
    throw new Error('Cannot write target expense record: Business tenant identity is missing.');
  }

  const categoryId = category
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const expenseId = crypto.randomUUID();
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

  // Write to sb_db.expenses and let any database failure propagate cleanly
  await sb_db.expenses.add(expenseRecord);

  return expenseRecord;
}
