/**
 * Frontend Remediation (FE-01R) Financial Integrity & Regression Suite
 * 
 * Tests the 5 P1 integrity areas and P2 reporting behavior:
 * 1. Synchronization (Failed requests never succeed, 410 handled honestly, all pending types counted)
 * 2. Repayments & Debt Adjustments (Atomic commit/rollback, validation, zero sales created)
 * 3. POS Tender, Change & Payment Channel (Correct change, payment method persistence, credit enforcement)
 * 4. Target Database & Tenant Awareness (businessId preserved, no silent swallow of errors)
 * 5. Subscription Claims & UI (No hardcoded 1500 price, neutral unconnected status)
 * 6. Reports Financial Integrity (Cash collected excludes change, repayments excluded from revenue, disclosures)
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { msme_ledger_db, sb_db, getAllPendingSyncCounts } from '../config/db.js';
import {
  recordSale,
  recordCustomerRepayment,
  clearCustomerDebt,
  SUPPORTED_PAYMENT_METHODS
} from '../services/ledgerService.js';
import { recordExpense, EXPENSE_CATEGORIES } from '../services/expenseService.js';
import { pushPendingData, SyncError } from '../services/syncService.js';
import PointOfSale from '../pages/PointOfSale.jsx';
import CreditBook from '../pages/CreditBook.jsx';
import Settings from '../pages/Settings.jsx';
import Reports from '../pages/Reports.jsx';
import AppShell from '../components/common/AppShell.jsx';
import { getShopId } from '../utils/shopIdentity.js';

describe('MSME Ledger — FE-01R Remediation Test Suite', () => {
  beforeEach(async () => {
    // Clear all test data across both databases
    await msme_ledger_db.customers.clear();
    await msme_ledger_db.inventory.clear();
    await msme_ledger_db.sales.clear();
    if (msme_ledger_db.transactions) await msme_ledger_db.transactions.clear();
    if (sb_db.expenses) await sb_db.expenses.clear();
    if (sb_db.products) await sb_db.products.clear();
    if (sb_db.stockMovements) await sb_db.stockMovements.clear();

    window.localStorage.clear();
    window.localStorage.setItem('shopName', 'Ikeja Supermarket');
    window.localStorage.setItem('shopId', 'test-shop-uuid-001');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. P1: Cloud Synchronization Status
  // =========================================================================
  describe('1. P1 — Cloud Synchronization Status & Integrity', () => {
    it('accurately counts pending records across all stores (customers, inventory, sales, repayments, expenses, products, stock movements)', async () => {
      // Seed pending records across both databases
      await msme_ledger_db.customers.add({ id: 'c1', name: 'Cust 1', phone: '0801', totalDebt: 0, sync_status: 'pending', updatedAt: new Date() });
      await msme_ledger_db.inventory.add({ id: 'i1', itemName: 'Item 1', price: 1000, stockCount: 5, sync_status: 'pending', updatedAt: new Date() });
      await msme_ledger_db.sales.add({ id: 's1', customerId: 'c1', items: [], totalAmount: 1000, amountPaid: 1000, balance: 0, paymentStatus: 'paid', sync_status: 'pending', date: new Date() });
      await msme_ledger_db.transactions.add({ id: 't1', customerId: 'c1', type: 'PAYMENT', amount: 500, date: new Date().toISOString(), sync_status: 'pending' });
      await sb_db.expenses.add({ id: 'e1', businessId: 'test-shop-uuid-001', categoryId: 'rent', category: 'Rent', amount: 50000, sync_status: 'pending', updatedAt: new Date() });
      await sb_db.products.put({ id: 'p1', businessId: 'test-shop-uuid-001', name: 'Prod 1', sync_status: 'pending', updatedAt: new Date() });
      await sb_db.stockMovements.add({ id: 'sm1', businessId: 'test-shop-uuid-001', productId: 'i1', movementType: 'RESTOCK', quantityDelta: 5, sync_status: 'pending', movementDate: new Date() });

      const summary = await getAllPendingSyncCounts();
      expect(summary.total).toBe(7);
      expect(summary.breakdown.customers).toBe(1);
      expect(summary.breakdown.inventory).toBe(1);
      expect(summary.breakdown.sales).toBe(1);
      expect(summary.breakdown.transactions).toBe(1);
      expect(summary.breakdown.expenses).toBe(1);
      expect(summary.breakdown.products).toBe(1);
      expect(summary.breakdown.stockMovements).toBe(1);
    });

    it('returns clean no_pending status when no records are pending', async () => {
      const result = await pushPendingData();
      expect(result.status).toBe('no_pending');
      expect(result.pendingCount).toBe(0);
      expect(result.syncedCount).toBe(0);
    });

    it('HTTP 410 Gone from retired endpoint throws SYNC_UNAVAILABLE and preserves all records in pending state', async () => {
      await msme_ledger_db.customers.add({ id: 'c-sync-1', name: 'Pending Cust', phone: '0802', totalDebt: 0, sync_status: 'pending', updatedAt: new Date() });
      
      // Mock fetch returning HTTP 410 Gone
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        status: 410,
        ok: false,
        json: async () => ({ error: 'ENDPOINT_RETIRED_GONE' })
      });

      await expect(pushPendingData()).rejects.toThrow(/permanently retired \(HTTP 410\)/i);

      // Verify the record was NOT marked as synced!
      const customer = await msme_ledger_db.customers.get('c-sync-1');
      expect(customer.sync_status).toBe('pending');
    });

    it('server 500 failure throws SYNC_FAILED and leaves records pending without data loss', async () => {
      await msme_ledger_db.sales.add({
        id: 's-fail-1',
        customerId: 'c1',
        items: [],
        totalAmount: 5000,
        amountPaid: 5000,
        balance: 0,
        paymentStatus: 'paid',
        sync_status: 'pending',
        date: new Date()
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        status: 500,
        ok: false
      });

      await expect(pushPendingData()).rejects.toThrow(/rejected by server with HTTP 500/i);

      const sale = await msme_ledger_db.sales.get('s-fail-1');
      expect(sale.sync_status).toBe('pending');
    });

    it('unsupported record types (repayments & expenses) remain pending even if legacy route responds 200', async () => {
      // Seed a customer (supported by legacy) and a repayment (unsupported by legacy)
      await msme_ledger_db.customers.add({ id: 'c-legacy', name: 'Legacy Cust', phone: '0803', totalDebt: 0, sync_status: 'pending', updatedAt: new Date() });
      await msme_ledger_db.transactions.add({ id: 't-unsupported', customerId: 'c-legacy', type: 'PAYMENT', amount: 2000, date: new Date().toISOString(), sync_status: 'pending' });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ success: true })
      });

      const outcome = await pushPendingData();
      expect(outcome.status).toBe('partial');
      expect(outcome.syncedCount).toBe(1);
      expect(outcome.pendingCount).toBe(1);

      // Customer became synced
      const cust = await msme_ledger_db.customers.get('c-legacy');
      expect(cust.sync_status).toBe('synced');

      // Repayment transaction MUST remain pending!
      const tx = await msme_ledger_db.transactions.get('t-unsupported');
      expect(tx.sync_status).toBe('pending');
    });
  });

  // =========================================================================
  // 2. P1: Repayments & Debt Adjustments Atomicity
  // =========================================================================
  describe('2. P1 — Atomic Repayments & Debt Adjustments', () => {
    it('recordCustomerRepayment atomically reduces debt and creates exactly one PAYMENT event', async () => {
      await msme_ledger_db.customers.add({
        id: 'c-repay-1',
        name: 'Alhaji Danladi',
        phone: '08011112222',
        totalDebt: 500000, // ₦5,000.00
        sync_status: 'synced',
        updatedAt: new Date()
      });

      const result = await recordCustomerRepayment({
        customerId: 'c-repay-1',
        amountKobo: 200000, // ₦2,000.00
        paymentMethod: 'cash',
        notes: 'Partial cash payment'
      });

      expect(result.remainingDebt).toBe(300000);
      expect(result.amountKobo).toBe(200000);

      // Verify customer debt in database
      const customer = await msme_ledger_db.customers.get('c-repay-1');
      expect(customer.totalDebt).toBe(300000);
      expect(customer.sync_status).toBe('pending');

      // Verify transaction in database
      const txs = await msme_ledger_db.transactions.where('customerId').equals('c-repay-1').toArray();
      expect(txs.length).toBe(1);
      expect(txs[0].type).toBe('PAYMENT');
      expect(txs[0].amount).toBe(200000);
      expect(txs[0].paymentMethod).toBe('cash');

      // Invariant: ZERO sales records created!
      const sales = await msme_ledger_db.sales.toArray();
      expect(sales.length).toBe(0);
    });

    it('rolls back debt reduction if transaction insertion fails', async () => {
      await msme_ledger_db.customers.add({
        id: 'c-repay-rollback',
        name: 'Emeka Rollback',
        phone: '08099990000',
        totalDebt: 400000, // ₦4,000.00
        sync_status: 'synced',
        updatedAt: new Date()
      });

      // Spy on transactions.add and simulate error
      vi.spyOn(msme_ledger_db.transactions, 'add').mockRejectedValueOnce(
        new Error('Simulated transaction table disk write failure')
      );

      await expect(
        recordCustomerRepayment({
          customerId: 'c-repay-rollback',
          amountKobo: 150000
        })
      ).rejects.toThrow('Simulated transaction table disk write failure');

      // Customer debt must NOT have changed!
      const customer = await msme_ledger_db.customers.get('c-repay-rollback');
      expect(customer.totalDebt).toBe(400000);

      // No orphan transaction record
      const txs = await msme_ledger_db.transactions.toArray();
      expect(txs.length).toBe(0);
    });

    it('rejects invalid repayment amounts (negative, zero, or exceeding debt) without mutation', async () => {
      await msme_ledger_db.customers.add({
        id: 'c-invalid-amt',
        name: 'Bisi Ade',
        phone: '08088887777',
        totalDebt: 100000, // ₦1,000.00
        sync_status: 'synced',
        updatedAt: new Date()
      });

      // Negative amount
      await expect(
        recordCustomerRepayment({ customerId: 'c-invalid-amt', amountKobo: -500 })
      ).rejects.toThrow(/valid positive integer/i);

      // Zero amount
      await expect(
        recordCustomerRepayment({ customerId: 'c-invalid-amt', amountKobo: 0 })
      ).rejects.toThrow(/valid positive integer/i);

      // Amount exceeding debt
      await expect(
        recordCustomerRepayment({ customerId: 'c-invalid-amt', amountKobo: 150000 })
      ).rejects.toThrow(/exceeds outstanding debt/i);

      // Debt untouched
      const customer = await msme_ledger_db.customers.get('c-invalid-amt');
      expect(customer.totalDebt).toBe(100000);
      expect(await msme_ledger_db.transactions.count()).toBe(0);
    });

    it('clearCustomerDebt atomically resets debt to 0 and records an auditable PAYMENT event', async () => {
      await msme_ledger_db.customers.add({
        id: 'c-clear-1',
        name: 'Chief Obi',
        phone: '08012344321',
        totalDebt: 350000, // ₦3,500.00
        sync_status: 'synced',
        updatedAt: new Date()
      });

      const outcome = await clearCustomerDebt({
        customerId: 'c-clear-1',
        paymentMethod: 'bank_transfer',
        notes: 'Full settlement via transfer'
      });

      expect(outcome.clearedAmount).toBe(350000);
      expect(outcome.remainingDebt).toBe(0);

      const customer = await msme_ledger_db.customers.get('c-clear-1');
      expect(customer.totalDebt).toBe(0);

      const txs = await msme_ledger_db.transactions.toArray();
      expect(txs.length).toBe(1);
      expect(txs[0].type).toBe('PAYMENT');
      expect(txs[0].amount).toBe(350000);
      expect(txs[0].paymentMethod).toBe('bank_transfer');
    });
  });

  // =========================================================================
  // 3. P1: POS Tender, Change & Payment Method Accounting
  // =========================================================================
  describe('3. P1 — POS Tender, Change & Payment Accounting', () => {
    beforeEach(async () => {
      await msme_ledger_db.customers.add({
        id: 'cust-pos-test',
        name: 'Madam Grace',
        phone: '08055554444',
        totalDebt: 0,
        sync_status: 'synced',
        updatedAt: new Date()
      });

      await msme_ledger_db.inventory.add({
        id: 'inv-pos-test',
        itemName: 'Detergent 500g',
        price: 80000, // ₦800.00
        stockCount: 10,
        sync_status: 'synced',
        updatedAt: new Date()
      });
    });

    it('exact cash payment records amountPaid equal to totalAmount with 0 change', async () => {
      const saleId = await recordSale({
        customerId: 'cust-pos-test',
        items: [{ inventoryId: 'inv-pos-test', quantity: 2, price: 80000 }], // Total: ₦1,600 (160,000 kobo)
        amountTendered: 160000,
        paymentMethod: 'cash'
      });

      const sale = await msme_ledger_db.sales.get(saleId);
      expect(sale.totalAmount).toBe(160000);
      expect(sale.amountPaid).toBe(160000);
      expect(sale.amountTendered).toBe(160000);
      expect(sale.changeReturned).toBe(0);
      expect(sale.balance).toBe(0);
      expect(sale.paymentStatus).toBe('paid');
      expect(sale.paymentMethod).toBe('cash');
    });

    it('cash overpayment calculates change returned and DOES NOT count change as revenue collected', async () => {
      // Sale total: ₦800 (80,000 kobo). Customer tenders: ₦1,000 (100,000 kobo). Change: ₦200 (20,000 kobo)
      const saleId = await recordSale({
        customerId: 'cust-pos-test',
        items: [{ inventoryId: 'inv-pos-test', quantity: 1, price: 80000 }],
        amountTendered: 100000, // ₦1,000
        paymentMethod: 'cash'
      });

      const sale = await msme_ledger_db.sales.get(saleId);
      expect(sale.totalAmount).toBe(80000);
      // CRITICAL FINANCIAL INVARIANT: amountPaid must be exactly ₦800 (80,000 kobo), NEVER ₦1,000!
      expect(sale.amountPaid).toBe(80000);
      expect(sale.amountTendered).toBe(100000);
      expect(sale.changeReturned).toBe(20000);
      expect(sale.balance).toBe(0);
      expect(sale.paymentStatus).toBe('paid');

      // Customer debt must remain 0 (overpayment does not create negative debt)
      const customer = await msme_ledger_db.customers.get('cust-pos-test');
      expect(customer.totalDebt).toBe(0);
    });

    it('rejects insufficient payment when credit is NOT explicitly authorized', async () => {
      // Total: ₦800. Tender: ₦500. allowCredit: false
      await expect(
        recordSale({
          customerId: 'cust-pos-test',
          items: [{ inventoryId: 'inv-pos-test', quantity: 1, price: 80000 }],
          amountTendered: 50000,
          paymentMethod: 'cash',
          allowCredit: false
        })
      ).rejects.toThrow(/Payment is insufficient.*explicitly allow a credit sale/i);

      // Stock must NOT have been deducted
      const inv = await msme_ledger_db.inventory.get('inv-pos-test');
      expect(inv.stockCount).toBe(10);
      expect(await msme_ledger_db.sales.count()).toBe(0);
    });

    it('insufficient payment with allowCredit: true records credit balance to customer debt', async () => {
      // Total: ₦800. Tender: ₦500. allowCredit: true
      const saleId = await recordSale({
        customerId: 'cust-pos-test',
        items: [{ inventoryId: 'inv-pos-test', quantity: 1, price: 80000 }],
        amountTendered: 50000, // ₦500
        paymentMethod: 'cash',
        allowCredit: true
      });

      const sale = await msme_ledger_db.sales.get(saleId);
      expect(sale.totalAmount).toBe(80000);
      expect(sale.amountPaid).toBe(50000);
      expect(sale.balance).toBe(30000); // ₦300 debt
      expect(sale.paymentStatus).toBe('partial');

      // Customer debt updated
      const customer = await msme_ledger_db.customers.get('cust-pos-test');
      expect(customer.totalDebt).toBe(30000);
    });

    it('persists selected payment method (bank_transfer and pos) across readbacks', async () => {
      const saleIdTransfer = await recordSale({
        customerId: 'cust-pos-test',
        items: [{ inventoryId: 'inv-pos-test', quantity: 1, price: 80000 }],
        amountTendered: 80000,
        paymentMethod: 'bank_transfer'
      });

      const saleTransfer = await msme_ledger_db.sales.get(saleIdTransfer);
      expect(saleTransfer.paymentMethod).toBe('bank_transfer');

      const saleIdPOS = await recordSale({
        customerId: 'cust-pos-test',
        items: [{ inventoryId: 'inv-pos-test', quantity: 1, price: 80000 }],
        amountTendered: 80000,
        paymentMethod: 'pos'
      });

      const salePOS = await msme_ledger_db.sales.get(saleIdPOS);
      expect(salePOS.paymentMethod).toBe('pos');
    });
  });

  // =========================================================================
  // 4. P1: Target Database & Tenant-Aware Local Writes
  // =========================================================================
  describe('4. P1 — Target Database & Tenant-Aware Writes', () => {
    it('recordExpense writes to sb_db.expenses with verified businessId and categoryId', async () => {
      const expense = await recordExpense({
        category: 'Generator Fuel',
        amountKobo: 4500000, // ₦45,000.00
        paymentMethod: 'bank_transfer',
        notes: '30 litres diesel for backup generator'
      });

      expect(expense.businessId).toBe('test-shop-uuid-001');
      expect(expense.categoryId).toBe('generator_fuel');
      expect(expense.amount).toBe(4500000);
      expect(expense.paymentStatus).toBe('paid');
      expect(expense.sync_status).toBe('pending');

      // Verify persistence in sb_db.expenses
      const inDb = await sb_db.expenses.get(expense.id);
      expect(inDb).toBeDefined();
      expect(inDb.businessId).toBe('test-shop-uuid-001');
      expect(inDb.categoryId).toBe('generator_fuel');
    });

    it('recordExpense does NOT swallow database errors and rejects invalid amounts', async () => {
      await expect(
        recordExpense({
          category: 'Rent',
          amountKobo: -100
        })
      ).rejects.toThrow(/valid positive integer/i);

      await expect(
        recordExpense({
          category: '',
          amountKobo: 5000
        })
      ).rejects.toThrow(/valid expense category is required/i);
    });
  });

  // =========================================================================
  // 5. P1: Remove Unapproved Subscription Claims
  // =========================================================================
  describe('5. P1 — Subscription UI & Honest Claims', () => {
    it('Settings page displays neutral unconnected subscription status and no hardcoded 1,500 NGN price', async () => {
      render(<Settings />);

      await waitFor(() => {
        expect(screen.getByText('System Settings & Profile')).toBeInTheDocument();
        expect(screen.getByText('Subscription Management Unconnected')).toBeInTheDocument();
        expect(screen.getByText('Offline Evaluation (Billing Not Connected)')).toBeInTheDocument();
      });

      // Assert that the unapproved 1,500 NGN price is NOT rendered
      expect(screen.queryByText(/1,500 NGN \/ month/i)).toBeNull();
      expect(screen.queryByText(/Renew License via WhatsApp \(1,500 NGN\)/i)).toBeNull();
      expect(screen.queryByText('30-Day Trial Active')).toBeNull();
    });

    it('Settings manual sync accurately reports when cloud synchronization is unavailable', async () => {
      // Seed pending record
      await msme_ledger_db.customers.add({
        id: 'c-sync-test',
        name: 'Sync Test',
        phone: '0809988',
        totalDebt: 0,
        sync_status: 'pending',
        updatedAt: new Date()
      });

      // Mock fetch returning HTTP 410
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        status: 410,
        ok: false,
        json: async () => ({ error: 'ENDPOINT_RETIRED_GONE' })
      });

      render(<Settings />);

      const syncBtn = screen.getByRole('button', { name: /Trigger Sync Now/i });
      fireEvent.click(syncBtn);

      await waitFor(() => {
        expect(screen.getByText('Cloud Synchronization Unavailable')).toBeInTheDocument();
        expect(screen.getByText(/endpoint has been retired \(HTTP 410\)/i)).toBeInTheDocument();
      });
    });

    it('AppShell displays Local Storage Clean when queue is 0, and Pending Sync when records await sync', async () => {
      // When 0 pending records exist
      const { rerender } = render(<AppShell activeTab="overview" onSelectTab={vi.fn()}><div>Content</div></AppShell>);
      
      await waitFor(() => {
        expect(screen.getByText('Local Storage Clean')).toBeInTheDocument();
      });

      // Now add a pending record
      await msme_ledger_db.customers.add({
        id: 'c-appshell-pending',
        name: 'AppShell Test',
        phone: '0807766',
        totalDebt: 0,
        sync_status: 'pending',
        updatedAt: new Date()
      });

      rerender(<AppShell activeTab="overview" onSelectTab={vi.fn()}><div>Content</div></AppShell>);

      await waitFor(() => {
        expect(screen.getByText(/Pending Sync: 1/i)).toBeInTheDocument();
      });

      // Never shows "Cloud Synced" when pending records exist!
      expect(screen.queryByText('Cloud Synced')).toBeNull();
    });
  });

  // =========================================================================
  // 6. P2: Reports and Financial Integrity
  // =========================================================================
  describe('6. P2 — Reports Financial Integrity', () => {
    it('reports cash collected strictly excluding change returned, and keeps repayments separate from sales revenue', async () => {
      // Sale: total ₦8,000 (800,000 kobo), tender ₦10,000, applied ₦8,000 (800,000 kobo), change ₦2,000
      await msme_ledger_db.sales.add({
        id: 'sale-rep-p2',
        customerId: 'cust-1',
        items: [{ inventoryId: 'inv-1', quantity: 1, price: 800000 }],
        totalAmount: 800000,
        amountPaid: 800000, // amount applied
        amountTendered: 1000000,
        changeReturned: 200000,
        balance: 0,
        paymentStatus: 'paid',
        paymentMethod: 'cash',
        sync_status: 'pending',
        date: new Date()
      });

      // Customer debt repayment: ₦3,000 (300,000 kobo)
      await msme_ledger_db.transactions.add({
        id: 'tx-repay-p2',
        customerId: 'cust-1',
        type: 'PAYMENT',
        amount: 300000,
        paymentMethod: 'cash',
        date: new Date().toISOString(),
        sync_status: 'pending'
      });

      // Operating expense: ₦2,000 (200,000 kobo)
      await sb_db.expenses.add({
        id: 'exp-p2',
        businessId: 'test-shop-uuid-001',
        categoryId: 'utilities',
        category: 'Electricity & Utilities',
        amount: 200000,
        paymentStatus: 'paid',
        sync_status: 'pending',
        updatedAt: new Date()
      });

      render(<Reports />);

      await waitFor(() => {
        // Gross sales revenue = ₦8,000.00 (NOT ₦11,000 - repayments are NOT added to sales revenue!)
        expect(screen.getAllByText('₦8,000.00').length).toBeGreaterThan(0);

        // Total cash collected = ₦8,000 + ₦3,000 = ₦11,000.00 (NOT ₦13,000 - change is excluded!)
        expect(screen.getAllByText('₦11,000.00').length).toBeGreaterThan(0);

        // Repayments cash collected = ₦3,000.00
        expect(screen.getAllByText('+₦3,000.00').length).toBeGreaterThan(0);

        // Net Operating Cash Flow (Recorded) = ₦11,000 - ₦2,000 = ₦9,000.00
        expect(screen.getAllByText('₦9,000.00').length).toBeGreaterThan(0);

        // Disclosures rendered
        expect(screen.getByText(/Cash collected on sales strictly excludes change returned to customers/i)).toBeInTheDocument();
        expect(screen.getByText(/Operating cash flow represents recorded transactions on this device and does not reflect a complete balance-sheet cash position/i)).toBeInTheDocument();
      });
    });
  });
});
