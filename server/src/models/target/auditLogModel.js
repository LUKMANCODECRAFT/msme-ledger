/**
 * Immutable Audit Log Model
 * Strictly conforms to SB Manager Rebuild Blueprint v2.1 Section 23 and SBM-041.
 * 
 * Provides an append-only audit trail for administrative mutations,
 * membership modifications, subscription reviews, and role changes.
 */

import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  actorId: { type: String, required: true, index: true },
  actorRole: { type: String, required: true },
  businessId: { type: String, required: true, index: true },
  action: { type: String, required: true, index: true },
  targetType: { type: String, required: true },
  targetId: { type: String, required: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  ipAddress: { type: String, default: null },
  timestamp: { type: Date, default: Date.now, index: true }
}, {
  versionKey: false,
  timestamps: false // Append-only immutable log
});

auditLogSchema.index({ businessId: 1, timestamp: -1 });
auditLogSchema.index({ actorId: 1, timestamp: -1 });

export const AuditLog = mongoose.models.TargetAuditLog || mongoose.model('TargetAuditLog', auditLogSchema);
