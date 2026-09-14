import mongoose from 'mongoose';

const licenseSchema = new mongoose.Schema({
  shopId: { type: String, required: true, unique: true },
  status: { type: String, enum: ['trial', 'active', 'expired'], default: 'trial' },
  expiresAt: { type: Date }
}, { versionKey: false, timestamps: true });

export const License = mongoose.model('License', licenseSchema);
