import { Customer, Inventory, Sale } from '../models/Ledger.js';

export const getSystemStats = async (req, res) => {
  try {
    const { key } = req.query;
    
    // Security Check
    if (!key || key !== process.env.ADMIN_SECRET_KEY) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // Data Aggregation
    const [totalCustomers, totalInventoryItems, totalSales] = await Promise.all([
      Customer.countDocuments(),
      Inventory.countDocuments(),
      Sale.countDocuments()
    ]);

    // Revenue Calculation
    const aggregationResult = await Sale.aggregate([
      { $group: { _id: null, totalKobo: { $sum: '$totalAmount' } } }
    ]);

    const totalKobo = aggregationResult.length > 0 ? aggregationResult[0].totalKobo : 0;
    const totalVolumeNaira = totalKobo / 100;

    return res.status(200).json({
      success: true,
      timestamp: new Date(),
      data: {
        totalCustomers,
        totalInventoryItems,
        totalSales,
        totalVolumeNaira
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
