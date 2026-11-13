/**
 * Migration Quarantine Engine — SB Manager (SBM-030-A)
 * 
 * Safely isolates records that cannot be normalized or migrated with 100% confidence.
 * Guarantees that no data is silently dropped, altered, or guessed.
 * 
 * Storage: Dedicated Dexie table `migrationQuarantine` in destination database.
 * Indexes: quarantineId (PK), migrationRunId, sourceEntity, sourceId, resolutionStatus, detectedAt
 */

export class MigrationQuarantineManager {
  /**
   * @param {string} migrationRunId
   */
  constructor(migrationRunId = `run_${Date.now()}`) {
    this.migrationRunId = migrationRunId;
    this.quarantinedRecords = [];
    this._seenKeys = new Map(); // Tracks `sourceEntity:sourceId` -> in-memory record
  }

  /**
   * Adds an unresolved record to the quarantine collection with deterministic identity.
   * 
   * @param {Object} params
   * @param {'customers'|'inventory'|'sales'|'transactions'} params.sourceEntity
   * @param {string} params.sourceId
   * @param {Object} params.rawRecord - Lossless raw legacy record
   * @param {string} params.reason - Explicit reason code
   * @param {Array<string>} [params.validationErrors=[]]
   * @returns {Object} The created or updated quarantine record
   */
  quarantineRecord({
    sourceEntity,
    sourceId,
    rawRecord,
    reason,
    validationErrors = []
  }) {
    if (!sourceEntity || !sourceId || !rawRecord || !reason) {
      throw new TypeError('Missing required parameters for quarantineRecord.');
    }

    const key = `${sourceEntity}:${sourceId}`;
    const quarantineId = `quar_${sourceEntity}_${sourceId}`;

    // Deterministic deduplication within the same in-memory run
    if (this._seenKeys.has(key)) {
      const existing = this._seenKeys.get(key);
      // Merge unique validation errors
      const combinedErrors = Array.from(new Set([...existing.validationErrors, ...validationErrors]));
      existing.validationErrors = combinedErrors;
      if (reason && !existing.reason.includes(reason)) {
        existing.reason = `${existing.reason}; ${reason}`;
      }
      return existing;
    }

    const record = {
      quarantineId,
      migrationRunId: this.migrationRunId,
      sourceEntity,
      sourceId: String(sourceId),
      rawRecord: structuredClone(rawRecord),
      reason,
      validationErrors: [...validationErrors],
      detectedAt: new Date().toISOString(),
      resolutionStatus: 'unresolved',
      resolutionHistory: []
    };

    this.quarantinedRecords.push(record);
    this._seenKeys.set(key, record);
    return record;
  }

  /**
   * Returns all quarantined records for a given source entity.
   * @param {string} [sourceEntity]
   * @returns {Array<Object>}
   */
  getQuarantined(sourceEntity) {
    if (sourceEntity) {
      return this.quarantinedRecords.filter(r => r.sourceEntity === sourceEntity);
    }
    return [...this.quarantinedRecords];
  }

  /**
   * Returns total count of quarantined records.
   * @returns {number}
   */
  getCount() {
    return this.quarantinedRecords.length;
  }

  /**
   * Persists all quarantined records to the dedicated `migrationQuarantine` table.
   * Preserves existing resolution status and resolution history across retries.
   * 
   * @param {Dexie} targetDb - Target Dexie instance (e.g. sb_db)
   */
  async persistQuarantine(targetDb) {
    if (!targetDb || !targetDb.migrationQuarantine) {
      throw new TypeError('Valid target database with migrationQuarantine store required.');
    }

    for (const record of this.quarantinedRecords) {
      const existing = await targetDb.migrationQuarantine.get(record.quarantineId);

      if (existing) {
        // Preserve prior resolution status and history across migration retries/runs
        const mergedRecord = {
          ...record,
          detectedAt: existing.detectedAt || record.detectedAt,
          resolutionStatus: existing.resolutionStatus || record.resolutionStatus,
          resolutionHistory: existing.resolutionHistory || record.resolutionHistory,
          validationErrors: Array.from(new Set([...(existing.validationErrors || []), ...record.validationErrors])),
          updatedAt: new Date().toISOString()
        };
        await targetDb.migrationQuarantine.put(mergedRecord);
      } else {
        await targetDb.migrationQuarantine.put({
          ...record,
          updatedAt: new Date().toISOString()
        });
      }
    }
  }

  /**
   * Loads persisted quarantine records from the dedicated `migrationQuarantine` store.
   * Supports querying by sourceEntity, resolutionStatus, migrationRunId, or quarantineId.
   * 
   * @param {Dexie} targetDb
   * @param {Object} [filter={}]
   * @returns {Promise<Array<Object>|Object|null>}
   */
  static async loadPersistedQuarantine(targetDb, filter = {}) {
    if (!targetDb || !targetDb.migrationQuarantine) return [];

    if (filter.quarantineId) {
      const item = await targetDb.migrationQuarantine.get(filter.quarantineId);
      return item || null;
    }

    if (filter.sourceEntity) {
      return await targetDb.migrationQuarantine
        .where('sourceEntity')
        .equals(filter.sourceEntity)
        .toArray();
    }

    if (filter.resolutionStatus) {
      return await targetDb.migrationQuarantine
        .where('resolutionStatus')
        .equals(filter.resolutionStatus)
        .toArray();
    }

    if (filter.migrationRunId) {
      return await targetDb.migrationQuarantine
        .where('migrationRunId')
        .equals(filter.migrationRunId)
        .toArray();
    }

    return await targetDb.migrationQuarantine.toArray();
  }

  /**
   * Resolves a single quarantine record, appending to its audit history.
   * Resolution updates affect ONLY the targeted record.
   * 
   * @param {Dexie} targetDb
   * @param {string} quarantineId
   * @param {Object} resolution
   * @param {'resolved'|'ignored'|'manually_adjusted'} resolution.resolutionStatus
   * @param {string} [resolution.resolvedBy='operator']
   * @param {string} [resolution.notes='']
   * @param {any} [resolution.resolvedPayload=null]
   * @returns {Promise<Object>} Updated quarantine record
   */
  static async resolveQuarantine(targetDb, quarantineId, {
    resolutionStatus = 'resolved',
    resolvedBy = 'operator',
    notes = '',
    resolvedPayload = null
  } = {}) {
    if (!targetDb || !targetDb.migrationQuarantine) {
      throw new TypeError('Valid target database with migrationQuarantine store required.');
    }
    if (!quarantineId) {
      throw new TypeError('quarantineId is required.');
    }

    const record = await targetDb.migrationQuarantine.get(quarantineId);
    if (!record) {
      throw new Error(`Quarantine record not found for ID: "${quarantineId}".`);
    }

    const previousStatus = record.resolutionStatus;
    const historyEntry = {
      timestamp: new Date().toISOString(),
      previousStatus,
      newStatus: resolutionStatus,
      resolvedBy,
      notes,
      resolvedPayload: resolvedPayload ? structuredClone(resolvedPayload) : null
    };

    record.resolutionStatus = resolutionStatus;
    record.resolutionHistory = Array.isArray(record.resolutionHistory)
      ? [...record.resolutionHistory, historyEntry]
      : [historyEntry];
    record.resolvedAt = new Date().toISOString();
    record.updatedAt = new Date().toISOString();

    await targetDb.migrationQuarantine.put(record);
    return record;
  }
}
