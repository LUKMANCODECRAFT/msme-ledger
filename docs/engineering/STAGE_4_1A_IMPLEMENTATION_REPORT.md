# Stage 4.1A: Authentication Foundations Implementation Report

## 1. Executive Summary

Stage 4.1A (Authentication Foundations) of the SB Manager rebuild has been successfully implemented on the dedicated feature branch `feature/phase-4-1a-auth-foundations`.

This implementation establishes the core cryptographic, identity, token, and middleware primitives required for the subsequent Phase 4 authentication rollout, adhering strictly to `SB_Manager_Rebuild_Blueprint_v2.1.md` and `docs/engineering/PHASE_4_ARCHITECTURE_IMPLEMENTATION_PLAN.md`.

---

## 2. Implemented Components & Technical Contracts

### 2.1 Password Security (Argon2id)
- **Module:** `server/src/services/passwordService.js`
- **Specification:**
  - Algorithm: Argon2id (variant 2)
  - Memory cost ($m$): $65,536\text{ KiB}$ ($64\text{ MiB}$)
  - Time cost ($t$): $3$ iterations
  - Parallelism ($p$): $4$ threads
  - Salt: $16$ cryptographically random bytes generated via `crypto.randomBytes(16)`
  - Output Format: Standard Modular Crypt Format (`$argon2id$v=19$m=65536,t=3,p=4$...`)
- **Security Safeguards:**
  - Strict minimum password length enforcement (8 characters).
  - Timing attack mitigation via `verifyDummyPassword(candidate)`: executes an Argon2id verification against a pre-computed hash of identical cost parameters to prevent account enumeration via response-time variance when an email is not found.
  - Zero logging of plaintext passwords, salts, or raw hashes.
  - Safe error handling for malformed or corrupted hashes (returns `false` without crashing or stack trace leakage).

### 2.2 Email Identity Foundations & Database-Level Collation
- **Module:** `server/src/utils/emailNormalization.js`
- **Functions:**
  - `normalizeEmail(email)`: Trims leading and trailing whitespace, converts to lowercase, and validates RFC-compliant email structure.
  - `isValidEmail(email)`: Returns boolean validation status.
- **Database Schema Update:**
  - **Module:** `server/src/models/target/coreModels.js`
  - **Index Specification:**
    ```javascript
    userSchema.index(
      { email: 1 },
      { unique: true, collation: { locale: 'en', strength: 2 } }
    );
    ```
  - **Guarantee:** Enforces case-insensitive email uniqueness directly at the database engine level across all write paths, preventing race conditions and collision vulnerabilities.
  - **Field Preservation:** Preserves all existing fields (`id`, `passwordHash`, `fullName`, `isEmailVerified`, `createdAt`, `updatedAt`) and adds `defaultBusinessId: { type: String, default: null }`.

### 2.3 RS256 Access Token Infrastructure
- **Module:** `server/src/services/jwtService.js`
- **Specification:**
  - Algorithm: **RS256** exclusively.
  - Mandatory Header: `{ alg: 'RS256', typ: 'JWT', kid: string }`. Tokens missing `kid` are strictly rejected.
  - Mandatory Claims (Integer Unix Seconds):
    - `iss`: `'sb-manager-auth'` (exact match)
    - `aud`: `'sb-manager-client'` (exact match)
    - `sub`: User ID string
    - `iat`: Integer Unix seconds (`Math.floor(Date.now() / 1000)`)
    - `exp`: Integer Unix seconds (default lifetime: 900 seconds / 15 minutes)
    - `jti`: UUIDv4
    - `token_use`: `'access'`
    - `token_type`: `'merchant_access'`
    - `email`: Normalized email string
    - `defaultBusinessId`: Default business ID string or null
- **Security Defenses:**
  - Defence-in-depth against algorithm switching attacks: explicitly checks `header.alg === 'RS256'` before signature verification, and restricts `algorithms: ['RS256']` during verification.
  - Rejects symmetric HMAC tokens (`HS256`), unsigned tokens (`none`), expired tokens, tampered signatures, wrong issuer, wrong audience, wrong token_use, and wrong token_type.
  - Test Key Utility: `generateTestRsaKeyPair()` provides ephemeral 2048-bit RSA key pairs for test isolation, ensuring no private keys or secrets are committed.

### 2.4 Authentication Middleware Foundation
- **Module:** `server/src/middleware/authMiddleware.js`
- **Function:** `createAuthMiddleware(publicKeyResolver)`
- **Behavior:**
  - Extracts and verifies `Authorization: Bearer <token>`.
  - Rejects missing, malformed, non-Bearer, expired, or invalid tokens with HTTP 401 Unauthorized.
  - Attaches `req.user = Object.freeze({ id, email, defaultBusinessId, tokenUse, tokenType })`.
  - **Security Invariant:** Never trusts or inspects user IDs, roles, or business IDs supplied in `req.body` or `req.query`.
  - **Boundary:** Tenant authorization (SBM-041) is strictly separated and excluded from this middleware.

---

## 3. Environment Variables and Key Formats

For production and staging deployments, the following configuration applies:

| Variable | Type | Description | Example / Format |
|---|---|---|---|
| `JWT_PRIVATE_KEY` | Secret (PEM) | RSA private key (server-side only) | `-----BEGIN PRIVATE KEY-----\nMIIEvgIB...-----END PRIVATE KEY-----` |
| `JWT_PUBLIC_KEY` | Public (PEM) | RSA public key for token verification | `-----BEGIN PUBLIC KEY-----\nMIIBIjAN...-----END PUBLIC KEY-----` |
| `JWT_KEY_ID` | String | Key identifier matching JWKS header | `sb-auth-2026-v1` |
| `JWT_ACCESS_TOKEN_TTL_SECONDS` | Integer | Access token lifetime in seconds | `900` (15 minutes) |

---

## 4. Test & Build Verification

- **Regression Suite:** All 62 original baseline tests passed without modification.
- **Stage 4.1A Suite:** 34 new unit and security tests passed across password security, email normalization, database collation, RS256 token lifecycle, and authentication middleware.
- **Total Test Results:** 96 passed (9 suites, 96 tests) in 5.91s.
- **Production Build:** Vite production build completed cleanly in 1.17s.
