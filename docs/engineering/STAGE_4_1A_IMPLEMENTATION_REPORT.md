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
- **Database Migration Requirement & Testing Status:**
  - **Existing Databases:** In existing MongoDB databases where `{ email: 1 }` was created without collation, MongoDB prohibits in-place collation alterations and throws `IndexOptionsConflict`. Migration scripts must explicitly drop `email_1` before creating the collated index.
  - **Integration Status:** Collation configuration is verified against Mongoose schema metadata and application-level unit collision simulation. Live database-level index enforcement against MongoDB requires an active, isolated mongod instance and is explicitly documented as **not yet integration-tested** in local environments without Docker/MongoDB daemon. Production or cloud MongoDB access remains strictly prohibited.

### 2.3 RS256 Access Token Infrastructure & Key-ID Enforcement
- **Module:** `server/src/services/jwtService.js`
- **Specification:**
  - Algorithm: **RS256** exclusively.
  - Mandatory Header: `{ alg: 'RS256', typ: 'JWT', kid: string }`. Tokens missing `kid` are strictly rejected.
  - Key-ID Enforcement:
    - A token's `kid` must identify the exact public key used for verification.
    - Static public-key configurations require an explicitly configured `expectedKid` (via `options.expectedKid` or `process.env.JWT_KEY_ID`).
    - Unknown or mismatched `kid` values are strictly rejected.
    - An arbitrary `kid` is never accepted merely because a supplied public key verifies the signature.
    - Signing requires explicit `kid` configuration via `options.kid` or `process.env.JWT_KEY_ID`.
  - Mandatory Claims & Strict Validation:
    - `iss`: `'sb-manager-auth'` (exact match against configured issuer)
    - `aud`: `'sb-manager-client'` (exact match against configured audience)
    - `sub`: Non-empty user ID string
    - `iat`: Integer Unix seconds (rejected if future-issued beyond 5-second clock skew tolerance)
    - `exp`: Integer Unix seconds (strictly > `iat`; lifetime cannot exceed 900 seconds)
    - `jti`: Non-empty unique identifier string (UUIDv4)
    - `token_use`: `'access'` strictly
    - `token_type`: `'merchant_access'` strictly
    - `email`: Valid, normalized lowercase email string
    - `defaultBusinessId`: Non-empty string or `null` strictly
- **Security Defenses:**
  - Defence-in-depth against algorithm switching attacks: explicitly checks `header.alg === 'RS256'` before signature verification, and restricts `algorithms: ['RS256']` during verification.
  - Rejects symmetric HMAC tokens (`HS256`), unsigned tokens (`none`), expired tokens, tampered signatures, wrong issuer, wrong audience, wrong token_use, and wrong token_type.
  - Test Key Utility: `generateTestRsaKeyPair()` provides ephemeral 2048-bit RSA key pairs for test isolation, ensuring no private keys or secrets are committed.

### 2.4 Authentication Middleware Foundation
- **Module:** `server/src/middleware/authMiddleware.js`
- **Function:** `createAuthMiddleware(publicKeyResolver, options)`
- **Behavior:**
  - Extracts and verifies `Authorization: Bearer <token>`.
  - Rejects missing, malformed, non-Bearer, expired, or invalid tokens with HTTP 401 Unauthorized.
  - Attaches `req.user = Object.freeze({ id, email, defaultBusinessId, tokenUse, tokenType })`.
  - **Security Invariant:** Never trusts or inspects user IDs, roles, or business IDs supplied in `req.body` or `req.query`.
  - **Boundary:** Tenant authorization (SBM-041) is strictly separated and excluded from this middleware.
- **Express HTTP Integration Verification:**
  - Verified in an actual running Express application over native HTTP `fetch` across 7 integration scenarios.

---

## 3. Target Model Reconciliation

`server/src/models/target/coreModels.js` and `server/src/models/target/validators.js` carried into this feature branch have been reconciled against the approved Phase 2 and Phase 3 specifications:
- **Consistency:** All Target schemas (`Business`, `User`, `Membership`, `Customer`, `Product`, `Service`) perfectly mirror Phase 2 decisions.
- **Invariants Preserved:**
  - Compound multi-tenant indexes: `{ businessId: 1, id: 1 }` (unique), `{ businessId: 1, userId: 1 }` (unique), `{ businessId: 1, phone: 1 }`, `{ businessId: 1, name: 1 }`, `{ businessId: 1, sku: 1 }`.
  - Integer Kobo validation (`INTEGER_KOBO_VALIDATOR`, `isSafeInteger`).
  - Scaled quantity validation (`SCALED_QUANTITY_VALIDATOR`, `SIGNED_SCALED_QUANTITY_VALIDATOR`, scale 1,000).
- **Target Additions:** The Stage 4.1A additions (`defaultBusinessId` and case-insensitive email collation index `{ locale: 'en', strength: 2 }`) do not modify or remove any existing fields or tenant boundaries.

---

## 4. Environment Variables and Key Formats

For production and staging deployments, the following configuration applies:

| Variable | Type | Description | Example / Format |
|---|---|---|---|
| `JWT_PRIVATE_KEY` | Secret (PEM) | RSA private key (server-side only) | `-----BEGIN PRIVATE KEY-----\nMIIEvgIB...-----END PRIVATE KEY-----` |
| `JWT_PUBLIC_KEY` | Public (PEM) | RSA public key for token verification | `-----BEGIN PUBLIC KEY-----\nMIIBIjAN...-----END PUBLIC KEY-----` |
| `JWT_KEY_ID` | String | Key identifier matching JWKS header | `sb-auth-2026-v1` |
| `JWT_ACCESS_TOKEN_TTL_SECONDS` | Integer | Access token lifetime in seconds | `900` (15 minutes) |

---

## 5. Test & Build Verification

- **Regression Suite:** All 62 original baseline tests passed without modification.
- **Stage 4.1A Suite:** 54 unit, security, and live Express integration tests passed.
- **Total Test Results:** 116 passed (9 suites, 116 tests) in 5.72s.
- **Production Build:** Vite production build completed cleanly in 1.20s.
