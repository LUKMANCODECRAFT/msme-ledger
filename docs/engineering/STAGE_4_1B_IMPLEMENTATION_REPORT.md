# Stage 4.1B: Refresh Token Lifecycle, Rotation, Replay Detection & Session Endpoints Implementation & Security Remediation Report

## 1. Executive Summary

Stage 4.1B of the SB Manager rebuild establishes the refresh-token lifecycle, atomic rotation, authenticated replay caching, session termination endpoints, and multi-layer CSRF defenses on branch `feature/phase-4-1a-auth-foundations`.

Following independent architecture and code audits, all identified defects have been remediated:
1. **Transactionally Atomic Rotation with Supported Retry Semantics:** Token rotation operates inside a MongoDB session transaction with majority read/write concerns. It handles `TransientTransactionError` by retrying the transaction body, and `UnknownTransactionCommitResult` by retrying the commit operation within bounded policies (max 3 retries), guaranteeing that either R1 transitions from `active` to `consumed` AND R2 is inserted into the same family, or the entire operation rolls back.
2. **Production Shared Redis Replay Cache:** Replaced process-local storage with `RedisReplayCacheService` (backed by `ioredis`), supporting cluster-shared cache persistence across process restarts, 30s max TTL, AES-256-GCM encryption with 32-byte stable key, and fail-closed integrity checks.
3. **Fail-Closed Production Signing Configuration:** Removed ephemeral test key fallback from the service constructor. Production environments strictly require valid `JWT_PRIVATE_KEY` and `JWT_KEY_ID`, verified via cryptographic structure checks before accepting requests.
4. **Pre-Commit Cache Write Hook & Outage Resilience:** Session rotation writes to the shared replay cache *before* database transaction commitment; if the cache write fails, the database transaction rolls back, leaving R1 active and preventing delivery-loss deadlock.
5. **Logout Revocation Reliability:** Database revocation errors during logout are propagated rather than swallowed; the server responds with HTTP 500 while clearing browser cookies. Idempotent success (HTTP 200) is reserved for verified revocations, already-revoked families, or missing sessions.
6. **Legacy API Route Retirement:** Retired `/api/v1/sync` and `/api/v1/admin/stats` with permanent HTTP 410 Gone responses, removing legacy controller execution and sensitive metrics.
7. **Production Application Bootstrap:** Explicitly validates JWT signing keys and live Redis connectivity (via `ping()`) in `initializeProductionServices()`, injecting a real `RefreshTokenService` into `createAuthSessionRouter()` and rejecting startup if configuration is missing.

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

### 2.2 Cryptographic Entropy & Privacy Invariants
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

### 2.3 Transactionally Atomic Rotation & Supported Retry Semantics
- **Method:** `rotateTokenAtomic(...)` on `MongooseRefreshTokenStore` and `InMemoryRefreshTokenStore`
- **Supported Retry Semantics:**
  - `TransientTransactionError`: Retries the transaction body up to 3 times with fresh sessions.
  - `UnknownTransactionCommitResult`: Retries `commitTransaction()` on the same session up to 3 times before declaring an ambiguous failure.
  - Bounded retry policy ensures transient network blips do not abort valid rotations, while non-transient errors (duplicate key, validation failure, cache write failure) fail closed immediately without retry.
- **Topology Awareness:** Standalone MongoDB instances without replica-set capabilities reject transactions with `MONGODB_TOPOLOGY_UNSUPPORTED` (HTTP 500).

### 2.4 Replay Cache & Transaction Coordination Ordering Invariant
- **Ordering Contract:**
  1. $R_1$ conditional status update to `'consumed'` inside transaction.
  2. $R_2$ active successor insertion inside transaction.
  3. Pre-commit hook: encrypted replay-cache write (`replay:H(R1)` in Redis).
  4. MongoDB transaction commit.
  5. HTTP response delivery (`Set-Cookie: R2`, JSON: `accessToken`).
- **Proof of Invariant Under Failure:**
  - If step 3 (cache write) fails, the transaction is aborted. $R_1$ remains `active` in MongoDB, and $R_2$ is discarded.
  - If step 4 (commit) aborts, $R_1$ remains `active` in MongoDB, and the uncommitted Redis entry is deleted.
  - If a client later presents $R_1$, the server queries MongoDB *first*. Because $R_1$ is `active`, the server enters normal rotation (Case A) and **never** queries the replay cache. It is mathematically impossible for a request to receive an uncommitted successor from the replay cache when the transaction aborted.

### 2.5 Production Shared Redis Replay Cache Adapter
- **Module:** `server/src/services/replayCacheService.js`
- **Classes:** `RedisReplayCacheService` (production), `InMemoryReplayCacheService` (isolated tests only)
- **Specification:**
  - **Redis Client:** `ioredis` with cluster and reconnect support.
  - **Shared Storage:** Cache key `replay:<tokenHash>` shared across all service instances, surviving process restarts.
  - **Encryption:** Authenticated `AES-256-GCM` with per-record 12-byte random IV (`crypto.randomBytes(12)`) and 16-byte authentication tag (`cipher.getAuthTag()`).
  - **Key Resolution:** Stable 32-byte key from `process.env.REPLAY_CACHE_SECRET`. In production, missing or short secrets throw `ConfigurationError`.
  - **TTL Enforcement:** Absolute maximum ceiling of 30 seconds (`EX Math.min(ttlSeconds, 30)`).
  - **Integrity Validation:** Fails closed on IV tampering, ciphertext bit-flips, authentication tag mismatches, key mismatches, or token family mismatches with `ReplayCacheIntegrityError`.
  - **Readiness Verification:** `ping()` method verifies live connectivity during startup.
  - **Outage Fallback:** Redis network timeouts or connection drops fail safely without crashing, returning `null` so the caller invokes approved grace/re-auth logic.

### 2.6 Two-Tier Concurrency, Recovery & Replay Detection Contract
Conforms strictly to Section 4.3 of the Phase 4 Architecture Plan:
1. **Tier 1 ($\Delta t \le 10\text{s}$ — Concurrent Browser Tab Window):**
   - Active cache hit returns the successor payload idempotently (`isReplay: true`).
   - Cache miss returns `409 Conflict` (`CONCURRENT_REFRESH_IN_PROGRESS`, `Retry-After: 1`).
   - **Family is not revoked.**
2. **Tier 2 ($10\text{s} < \Delta t \le 30\text{s}$ — Delivery Loss Retry Window):**
   - Active cache hit returns the successor payload idempotently.
   - Cache outage / miss marks the branch as `delivery_terminated` and returns `401 Unauthorized` (`REFRESH_DELIVERY_FAILED_REAUTH_REQUIRED`).
   - Forces user login **without false-positive family revocation**.
3. **Tier 3 ($\Delta t > 30\text{s}$ — Malicious Replay Attack Window):**
   - Immediately revokes the **entire token family**: transitions all family tokens to `status = 'revoked'` with `revocationReason = 'REPLAY_DETECTED'`.
   - Evicts replay cache entry and returns `401 Unauthorized` (`TOKEN_FAMILY_COMPROMISED`).
   - Any subsequent refresh attempt for any token in the family is rejected with `401 TOKEN_FAMILY_ALREADY_REVOKED`.

### 2.7 Fail-Closed Production Signing Configuration
- **Module:** `server/src/services/jwtService.js` and `server/src/services/refreshTokenService.js`
- **Validation:** `validatePrivateKey(privateKeyPem, expectedKid)`:
  - Verifies PEM structure and validates `keyObject.asymmetricKeyType === 'rsa'`.
  - Enforces non-empty string `kid`.
  - Rejects missing private keys, missing key IDs, malformed PEMs, and non-RSA keys with structured errors before accepting requests.
- **Fail-Closed Constructor:**
  - In production (`process.env.NODE_ENV === 'production'`), missing signing keys throw `ConfigurationError('MISSING_JWT_PRIVATE_KEY')`.
  - Ephemeral test key generation is strictly prohibited in production and available only via `createTestRefreshTokenService()` in test suites.

### 2.8 Logout Reliability Contract
- **Module:** `server/src/controllers/authSessionController.js` and `server/src/services/refreshTokenService.js`
- **Specification:**
  - Browser cookie `sb_refresh_token` is cleared on every logout request.
  - Revocation is executed in the database via `revokeSessionByToken(rawToken)`.
  - If the database query fails or throws an operational error, the error is **not swallowed**; the controller logs a sanitized event (no secrets, no raw tokens) and returns `500 LOGOUT_REVOCATION_FAILED`.
  - If the token does not exist or the family is already revoked, returns `200 OK` idempotently.
  - The server never accepts arbitrary user-supplied family IDs to revoke third-party sessions.

### 2.9 Legacy API Route Retirement (HTTP 410 Gone)
- **Module:** `server/src/server.js` (`legacyRetiredRouteHandler`)
- **Endpoints Retired:**
  - `POST /api/v1/sync` → `410 Gone`
  - `GET /api/v1/admin/stats` → `410 Gone`
- **Contract:** All HTTP methods mapped to `legacyRetiredRouteHandler`, returning `{ success: false, error: 'ENDPOINT_RETIRED_GONE', message: '...', deprecatedAt: 'Phase 4' }`. Neither `processSync` nor `getSystemStats` controller is invoked.

### 2.10 Production Application Bootstrap
- **Module:** `server/src/server.js` (`initializeProductionServices`, `createApp`, `startServer`)
- **Validation Sequence:**
  1. Validates `JWT_PRIVATE_KEY` and `JWT_KEY_ID`.
  2. Validates `REDIS_URL` and `REPLAY_CACHE_SECRET`.
  3. Instantiates `RedisReplayCacheService` and executes `await replayCache.ping()`. Fails startup if Redis is unreachable.
  4. Instantiates `RefreshTokenService` with real `MongooseRefreshTokenStore` and injected cache.
  5. Injects `tokenService` into `createAuthSessionRouter({ tokenService })` and mounts on `/api/v2/auth`.
  6. Graceful shutdown handler closes HTTP listener, Redis client, and MongoDB connection.

---

## 3. Verification Evidence by Category

### A. Vitest Suite Results
- **Total Test Files:** 12 passed (12)
- **Total Tests:** 203 passed (203)
- **Test File Breakdown:**
  1. `src/test/stage_4_1b_final_remediation.test.js`: 18 passed (production bootstrap, route retirement, transaction retry)
  2. `src/test/auth_refresh_remediation.test.js`: 25 passed (atomic rotation, Redis clustering, signing fail-closed, logout reliability)
  3. `src/test/auth_refresh_lifecycle.test.js`: 37 passed (Stage 4.1B lifecycle and concurrency suite)
  4. `src/test/auth_foundations.test.js`: 61 passed (Stage 4.1A Argon2id & RS256 token suite)
  5. `src/test/mongoose_target_schemas.test.js`: 8 passed (target schema index verification)
  6. `src/test/migration_architecture.test.js`: 10 passed
  7. `src/test/debt_reconciliation.test.js`: 10 passed
  8. `src/test/inventory_domain.test.js`: 17 passed
  9. `src/test/dexie_databases.test.js`: 7 passed
  10. `src/test/onboarding.test.jsx`: 4 passed
  11. `src/test/stock_movement_safeguard.test.js`: 5 passed
  12. `src/test/smoke.test.js`: 1 passed

### B. Verification Category Matrix

| Verification Category | Execution Status | Evidence / Notes |
|---|---|---|
| **Unit Tests** | **PASSED** | 203 passing tests covering Argon2id, RS256 claims, AES-256-GCM authenticated encryption, CSRF headers, cookies, and tokens. |
| **Mocked Infrastructure Tests** | **PASSED** | Multi-instance Redis mock and transactional store adapter verify cluster sharing, transaction retry, rollback, and race conditions. |
| **Real MongoDB Replica-Set Integration** | **UNVERIFIED LOCALLY** | Standalone local daemon does not support multi-document transactions. Tested via deterministic adapter with topology check; real replica-set tests require staging environment. |
| **Real Redis Integration** | **UNVERIFIED LOCALLY** | Tested via Redis mock adapter and ioredis interface; real Redis server was not provisioned in local test runner. |
| **Vite Production Build** | **PASSED** | `vite build` completed cleanly in 1.17s with zero warnings or errors. |

---

## 4. Remaining Infrastructure Limitations

1. **MongoDB Replica Set Prerequisite:** Multi-document transactions require an active MongoDB replica set or sharded cluster topology with majority write concern. Standalone mongod instances fail closed with `MONGODB_TOPOLOGY_UNSUPPORTED`.
2. **Redis Cluster Prerequisite:** The shared replay cache requires an active Redis cluster or standalone instance with `REDIS_URL` and a stable 32-byte `REPLAY_CACHE_SECRET` configured in production.
3. **Strict Scope Preservation:** Multi-tenant RBAC (SBM-041), subscription/entitlement services (SBM-042), and registration/login endpoints (Stage 4.1C) remain strictly unstarted.
