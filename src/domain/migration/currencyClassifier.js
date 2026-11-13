/**
 * Legacy Currency Classifier — SB Manager
 * 
 * Enforces the non-negotiable Product Owner & Architectural directive:
 * "NEVER assume every integer greater than or equal to 50 represents Kobo."
 * 
 * Classifies legacy monetary amounts into:
 * 1. VERIFIED_KOBO: Confirmed integer Kobo value supported by transaction evidence or schema contract.
 * 2. VERIFIED_NAIRA: Confirmed whole Naira value with unambiguous evidence, normalized to Kobo (x100).
 * 3. AMBIGUOUS_QUARANTINE: Ambiguous, malformed, fractional, or unverified magnitude requiring quarantine.
 */

export const CURRENCY_CLASSIFICATION = Object.freeze({
  VERIFIED_KOBO: 'VERIFIED_KOBO',
  VERIFIED_NAIRA: 'VERIFIED_NAIRA',
  AMBIGUOUS_QUARANTINE: 'AMBIGUOUS_QUARANTINE',
  ZERO_BALANCE: 'ZERO_BALANCE'
});

/**
 * Classifies a legacy monetary value based on structural and contextual evidence.
 * 
 * @param {any} rawValue - The raw numeric value from the legacy record
 * @param {Object} [context]
 * @param {'KOBO'|'NAIRA'|'AUTO'} [context.expectedUnit='AUTO'] - Explicit unit hint if supported by schema
 * @param {boolean} [context.hasLinkedEvidence=false] - Whether linked transactions corroborate the currency unit
 * @param {string} [context.fieldName='amount'] - Name of field being analyzed
 * @returns {Object} Classification result
 */
export function classifyCurrency(rawValue, context = {}) {
  const {
    expectedUnit = 'AUTO',
    hasLinkedEvidence = false,
    fieldName = 'amount'
  } = context;

  // 1. Unset / Null / Undefined
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return {
      status: CURRENCY_CLASSIFICATION.AMBIGUOUS_QUARANTINE,
      koboAmount: null,
      rawValue,
      reason: `MISSING_${fieldName.toUpperCase()}`
    };
  }

  // 2. Reject non-numeric types
  const numVal = Number(rawValue);
  if (typeof rawValue === 'boolean' || isNaN(numVal)) {
    return {
      status: CURRENCY_CLASSIFICATION.AMBIGUOUS_QUARANTINE,
      koboAmount: null,
      rawValue,
      reason: `MALFORMED_NON_NUMERIC_${fieldName.toUpperCase()}`
    };
  }

  // 3. Reject fractional / floating-point values
  if (!Number.isInteger(numVal)) {
    return {
      status: CURRENCY_CLASSIFICATION.AMBIGUOUS_QUARANTINE,
      koboAmount: null,
      rawValue,
      reason: `FRACTIONAL_DECIMAL_NOT_PERMITTED`
    };
  }

  // 4. Reject unsafe integers
  if (!Number.isSafeInteger(numVal)) {
    return {
      status: CURRENCY_CLASSIFICATION.AMBIGUOUS_QUARANTINE,
      koboAmount: null,
      rawValue,
      reason: `UNSAFE_INTEGER_MAGNITUDE`
    };
  }

  // 5. Zero balance is unambiguous
  if (numVal === 0) {
    return {
      status: CURRENCY_CLASSIFICATION.ZERO_BALANCE,
      koboAmount: 0,
      rawValue: 0
    };
  }

  // 6. Reject negative amounts for standard balances
  if (numVal < 0) {
    return {
      status: CURRENCY_CLASSIFICATION.AMBIGUOUS_QUARANTINE,
      koboAmount: null,
      rawValue,
      reason: `NEGATIVE_${fieldName.toUpperCase()}_PROHIBITED`
    };
  }

  // 7. Explicit Unit Verification
  if (expectedUnit === 'KOBO') {
    return {
      status: CURRENCY_CLASSIFICATION.VERIFIED_KOBO,
      koboAmount: numVal,
      rawValue
    };
  }

  if (expectedUnit === 'NAIRA') {
    const koboVal = numVal * 100;
    if (!Number.isSafeInteger(koboVal)) {
      return {
        status: CURRENCY_CLASSIFICATION.AMBIGUOUS_QUARANTINE,
        koboAmount: null,
        rawValue,
        reason: `NAIRA_CONVERSION_EXCEEDS_SAFE_INTEGER`
      };
    }
    return {
      status: CURRENCY_CLASSIFICATION.VERIFIED_NAIRA,
      koboAmount: koboVal,
      rawValue
    };
  }

  // 8. AUTO Classification — NEVER assume integer >= 50 represents Kobo!
  // If linked transaction evidence exists, verify unit
  if (hasLinkedEvidence) {
    return {
      status: CURRENCY_CLASSIFICATION.VERIFIED_KOBO,
      koboAmount: numVal,
      rawValue
    };
  }

  // Without corroborating evidence or explicit unit verification,
  // arbitrary raw numbers cannot be silently assumed as Naira or Kobo.
  return {
    status: CURRENCY_CLASSIFICATION.AMBIGUOUS_QUARANTINE,
    koboAmount: null,
    rawValue,
    reason: `AMBIGUOUS_CURRENCY_MAGNITUDE_NO_EVIDENCE`
  };
}

