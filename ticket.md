# MSME Ledger — System Architecture, Dependencies & Ticket Register (`ticket.md`)

Welcome to the **MSME Ledger** engineering repository. This document serves as the master onboarding, architectural, and ticket reference for all developers joining the project.

---

## 1. System Overview & Core Philosophy

**MSME Ledger** is an offline-first, enterprise-grade retail operating system, point-of-sale (POS), and credit bookkeeping platform engineered for Nigerian micro, small, and medium enterprises (MSMEs). 

### The Core Problem It Solves
Traditional cloud POS software freezes and drops transactions during erratic internet outages or power cuts. Conversely, manual paper ledgers suffer from lost books, torn pages, and customer debt disputes.

### Architectural Principles
1. **100% Airplane Mode First:** All core merchant operations (POS checkout, customer management, inventory adjustment, expense logging, debt recovery) execute locally in `< 50ms` using client-side transactional databases.
2. **Financial Precision:** All currency amounts are stored in **Integer Kobo** (`100 Kobo = ₦1.00`) to completely eliminate JavaScript IEEE-754 floating-point rounding errors.
3. **Scale-1000 Inventory:** Fractional product quantities are supported up to three decimal places (scale 1,000) for grain, fuel, and bulk merchandise.
4. **Crash-Safe Sagas & Compensations:** Multi-store local writes use atomic compensation rollback patterns so no database is ever left in a half-committed state.
5. **Zero False-Positive Sync:** Records are never flipped to `synced` without verified, cryptographic server acknowledgement.
6. **Card-Free Manual Subscriptions:** Merchants activate subscriptions via direct bank transfer (UBA) with dynamic reference matching, issuing offline cryptographic licenses guarded by anti-clock-tampering baselines.

---

## 2. System Architecture

```
+---------------------------------------------------------------------------------------+
|                                FRONTEND (PWA / CLIENT)                                |
|                                                                                       |
|   +-------------------------------------------------------------------------------+   |
|   |                           React 18 + Tailwind CSS                             |   |
|   |         9 Modules: Overview, POS, Credit Book, Inventory, Business Book,       |   |
|   |                    Customers, Expenses, Reports, Settings                     |   |
|   +-------------------------------------------------------------------------------+   |
|                                       |                                               |
|               +-----------------------+-----------------------+                       |
|               |                                               |                       |
|   +-----------------------+                       +-----------------------+           |
|   |  msme_ledger_db       |                       |  sb_db                |           |
|   |  (Dexie - Target DB)  |                       |  (Dexie - Legacy/Op)  |           |
|   |  • customers          |                       |  • products           |           |
|   |  • inventory          |                       |  • stockMovements     |           |
|   |  • sales              |                       |  • expenses           |           |
|   |  • transactions       |                       |  • syncQueue          |           |
|   +-----------------------+                       +-----------------------+           |
|               |                                               |                       |
|               +-----------------------+-----------------------+                       |
|                                       |                                               |
|                    +-------------------------------------+                            |
|                    |      Sync Service (Background)      |                            |
|                    |   • Transactional Saga Rollback     |                            |
|                    |   • Quarantine Manager (SBM-030-A)  |                            |
|                    |   • Offline Entitlement Verifier    |                            |
|                    +-------------------------------------+                            |
+---------------------------------------|-----------------------------------------------+
                                        | (HTTPS / REST)
                                        v
+---------------------------------------------------------------------------------------+
|                                BACKEND (NODE / EXPRESS)                               |
|                                                                                       |
|   +-------------------------------------------------------------------------------+   |
|   |                            Express Router & Pipeline                          |   |
|   |  • Tenant Context Middleware (X-Business-ID)                                  |   |
|   |  • Session Version & Replay Attack Defense                                    |   |
|   |  • Rate Limiter (5/min IP) & Account Lockout (10 failed logins)               |   |
|   +-------------------------------------------------------------------------------+   |
|               |                                               |                       |
|   +-----------------------+                       +-----------------------+           |
|   |  MongoDB + Mongoose   |                       |  Redis (IORedis)      |           |
|   |  • Users & Auth       |                       |  • Distributed Lock   |           |
|   |  • Businesses         |                       |    (Per-token atomic) |           |
|   |  • Target Schemas     |                       |  • Encrypted Replay   |           |
|   |  • Subscriptions      |                       |    Response Cache     |           |
|   |  • Audit Logs         |                       +-----------------------+           |
|   +-----------------------+                                                           |
+---------------------------------------------------------------------------------------+
```

---

## 3. Technology Stack & Dependencies

### Frontend Dependencies (`package.json`)

| Package | Version | Purpose |
| :--- | :--- | :--- |
| `react` | `^18.2.0` | UI Component tree and virtual DOM |
| `react-dom` | `^18.2.0` | DOM rendering target |
| `dexie` | `^4.0.4` | IndexedDB wrapper for high-speed client-side SQL-like queries |
| `dexie-react-hooks` | `^1.1.7` | Reactive `useLiveQuery` hooks for real-time UI data updates |
| `jimp` | `^1.6.1` | Client-side image manipulation and receipt proof handling |
| `vite` | `^5.2.0` | Next-gen frontend tooling and build orchestrator |
| `vite-plugin-pwa` | `^1.3.0` | Progressive Web App manifest generation & Workbox service workers |
| `tailwindcss` | `^3.4.3` | Utility-first styling engine (tri-color system) |
| `postcss` & `autoprefixer` | Latest | CSS processing and vendor prefixing |
| `vitest` | `^2.1.8` | Ultra-fast unit & integration test runner |
| `@testing-library/react` | `^16.3.3` | React component testing utilities |
| `@testing-library/jest-dom` | `^7.0.1` | Custom matchers for DOM assertions |
| `fake-indexeddb` | `^6.2.8` | In-memory IndexedDB mock for NodeJS / Vitest execution |
| `jsdom` | `^31.0.1` | Browser environment simulation in Vitest |

### Backend Dependencies (`server/package.json`)

| Package | Version | Purpose |
| :--- | :--- | :--- |
| `express` | `^4.19.2` | HTTP web server and REST router |
| `mongoose` | `^8.3.2` | MongoDB ODM with compound tenant indexing & transactions |
| `ioredis` | `^6.0.0` | High-performance Redis client for distributed locking & replay cache |
| `argon2` | `^0.45.2` | State-of-the-art password hashing (Argon2id profile) |
| `jsonwebtoken` | `^9.0.3` | Cryptographic JWT access token signing & session tokens |
| `cookie-parser` | `^1.4.7` | Parse HttpOnly secure refresh token cookies |
| `cors` | `^2.8.5` | Strict Origin & Cross-Origin Resource Sharing control |

### System Runtime Requirements
- **Node.js:** `>= 18.x` (Recommended: Node `20.x` or `22.x LTS`)
- **npm:** `>= 9.x`
- **MongoDB:** `>= 6.0` (Replica Set enabled, required for multi-document ACID transactions)
- **Redis:** `>= 6.2` (Required for atomic `SET key val NX EX` distributed lock primitives)

---

## 4. Environment Variables Reference

### Frontend Configuration (`.env` in root)
```env
# URL of the backend API server (leave blank or set to local for development)
VITE_API_URL=http://localhost:3000

# Optional app mode
VITE_APP_ENV=development
```

### Backend Configuration (`server/.env`)
```env
# Server Port
PORT=3000
NODE_ENV=development

# MongoDB Connection String (Must be a Replica Set for transactions!)
MONGO_URI=mongodb://localhost:27017/msme_ledger?replicaSet=rs0

# Redis Connection String
REDIS_URL=redis://localhost:6379

# JWT Cryptography Keys
JWT_SECRET=super_secret_jwt_access_token_signing_key_at_least_32_chars
JWT_KEY_ID=entitlement-key-1
JWT_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"

# Official Bank Details for Subscriptions
BANK_NAME="UBA"
BANK_ACCOUNT_NAME="Lukman Yerima Ismail"
BANK_ACCOUNT_NUMBER="2453591351"

# Allowed CORS Origins (comma separated)
CORS_ORIGIN="http://localhost:5173,http://localhost:3000"
```

---

## 5. Local Setup & Quickstart Guide

### 1. Clone & Install Dependencies
```bash
# Clone the repository
git clone https://github.com/LUKMANCODECRAFT/msme-ledger.git
cd msme-ledger

# Install Frontend dependencies
npm install

# Install Backend dependencies
cd server
npm install
cd ..
```

### 2. Start Services
```bash
# Terminal 1: Start Backend
cd server
npm run dev

# Terminal 2: Start Frontend Development Server
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

### 3. Run the Full Test Suite
The repository includes 25 comprehensive test suites covering 383 automated tests:
```bash
npm test
```
To run tests in watch mode:
```bash
npm run test:watch
```

### 4. Build for Production
```bash
npm run build
```
The compiled PWA will be output to `/dist` with precached service workers and web manifest assets.

---

## 6. Master Ticket Register (Completed Milestones)

| Ticket ID | Workstream / Domain | Status | Key Deliverables & Achievements |
| :--- | :--- | :--- | :--- |
| **SBM-010** | Onboarding & Profile | `COMPLETED` | Empty-database first-time onboarding without data wipe on repeated submission. |
| **SBM-020** | Dual Dexie Architecture | `COMPLETED` | Declared dual-database isolation between operational `sb_db` and target `msme_ledger_db`. |
| **SBM-021** | Inventory & Stock Movements | `COMPLETED` | Scale-1000 inventory model, stock movements, and fractional unit adjustments. |
| **SBM-022** | Mongoose Target Schemas | `COMPLETED` | Server-side schemas with compound tenant indexes `(businessId, ...)`. |
| **SBM-030** | Migration Architecture | `COMPLETED` | Controlled migration orchestrator, read-only adapter, and quarantine table (`SBM-030-A`). |
| **SBM-031** | Debt Reconciliation | `COMPLETED` | Legacy debt reconstruction engine with deterministic conflict resolution. |
| **SBM-040** | Authentication Core | `COMPLETED` | Argon2id passwords, HttpOnly refresh cookies, Redis replay cache, side-channel timing attack defense, 5/min IP rate limit, 10-attempt account lockout. |
| **SBM-041** | Tenant Authorization | `COMPLETED` | Multi-tenant context middleware (`X-Business-ID`), expand-and-contract membership migration engine. |
| **SBM-042** | Subscription & Entitlements | `COMPLETED` | Manual bank-transfer workflow, anti-clock-tampering verification with monotonic clock baseline, UBA bank configuration. |
| **FE-01** | Frontend Redesign | `COMPLETED` | 9 integrated modules, accessible AppShell, responsive dashboard. |
| **FE-01R** | Financial Remediation | `COMPLETED` | Negative stock prevention, Integer Kobo precision, live debt calculations. |
| **FE-01R2** | Sync False-Positive Elimination | `COMPLETED` | Accurate pending counts across 7 record groups; zero false-positive success claims. |
| **FE-01R3** | Sagas & Compensations | `COMPLETED` | Atomic cross-database commit with transactional rollback compensation. |
| **UI-REFINEMENT** | Brand, PWA & UX | `COMPLETED` | Vector brand mark, high-DPI PWA icons (`192x192`, `512x512`), tri-color palette enforcement, zero emojis, on-demand bank account disclosure. |

---

## 7. Active Backlog & Next Milestone Tickets

Assign these active tickets to your engineering team:

```
+----------------------------------------------------------------------------------------+
|                                    ACTIVE TICKETS                                      |
+---------+----------------------------------------------+-------------------+-----------+
| TICKET  | TITLE                                        | OWNER ROLE        | PRIORITY  |
+---------+----------------------------------------------+-------------------+-----------+
| TIK-101 | Docker Compose Infrastructure & MongoDB RS   | Backend / DevOps  | HIGH (P1) |
| TIK-102 | Two-Way Delta Cloud Synchronization          | Offline / Backend | HIGH (P1) |
| TIK-103 | WhatsApp Digital Receipts & Direct Printing  | Frontend          | MED (P2)  |
| TIK-104 | Hardware Barcode Scanner & Camera Reader     | Frontend          | MED (P2)  |
| TIK-105 | Subscription Admin Approval Portal           | Backend / Fullstk | HIGH (P1) |
| TIK-106 | Client-Side CSV & Encrypted Backup Export    | Offline / QA      | MED (P2)  |
+---------+----------------------------------------------+-------------------+-----------+
```

### Detailed Ticket Specifications

#### Ticket `TIK-101`: Docker Compose Local Infrastructure
- **Objective:** Provide a single `docker-compose.yml` that boots MongoDB 6.0 in Replica Set mode (`rs0`) and Redis 7.0 for zero-friction developer onboarding.
- **Acceptance Criteria:**
  1. Running `docker compose up -d` initializes a replica set ready for Mongoose transactions.
  2. Redis is accessible on port `6379`.
  3. Healthchecks verify both services before the Node server connects.

#### Ticket `TIK-102`: Two-Way Delta Cloud Synchronization
- **Objective:** Upgrade the unidirectional pending data push into a full bidirectional delta sync gateway.
- **Acceptance Criteria:**
  1. Client sends `lastSyncedAt` timestamp with sync payloads.
  2. Server responds with records modified since `lastSyncedAt`.
  3. Client merges remote updates using "Last-Write-Wins" on timestamps, preserving unsynced local pending edits.

#### Ticket `TIK-103`: WhatsApp Digital Receipts & Thermal Printing
- **Objective:** Generate ESC/POS thermal printer commands and shareable text/PDF sales receipts.
- **Acceptance Criteria:**
  1. At POS checkout, clicking "Share on WhatsApp" pre-formats a polite receipt summary with itemized line items and total in Naira.
  2. Clicking "Print" sends clean CSS print styles without margins or sidebar artifacts.

#### Ticket `TIK-104`: Hardware Barcode Scanner & Camera POS Reader
- **Objective:** Allow cashiers to scan merchandise barcodes via USB barcode scanners (keystroke wedge) or device cameras.
- **Acceptance Criteria:**
  1. Rapid numeric keyboard input (< 50ms keystrokes ending in `Enter`) automatically matches product `barcode` in Dexie and increments cart quantity.
  2. Camera viewfinder modal decodes UPC/EAN barcodes in real-time.

#### Ticket `TIK-105`: Subscription Administrative Review Portal
- **Objective:** Provide store owners / admins with an interface to review submitted bank transfer proofs, match bank statements, and trigger cryptographic entitlement signing.
- **Acceptance Criteria:**
  1. Endpoint `GET /api/v2/admin/subscriptions/pending` lists unverified submissions.
  2. Endpoint `POST /api/v2/admin/subscriptions/:id/approve` signs the offline entitlement token with RSA-256 and records an audit log.

#### Ticket `TIK-106`: Encrypted Local Backup & CSV Export
- **Objective:** Enable merchants to export all transactions, stock, and customer ledgers to CSV or password-encrypted JSON for offline archival.
- **Acceptance Criteria:**
  1. Settings provides "Export Business Data (CSV / JSON)".
  2. File can be re-imported into an empty device to restore complete business state.

---

## 8. Directory Structure Guide

```
msme-ledger-main/
├── index.html                     # Main HTML template with PWA meta tags & SVG favicon
├── package.json                   # Frontend dependencies, scripts, and Vitest config
├── vite.config.js                 # Vite + PWA manifest & Workbox runtime caching
├── tailwind.config.js             # Tailwind theme configuration
├── ticket.md                      # System architecture, tech stack & ticket register
├── contribution.md                # Team roles, engineering standards & PR guide
├── public/                        # Static PWA assets & icons
│   ├── favicon.svg                # Master vector brand logo (Forest Green / Sand)
│   ├── pwa-192x192.png            # Mobile home screen icon (192x192)
│   ├── pwa-512x512.png            # Desktop splash / high-DPI icon (512x512)
│   └── apple-touch-icon.png       # iOS home screen icon
├── server/                        # Node.js / Express Backend
│   ├── package.json               # Backend dependencies
│   └── src/
│       ├── server.js              # Server bootstrapper & Express app initialization
│       ├── routes/                # Auth, Session, Subscription & Business API routes
│       ├── services/              # Auth, RefreshToken, Subscription & AuditLog services
│       └── models/                # Mongoose models with tenant compound indexes
└── src/                           # React Frontend Source Code
    ├── main.jsx                   # React root mount
    ├── App.jsx                    # Top-level view switcher (Landing vs Shell)
    ├── components/
    │   ├── LandingPage.jsx        # Public guide, pricing & value proposition
    │   ├── Onboarding.jsx         # First-time shop profile creation modal
    │   └── common/
    │       ├── AppShell.jsx       # 9-module responsive navigation shell
    │       ├── BrandLogo.jsx      # Reusable vector brand badge
    │       ├── Badge.jsx          # Semantic status badges
    │       ├── Button.jsx         # Accessible buttons (Forest Green / Sand / Charcoal)
    │       ├── Modal.jsx          # Accessible dialog with Escape key trap
    │       ├── EmptyState.jsx     # Utilitarian empty view placeholders
    │       └── StorageDiagnosticsModal.jsx # Live IndexedDB counters & manual sync
    ├── context/
    │   ├── AuthContext.jsx        # Merchant auth state & multi-business switching
    │   └── SubscriptionContext.jsx# Offline entitlement evaluation & bank instructions
    ├── config/
    │   └── db.js                  # Dexie dual-database schemas & reactive counters
    ├── pages/                     # 9 Core Modules
    │   ├── Overview.jsx           # Dashboard metrics & active receivables
    │   ├── PointOfSale.jsx        # Cashier terminal with fractional unit cart
    │   ├── CreditBook.jsx         # Customer debt recovery & WhatsApp deep-links
    │   ├── Inventory.jsx          # Stock catalog, reorder levels & movements
    │   ├── BusinessBook.jsx       # 8-column unified chronological cash ledger
    │   ├── Customers.jsx          # Customer directory & balances
    │   ├── Expenses.jsx           # Shop overhead tracking & categories
    │   ├── Reports.jsx            # Printable financial performance statements
    │   └── Settings.jsx           # Store identity, sync trigger & subscription
    ├── domain/                    # Pure Domain Logic & Engines
    │   ├── migration/             # Controlled migration orchestrator & quarantine
    │   └── subscription/          # Anti-clock-tampering offline entitlement engine
    └── test/                      # 25 Vitest Suites (383 Automated Tests)
```
