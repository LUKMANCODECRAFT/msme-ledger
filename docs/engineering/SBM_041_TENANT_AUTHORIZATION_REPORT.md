# SBM-041: Tenant Context, Authorization Middleware & Safe Membership Migration Report

**Date:** 2026-11-17  
**Repository:** `https://github.com/LUKMANCODECRAFT/msme-ledger`  
**Target Branch:** `main`  
**Synchronization Branch:** `feature/phase-4-1a-auth-foundations`  
**Authoritative Specifications:** `SB_Manager_Rebuild_Blueprint_v2.1.md` (Sections 14.3 & 23) and `Phase_4_Architecture_and_Implementation_Plan.md`.

---

## 1. Executive Summary

Workstream C (SBM-041) delivers tenant context resolution, authorization middleware, append-only administrative audit logging, and an expand-and-contract membership migration engine for MSME Ledger.

The implementation guarantees complete tenant isolation:
- Every tenant request is strictly tied to a database-verified `Membership` record.
- Parameter pollution and identifier forgery in request payloads/query strings are strictly rejected.
- Self-approval by administrators on sensitive operations is strictly blocked.
- Legacy user-shop associations are safely migrated through an expand-and-contract pipeline that isolates conflicting memberships into quarantine with zero silent data loss.

All 18 tests in [sbm_041_tenant_authorization.test.js](file:///c:/Users/HomePC/LCC/msme-ledger-main/msme-ledger-main/src/test/sbm_041_tenant_authorization.test.js) passed, and the complete test suite (21 files, 345 tests) passed 100% green.

---

## 2. Architecture & Components

### 2.1 Tenant Middleware (`server/src/middleware/tenantMiddleware.js`)
- **Resolution Strategy:**
  1. Inspects `X-Business-ID` header.
  2. Falls back to `req.user.defaultBusinessId` if header is omitted.
  3. Rejects with 403 `FORBIDDEN_TENANT_ACCESS` if no business identifier is provided or accessible.
- **Parameter Pollution & Forgery Defense:**
  - Detects if `req.body.businessId`, `req.body.shopId`, `req.query.businessId`, or `req.query.shopId` conflicts with the resolved `businessId`.
  - Rejects conflicting requests immediately with 403 `FORBIDDEN_TENANT_MISMATCH`.
  - Sanitizes `req.body.businessId` and `req.query.businessId` to match the cryptographically verified tenant ID.
- **Membership Verification:**
  - Queries `Membership.findOne({ userId: req.user.id, businessId })`.
  - Blocks requests with 403 `FORBIDDEN_TENANT_ACCESS` if no active membership exists.
  - Rejects with 403 `FORBIDDEN_MEMBERSHIP_REVOKED` if membership status is `'revoked'` or `'suspended'`.
- **Tenant Context Attachment:**
  - Attaches immutable `req.tenant = Object.freeze({ businessId, role, membershipId })`.

### 2.2 Role Guards & Self-Approval Prevention
- **`requireTenantRole(allowedRoles)`:**
  - Enforces role boundaries (`owner`, `manager`, `cashier`).
  - Rejects unauthorized roles with 403 `FORBIDDEN_INSUFFICIENT_ROLE`.
- **`preventSelfApproval(options)`:**
  - Enforces administrative separation of duties.
  - Strictly prevents an actor from approving their own payment proofs, subscription activations, or role elevations (403 `FORBIDDEN_SELF_APPROVAL`).

### 2.3 Append-Only Audit Logging (`server/src/services/auditLogService.js`)
- **Schema:** [auditLogModel.js](file:///c:/Users/HomePC/LCC/msme-ledger-main/msme-ledger-main/server/src/models/target/auditLogModel.js).
- **Invariants:**
  - Append-only immutable log: updates and deletions are disabled.
  - Records `actorId`, `actorRole`, `businessId`, `action`, `targetType`, `targetId`, lossless `metadata`, `ipAddress`, and `timestamp`.
  - Indexed by `(businessId, timestamp)` and `(actorId, timestamp)` for forensic auditability.

### 2.4 Expand-and-Contract Membership Migration (`src/domain/migration/membershipMigrator.js`)
- **Phase 1 (Expand):**
  - Ingests legacy user-shop associations.
  - Normalizes legacy roles (`admin` -> `owner`, `master` -> `owner`, `staff` -> `cashier`).
  - Quarantine on Conflict: When duplicate records for the same `(userId, businessId)` pair contain conflicting roles, neither is guessed or overwritten; the conflict is safely isolated into the `migrationQuarantine` store (`DUPLICATE_MEMBERSHIP_CONFLICT`).
  - Quarantine on Incomplete Identity: Records lacking valid `userId` or `businessId` are quarantined with `MISSING_USER_ID` or `MISSING_BUSINESS_ID`.
- **Phase 2 (Contract & Invariant Verification):**
  - Enforces the business owner invariant: every business must retain at least one active `owner` membership.
  - Invariant breaches are quarantined with `BUSINESS_LACKS_OWNER_INVARIANT_VIOLATION`.
  - Durable checkpoints (`memberships_expanded`, `memberships_contracted`) recorded at stage completion.

---

## 3. Verification & Test Matrix

| Component | Test File | Tests | Result |
| :--- | :--- | :--- | :--- |
| Tenant Context & Role Guards | `sbm_041_tenant_authorization.test.js` | 10 | PASS |
| Self-Approval & Platform Boundary | `sbm_041_tenant_authorization.test.js` | 2 | PASS |
| Append-Only Audit Log | `sbm_041_tenant_authorization.test.js` | 1 | PASS |
| Membership Migrator | `sbm_041_tenant_authorization.test.js` | 5 | PASS |
| Regression Test Suite | Full suite (21 files) | 345 | PASS |
| Vite Production Build | - | - | PASS (1.40s) |

---

## 4. File Modification Summary

- `server/src/models/target/auditLogModel.js`: Immutable audit log schema with Mongoose cache guard.
- `server/src/models/target/index.js`: Exported `AuditLog` target model.
- `server/src/services/auditLogService.js`: Append-only audit logging service.
- `server/src/middleware/tenantMiddleware.js`: Tenant resolution, parameter pollution defense, role guards, and self-approval prevention.
- `src/domain/migration/membershipMigrator.js`: Expand-and-contract membership migration engine.
- `src/test/sbm_041_tenant_authorization.test.js`: Comprehensive 18-test authorization suite.
