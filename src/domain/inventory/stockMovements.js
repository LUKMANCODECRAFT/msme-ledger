/**
 * Stock Movements & Current Stock Projection Engine — SB Manager
 * 
 * Stock movements are the authoritative immutable event stream for inventory.
 * Current stock is a derived projection calculated by aggregating quantityDelta.
 * 
 * Conforms to Blueprint V2.1 Section 9.2, 17.1, 17.2.
 */

import { isValidScaledQuantity } from './quantity.js';

export const MOVEMENT_TYPES = Object.freeze([
  'opening_balance',
  'purchase_receipt',
  'sale_deduction',
  'sale_reversal',
  'adjustment_loss',
  'adjustment_found',
  'purchase_return'
]);

export const REFERENCE_TYPES = Object.freeze([
  'inventoryPurchase',
  'sale',
  'stockAdjustment',
  'legacyOpening'
]);

/**
 * Validates a stock movement entity.
 * 
 * @param {Object} movement
 * @returns {boolean}
 */
export function validateStockMovement(movement) {
  if (!movement || typeof movement !== 'object') {
    throw new TypeError('Stock movement must be a valid object.');
  }
  if (!movement.id || typeof movement.id !== 'string') {
    throw new TypeError('Stock movement must have a valid string UUID id.');
  }
  if (!movement.businessId || typeof movement.businessId !== 'string') {
    throw new TypeError('Stock movement must have a valid string businessId.');
  }
  if (!movement.productId || typeof movement.productId !== 'string') {
    throw new TypeError('Stock movement must have a valid string productId.');
  }
  if (!MOVEMENT_TYPES.includes(movement.movementType)) {
    throw new TypeError(`Invalid movementType: "${movement.movementType}". Must be one of: ${MOVEMENT_TYPES.join(', ')}`);
  }
  if (!isValidScaledQuantity(movement.quantityDelta, { allowNegative: true }) || movement.quantityDelta === 0) {
    throw new RangeError(`Stock movement quantityDelta must be a non-zero safe integer. Received: ${movement.quantityDelta}`);
  }

  // Directionality rules
  const expectedSigns = {
    opening_balance: 1,
    purchase_receipt: 1,
    sale_deduction: -1,
    sale_reversal: 1,
    adjustment_loss: -1,
    adjustment_found: 1,
    purchase_return: -1
  };

  const expectedSign = expectedSigns[movement.movementType];
  if (expectedSign === 1 && movement.quantityDelta < 0) {
    throw new RangeError(`Movement type "${movement.movementType}" must have a positive quantityDelta. Received: ${movement.quantityDelta}`);
  }
  if (expectedSign === -1 && movement.quantityDelta > 0) {
    throw new RangeError(`Movement type "${movement.movementType}" must have a negative quantityDelta. Received: ${movement.quantityDelta}`);
  }

  if (movement.unitCost !== null && movement.unitCost !== undefined) {
    if (!Number.isSafeInteger(movement.unitCost) || movement.unitCost < 0) {
      throw new TypeError(`unitCost must be null or a non-negative integer in Kobo. Received: ${movement.unitCost}`);
    }
  }

  if (movement.referenceType !== undefined && movement.referenceType !== null) {
    if (!REFERENCE_TYPES.includes(movement.referenceType)) {
      throw new TypeError(`Invalid referenceType: "${movement.referenceType}". Must be one of: ${REFERENCE_TYPES.join(', ')}`);
    }
  }

  return true;
}

/**
 * Derives current stock projection for a specific product from an array of stock movements.
 * Enforces strict duplicate-ID idempotence and rejects conflicting event records sharing an ID.
 * 
 * Policy:
 * 1. Identical duplicate events (same id and fields) are safely skipped (no double counting).
 * 2. Conflicting duplicate events (same id with different quantity, type, or business) throw an error.
 * 
 * @param {Array<Object>} movements - Array of stock movement records
 * @param {string} productId - Target product UUID
 * @returns {number} Current derived stock in scaled integer units
 */
export function deriveCurrentStock(movements, productId) {
  if (!Array.isArray(movements)) {
    throw new TypeError('Movements must be an array.');
  }
  if (!productId || typeof productId !== 'string') {
    throw new TypeError('productId must be a non-empty string.');
  }

  let totalStock = 0;
  const seenMovements = new Map();

  for (const mov of movements) {
    if (mov.productId === productId) {
      validateStockMovement(mov);

      if (seenMovements.has(mov.id)) {
        const existing = seenMovements.get(mov.id);
        const isIdentical = (
          existing.businessId === mov.businessId &&
          existing.productId === mov.productId &&
          existing.movementType === mov.movementType &&
          existing.quantityDelta === mov.quantityDelta &&
          (existing.unitCost ?? null) === (mov.unitCost ?? null) &&
          (existing.referenceType ?? null) === (mov.referenceType ?? null) &&
          (existing.referenceId ?? null) === (mov.referenceId ?? null)
        );

        if (!isIdentical) {
          throw new Error(
            `Conflicting duplicate stock movement event detected for ID "${mov.id}": incoming movement diverges from existing event fields.`
          );
        }
        // Identical duplicate replay: skip to prevent double counting
        continue;
      }

      seenMovements.set(mov.id, mov);
      totalStock += mov.quantityDelta;

      if (!Number.isSafeInteger(totalStock)) {
        throw new RangeError(`Derived stock calculation exceeded JavaScript safe integer limit: ${totalStock}`);
      }
    }
  }

  return totalStock;
}

/**
 * Derives current stock projections for all products across a business.
 * Enforces duplicate-ID idempotence and rejects conflicting event records.
 * 
 * @param {Array<Object>} movements
 * @returns {Map<string, number>} Map of productId -> currentStock (scaled integer units)
 */
export function deriveStockMap(movements) {
  if (!Array.isArray(movements)) {
    throw new TypeError('Movements must be an array.');
  }

  const stockMap = new Map();
  const seenMovements = new Map();

  for (const mov of movements) {
    validateStockMovement(mov);

    if (seenMovements.has(mov.id)) {
      const existing = seenMovements.get(mov.id);
      const isIdentical = (
        existing.businessId === mov.businessId &&
        existing.productId === mov.productId &&
        existing.movementType === mov.movementType &&
        existing.quantityDelta === mov.quantityDelta &&
        (existing.unitCost ?? null) === (mov.unitCost ?? null) &&
        (existing.referenceType ?? null) === (mov.referenceType ?? null) &&
        (existing.referenceId ?? null) === (mov.referenceId ?? null)
      );

      if (!isIdentical) {
        throw new Error(
          `Conflicting duplicate stock movement event detected for ID "${mov.id}": incoming movement diverges from existing event fields.`
        );
      }
      // Identical duplicate replay: skip to prevent double counting
      continue;
    }

    seenMovements.set(mov.id, mov);
    const current = stockMap.get(mov.productId) || 0;
    const nextVal = current + mov.quantityDelta;
    if (!Number.isSafeInteger(nextVal)) {
      throw new RangeError(`Derived stock calculation exceeded JavaScript safe integer limit for product ${mov.productId}`);
    }
    stockMap.set(mov.productId, nextVal);
  }

  return stockMap;
}

