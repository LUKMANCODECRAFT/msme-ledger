/**
 * Durable Migration Checkpoint Manager — SB Manager (SBM-030-C & SBM-030-D)
 * 
 * Manages stage progress, resumption points, and idempotency states
 * within the destination database's `migrationCheckpoints` store.
 * Enforces migration version validation to prevent silent invalid re-execution.
 */

export const CURRENT_MIGRATION_VERSION = 1;

export const MIGRATION_STAGES = Object.freeze([
  'source_inspection',
  'business_identity',
  'customers_and_debt',
  'inventory_and_stock',
  'sales_and_history',
  'reconciliation'
]);

export class MigrationVersionMismatchError extends Error {
  constructor(stage, recordedVersion, currentVersion) {
    super(
      `Migration version mismatch for stage "${stage}": checkpoint recorded version ${recordedVersion}, but engine requires version ${currentVersion}. Incompatible checkpoint cannot be safely reused. Explicit reset or migration upgrade is required.`
    );
    this.name = 'MigrationVersionMismatchError';
    this.stage = stage;
    this.recordedVersion = recordedVersion;
    this.currentVersion = currentVersion;
  }
}

export class MigrationCheckpointManager {
  /**
   * @param {Dexie} targetDb - Target Dexie instance (e.g. sb_db)
   * @param {string} [migrationRunId]
   * @param {number} [migrationVersion=CURRENT_MIGRATION_VERSION]
   */
  constructor(targetDb, migrationRunId = `run_${Date.now()}`, migrationVersion = CURRENT_MIGRATION_VERSION) {
    if (!targetDb || !targetDb.migrationCheckpoints) {
      throw new TypeError('Target database must provide a migrationCheckpoints store.');
    }
    this.targetDb = targetDb;
    this.migrationRunId = migrationRunId;
    this.migrationVersion = migrationVersion;
  }

  /**
   * Reads an existing checkpoint for a stage.
   * @param {string} stage
   * @returns {Promise<Object|null>}
   */
  async getCheckpoint(stage) {
    const cp = await this.targetDb.migrationCheckpoints.get(stage);
    return cp || null;
  }

  /**
   * Checks whether a stage has already completed successfully under the current version.
   * Throws MigrationVersionMismatchError if a version incompatibility is detected.
   * 
   * @param {string} stage
   * @returns {Promise<boolean>}
   */
  async isStageCompleted(stage) {
    const cp = await this.getCheckpoint(stage);
    if (!cp) return false;

    if (typeof cp.migrationVersion === 'number' && cp.migrationVersion !== this.migrationVersion) {
      throw new MigrationVersionMismatchError(stage, cp.migrationVersion, this.migrationVersion);
    }

    return cp.status === 'completed';
  }

  /**
   * Initializes or resumes a stage checkpoint.
   * Verifies version compatibility before returning an existing completed stage.
   * 
   * @param {string} stage
   * @param {number} totalRecords
   * @returns {Promise<Object>}
   */
  async startStage(stage, totalRecords = 0) {
    const existing = await this.getCheckpoint(stage);

    if (existing) {
      if (typeof existing.migrationVersion === 'number' && existing.migrationVersion !== this.migrationVersion) {
        throw new MigrationVersionMismatchError(stage, existing.migrationVersion, this.migrationVersion);
      }
      if (existing.status === 'completed') {
        return existing; // Already complete under matching version
      }
    }

    const checkpoint = {
      stage,
      migrationRunId: this.migrationRunId,
      sourceVersion: 2,
      migrationVersion: this.migrationVersion,
      status: 'in_progress',
      totalRecords,
      processedRecords: existing?.processedRecords || 0,
      successfulRecords: existing?.successfulRecords || 0,
      skippedRecords: existing?.skippedRecords || 0,
      quarantinedRecords: existing?.quarantinedRecords || 0,
      failedRecords: existing?.failedRecords || 0,
      lastProcessedId: existing?.lastProcessedId || null,
      startedAt: existing?.startedAt || new Date().toISOString(),
      completedAt: null,
      errorDetails: null
    };

    await this.targetDb.migrationCheckpoints.put(checkpoint);
    return checkpoint;
  }

  /**
   * Updates progress for an in-flight stage.
   * @param {string} stage
   * @param {Object} metrics
   */
  async updateProgress(stage, metrics = {}) {
    const existing = await this.getCheckpoint(stage);
    if (!existing) return;

    const updated = {
      ...existing,
      ...metrics,
      stage, // Ensure stage PK is preserved
      migrationVersion: this.migrationVersion,
      updatedAt: new Date().toISOString()
    };

    await this.targetDb.migrationCheckpoints.put(updated);
    return updated;
  }

  /**
   * Marks a stage as successfully completed.
   * @param {string} stage
   * @param {Object} [finalMetrics={}]
   */
  async completeStage(stage, finalMetrics = {}) {
    const existing = await this.getCheckpoint(stage);
    const completed = {
      ...existing,
      ...finalMetrics,
      stage,
      migrationVersion: this.migrationVersion,
      status: 'completed',
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await this.targetDb.migrationCheckpoints.put(completed);
    return completed;
  }

  /**
   * Records a stage failure with sanitized error information.
   * @param {string} stage
   * @param {Error|Object|string} error
   */
  async failStage(stage, error) {
    const existing = await this.getCheckpoint(stage);
    const failed = {
      ...existing,
      stage,
      migrationRunId: this.migrationRunId,
      migrationVersion: this.migrationVersion,
      status: 'failed',
      errorDetails: {
        message: typeof error === 'object' && error !== null ? error.message || String(error) : String(error),
        name: typeof error === 'object' && error !== null ? error.name || 'Error' : 'Error'
      },
      updatedAt: new Date().toISOString()
    };

    await this.targetDb.migrationCheckpoints.put(failed);
    return failed;
  }

  /**
   * Explicitly resets a checkpoint for a given stage, enabling clean restart.
   * @param {string} stage
   */
  async resetCheckpoint(stage) {
    await this.targetDb.migrationCheckpoints.delete(stage);
  }

  /**
   * Resets all migration checkpoints.
   */
  async resetAllCheckpoints() {
    await this.targetDb.migrationCheckpoints.clear();
  }
}
