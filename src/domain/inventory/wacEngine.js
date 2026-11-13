/**
 * Weighted Average Cost (WAC) Engine — SB Manager
 * 
 * Computes updated Weighted Average Cost (WAC) per 1.000 units in integer Kobo
 * upon receiving verified inventory purchases.
 * 
 * Blueprint V2.1 Formula:
 *   newWac = roundHalfUp(
 *     (verifiedQuantity * currentWac + purchaseQuantity * purchaseUnitCost)
 *     / (verifiedQuantity + purchaseQuantity)
 *   )
 * 
 * Rounding: Half-up to nearest integer Kobo.
 * All monetary amounts are integer Kobo.
 * All quantities are scaled integer units (scale 1,000).
 */

import { isValidScaledQuantity } from './quantity.js';

/**
 * Calculates updated Weighted Average Cost in integer Kobo.
 * 
 * @param {Object} params
 * @param {number} params.verifiedQuantity - Pre-purchase verified quantity in scaled units (>= 0)
 * @param {number|null} params.currentWac - Current WAC in integer Kobo, or null if no verified cost exists
 * @param {number} params.purchaseQuantity - Incoming purchase quantity in scaled units (> 0)
 * @param {number|null} params.purchaseUnitCost - Incoming purchase cost per unit in integer Kobo, or null if unverified
 * @returns {number|null} Updated WAC in integer Kobo, or null if cost remains unverified
 */
export function calculateWeightedAverageCost({
  verifiedQuantity,
  currentWac,
  purchaseQuantity,
  purchaseUnitCost
}) {
  // 1. Validate purchase quantity
  if (!isValidScaledQuantity(purchaseQuantity) || purchaseQuantity <= 0) {
    throw new RangeError(`purchaseQuantity must be a positive safe integer in scaled units. Received: ${purchaseQuantity}`);
  }

  // 2. Validate verified quantity
  if (!isValidScaledQuantity(verifiedQuantity) || verifiedQuantity < 0) {
    throw new RangeError(`verifiedQuantity must be a non-negative safe integer in scaled units. Received: ${verifiedQuantity}`);
  }

  // 3. If purchase cost is unverified (null), WAC cannot be updated
  if (purchaseUnitCost === null || purchaseUnitCost === undefined) {
    // Preserve existing verified WAC if one existed; otherwise remains null
    return currentWac !== undefined ? currentWac : null;
  }

  // 4. Validate monetary costs
  if (!Number.isSafeInteger(purchaseUnitCost) || purchaseUnitCost < 0) {
    throw new TypeError(`purchaseUnitCost must be a non-negative safe integer in Kobo. Received: ${purchaseUnitCost}`);
  }

  if (currentWac !== null && currentWac !== undefined) {
    if (!Number.isSafeInteger(currentWac) || currentWac < 0) {
      throw new TypeError(`currentWac must be null or a non-negative safe integer in Kobo. Received: ${currentWac}`);
    }
  }

  // 5. If no prior verified stock or no prior verified WAC exists:
  // The purchase unit cost becomes the initial verified WAC
  if (verifiedQuantity === 0 || currentWac === null || currentWac === undefined) {
    return purchaseUnitCost;
  }

  // 6. Execute weighted average calculation
  // Total cost = (Q_verified * WAC_current) + (Q_purchase * Cost_purchase)
  // Both Q are in scale 1,000, so the 1,000 factor cancels out in numerator and denominator:
  // (Q_v * C_v + Q_p * C_p) / (Q_v + Q_p)
  const numerator = (verifiedQuantity * currentWac) + (purchaseQuantity * purchaseUnitCost);
  const denominator = verifiedQuantity + purchaseQuantity;

  if (denominator === 0) {
    throw new Error('Division by zero: total verified quantity cannot be zero.');
  }

  // Round half-up to nearest integer Kobo
  const newWac = Math.round(numerator / denominator);

  if (!Number.isSafeInteger(newWac)) {
    throw new RangeError(`Calculated WAC exceeds safe integer bounds: ${newWac}`);
  }

  return newWac;
}

