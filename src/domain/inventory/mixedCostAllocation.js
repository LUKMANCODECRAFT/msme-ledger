/**
 * Mixed-Cost Inventory Sale Allocation Engine — SB Manager
 * 
 * Implements Blueprint V2.1 Section 17.2 & 17.3 algorithm for allocating sale line items
 * that consume both unvalued legacy opening stock and verified purchased batches.
 * 
 * Rules:
 * 1. FIFO Depletion: Unvalued legacy opening stock is depleted first.
 * 2. Remainder is allocated to verified WAC stock.
 * 3. Unknown unit cost and total cost remain strictly null for unvalued portions.
 * 4. Verified COGS is calculated solely for verified portions.
 * 5. Segregates verified gross profit from revenue with unspecified costs.
 * 
 * Note on Discounts:
 * In accordance with Blueprint V2.1, proportional discount-allocation across
 * mixed-cost portions is an unresolved architectural policy. Discounts are NOT
 * silently or arbitrarily apportioned here.
 */

import { isValidScaledQuantity, QUANTITY_SCALE } from './quantity.js';

/**
 * Allocates a sale quantity across unvalued legacy opening stock and verified WAC stock.
 * 
 * @param {Object} params
 * @param {number} params.requestedQuantity - Requested quantity in scaled units (> 0)
 * @param {number} params.currentStock - Total current stock in scaled units
 * @param {number} params.unvaluedStockRemaining - Remaining unvalued legacy opening stock in scaled units (>= 0)
 * @param {number|null} params.currentWac - Current verified WAC in integer Kobo, or null
 * @param {number} params.unitSellingPrice - Selling price per 1.000 units in integer Kobo (>= 0)
 * @param {Object} [options]
 * @param {boolean} [options.allowNegativeStock=false] - Whether selling past available stock is allowed
 * @returns {Object} Allocation result matching Blueprint V2.1 contract
 */
export function allocateMixedCostSale({
  requestedQuantity,
  currentStock,
  unvaluedStockRemaining = 0,
  currentWac = null,
  unitSellingPrice,
  options = {}
}) {
  const { allowNegativeStock = false } = options;

  // 1. Validations
  if (!isValidScaledQuantity(requestedQuantity) || requestedQuantity <= 0) {
    throw new RangeError(`requestedQuantity must be a positive safe integer in scaled units. Received: ${requestedQuantity}`);
  }
  if (!isValidScaledQuantity(currentStock, { allowNegative: true })) {
    throw new TypeError(`currentStock must be a safe integer in scaled units. Received: ${currentStock}`);
  }
  if (!isValidScaledQuantity(unvaluedStockRemaining) || unvaluedStockRemaining < 0) {
    throw new RangeError(`unvaluedStockRemaining must be a non-negative safe integer in scaled units. Received: ${unvaluedStockRemaining}`);
  }
  if (!Number.isSafeInteger(unitSellingPrice) || unitSellingPrice < 0) {
    throw new TypeError(`unitSellingPrice must be a non-negative safe integer in Kobo. Received: ${unitSellingPrice}`);
  }
  if (currentWac !== null && (!Number.isSafeInteger(currentWac) || currentWac < 0)) {
    throw new TypeError(`currentWac must be null or a non-negative safe integer in Kobo. Received: ${currentWac}`);
  }

  // 2. Prevent unpermitted overselling
  if (!allowNegativeStock && requestedQuantity > currentStock) {
    throw new RangeError(
      `Insufficient stock: requested ${requestedQuantity} units, but only ${currentStock} units are available in inventory.`
    );
  }

  // 3. FIFO Depletion: Consume unvalued legacy opening stock first
  const unvaluedQty = Math.min(requestedQuantity, Math.max(0, unvaluedStockRemaining));
  const verifiedQty = requestedQuantity - unvaluedQty;

  const costAllocations = [];
  let lineCogs = 0;

  // 4. Portion 1: Unvalued legacy allocation
  if (unvaluedQty > 0) {
    costAllocations.push({
      portionType: 'unvalued_legacy',
      quantity: unvaluedQty,
      unitCost: null,
      totalCost: null,
      isCostSpecified: false
    });
  }

  // 5. Portion 2: Verified WAC allocation
  if (verifiedQty > 0) {
    if (currentWac !== null) {
      // lineCogs = (verifiedQty * currentWac) / 1000
      lineCogs = Math.round((verifiedQty * currentWac) / QUANTITY_SCALE);
      costAllocations.push({
        portionType: 'verified_wac',
        quantity: verifiedQty,
        unitCost: currentWac,
        totalCost: lineCogs,
        isCostSpecified: true
      });
    } else {
      // Verified portion exists but has unverified WAC
      costAllocations.push({
        portionType: 'verified_wac',
        quantity: verifiedQty,
        unitCost: null,
        totalCost: null,
        isCostSpecified: false
      });
    }
  }

  // 6. Revenue and Profit Projections
  // Revenue = (Quantity * unitSellingPrice) / 1000
  const revenueUnspecified = Math.round((unvaluedQty * unitSellingPrice) / QUANTITY_SCALE);
  const revenueVerified = Math.round((verifiedQty * unitSellingPrice) / QUANTITY_SCALE);
  const totalRevenue = revenueUnspecified + revenueVerified;
  const verifiedGrossProfit = revenueVerified - lineCogs;

  const newUnvaluedStockRemaining = Math.max(0, unvaluedStockRemaining - unvaluedQty);

  return {
    totalQuantity: requestedQuantity,
    unvaluedQuantity: unvaluedQty,
    verifiedQuantity: verifiedQty,
    costAllocations,
    verifiedCogs: lineCogs,
    hasUnvaluedPortion: unvaluedQty > 0,
    revenueUnspecified,
    revenueVerified,
    totalRevenue,
    verifiedGrossProfit,
    newUnvaluedStockRemaining
  };
}

