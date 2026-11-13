# Phase 2 Implementation Report: Domain Modeling & Single Source of Truth
## Tickets: SBM-020, SBM-021, and SBM-022

> **Document Status:** Authoritative Engineering Delivery Report  
> **Phase:** Phase 2 (Domain Modeling & Single Source of Truth)  
> **Tickets Completed:**  
> - **SBM-020:** Dual-Database Dexie Declaration (`sb_manager_db_v1`)  
> - **SBM-021:** Inventory Purchase & Stock Movement Domain Models  
> - **SBM-022:** Mongoose Schemas & Compound Tenant Indexes  
> **Approved Specification:** SB Manager Rebuild Blueprint V2.1  
> **Execution Mode:** Controlled Implementation (No live migration, zero production data altered, zero commits/pushes)  
> **Delivery Date:** 2026-11-13  
> **Overall Phase Verdict:** **COMPLETE & FULLY VERIFIED**

---

## 1. Baseline & Repository Identity

- **Repository Root:** `C:/Users/HomePC/LCC/msme-ledger-main/msme-ledger-main`
- **Active Branch:** `main` (tracking `origin/main`)
- **HEAD Commit:** `9395cf5d037cd6a80b8a3ac64bbc33aa52534c04` (*"feat: add partial payment logic and transactions table"*)
- **Remote Configuration:**
  ```text
  origin  https://github.com/LUKMANCODECRAFT/msme-ledger (fetch)
  origin  https://github.com/LUKMANCODECRAFT/msme-ledger (push)
  ```

---

## 2. Pre-Implementation Backup Verification

Prior to any modifications, a complete pre-Phase-2 backup was created outside the Git repository:
- **Backup Path:** `C:\Users\HomePC\LCC\msme-ledger-main\backups\msme-ledger-main-pre-phase2`
- **Integrity Check:** Verified that all source files, configurations, and Phase 1 test suites exist and are readable in the backup location.

---

## 3. Actual Files Created and Modified

### 3.1 Modified Tracked Source Files
- **`src/config/db.js`**: Declared `legacy_db` (frozen `msme_ledger_db` v2) and `sb_db` (`sb_manager_db_v1` v1 with 24 normalized stores); exported `getReadOnlyLegacyDb()` Proxy wrapper and `createSbDatabase()` test factory. Preserved `msme_ledger_db` and `usePendingSyncCount` exports for 100% backward compatibility.
- **`vitest.config.js`**: Added resolve alias for `mongoose` mapped to `server/node_modules/mongoose` to enable testing of target Mongoose models within the Vitest test environment without adding packages to root `package.json`.

### 3.2 New Domain & Model Files Created
- **`src/domain/inventory/quantity.js`**: Scale 1,000 quantity precision utility (`toQuantityUnits`, `fromQuantityUnits`, `isValidScaledQuantity`).
- **`src/domain/inventory/wacEngine.js`**: Weighted Average Cost calculation engine with half-up integer Kobo rounding.
- **`src/domain/inventory/mixedCostAllocation.js`**: Pure domain function for mixed-cost sale allocation (FIFO depletion of unvalued legacy opening stock + verified WAC allocation).
- **`src/domain/inventory/stockMovements.js`**: Stock movement validation and current stock projection engine (`deriveCurrentStock`, `deriveStockMap`).
- **`src/domain/inventory/index.js`**: Barrel export for inventory domain module.
- **`server/src/models/target/validators.js`**: Reusable Mongoose validators for integer Kobo and scaled integer quantities.
- **`server/src/models/target/coreModels.js`**: Target Mongoose schemas for `Business`, `User`, `Membership`, `Customer`, `Product`, `Service`.
- **`server/src/models/target/inventoryModels.js`**: Target Mongoose schemas for `InventoryPurchase`, `PurchasePayment`, `StockMovement`.
- **`server/src/models/target/salesCreditModels.js`**: Target Mongoose schemas for `Sale`, `SalePayment`, `CreditEntry`, `CreditPayment`, `CreditAdjustment`.
- **`server/src/models/target/expenseFinancialModels.js`**: Target Mongoose schemas for `ExpenseCategory`, `Expense`, `ExpensePayment`, `IncomeEntry`, `OwnerEquityTransaction`, `FinancialReversal`, `AuditLog`, `Setting`.
- **`server/src/models/target/index.js`**: Barrel export for all target Mongoose models.

### 3.3 New Test Files Created
- **`src/test/dexie_databases.test.js`**: SBM-020 test suite (6 tests covering store existence, indexes, isolation, read-only wrapper).
- **`src/test/inventory_domain.test.js`**: SBM-021 test suite (17 tests covering quantity scaling, WAC formulas, mixed-cost allocation, Blueprint Section 17.3 worked example, stock movements).
- **`src/test/mongoose_target_schemas.test.js`**: SBM-022 test suite (8 tests covering compound multi-tenant indexes, required fields, integer/quantity validators, enums, tenant isolation).

### 3.4 New Documentation Files Created
- **`docs/engineering/PHASE_2_SCHEMA_CONSISTENCY.md`**: Complete cross-database schema consistency matrix and analysis.
- **`docs/engineering/PHASE_2_IMPLEMENTATION_REPORT.md`**: This report.

---

## 4. SBM-020 Implementation Details: Dual-Database Dexie Declaration

### 4.1 Frozen Legacy Database (`legacy_db` / `msme_ledger_db`)
- The legacy database is declared at its exact version 2 schema (`customers`, `inventory`, `sales`, `transactions`).
- No version increment, schema mutation, or table deletion was introduced.
- Backward compatibility is 100% preserved: all existing components (`Debtors.jsx`, `PointOfSale.jsx`, `SalesHistory.jsx`, `ledgerService.js`, `syncService.js`) continue to import `msme_ledger_db` without breakage.
- **Read-Only Enforcement Wrapper (`getReadOnlyLegacyDb`):** A Proxy wrapper was implemented that intercepts all mutating calls (`add`, `put`, `update`, `delete`, `bulkAdd`, `bulkPut`, `bulkDelete`, `clear`, `modify`, as well as write transactions `mode === 'rw'`) and throws an explicit error: `"Write operation '...' is prohibited on legacy_db. The legacy database is frozen."`

### 4.2 Destination Normalized Database (`sb_db` / `sb_manager_db_v1`)
- Created `sb_db = new Dexie('sb_manager_db_v1')` at version 1.
- Declared all **24 normalized stores** specified in Blueprint V2.1 Section 10.1:
  `businesses`, `users`, `memberships`, `customers`, `products`, `services`, `inventoryPurchases`, `purchasePayments`, `stockMovements`, `sales`, `salePayments`, `creditEntries`, `creditPayments`, `creditAdjustments`, `expenses`, `expensePayments`, `expenseCategories`, `incomeEntries`, `ownerEquityTransactions`, `financialReversals`, `auditLogs`, `settings`, `syncQueue`, `migrationCheckpoints`.
- Declared primary keys and secondary query indexes exactly as specified in the blueprint.

---

## 5. SBM-021 Implementation Details: Inventory Purchase & Stock Movement Domain

### 5.1 Authoritative Stock Movement Event Stream
- Implemented `stockMovements` as the single authoritative source of truth for inventory.
- Implemented `deriveCurrentStock(movements, productId)` and `deriveStockMap(movements)`: `currentStock` is strictly a derived projection calculated by aggregating `quantityDelta` across movements.
- Validated movement types: `opening_balance`, `purchase_receipt`, `sale_deduction`, `sale_reversal`, `adjustment_loss`, `adjustment_found`, `purchase_return`.
- Validated reference types: `inventoryPurchase`, `sale`, `stockAdjustment`, `legacyOpening`.
- Enforced strict movement directionality (e.g. `opening_balance` and `purchase_receipt` must have positive delta; `sale_deduction` must have negative delta).

### 5.2 Inventory Purchase & Purchase Payments
- Implemented `inventoryPurchases` and `purchasePayments`.
- `amountPaid` on purchases is derived from authoritative `purchasePayment` records.
- Payment methods supported: `cash`, `bank_transfer`, `pos`, `other`.

---

## 6. SBM-022 Implementation Details: Mongoose Target Schemas & Compound Indexes

### 6.1 Compound Tenant Index Rule
Every tenant-owned model enforces the compound unique index:
$$\{ \text{businessId}: 1, \, \text{id}: 1 \} \quad \text{with} \quad \{ \text{unique}: true \}$$
This has been declared and verified across all 20 tenant-owned schemas.
The `Membership` model additionally enforces:
$$\{ \text{businessId}: 1, \, \text{userId}: 1 \} \quad \text{with} \quad \{ \text{unique}: true \}$$

### 6.2 Target Schemas Implemented
- Core: `Business`, `User`, `Membership`, `Customer`, `Product`, `Service`.
- Inventory: `InventoryPurchase`, `PurchasePayment`, `StockMovement`.
- Sales & Credit: `Sale`, `SalePayment`, `CreditEntry`, `CreditPayment`, `CreditAdjustment`.
- Financial & Operations: `ExpenseCategory`, `Expense`, `ExpensePayment`, `IncomeEntry`, `OwnerEquityTransaction`, `FinancialReversal`, `AuditLog`, `Setting`.

### 6.3 Strict Schema Validation
- All monetary fields enforce `INTEGER_KOBO_VALIDATOR` (`Number.isSafeInteger(val) && val >= 0`). Fractional amounts are rejected.
- All quantity fields enforce `SCALED_QUANTITY_VALIDATOR` or `SIGNED_SCALED_QUANTITY_VALIDATOR`. Unscaled floats are rejected.
- Required business ownership (`businessId`) is strictly enforced on all tenant models.

---

## 7. Quantity Scale Implementation (Scale 1,000)

In accordance with confirmed Product Owner decisions:
- **Base Precision:** Scale 1,000 (three decimal places).
  - $1 \text{ unit} = 1,000 \text{ stored units}$
  - $1.5 \text{ kg} = 1,500 \text{ stored units}$
  - $0.125 \text{ litres} = 125 \text{ stored units}$
  - $0.001 \text{ kg} = 1 \text{ stored unit}$
- **`toQuantityUnits(value, { allowNegative = false })`**: Parses exact decimal strings to avoid binary floating-point representation errors. Rejects inputs with $>3$ decimal places, `NaN`, `Infinity`, and unsafe integers.
- **`fromQuantityUnits(units, { asString = false })`**: Formats stored scaled integers back to exact decimal numbers or trimmed strings without floating-point artifacts.

---

## 8. Weighted Average Cost (WAC) Engine

Implemented in `src/domain/inventory/wacEngine.js`:
$$C_{\text{new\_wac}} = \operatorname{round}\left( \frac{(Q_{\text{verified}} \times C_{\text{current\_wac}}) + (Q_{\text{purchase}} \times C_{\text{purchase}})}{Q_{\text{verified}} + Q_{\text{purchase}}} \right)$$

- **Rounding Rule:** Half-up to nearest integer Kobo (`Math.round(...)`).
- **Initial Cost:** If $Q_{\text{verified}} = 0$ or $C_{\text{current\_wac}} = \text{null}$, $C_{\text{new\_wac}} = C_{\text{purchase}}$.
- **Unverified Purchases:** If purchase unit cost is unverified (`null`), WAC is not updated and remains at `currentWac`.
- **Zero Dilution:** Unvalued legacy opening stock is excluded from the verified WAC calculation to prevent diluting verified inventory valuation.

---

## 9. Mixed-Cost Allocation Implementation

Implemented in `src/domain/inventory/mixedCostAllocation.js`:
- **FIFO Depletion of Unvalued Legacy Stock:**
  $$\text{unvaluedQty} = \min(\text{requestedQuantity}, \text{unvaluedStockRemaining})$$
  $$\text{verifiedQty} = \text{requestedQuantity} - \text{unvaluedQty}$$
- **Portions Generated:**
  - Portion 1: `unvalued_legacy` (Quantity: `unvaluedQty`, Unit Cost: `null`, Total Cost: `null`, `isCostSpecified: false`).
  - Portion 2: `verified_wac` (Quantity: `verifiedQty`, Unit Cost: `currentWac`, Total Cost: $\operatorname{round}(\text{verifiedQty} \times \text{currentWac} / 1000)$, `isCostSpecified: true`).
- **Worked Numerical Test Case (Blueprint Section 17.3):**
  - Input: 3 unvalued opening units, 5 verified units @ ₦4,000 (400,000 Kobo). Sale of 5 units @ ₦6,000 (600,000 Kobo).
  - Result: 3 units allocated to `unvalued_legacy` (₦18,000 revenue with unspecified cost).
  - 2 units allocated to `verified_wac` (₦12,000 verified revenue, ₦8,000 verified COGS).
  - Verified Gross Profit: $₦12,000 - ₦8,000 = \mathbf{₦4,000.00}$.
  - Remaining Stock: 3 verified units.
  - Test passed with 100% exact numerical match.

---

## 10. Dexie / Mongoose Consistency Results

As documented in `docs/engineering/PHASE_2_SCHEMA_CONSISTENCY.md`:
- All 22 domain and operational entities match across Dexie and Mongoose in field names, types, nullability, integer Kobo monetary units, and scale 1,000 quantity representations.
- `syncQueue` and `migrationCheckpoints` are client-only local operational stores and intentionally do not have Mongoose models.

---

## 11. Compound Tenant Index Declarations

All 20 tenant-owned Mongoose models declare:
```javascript
schema.index({ businessId: 1, id: 1 }, { unique: true });
```
`Membership` additionally declares:
```javascript
membershipSchema.index({ businessId: 1, userId: 1 }, { unique: true });
```
Automated test suite `src/test/mongoose_target_schemas.test.js` iterates through all target models and validates that the declared index definitions exist and enforce uniqueness.

---

## 12. Test Commands & Results

### 12.1 Vitest Execution (`npm.cmd test`)
```text
> anti-paper-frontend@0.0.0 test
> vitest run

 RUN  v2.1.8 C:/Users/HomePC/LCC/msme-ledger-main/msme-ledger-main

 ✓ src/test/inventory_domain.test.js (17 tests) 11ms
 ✓ src/test/smoke.test.js (1 test) 25ms
 ✓ src/test/dexie_databases.test.js (6 tests) 56ms
 ✓ src/test/onboarding.test.jsx (4 tests) 338ms
 ✓ src/test/mongoose_target_schemas.test.js (8 tests) 17ms

 Test Files  5 passed (5)
      Tests  36 passed (36)
   Start at  16:48:01
   Duration  3.93s
```
- **Exit Code:** 0.
- **Pass Rate:** 100% (36/36 tests passed).
- **Test File Inventory:**
  - `smoke.test.js`: 1 test
  - `onboarding.test.jsx`: 4 regression tests (Phase 1)
  - `dexie_databases.test.js`: 6 tests (SBM-020)
  - `inventory_domain.test.js`: 17 tests (SBM-021)
  - `mongoose_target_schemas.test.js`: 8 tests (SBM-022)

---

## 13. Production Build Results

### 13.1 Vite Production Build (`npm.cmd run build`)
```text
> anti-paper-frontend@0.0.0 build
> vite build

vite v5.4.21 building for production...
transforming...
✓ 46 modules transformed.
rendering chunks...
computing gzip size...
dist/registerSW.js                        0.13 kB
dist/manifest.webmanifest                 0.44 kB
dist/index.html                           0.92 kB │ gzip:  0.49 kB
dist/assets/pwa-192x192-BlO6rYdK.png  1,270.31 kB
dist/assets/index-R2cgbanY.css           19.68 kB │ gzip:  4.10 kB
dist/assets/index-BG1XUgWB.js           271.52 kB │ gzip: 86.50 kB
✓ built in 1.36s

PWA v1.3.0
mode      generateSW
precache  10 entries (4007.01 KiB)
files generated
  dist/sw.js
  dist/workbox-835c8c05.js
```
- **Exit Code:** 0.
- **Build Duration:** 1.36s.
- **Asset Integrity:** Valid Workbox service worker generated.

---

## 14. Dependencies Added

- **Production Dependencies Added:** **0**. No production packages were added or upgraded.
- **Root DevDependencies Added:** **0**. The existing `vitest` suite resolves `mongoose` from `server/node_modules/` via an isolated resolve alias in `vitest.config.js`.
- **Server Dependencies Installed:** Ran `npm.cmd ci` inside `server/` to install existing pinned dependencies (`mongoose@^8.3.2`, `express@^4.19.2`, `cors@^2.8.5`) without modifying `server/package.json` or `server/package-lock.json`.

---

## 15. Known Limitations & Unresolved Schema Issues

In accordance with Blueprint V2.1:
1. **Mixed-Cost Proportional Discount Allocation:** Unresolved domain policy. Bill/line discounts are not apportioned between unvalued and verified portions.
2. **Compensating Financial Reversal Workflows:** Entity structures declared; compensating workflows deferred to future phases.
3. **MongoDB Connection:** Schema and index inspection verified purely in-memory. No live MongoDB was touched or indexed.

---

## 16. Explicit Safety Confirmations

1. **NO Live Legacy Data Was Migrated:** Confirmed. `msme_ledger_db` was not read for migration, nor was any record copied into `sb_manager_db_v1`.
2. **NO Production MongoDB Was Modified:** Confirmed. Tests ran purely in-memory via schema inspection and validation without connecting to any database.
3. **NO Production Deployment Occurred:** Confirmed. No code was deployed to Vercel or any hosting environment.
4. **NO Git Commits or Pushes:** Confirmed. All modifications remain in the local working tree.

---

## 17. Final Git Status

- **`git diff --stat`:**
  ```text
   package-lock.json             | 1052 ++++++++++++++++++++++++++++++++++++++++-
   package.json                  |   11 +-
   src/components/Onboarding.jsx |   12 +-
   src/config/db.js              |  110 +++++
   4 files changed, 1151 insertions(+), 34 deletions(-)
  ```
- **`git diff --check`:** Clean (0 whitespace defects, 0 conflict markers).
- **Working Tree:** All modifications preserved cleanly.

---

## 18. STOP CONDITION MET

Phase 2 implementation of tickets **SBM-020**, **SBM-021**, and **SBM-022** is complete and fully tested.

In strict adherence to instructions:
- Phase 3 has **NOT** been started.
- Client dual-database migration worker (SBM-030) has **NOT** been implemented.
- Legacy debt reconciliation engine (SBM-031) has **NOT** been implemented.
- No live migration has been executed.

Awaiting project owner review and explicit authorization before proceeding to Phase 3.

