import mongoose from 'mongoose';
import { INTEGER_KOBO_VALIDATOR } from './validators.js';

// 1. ExpenseCategory
const expenseCategorySchema = new mongoose.Schema({
  id: { type: String, required: true },
  businessId: { type: String, required: true, index: true },
  name: { type: String, required: true }
}, { versionKey: false });
expenseCategorySchema.index({ businessId: 1, id: 1 }, { unique: true });
expenseCategorySchema.index({ businessId: 1, name: 1 });

// 2. Expense
const expenseSchema = new mongoose.Schema({
  id: { type: String, required: true },
  businessId: { type: String, required: true, index: true },
  categoryId: { type: String, required: true, index: true },
  amount: { type: Number, required: true, validate: INTEGER_KOBO_VALIDATOR },
  amountPaid: { type: Number, default: 0, validate: INTEGER_KOBO_VALIDATOR },
  paymentStatus: { type: String, enum: ['paid', 'unpaid', 'partial'], required: true },
  description: { type: String, required: true },
  expenseDate: { type: Date, required: true },
  sync_status: { type: String, enum: ['pending', 'synced'], default: 'pending' },
  updatedAt: { type: Date, default: Date.now }
}, { versionKey: false });
expenseSchema.index({ businessId: 1, id: 1 }, { unique: true });
expenseSchema.index({ businessId: 1, categoryId: 1 });
expenseSchema.index({ businessId: 1, expenseDate: 1 });

// 3. ExpensePayment
const expensePaymentSchema = new mongoose.Schema({
  id: { type: String, required: true },
  expenseId: { type: String, required: true, index: true },
  businessId: { type: String, required: true, index: true },
  amount: { type: Number, required: true, validate: INTEGER_KOBO_VALIDATOR },
  paymentMethod: { type: String, enum: ['cash', 'bank_transfer', 'pos', 'other'], required: true },
  paymentDate: { type: Date, required: true },
  sync_status: { type: String, enum: ['pending', 'synced'], default: 'pending' }
}, { versionKey: false });
expensePaymentSchema.index({ businessId: 1, id: 1 }, { unique: true });
expensePaymentSchema.index({ businessId: 1, expenseId: 1 });

// 4. IncomeEntry
const incomeEntrySchema = new mongoose.Schema({
  id: { type: String, required: true },
  businessId: { type: String, required: true, index: true },
  amount: { type: Number, required: true, validate: INTEGER_KOBO_VALIDATOR },
  source: { 
    type: String, 
    enum: ['operating_service_fee', 'interest', 'grant', 'other_operating'], 
    required: true 
  },
  description: { type: String, required: true },
  receivedDate: { type: Date, required: true },
  sync_status: { type: String, enum: ['pending', 'synced'], default: 'pending' }
}, { versionKey: false });
incomeEntrySchema.index({ businessId: 1, id: 1 }, { unique: true });
incomeEntrySchema.index({ businessId: 1, receivedDate: 1 });

// 5. OwnerEquityTransaction
const ownerEquityTransactionSchema = new mongoose.Schema({
  id: { type: String, required: true },
  businessId: { type: String, required: true, index: true },
  transactionType: { type: String, enum: ['owner_contribution', 'owner_withdrawal'], required: true },
  amount: { type: Number, required: true, validate: INTEGER_KOBO_VALIDATOR },
  paymentMethod: { type: String, enum: ['cash', 'bank_transfer', 'other'], required: true },
  notes: { type: String, required: true },
  transactionDate: { type: Date, required: true },
  sync_status: { type: String, enum: ['pending', 'synced'], default: 'pending' }
}, { versionKey: false });
ownerEquityTransactionSchema.index({ businessId: 1, id: 1 }, { unique: true });
ownerEquityTransactionSchema.index({ businessId: 1, transactionDate: 1 });

// 6. FinancialReversal
const financialReversalSchema = new mongoose.Schema({
  id: { type: String, required: true },
  businessId: { type: String, required: true, index: true },
  targetEntityType: { 
    type: String, 
    enum: ['sale', 'salePayment', 'creditPayment', 'expense', 'inventoryPurchase'], 
    required: true 
  },
  targetEntityId: { type: String, required: true },
  reversalReason: { type: String, required: true },
  reversedAt: { type: Date, required: true },
  reversedByUserId: { type: String, required: true },
  sync_status: { type: String, enum: ['pending', 'synced'], default: 'pending' }
}, { versionKey: false });
financialReversalSchema.index({ businessId: 1, id: 1 }, { unique: true });
financialReversalSchema.index({ businessId: 1, targetEntityType: 1, targetEntityId: 1 });

// 7. AuditLog
const auditLogSchema = new mongoose.Schema({
  id: { type: String, required: true },
  businessId: { type: String, required: true, index: true },
  userId: { type: String, default: null },
  action: { type: String, required: true },
  entityType: { type: String, required: true },
  entityId: { type: String, required: true },
  changes: { type: mongoose.Schema.Types.Mixed, default: {} },
  timestamp: { type: Date, default: Date.now }
}, { versionKey: false });
auditLogSchema.index({ businessId: 1, id: 1 }, { unique: true });
auditLogSchema.index({ businessId: 1, timestamp: -1 });

// 8. Setting
const settingSchema = new mongoose.Schema({
  id: { type: String, required: true },
  businessId: { type: String, required: true, index: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedAt: { type: Date, default: Date.now }
}, { versionKey: false });
settingSchema.index({ businessId: 1, id: 1 }, { unique: true });

export const ExpenseCategory = mongoose.model('TargetExpenseCategory', expenseCategorySchema);
export const Expense = mongoose.model('TargetExpense', expenseSchema);
export const ExpensePayment = mongoose.model('TargetExpensePayment', expensePaymentSchema);
export const IncomeEntry = mongoose.model('TargetIncomeEntry', incomeEntrySchema);
export const OwnerEquityTransaction = mongoose.model('TargetOwnerEquityTransaction', ownerEquityTransactionSchema);
export const FinancialReversal = mongoose.model('TargetFinancialReversal', financialReversalSchema);
export const AuditLog = mongoose.model('TargetAuditLog', auditLogSchema);
export const Setting = mongoose.model('TargetSetting', settingSchema);

