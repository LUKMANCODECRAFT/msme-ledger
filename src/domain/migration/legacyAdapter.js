/**
 * Legacy Database Read-Only Migration Adapter — SB Manager (SBM-030-B)
 * 
 * Provides a strictly read-only, lifecycle-safe interface to the legacy msme_ledger_db.
 * Design Guarantees:
 * 1. Uses JavaScript private class field (#db) to strictly prevent leaking the raw Dexie instance.
 * 2. Does NOT expose any database lifecycle methods (delete, version, open, close).
 * 3. Does NOT permit write transactions or table-level mutations.
 * 4. Exposes only typed, read-only extraction queries.
 * 5. Returns deep clones via structuredClone() to guarantee immutable records.
 * 6. Uses dependency injection to enable fully isolated testing.
 */

export class LegacyReadOnlyAdapter {
  #db;

  /**
   * @param {Object} legacyDb - The legacy Dexie instance (e.g. msme_ledger_db)
   */
  constructor(legacyDb) {
    if (!legacyDb || typeof legacyDb.table !== 'function') {
      throw new TypeError('LegacyReadOnlyAdapter requires a valid Dexie database instance.');
    }
    // Strictly encapsulated private field — inaccessible from outside the class
    this.#db = legacyDb;
  }

  /**
   * Inspects source database metadata and record counts.
   * @returns {Promise<Object>}
   */
  async inspectSource() {
    const tableNames = this.#db.tables.map(t => t.name);
    const counts = {};

    for (const name of tableNames) {
      counts[name] = await this.#db.table(name).count();
    }

    return {
      databaseName: this.#db.name,
      version: this.#db.verno,
      tables: tableNames,
      counts
    };
  }

  /**
   * Fetches all legacy customer records.
   * @param {Object} [options]
   * @param {number} [options.limit]
   * @param {number} [options.offset]
   * @returns {Promise<Array<Object>>}
   */
  async fetchCustomers({ limit, offset = 0 } = {}) {
    let collection = this.#db.table('customers').offset(offset);
    if (typeof limit === 'number') {
      collection = collection.limit(limit);
    }
    const records = await collection.toArray();
    // Return deep clones to prevent any in-memory mutation of Dexie cache
    return records.map(r => structuredClone(r));
  }

  /**
   * Fetches all legacy inventory records.
   * @param {Object} [options]
   * @param {number} [options.limit]
   * @param {number} [options.offset]
   * @returns {Promise<Array<Object>>}
   */
  async fetchInventory({ limit, offset = 0 } = {}) {
    let collection = this.#db.table('inventory').offset(offset);
    if (typeof limit === 'number') {
      collection = collection.limit(limit);
    }
    const records = await collection.toArray();
    return records.map(r => structuredClone(r));
  }

  /**
   * Fetches all legacy sales records.
   * @param {Object} [options]
   * @param {number} [options.limit]
   * @param {number} [options.offset]
   * @returns {Promise<Array<Object>>}
   */
  async fetchSales({ limit, offset = 0 } = {}) {
    let collection = this.#db.table('sales').offset(offset);
    if (typeof limit === 'number') {
      collection = collection.limit(limit);
    }
    const records = await collection.toArray();
    return records.map(r => structuredClone(r));
  }

  /**
   * Fetches all legacy transaction records (debt repayments, adjustments).
   * @param {Object} [options]
   * @param {number} [options.limit]
   * @param {number} [options.offset]
   * @returns {Promise<Array<Object>>}
   */
  async fetchTransactions({ limit, offset = 0 } = {}) {
    if (!this.#db.tables.some(t => t.name === 'transactions')) {
      return [];
    }
    let collection = this.#db.table('transactions').offset(offset);
    if (typeof limit === 'number') {
      collection = collection.limit(limit);
    }
    const records = await collection.toArray();
    return records.map(r => structuredClone(r));
  }
}
