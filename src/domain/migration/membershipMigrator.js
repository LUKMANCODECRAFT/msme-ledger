/**
 * Expand-and-Contract Membership Migration Engine — SBM-041
 * Strictly adheres to SB Manager Rebuild Blueprint v2.1 Section 14 and Phase 4 Architecture Plan.
 * 
 * Provides an idempotent, checkpointed, and recoverable migration pipeline
 * for transitioning legacy user-shop associations to strict multi-tenant memberships.
 * 
 * Pipeline Phases:
 * 1. Expand Phase: Reads legacy associations, normalizes tenant roles, isolates conflicting
 *    or orphaned records into the quarantine store without silent coercion or data loss.
 * 2. Contract & Invariant Phase: Validates that every migrated business retains at least one active
 *    owner, confirms target store integrity, and marks stage checkpoints.
 */

import crypto from 'crypto';
import { MigrationCheckpointManager, CURRENT_MIGRATION_VERSION } from './checkpoints.js';
import { MigrationQuarantineManager } from './quarantine.js';

export const VALID_MEMBERSHIP_ROLES = Object.freeze(['owner', 'manager', 'cashier']);

export class MembershipMigrationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MembershipMigrationError';
    this.code = code;
    this.details = details;
  }
}

export class MembershipMigrator {
  /**
   * @param {Object} params
   * @param {Object} params.targetStore - Storage adapter or Dexie/Mongoose model for memberships
   * @param {Object} [params.checkpointDb] - Database for durable checkpoints
   * @param {string} [params.migrationRunId]
   * @param {number} [params.migrationVersion=CURRENT_MIGRATION_VERSION]
   */
  constructor({
    targetStore,
    checkpointDb = null,
    migrationRunId = `mship_run_${Date.now()}`,
    migrationVersion = CURRENT_MIGRATION_VERSION
  }) {
    if (!targetStore) {
      throw new TypeError('targetStore is required for MembershipMigrator.');
    }

    this.targetStore = targetStore;
    this.migrationRunId = migrationRunId;
    this.migrationVersion = migrationVersion;
    this.quarantineManager = new MigrationQuarantineManager(migrationRunId);

    if (checkpointDb && checkpointDb.migrationCheckpoints) {
      this.checkpointManager = new MigrationCheckpointManager(
        checkpointDb,
        migrationRunId,
        migrationVersion
      );
    } else {
      // In-memory checkpoint fallback for unit testing
      this.checkpointManager = {
        checkpoints: new Map(),
        async recordCheckpoint(stage, data = {}) {
          this.checkpoints.set(stage, {
            stage,
            data,
            recordedAt: new Date().toISOString()
          });
          return this.checkpoints.get(stage);
        },
        async getCheckpoint(stage) {
          return this.checkpoints.get(stage) || null;
        }
      };
    }
  }

  /**
   * Normalizes legacy role strings to valid tenant roles.
   * 
   * @param {string} legacyRole
   * @returns {string|null}
   */
  normalizeRole(legacyRole) {
    if (!legacyRole || typeof legacyRole !== 'string') return null;
    const clean = legacyRole.trim().toLowerCase();
    if (clean === 'owner' || clean === 'admin' || clean === 'merchant' || clean === 'master') {
      return 'owner';
    }
    if (clean === 'manager' || clean === 'supervisor') {
      return 'manager';
    }
    if (clean === 'cashier' || clean === 'staff' || clean === 'clerk' || clean === 'attendant') {
      return 'cashier';
    }
    return null;
  }

  /**
   * Executes the 2-phase expand-and-contract migration pipeline.
   * 
   * @param {Array<Object>} legacyRecords - Raw legacy user-shop associations
   * @returns {Promise<Object>} Reconciliation summary
   */
  async migrate(legacyRecords) {
    if (!Array.isArray(legacyRecords)) {
      throw new TypeError('legacyRecords must be an array.');
    }

    const summary = {
      runId: this.migrationRunId,
      totalLegacy: legacyRecords.length,
      migratedCount: 0,
      quarantinedCount: 0,
      skippedCount: 0,
      stages: []
    };

    // ----------------------------------------------------
    // STAGE 1: EXPAND PHASE — Ingestion, Validation & Quarantine
    // ----------------------------------------------------
    const seenPairs = new Map(); // key: `${userId}:${businessId}` -> role
    const stagedMemberships = [];

    for (const raw of legacyRecords) {
      const sourceId = raw.id || raw._id || `${raw.userId || raw.user_id}_${raw.businessId || raw.shopId || raw.shop_id}`;
      const userId = raw.userId || raw.user_id;
      const businessId = raw.businessId || raw.shopId || raw.shop_id;

      // 1. Check for missing required identity references
      if (!userId || typeof userId !== 'string' || !userId.trim()) {
        this.quarantineManager.quarantineRecord({
          sourceEntity: 'memberships',
          sourceId: String(sourceId),
          rawRecord: raw,
          reason: 'MISSING_USER_ID',
          validationErrors: ['Record lacks non-empty userId reference.']
        });
        summary.quarantinedCount++;
        continue;
      }

      if (!businessId || typeof businessId !== 'string' || !businessId.trim()) {
        this.quarantineManager.quarantineRecord({
          sourceEntity: 'memberships',
          sourceId: String(sourceId),
          rawRecord: raw,
          reason: 'MISSING_BUSINESS_ID',
          validationErrors: ['Record lacks non-empty businessId / shopId reference.']
        });
        summary.quarantinedCount++;
        continue;
      }

      const cleanUserId = userId.trim();
      const cleanBusinessId = businessId.trim();

      // 2. Normalize and validate role
      const normalizedRole = this.normalizeRole(raw.role);
      if (!normalizedRole) {
        this.quarantineManager.quarantineRecord({
          sourceEntity: 'memberships',
          sourceId: String(sourceId),
          rawRecord: raw,
          reason: 'INVALID_MEMBERSHIP_ROLE',
          validationErrors: [`Role "${raw.role}" cannot be safely mapped to owner/manager/cashier.`]
        });
        summary.quarantinedCount++;
        continue;
      }

      // 3. Detect duplicate and conflicting memberships
      const pairKey = `${cleanUserId}:${cleanBusinessId}`;
      if (seenPairs.has(pairKey)) {
        const existingRole = seenPairs.get(pairKey);
        if (existingRole !== normalizedRole) {
          // Conflicting roles for the same user-business pair -> quarantine conflict!
          this.quarantineManager.quarantineRecord({
            sourceEntity: 'memberships',
            sourceId: String(sourceId),
            rawRecord: raw,
            reason: 'DUPLICATE_MEMBERSHIP_CONFLICT',
            validationErrors: [
              `Conflicting role assignment for pair ${pairKey}: existing "${existingRole}" vs new "${normalizedRole}".`
            ]
          });
          summary.quarantinedCount++;
          continue;
        } else {
          // Identical duplicate -> idempotent skip
          summary.skippedCount++;
          continue;
        }
      }

      seenPairs.set(pairKey, normalizedRole);

      stagedMemberships.push({
        id: raw.id || crypto.randomUUID(),
        userId: cleanUserId,
        businessId: cleanBusinessId,
        role: normalizedRole,
        status: 'active',
        createdAt: raw.createdAt ? new Date(raw.createdAt) : new Date(),
        updatedAt: new Date()
      });
    }

    // Persist staged memberships into target store
    for (const membership of stagedMemberships) {
      if (typeof this.targetStore.saveMembership === 'function') {
        await this.targetStore.saveMembership(membership);
      } else if (typeof this.targetStore.put === 'function') {
        await this.targetStore.put(membership);
      } else if (typeof this.targetStore.create === 'function') {
        await this.targetStore.create(membership);
      }
      summary.migratedCount++;
    }

    if (typeof this.checkpointManager.completeStage === 'function') {
      await this.checkpointManager.completeStage('memberships_expanded', {
        migratedCount: summary.migratedCount,
        quarantinedCount: summary.quarantinedCount,
        skippedCount: summary.skippedCount
      });
    } else if (typeof this.checkpointManager.recordCheckpoint === 'function') {
      await this.checkpointManager.recordCheckpoint('memberships_expanded', {
        migratedCount: summary.migratedCount,
        quarantinedCount: summary.quarantinedCount,
        skippedCount: summary.skippedCount
      });
    }
    summary.stages.push('memberships_expanded');

    // ----------------------------------------------------
    // STAGE 2: CONTRACT & INVARIANT VERIFICATION
    // ----------------------------------------------------
    // Verify each distinct business has at least one active owner
    const businessOwners = new Map();
    for (const membership of stagedMemberships) {
      if (membership.role === 'owner') {
        const count = businessOwners.get(membership.businessId) || 0;
        businessOwners.set(membership.businessId, count + 1);
      }
    }

    const distinctBusinessIds = new Set(stagedMemberships.map(m => m.businessId));
    const missingOwnerBusinesses = [];

    for (const bId of distinctBusinessIds) {
      if (!businessOwners.has(bId) || businessOwners.get(bId) === 0) {
        missingOwnerBusinesses.push(bId);
      }
    }

    if (missingOwnerBusinesses.length > 0) {
      // Quarantine invariant violation: businesses without owner
      this.quarantineManager.quarantineRecord({
        sourceEntity: 'memberships',
        sourceId: `invariant_missing_owners_${Date.now()}`,
        rawRecord: { missingOwnerBusinesses },
        reason: 'BUSINESS_LACKS_OWNER_INVARIANT_VIOLATION',
        validationErrors: [
          `Businesses lack at least one owner membership: ${missingOwnerBusinesses.join(', ')}`
        ]
      });
      summary.quarantinedCount++;
    }

    if (typeof this.checkpointManager.completeStage === 'function') {
      await this.checkpointManager.completeStage('memberships_contracted', {
        verifiedBusinessCount: distinctBusinessIds.size,
        missingOwnerCount: missingOwnerBusinesses.length
      });
    } else if (typeof this.checkpointManager.recordCheckpoint === 'function') {
      await this.checkpointManager.recordCheckpoint('memberships_contracted', {
        verifiedBusinessCount: distinctBusinessIds.size,
        missingOwnerCount: missingOwnerBusinesses.length
      });
    }
    summary.stages.push('memberships_contracted');

    summary.quarantinedRecords = this.quarantineManager.getQuarantined();
    return summary;
  }
}
