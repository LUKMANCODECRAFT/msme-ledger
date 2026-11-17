# MSME Ledger — Frontend Data-Integrity, Concurrency & Saga Remediation Report (FE-01R3)

**Date:** 17 November 2026  
**Repository:** `https://github.com/LUKMANCODECRAFT/msme-ledger`  
**Starting Baseline Commit:** `23d303e785d2c13ed4f70d388f35901c4b47957d` (FE-01R2)  
**Previous Accepted Backend Baseline:** `66749f5414f51170ca49f77da8e5d28ac7978f27`  
**Branch:** `main` (synchronized with `feature/phase-4-1a-auth-foundations`)  
**Specification References:** SB Manager Rebuild Blueprint v2.1 & FE-01R3 Task Authorization  

---

## 1. Executive Summary

Workstream A (FE-01R3) addresses remaining frontend persistence, concurrency, precision, and data-integrity findings identified in independent architectural source reviews. Prior to this remediation:
1. Operation IDs in UI components were regenerated per call rather than preserved across retries; idempotency checks lacked tenant-scoping and payload verification.
2. Cross-database mutations between `msme_ledger_db` and `sb_db` relied on best-effort compensation without durable saga state tracking or crash recovery.
3. Concurrent stock adjustments suffered from read-modify-write race conditions that could lose updates or allow negative stock under contention.
4. Quantities used `parseInt()`, ignoring the approved scale-1,000 milli-unit precision and truncating fractional inventory units.
5. Invalid payment methods were silently coerced to `'cash'` rather than rejected.
6. Synchronization reported `success: true` on partial syncs and lacked stale-acknowledgement protection against concurrent local edits.

All defects have been remediated with zero regressions. The full automated test suite comprises **19 test files, 315 tests, and 0 failures**, including 18 new regression, concurrency, failure-injection, and precision tests in `src/test/frontend_remediation_fe01r3.test.jsx`.

---

## 2. Root Cause Analysis & Technical Solutions

### 2.1 A1: Stable Idempotency across Real UI Operations
- **Root Cause:**
  - `Inventory.jsx` and `Expenses.jsx` lacked component-level operation ID state, regenerating random IDs on retry attempts.
  - Idempotency checks only matched `operationId`, allowing an operation ID to be reused under a different tenant or with a completely different payload without rejection.
- **Remediation:**
  - Created `src/utils/hash.js` providing deterministic canonical JSON hashing (`computePayloadHash`).
  - Added `payloadHash`, `payload`, `businessId`, and `sagaState` to `sb_db.syncQueue`.
  - In `createProduct`, `adjustStock`, and `recordExpense`:
    - Validates `existingOp.businessId === tenantId`. Rejection with `IDEMPOTENCY_TENANT_MISMATCH`.
    - Validates `existingOp.payloadHash === currentPayloadHash`. Rejection with `IDEMPOTENCY_PAYLOAD_MISMATCH`.
    - Serialized concurrent submissions sharing an `operationId` using `withOperationLock`, ensuring only one creates the record and subsequent calls return the existing record.
  - In `Inventory.jsx` and `Expenses.jsx`:
    - Generated stable operation IDs stored in component state (`addOperationId`, `adjustOperationId`, `expenseOperationId`).
    - Preserved operation IDs across genuine failures so retries submit the identical key.
    - Cleared operation IDs only upon verified terminal success.

### 2.2 A2: Crash-Safe Cross-Database Inventory Consistency
- **Root Cause:**
  - Dexie transactions cannot span distinct databases (`msme_ledger_db` and `sb_db`).
  - If operational write failed and target rollback also failed, errors were swallowed or falsely reported as successful rollback.
  - No crash-recovery mechanism existed for transactions interrupted between Phase 1 and Phase 2.
- **Remediation:**
  - Implemented a two-phase saga with explicit states: `target_committed`, `operational_committed`, `compensated`, `compensation_failed`.
  - Non-Swallowed Failure: If the target rollback fails following a legacy write failure, the saga records `compensation_failed` and throws `InventoryPersistenceError('COMPENSATION_FAILED')`, passing both primary and secondary errors to the caller.
  - Reconciliation Engine: Implemented `reconcileIncompleteOperations({ businessId })`. It discovers records stranded in `target_committed` (e.g. from app crash or network interruption) and idempotently completes their operational legacy insertion and marks `operational_committed`.

### 2.3 A3: Concurrent Stock Adjustment Safety
- **Root Cause:**
  - `adjustStock` read `item.stockCount` before writing the updated count. Concurrent requests overlapping between read and write overwrote each other's updates.
- **Remediation:**
  - Implemented `withProductLock(productId, task)` providing an in-process lock queue per product.
  - Guarded the entire read-modify-write cycle inside the lock:
    1. Re-reads latest committed stock from `msme_ledger_db.inventory.get(productId)`.
    2. Evaluates negative stock guard against current committed stock.
    3. Commits target stock movement and updates legacy stock.
  - Verified with 10 concurrent contending restocks and deductions against the same item with zero lost updates.

### 2.4 A4: Quantity Precision (Scale 1,000 / Three Decimal Places)
- **Root Cause:**
  - Inventory and POS functions parsed quantities with `parseInt()`, discarding decimal quantities.
- **Remediation:**
  - Integrated `toQuantityUnits`, `fromQuantityUnits`, `QUANTITY_SCALE` (1,000) from `src/domain/inventory/quantity.js`.
  - Persists exact integer milli-units in `sb_db.products.currentStock` and `sb_db.stockMovements.quantityDelta`.
  - Supports valid fractional quantities up to 3 decimal places (e.g. `1.5`, `0.125`, `2.375`).
  - Explicitly rejects inputs with more than 3 decimal places with `INVALID_QUANTITY_PRECISION`.
  - POS calculations compute `lineTotalKobo = Math.round((price * quantityUnits) / QUANTITY_SCALE)` to prevent binary floating-point multiplication errors.

### 2.5 A5: Input & Persistence Validation
- **Remediation:**
  - In `src/services/ledgerService.js` (`recordSale`): Replaced silent coercion of invalid payment methods with explicit error throwing (`Invalid payment method ...`).
  - In `src/services/expenseService.js` (`recordExpense`): Validated payment methods against `['cash', 'bank_transfer', 'pos']`.
  - Validated verified unit cost as positive integer kobo when supplied.
  - Enforced tenant identity presence across all services.

### 2.6 A6: Synchronization Status Correctness & Stale Protection
- **Remediation:**
  - In `src/services/syncService.js`: When `status === 'partial'`, `pushPendingData()` now returns `success: false`.
  - Stale Mutation Protection: Captured timestamp snapshots for all submitted records prior to network dispatch. When applying server acknowledgements, only records whose `updatedAt <= snapshotTime` are marked `synced`. Newer local mutations remain `pending`.

---

## 3. Files Created and Modified

| File | Status | Description |
|---|---|---|
| `src/utils/hash.js` | **Created** | Deterministic canonical JSON stringification and payload hashing. |
| `src/test/frontend_remediation_fe01r3.test.jsx` | **Created** | 18 automated regression, concurrency, saga, and precision tests. |
| `src/services/inventoryService.js` | **Modified** | Idempotency locking, two-phase saga, scale-1,000 precision, reconciliation engine. |
| `src/services/expenseService.js` | **Modified** | Payload-verified idempotency, strict payment method validation. |
| `src/services/ledgerService.js` | **Modified** | Scale-1,000 POS deductions, strict payment method validation. |
| `src/services/syncService.js` | **Modified** | `success: false` on partial status, snapshot-based stale mutation protection. |
| `src/pages/Inventory.jsx` | **Modified** | Stable operation IDs across UI retries, loading disabled buttons, decimal support. |
| `src/pages/Expenses.jsx` | **Modified** | Stable operation IDs across UI retries, loading disabled buttons. |
| `src/pages/PointOfSale.jsx` | **Modified** | Decimal quantity input support in quick add inventory. |
| `docs/engineering/FRONTEND_REMEDIATION_FE01R3_REPORT.md` | **Created** | Engineering report for FE-01R3. |

---

## 4. Verification Results

- **FE-01R3 Test Suite (`src/test/frontend_remediation_fe01r3.test.jsx`):** 18 passed, 0 failed.
- **FE-01R2 Test Suite (`src/test/frontend_remediation_fe01r2.test.jsx`):** 19 passed, 0 failed.
- **FE-01R Test Suite (`src/test/frontend_remediation_fe01r.test.jsx`):** 20 passed, 0 failed.
- **Full Test Suite:** 19 test files passed, 315 tests passed, 0 failed.
- **Production Build:** `npm run build` completed with 0 errors.
- **Whitespace Check:** `git diff --check` passed with 0 errors.
