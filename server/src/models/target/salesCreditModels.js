import mongoose from 'mongoose';
import {
  INTEGER_KOBO_VALIDATOR,
  SCALED_QUANTITY_VALIDATOR,
  isIntegerKobo
} from './validators.js';

// Cost allocation embedded schema
const costAllocationSchema = new mongoose.Schema({
  portionType: { type: String, enum: ['unvalued_legacy', 'verified_wac'], required: true },
  quantity: { type: Number, required: true, validate: SCALED_QUANTITY_VALIDATOR },
  unitCost: { type: Number, default: null, validate: { validator: isIntegerKobo, message: 'unitCost must be integer Kobo or null' } },
  totalCost: { type: Number, default: null, validate: { validator: isIntegerKobo, message: 'totalCost must be integer Kobo or null' } },
  isCostSpecified: { type: Boolean, required: true }
}, { _id: false });

// Sale Item embedded schema
const saleItemSchema = new mongoose.Schema({
  id: { type: String, required: true },
  itemType: { type: String, enum: ['product', 'service'], required: true },
  productId: { type: String, default: null },
  serviceId: { type: String, default: null },
  name: { type: String, required: true },
  quantity: { type: Number, required: true, validate: SCALED_QUANTITY_VALIDATOR },
  unitSellingPrice: { type: Number, required: true, validate: INTEGER_KOBO_VALIDATOR },
  discountAmount: { type: Number, default: 0, validate: INTEGER_KOBO_VALIDATOR },
  lineTotal: { type: Number, required: true, validate: INTEGER_KOBO_VALIDATOR },
  costAllocations: { type: [costAllocationSchema], default: [] },
  unvaluedQuantity: { type: Number, default: 0, validate: SCALED_QUANTITY_VALIDATOR },
  verifiedQuantity: { type: Number, default: 0, validate: SCALED_QUANTITY_VALIDATOR },
  verifiedCogs: { type: Number, default: 0, validate: INTEGER_KOBO_VALIDATOR },
  hasUnvaluedPortion: { type: Boolean, default: false }
}, { _id: false });

// 1. Sale
const saleSchema = new mongoose.Schema({
  id: { type: String, required: true },
  businessId: { type: String, required: true, index: true },
  saleNumber: { type: String, required: true },
  customerId: { type: String, default: null, index: true },
  items: { type: [saleItemSchema], required: true },
  subtotal: { type: Number, required: true, validate: INTEGER_KOBO_VALIDATOR },
  discountAmount: { type: Number, default: 0, validate: INTEGER_KOBO_VALIDATOR },
  totalAmount: { type: Number, required: true, validate: INTEGER_KOBO_VALIDATOR },
  amountPaid: { type: Number, default: 0, validate: INTEGER_KOBO_VALIDATOR },
  creditAmount: { type: Number, default: 0, validate: INTEGER_KOBO_VALIDATOR },
  paymentStatus: { type: String, enum: ['paid', 'partial', 'credit'], required: true },
  saleDate: { type: Date, required: true },
  clientRevision: { type: Number, default: 1 },
  serverRevision: { type: Number, default: 1 },
  sync_status: { type: String, enum: ['pending', 'synced'], default: 'pending' },
  updatedAt: { type: Date, default: Date.now }
}, { versionKey: false });
saleSchema.index({ businessId: 1, id: 1 }, { unique: true });
saleSchema.index({ businessId: 1, saleDate: 1 });
saleSchema.index({ businessId: 1, customerId: 1 });

// 2. SalePayment
const salePaymentSchema = new mongoose.Schema({
  id: { type: String, required: true },
  saleId: { type: String, required: true, index: true },
  businessId: { type: String, required: true, index: true },
  amount: { type: Number, required: true, validate: INTEGER_KOBO_VALIDATOR },
  paymentMethod: { type: String, enum: ['cash', 'bank_transfer', 'pos', 'other'], required: true },
  reference: { type: String, default: null },
  paymentDate: { type: Date, required: true },
  sync_status: { type: String, enum: ['pending', 'synced'], default: 'pending' }
}, { versionKey: false });
salePaymentSchema.index({ businessId: 1, id: 1 }, { unique: true });
salePaymentSchema.index({ businessId: 1, saleId: 1 });

// 3. CreditEntry
const creditEntrySchema = new mongoose.Schema({
  id: { type: String, required: true },
  businessId: { type: String, required: true, index: true },
  customerId: { type: String, required: true, index: true },
  saleId: { type: String, default: null },
  entryType: { type: String, enum: ['sale_credit', 'legacy_opening_balance', 'manual_credit'], required: true },
  originalAmount: { type: Number, required: true, validate: INTEGER_KOBO_VALIDATOR },
  settledAmount: { type: Number, default: 0, validate: INTEGER_KOBO_VALIDATOR },
  adjustedAmount: { type: Number, default: 0, validate: INTEGER_KOBO_VALIDATOR },
  remainingBalance: { type: Number, required: true, validate: INTEGER_KOBO_VALIDATOR },
  dueDate: { type: Date, default: null },
  status: { type: String, enum: ['open', 'partially_paid', 'settled', 'written_off'], default: 'open' },
  sync_status: { type: String, enum: ['pending', 'synced'], default: 'pending' },
  updatedAt: { type: Date, default: Date.now }
}, { versionKey: false });
creditEntrySchema.index({ businessId: 1, id: 1 }, { unique: true });
creditEntrySchema.index({ businessId: 1, customerId: 1 });
creditEntrySchema.index({ businessId: 1, status: 1 });

// 4. CreditPayment
const creditPaymentSchema = new mongoose.Schema({
  id: { type: String, required: true },
  creditEntryId: { type: String, default: null, index: true },
  customerId: { type: String, required: true, index: true },
  businessId: { type: String, required: true, index: true },
  amount: { type: Number, required: true, validate: INTEGER_KOBO_VALIDATOR },
  paymentMethod: { type: String, enum: ['cash', 'bank_transfer', 'pos', 'other'], required: true },
  allocationStatus: { type: String, enum: ['allocated', 'unallocated_legacy_historical'], default: 'allocated' },
  paymentDate: { type: Date, required: true },
  sync_status: { type: String, enum: ['pending', 'synced'], default: 'pending' }
}, { versionKey: false });
creditPaymentSchema.index({ businessId: 1, id: 1 }, { unique: true });
creditPaymentSchema.index({ businessId: 1, customerId: 1 });
creditPaymentSchema.index({ businessId: 1, creditEntryId: 1 });

// 5. CreditAdjustment
const creditAdjustmentSchema = new mongoose.Schema({
  id: { type: String, required: true },
  creditEntryId: { type: String, required: true, index: true },
  businessId: { type: String, required: true, index: true },
  adjustmentType: { type: String, enum: ['write_off_bad_debt', 'dispute_forgiveness', 'correction'], required: true },
  amount: { type: Number, required: true, validate: INTEGER_KOBO_VALIDATOR },
  reason: { type: String, required: true },
  adjustedAt: { type: Date, required: true },
  sync_status: { type: String, enum: ['pending', 'synced'], default: 'pending' }
}, { versionKey: false });
creditAdjustmentSchema.index({ businessId: 1, id: 1 }, { unique: true });
creditAdjustmentSchema.index({ businessId: 1, creditEntryId: 1 });

export const Sale = mongoose.model('TargetSale', saleSchema);
export const SalePayment = mongoose.model('TargetSalePayment', salePaymentSchema);
export const CreditEntry = mongoose.model('TargetCreditEntry', creditEntrySchema);
export const CreditPayment = mongoose.model('TargetCreditPayment', creditPaymentSchema);
export const CreditAdjustment = mongoose.model('TargetCreditAdjustment', creditAdjustmentSchema);

