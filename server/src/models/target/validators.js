/**
 * Target Mongoose Schema Common Validators — SB Manager
 * 
 * Enforces integer Kobo, scaled integer quantities (scale 1,000),
 * and domain constraints across MongoDB collections.
 */

/**
 * Validates that a monetary value is an integer in Kobo (no decimals).
 * Permits null if field is optional/nullable.
 */
export function isIntegerKobo(val) {
  if (val === null || val === undefined) return true;
  return typeof val === 'number' && Number.isSafeInteger(val);
}

/**
 * Validates that a monetary value is a non-negative integer in Kobo.
 */
export function isNonNegativeIntegerKobo(val) {
  if (val === null || val === undefined) return true;
  return typeof val === 'number' && Number.isSafeInteger(val) && val >= 0;
}

/**
 * Validates that a quantity is stored as a scaled integer (scale 1,000).
 * Rejects floating-point decimals.
 */
export function isScaledQuantity(val) {
  if (val === null || val === undefined) return true;
  return typeof val === 'number' && Number.isSafeInteger(val);
}

/**
 * Validates that a quantity is a non-negative scaled integer.
 */
export function isNonNegativeScaledQuantity(val) {
  if (val === null || val === undefined) return true;
  return typeof val === 'number' && Number.isSafeInteger(val) && val >= 0;
}

export const INTEGER_KOBO_VALIDATOR = {
  validator: isNonNegativeIntegerKobo,
  message: props => `Value ${props.value} is not a valid non-negative integer Kobo amount.`
};

export const SCALED_QUANTITY_VALIDATOR = {
  validator: isNonNegativeScaledQuantity,
  message: props => `Quantity ${props.value} is not a valid non-negative scaled integer (scale 1,000).`
};

export const SIGNED_SCALED_QUANTITY_VALIDATOR = {
  validator: isScaledQuantity,
  message: props => `Quantity delta ${props.value} must be a safe integer (scale 1,000).`
};

