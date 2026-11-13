import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Onboarding from '../components/Onboarding';
import { msme_ledger_db } from '../config/db';

describe('SBM-010 / SBM-011: Onboarding Data Preservation Regression Suite', () => {
  beforeEach(async () => {
    // Clear in-memory isolated test database before each test
    await msme_ledger_db.customers.clear();
    await msme_ledger_db.inventory.clear();
    await msme_ledger_db.sales.clear();
    await msme_ledger_db.transactions.clear();
    window.localStorage.clear();
  });

  it('preserves existing customers, inventory, sales, and transactions across onboarding submission', async () => {
    // 1. Seed existing business records
    const seedCustomer = {
      id: 'cust-uuid-001',
      name: 'Pre-existing Merchant Customer',
      phone: '08012345678',
      totalDebt: 500000,
      sync_status: 'synced',
      updatedAt: new Date('2026-09-01T10:00:00Z')
    };

    const seedInventory = {
      id: 'inv-uuid-001',
      itemName: 'Pre-existing Cement Bag',
      price: 950000,
      stockCount: 42,
      sync_status: 'synced',
      updatedAt: new Date('2026-09-01T10:00:00Z')
    };

    const seedSale = {
      id: 'sale-uuid-001',
      customerId: 'cust-uuid-001',
      items: [{ inventoryId: 'inv-uuid-001', quantity: 2, price: 950000 }],
      totalAmount: 1900000,
      amountPaid: 1400000,
      balance: 500000,
      paymentStatus: 'partial',
      sync_status: 'synced',
      date: new Date('2026-09-01T11:00:00Z')
    };

    const seedTransaction = {
      id: 'tx-uuid-001',
      customerId: 'cust-uuid-001',
      type: 'PAYMENT',
      amount: 200000,
      date: '2026-09-01T12:00:00Z',
      sync_status: 'pending'
    };

    await msme_ledger_db.customers.add(seedCustomer);
    await msme_ledger_db.inventory.add(seedInventory);
    await msme_ledger_db.sales.add(seedSale);
    await msme_ledger_db.transactions.add(seedTransaction);

    expect(await msme_ledger_db.customers.count()).toBe(1);
    expect(await msme_ledger_db.inventory.count()).toBe(1);
    expect(await msme_ledger_db.sales.count()).toBe(1);
    expect(await msme_ledger_db.transactions.count()).toBe(1);

    // 2. Render Onboarding component
    const onCompleteMock = vi.fn();
    render(<Onboarding onComplete={onCompleteMock} />);

    // 3. User enters a shop name and submits
    const input = screen.getByLabelText(/Shop Name/i);
    fireEvent.change(input, { target: { value: 'Verified Safe Shop' } });

    const submitBtn = screen.getByRole('button', { name: /Start Managing Sales/i });
    fireEvent.click(submitBtn);

    // 4. Wait for submission completion
    await waitFor(() => {
      expect(onCompleteMock).toHaveBeenCalledTimes(1);
    });

    // 5. Assert that shopName is stored in localStorage
    expect(window.localStorage.getItem('shopName')).toBe('Verified Safe Shop');

    // 6. CRITICAL REGRESSION ASSERTION: Verify existing records survived untouched
    const survivingCustomers = await msme_ledger_db.customers.toArray();
    const survivingInventory = await msme_ledger_db.inventory.toArray();
    const survivingSales = await msme_ledger_db.sales.toArray();
    const survivingTransactions = await msme_ledger_db.transactions.toArray();

    expect(survivingCustomers.length).toBe(1);
    expect(survivingCustomers[0].id).toBe('cust-uuid-001');
    expect(survivingCustomers[0].name).toBe('Pre-existing Merchant Customer');
    expect(survivingCustomers[0].totalDebt).toBe(500000);

    expect(survivingInventory.length).toBe(1);
    expect(survivingInventory[0].id).toBe('inv-uuid-001');
    expect(survivingInventory[0].itemName).toBe('Pre-existing Cement Bag');
    expect(survivingInventory[0].stockCount).toBe(42);

    expect(survivingSales.length).toBe(1);
    expect(survivingSales[0].id).toBe('sale-uuid-001');
    expect(survivingSales[0].totalAmount).toBe(1900000);

    expect(survivingTransactions.length).toBe(1);
    expect(survivingTransactions[0].id).toBe('tx-uuid-001');
    expect(survivingTransactions[0].amount).toBe(200000);
  });

  it('completes onboarding flow cleanly when database is empty (first-time user scenario)', async () => {
    expect(await msme_ledger_db.customers.count()).toBe(0);
    expect(await msme_ledger_db.inventory.count()).toBe(0);
    expect(await msme_ledger_db.sales.count()).toBe(0);

    const onCompleteMock = vi.fn();
    render(<Onboarding onComplete={onCompleteMock} />);

    const input = screen.getByLabelText(/Shop Name/i);
    fireEvent.change(input, { target: { value: 'Fresh First Time Store' } });

    const submitBtn = screen.getByRole('button', { name: /Start Managing Sales/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onCompleteMock).toHaveBeenCalledTimes(1);
    });

    expect(window.localStorage.getItem('shopName')).toBe('Fresh First Time Store');
  });

  it('does not erase existing records on repeated onboarding submissions', async () => {
    // Seed a customer
    await msme_ledger_db.customers.add({
      id: 'cust-repeat-01',
      name: 'Persistent Customer',
      phone: '08099999999',
      totalDebt: 10000,
      sync_status: 'pending',
      updatedAt: new Date()
    });

    const onCompleteMock = vi.fn();
    const { unmount } = render(<Onboarding onComplete={onCompleteMock} />);

    // Submission 1
    const input = screen.getByLabelText(/Shop Name/i);
    fireEvent.change(input, { target: { value: 'Shop First Run' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Managing Sales/i }));

    await waitFor(() => {
      expect(onCompleteMock).toHaveBeenCalledTimes(1);
    });

    unmount();

    // Submission 2 (repeated onboarding)
    const onCompleteMock2 = vi.fn();
    render(<Onboarding onComplete={onCompleteMock2} />);

    const input2 = screen.getByLabelText(/Shop Name/i);
    fireEvent.change(input2, { target: { value: 'Shop Second Run' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Managing Sales/i }));

    await waitFor(() => {
      expect(onCompleteMock2).toHaveBeenCalledTimes(1);
    });

    // Record must still exist
    const cust = await msme_ledger_db.customers.get('cust-repeat-01');
    expect(cust).toBeDefined();
    expect(cust.name).toBe('Persistent Customer');
  });

  it('preserves pending local sync records across all stores without flipping status', async () => {
    // Seed records with sync_status: 'pending'
    await msme_ledger_db.customers.add({
      id: 'cust-pending-01',
      name: 'Offline Customer',
      phone: '08011112222',
      totalDebt: 250000,
      sync_status: 'pending',
      updatedAt: new Date('2026-09-01T15:00:00Z')
    });

    await msme_ledger_db.inventory.add({
      id: 'inv-pending-01',
      itemName: 'Offline Stock Item',
      price: 150000,
      stockCount: 15,
      sync_status: 'pending',
      updatedAt: new Date('2026-09-01T15:00:00Z')
    });

    await msme_ledger_db.sales.add({
      id: 'sale-pending-01',
      customerId: 'cust-pending-01',
      items: [{ inventoryId: 'inv-pending-01', quantity: 1, price: 150000 }],
      totalAmount: 150000,
      amountPaid: 150000,
      balance: 0,
      paymentStatus: 'paid',
      sync_status: 'pending',
      date: new Date('2026-09-01T15:10:00Z')
    });

    await msme_ledger_db.transactions.add({
      id: 'tx-pending-01',
      customerId: 'cust-pending-01',
      type: 'PAYMENT',
      amount: 50000,
      date: '2026-09-01T15:20:00Z',
      sync_status: 'pending'
    });

    // Also preserve pre-existing shopId in localStorage
    window.localStorage.setItem('shopId', 'existing-pre-onboarding-uuid-999');

    const onCompleteMock = vi.fn();
    render(<Onboarding onComplete={onCompleteMock} />);

    fireEvent.change(screen.getByLabelText(/Shop Name/i), { target: { value: 'Synced Safe Shop' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Managing Sales/i }));

    await waitFor(() => {
      expect(onCompleteMock).toHaveBeenCalledTimes(1);
    });

    // Verify existing shopId was not overwritten or destroyed
    expect(window.localStorage.getItem('shopId')).toBe('existing-pre-onboarding-uuid-999');
    expect(window.localStorage.getItem('shopName')).toBe('Synced Safe Shop');

    // Verify sync_status remains strictly 'pending' on all stores
    const customer = await msme_ledger_db.customers.get('cust-pending-01');
    const inventory = await msme_ledger_db.inventory.get('inv-pending-01');
    const sale = await msme_ledger_db.sales.get('sale-pending-01');
    const tx = await msme_ledger_db.transactions.get('tx-pending-01');

    expect(customer.sync_status).toBe('pending');
    expect(inventory.sync_status).toBe('pending');
    expect(sale.sync_status).toBe('pending');
    expect(tx.sync_status).toBe('pending');
  });
});
