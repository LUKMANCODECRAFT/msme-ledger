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
  - If step 4 (commit) aborts, the MongoDB transaction rolls back and $R_1$ remains `active` in MongoDB ($R_2$ is not committed). When a client retries with $R_1$, the server queries MongoDB *first*; because $R_1$ is `active`, it enters normal rotation (Case A) and **never** consults the replay cache. The uncommitted cache entry is overwritten upon the next successful rotation or purged when its 30-second TTL expires. Furthermore, a non-destructive targeted rollback hook `deleteCachedResponseIfMatches(tokenHash, nextTokenHash)` purges the entry only if it still matches the uncommitted successor, guaranteeing that a failed concurrent rotation never deletes a sibling rotation's valid committed successor. It is impossible for an uncommitted successor to be returned to a client.

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

### 2.11 Production Dependency-Injection Bypass Prevention
- **Module:** `server/src/server.js` (`initializeProductionServices`)
- **Enforcement Rules:**
  - In production (`NODE_ENV === 'production'`), requires `options.replayCache instanceof RedisReplayCacheService`. In-memory or arbitrary cache adapters are rejected with `INVALID_PRODUCTION_REPLAY_CACHE`.
  - Injected Redis cache instances still undergo live readiness verification via `await replayCache.ping()`.
  - In production, requires `options.store instanceof MongooseRefreshTokenStore`. Non-persistent or in-memory stores are rejected with `INVALID_PRODUCTION_TOKEN_STORE`.
  - Non-production environments (`dev`, `test`) maintain flexible dependency injection for isolated testing.

### 2.12 Secret & Credential Redaction in Errors and Logs
- **Module:** `server/src/services/replayCacheService.js` and `server/src/server.js`
- **Helpers:** `redactSensitiveUrl(url)` and `sanitizeErrorMessage(message)`
- **Guarantees:**
  - Redis connection URLs containing credentials (e.g. `redis://user:pass@host:port`) are redacted to `redis://***:***@host:port`.
  - MongoDB connection URLs containing credentials (e.g. `mongodb://user:pass@host:port/db`) are redacted to `mongodb://***:***@host:port/db`.
  - Sensitive query params (`password`, `secret`, `token`, `key`) are sanitized to `key=***`.
  - Startup readiness errors (`REDIS_READINESS_FAILED`, `MONGO_CONNECTION_FAILED`) sanitize error details before throwing or logging.

### 2.13 Explicit Production MongoDB Configuration
- **Module:** `server/src/server.js` (`startServer`)
- **Enforcement:**
  - Production startup strictly requires an explicit `MONGO_URI`. Missing, empty, or whitespace-only configuration throws `ConfigurationError('MISSING_MONGO_URI')` before accepting HTTP traffic.
  - Silent fallback to `mongodb://127.0.0.1:27017/msme_ledger` is strictly restricted to non-production environments.

### 2.14 MongoDB Session Lifecycle & Guaranteed Cleanup
- **Module:** `server/src/services/refreshTokenService.js` (`MongooseRefreshTokenStore.rotateTokenAtomic`)
- **Guarantees:**
  - Every successfully created MongoDB session is registered with `cleanupSession()` and ended via `await session.endSession()` exactly once in `finally`.
  - If `session.startTransaction()` throws, `cleanupSession()` executes without calling `abortTransaction()` on an unstarted transaction.
  - Double cleanups across transient retry iterations are prevented via idempotent session tracking flags.
  - Cleanup errors do not mask original transaction or application errors.

### 2.15 Distributed Per-Token Rotation Locking
- **Module:** `server/src/services/replayCacheService.js` and `server/src/services/refreshTokenService.js`
- **Specification:**
  - Acquires a distributed lock scoped to `lock:rotation:${tokenHash}` using atomic `SET key value NX PX <ttlMs>` before entering MongoDB transactions or writing pre-commit cache entries.
  - Cryptographically random owner UUID (`crypto.randomUUID()`) prevents cross-request lock manipulation.
  - Safe release via Lua script ensures a request releases only its own lock.
  - Concurrent requests presenting the same active $R_1$ immediately receive `409 Conflict` (`CONCURRENT_REFRESH_IN_PROGRESS`) without consuming the token or revoking the family.
  - If Redis is unavailable, fails safely with `503 Service Unavailable` without consuming $R_1$.
  - **Lease Duration & Absence of Automatic Renewal:** The rotation lock is acquired with a fixed 5,000ms lease without background heartbeat renewal. Because rotation completes in < 50ms under normal conditions, the 5,000ms window provides ample headroom. If an operation stalls beyond 5,000ms, the lease expires safely; the MongoDB conditional update (`status: 'active'`) serves as the definitive atomic concurrency guard to ensure only one transaction commits. While `renewRotationLock()` is implemented and verified on the replay cache service as a general utility, `rotateRefreshToken()` intentionally relies on the fixed 5-second lease and the authoritative MongoDB conditional status check.

### 2.16 Atomic Replay Cache Compare-and-Delete (Lua Script)
- **Module:** `server/src/services/replayCacheService.js` (`deleteCachedResponseIfMatches`)
- **Mechanism:**
  - Evaluates an atomic Redis Lua script comparing the stored envelope's `successorHash` against the caller's expected successor hash.
  - Eliminates read-then-delete race conditions, guaranteeing that an aborted transaction's cleanup never removes a concurrent request's valid committed successor.

### 2.17 Strict Redis Readiness Validation & Pre-Redis Mongo Verification
- **Module:** `server/src/server.js` (`initializeProductionServices`, `startServer`)
- **Guarantees:**
  - Production `MONGO_URI` is verified before constructing or connecting to Redis, preventing orphaned connections if MongoDB configuration is missing.
  - `replayCache.ping()` strictly requires a valid `'PONG'` response; `false`, `null`, unexpected values, or timeouts throw sanitized `REDIS_READINESS_FAILED`.
  - Failures during startup (Mongo connection, HTTP listen) trigger complete cleanup of opened Redis, MongoDB, and server handles.

### 2.18 Ambiguous MongoDB Commit Recovery Invariant (`UnknownTransactionCommitResult`)
- **Module:** `server/src/services/refreshTokenService.js` (`MongooseRefreshTokenStore`, `InMemoryRefreshTokenStore`, `RefreshTokenService`, `authSessionController`)
- **Specification:**
  - In MongoDB transactions, an exhausted `UnknownTransactionCommitResult` indicates network disconnection during commit acknowledgment. It must **never** be treated as a confirmed rollback.
  - If all 3 commit retries are exhausted, the outcome is classified as ambiguous.
  - `session.abortTransaction()` is **not** called (cannot reverse an unknown/committed transaction).
  - `onRollbackHook` is **not** called, preserving the encrypted successor $R_2$ response in the replay cache.
  - The MongoDB session is ended safely, and a structured `RefreshTokenError` is thrown with code `MONGODB_COMMIT_OUTCOME_UNKNOWN` and HTTP 503 status.
  - The HTTP refresh controller responds with HTTP 503 and preserves the refresh-token cookie (does not clear it).
  - **Recovery Invariants:**
    - **Scenario A (Commit actually succeeded in DB):** $R_1$ is consumed and $R_2$ exists. When the client retries with $R_1$, the server queries DB, observes $R_1$ is `consumed`, queries the replay cache, and returns the intact $R_2$ with `isReplay: true`.
    - **Scenario B (Commit did not succeed in DB):** $R_1$ remains `active` and $R_2$ does not exist. When the client retries with $R_1$, the server queries DB, observes $R_1$ is `active`, enters normal rotation (Case A, ignoring cache), and overwrites the stale cache entry with the new rotation's successor.
  - Confirmed failures (before commit) continue to abort transactions and execute `onRollbackHook` for targeted cache cleanup.

---

## 3. Verification Evidence by Category

### A. Vitest Suite Results
- **Total Test Files:** 15 passed (15)
- **Total Tests:** 246 passed (246)
- **Test File Breakdown:**
  1. `src/test/stage_4_1b_ambiguous_commit.test.js`: 10 passed (exhausted UnknownTransactionCommitResult isolation, Mongoose adapter boundaries, Scenario A recovery, Scenario B cache overwrite, confirmed abort cleanup, transient retries, HTTP 503 cookie preservation)
  2. `src/test/stage_4_1b_concurrency_readiness.test.js`: 12 passed (distributed locking, Lua atomic delete, strict ping, pre-Redis Mongo validation, resource cleanup)
  3. `src/test/stage_4_1b_production_reliability.test.js`: 21 passed (DI enforcement, secret redaction, MongoDB URI requirement, session lifecycle, replay abort isolation)
  4. `src/test/stage_4_1b_final_remediation.test.js`: 18 passed (production bootstrap, route retirement, transaction retry)
  5. `src/test/auth_refresh_remediation.test.js`: 25 passed (atomic rotation, Redis clustering, signing fail-closed, logout reliability)
  6. `src/test/auth_refresh_lifecycle.test.js`: 37 passed (Stage 4.1B lifecycle and concurrency suite)
  7. `src/test/auth_foundations.test.js`: 61 passed (Stage 4.1A Argon2id & RS256 token suite)
  8. `src/test/mongoose_target_schemas.test.js`: 8 passed (target schema index verification)
  9. `src/test/migration_architecture.test.js`: 10 passed
  10. `src/test/debt_reconciliation.test.js`: 10 passed
  11. `src/test/inventory_domain.test.js`: 17 passed
  12. `src/test/dexie_databases.test.js`: 7 passed
  13. `src/test/onboarding.test.jsx`: 4 passed
  14. `src/test/stock_movement_safeguard.test.js`: 5 passed
  15. `src/test/smoke.test.js`: 1 passed

### B. Verification Category Matrix

| Verification Category | Execution Status | Evidence / Notes |
|---|---|---|
| **Unit Tests** | **PASSED** | 246 passing tests covering ambiguous commit outcome recovery, distributed locking, Lua atomic delete, Argon2id, RS256 claims, AES-256-GCM authenticated encryption, CSRF headers, cookies, DI guards, redaction, and session cleanup. |
| **Mocked Infrastructure Tests** | **PASSED** | Multi-instance Redis mock and transactional store adapter verify cluster sharing, transaction retry, rollback, and race conditions. |
| **Real MongoDB Replica-Set Integration** | **UNVERIFIED LOCALLY** | Standalone local daemon does not support multi-document transactions. Tested via deterministic adapter with topology check; real replica-set tests require staging environment. |
| **Real Redis Integration** | **UNVERIFIED LOCALLY** | Tested via Redis mock adapter and ioredis interface; real Redis server was not provisioned in local test runner. |
| **Vite Production Build** | **PASSED** | `vite build` completed cleanly in 1.17s with zero warnings or errors. |

---

## 4. Remaining Infrastructure Limitations

1. **MongoDB Replica Set Prerequisite:** Multi-document transactions require an active MongoDB replica set or sharded cluster topology with majority write concern. Standalone mongod instances fail closed with `MONGODB_TOPOLOGY_UNSUPPORTED`.
2. **Redis Cluster Prerequisite:** The shared replay cache requires an active Redis cluster or standalone instance with `REDIS_URL` and a stable 32-byte `REPLAY_CACHE_SECRET` configured in production.
3. **Strict Scope Preservation:** Multi-tenant RBAC (SBM-041), subscription/entitlement services (SBM-042), and registration/login endpoints (Stage 4.1C) remain strictly unstarted.
