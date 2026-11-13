import { describe, it, expect } from 'vitest';
import { msme_ledger_db } from '../config/db.js';

describe('Test Environment Smoke Test', () => {
  it('runs vitest with in-memory IndexedDB isolated environment', async () => {
    expect(indexedDB).toBeDefined();
    expect(msme_ledger_db).toBeDefined();
    
    // Add item to fake-indexeddb
    await msme_ledger_db.customers.add({
      id: 'test-smoke-01',
      name: 'Smoke Test Customer',
      phone: '08000000000',
      totalDebt: 0,
      sync_status: 'synced',
      updatedAt: new Date()
    });

    const retrieved = await msme_ledger_db.customers.get('test-smoke-01');
    expect(retrieved).toBeDefined();
    expect(retrieved.name).toBe('Smoke Test Customer');

    // Clean up
    await msme_ledger_db.customers.delete('test-smoke-01');
  });
});

