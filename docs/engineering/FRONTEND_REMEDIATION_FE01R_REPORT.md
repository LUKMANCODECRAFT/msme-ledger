# MSME Ledger — Frontend and Local Data Integrity Remediation Report (FE-01R)

**Date:** 15 November 2026  
**Repository:** `https://github.com/LUKMANCODECRAFT/msme-ledger`  
**Starting Commit:** `7b261ea50c934a2bfa0b2b822b7a7294048ce23f` (FE-01)  
**Previous Accepted Backend Baseline:** `66749f5414f51170ca49f77da8e5d28ac7978f27`  
**Branch:** `main`  
**Specification Reference:** SB Manager Rebuild Blueprint v2.1 & FE-01R Task Authorization  

---

## 1. Executive Summary

The FE-01R task remediates five P1 data-integrity and financial correctness defects identified following the FE-01 frontend redesign. Prior to this remediation, synchronization errors could report false success when interacting with retired backend routes; customer repayments and debt clearing performed separate, non-atomic database writes; POS overpayments improperly counted customer change as retained business revenue while omitting payment channel persistence; target database writes were missing tenant identity (`businessId`); and the Settings UI displayed hardcoded, unapproved subscription pricing and trial active statuses.

All five P1 defects and relevant P2 reporting disclosures have been fully corrected and verified with 20 new automated unit and integration tests in `src/test/frontend_remediation_fe01r.test.jsx`. The full test suite (17 test suites, 278 tests) passes with zero failures.

---

## 2. Root Cause Analysis and Exact Remediation Implemented

### 2.1 P1 — Cloud Synchronization Status & Integrity
- **Root Cause:**
  - `src/services/syncService.js` silently caught network and server errors without re-throwing, causing UI callers (`Settings.jsx`) to declare cloud sync complete even when the backend responded with HTTP 410 or HTTP 500.
  - The legacy `/api/v1/sync` endpoint was retired in Phase 4.1B (`ENDPOINT_RETIRED_GONE`, HTTP 410).
  - `usePendingSyncCount()` in `src/config/db.js` only queried `customers`, `inventory`, and `sales`, ignoring pending repayments (`transactions`), `expenses`, `products`, and `stockMovements`.
  - The application shell displayed "Cloud Synced" even when records remained unbacked in the local queue.
- **Remediation:**
  - `src/config/db.js`: Implemented `getAllPendingSyncCounts()`, itemizing and aggregating pending records across all seven local stores in `msme_ledger_db` and `sb_db`. `usePendingSyncCount()` now reflects this global total.
  - `src/services/syncService.js`: Replaced error swallowing with explicit `SyncError` exceptions. An HTTP 410 response from `/api/v1/sync` is classified as `SYNC_UNAVAILABLE`, leaving all pending records untouched on device. When records cannot be synchronized or endpoints are unavailable, records remain in `'pending'` status. If only legacy records are synchronized, it returns `status: 'partial'`.
  - `src/components/common/AppShell.jsx`: Removed all premature "Cloud Synced" labels. When pending records exist, the UI renders `Pending Sync: {pendingCount}`; when the queue is zero, it displays `Local Storage Clean`.
  - `src/pages/Settings.jsx`: Updated manual sync feedback to distinguish `no_pending`, `partial`, `success`, `unavailable` (HTTP 410), and `failed`.

### 2.2 P1 — Repayments and Debt Adjustments Atomicity
- **Root Cause:**
  - `CreditBook.jsx` and `Customers.jsx` previously updated `customer.totalDebt` and inserted a `PAYMENT` transaction via two disconnected `await` statements outside of a Dexie transaction boundary. A failure during transaction insertion left customer debt modified without an audit record.
  - Clear Debt operations directly overwrote debt to 0 without guaranteed atomic audit event logging.
- **Remediation:**
  - `src/services/ledgerService.js`: Implemented `recordCustomerRepayment({ customerId, amountKobo, paymentMethod, notes })` and `clearCustomerDebt({ customerId, paymentMethod, notes })` inside `msme_ledger_db.transaction('rw', [msme_ledger_db.customers, msme_ledger_db.transactions], async () => { ... })`.
  - Validates positive integer kobo inputs and rejects amounts exceeding outstanding debt.
  - Guarantees that failure in either write automatically rolls back the entire transaction.
  - Invariant strictly preserved: Customer repayments never create sales records.
  - Refactored `CreditBook.jsx` and `Customers.jsx` to call these centralized atomic services.

### 2.3 P1 — POS Tender, Change & Payment Method Accounting
- **Root Cause:**
  - `recordSale` and `PointOfSale.jsx` previously stored the raw tendered amount as `amountPaid`. When a customer tendered ₦10,000 for an ₦8,000 sale, ₦10,000 was stored as `amountPaid`, artificially inflating business revenue and cash collected by ₦2,000.
  - Shortfall payments automatically added balance to customer debt without requiring explicit cashier opt-in or confirmation.
  - Selected payment channels (`cash`, `bank_transfer`, `pos`) were tracked in component state but never persisted to the `sales` store in Dexie.
- **Remediation:**
  - `src/services/ledgerService.js`: Established strict semantic separation:
    - `totalAmount`: total payable in integer kobo.
    - `amountTendered`: raw amount handed over by customer.
    - `amountApplied`: `Math.min(totalAmount, amountTendered)`. This is stored as `amountPaid` for backward compatibility, strictly capping cash collected to `totalAmount` and never counting change as revenue.
    - `changeReturned`: For cash payments, `Math.max(0, amountTendered - totalAmount)`.
    - `balance`: `totalAmount - amountApplied`.
    - `allowCredit`: Explicit boolean check. If `balance > 0` and `!allowCredit`, `recordSale` rejects the transaction before taking any money or deducting stock.
    - `paymentMethod`: Validated against `['cash', 'bank_transfer', 'pos']` and persisted in the `saleRecord`.
  - `src/pages/PointOfSale.jsx`: Added explicit "Allow credit sale" checkbox when tender is less than total payable. Updated receipt confirmation modal to display payment channel, amount tendered, amount applied, change returned, and credit balance.

### 2.4 P1 — Target Database & Tenant-Aware Local Writes
- **Root Cause:**
  - Direct writes to `sb_db.expenses` and `sb_db.products` lacked `businessId` and `categoryId`, violating the multi-tenant normalized schema in Blueprint v2.1.
  - Best-effort secondary writes in `Inventory.jsx` were wrapped in empty `catch {}` blocks that silently swallowed failures.
- **Remediation:**
  - Created `src/services/expenseService.js`: Centralized `recordExpense({ category, amountKobo, paymentMethod, notes, expenseDate })`, ensuring `businessId: getShopId()`, formatted `categoryId`, integer kobo validation, and clean error propagation.
  - `src/pages/Expenses.jsx`: Refactored to invoke `recordExpense`.
  - `src/pages/Inventory.jsx`: Enforced `businessId: getShopId()` on target writes (`sb_db.products.put` and `sb_db.stockMovements.add`). Replaced silent catches with non-swallowing logging.

### 2.5 P1 — Removal of Unapproved Subscription Claims
- **Root Cause:**
  - `Settings.jsx` previously displayed a hardcoded `1,500 NGN / month` price, a "30-Day Trial Active" badge, and a WhatsApp renewal link quoting 1,500 NGN, creating an unapproved commercial price commitment.
- **Remediation:**
  - Removed all mentions of `1,500 NGN / month` and the associated WhatsApp payment link.
  - Replaced the trial active badge with a neutral status: `Subscription Management Unconnected` / `Offline Evaluation (Billing Not Connected)`.
  - Added a clear architectural notice stating that commercial plans, pricing tiers, and online billing are pending backend integration.

### 2.6 P2 — Financial Reporting Integrity & Disclosures
- **Remediation:**
  - `src/pages/Reports.jsx`: Renamed top metric from "Net Cash Position" to "Net Operating Cash Flow (Recorded)" to clarify that it represents recorded operational transactions rather than total balance-sheet cash position.
  - Disclosed that cash collected strictly excludes returned change, and that operating cash flow excludes unrecorded transactions, opening cash balances, or owner equity.
  - `src/pages/BusinessBook.jsx`: Fixed cash inflow display for credit sales to show actual cash collected (`amountPaidKobo`) with a clear sub-badge indicating credit balance created, preventing double-counting when debt is subsequently repaid.

---

## 3. Files Created and Modified

| File | Change Type | Reason |
| :--- | :---: | :--- |
| `src/config/db.js` | Modified | Added `getAllPendingSyncCounts()` across all 7 stores; updated `usePendingSyncCount()`. |
| `src/services/syncService.js` | Modified | Honest sync handling: HTTP 410 throws `SyncError(SYNC_UNAVAILABLE)`; unsupported types stay pending. |
| `src/services/ledgerService.js` | Modified | Implemented atomic `recordCustomerRepayment`, `clearCustomerDebt`, and tender/change/credit POS rules. |
| `src/services/expenseService.js` | **New** | Centralized expense creation with `businessId` (`shopId`), `categoryId`, and integer kobo validation. |
| `src/pages/PointOfSale.jsx` | Modified | Added explicit credit opt-in toggle; tender/change calculations; persisted payment method; receipt updates. |
| `src/pages/CreditBook.jsx` | Modified | Integrated atomic `recordCustomerRepayment` and `clearCustomerDebt` services. |
| `src/pages/Customers.jsx` | Modified | Integrated atomic `recordCustomerRepayment` service. |
| `src/pages/Expenses.jsx` | Modified | Integrated `recordExpense` service with tenant identity. |
| `src/pages/Inventory.jsx` | Modified | Injected `businessId: getShopId()` on target product and stock movement writes. |
| `src/pages/Reports.jsx` | Modified | Renamed net cash metric; added cash flow boundary disclosures. |
| `src/pages/Settings.jsx` | Modified | Removed unapproved pricing; added honest sync status feedback banner; neutral subscription display. |
| `src/components/common/AppShell.jsx` | Modified | Replaced premature "Cloud Synced" badge with `Local Storage Clean` or `Pending Sync: {n}`. |
| `src/hooks/useBackgroundSync.js` | Modified | Attached rejection catch to avoid unhandled promise warnings during offline intervals. |
| `src/pages/BusinessBook.jsx` | Modified | Inflow column displays actual cash collected (`amountPaidKobo`) with credit shortfall indicators. |
| `src/test/frontend_remediation_fe01r.test.jsx` | **New** | 20 unit and regression tests covering all five P1 areas and P2 reporting invariants. |
| `docs/engineering/FRONTEND_REMEDIATION_FE01R_REPORT.md` | **New** | Comprehensive engineering report documenting remediation, test results, and boundaries. |

---

## 4. Automated Verification & Quality Assurance

### 4.1 Test Results
The test suite was executed across all 17 test files in the repository. All 278 tests passed cleanly (0 failed, 0 skipped):

```
 Test Files  17 passed (17)
      Tests  278 passed (278)
   Duration  13.76s
```

#### New FE-01R Remediation Suite Breakdown (`frontend_remediation_fe01r.test.jsx`):
1. **Sync Counts:** Accurately counts pending records across all stores (`customers`, `inventory`, `sales`, `transactions`, `expenses`, `products`, `stockMovements`).
2. **Clean State:** Returns `no_pending` status when all tables are clean.
3. **HTTP 410 Handling:** HTTP 410 throws `SYNC_UNAVAILABLE` and leaves records in `'pending'` state.
4. **Server Outage:** HTTP 500 throws `SYNC_FAILED` and preserves local records.
5. **Partial Sync:** Unsupported types (`transactions`, `expenses`) remain pending even if legacy route responds 200.
6. **Atomic Repayment:** `recordCustomerRepayment` atomically reduces debt and inserts `PAYMENT` transaction event.
7. **Rollback on Error:** Failure during transaction insertion rolls back debt reduction.
8. **Amount Validation:** Rejects negative, zero, or amounts exceeding debt without mutating database.
9. **Debt Clearing:** `clearCustomerDebt` atomically resets debt to 0 and logs auditable transaction.
10. **Repayment Invariant:** Repayments strictly produce zero new sale records.
11. **Exact Cash Tender:** Exact cash payment records `amountPaid == totalAmount` and 0 change.
12. **Change Accounting:** Cash overpayment calculates change returned and strictly excludes change from `amountPaid`.
13. **Credit Rejection:** Insufficient payment without explicit `allowCredit` opt-in is rejected.
14. **Credit Authorization:** Insufficient payment with `allowCredit: true` records shortfall to customer debt.
15. **Payment Method Persistence:** `bank_transfer` and `pos` persist and survive database readback.
16. **Tenant Identity:** `recordExpense` writes to `sb_db.expenses` with `businessId` and `categoryId`.
17. **Expense Validation:** Rejects invalid expense amounts and missing categories.
18. **Subscription Pricing Removal:** Confirms absence of hardcoded `1,500 NGN / month` price and WhatsApp renewal links.
19. **Sync Diagnostics:** Settings manual sync correctly renders cloud sync unavailable notice on HTTP 410.
20. **AppShell Status:** Correctly toggles between `Local Storage Clean` and `Pending Sync: {n}`, never displaying "Cloud Synced" when records await sync.

### 4.2 Production Build Verification
Vite v5.4.21 production build executed cleanly:
```
vite v5.4.21 building for production...
transforming...
✓ 60 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                           0.92 kB │ gzip:   0.49 kB
dist/assets/index-CKt375zc.css           33.51 kB │ gzip:   6.21 kB
dist/assets/index-DtxAzULa.js           382.17 kB │ gzip: 108.49 kB
✓ built in 1.54s
PWA v1.3.0 precache generated (10 entries, 4128.66 KiB).
```

### 4.3 Whitespace & Code Style Verification
`git diff --check` executed with code 0 (zero whitespace errors or line-ending defects).

---

## 5. Scope Boundaries, Distinctions and Remaining Limitations

### 5.1 Status Classification
- **Implemented and Verified:**
  - Atomic repayments and debt clearing with rollback verification.
  - POS tender, change calculation, cash collected capping, and payment channel persistence.
  - Multi-tenant `businessId` attachment on target writes (`expenses`, `products`, `stockMovements`).
  - Honest sync status: HTTP 410 handled as `SYNC_UNAVAILABLE`; all 7 pending stores tracked; no false success.
  - Unapproved subscription pricing and trial active claims removed from Settings.
  - Financial reporting disclosures and cash inflow accounting.
- **Implemented but Not Integration-Tested:**
  - Multi-device real-time sync (dependent on v2 sync server).
- **Blocked by Missing Backend Capability:**
  - Authenticated v2 Cloud Synchronization: Backend endpoint `/api/v2/sync` is not yet implemented (Phase 4 is currently at auth session foundations).
  - Commercial subscription billing: Backend subscription webhooks and payment gateways (Paystack/Flutterwave) are scheduled for subsequent authorized phases.
- **Not Implemented:**
  - Destructive schema migrations or legacy store deletions (strictly prohibited).
  - Client-side mock subscription authorization.

### 5.2 Explicit Operational Confirmations
1. **No production deployment occurred.**
2. **No live or cloud databases were accessed.**
3. **No existing Dexie database records or user data were deleted or overwritten.**
4. **Backend authentication foundations (Phase 4.1A / 4.1B) were strictly preserved.**

---

## 6. Final Git and Branch Synchronization

- **Starting Commit:** `7b261ea50c934a2bfa0b2b822b7a7294048ce23f`
- **Working Tree:** Clean (all changes committed directly to `main`).
- **Feature Branch:** `feature/phase-4-1a-auth-foundations` fast-forward synchronized with `main` and pushed to remote.
