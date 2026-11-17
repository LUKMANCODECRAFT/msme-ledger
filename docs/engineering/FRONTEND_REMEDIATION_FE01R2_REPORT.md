# MSME Ledger — Synchronization Accounting, Target Inventory Persistence & SyncQueue Integration Report (FE-01R2)

**Date:** 17 November 2026  
**Repository:** `https://github.com/LUKMANCODECRAFT/msme-ledger`  
**Starting Baseline Commit:** `62dbf6cbc633d49c6c15a3c553e72331b121c609` (FE-01R)  
**Previous Accepted Backend Baseline:** `66749f5414f51170ca49f77da8e5d28ac7978f27`  
**Branch:** `main` (synchronized with `feature/phase-4-1a-auth-foundations`)  
**Specification References:** SB Manager Rebuild Blueprint v2.1 & FE-01R2 Task Authorization  

---

## 1. Executive Summary

The FE-01R2 remediation resolves four critical data-integrity, synchronization accounting, and cross-database persistence defects identified during independent architectural review of the FE-01R implementation:

1. **Elimination of False-Positive Synchronization Success (P1):**  
   `getAllPendingSyncCounts()` previously masked database query errors as 0 pending records via `.catch(() => 0)`, and `pushPendingData()` omitted `products` and `stockMovements` from its audit and unsupported calculations. When only unsupported records (`products`, `stockMovements`, `expenses`, `transactions`) existed, the service could incorrectly report success or zero pending count.
2. **Durable, Compensating Target Inventory Persistence (P1):**  
   The Inventory module lacked a coordinated persistence strategy between the operational catalog (`msme_ledger_db.inventory`) and the target normalized multi-tenant catalog (`sb_db.products`, `sb_db.stockMovements`, `sb_db.syncQueue`). Best-effort writes were vulnerable to partial failures and tenant identity detachment.
3. **Idempotent Stock Movements & Double-Adjustment Prevention (P1):**  
   Repeated stock adjustment submissions or retry attempts lacked idempotency keys, allowing rapid retries or network replays to generate duplicate stock movements and double-apply stock deltas to physical inventory.
4. **Target syncQueue Atomic Bookkeeping (P1):**  
   Target entity records (`products`, `stockMovements`, `expenses`) and their corresponding client mutation queue records (`syncQueue`) must commit together within atomic target-database transactions with stable idempotent operation IDs.

All defects were remediated with zero regressions. The full automated test suite comprises **18 test files, 297 tests, and 0 failures**, including 19 new comprehensive regression and failure-injection tests in `src/test/frontend_remediation_fe01r2.test.jsx`. The production build passes cleanly.

---

## 2. Root Cause Analysis & Technical Solutions

### 2.1 Accurate Synchronization Accounting & False-Positive Elimination (P1)

- **Root Causes:**
  - `src/config/db.js`: `getAllPendingSyncCounts()` appended `.catch(() => 0)` to every Dexie table query. Any genuine IndexedDB I/O fault, corrupted store, or quota error was silently swallowed and converted into a count of `0`, concealing un-synchronized local changes.
  - `src/services/syncService.js`: `pushPendingData()` queried only 5 of the 7 record groups for unsupported categorization, omitting `products` and `stockMovements`. If a merchant registered new products or performed stock adjustments, `pushPendingData()` failed to identify them as unsupported pending records and could report `status: 'success'` and `pendingCount: 0`.
- **Engineering Remediation:**
  - `src/config/db.js`: Removed `.catch(() => 0)` from table queries in `getAllPendingSyncCounts()`. Genuine database read errors now propagate directly to the caller, preventing false-positive clean states.
  - `src/services/syncService.js`: Expanded `pushPendingData()` to query and account for all 7 pending groups: `customers`, `inventory`, `sales`, `transactions`, `expenses`, `products`, and `stockMovements`.
  - Added an early check: if only unsupported records exist (`supportedPendingCount === 0 && unsupportedPending > 0`), `pushPendingData()` bypasses the server call entirely and returns `status: 'partial'`, explicitly reporting the exact pending count, itemized breakdown, and the list of unsupported groups (`unsupportedGroups`).
  - When supported records sync successfully against a 200 HTTP response, only the submitted legacy records are marked `synced`. Unsupported records remain in `'pending'` state locally, and the response reflects `status: 'partial'` with `pendingCount: unsupportedPending`.
  - Only when all 7 groups report 0 pending records does the service return `status: 'no_pending'` / `pendingCount: 0`.

### 2.2 Cross-Database Inventory Persistence & Compensating Actions (P1)

- **Root Causes:**
  - Dexie transactions cannot span two distinct database instances (`msme_ledger_db` and `sb_db`).
  - Direct UI writes in `Inventory.jsx` were split across disconnected calls. If a write succeeded in `sb_db.products` but failed in `msme_ledger_db.inventory`, or vice-versa, the local state was left permanently inconsistent without a rollback mechanism.
  - Failures in target writes were previously logged or caught without alerting the user.
- **Engineering Remediation:**
  - Created `src/services/inventoryService.js` with centralized `createProduct({ name, priceKobo, stockCount, sku, hasVerifiedCost, verifiedUnitCost, productId, operationId })`.
  - Implemented an ordered two-phase persistence and compensating rollback workflow:
    1. **Phase 1 (Target Commit):** Commits the normalized product to `sb_db.products` and its client mutation entry to `sb_db.syncQueue` within a single atomic Dexie transaction (`sb_db.transaction('rw', [sb_db.products, sb_db.syncQueue], ...)`). Enforces `businessId: getShopId()` and valid integer kobo pricing.
    2. **Phase 2 (Operational Commit):** Writes the catalog item to `msme_ledger_db.inventory`.
    3. **Compensating Action on Failure:** If Phase 2 fails, a compensating transaction executes on `sb_db` to delete the newly inserted product and syncQueue item, restoring target store clean state before throwing an `InventoryPersistenceError` (`LEGACY_PERSISTENCE_FAILED`).
  - Refactored `src/pages/Inventory.jsx` and `src/services/ledgerService.js` (`addInventory`) to delegate to `createProduct`.
  - Replaced all swallowed catches in `Inventory.jsx` with visible UI alert dialogs so failures are never hidden from the merchant.

### 2.3 Idempotent Stock Adjustments & Movement Audit Integrity (P1)

- **Root Causes:**
  - Stock adjustments in `Inventory.jsx` directly updated `msme_ledger_db.inventory.stockCount` and attempted a best-effort insert into `sb_db.stockMovements`.
  - Rapid double-clicks or offline retries lacked a stable operation identifier (`operationId`), causing duplicate `stockMovements` records and compounding stock delta updates (e.g. adding 10 units twice for 20 units total).
- **Engineering Remediation:**
  - Implemented `adjustStock({ productId, delta, movementType, reason, operationId })` in `src/services/inventoryService.js`.
  - **Idempotency Gate:** Checks `sb_db.syncQueue.get(opId)` prior to execution. If an operation record with the specified `operationId` already exists, `adjustStock` returns the existing state without reapplying the delta or inserting a duplicate movement.
  - **Target Movement & Queue Atomicity:** Commits `sb_db.stockMovements` and `sb_db.syncQueue` in a single target-database transaction. Records both `notes` and `reason` for cross-compatibility.
  - **Operational Update & Compensating Rollback:** Updates `msme_ledger_db.inventory.stockCount`. If the update fails, compensates by removing the stock movement and syncQueue entry from `sb_db`.
  - **Negative Stock Guard:** Validates that downward adjustments (`ADJUSTMENT_DAMAGE` / `REMOVE`) do not reduce physical stock below 0, rejecting with `INSUFFICIENT_STOCK`.

### 2.4 Durable Target Expense Bookkeeping & syncQueue Integration (P1)

- **Root Causes:**
  - `recordExpense` in `src/services/expenseService.js` was writing to `sb_db.expenses` without generating a corresponding `syncQueue` record.
  - Retried expense writes lacked deduplication checks, creating multiple identical expense entries.
- **Engineering Remediation:**
  - Updated `recordExpense` in `src/services/expenseService.js` to write `sb_db.expenses` and `sb_db.syncQueue` within `sb_db.transaction('rw', [sb_db.expenses, sb_db.syncQueue], ...)`.
  - Integrated idempotency check against `sb_db.syncQueue.get(opId)`. If an existing operation is found, it returns the existing expense record without inserting duplicates.
  - Exported and integrated `ExpensePersistenceError` for clear, categorized failure reporting (`INVALID_CATEGORY`, `INVALID_AMOUNT`, `MISSING_BUSINESS_ID`, `TARGET_PERSISTENCE_FAILED`).

---

## 3. Files Created and Modified

| File | Status | Description |
|---|---|---|
| `src/services/inventoryService.js` | **Created** | Durable product creation, stock adjustment, compensating rollback, and idempotency engine. |
| `src/test/frontend_remediation_fe01r2.test.jsx` | **Created** | 19 automated regression, failure-injection, and UI durability tests. |
| `src/config/db.js` | **Modified** | Removed `.catch(() => 0)` from `getAllPendingSyncCounts()`; query errors now propagate honestly. |
| `src/services/syncService.js` | **Modified** | Full 7-group pending audit in `pushPendingData()`, early partial return for unsupported records, proper group itemization. |
| `src/services/expenseService.js` | **Modified** | Added `ExpensePersistenceError`, atomic pairing with `syncQueue`, and idempotent retry lookup. |
| `src/services/ledgerService.js` | **Modified** | Refactored `addInventory` to delegate to `createProduct`. |
| `src/pages/Inventory.jsx` | **Modified** | Refactored `handleAddProduct` and `handleAdjustStock` to use `inventoryService.js`; visible alert error handling. |
| `docs/engineering/FRONTEND_REMEDIATION_FE01R2_REPORT.md` | **Created** | Comprehensive engineering remediation report. |

---

## 4. Verification & Automated Test Results

### 4.1 FE-01R2 Test Suite (`src/test/frontend_remediation_fe01r2.test.jsx`)
- **Suite Execution:** `npx vitest run src/test/frontend_remediation_fe01r2.test.jsx`
- **Result:** **19 passed, 0 failed** in 426ms.
- **Test Matrix:**
  1. `1. P1 — Accurate Sync Accounting`:
     - Accurately counts pending records for each group in isolation (customers, inventory, sales, transactions, expenses, products, stockMovements).
     - Propagates genuine database query errors instead of masking them as 0.
     - `pushPendingData` returns partial status without calling server when only products are pending.
     - `pushPendingData` returns partial status without calling server when only stockMovements are pending.
     - Marks only supported records synced on 200 response, preserving unsupported records locally.
     - Returns `no_pending` status only when all 7 record groups have 0 pending records.
  2. `2. P1 — Target Inventory Persistence & Compensating Recovery`:
     - Commits target product and syncQueue atomically alongside legacy inventory.
     - Rejects invalid inputs (empty name, non-positive price, negative stock).
     - Rolls back target records if legacy write fails.
     - Handles idempotent retries with same `operationId` cleanly without duplicates.
  3. `3. P1 — Target Stock Adjustments & Idempotent Movements`:
     - Commits stock movement, syncQueue and updates legacy stock atomically.
     - Prevents negative inventory on damage/deduct adjustments.
     - Idempotent on retry: does NOT duplicate movement or double-adjust stock count.
     - Rolls back target movement if legacy inventory update fails.
  4. `4. P1 — Durable Target Expense Bookkeeping`:
     - Commits expense and syncQueue atomically.
     - Idempotent when retried with same `operationId`.
     - Wraps database write failures in `ExpensePersistenceError`.
  5. `5. P1 — Inventory UI Error Visibility & Durability`:
     - Alerts user visibly and does not hide errors when product creation fails.
     - Alerts user visibly when stock adjustment fails.

### 4.2 Full Application Regression Suite
- **Suite Execution:** `npx vitest run`
- **Result:** **18 test files passed, 297 tests passed, 0 failed** (16.95s).
- **Suites Passed:**
  - `src/test/migration_architecture.test.js` (10 tests)
  - `src/test/frontend_remediation_fe01r2.test.jsx` (19 tests)
  - `src/test/frontend_remediation_fe01r.test.jsx` (20 tests)
  - `src/test/stage_4_1b_production_reliability.test.js` (21 tests)
  - `src/test/auth_refresh_remediation.test.js` (25 tests)
  - `src/test/auth_foundations.test.js` (61 tests)
  - `src/test/auth_refresh_lifecycle.test.js` (37 tests)
  - `src/test/stage_4_1b_concurrency_readiness.test.js` (12 tests)
  - `src/test/dexie_databases.test.js` (7 tests)
  - `src/test/stage_4_1b_ambiguous_commit.test.js` (10 tests)
  - `src/test/inventory_domain.test.js` (17 tests)
  - `src/test/frontend_redesign_fe01.test.jsx` (12 tests)
  - `src/test/stage_4_1b_final_remediation.test.js` (18 tests)
  - `src/test/debt_reconciliation.test.js` (10 tests)
  - `src/test/stock_movement_safeguard.test.js` (5 tests)
  - `src/test/smoke.test.js` (1 test)
  - `src/test/onboarding.test.jsx` (4 tests)
  - `src/test/mongoose_target_schemas.test.js` (8 tests)

### 4.3 Production Build & Whitespace Integrity
- **Build Execution:** `npm run build`
- **Build Result:** Successfully built in 2.17s. Generated `dist/`, precached 10 service worker entries via Workbox (PWA v1.3.0). Zero transform, syntax, or bundle errors.
- **Whitespace Check:** `git diff --check` passed with 0 errors.

---

## 5. Architectural Invariants Preserved

1. **Compensating Multi-Database Consistency:** Because IndexedDB transactions cannot span `msme_ledger_db` and `sb_db`, all cross-store mutations follow an ordered two-phase protocol: target commit first, operational commit second, with an explicit compensating deletion on target stores if the operational commit fails.
2. **Honest Synchronization Accounting:** Synchronization status never declares full success or 0 pending records while any record group retains `pending` records. Unsupported entity groups are preserved locally and highlighted to the merchant.
3. **Idempotent Operations:** Target mutation operations accept an optional `operationId`. The `syncQueue` is indexed by `operationId` to guarantee that duplicate submissions do not duplicate records or compound stock adjustments.
4. **Tenant Isolation:** Every target write across `products`, `stockMovements`, and `expenses` carries a validated `businessId` derived from persistent shop identity (`getShopId()`).
5. **No Swallowed Failures:** Target and operational failures are surfaced visibly via UI dialogs.

---

## 6. Out of Scope & Limitations

- **SBM-041 Multi-Tenant Backend Authorization:** Multi-tenant token claims, tenant routing middleware, and cloud tenant isolation remain strictly scoped to Stage 4.1C / SBM-041.
- **SBM-042 Subscription Billing & Paystack Integration:** Webhooks, Paystack recurring charges, and cloud subscription enforcement remain strictly scoped to SBM-042.
- **Cloud Sync Route Replacement:** The retired `/api/v1/sync` route remains retired (HTTP 410). Modern delta-based synchronization routes will be deployed in subsequent stages.
