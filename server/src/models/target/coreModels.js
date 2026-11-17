import mongoose from 'mongoose';
import {
  INTEGER_KOBO_VALIDATOR,
  SCALED_QUANTITY_VALIDATOR,
  SIGNED_SCALED_QUANTITY_VALIDATOR,
  isIntegerKobo
} from './validators.js';

// 1. Business
const businessSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  type: { type: String, enum: ['retail', 'service', 'mixed', 'general'], required: true },
  currency: { type: String, default: 'NGN' },
  identityStatus: { type: String, enum: ['verified_claimed', 'unresolved_unclaimed'], default: 'unresolved_unclaimed' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  version: { type: Number, default: 1 }
}, { versionKey: false, timestamps: true });

// 2. User
const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  fullName: { type: String, required: true },
  defaultBusinessId: { type: String, default: null },
  isEmailVerified: { type: Boolean, default: false },
  sessionVersion: { type: Number, default: 1 },
  failedLoginAttempts: { type: Number, default: 0 },
  lockoutUntil: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { versionKey: false, timestamps: true });
userSchema.index({ email: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

// 3. Membership
const membershipSchema = new mongoose.Schema({
  id: { type: String, required: true },
  userId: { type: String, required: true, index: true },
  businessId: { type: String, required: true, index: true },
  role: { type: String, enum: ['owner', 'manager', 'cashier'], required: true }
}, { versionKey: false });
membershipSchema.index({ businessId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ businessId: 1, id: 1 }, { unique: true });

// 4. Customer
const customerSchema = new mongoose.Schema({
  id: { type: String, required: true },
  businessId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  phone: { type: String, default: null },
  email: { type: String, default: null },
  address: { type: String, default: null },
  isArchived: { type: Boolean, default: false },
  sync_status: { type: String, enum: ['pending', 'synced'], default: 'pending' },
  updatedAt: { type: Date, default: Date.now },
  version: { type: Number, default: 1 }
}, { versionKey: false });
customerSchema.index({ businessId: 1, id: 1 }, { unique: true });
customerSchema.index({ businessId: 1, phone: 1 });

// 5. Product
const productSchema = new mongoose.Schema({
  id: { type: String, required: true },
  businessId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  sku: { type: String, default: null },
  barcode: { type: String, default: null },
  sellingPrice: { type: Number, required: true, validate: INTEGER_KOBO_VALIDATOR },
  costPrice: { type: Number, default: null, validate: { validator: isIntegerKobo, message: 'costPrice must be an integer in Kobo or null.' } },
  hasVerifiedCost: { type: Boolean, required: true },
  currentStock: { type: Number, required: true, default: 0, validate: SIGNED_SCALED_QUANTITY_VALIDATOR },
  reorderPoint: { type: Number, default: 5000, validate: SCALED_QUANTITY_VALIDATOR },
  isArchived: { type: Boolean, default: false },
  sync_status: { type: String, enum: ['pending', 'synced'], default: 'pending' },
  updatedAt: { type: Date, default: Date.now },
  version: { type: Number, default: 1 }
}, { versionKey: false });
productSchema.index({ businessId: 1, id: 1 }, { unique: true });
productSchema.index({ businessId: 1, name: 1 });
productSchema.index({ businessId: 1, sku: 1 });

// 6. Service
const serviceSchema = new mongoose.Schema({
  id: { type: String, required: true },
  businessId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  price: { type: Number, required: true, validate: INTEGER_KOBO_VALIDATOR },
  isArchived: { type: Boolean, default: false },
  sync_status: { type: String, enum: ['pending', 'synced'], default: 'pending' },
  updatedAt: { type: Date, default: Date.now },
  version: { type: Number, default: 1 }
}, { versionKey: false });
serviceSchema.index({ businessId: 1, id: 1 }, { unique: true });

// Export Models
export const Business = mongoose.model('TargetBusiness', businessSchema);
export const User = mongoose.model('TargetUser', userSchema);
export const Membership = mongoose.model('TargetMembership', membershipSchema);
export const Customer = mongoose.model('TargetCustomer', customerSchema);
export const Product = mongoose.model('TargetProduct', productSchema);
export const Service = mongoose.model('TargetService', serviceSchema);
