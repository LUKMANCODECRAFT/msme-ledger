/**
 * Quantity Precision Utility — SB Manager
 * 
 * Standard: Scale 1,000 (three decimal places).
 * 1 unit       = 1,000 stored quantity units.
 * 1.5 kg       = 1,500 stored quantity units.
 * 0.125 litres = 125 stored quantity units.
 * 
 * All internal and database quantity representations are stored as integers.
 * Calculations avoid binary floating-point multiplication errors by parsing exact decimal strings.
 */

export const QUANTITY_SCALE = 1000;
export const MAX_DECIMAL_PLACES = 3;

/**
 * Converts a decimal number or string into scaled integer units.
 * Rejects values with more than 3 decimal places, NaN, Infinity, and unsafe integers.
 * 
 * @param {string|number} value - The human-readable quantity (e.g. "1.5", 2, "0.125")
 * @param {Object} options
 * @param {boolean} [options.allowNegative=false] - Whether negative values (e.g. deltas) are permitted
 * @returns {number} Scaled integer quantity units
 */
export function toQuantityUnits(value, { allowNegative = false } = {}) {
  if (value === null || value === undefined || value === '') {
    throw new TypeError('Quantity value cannot be null, undefined, or empty.');
  }

  const strVal = String(value).trim();

  // Validate numeric format (optional sign, integer digits, optional decimal dot with digits)
  const regex = /^[+-]?\d+(\.\d+)?$/;
  if (!regex.test(strVal)) {
    throw new TypeError(`Invalid quantity format: "${strVal}". Must be a valid decimal number string.`);
  }

  const isNegative = strVal.startsWith('-');
  if (isNegative && !allowNegative) {
    throw new RangeError(`Negative quantity is not permitted: "${strVal}".`);
  }

  // Split into integer and fractional parts without binary floating-point multiplication
  const cleanStr = strVal.replace(/^[+-]/, '');
  const [intPart, fracPart = ''] = cleanStr.split('.');

  if (fracPart.length > MAX_DECIMAL_PLACES) {
    throw new RangeError(
      `Quantity precision exceeds maximum allowed 3 decimal places: "${strVal}". Precision supported is up to 0.001 (1/1000).`
    );
  }

  // Pad fractional part to exactly 3 digits (e.g. "5" -> "500", "12" -> "120", "125" -> "125")
  const paddedFrac = fracPart.padEnd(MAX_DECIMAL_PLACES, '0');

  // Combine as integer: parseInt(intPart) * 1000 + parseInt(paddedFrac)
  const rawUnits = parseInt(intPart, 10) * QUANTITY_SCALE + parseInt(paddedFrac, 10);

  if (!Number.isSafeInteger(rawUnits)) {
    throw new RangeError(`Scaled quantity units exceed JavaScript safe integer limit: ${rawUnits}`);
  }

  return isNegative ? -rawUnits : rawUnits;
}

/**
 * Converts scaled integer units back into a decimal number or formatted string.
 * 
 * @param {number} units - Scaled integer quantity units (e.g. 1500, 125)
 * @param {Object} options
 * @param {boolean} [options.asString=false] - If true, returns normalized string representation (e.g. "1.5")
 * @returns {number|string}
 */
export function fromQuantityUnits(units, { asString = false } = {}) {
  if (!Number.isSafeInteger(units)) {
    throw new TypeError(`Quantity units must be a safe integer: received ${units}`);
  }

  const isNeg = units < 0;
  const absUnits = Math.abs(units);
  const intPart = Math.floor(absUnits / QUANTITY_SCALE);
  const remPart = absUnits % QUANTITY_SCALE;

  if (remPart === 0) {
    const resNum = isNeg ? -intPart : intPart;
    return asString ? String(resNum) : resNum;
  }

  // Format remainder padded to 3 digits and trim trailing zeros
  const fracStr = String(remPart).padStart(MAX_DECIMAL_PLACES, '0').replace(/0+$/, '');
  const sign = isNeg ? '-' : '';
  const strResult = `${sign}${intPart}.${fracStr}`;

  return asString ? strResult : parseFloat(strResult);
}

/**
 * Validates that an internal value is a valid scaled integer quantity.
 * 
 * @param {any} units
 * @param {Object} options
 * @param {boolean} [options.allowNegative=false]
 * @returns {boolean}
 */
export function isValidScaledQuantity(units, { allowNegative = false } = {}) {
  if (typeof units !== 'number' || !Number.isSafeInteger(units)) {
    return false;
  }
  if (!allowNegative && units < 0) {
    return false;
  }
  return true;
}

