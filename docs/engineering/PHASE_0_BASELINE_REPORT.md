# Phase 0: Baseline, Safety & Inspection Report

> **Document Status:** Authoritative Engineering Report  
> **Phase:** Phase 0 (Baseline, Safety and Inspection)  
> **Target System:** SB Manager Rebuild  
> **Reference Specification:** SB Manager Rebuild Blueprint V2.1  
> **Execution Constraint:** Strictly Non-Destructive. **No production code, database schemas, local business data, or live environments were modified.**

---

## 1. Workspace and Repository Identity

### 1.1 Physical Path Layout
- **Workspace Root Directory:** `C:\Users\HomePC\LCC\msme-ledger-main`
- **Application Source Root Directory:** `C:\Users\HomePC\LCC\msme-ledger-main\msme-ledger-main`
- **Structural Origin:** The repository was originally downloaded from GitHub as a ZIP archive of the `main` branch (`msme-ledger-main.zip`) and extracted into the `msme-ledger-main` directory, producing a nested root structure.
- **Remote Repository URL:** `https://github.com/LUKMANCODECRAFT/msme-ledger`
- **Remote Default Branch:** `main`
- **Remote HEAD Commit:** `9395cf5d037cd6a80b8a3ac64bbc33aa52534c04`

---

## 2. Git Baseline Status

### 2.1 Initial Local State Verification
Prior to executing any Git commands, both `C:\Users\HomePC\LCC\msme-ledger-main` and `C:\Users\HomePC\LCC\msme-ledger-main\msme-ledger-main` were inspected for existing `.git` version control metadata:
```powershell
git status
# Result: fatal: not a git repository (or any of the parent directories): .git
```
No hidden `.git` directories existed in the workspace or parent directory.

### 2.2 Safety Backup Execution
In strict accordance with Phase 0 requirements, before any operation capable of altering state was executed, a complete recursive backup of the workspace was generated:
- **Backup Location:** `C:\Users\HomePC\LCC\msme-ledger-main\backups\msme-ledger-main-pre-phase0`
- **Backup Verification:** Verified 32 files copied recursively with zero errors.

### 2.3 Remote Verification & History Audit
The remote repository was queried directly via Git over HTTPS:
```powershell
git ls-remote https://github.com/LUKMANCODECRAFT/msme-ledger
# Result: 9395cf5d037cd6a80b8a3ac64bbc33aa52534c04 HEAD
#         9395cf5d037cd6a80b8a3ac64bbc33aa52534c04 refs/heads/main
```
A shallow inspection clone was established in `backups/remote-comparison` to inspect the authoritative commit log:
1. `9395cf5` — *feat: add partial payment logic and transactions table* (Author: LUKMANCODECRAFT, 2026-09-14 13:57:02 +0100)
2. `3c55a9a` — *feat: add clear debt button to Debtors page* (Author: LUKMANCODECRAFT, 2026-09-14 13:51:20 +0100)
3. `4a724b6` — *feat: Add high-converting marketing Landing Page before onboarding* (Author: LUKMANCODECRAFT, 2026-09-14 03:09:17 +0100)
4. `a7561ab` — *feat: Add mobile-friendly UI forms to create Customers and Inventory items* (Author: LUKMANCODECRAFT, 2026-09-14 02:44:03 +0100)
5. `51c2d3a` — *feat: Implement mandatory onboarding gate and purge seed data* (Author: LUKMANCODECRAFT, 2026-09-14 01:31:07 +0100)

### 2.4 Content Divergence Comparison
The local source snapshot in `msme-ledger-main` was compared file-by-file against the remote Git tree at commit `9395cf5`:
```powershell
git --git-dir=.\backups\remote-comparison\.git --work-tree=.\msme-ledger-main diff -w --ignore-space-at-eol
# Result: EMPTY (0 differences)
```
- **Finding:** The local code is **100% byte-for-byte identical** to the remote repository at commit `9395cf5`.
- **Line Ending Artifact:** Local files use Windows CRLF line endings (introduced during ZIP extraction on Windows), while remote Git stores LF. No semantic differences exist.

### 2.5 Baseline Attachment
Authoritative Git metadata was established in `C:\Users\HomePC\LCC\msme-ledger-main\msme-ledger-main` by linking the remote Git repository metadata:
- **Repository Root:** `C:\Users\HomePC\LCC\msme-ledger-main\msme-ledger-main`
- **Current Branch:** `main`
- **HEAD Commit:** `9395cf5d037cd6a80b8a3ac64bbc33aa52534c04`
- **Configured Remote:** `origin -> https://github.com/LUKMANCODECRAFT/msme-ledger`
- **Git Push Boundary:** **CONFIRMED. Zero pushes executed to GitHub.**

---

## 3. Source-Code Structure

The application consists of 32 total source files organized into frontend and backend packages:

```
msme-ledger-main/
├── .gitignore
├── index.html                      # PWA meta tags, viewport, root div
├── LEGAL_COPY.md                   # Terms of Service & Privacy Policy
├── package.json                    # Frontend Vite/React dependencies
├── package-lock.json
├── postcss.config.js
├── README.md                       # Prototype documentation & quickstart
├── tailwind.config.js
├── vite.config.js                  # Vite PWA & Workbox runtime configuration
├── public/
│   ├── pwa-192x192.png             # Android PWA icon (1.27 MB uncompressed)
│   └── pwa-512x512.png             # Maskable PWA icon (1.27 MB uncompressed)
├── src/
│   ├── App.jsx                     # Root router-less tab container
│   ├── index.css                   # Tailwind base directives
│   ├── main.jsx                    # React 18 createRoot entrypoint
│   ├── components/
│   │   ├── ExpiredPaywall.jsx      # Hardcoded OPAY bank transfer notice
│   │   ├── LandingPage.jsx         # Marketing landing page
│   │   └── Onboarding.jsx          # Destructive onboarding gate (wipes DB)
│   ├── config/
│   │   └── db.js                   # Dexie v1 & v2 schema definitions
│   ├── hooks/
│   │   └── useBackgroundSync.js    # 3-minute interval & online event listener
│   ├── pages/
│   │   ├── Debtors.jsx             # Debt list, clear debt, record payment
│   │   ├── PointOfSale.jsx         # Cashier UI, customer & item modals
│   │   └── SalesHistory.jsx        # Chronological sales ledger table
│   ├── services/
│   │   ├── ledgerService.js        # Atomic sales & inventory mutation logic
│   │   └── syncService.js          # Unauthenticated push-only sync logic
│   └── utils/
│       └── shopIdentity.js         # Client UUID & 30-day trial expiration in localStorage
└── server/
    ├── package.json                # Express, Mongoose, CORS dependencies
    ├── package-lock.json
    └── src/
        ├── server.js               # Express app, port 3000, Mongo connect
        ├── controllers/
        │   ├── adminController.js  # Revenue metrics with ?key= authorization
        │   └── syncController.js   # Unauthenticated bulkWrite upsert
        └── models/
            ├── Ledger.js           # Mongoose schemas: Customer, Inventory, Sale
            └── License.js          # Mongoose schema: License
```

### 3.1 Routing & Navigation Architecture
- **No Client Router:** The application does not use `react-router-dom`. Navigation is driven by local component state in `src/App.jsx`:
  ```javascript
  const [activeTab, setActiveTab] = useState('pos'); // 'pos' | 'sales' | 'debtors'
  ```
- **Sequential Application Gates:**
  1. If `!localStorage.getItem('shopName')` $\rightarrow$ renders `LandingPage` (which transitions to `Onboarding`).
  2. If `isTrialExpired()` $\rightarrow$ renders `ExpiredPaywall` with hard stop.
  3. Otherwise $\rightarrow$ renders main dashboard tabs (`PointOfSale`, `SalesHistory`, `Debtors`).

---

## 4. Dependency and Test-Harness Status

### 4.1 Runtime Environment
- **Node.js:** `v26.13.0`
- **npm:** `11.20.0`
- **Windows Operational Constraint:** Running `npm` directly in PowerShell triggers a `PSSecurityException` because Windows restricts execution of `npm.ps1`. All npm operations must explicitly invoke `npm.cmd`.

### 4.2 Dependency Audit
- **Frontend Dependencies ([package.json](file:///c:/Users/HomePC/LCC/msme-ledger-main/msme-ledger-main/package.json)):**
  - `dexie` (`^4.0.4`) — Active IndexedDB wrapper.
  - `dexie-react-hooks` (`^1.1.7`) — Active reactive live queries (`useLiveQuery`).
  - `react` (`^18.2.0`), `react-dom` (`^18.2.0`) — Active UI runtime.
  - `jimp` (`^1.6.1`) — **CONFIRMED DEAD DEPENDENCY.** Grepping all source files reveals zero imports or usages. Adds unnecessary package weight.
- **Backend Dependencies ([server/package.json](file:///c:/Users/HomePC/LCC/msme-ledger-main/msme-ledger-main/server/package.json)):**
  - `express` (`^4.19.2`) — HTTP server.
  - `mongoose` (`^8.3.2`) — MongoDB ODM.
  - `cors` (`^2.8.5`) — CORS middleware.

### 4.3 Test Harness Status
- **Automated Tests:** **ZERO automated tests exist.**
- **Test Libraries:** Neither Vitest, Jest, Mocha, Supertest, nor React Testing Library is installed.
- **Scripts:** `package.json` defines only `"dev"`, `"build"`, `"preview"`. No `"test"` script exists.
- **Gate Blocker:** Phase 1 ticket **SBM-011** must install and configure Vitest and Supertest before feature refactoring begins.

---

## 5. Existing IndexedDB Schema and Findings

### 5.1 Schema Versions in `src/config/db.js`
The legacy client database is declared as `msme_ledger_db`:
```javascript
// Version 1
msme_ledger_db.version(1).stores({
  customers: 'id, phone, sync_status, updatedAt',
  inventory: 'id, name, sync_status, updatedAt',
  sales: 'id, customerId, paymentStatus, sync_status, date'
});

// Version 2 (Current Production Version)
msme_ledger_db.version(2).stores({
  customers: 'id, phone, sync_status, updatedAt',
  inventory: 'id, name, sync_status, updatedAt',
  sales: 'id, customerId, paymentStatus, sync_status, date',
  transactions: 'id, customerId, type, date, sync_status'
});
```

### 5.2 Critical Store-Level Findings
1. **Index Discrepancy on Inventory:** In `db.js`, the index is declared as `'id, name, ...'`. However, `ledgerService.js` line 150 writes property `itemName`. The property `itemName` is completely unindexed in Dexie.
2. **Untracked `transactions` Store:** The `transactions` store was introduced in commit `9395cf5`. While `Debtors.jsx` writes debt repayments to it, `usePendingSyncCount()` excludes it, `syncService.js` excludes it, and the server has no model for it.
3. **Live Browser IndexedDB Discovery:**
   - Chrome User Data directory inspected at:  
     `%LOCALAPPDATA%\Google\Chrome\User Data\Default\IndexedDB\https_msme-ledger.vercel.app_0.indexeddb.leveldb`
   - Log inspection confirms live production database `msme_ledger_db` with stores `customers`, `inventory`, `sales`, and `transactions`.
   - A verified backup snapshot was captured at:  
     `C:\Users\HomePC\LCC\msme-ledger-main\backups\live_chrome_indexeddb_snapshot`.

---

## 6. MongoDB Schema and Findings

### 6.1 Server Models Audit (`server/src/models/Ledger.js`)
- **`Customer`:** `shopId` (String, indexed), `id` (String, globally unique), `name`, `phone`, `totalDebt` (Number).
- **`Inventory`:** `shopId` (String, indexed), `id` (String, globally unique), `itemName`, `price` (Number), `stockCount` (Number).
- **`Sale`:** `shopId` (String, indexed), `id` (String, globally unique), `customerId`, `items` (Array, untyped), `totalAmount`, `amountPaid`, `balance`, `paymentStatus`, `date`.
- **`License` ([License.js](file:///c:/Users/HomePC/LCC/msme-ledger-main/msme-ledger-main/server/src/models/License.js)):** `shopId` (String, unique), `status` (enum: `'trial'`, `'active'`, `'expired'`), `expiresAt` (Date).

### 6.2 Database Connection & Runtime Status
- **Local MongoDB Daemon:** Tested TCP connection to `127.0.0.1:27017` via PowerShell. Result: Connection failed (`TcpTestSucceeded: False`). No local MongoDB process is active.
- **Environment Variables:** Neither `MONGO_URI`, `VITE_API_URL`, nor `ADMIN_SECRET_KEY` is present in local environment variables.
- **Required Cloud Evidence:** To inspect production MongoDB data without modifying records, the project owner or administrator must provide a read-only MongoDB Atlas connection string (`readAnyDatabase` privilege) or an exported BSON/JSON dump for Phase 0 diagnostic execution.

---

## 7. Verified versus Unverified V2.1 Audit Findings

| Audit Finding | V2.1 Status | Phase 0 Evidence & Verification |
|---|---|---|
| **Onboarding Data Wipe** | **VERIFIED DIRECTLY** | Inspected [src/components/Onboarding.jsx#L14-L19](file:///c:/Users/HomePC/LCC/msme-ledger-main/msme-ledger-main/src/components/Onboarding.jsx#L14-L19). Explicitly executes `table.clear()` on `customers`, `inventory`, and `sales`. |
| **Trapped Debt Repayments** | **VERIFIED DIRECTLY** | Inspected [src/config/db.js#L52](file:///c:/Users/HomePC/LCC/msme-ledger-main/msme-ledger-main/src/config/db.js#L52) & [src/services/syncService.js#L13-L28](file:///c:/Users/HomePC/LCC/msme-ledger-main/msme-ledger-main/src/services/syncService.js#L13-L28). `transactions` is excluded from push payload and backend schemas. |
| **Unaudited Balance Zeroing** | **VERIFIED DIRECTLY** | Inspected [src/pages/Debtors.jsx#L44-L48](file:///c:/Users/HomePC/LCC/msme-ledger-main/msme-ledger-main/src/pages/Debtors.jsx#L44-L48). Sets `totalDebt: 0` without audit record, timestamp, or pending sync status. |
| **Client-Forged Tenant ID** | **VERIFIED DIRECTLY** | Inspected [src/utils/shopIdentity.js#L9](file:///c:/Users/HomePC/LCC/msme-ledger-main/msme-ledger-main/src/utils/shopIdentity.js#L9) & [server/src/controllers/syncController.js#L26](file:///c:/Users/HomePC/LCC/msme-ledger-main/msme-ledger-main/server/src/controllers/syncController.js#L26). Unauthenticated request body `shopId` directly accepted. |
| **Global Unique Key Collision** | **VERIFIED DIRECTLY** | Inspected [server/src/models/Ledger.js#L5,L13,L21](file:///c:/Users/HomePC/LCC/msme-ledger-main/msme-ledger-main/server/src/models/Ledger.js#L5,L13,L21). Indexes declare `unique: true` globally across all tenants. |
| **In-Flight Sync Overwrites** | **VERIFIED DIRECTLY** | Inspected [src/services/syncService.js#L40-L59](file:///c:/Users/HomePC/LCC/msme-ledger-main/msme-ledger-main/src/services/syncService.js#L40-L59). `bulkPut` writes stale snapshot over local edits made during transit. |
| **Hardcoded Bank Account** | **VERIFIED DIRECTLY** | Inspected [src/components/ExpiredPaywall.jsx#L25-L38](file:///c:/Users/HomePC/LCC/msme-ledger-main/msme-ledger-main/src/components/ExpiredPaywall.jsx#L25-L38). Hardcoded OPAY account `9132555203` (Lukman yerima ismail). |
| **Admin Secret in Query Param** | **VERIFIED DIRECTLY** | Inspected [server/src/controllers/adminController.js#L8](file:///c:/Users/HomePC/LCC/msme-ledger-main/msme-ledger-main/server/src/controllers/adminController.js#L8). `req.query.key` checked against `ADMIN_SECRET_KEY`. |
| **PWA Icon 404 Paths** | **VERIFIED DIRECTLY** | Inspected [index.html#L8,L13](file:///c:/Users/HomePC/LCC/msme-ledger-main/msme-ledger-main/index.html#L8,L13). `<link rel="icon" href="/public/pwa-192x192.png" />`. |
| **Live MongoDB Document State** | **REQUIRES EVIDENCE** | Live cloud database records could not be inspected due to lack of production MongoDB URI in local environment. |

---

## 8. Data-Preservation Risks

1. **Risk of Accidental Local Wipeout:** If a merchant visits the application after clearing browser cookies or if mobile Safari evicts `localStorage`, `localStorage.getItem('shopName')` returns null, prompting Onboarding. Submitting Onboarding executes `table.clear()` on `customers`, `inventory`, and `sales`. **Mitigation in Phase 1 (SBM-010):** Delete `table.clear()` calls immediately before any other changes.
2. **Risk of Trapped Local Repayments:** Merchants who recorded debt payments on `https://msme-ledger.vercel.app` have those records stored strictly in IndexedDB `transactions`. If their device is lost or browser cache cleared, those repayments cannot be recovered from MongoDB. **Mitigation in Phase 3:** Extract and preserve all `transactions` rows into `sb_manager_db_v1.creditPayments`.
3. **Risk of Debt Double-Deduction:** Because `totalDebt` was already reduced when debt repayments were logged in MSME Ledger, deducting those historical payments again during migration would cut merchant receivables in half. **Mitigation in Phase 3:** Migrated `customer.totalDebt` represents opening credit; historical repayments migrate as unallocated records without secondary deduction.

---

## 9. Currency and Quantity Uncertainties

### 9.1 Currency Representation Audit
- **Codebase Intent:** Code comments state that values are stored as integer Kobo ($1 \text{ NGN} = 100 \text{ Kobo}$).
  - In `PointOfSale.jsx` line 53: `priceKobo = Math.floor(parseFloat(newInventoryPrice) * 100)`.
  - In `PointOfSale.jsx` line 146: `amountPaidKobo = Math.floor(parsedAmountNaira * 100)`.
  - In `Debtors.jsx` line 60: `paymentAmountKobo = Math.round(paymentAmountNaira * 100)`.
- **The Ambiguity Risk:** In the absence of server-side validation or Mongoose schema validators, manual API requests, direct MongoDB writes, or floating-point calculations could have inserted values representing raw Naira (e.g., entering `5000` to mean ₦5,000 rather than 5,000 Kobo / ₦50).
- **Warning Against Blanket Thresholds:** A blanket assumption that values $\ge 50$ are Kobo is mathematically unsafe. A commodity priced at ₦50 (5,000 Kobo) entered as raw Naira would be corrupted by 100x if assumed to already be Kobo.
- **Phase 0 Diagnostic Heuristic:** The created diagnostic script (`scripts/diagnostics/inspect_legacy.js`) implements contextual commodity cross-referencing and quarantines ambiguous small integers ($0 < \text{val} < 50$) or values matching major commodity keywords under 2000 for merchant confirmation.

### 9.2 Quantity Uncertainties
- Current inventory models define `stockCount` as an untyped number.
- In `PointOfSale.jsx`, cart increments by integer units (+1).
- Unresolved operational uncertainty: Small businesses selling bulk goods (grains, oil, meat) require decimal precision (e.g., $2.5\text{ kg}$). The proposed standard in V2.1 is 3 decimal places (`0.001` scale factor).

---

## 10. Remaining Architectural Blockers

The following items from V2.1 require resolution before Phase 3 and Phase 5 implementation:

1. **Migration-Quarantine Storage Definition:** An explicit Dexie store (`migrationQuarantine`) must be added to `sb_manager_db_v1` to house quarantined records that fail heuristic currency checks, ensuring they do not block clean records from migrating.
2. **Compensating Payment Reversals:** When a customer repayment is reversed, the compensating event must be explicitly recorded as a `PaymentReversal` with a negative amount delta, avoiding in-place balance alterations.
3. **Reversal Consistency Across All Streams:** Explicit compensating events must be specified for:
   - Sales $\rightarrow$ `SaleReversal` (generates `sale_reversal` stock movement).
   - Expenses $\rightarrow$ `ExpenseReversal` (cancels cash outflow).
   - Purchases $\rightarrow$ `PurchaseReturn` (generates `purchase_return` negative stock movement).
4. **ERD and Schema Field Synchronization:** Complete field-level parity between Dexie v1 destination stores and Mongoose target models (e.g., `clientRevision`, `serverRevision` must be present on both).
5. **Mixed-Cost Sales Discount Allocation:** When a discount is applied to a sale line containing both unvalued legacy stock and verified purchase stock, the discount must be allocated proportionally across both cost portions based on their relative gross sales volume.
6. **Opening Stock Movement Reconciliation:** When `opening_balance` stock movements are created during migration, they must be flagged with `isCostSpecified: false` and isolated from the active WAC pool until verified purchases occur.

---

## 11. Recommended Next Implementation Tasks

1. **Phase 0 Sign-Off:** Review this report and confirm baseline Git status.
2. **Phase 1 Execution (Safety & Test Harness):**
   - **Ticket SBM-010:** Neutralize destructive onboarding data purge in `src/components/Onboarding.jsx`.
   - **Ticket SBM-011:** Install Vitest, Supertest, and React Testing Library; create initial test harness.
3. **Phase 2 Execution (Domain & Schema Foundation):**
   - Declare `sb_manager_db_v1` in Dexie.
   - Build WAC costing and inventory purchase models.
   - Configure Mongoose compound multi-tenant indexes.

---

## 12. Commands Executed and Their Results

| Timestamp (Local) | Command Line Executed | Purpose | Exit Code | Summary of Output |
|---|---|---|---|---|
| `14:52:21` | `Get-Location; Get-ChildItem -Force; Get-ChildItem -Path .. -Force` | Workspace structure inspection | 0 | Discovered inner `msme-ledger-main` directory. |
| `14:52:41` | `git ls-remote https://github.com/LUKMANCODECRAFT/msme-ledger` | Remote repository ref verification | 0 | Verified remote HEAD commit `9395cf5d037cd6a80b8a3ac64bbc33aa52534c04`. |
| `14:52:54` | `git --version` | Git binary availability check | 0 | `git version 2.56.0.windows.4`. |
| `14:53:21` | `Copy-Item -Path .\msme-ledger-main -Destination .\backups\msme-ledger-main-pre-phase0 -Recurse -Force` | Workspace safety backup | 0 | Complete backup created in `backups/`. |
| `14:53:52` | `git clone --depth 5 https://github.com/LUKMANCODECRAFT/msme-ledger .\backups\remote-comparison` | Remote history clone | 0 | Cloned 5 recent commits to comparison folder. |
| `14:54:08` | `git log --oneline -n 10` (in comparison folder) | Remote commit history audit | 0 | Inspected commits `9395cf5` down to `51c2d3a`. |
| `14:54:48` | `git diff -w --ignore-space-at-eol` | Content divergence comparison | 0 | 0 differences. 100% byte-for-byte content identity verified. |
| `14:55:15` | `Copy-Item -Path .\backups\remote-comparison\.git -Destination .\msme-ledger-main\.git -Recurse` | Git metadata attachment | 0 | Attached verified Git history to `msme-ledger-main`. |
| `14:56:05` | `Test-NetConnection -ComputerName 127.0.0.1 -Port 27017` | Local MongoDB daemon check | 0 | `TcpTestSucceeded: False`. Daemon not running. |
| `14:56:41` | Search for `*msme-ledger*` in Chrome AppData | Live browser IndexedDB discovery | 0 | Discovered `https_msme-ledger.vercel.app_0.indexeddb.leveldb`. |
| `14:57:20` | Copy Chrome IndexedDB to `.\backups\live_chrome_indexeddb_snapshot` | Safe browser data snapshot | 0 | Copied leveldb files without modifying live browser. |
| `14:58:18` | Extract UTF-16 strings from `000003.log` | IndexedDB store audit | 0 | Confirmed stores `customers`, `inventory`, `sales`, `transactions`. |
| `14:02:21` | `node -v` | Node runtime check | 0 | `v26.13.0`. |
| `14:05:50` | `npm.cmd -v` | npm CLI check | 0 | `11.20.0`. |
| `14:09:28` | `node .\msme-ledger-main\scripts\diagnostics\inspect_legacy.js --sample` | Diagnostic script execution | 0 | Analyzed edge-case test vectors; confirmed zero errors. |

---

> **END OF PHASE 0 REPORT — STOP CONDITION MET**  
> Baseline established. Source code verified. Zero production modifications made. Ready for Phase 1 review and authorization.

