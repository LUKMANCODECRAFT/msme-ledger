import { describe, it, expect } from 'vitest';
import {
  toQuantityUnits,
  fromQuantityUnits,
  isValidScaledQuantity,
  calculateWeightedAverageCost,
  allocateMixedCostSale,
  deriveCurrentStock,
  deriveStockMap,
  validateStockMovement,
  MOVEMENT_TYPES
} from '../domain/inventory/index.js';

describe('SBM-021: Inventory Purchase & Stock Movement Models', () => {

  describe('5.5 Quantity Precision & Scale 1,000 Implementation', () => {
    it('converts whole units correctly to scaled integer units', () => {
      expect(toQuantityUnits('1')).toBe(1000);
      expect(toQuantityUnits(1)).toBe(1000);
      expect(toQuantityUnits('50')).toBe(50000);
      expect(toQuantityUnits(0)).toBe(0);
    });

    it('converts fractional and three-decimal quantities correctly', () => {
      expect(toQuantityUnits('1.5')).toBe(1500);
      expect(toQuantityUnits('0.125')).toBe(125);
      expect(toQuantityUnits('0.001')).toBe(1);
      expect(toQuantityUnits('10.05')).toBe(10050);
      expect(toQuantityUnits('3.750')).toBe(3750);
    });

    it('converts scaled units back to display representation', () => {
      expect(fromQuantityUnits(1000)).toBe(1);
      expect(fromQuantityUnits(1500)).toBe(1.5);
      expect(fromQuantityUnits(125)).toBe(0.125);
      expect(fromQuantityUnits(1)).toBe(0.001);

      expect(fromQuantityUnits(1500, { asString: true })).toBe('1.5');
      expect(fromQuantityUnits(125, { asString: true })).toBe('0.125');
      expect(fromQuantityUnits(1000, { asString: true })).toBe('1');
    });

    it('rejects values with precision beyond 3 decimal places', () => {
      expect(() => toQuantityUnits('1.0001')).toThrow(/maximum allowed 3 decimal places/);
      expect(() => toQuantityUnits('0.1234')).toThrow(/maximum allowed 3 decimal places/);
    });

    it('rejects invalid numeric strings, NaN, and unsafe integers', () => {
      expect(() => toQuantityUnits('abc')).toThrow(/Invalid quantity format/);
      expect(() => toQuantityUnits(null)).toThrow(/cannot be null/);
      expect(() => toQuantityUnits('')).toThrow(/cannot be null/);
      expect(() => toQuantityUnits('-5')).toThrow(/Negative quantity is not permitted/);
      expect(toQuantityUnits('-5', { allowNegative: true })).toBe(-5000);
    });
  });

  describe('5.6 Weighted Average Cost (WAC) Engine', () => {
    it('sets initial WAC to purchase unit cost when verified quantity is zero', () => {
      const wac = calculateWeightedAverageCost({
        verifiedQuantity: 0,
        currentWac: null,
        purchaseQuantity: 5000, // 5 units
        purchaseUnitCost: 400000 // ₦4,000.00
      });
      expect(wac).toBe(400000);
    });

    it('calculates exact WAC when adding new purchase batch', () => {
      // 10 units @ ₦5,000 (500,000 kobo) + 10 units @ ₦7,000 (700,000 kobo)
      // New WAC = ₦6,000 (600,000 kobo)
      const wac = calculateWeightedAverageCost({
        verifiedQuantity: 10000,
        currentWac: 500000,
        purchaseQuantity: 10000,
        purchaseUnitCost: 700000
      });
      expect(wac).toBe(600000);
    });

    it('rounds WAC half-up to nearest integer kobo on non-integer division', () => {
      // 2 units @ ₦1,000 (100,000 kobo) + 1 unit @ ₦2,000 (200,000 kobo)
      // (2 * 100,000 + 1 * 200,000) / 3 = 400,000 / 3 = 133,333.333... -> 133333
      const wac1 = calculateWeightedAverageCost({
        verifiedQuantity: 2000,
        currentWac: 100000,
        purchaseQuantity: 1000,
        purchaseUnitCost: 200000
      });
      expect(wac1).toBe(133333);

      // (1 * 100,000 + 1 * 200,001) / 2 = 300,001 / 2 = 150,000.5 -> 150001 (round half up)
      const wac2 = calculateWeightedAverageCost({
        verifiedQuantity: 1000,
        currentWac: 100000,
        purchaseQuantity: 1000,
        purchaseUnitCost: 200001
      });
      expect(wac2).toBe(150001);
    });

    it('does not update WAC when purchase unit cost is unverified (null)', () => {
      const wac = calculateWeightedAverageCost({
        verifiedQuantity: 5000,
        currentWac: 400000,
        purchaseQuantity: 3000,
        purchaseUnitCost: null
      });
      expect(wac).toBe(400000); // Retains existing verified WAC
    });

    it('returns null if both existing WAC and purchase cost are unverified', () => {
      const wac = calculateWeightedAverageCost({
        verifiedQuantity: 5000,
        currentWac: null,
        purchaseQuantity: 3000,
        purchaseUnitCost: null
      });
      expect(wac).toBeNull();
    });

    it('rejects negative or malformed quantities in WAC engine', () => {
      expect(() => calculateWeightedAverageCost({
        verifiedQuantity: -100,
        currentWac: 1000,
        purchaseQuantity: 1000,
        purchaseUnitCost: 1000
      })).toThrow(/verifiedQuantity must be a non-negative safe integer/);

      expect(() => calculateWeightedAverageCost({
        verifiedQuantity: 1000,
        currentWac: 1000,
        purchaseQuantity: 0,
        purchaseUnitCost: 1000
      })).toThrow(/purchaseQuantity must be a positive safe integer/);
    });
  });

  describe('5.7 Mixed-Cost Sale Allocation Algorithm', () => {
    it('executes the exact Blueprint V2.1 worked numerical example (Section 17.3)', () => {
      // Worked Example from Blueprint V2.1:
      // - 3 unvalued opening units (3,000 units)
      // - 5 verified units (5,000 units) @ ₦4,000 (400,000 Kobo)
      // - Total Stock: 8 units (8,000 units)
      // - Current WAC: ₦4,000 (400,000 Kobo)
      // - Sale: 5 units (5,000 units) @ ₦6,000 (600,000 Kobo) per unit

      const allocation = allocateMixedCostSale({
        requestedQuantity: 5000,          // 5 units
        currentStock: 8000,               // 8 units total
        unvaluedStockRemaining: 3000,     // 3 units unvalued opening stock
        currentWac: 400000,               // ₦4,000 in Kobo
        unitSellingPrice: 600000          // ₦6,000 in Kobo
      });

      // Verification of Blueprint worked example figures:
      // Portion 1: 3 units -> unvalued_legacy. Unit Cost: null. Revenue: ₦18,000 (1,800,000 kobo)
      expect(allocation.unvaluedQuantity).toBe(3000);
      expect(allocation.costAllocations[0]).toEqual({
        portionType: 'unvalued_legacy',
        quantity: 3000,
        unitCost: null,
        totalCost: null,
        isCostSpecified: false
      });
      expect(allocation.revenueUnspecified).toBe(1800000); // ₦18,000.00

      // Portion 2: 2 units -> verified_wac. Unit Cost: ₦4,000. Line COGS: ₦8,000. Revenue: ₦12,000
      expect(allocation.verifiedQuantity).toBe(2000);
      expect(allocation.costAllocations[1]).toEqual({
        portionType: 'verified_wac',
        quantity: 2000,
        unitCost: 400000,
        totalCost: 800000, // ₦8,000.00 in Kobo
        isCostSpecified: true
      });
      expect(allocation.revenueVerified).toBe(1200000); // ₦12,000.00

      // Reporting totals:
      expect(allocation.totalRevenue).toBe(3000000);     // ₦30,000.00
      expect(allocation.verifiedCogs).toBe(800000);      // ₦8,000.00
      expect(allocation.verifiedGrossProfit).toBe(400000); // ₦4,000.00 (₦12,000 revenue - ₦8,000 COGS)
      expect(allocation.hasUnvaluedPortion).toBe(true);

      // Remaining unvalued stock is 0
      expect(allocation.newUnvaluedStockRemaining).toBe(0);
    });

    it('allocates 100% verified sale when no unvalued stock exists', () => {
      const allocation = allocateMixedCostSale({
        requestedQuantity: 2000,
        currentStock: 10000,
        unvaluedStockRemaining: 0,
        currentWac: 250000, // ₦2,500
        unitSellingPrice: 350000 // ₦3,500
      });

      expect(allocation.unvaluedQuantity).toBe(0);
      expect(allocation.verifiedQuantity).toBe(2000);
      expect(allocation.hasUnvaluedPortion).toBe(false);
      expect(allocation.costAllocations.length).toBe(1);
      expect(allocation.costAllocations[0].portionType).toBe('verified_wac');
      expect(allocation.verifiedCogs).toBe(500000); // 2 * 250,000 = 500,000 Kobo (₦5,000)
      expect(allocation.revenueVerified).toBe(700000); // 2 * 350,000 = 700,000 Kobo (₦7,000)
      expect(allocation.verifiedGrossProfit).toBe(200000); // ₦2,000
    });

    it('allocates 100% unvalued sale when entire requested quantity is covered by legacy stock', () => {
      const allocation = allocateMixedCostSale({
        requestedQuantity: 2000,
        currentStock: 5000,
        unvaluedStockRemaining: 4000,
        currentWac: 400000,
        unitSellingPrice: 500000
      });

      expect(allocation.unvaluedQuantity).toBe(2000);
      expect(allocation.verifiedQuantity).toBe(0);
      expect(allocation.hasUnvaluedPortion).toBe(true);
      expect(allocation.verifiedCogs).toBe(0);
      expect(allocation.revenueUnspecified).toBe(1000000);
      expect(allocation.revenueVerified).toBe(0);
      expect(allocation.verifiedGrossProfit).toBe(0); // 0 verified revenue - 0 COGS
      expect(allocation.newUnvaluedStockRemaining).toBe(2000);
    });

    it('rejects overselling beyond available current stock by default', () => {
      expect(() => allocateMixedCostSale({
        requestedQuantity: 10000,
        currentStock: 5000,
        unvaluedStockRemaining: 1000,
        currentWac: 100000,
        unitSellingPrice: 200000
      })).toThrow(/Insufficient stock: requested 10000 units, but only 5000 units are available/);
    });
  });

  describe('5.4 Stock Movements & Current Stock Projection Engine', () => {
    it('validates stock movements with strict directionality constraints', () => {
      const validOpening = {
        id: 'mov-001',
        businessId: 'biz-001',
        productId: 'prod-001',
        movementType: 'opening_balance',
        quantityDelta: 10000, // +10 units
        unitCost: null,
        referenceType: 'legacyOpening',
        referenceId: null,
        movementDate: '2026-09-01T00:00:00Z'
      };
      expect(validateStockMovement(validOpening)).toBe(true);

      // Opening balance must be positive
      expect(() => validateStockMovement({
        ...validOpening,
        quantityDelta: -5000
      })).toThrow(/must have a positive quantityDelta/);

      // Sale deduction must be negative
      expect(() => validateStockMovement({
        ...validOpening,
        movementType: 'sale_deduction',
        quantityDelta: 2000
      })).toThrow(/must have a negative quantityDelta/);
    });

    it('derives accurate current stock from an event stream of stock movements', () => {
      const movements = [
        {
          id: 'mov-1',
          businessId: 'biz-1',
          productId: 'p-motor-oil',
          movementType: 'opening_balance',
          quantityDelta: 3000, // +3 units
          referenceType: 'legacyOpening'
        },
        {
          id: 'mov-2',
          businessId: 'biz-1',
          productId: 'p-motor-oil',
          movementType: 'purchase_receipt',
          quantityDelta: 5000, // +5 units
          referenceType: 'inventoryPurchase',
          referenceId: 'pur-101'
        },
        {
          id: 'mov-3',
          businessId: 'biz-1',
          productId: 'p-motor-oil',
          movementType: 'sale_deduction',
          quantityDelta: -5000, // -5 units
          referenceType: 'sale',
          referenceId: 'sale-201'
        },
        {
          id: 'mov-4',
          businessId: 'biz-1',
          productId: 'p-motor-oil',
          movementType: 'adjustment_loss',
          quantityDelta: -1000, // -1 unit damaged
          referenceType: 'stockAdjustment'
        },
        {
          id: 'mov-5',
          businessId: 'biz-1',
          productId: 'p-motor-oil',
          movementType: 'adjustment_found',
          quantityDelta: 2000, // +2 units found
          referenceType: 'stockAdjustment'
        },
        {
          id: 'mov-6',
          businessId: 'biz-1',
          productId: 'p-other-item',
          movementType: 'purchase_receipt',
          quantityDelta: 10000,
          referenceType: 'inventoryPurchase'
        }
      ];

      // p-motor-oil: 3000 + 5000 - 5000 - 1000 + 2000 = 4000 (4.000 units)
      const stockMotorOil = deriveCurrentStock(movements, 'p-motor-oil');
      expect(stockMotorOil).toBe(4000);
      expect(fromQuantityUnits(stockMotorOil)).toBe(4);

      // p-other-item: 10000
      const stockOther = deriveCurrentStock(movements, 'p-other-item');
      expect(stockOther).toBe(10000);

      // Multi-product map
      const stockMap = deriveStockMap(movements);
      expect(stockMap.get('p-motor-oil')).toBe(4000);
      expect(stockMap.get('p-other-item')).toBe(10000);
    });
  });
});

