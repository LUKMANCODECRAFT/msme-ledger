import mongoose from 'mongoose';

const licenseSchema = new mongoose.Schema({
  shopId: { type: String, required: true, unique: true },
  status: { type: String, enum: ['trial', 'active', 'expired'], default: 'trial' },
  expiresAt: { 
    type: Date, 
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) 
  }
}, { versionKey: false, timestamps: true });

export const License = mongoose.model('License', licenseSchema);
