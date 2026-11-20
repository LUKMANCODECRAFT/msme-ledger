# Team Contribution & Role Implementation Guide (`contribution.md`)

Welcome to the **MSME Ledger** development team! This guide establishes our team structure, division of engineering responsibilities, design standards, and the exact step-by-step implementation patterns required when contributing to the codebase.

---

## 1. Engineering Philosophy & Non-Negotiable Rules

Every engineer contributing to this repository must internalize these six core rules:

1. **"Airplane Mode First":** Always ask yourself: *"Does this feature work if the device is in airplane mode in a remote market?"* If the answer is no, the architecture is broken.
2. **Integer Kobo Everywhere:** Never calculate currency using floats (`₦100.50`). Always use integer Kobo (`10050`). Only divide by 100 when displaying the final formatted string in the UI.
3. **Scale-1000 Inventory Math:** Fractional items (e.g. 1.750 kg of maize, 2.500 liters of palm oil) are stored with 3 decimal places of precision.
4. **No Silent Failures or False-Positive Syncs:** Never mark a record as `synced` unless the server explicitly acknowledges the exact submitted UUIDs. Never swallow an exception without surfacing actionable UI feedback.
5. **Zero Emojis Policy:** Emojis render inconsistently across Android and desktop browsers and cheapen financial software. Use clean SVG vector icons or text badges exclusively.
6. **Strict Tri-Color Palette:** All UI components must strictly adhere to the approved tri-color theme: **Forest Green**, **Sand/Cream**, and **Charcoal**.

---

## 2. Team Roles & Ownership Matrix

```
+----------------------------------------------------------------------------------------+
|                                ENGINEERING ROLES MATRIX                                |
+------------------------+---------------------------------------+-----------------------+
| ROLE                   | PRIMARY FOCUS                         | PRIMARY DIRECTORIES   |
+------------------------+---------------------------------------+-----------------------+
| Frontend Engineer      | UI/UX, React Views, Mobile Ergonomics | src/pages/,           |
|                        | PWA Manifest & Tailwind Styling       | src/components/       |
+------------------------+---------------------------------------+-----------------------+
| Offline & Storage      | Dexie Schemas, Transactional Sagas,   | src/config/db.js,     |
| Engineer               | Compensation Rollbacks & Live Queries | src/services/sync*,   |
|                        |                                       | src/domain/           |
+------------------------+---------------------------------------+-----------------------+
| Backend & Security     | Express APIs, Mongoose Tenant Models, | server/src/           |
| Engineer               | Redis Token Locks & Crypto Keys       |                       |
+------------------------+---------------------------------------+-----------------------+
| Financial Integrity    | Debt Reconciler, Clock Guard,         | src/test/,            |
| & QA Engineer          | Vitest Suites, Regression Preventions | src/domain/migration/ |
+------------------------+---------------------------------------+-----------------------+
```

---

### Role 1: Frontend Engineer (UI / UX & PWA)

#### Responsibilities
- Implement accessible, responsive React components for the 9 core business modules.
- Ensure optimal touch ergonomics on low-cost mobile phones and tablets (screen widths 360px–420px).
- Maintain PWA compliance via `vite-plugin-pwa` so the app installs seamlessly on Android and iOS.
- Strictly enforce the Tri-Color Palette across all screens and modals.

#### Design System Specifications

| Palette Family | Hex Code | Tailwind / Usage | Description |
| :--- | :--- | :--- | :--- |
| **Forest Green (Primary)** | `#1B4332` | `bg-[#1B4332] text-[#FDFBF7]` | Primary buttons, brand squircle, active tabs |
| **Forest Green (Medium)** | `#2D6A4F` | `bg-[#2D6A4F] text-[#FAF6EE]` | Hover states, pill badges, positive borders |
| **Forest Green (Light)** | `#D8ECE1` | `bg-[#D8ECE1] text-[#1B4332]` | Status badges, subtle highlights, active cards |
| **Sand / Cream (Surface)** | `#FDFBF7` | `bg-[#FDFBF7]` | Primary app background, clean page canvases |
| **Sand / Cream (Card)** | `#FAF6EE` | `bg-[#FAF6EE]` | Sidebar backgrounds, input fields, subtle cards |
| **Sand / Cream (Border)** | `#E5DCC5` | `border-[#E5DCC5]` | Dividers, card borders, table outlines |
| **Charcoal (Dark / Text)** | `#141816` | `bg-[#141816] text-[#FAF6EE]` | Desktop sidebar, primary headings, dark dialogs |
| **Charcoal (Card Surface)**| `#1E2321` | `bg-[#1E2321] text-[#A9AFAA]` | Dark card surfaces, elevated panels |
| **Charcoal (Muted Text)** | `#5C6460` | `text-[#5C6460]` | Subtitles, helper text, secondary table columns |

#### Frontend Mobile Ergonomics Rules
- **No Double Sticky Headers:** Never give a module header `sticky top-0` if the mobile shell header is already `sticky top-0`. Use `static md:static` on mobile.
- **Table Horizontal Scrolling:** Always wrap data tables in `<div className="overflow-x-auto">` and set a responsive minimum width (e.g. `<table className="w-full min-w-[550px] ...">`). Never allow columns to crush together on mobile.
- **Sticky POS Cart Bar:** Always provide a bottom-floating cart shortcut on mobile when items are in the register cart so cashiers do not have to scroll past long product lists to checkout.

---

### Role 2: Offline & Data Storage Engineer (Dexie & Sagas)

#### Responsibilities
- Architect client-side database schemas in `src/config/db.js` using Dexie.js (IndexedDB).
- Safeguard the boundary between operational storage (`sb_db`) and target storage (`msme_ledger_db`).
- Build crash-safe transactional sagas with deterministic compensation rollback functions.
- Optimize reactive UI queries with `useLiveQuery` to achieve `< 50ms` rendering latency.

#### Storage Architecture Rules
- **Client-Generated UUIDs:** Every record must be assigned a client-generated UUID (via `crypto.randomUUID()`) at insertion time. Never wait for a server auto-increment ID.
- **Dual-Database Segregation:**
  - `msme_ledger_db`: Clean target enterprise schema (`customers`, `inventory`, `sales`, `transactions`).
  - `sb_db`: Legacy/operational operational storage (`products`, `stockMovements`, `expenses`, `syncQueue`).
- **Atomic Sagas Pattern:** When a user action writes to both databases, follow the 2-phase saga pattern:
  1. Commit to the secondary/target store first.
  2. If the operational write fails, execute the registered compensation handler to remove the orphaned secondary record.
  3. Never swallow compensation errors.

---

### Role 3: Backend & Security Engineer (API & Cryptography)

#### Responsibilities
- Develop hardened REST endpoints in `server/src/` using Express and Mongoose.
- Enforce strict tenant isolation on every database query using `X-Business-ID`.
- Implement distributed rotation concurrency locks and encrypted replay caches in Redis.
- Maintain cryptographic offline entitlement tokens with RSA-256 signing and kid tracking.

#### Backend Security Rules
- **Side-Channel Timing Defenses:** In `authService.js`, if a user provides an unregistered email, always execute a dummy Argon2 password verification to normalize response times and prevent account enumeration attacks.
- **Distributed Token Lock:** When rotating refresh tokens, always acquire an atomic Redis lock (`SET lock:token:{id} worker_uuid NX EX 10`) before starting the MongoDB transaction.
- **Encrypted Replay Cache:** Replay cache payloads in Redis must be encrypted with AES-256-GCM. An ambiguous MongoDB commit outcome (`UnknownTransactionCommitResult`) must **never** be treated as a confirmed rollback; keep the cached response available for recovery.
- **Multi-Tenant Scoping:** Every Mongoose model query must include the tenant compound index:
  ```javascript
  const records = await Product.find({ businessId: req.businessId, ... });
  ```

---

### Role 4: Financial Integrity & QA Engineer (Audits & Testing)

#### Responsibilities
- Safeguard monetary arithmetic, currency formatting, and debtor ledger reconciliation.
- Maintain the offline anti-clock-tampering baseline and monotonic time enforcement.
- Maintain and expand the 25 Vitest automated test suites (383+ tests).
- Validate sync queues to verify zero false-positive claims and accurate pending counts.

#### Quality & Testing Rules
- **All 25 Test Suites Must Pass:** Before creating or approving any PR, run `npm test` and verify that all 383 tests pass cleanly.
- **Anti-Clock-Tampering Verification:** Ensure that if a user winds back their system clock to prolong an expired subscription, the engine enters `clock_tampered_locked` mode and disables write operations.
- **Debt Balance Accuracy:** Customer `totalDebt` must always match the exact sum of unsettled sales minus verified repayments.

---

## 3. Step-by-Step Implementation Recipes

### Recipe A: How to Add a New Frontend Module

1. **Create the Page Component:**
   Create `src/pages/MyNewModule.jsx`:
   ```jsx
   import React from 'react';
   import { useLiveQuery } from 'dexie-react-hooks';
   import { msme_ledger_db } from '../config/db.js';
   import Button from '../components/common/Button.jsx';
   import EmptyState from '../components/common/EmptyState.jsx';

   export default function MyNewModule() {
     const records = useLiveQuery(() => msme_ledger_db.myStore.toArray()) || [];

     return (
       <div className="space-y-6">
         {/* Follow the tri-color palette strictly */}
         <div className="bg-[#FAF6EE] p-6 rounded-2xl border border-[#E5DCC5]">
           <h3 className="text-base font-bold text-[#141816]">My Module Title</h3>
         </div>
       </div>
     );
   }
   ```

2. **Register in `MODULE_ITEMS` inside `src/components/common/AppShell.jsx`:**
   ```jsx
   {
     id: 'my_module',
     label: 'My Module',
     description: 'Helpful description for merchant',
     icon: <MySvgIcon />
   }
   ```

3. **Mount in `src/App.jsx`:**
   Add `my_module` to the `renderModule()` switch statement.

---

### Recipe B: How to Write an Atomic SAGA with Compensation

When executing writes across multiple tables or databases:

```javascript
import { msme_ledger_db, sb_db } from '../config/db.js';

export async function executeAtomicOperation(data) {
  const operationId = crypto.randomUUID();
  let targetCommitted = false;

  try {
    // Phase 1: Write to target store
    await msme_ledger_db.sales.add({
      id: operationId,
      ...data,
      sync_status: 'pending'
    });
    targetCommitted = true;

    // Phase 2: Write to operational store
    await sb_db.stockMovements.add({
      id: crypto.randomUUID(),
      saleId: operationId,
      quantityDelta: -data.quantity
    });

    return { success: true, operationId };
  } catch (err) {
    // Compensation Phase: If Phase 1 succeeded but Phase 2 crashed, rollback Phase 1!
    if (targetCommitted) {
      try {
        await msme_ledger_db.sales.delete(operationId);
      } catch (compensationErr) {
        throw new Error(`COMPENSATION_FAILED: ${compensationErr.message}`);
      }
    }
    throw err;
  }
}
```

---

### Recipe C: How to Add an Authenticated Backend API

1. **Define the Route in `server/src/routes/`:**
   ```javascript
   import { Router } from 'express';
   import { authenticateToken } from '../middleware/authMiddleware.js';
   import { requireTenantContext } from '../middleware/tenantMiddleware.js';

   const router = Router();

   router.post(
     '/api/v2/my-resource',
     authenticateToken,
     requireTenantContext,
     async (req, res) => {
       const { businessId, user } = req;
       // Query must ALWAYS be tenant-scoped
       const result = await MyModel.create({ ...req.body, businessId, createdBy: user.id });
       return res.status(201).json({ success: true, data: result });
     }
   );

   export default router;
   ```

---

### Recipe D: How to Write a Vitest Test Case

Create `src/test/my_feature.test.jsx`:
```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MyComponent from '../components/MyComponent.jsx';

describe('My Feature Suite', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders correctly and performs user action', async () => {
    render(<MyComponent />);
    expect(screen.getByText('Expected Title')).toBeDefined();

    const button = screen.getByRole('button', { name: /Submit/i });
    fireEvent.click(button);

    expect(screen.getByText('Success Message')).toBeDefined();
  });
});
```

---

## 4. Git Branching & Contribution Workflow

We follow standard Trunk-Based Development with feature branches:

```
main (Protected, always releasable)
  │
  ├── feature/pos-barcode-scanner (Branch from main)
  ├── fix/cart-mobile-clipping     (Branch from main)
  └── chore/update-deps            (Branch from main)
```

### Step 1: Create a Branch
```bash
git checkout main
git pull origin main
git checkout -b feature/your-ticket-name
```

### Step 2: Implement & Test
Make your changes following the rules above. Verify that tests pass and the production build compiles:
```bash
# 1. Run the test suite
npm test

# 2. Verify Vite production build
npm run build
```

### Step 3: Commit Using Conventional Commits
```bash
git add .
git commit -m "feat(pos): add camera barcode scanner modal"
```

Common commit prefixes:
- `feat(...)`: A new user-facing feature or enhancement.
- `fix(...)`: A bug fix or reliability correction.
- `test(...)`: Adding or updating test suites.
- `refactor(...)`: Code change that neither fixes a bug nor adds a feature.
- `docs(...)`: Updating documentation or markdown specifications.

### Step 4: Push & Open Pull Request
```bash
git push -u origin feature/your-ticket-name
```

---

## 5. Pre-Merge Pull Request Checklist

Before submitting a Pull Request for review, verify every item below:

- [ ] **Tests Pass:** Ran `npm test` locally; all 25 test suites (383+ tests) pass with zero errors.
- [ ] **Build Compiles:** Ran `npm run build`; Vite builds cleanly with zero syntax errors.
- [ ] **Color Palette Checked:** Used strictly Forest Green, Sand/Cream, and Charcoal (no blue/purple utility classes).
- [ ] **No Emojis:** Verified no emojis were added in headings, buttons, or toast messages.
- [ ] **Mobile Responsive:** Checked view at screen width `375px` (iPhone SE) and verified tables scroll horizontally without squashing text.
- [ ] **Integer Kobo:** All currency inputs and storage use Integer Kobo.
- [ ] **Offline Resilience:** Disconnected internet in Chrome DevTools ("Offline") and verified the flow still works.
