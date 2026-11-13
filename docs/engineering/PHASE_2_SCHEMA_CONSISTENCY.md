# Phase 2 Schema Consistency Report: Dexie v1 vs. Mongoose Target Models
## Dual-Database Schema & Multi-Tenant Data Consistency Audit

> **Document Status:** Authoritative Engineering Delivery Deliverable  
> **Phase:** Phase 2 (Domain Modeling & Single Source of Truth)  
> **Tickets Completed:** SBM-020, SBM-021, SBM-022  
> **Approved Reference Specification:** SB Manager Rebuild Blueprint V2.1  
> **Audit Date:** 2026-11-13  
> **Consistency Verdict:** **CONSISTENT WITH DOCUMENTED SPECIFICATION LIMITATIONS**

---

## 1. Executive Summary

This report establishes the definitive cross-database schema comparison between the destination Dexie client database (`sb_manager_db_v1`) and the target MongoDB Mongoose schemas (`server/src/models/target/`).

All 22 domain and operational entities, as well as client-only synchronization and migration structures, have been analyzed for:
- Field naming and type parity.
- Monetary representation (Strict integer Kobo, $1 \text{ NGN} = 100 \text{ Kobo}$).
- Quantity representation (Strict scaled integer, Scale 1,000, 3 decimal places).
- Compound tenant indexing rules ($\{ \text{businessId}: 1, \, \text{id}: 1 \}$ `unique: true`).
- Enumeration alignment.
- Nullability and optionality semantics.

---

## 2. Cross-Database Entity Parity Matrix

| Entity | Client Store (`sb_manager_db_v1`) | Server Model (Target Mongoose) | Types & Units Parity | Enum Alignment | Tenant Index Parity | Consistent? |
|---|---|---|---|---|---|---|
| **Business** | `businesses` | `TargetBusiness` | String UUID, ISO Date, Integer Version | `retail`, `service`, `mixed`, `general`; `verified_claimed`, `unresolved_unclaimed` | Global PK `{ id: 1 }` Unique | **YES** |
| **User** | `users` | `TargetUser` | String UUID, Lowercase String Email, PasswordHash | N/A | Global Unique `{ email: 1 }`, PK `{ id: 1 }` | **YES** |
| **Membership** | `memberships` | `TargetMembership` | String UUIDs (`id`, `userId`, `businessId`) | `owner`, `manager`, `cashier` | `{ businessId: 1, userId: 1 }` Unique, `{ businessId: 1, id: 1 }` Unique | **YES** |
| **Customer** | `customers` | `TargetCustomer` | String UUID, String Phone/Name/Address, Sync Status | `pending`, `synced` | `{ businessId: 1, id: 1 }` Unique | **YES** |
| **Product** | `products` | `TargetProduct` | Integer Kobo (`sellingPrice`, `costPrice`), Scaled Int Qty (`currentStock`, `reorderPoint`) | `pending`, `synced` | `{ businessId: 1, id: 1 }` Unique | **YES** |
| **Service** | `services` | `TargetService` | Integer Kobo (`price`), String Name | `pending`, `synced` | `{ businessId: 1, id: 1 }` Unique | **YES** |
| **InventoryPurchase** | `inventoryPurchases` | `TargetInventoryPurchase` | Integer Kobo (`subtotal`, `shippingCost`, `totalCost`, `amountPaid`), Scaled Int (`quantity`) | `paid`, `partial`, `unpaid`; `pending`, `synced` | `{ businessId: 1, id: 1 }` Unique | **YES** |
| **PurchasePayment** | `purchasePayments` | `TargetPurchasePayment` | Integer Kobo (`amount`), ISO Date | `cash`, `bank_transfer`, `pos`, `other`; `pending`, `synced` | `{ businessId: 1, id: 1 }` Unique | **YES** |
| **StockMovement** | `stockMovements` | `TargetStockMovement` | Scaled Int Qty (`quantityDelta`), Integer Kobo/null (`unitCost`) | Movement: 7 types; Reference: 4 types; `pending`, `synced` | `{ businessId: 1, id: 1 }` Unique | **YES** |
| **Sale** | `sales` | `TargetSale` | Integer Kobo (`subtotal`, `discountAmount`, `totalAmount`, `amountPaid`, `creditAmount`), Scaled Int (`quantity`) | `paid`, `partial`, `credit`; `product`, `service`; `unvalued_legacy`, `verified_wac` | `{ businessId: 1, id: 1 }` Unique | **YES** |
| **SalePayment** | `salePayments` | `TargetSalePayment` | Integer Kobo (`amount`), ISO Date | `cash`, `bank_transfer`, `pos`, `other`; `pending`, `synced` | `{ businessId: 1, id: 1 }` Unique | **YES** |
| **CreditEntry** | `creditEntries` | `TargetCreditEntry` | Integer Kobo (`originalAmount`, `settledAmount`, `adjustedAmount`, `remainingBalance`) | `sale_credit`, `legacy_opening_balance`, `manual_credit`; `open`, `partially_paid`, `settled`, `written_off` | `{ businessId: 1, id: 1 }` Unique | **YES** |
| **CreditPayment** | `creditPayments` | `TargetCreditPayment` | Integer Kobo (`amount`), ISO Date | `cash`, `bank_transfer`, `pos`, `other`; `allocated`, `unallocated_legacy_historical` | `{ businessId: 1, id: 1 }` Unique | **YES** |
| **CreditAdjustment** | `creditAdjustments` | `TargetCreditAdjustment` | Integer Kobo (`amount`), String Reason | `write_off_bad_debt`, `dispute_forgiveness`, `correction` | `{ businessId: 1, id: 1 }` Unique | **YES** |
| **Expense** | `expenses` | `TargetExpense` | Integer Kobo (`amount`, `amountPaid`) | `paid`, `unpaid`, `partial` | `{ businessId: 1, id: 1 }` Unique | **YES** |
| **ExpensePayment** | `expensePayments` | `TargetExpensePayment` | Integer Kobo (`amount`), ISO Date | `cash`, `bank_transfer`, `pos`, `other` | `{ businessId: 1, id: 1 }` Unique | **YES** |
| **ExpenseCategory** | `expenseCategories` | `TargetExpenseCategory` | String Name | N/A | `{ businessId: 1, id: 1 }` Unique | **YES** |
| **IncomeEntry** | `incomeEntries` | `TargetIncomeEntry` | Integer Kobo (`amount`), ISO Date | `operating_service_fee`, `interest`, `grant`, `other_operating` | `{ businessId: 1, id: 1 }` Unique | **YES** |
| **OwnerEquityTransaction** | `ownerEquityTransactions` | `TargetOwnerEquityTransaction` | Integer Kobo (`amount`), ISO Date | `owner_contribution`, `owner_withdrawal`; `cash`, `bank_transfer`, `other` | `{ businessId: 1, id: 1 }` Unique | **YES** |
| **FinancialReversal** | `financialReversals` | `TargetFinancialReversal` | String Reason, UUID User ID, ISO Date | `sale`, `salePayment`, `creditPayment`, `expense`, `inventoryPurchase` | `{ businessId: 1, id: 1 }` Unique | **YES** |
| **AuditLog** | `auditLogs` | `TargetAuditLog` | Mixed Delta Object, ISO Date | N/A | `{ businessId: 1, id: 1 }` Unique | **YES** |
| **Setting** | `settings` | `TargetSetting` | Mixed Config Object, ISO Date | N/A | `{ businessId: 1, id: 1 }` Unique | **YES** |
| **SyncQueue** | `syncQueue` | Server Sync Sequence Counter / Change Log | Client-Only Local Mutex & Queue | `queued`, `in_flight`, `failed` | Client PK `{ operationId: 1 }` | **LOCAL-ONLY** |
| **MigrationCheckpoints** | `migrationCheckpoints` | N/A | Client-Only Migration Stage Store | Stages 1 through 8 | Client PK `{ stage: 1 }` | **LOCAL-ONLY** |

---

## 3. Detailed Field & Index Analysis for Core Inventory Models

### 3.1 Product
- **Dexie Declaration:** `products: 'id, businessId, name, sku, hasVerifiedCost, isArchived, sync_status, updatedAt'`
- **Mongoose Model:** `TargetProduct` (`server/src/models/target/coreModels.js`)
- **Indexes:**
  - Compound Multi-Tenant Index: `{ businessId: 1, id: 1 }` with `{ unique: true }`.
  - Secondary Query Indexes: `{ businessId: 1, name: 1 }`, `{ businessId: 1, sku: 1 }`.
- **Validation:**
  - `sellingPrice`: Integer Kobo validator (`Number.isSafeInteger(val) && val >= 0`).
  - `costPrice`: Integer Kobo validator or `null` (Current WAC). Unknown costs strictly preserved as `null`.
  - `currentStock`: Scaled integer (scale 1,000). Derived projection from stock movements.
  - `reorderPoint`: Scaled integer (default: 5,000 units = 5.000 items).

### 3.2 InventoryPurchase
- **Dexie Declaration:** `inventoryPurchases: 'id, businessId, purchaseNumber, paymentStatus, purchaseDate, sync_status'`
- **Mongoose Model:** `TargetInventoryPurchase` (`server/src/models/target/inventoryModels.js`)
- **Indexes:**
  - Compound Multi-Tenant Index: `{ businessId: 1, id: 1 }` with `{ unique: true }`.
  - Secondary Query Indexes: `{ businessId: 1, purchaseNumber: 1 }`, `{ businessId: 1, purchaseDate: 1 }`.
- **Items Subdocument Schema:**
  - `productId`: String UUID FK.
  - `productName`: String.
  - `quantity`: Scaled integer (scale 1,000, validator: `SCALED_QUANTITY_VALIDATOR`).
  - `unitCost`: Integer Kobo (validator: `INTEGER_KOBO_VALIDATOR`).
  - `lineTotal`: Integer Kobo (validator: `INTEGER_KOBO_VALIDATOR`).
- **Monetary Aggregates:**
  - `subtotal`, `shippingCost`, `totalCost`, `amountPaid`: All validated integer Kobo.
  - `paymentStatus`: Enum `['paid', 'partial', 'unpaid']`.

### 3.3 PurchasePayment
- **Dexie Declaration:** `purchasePayments: 'id, purchaseId, businessId, paymentDate, sync_status'`
- **Mongoose Model:** `TargetPurchasePayment` (`server/src/models/target/inventoryModels.js`)
- **Indexes:**
  - Compound Multi-Tenant Index: `{ businessId: 1, id: 1 }` with `{ unique: true }`.
  - Secondary Query Index: `{ businessId: 1, purchaseId: 1 }`.
- **Payment Methods:** Enum `['cash', 'bank_transfer', 'pos', 'other']`.

### 3.4 StockMovement
- **Dexie Declaration:** `stockMovements: 'id, businessId, productId, movementType, referenceId, movementDate, sync_status'`
- **Mongoose Model:** `TargetStockMovement` (`server/src/models/target/inventoryModels.js`)
- **Indexes:**
  - Compound Multi-Tenant Index: `{ businessId: 1, id: 1 }` with `{ unique: true }`.
  - Secondary Query Index: `{ businessId: 1, productId: 1, movementDate: 1 }`.
- **Movement Types:** Enum `['opening_balance', 'purchase_receipt', 'sale_deduction', 'sale_reversal', 'adjustment_loss', 'adjustment_found', 'purchase_return']`.
- **Reference Types:** Enum `['inventoryPurchase', 'sale', 'stockAdjustment', 'legacyOpening']`.
- **Quantity Delta:** Signed scaled integer (scale 1,000). Positive adds stock; negative removes stock.

---

## 4. Known Specification Limitations & Unresolved Architectural Decisions

In strict accordance with Section 8 of the implementation instructions, the following limitations in Blueprint V2.1 are explicitly documented:

### 1. Mixed-Cost Proportional Discount Allocation
- **Issue:** When a sale item is discounted, the blueprint specifies how unvalued legacy stock and verified WAC stock are allocated for cost, but does not specify how bill-level or line-level discounts should be apportioned between the unvalued portion and the verified portion.
- **Architectural Policy Applied:** No arbitrary discount allocation policy was invented. Discount calculations are kept at the line/bill level; gross profit on verified portions is strictly computed as $(\text{verifiedQuantity} \times \text{unitSellingPrice} / 1000) - \text{verifiedCogs}$. Full proportional discount-allocation is deferred to a future accounting specification.

### 2. Financial Reversal Execution Semantics
- **Issue:** `financialReversals` entity is declared in both Dexie and Mongoose schemas with target entity types (`sale`, `salePayment`, `creditPayment`, `expense`, `inventoryPurchase`), but detailed compensating-event reversal workflows (e.g. restock on sale reversal, void on credit payment) are not yet implemented.
- **Architectural Policy Applied:** Only schema and model contracts are declared. No runtime reversal workflows were introduced in Phase 2.

### 3. Client-Only Storage vs. Server Persistence
- **Issue:** `syncQueue` and `migrationCheckpoints` exist exclusively on the Dexie client.
- **Architectural Policy Applied:** These tables are client-side local runtime operational stores. They do not have corresponding Mongoose collections, which is by design. On the server side, synchronization sequences are handled via `SyncSequenceCounter`.

### 4. 64-Bit Numeric Precision Boundary
- **Issue:** MongoDB supports 64-bit BSON Long integers up to $2^{63}-1$, whereas JavaScript Numbers are limited to safe integers up to $2^{53}-1$ ($9,007,199,254,740,991$).
- **Architectural Policy Applied:** All Mongoose and Dexie validators explicitly check `Number.isSafeInteger(val)`. In the context of SB Manager, $2^{53}-1$ Kobo corresponds to $\approx 90\text{ trillion Naira}$, which safely exceeds all possible MSME business transaction volumes without requiring BigInt API serialization overhead.

---

## 5. Final Verification Conclusion

The destination Dexie schema (`sb_manager_db_v1`) and target Mongoose schemas (`server/src/models/target/`) are **100% harmonized** in field names, types, nullability, scaling conventions, and compound tenant uniqueness. All declarations have been verified by automated tests in `src/test/dexie_databases.test.js` and `src/test/mongoose_target_schemas.test.js`.

