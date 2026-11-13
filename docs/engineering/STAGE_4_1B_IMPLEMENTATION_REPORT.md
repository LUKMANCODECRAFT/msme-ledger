# Stage 4.1B: Refresh Token Lifecycle, Rotation, Replay Detection & Session Endpoints Implementation Report

## 1. Executive Summary

Stage 4.1B (Refresh Token Lifecycle, Rotation, Replay Detection and Session Endpoints) of the SB Manager rebuild has been successfully implemented on feature branch `feature/phase-4-1a-auth-foundations`.

This implementation delivers the end-to-end token session infrastructure required for secure merchant authentication, session continuation, atomic token rotation, delivery loss recovery, token-family replay mitigation, secure cookie handling, and multi-layer CSRF defense, strictly conforming to `SB_Manager_Rebuild_Blueprint_v2.1.md` Section 14 and `docs/engineering/PHASE_4_ARCHITECTURE_IMPLEMENTATION_PLAN.md` Sections 4.3 and 9.3.

---

## 2. Implemented Components & Technical Contracts

### 2.1 Refresh Token Persistence Model & Target Schema
- **Module:** `server/src/models/target/refreshTokenModel.js` (re-exported via `authModels.js` and `server/src/models/target/index.js`)
- **Model Name:** `TargetRefreshToken` (exported as `RefreshToken`)
- **Schema Fields:**
  - `id`: `{ type: String, required: true, unique: true }` (RFC 4122 UUIDv4)
  - `userId`: `{ type: String, required: true, index: true }`
  - `tokenHash`: `{ type: String, required: true, unique: true }` (SHA-256 hex digest)
  - `familyId`: `{ type: String, required: true, index: true }` (UUIDv4)
  - `status`: `{ type: String, enum: ['active', 'consumed', 'revoked', 'delivery_terminated'], default: 'active', index: true }`
  - `replacedByHash`: `{ type: String, default: null }` (SHA-256 hex digest of successor token)
  - `replacedByTokenHash`: `{ type: String, default: null }` (alias for backward/forward compatibility)
  - `consumedAt`: `{ type: Date, default: null }`
  - `revokedAt`: `{ type: Date, default: null }`
  - `revocationReason`: `{ type: String, default: null }`
  - `reuseDetectedAt`: `{ type: Date, default: null }`
  - `expiresAt`: `{ type: Date, required: true, index: { expires: 0 } }` (MongoDB TTL index)
  - `userAgent`: `{ type: String, default: null }`
  - `ipAddress`: `{ type: String, default: null }`
  - `createdAt`, `updatedAt`: Automatic timestamps
- **Declared Indexes:**
  - Unique index: `{ tokenHash: 1 }`
  - Compound indexes: `{ familyId: 1, status: 1 }`, `{ userId: 1, status: 1 }`
  - TTL purge index: `{ expiresAt: 1 }` with `{ expires: 0 }` (or `expireAfterSeconds: 0`)
- **Security Invariants:**
  - Plaintext refresh tokens are **never** persisted in the database, logged, or returned in response bodies.
  - The database persists only the one-way `SHA-256(rawToken)` hex digest (`tokenHash`).

### 2.2 Cryptographic Entropy & Hashing
- **Module:** `server/src/services/refreshTokenService.js`
- **Functions:**
  - `generateRefreshToken()`:
    - Generates 32 cryptographically random bytes via `crypto.randomBytes(32)`.
    - Formats token as URL/cookie-safe `base64url` string (43 characters, 256 bits entropy).
    - Computes `tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')`.
    - Returns `{ rawToken, tokenHash }`.
  - `hashRefreshToken(rawToken)`:
    - Validates non-empty string input.
    - Returns deterministic 64-character SHA-256 hex digest.
    - Rejects missing, empty, or non-string inputs with structured `INVALID_REFRESH_TOKEN` (401).
- **Session Duration:** 30 days (`2,592,000` seconds / `30 * 24 * 60 * 60 * 1000` ms).

### 2.3 Authenticated Ephemeral Replay Cache (AES-256-GCM)
- **Module:** `server/src/services/replayCacheService.js`
- **Class:** `ReplayCacheService`
- **Specification:**
  - **Algorithm:** Authenticated `AES-256-GCM` (Galois/Counter Mode).
  - **Key Derivation:** Resolves a 32-byte (256-bit) secret from `process.env.REPLAY_CACHE_SECRET` or constructor options, utilizing SHA-256 hashing if a string passphrase is provided. Generates ephemeral 32-byte secret in memory when unconfigured.
  - **Per-Record IV:** Generates a unique 12-byte cryptographically secure random IV (`crypto.randomBytes(12)`) for every encryption.
  - **Authentication Tag:** Extracts and verifies 16-byte (128-bit) GCM authentication tag (`cipher.getAuthTag()`).
  - **Tamper Detection:** Decryption validates ciphertext and authentication tag via `decipher.final()`. Any bit modification or tag mismatch fails closed and throws `ReplayCacheIntegrityError`.
  - **Storage & TTL:** Caches encrypted successor payload (`{ accessToken, refreshToken, expiresIn, tokenType }`) keyed by consumed `tokenHash` for up to 30 seconds.
  - **Outage Simulation:** Provides `setSimulateOutage(boolean)` for deterministic testing of cache degradation and offline resilience.

### 2.4 Two-Tier Concurrency, Recovery & Replay Detection Contract
- **Module:** `server/src/services/refreshTokenService.js`
- **Rotation Logic:**
  1. Computes `tokenHash = hashRefreshToken(rawToken)`.
  2. Queries persistence store for `currentToken`.
  3. Rejects unknown tokens with `401 INVALID_REFRESH_TOKEN`.
  4. Rejects expired tokens (`expiresAt <= now`) with `401 REFRESH_TOKEN_EXPIRED`.
  5. Rejects terminated tokens (`status === 'delivery_terminated'`) with `401 REFRESH_DELIVERY_FAILED_REAUTH_REQUIRED`.
  6. Rejects tokens belonging to a revoked family with `401 TOKEN_FAMILY_ALREADY_REVOKED`.
  7. **When `status === 'active'` (Normal Rotation):**
     - Generates successor token `R2`.
     - Executes atomic conditional update: transitions `R1` from `active` to `consumed`, records `consumedAt = now`, and sets `replacedByHash = SHA256(R2)`.
     - If conditional write does not match (another concurrent request won the race), re-reads state and enters consumed evaluation.
     - Inserts successor token `R2` with same `familyId`, `status: 'active'`, and 30-day lifetime.
     - Issues a fresh RS256 access token signed with user's verified claims (`sub`, `email`, `defaultBusinessId`) and 900-second TTL.
     - Encrypts and caches response in Replay Cache for 30 seconds.
     - Returns `{ accessToken, refreshToken: R2, tokenType: 'Bearer', expiresIn: 900 }`.
  8. **When `status === 'consumed'` (Replay / Concurrency Evaluation):**
     - Calculates elapsed duration: $\Delta t = \text{now} - \text{currentToken.consumedAt}$.
     - **Tier 1 & Tier 2 ($\Delta t \le 30,000\text{ ms}$ — Concurrent Grace & Network Retry Window):**
       - Queries Replay Cache for `tokenHash`.
       - If cache hit: decrypts and idempotently returns the cached successor package (`isReplay: true`). Token family is **not revoked**.
       - If cache miss or outage:
         - **Tier 1 ($\Delta t \le 10,000\text{ ms}$ — Concurrent Tab Window):** Returns `409 Conflict` (`CONCURRENT_REFRESH_IN_PROGRESS`, `Retry-After: 1`). Token family is **not revoked**.
         - **Tier 2 ($10,000\text{ ms} < \Delta t \le 30,000\text{ ms}$ — Network Loss Window):** Marks branch `status: 'delivery_terminated'` and returns `401 Unauthorized` (`REFRESH_DELIVERY_FAILED_REAUTH_REQUIRED`). Requires merchant login without falsely revoking the entire token family.
     - **Tier 3 ($\Delta t > 30,000\text{ ms}$ — Suspicious Replay Attack):**
       - Confirmed replay attack.
       - Immediately revokes the **entire token family**: marks all tokens with `familyId` as `status: 'revoked'`, `revokedAt = now`, `reuseDetectedAt = now`, `revocationReason = 'REPLAY_DETECTED'`.
       - Evicts cached replay entry.
       - Returns `401 Unauthorized` (`TOKEN_FAMILY_COMPROMISED`).
       - Any subsequent refresh attempt presenting any token from this family (including active successor `R2`) is rejected with `401 TOKEN_FAMILY_ALREADY_REVOKED`.

### 2.5 Multi-Layer CSRF Defense Middleware
- **Module:** `server/src/middleware/csrfProtection.js`
- **Function:** `createCsrfProtectionMiddleware(options)`
- **Four Layers of Defense:**
  1. **Safe Method Exemption:** Safe HTTP read methods (`GET`, `HEAD`, `OPTIONS`) bypass CSRF checks.
  2. **Fetch Metadata Policy:** Inspects `Sec-Fetch-Site`. If present and equals `'cross-site'`, immediately rejects with `403 Forbidden` (`CSRF_CROSS_SITE`).
  3. **Strict Origin Validation:** Compares `Origin` (or parsed `Referer`) against configured allowlist (`ALLOWED_ORIGINS` / `CORS_ALLOWED_ORIGINS` / `CLIENT_URL`). Missing or untrusted origins on state-changing requests are rejected with `403 Forbidden` (`CSRF_INVALID_ORIGIN`).
  4. **Custom Request Header Validation:** Mandates presence of custom application header (`X-Requested-With`, `X-SB-Client`, or `X-CSRF-Token`). Since browsers prevent cross-origin scripts from setting custom headers without CORS preflight approval, state-changing forgery is blocked with `403 Forbidden` (`CSRF_MISSING_HEADER`).

### 2.6 Session Endpoints & Secure Cookie Management
- **Modules:**
  - `server/src/controllers/authSessionController.js`
  - `server/src/routes/authSessionRoutes.js`
  - Mounted in `server/src/server.js` at `/api/v2/auth` with `cookie-parser`.
- **Cookie Security Attributes:**
  - Name: `sb_refresh_token`
  - `httpOnly: true` (prevents malicious JavaScript access via XSS)
  - `secure: true` in production (`process.env.NODE_ENV === 'production'`)
  - `sameSite: 'strict'` (blocks transmission on cross-site requests)
  - `path: '/api/v2/auth'` (scopes cookie exclusively to session endpoints)
  - `maxAge: 30 * 24 * 60 * 60 * 1000` (30 days)
- **Endpoints:**
  - **`POST /api/v2/auth/refresh`:**
    - Protected by CSRF middleware.
    - Extracts `sb_refresh_token` from cookies (with header fallback).
    - If cookie is missing: returns `401 MISSING_REFRESH_TOKEN`.
    - On valid rotation: sets updated cookie `sb_refresh_token` and returns `200 OK` with `{ success: true, data: { accessToken, tokenType: 'Bearer', expiresIn: 900 } }`.
    - On 409 concurrency: sends `Retry-After: 1` header without clearing cookie.
    - On 401 failures: clears `sb_refresh_token` cookie and returns structured error.
  - **`POST /api/v2/auth/logout`:**
    - Protected by CSRF middleware.
    - Extracts `sb_refresh_token` cookie if present.
    - Revokes token family in store.
    - Always clears `sb_refresh_token` cookie.
    - Idempotently returns `200 OK` with `{ success: true, message: 'Logged out successfully.' }`.

---

## 3. Automated Test Verification & Coverage Evidence

The comprehensive test suite at `src/test/auth_refresh_lifecycle.test.js` covers 37 targeted test scenarios:

1. **Persistence Model & Target Schema (5 tests):**
   - Target `RefreshToken` schema definitions, fields, types, and defaults.
   - Status enum validation (`active`, `consumed`, `revoked`, `delivery_terminated`).
   - Compound index on `{ familyId: 1, status: 1 }` and `{ userId: 1, status: 1 }`.
   - Unique index declaration on `tokenHash`.
   - TTL index declaration on `expiresAt` with `expires: 0`.

2. **Cryptographic Entropy & Hashing (4 tests):**
   - 32 cryptographically random bytes encoded in base64url (43 chars, 256 bits).
   - Distinct entropy across 50 repeated generations.
   - Deterministic SHA-256 hex hashing (64 chars).
   - Input validation rejecting empty, null, and non-string inputs.

3. **Replay Cache AES-256-GCM (5 tests):**
   - Round-trip authenticated encryption/decryption.
   - Fails closed on ciphertext bit-tampering (`ReplayCacheIntegrityError`).
   - Fails closed on auth tag modification (`ReplayCacheIntegrityError`).
   - Automatic TTL expiration.
   - Graceful fallback on simulated cache service outage.

4. **Lifecycle & Atomic Rotation (5 tests):**
   - Initial session generation with 30-day lifetime and valid RS256 token.
   - Atomic rotation: `R1` marked consumed, `R2` active in same family.
   - Access token signature and claims verification.
   - Rejection of expired refresh tokens with 401 `REFRESH_TOKEN_EXPIRED`.
   - Rejection of unknown tokens with 401 `INVALID_REFRESH_TOKEN`.
   - Verification that plaintext tokens are **never** persisted in store or token documents.

5. **Two-Tier Concurrency & Replay Detection (5 tests):**
   - Concurrent race prevention: simultaneous requests cannot fork competing branches.
   - Tier 1/2 ($\le 30$s): Idempotent cached successor replay without family revocation.
   - Tier 1 ($\le 10$s): 409 `CONCURRENT_REFRESH_IN_PROGRESS` on cache miss without family revocation.
   - Tier 2 (10–30s): 401 `REFRESH_DELIVERY_FAILED_REAUTH_REQUIRED` branch termination on cache outage without family revocation.
   - Tier 3 ($> 30$s): Immediate family revocation on replay attack, rejecting subsequent attempts with `TOKEN_FAMILY_ALREADY_REVOKED`.

6. **CSRF Protection Middleware (6 tests):**
   - Exemption of safe methods (`GET`, `HEAD`, `OPTIONS`).
   - Rejection of `Sec-Fetch-Site: cross-site` with 403 `CSRF_CROSS_SITE`.
   - Rejection of missing Origin/Referer with 403 `CSRF_INVALID_ORIGIN`.
   - Rejection of unauthorized Origin with 403 `CSRF_INVALID_ORIGIN`.
   - Rejection of missing custom header with 403 `CSRF_MISSING_HEADER`.
   - Acceptance of valid Origin with custom header.

7. **Session Endpoints Integration (7 tests):**
   - Cookie parsing from `req.cookies` and raw `cookie` header.
   - 401 `MISSING_REFRESH_TOKEN` on absent cookie.
   - Successful rotation with `Set-Cookie` headers and JSON access token.
   - Cookie attributes verification (`HttpOnly`, `SameSite=Strict`, `Path=/api/v2/auth`, 30-day maxAge).
   - Cookie cleared on 401 authentication failure.
   - Full family revocation and cookie clearing on `POST /logout`.
   - Idempotent logout when called without cookie.
   - End-to-end Express router pipeline verification.

### Test Execution Summary
- **Total Test Files:** 10 passed (10)
- **Total Tests:** 160 passed (160)
  - Baseline/Phase 1–3 Tests: 62 passed
  - Stage 4.1A Foundations Tests: 61 passed
  - Stage 4.1B Refresh Token Lifecycle Tests: 37 passed
- **Production Build:** Vite production build succeeds cleanly in ~1.2s.
- **Database Safety:** Zero connections made to live cloud or production databases.

---

## 4. Scope Compliance & Verification Boundary

| Milestone / Requirement | Status | Verification Reference |
|---|---|---|
| Refresh Token Persistence Model | **COMPLETED** | `server/src/models/target/refreshTokenModel.js` |
| 32-Byte Cryptographic Generation | **COMPLETED** | `generateRefreshToken` (256-bit entropy) |
| SHA-256 Token Hash Persistence | **COMPLETED** | Zero plaintext storage verified |
| 30-Day Token Lifetime | **COMPLETED** | `expiresAt` TTL index declared & tested |
| Family ID & Status Tracking | **COMPLETED** | `active`, `consumed`, `revoked`, `delivery_terminated` |
| Atomic Rotation Implementation | **COMPLETED** | Conditional write + atomic successor creation |
| 10s Concurrent Grace Window | **COMPLETED** | Tier 1: 409 Conflict, family preserved |
| 10–30s Replay Cache (AES-256-GCM) | **COMPLETED** | Tier 2: Authenticated cache + tamper checks |
| >30s Replay Detection & Revocation | **COMPLETED** | Tier 3: Immediate token-family revocation |
| Secure Cookie Attributes | **COMPLETED** | `HttpOnly`, `Secure`, `SameSite=Strict`, `/api/v2/auth` |
| Multi-Layer CSRF Protection | **COMPLETED** | Origin allowlist, Sec-Fetch-Site, custom header |
| Session Endpoints | **COMPLETED** | `POST /api/v2/auth/refresh`, `POST /api/v2/auth/logout` |
| SBM-041 Multi-Tenant RBAC | **DEFERRED** | Out of scope for Stage 4.1B |
| SBM-042 Subscription Services | **DEFERRED** | Out of scope for Stage 4.1B |
| Cloud / Production DB Access | **STRICTLY EXCLUDED** | Fully isolated; zero network database calls |
