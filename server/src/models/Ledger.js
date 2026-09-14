import mongoose from 'mongoose';

const customerSchema = new mongoose.Schema({
  shopId: { type: String, required: true, index: true },
  id: { type: String, required: true, unique: true },
  name: { type: String },
  phone: { type: String },
  totalDebt: { type: Number }
}, { versionKey: false });

const inventorySchema = new mongoose.Schema({
  shopId: { type: String, required: true, index: true },
  id: { type: String, required: true, unique: true },
  itemName: { type: String },
  price: { type: Number },
  stockCount: { type: Number }
}, { versionKey: false });

const saleSchema = new mongoose.Schema({
  shopId: { type: String, required: true, index: true },
  id: { type: String, required: true, unique: true },
  customerId: { type: String },
  items: { type: Array },
  totalAmount: { type: Number },
  amountPaid: { type: Number },
  balance: { type: Number },
  paymentStatus: { type: String },
  date: { type: Date }
}, { versionKey: false });

export const Customer = mongoose.model('Customer', customerSchema);
export const Inventory = mongoose.model('Inventory', inventorySchema);
export const Sale = mongoose.model('Sale', saleSchema);
