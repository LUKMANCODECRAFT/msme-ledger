/**
 * Target Subscription Model — SBM-042
 * Strictly adheres to SB Manager Rebuild Blueprint v2.1 Section 15.
 * 
 * Tracks manual bank-transfer subscription workflows, payment proofs,
 * offline entitlement tokens, and administrative review lifecycles.
 */

import mongoose from 'mongoose';
import { INTEGER_KOBO_VALIDATOR } from './validators.js';

const subscriptionSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  businessId: { type: String, required: true, index: true },
  planId: { type: String, enum: ['free', 'pro', 'enterprise'], required: true, default: 'free' },
  status: {
    type: String,
    enum: ['active', 'pending_verification', 'rejected', 'expired'],
    required: true,
    default: 'pending_verification'
  },
  paymentReference: { type: String, required: true, unique: true },
  paymentAmount: { type: Number, required: true, validate: INTEGER_KOBO_VALIDATOR },
  paymentMethod: { type: String, enum: ['bank_transfer'], default: 'bank_transfer' },
  proofImageUrl: { type: String, default: null },
  submittedBy: { type: String, required: true, index: true },
  submittedAt: { type: Date, default: Date.now },
  reviewedBy: { type: String, default: null },
  reviewedAt: { type: Date, default: null },
  rejectionReason: { type: String, default: null },
  activeFrom: { type: Date, default: null },
  expiresAt: { type: Date, default: null, index: true },
  gracePeriodUntil: { type: Date, default: null },
  entitlementToken: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  versionKey: false,
  timestamps: true
});

subscriptionSchema.index({ businessId: 1, status: 1 });
subscriptionSchema.index({ status: 1, submittedAt: -1 });

export const Subscription = mongoose.models.TargetSubscription || mongoose.model('TargetSubscription', subscriptionSchema);
