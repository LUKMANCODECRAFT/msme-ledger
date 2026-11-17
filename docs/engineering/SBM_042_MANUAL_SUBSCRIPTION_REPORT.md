# SBM-042: Manual Subscription Pipeline, Offline Entitlement & Anti-Clock-Tampering Report

**Date:** 2026-11-17  
**Repository:** `https://github.com/LUKMANCODECRAFT/msme-ledger`  
**Target Branch:** `main`  
**Synchronization Branch:** `feature/phase-4-1a-auth-foundations`  
**Authoritative Specifications:** `SB_Manager_Rebuild_Blueprint_v2.1.md` (Section 15) and `Phase_4_Architecture_and_Implementation_Plan.md`.

---

## 1. Executive Summary

Workstream D (SBM-042) implements the manual bank-transfer subscription and entitlement architecture for MSME Ledger. The system eliminates third-party payment gateway lock-in, strictly excludes Paystack recurring billing, and implements an auditable manual bank-transfer workflow with cryptographically signed RS256 offline entitlement tokens and anti-clock-tampering protection.

All 15 tests in [sbm_042_manual_subscription.test.js](file:///c:/Users/HomePC/LCC/msme-ledger-main/msme-ledger-main/src/test/sbm_042_manual_subscription.test.js) passed, and the full regression test suite (22 files, 360 tests) passed 100% green.

---

## 2. Architecture & Components

### 2.1 Dynamic Bank Instructions (`GET /api/v2/subscription/instructions`)
- **Controller & Service:** [subscriptionController.js](file:///c:/Users/HomePC/LCC/msme-ledger-main/msme-ledger-main/server/src/controllers/subscriptionController.js) and [subscriptionService.js](file:///c:/Users/HomePC/LCC/msme-ledger-main/msme-ledger-main/server/src/services/subscriptionService.js).
- **Dynamic Configuration:** Bank name, account name, and account number are retrieved dynamically from server configuration. Zero bank details are hardcoded into the client application.
- **Reference Code Generation:** Every request receives a cryptographically generated payment reference (`REF-SB-<randomBytes>`).
- **Approved Tiers & Pricing:** Returns approved subscription plans (`pro`, `enterprise`) with prices in integer Kobo (e.g. 500,000 Kobo = 5,000 NGN).

### 2.2 Payment Proof Submission (`POST /api/v2/subscription/submit`)
- **Tenant Context Required:** Enforced via `createTenantMiddleware`.
- **Integrity Invariants:**
  - Enforces approved plan IDs; unapproved or spoofed recurring plans are strictly rejected.
  - Validates reference code formatting (`REF-SB-[A-Z0-9_-]+`).
  - Enforces reference uniqueness: duplicate reference codes return 409 Conflict.
  - Payment method is strictly `'bank_transfer'`.
  - Default submission status: `'pending_verification'`.
  - Records append-only audit event: `SUBSCRIPTION_PROOF_SUBMITTED`.

### 2.3 Administrative Review & Self-Approval Prevention
- **Pending Review Queue (`GET /api/v2/admin/subscriptions/pending`):** Restricted to platform administrators.
- **Approval / Rejection (`POST /api/v2/admin/subscriptions/:id/review`):**
  - **Self-Approval Guard:** An administrator cannot review or approve their own subscription submissions (403 `FORBIDDEN_SELF_APPROVAL`).
  - **Atomic Approval:**
    - Transitions subscription to `'active'`.
    - Sets `activeFrom: now`, `expiresAt: now + 30 days`, `gracePeriodUntil: expiresAt + 7 days`.
    - Issues an RS256 signed offline entitlement token.
    - Appends an immutable audit event (`SUBSCRIPTION_APPROVED`).
  - **Rejection Handling:**
    - Transitions status to `'rejected'`.
    - Stores rejection reason and logs audit event (`SUBSCRIPTION_REJECTED`).

### 2.4 Offline Entitlement Verification & Anti-Clock-Tampering Engine
- **Module:** [entitlementVerifier.js](file:///c:/Users/HomePC/LCC/msme-ledger-main/msme-ledger-main/src/domain/subscription/entitlementVerifier.js) strictly implementing Blueprint Section 15.2.
- **Anti-Clock-Tampering Guard:** If the device clock is earlier than the last known verified server timestamp (`localClock < lastKnownServerTime`), access is immediately restricted to read-only with status `'clock_tampered_locked'`.
- **Grace Period Engine:** When the subscription expires (`localClock > expiresAt`), if the device clock is within the 7-day grace window (`localClock <= gracePeriodUntil`), the system grants full access with status `'in_grace_period'`.
- **Expired State:** Once the grace period is exceeded, status transitions to `'expired'` with read-only access.

---

## 3. Negative Guarantees & Gateways Excluded

- **No Paystack Recurring Charges:** Zero Paystack API keys, webhooks, or automated card debits are present.
- **No Unapproved Payment Gateways:** All payments operate through verified bank transfer manual review.
- **No Client-Side Secret Keys:** Public keys verify entitlements; private signing keys remain strictly server-side.

---

## 4. Verification & Test Matrix

| Component | Test File | Tests | Result |
| :--- | :--- | :--- | :--- |
| Instructions & Reference Generation | `sbm_042_manual_subscription.test.js` | 1 | PASS |
| Proof Submission & Input Defense | `sbm_042_manual_subscription.test.js` | 4 | PASS |
| Administrative Review & Self-Approval | `sbm_042_manual_subscription.test.js` | 3 | PASS |
| Offline Verification & Anti-Clock-Tampering | `sbm_042_manual_subscription.test.js` | 5 | PASS |
| HTTP Controller Integration | `sbm_042_manual_subscription.test.js` | 2 | PASS |
| Complete Regression Suite | Full suite (22 files) | 360 | PASS |
| Vite Production Build | - | - | PASS (1.37s) |

---

## 5. File Modification Summary

- `server/src/models/target/subscriptionModel.js`: Subscription persistence model.
- `server/src/models/target/index.js`: Exported `Subscription` model.
- `server/src/services/subscriptionService.js`: Dynamic instructions, proof submission, review lifecycle, and RS256 token issuance.
- `server/src/controllers/subscriptionController.js`: Express handlers for subscription workflows.
- `server/src/routes/subscriptionRoutes.js`: Express router for merchant and admin subscription endpoints.
- `src/domain/subscription/entitlementVerifier.js`: Offline verification with anti-clock-tampering protection.
- `src/test/sbm_042_manual_subscription.test.js`: 15-test verification suite.
