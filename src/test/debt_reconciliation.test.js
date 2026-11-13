import { describe, it, expect } from 'vitest';
import { reconcileCustomerDebt } from '../domain/migration/debtReconciliation.js';
import { MigrationQuarantineManager } from '../domain/migration/quarantine.js';

describe('SBM-031: Legacy Debt Reconciliation Engine', () => {
  const businessId = 'biz-test-001';

  it('1. customer with zero debt produces zero opening credit balance', () => {
    const customer = {
      id: 'cust-zero-01',
      name: 'Debt Free Merchant',
      phone: '08011111111',
      totalDebt: 0
    };

    const result = reconcileCustomerDebt({
      customer,
      historicalTransactions: [],
      businessId
    });

    expect(result.authoritativeOpeningBalance).toBe(0);
    expect(result.isQuarantined).toBe(false);
    expect(result.creditEntry).toBeNull();
    expect(result.creditPayments.length).toBe(0);
    expect(result.reconciliationStatus).toBe('zero_debt');
  });

  it('2. customer with positive debt establishes authoritative opening balance without reduction', () => {
    const customer = {
      id: 'cust-debt-01',
      name: 'Retail Debtor Alhaji',
      phone: '08022222222',
      totalDebt: 500000 // ₦5,000.00 in Kobo
    };

    const result = reconcileCustomerDebt({
      customer,
      historicalTransactions: [],
      businessId
    });

    expect(result.authoritativeOpeningBalance).toBe(500000);
    expect(result.creditEntry).toBeDefined();
    expect(result.creditEntry.entryType).toBe('legacy_opening_balance');
    expect(result.creditEntry.originalAmount).toBe(500000);
    expect(result.creditEntry.settledAmount).toBe(0);
    expect(result.creditEntry.remainingBalance).toBe(500000);
    expect(result.creditEntry.status).toBe('open');
  });

  it('3. CRITICAL: preserves historical repayments as unallocated history and NEVER double-deducts', () => {
    // Legacy customer has totalDebt of ₦5,000 (500,000 Kobo).
    // Historical transaction history shows a repayment of ₦2,000 (200,000 Kobo).
    // In legacy, the ₦5,000 balance ALREADY reflects that historical repayment!
    // If we deducted ₦2,000 from ₦5,000, we would be double-counting the repayment!
    const customer = {
      id: 'cust-debt-02',
      name: 'Madam Patience',
      phone: '08033333333',
      totalDebt: 500000 // ₦5,000.00 Kobo authoritative opening balance
    };

    const historicalTransactions = [
      {
        id: 'tx-repay-01',
        customerId: 'cust-debt-02',
        type: 'PAYMENT',
        amount: 200000, // ₦2,000.00 Kobo historical repayment
        date: '2026-08-15T12:00:00Z',
        paymentMethod: 'cash'
      }
    ];

    const result = reconcileCustomerDebt({
      customer,
      historicalTransactions,
      businessId
    });

    // Opening credit entry remains strictly 500,000 Kobo (NOT 300,000 Kobo!)
    expect(result.authoritativeOpeningBalance).toBe(500000);
    expect(result.creditEntry.originalAmount).toBe(500000);
    expect(result.creditEntry.remainingBalance).toBe(500000);
    expect(result.creditEntry.settledAmount).toBe(0);

    // Historical repayment is preserved separately as unallocated history
    expect(result.creditPayments.length).toBe(1);
    expect(result.creditPayments[0].id).toBe('cpay_legacy_tx-repay-01');
    expect(result.creditPayments[0].amount).toBe(200000);
    expect(result.creditPayments[0].allocationStatus).toBe('unallocated_legacy_historical');
    expect(result.creditPayments[0].creditEntryId).toBeNull();
  });

  it('4. customer whose historical repayments exceed opening balance preserves balance and flags discrepancy', () => {
    const customer = {
      id: 'cust-debt-03',
      name: 'Over-Repaid Debtor',
      totalDebt: 100000 // ₦1,000.00 Kobo
    };

    const historicalTransactions = [
      {
        id: 'tx-big-01',
        customerId: 'cust-debt-03',
        type: 'PAYMENT',
        amount: 300000, // ₦3,000.00 Kobo repayments
        date: '2026-08-01T10:00:00Z'
      }
    ];

    const result = reconcileCustomerDebt({
      customer,
      historicalTransactions,
      businessId
    });

    // Authoritative balance is still 100,000 Kobo
    expect(result.authoritativeOpeningBalance).toBe(100000);
    expect(result.creditEntry.remainingBalance).toBe(100000);
    expect(result.totalHistoricalRepayments).toBe(300000);
    expect(result.notes.some(n => n.includes('exceeds opening debt balance'))).toBe(true);
  });

  it('5. customer with missing transaction history retains full opening debt', () => {
    const customer = {
      id: 'cust-no-tx',
      name: 'Customer No Transactions',
      totalDebt: 750000
    };

    const result = reconcileCustomerDebt({
      customer,
      historicalTransactions: [],
      businessId
    });

    expect(result.authoritativeOpeningBalance).toBe(750000);
    expect(result.creditPayments.length).toBe(0);
    expect(result.creditEntry.remainingBalance).toBe(750000);
  });

  it('6. deduplicates identical duplicate historical transactions by transaction ID without double counting', () => {
    const customer = {
      id: 'cust-dup-tx',
      name: 'Customer Duplicate TX',
      totalDebt: 400000
    };

    const historicalTransactions = [
      { id: 'tx-dup-01', customerId: 'cust-dup-tx', type: 'PAYMENT', amount: 50000, date: '2026-08-01', paymentMethod: 'cash' },
      { id: 'tx-dup-01', customerId: 'cust-dup-tx', type: 'PAYMENT', amount: 50000, date: '2026-08-01', paymentMethod: 'cash' } // Identical duplicate replay
    ];

    const result = reconcileCustomerDebt({
      customer,
      historicalTransactions,
      businessId
    });

    expect(result.creditPayments.length).toBe(1);
    expect(result.totalHistoricalRepayments).toBe(50000);
    expect(result.authoritativeOpeningBalance).toBe(400000);
    expect(result.creditEntry.remainingBalance).toBe(400000);
    expect(result.notes.some(n => n.includes('Identical duplicate transaction replay skipped'))).toBe(true);
  });

  it('9. quarantines conflicting duplicate transaction IDs and never silently picks one', () => {
    const quarantineManager = new MigrationQuarantineManager('test_run_conflict');
    const customer = {
      id: 'cust-conflict-tx',
      name: 'Customer Conflicting TX',
      totalDebt: 500000
    };

    const historicalTransactions = [
      { id: 'tx-conf-01', customerId: 'cust-conflict-tx', type: 'PAYMENT', amount: 50000, date: '2026-08-01', paymentMethod: 'cash' },
      { id: 'tx-conf-01', customerId: 'cust-conflict-tx', type: 'PAYMENT', amount: 99000, date: '2026-08-01', paymentMethod: 'cash' } // CONFLICTING AMOUNT!
    ];

    const result = reconcileCustomerDebt({
      customer,
      historicalTransactions,
      businessId,
      quarantineManager
    });

    // First transaction accepted, second conflicting transaction quarantined
    expect(result.creditPayments.length).toBe(1);
    expect(result.totalHistoricalRepayments).toBe(50000);
    expect(quarantineManager.getCount()).toBe(1);
    const quar = quarantineManager.getQuarantined('transactions')[0];
    expect(quar.sourceId).toBe('tx-conf-01');
    expect(quar.reason).toBe('CONFLICTING_DUPLICATE_TRANSACTION');
    expect(result.notes.some(n => n.includes('Conflicting duplicate transaction detected'))).toBe(true);

    // Opening balance remains authoritative and intact
    expect(result.authoritativeOpeningBalance).toBe(500000);
    expect(result.creditEntry.remainingBalance).toBe(500000);
  });

  it('10. quarantines transactions with missing or invalid string ID', () => {
    const quarantineManager = new MigrationQuarantineManager('test_run_malformed_id');
    const customer = {
      id: 'cust-bad-tx-id',
      name: 'Customer Bad TX ID',
      totalDebt: 300000
    };

    const historicalTransactions = [
      { id: '', customerId: 'cust-bad-tx-id', type: 'PAYMENT', amount: 40000 } // Missing ID
    ];

    const result = reconcileCustomerDebt({
      customer,
      historicalTransactions,
      businessId,
      quarantineManager
    });

    expect(result.creditPayments.length).toBe(0);
    expect(quarantineManager.getCount()).toBe(1);
    const quar = quarantineManager.getQuarantined('transactions')[0];
    expect(quar.reason).toBe('MALFORMED_TRANSACTION_MISSING_ID');
    expect(result.authoritativeOpeningBalance).toBe(300000);
  });

  it('7. quarantines customer debt with malformed or negative debt values', () => {
    const quarantineManager = new MigrationQuarantineManager('test_run_01');

    const malformedCustomer = {
      id: 'cust-bad-01',
      name: 'Malformed Debtor',
      totalDebt: -50000 // Negative debt is illegal
    };

    const result = reconcileCustomerDebt({
      customer: malformedCustomer,
      historicalTransactions: [],
      businessId,
      quarantineManager
    });

    expect(result.isQuarantined).toBe(true);
    expect(result.creditEntry).toBeNull();
    expect(quarantineManager.getCount()).toBe(1);
    expect(quarantineManager.getQuarantined('customers')[0].reason).toMatch(/NEGATIVE_TOTALDEBT_PROHIBITED/);
  });

  it('8. quarantines customer debt when currency unit is ambiguous without context', () => {
    const quarantineManager = new MigrationQuarantineManager('test_run_02');

    const ambiguousCustomer = {
      id: 'cust-ambig-01',
      name: 'Ambiguous Magnitude Merchant',
      totalDebt: 250 // Is this ₦2.50 or ₦250.00?
    };

    const result = reconcileCustomerDebt({
      customer: ambiguousCustomer,
      historicalTransactions: [],
      businessId,
      currencyContext: { expectedUnit: 'AUTO', hasLinkedEvidence: false },
      quarantineManager
    });

    expect(result.isQuarantined).toBe(true);
    expect(quarantineManager.getCount()).toBe(1);
    expect(quarantineManager.getQuarantined('customers')[0].reason).toMatch(/AMBIGUOUS_CURRENCY_MAGNITUDE/);
  });
});

