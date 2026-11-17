/**
 * Deterministic Payload Hashing Utility
 * 
 * Provides consistent hashing of JSON-serializable payloads for
 * idempotency verification across application and network boundaries.
 */

/**
 * Deterministically stringifies an object by sorting its keys recursively.
 * 
 * @param {any} obj
 * @returns {string}
 */
export function canonicalJsonStringify(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalJsonStringify).join(',')}]`;
  }

  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map(key => `${JSON.stringify(key)}:${canonicalJsonStringify(obj[key])}`);
  return `{${entries.join(',')}}`;
}

/**
 * Computes a SHA-256 hex digest of a canonical payload string.
 * Falls back to deterministic FNV-1a 64-bit hash in environments without Web Crypto.
 * 
 * @param {any} payload
 * @returns {Promise<string>} Hex-encoded hash
 */
export async function computePayloadHash(payload) {
  const canonicalStr = canonicalJsonStringify(payload);

  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    try {
      const msgBuffer = new TextEncoder().encode(canonicalStr);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fallback below
    }
  }

  // Pure JS fallback (deterministic 64-bit hex hash)
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < canonicalStr.length; i++) {
    const ch = canonicalStr.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(16, '0');
}
