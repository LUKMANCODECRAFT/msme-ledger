import mongoose from 'mongoose';
import {
  INTEGER_KOBO_VALIDATOR,
  SCALED_QUANTITY_VALIDATOR,
  SIGNED_SCALED_QUANTITY_VALIDATOR,
  isIntegerKobo
} from './validators.js';

// Inventory Purchase Item Embedded Schema
const purchaseItemSchema = new mongoose.Schema({
  productId: { type: String, required: true },
  productName: { type: String, required: true },
  quantity: { type: Number, required: true, validate: SCALED_QUANTITY_VALIDATOR },
  unitCost: { type: Number, required: true, validate: INTEGER_KOBO_VALIDATOR },
  lineTotal: { type: Number, required: true, validate: INTEGER_KOBO_VALIDATOR }
}, { _id: false });

// 1. InventoryPurchase
const inventoryPurchaseSchema = new mongoose.Schema({
  id: { type: String, required: true },
  businessId: { type: String, required: true, index: true },
  purchaseNumber: { type: String, required: true },
  supplierName: { type: String, default: null },
  items: { type: [purchaseItemSchema], required: true },
  subtotal: { type: Number, required: true, validate: INTEGER_KOBO_VALIDATOR },
  shippingCost: { type: Number, default: 0, validate: INTEGER_KOBO_VALIDATOR },
  totalCost: { type: Number, required: true, validate: INTEGER_KOBO_VALIDATOR },
  amountPaid: { type: Number, default: 0, validate: INTEGER_KOBO_VALIDATOR },
  paymentStatus: { type: String, enum: ['paid', 'partial', 'unpaid'], required: true },
  purchaseDate: { type: Date, required: true },
  sync_status: { type: String, enum: ['pending', 'synced'], default: 'pending' },
  version: { type: Number, default: 1 }
}, { versionKey: false });
inventoryPurchaseSchema.index({ businessId: 1, id: 1 }, { unique: true });
inventoryPurchaseSchema.index({ businessId: 1, purchaseNumber: 1 });
inventoryPurchaseSchema.index({ businessId: 1, purchaseDate: 1 });

// 2. PurchasePayment
const purchasePaymentSchema = new mongoose.Schema({
  id: { type: String, required: true },
  purchaseId: { type: String, required: true, index: true },
  businessId: { type: String, required: true, index: true },
  amount: { type: Number, required: true, validate: INTEGER_KOBO_VALIDATOR },
  paymentMethod: { type: String, enum: ['cash', 'bank_transfer', 'pos', 'other'], required: true },
  paymentDate: { type: Date, required: true },
  sync_status: { type: String, enum: ['pending', 'synced'], default: 'pending' }
}, { versionKey: false });
purchasePaymentSchema.index({ businessId: 1, id: 1 }, { unique: true });
purchasePaymentSchema.index({ businessId: 1, purchaseId: 1 });

// 3. StockMovement
const stockMovementSchema = new mongoose.Schema({
  id: { type: String, required: true },
  businessId: { type: String, required: true, index: true },
  productId: { type: String, required: true, index: true },
  movementType: { 
    type: String, 
    enum: [
      'opening_balance',
      'purchase_receipt',
      'sale_deduction',
      'sale_reversal',
      'adjustment_loss',
      'adjustment_found',
      'purchase_return'
    ], 
    required: true 
  },
  quantityDelta: { type: Number, required: true, validate: SIGNED_SCALED_QUANTITY_VALIDATOR },
  unitCost: { type: Number, default: null, validate: { validator: isIntegerKobo, message: 'unitCost must be integer Kobo or null.' } },
  referenceType: { 
    type: String, 
    enum: ['inventoryPurchase', 'sale', 'stockAdjustment', 'legacyOpening'], 
    default: null 
  },
  referenceId: { type: String, default: null },
  movementDate: { type: Date, required: true },
  sync_status: { type: String, enum: ['pending', 'synced'], default: 'pending' }
}, { versionKey: false });
stockMovementSchema.index({ businessId: 1, id: 1 }, { unique: true });
stockMovementSchema.index({ businessId: 1, productId: 1, movementDate: 1 });

export const InventoryPurchase = mongoose.model('TargetInventoryPurchase', inventoryPurchaseSchema);
export const PurchasePayment = mongoose.model('TargetPurchasePayment', purchasePaymentSchema);
export const StockMovement = mongoose.model('TargetStockMovement', stockMovementSchema);

