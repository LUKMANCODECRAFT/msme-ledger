import { describe, it, expect } from 'vitest';
import {
  deriveCurrentStock,
  deriveStockMap,
  validateStockMovement
} from '../domain/inventory/stockMovements.js';

describe('Phase 3: Stock Movement Safeguard & Event Deduplication', () => {

  const baseMovement = {
    id: 'mov-100',
    businessId: 'biz-01',
    productId: 'prod-motor-oil',
    movementType: 'purchase_receipt',
    quantityDelta: 5000, // +5 units
    unitCost: 400000,
    referenceType: 'inventoryPurchase',
    referenceId: 'pur-001',
    movementDate: '2026-11-01T10:00:00Z'
  };

  it('1. does not double-count identical duplicate event IDs (idempotent replay)', () => {
    // Array contains exact same movement twice
    const movements = [
      baseMovement,
      structuredClone(baseMovement) // Duplicate event
    ];

    const stock = deriveCurrentStock(movements, 'prod-motor-oil');
    // Must remain 5000 (5.000 units), NOT 10000
    expect(stock).toBe(5000);
  });

  it('2. throws an error when duplicate ID has conflicting quantityDelta', () => {
    const movements = [
      baseMovement,
      {
        ...baseMovement,
        quantityDelta: 10000 // CONFLICTING quantity!
      }
    ];

    expect(() => deriveCurrentStock(movements, 'prod-motor-oil')).toThrow(
      /Conflicting duplicate stock movement event detected for ID "mov-100"/
    );
  });

  it('3. throws an error when duplicate ID has conflicting movementType', () => {
    const movements = [
      baseMovement,
      {
        ...baseMovement,
        movementType: 'adjustment_found' // CONFLICTING movementType!
      }
    ];

    expect(() => deriveCurrentStock(movements, 'prod-motor-oil')).toThrow(
      /incoming movement diverges from existing event fields/
    );
  });

  it('4. throws an error when duplicate ID has conflicting businessId', () => {
    const movements = [
      baseMovement,
      {
        ...baseMovement,
        businessId: 'biz-DIFFERENT' // CONFLICTING businessId!
      }
    ];

    expect(() => deriveCurrentStock(movements, 'prod-motor-oil')).toThrow(
      /Conflicting duplicate stock movement event detected/
    );
  });

  it('5. preserves accurate multi-product stock map across deduplicated replays', () => {
    const movements = [
      baseMovement,
      structuredClone(baseMovement), // Dup of baseMovement
      {
        id: 'mov-200',
        businessId: 'biz-01',
        productId: 'prod-cement',
        movementType: 'opening_balance',
        quantityDelta: 10000,
        unitCost: null,
        referenceType: 'legacyOpening',
        movementDate: '2026-11-01T10:00:00Z'
      },
      {
        id: 'mov-200',
        businessId: 'biz-01',
        productId: 'prod-cement',
        movementType: 'opening_balance',
        quantityDelta: 10000,
        unitCost: null,
        referenceType: 'legacyOpening',
        movementDate: '2026-11-01T10:00:00Z'
      }
    ];

    const stockMap = deriveStockMap(movements);
    expect(stockMap.get('prod-motor-oil')).toBe(5000);
    expect(stockMap.get('prod-cement')).toBe(10000);
  });
});

