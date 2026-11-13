import mongoose from 'mongoose';

/**
 * Authoritative Target Refresh Token Schema
 * Strictly conforms to SB Manager Rebuild Blueprint v2.1 Section 14 and Phase 4 Architecture Plan Section 4.3.
 * 
 * Cryptographic & Persistence Invariants:
 * - Plaintext refresh tokens are NEVER stored in the database or logged.
 * - tokenHash is the SHA-256 hex digest of the raw 32-byte cryptographically secure token.
 * - TTL index on expiresAt automatically purges expired tokens from MongoDB.
 * - Compound index on { familyId, status } accelerates atomic family revocation checks.
 */
export const refreshTokenSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: String, required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  familyId: { type: String, required: true, index: true },
  status: {
    type: String,
    enum: ['active', 'consumed', 'revoked', 'delivery_terminated'],
    default: 'active',
    index: true
  },
  replacedByHash: { type: String, default: null },
  replacedByTokenHash: { type: String, default: null },
  consumedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
  revocationReason: { type: String, default: null },
  reuseDetectedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  userAgent: { type: String, default: null },
  ipAddress: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { versionKey: false, timestamps: true });

// Compound query indexes
refreshTokenSchema.index({ familyId: 1, status: 1 });
refreshTokenSchema.index({ userId: 1, status: 1 });

export const RefreshToken = mongoose.models.TargetRefreshToken || mongoose.model('TargetRefreshToken', refreshTokenSchema);
