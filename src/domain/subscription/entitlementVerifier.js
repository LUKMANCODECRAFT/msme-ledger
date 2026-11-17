/**
 * Offline Entitlement Verification & Anti-Clock-Tampering Engine — SBM-042
 * Strictly adheres to SB Manager Rebuild Blueprint v2.1 Section 15.2.
 * 
 * Protects offline operations against system clock manipulation and enforces
 * entitlement lifecycles with deterministic grace periods.
 */

import jwt from 'jsonwebtoken';

/**
 * Evaluates an offline entitlement against the current local clock and last known server time.
 * 
 * @param {Object} entitlement - Stored entitlement payload
 * @param {number|Date} [entitlement.expiresAt] - Millisecond timestamp or Date
 * @param {number|Date} [entitlement.gracePeriodUntil] - Millisecond timestamp or Date
 * @param {number} localClock - Millisecond epoch of current device clock
 * @param {number} [lastKnownServerTime=0] - Millisecond epoch of last verified server response
 * @returns {{ status: 'active'|'in_grace_period'|'expired'|'clock_tampered_locked'|'unsubscribed', readOnly: boolean }}
 */
export function verifyEntitlementOffline(entitlement, localClock, lastKnownServerTime = 0) {
  const clock = typeof localClock === 'number' ? localClock : (localClock instanceof Date ? localClock.getTime() : Date.now());
  const lastServer = typeof lastKnownServerTime === 'number' ? lastKnownServerTime : 0;

  // 1. Anti-Clock-Tampering: If device clock is earlier than last recorded server time
  if (clock < lastServer) {
    return {
      status: 'clock_tampered_locked',
      readOnly: true,
      message: 'System clock tampering detected. Device clock is behind last known server time. Access restricted to read-only.'
    };
  }

  // 2. Unsubscribed / missing entitlement
  if (!entitlement || !entitlement.expiresAt) {
    return {
      status: 'unsubscribed',
      readOnly: true,
      message: 'No active entitlement found.'
    };
  }

  const expTime = typeof entitlement.expiresAt === 'number'
    ? entitlement.expiresAt
    : (entitlement.expiresAt instanceof Date ? entitlement.expiresAt.getTime() : new Date(entitlement.expiresAt).getTime());

  const graceTime = entitlement.gracePeriodUntil
    ? (typeof entitlement.gracePeriodUntil === 'number'
        ? entitlement.gracePeriodUntil
        : (entitlement.gracePeriodUntil instanceof Date ? entitlement.gracePeriodUntil.getTime() : new Date(entitlement.gracePeriodUntil).getTime()))
    : expTime;

  // 3. Expiration & Grace Period check
  if (clock > expTime) {
    if (clock <= graceTime) {
      return {
        status: 'in_grace_period',
        readOnly: false,
        message: 'Subscription has expired but is within the 7-day grace period. Full access retained.'
      };
    }
    return {
      status: 'expired',
      readOnly: true,
      message: 'Subscription and grace period have expired. Access restricted to read-only.'
    };
  }

  // 4. Fully active entitlement
  return {
    status: 'active',
    readOnly: false,
    message: 'Subscription is active.'
  };
}

/**
 * Cryptographically unpacks and validates an RS256 offline entitlement token.
 * 
 * @param {string} token
 * @param {string} publicKeyPem
 * @returns {Object}
 */
export function unpackEntitlementToken(token, publicKeyPem) {
  if (!token || typeof token !== 'string') {
    throw new TypeError('Entitlement token must be a string.');
  }
  if (!publicKeyPem || typeof publicKeyPem !== 'string') {
    throw new TypeError('publicKeyPem is required.');
  }

  const decoded = jwt.verify(token, publicKeyPem, {
    algorithms: ['RS256'],
    issuer: 'sb-manager-entitlement'
  });

  return decoded;
}
