/**
 * Append-Only Audit Logging Service
 * Conforms to SBM-041 and Blueprint v2.1 Section 23.
 * 
 * Enforces strictly append-only persistence of administrative mutations,
 * membership updates, and security-critical operational events.
 */

import crypto from 'crypto';
import { AuditLog } from '../models/target/auditLogModel.js';

export class AuditLogService {
  /**
   * @param {Object} [options]
   * @param {import('mongoose').Model} [options.auditModel]
   */
  constructor(options = {}) {
    this.AuditModel = options.auditModel || AuditLog;
  }

  /**
   * Records an immutable audit event.
   * 
   * @param {Object} event
   * @param {string} event.actorId - ID of user or admin initiating action
   * @param {string} event.actorRole - Role of initiating actor
   * @param {string} event.businessId - Target tenant business UUID
   * @param {string} event.action - Explicit action identifier
   * @param {string} event.targetType - Type of target entity (e.g. membership, subscription)
   * @param {string} event.targetId - ID of target entity
   * @param {Object} [event.metadata] - Lossless structured context
   * @param {string} [event.ipAddress] - IP address of caller
   * @returns {Promise<Object>} Created audit log entry
   */
  async recordEvent({
    actorId,
    actorRole,
    businessId,
    action,
    targetType,
    targetId,
    metadata = {},
    ipAddress = null
  }) {
    if (!actorId || typeof actorId !== 'string') {
      throw new TypeError('actorId is required and must be a string.');
    }
    if (!actorRole || typeof actorRole !== 'string') {
      throw new TypeError('actorRole is required and must be a string.');
    }
    if (!businessId || typeof businessId !== 'string') {
      throw new TypeError('businessId is required and must be a string.');
    }
    if (!action || typeof action !== 'string') {
      throw new TypeError('action is required and must be a string.');
    }
    if (!targetType || typeof targetType !== 'string') {
      throw new TypeError('targetType is required and must be a string.');
    }
    if (!targetId || typeof targetId !== 'string') {
      throw new TypeError('targetId is required and must be a string.');
    }

    const auditEntry = new this.AuditModel({
      id: crypto.randomUUID(),
      actorId,
      actorRole,
      businessId,
      action,
      targetType,
      targetId,
      metadata: Object.freeze({ ...metadata }),
      ipAddress,
      timestamp: new Date()
    });

    await auditEntry.save();
    return auditEntry;
  }

  /**
   * Retrieves audit events for a business (read-only for owners).
   * 
   * @param {string} businessId
   * @param {Object} [options]
   * @param {number} [options.limit=50]
   * @returns {Promise<Array>}
   */
  async getEventsByBusiness(businessId, { limit = 50 } = {}) {
    if (!businessId) {
      throw new TypeError('businessId is required.');
    }
    return this.AuditModel.find({ businessId })
      .sort({ timestamp: -1 })
      .limit(limit);
  }
}

export const defaultAuditLogService = new AuditLogService();
