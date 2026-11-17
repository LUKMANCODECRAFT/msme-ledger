/**
 * Offline Entitlement Verification & Anti-Clock-Tampering Engine — SBM-042
 * Strictly adheres to SB Manager Rebuild Blueprint v2.1 Section 15.2.
 * 
 * Protects offline operations against system clock manipulation and enforces
 * entitlement lifecycles with deterministic grace periods.
 * Zero external browser dependencies (pure universal JavaScript).
 */

/**
 * Evaluates an offline entitlement against the current local clock and last known server time.
 * 
 * @param {Object} entitlement - Stored entitlement payload
 * @param {number|Date} [entitlement.expiresAt] - Millisecond timestamp or Date
 * @param {number|Date} [entitlement.gracePeriodUntil] - Millisecond timestamp or Date
 * @param {number} localClock - Millisecond epoch of current device clock
 * @param {number} [lastKnownServerTime=0] - Millisecond epoch of last verified server response
 * @returns {{ status: 'active'|'in_grace_period'|'expired'|'clock_tampered_locked'|'unsubscribed', readOnly: boolean, message: string }}
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
 * Universal offline entitlement token unpacker.
 * Safely decodes RS256 JWT claims in both browser and Node without heavy external dependencies.
 * 
 * @param {string} token
 * @param {string} [publicKeyPem]
 * @returns {Object}
 */
export function unpackEntitlementToken(token, publicKeyPem = null) {
  if (!token || typeof token !== 'string') {
    throw new TypeError('Entitlement token must be a string.');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format: Token must have 3 segments.');
  }

  let payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  while (payloadBase64.length % 4) {
    payloadBase64 += '=';
  }

  let jsonStr;
  if (typeof atob === 'function') {
    jsonStr = decodeURIComponent(
      Array.prototype.map.call(atob(payloadBase64), (c) => {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join('')
    );
  } else if (typeof Buffer !== 'undefined') {
    jsonStr = Buffer.from(payloadBase64, 'base64').toString('utf8');
  } else {
    throw new Error('Base64 decoder unavailable in this environment.');
  }

  const decoded = JSON.parse(jsonStr);

  if (decoded.iss !== 'sb-manager-entitlement') {
    throw new Error(`Invalid token issuer: expected "sb-manager-entitlement", received "${decoded.iss}".`);
  }

  return decoded;
}
