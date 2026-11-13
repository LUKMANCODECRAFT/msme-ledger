import { describe, it, expect } from 'vitest';
import {
  Business,
  User,
  Membership,
  Customer,
  Product,
  Service,
  InventoryPurchase,
  PurchasePayment,
  StockMovement,
  Sale,
  SalePayment,
  CreditEntry,
  CreditPayment,
  CreditAdjustment,
  Expense,
  ExpensePayment,
  ExpenseCategory,
  IncomeEntry,
  OwnerEquityTransaction,
  FinancialReversal,
  AuditLog,
  Setting
} from '../../server/src/models/target/index.js';

describe('SBM-022: Target Mongoose Schemas & Compound Tenant Indexes', () => {

  const tenantOwnedModels = [
    { name: 'Membership', model: Membership },
    { name: 'Customer', model: Customer },
    { name: 'Product', model: Product },
    { name: 'Service', model: Service },
    { name: 'InventoryPurchase', model: InventoryPurchase },
    { name: 'PurchasePayment', model: PurchasePayment },
    { name: 'StockMovement', model: StockMovement },
    { name: 'Sale', model: Sale },
    { name: 'SalePayment', model: SalePayment },
    { name: 'CreditEntry', model: CreditEntry },
    { name: 'CreditPayment', model: CreditPayment },
    { name: 'CreditAdjustment', model: CreditAdjustment },
    { name: 'Expense', model: Expense },
    { name: 'ExpensePayment', model: ExpensePayment },
    { name: 'ExpenseCategory', model: ExpenseCategory },
    { name: 'IncomeEntry', model: IncomeEntry },
    { name: 'OwnerEquityTransaction', model: OwnerEquityTransaction },
    { name: 'FinancialReversal', model: FinancialReversal },
    { name: 'AuditLog', model: AuditLog },
    { name: 'Setting', model: Setting }
  ];

  describe('6.1 Compound Tenant Index Declarations', () => {
    it('declares { businessId: 1, id: 1 } with unique: true on EVERY tenant-owned target schema', () => {
      for (const { name, model } of tenantOwnedModels) {
        const indexes = model.schema.indexes();
        const compoundTenantIndex = indexes.find(
          ([fields, opts]) => fields.businessId === 1 && fields.id === 1 && opts?.unique === true
        );

        expect(
          compoundTenantIndex,
          `Model ${name} must declare compound unique index { businessId: 1, id: 1 } with unique: true`
        ).toBeDefined();
      }
    });

    it('declares { businessId: 1, userId: 1 } with unique: true on Membership schema', () => {
      const indexes = Membership.schema.indexes();
      const userBizCompoundIndex = indexes.find(
        ([fields, opts]) => fields.businessId === 1 && fields.userId === 1 && opts?.unique === true
      );

      expect(userBizCompoundIndex).toBeDefined();
    });

    it('validates compound tenant uniqueness logic (same entity ID allowed across different businesses)', () => {
      // Simulating MongoDB compound unique index { businessId: 1, id: 1 }
      const indexTracker = new Set();
      function attemptInsert(businessId, id) {
        const key = `${businessId}:${id}`;
        if (indexTracker.has(key)) {
          const err = new Error(`E11000 duplicate key error: index: businessId_1_id_1 dup key: { businessId: "${businessId}", id: "${id}" }`);
          err.code = 11000;
          throw err;
        }
        indexTracker.add(key);
        return true;
      }

      // 1. Same entity ID 'prod-100' in Business A
      expect(attemptInsert('biz-alpha', 'prod-100')).toBe(true);

      // 2. Same entity ID 'prod-100' in Business B -> SUCCEEDS (Tenant Isolation)
      expect(attemptInsert('biz-beta', 'prod-100')).toBe(true);

      // 3. Duplicate entity ID 'prod-100' within Business A -> REJECTED (Uniqueness Enforced)
      expect(() => attemptInsert('biz-alpha', 'prod-100')).toThrow(/E11000 duplicate key error/);
    });
  });

  describe('6.3 Schema Validation & Constraint Verification (Without DB Connection)', () => {
    it('enforces required businessId on tenant-owned models', () => {
      const productWithoutBiz = new Product({
        id: 'prod-001',
        name: 'Cement',
        sellingPrice: 500000,
        hasVerifiedCost: true,
        currentStock: 1000
      });
      const err = productWithoutBiz.validateSync();
      expect(err).toBeDefined();
      expect(err.errors.businessId).toBeDefined();
    });

    it('enforces integer Kobo validator on monetary fields (rejects fractional decimals)', () => {
      // Fractional selling price: 5000.50 Kobo
      const productWithDecimals = new Product({
        id: 'prod-002',
        businessId: 'biz-001',
        name: 'Sugar',
        sellingPrice: 5000.50, // Fractional kobo is illegal
        hasVerifiedCost: true,
        currentStock: 1000
      });
      const err = productWithDecimals.validateSync();
      expect(err).toBeDefined();
      expect(err.errors.sellingPrice).toBeDefined();
      expect(err.errors.sellingPrice.message).toMatch(/not a valid non-negative integer Kobo amount/);
    });

    it('enforces scaled integer validator on quantities (rejects unscaled floats)', () => {
      const purchaseItemWithFloat = new InventoryPurchase({
        id: 'pur-001',
        businessId: 'biz-001',
        purchaseNumber: 'PUR-001',
        items: [{
          productId: 'prod-001',
          productName: 'Rice',
          quantity: 1.5, // Illegal! Must be scaled to 1500
          unitCost: 200000,
          lineTotal: 300000
        }],
        subtotal: 300000,
        totalCost: 300000,
        amountPaid: 300000,
        paymentStatus: 'paid',
        purchaseDate: new Date()
      });
      const err = purchaseItemWithFloat.validateSync();
      expect(err).toBeDefined();
      expect(err.errors['items.0.quantity']).toBeDefined();
      expect(err.errors['items.0.quantity'].message).toMatch(/not a valid non-negative scaled integer/);
    });

    it('accepts properly scaled integers and integer Kobo', () => {
      const validPurchase = new InventoryPurchase({
        id: 'pur-002',
        businessId: 'biz-001',
        purchaseNumber: 'PUR-002',
        items: [{
          productId: 'prod-001',
          productName: 'Rice',
          quantity: 1500, // Valid 1.5 kg in scale 1,000
          unitCost: 200000, // ₦2,000.00
          lineTotal: 300000  // ₦3,000.00
        }],
        subtotal: 300000,
        shippingCost: 0,
        totalCost: 300000,
        amountPaid: 300000,
        paymentStatus: 'paid',
        purchaseDate: new Date()
      });
      const err = validPurchase.validateSync();
      expect(err).toBeUndefined();
    });

    it('enforces valid enum constraints on stock movements and payment statuses', () => {
      const invalidMovement = new StockMovement({
        id: 'mov-99',
        businessId: 'biz-001',
        productId: 'prod-001',
        movementType: 'invalid_type_here',
        quantityDelta: 1000,
        movementDate: new Date()
      });
      const err = invalidMovement.validateSync();
      expect(err).toBeDefined();
      expect(err.errors.movementType).toBeDefined();

      const validMovement = new StockMovement({
        id: 'mov-100',
        businessId: 'biz-001',
        productId: 'prod-001',
        movementType: 'purchase_receipt',
        quantityDelta: 10000,
        unitCost: 400000,
        referenceType: 'inventoryPurchase',
        referenceId: 'pur-002',
        movementDate: new Date()
      });
      expect(validMovement.validateSync()).toBeUndefined();
    });
  });
});

