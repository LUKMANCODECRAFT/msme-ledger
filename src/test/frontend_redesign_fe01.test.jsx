/**
 * Frontend Redesign (FE-01) Test Suite
 * 
 * Verifies the redesigned application shell, 9 modules navigation,
 * integer kobo financial calculations, POS cashier workflow,
 * debt repayment separation, and empty states.
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App.jsx';
import Overview from '../pages/Overview.jsx';
import BusinessBook from '../pages/BusinessBook.jsx';
import PointOfSale from '../pages/PointOfSale.jsx';
import CreditBook from '../pages/CreditBook.jsx';
import Reports from '../pages/Reports.jsx';
import Settings from '../pages/Settings.jsx';
import { msme_ledger_db, sb_db } from '../config/db.js';
import { formatNaira, formatNigerianPhone, generateWhatsAppLink } from '../utils/formatters.js';

describe('MSME Ledger — Frontend Redesign (FE-01) Suite', () => {
  beforeEach(async () => {
    // Clean test Dexie database and local storage before each test
    await msme_ledger_db.customers.clear();
    await msme_ledger_db.inventory.clear();
    await msme_ledger_db.sales.clear();
    await msme_ledger_db.transactions.clear();
    if (sb_db.expenses) await sb_db.expenses.clear();

    window.localStorage.clear();
    window.localStorage.setItem('shopName', 'Ikeja Supermarket');
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);
    window.localStorage.setItem('trialEndsAt', futureDate.toISOString());
  });

  describe('1. Formatting & Financial Utilities', () => {
    it('formats integer kobo into standard Nigerian Naira with two decimal places', () => {
      expect(formatNaira(0)).toBe('₦0.00');
      expect(formatNaira(100)).toBe('₦1.00');
      expect(formatNaira(150000)).toBe('₦1,500.00');
      expect(formatNaira(85000000)).toBe('₦850,000.00');
    });

    it('formats Nigerian phone numbers for WhatsApp integration', () => {
      expect(formatNigerianPhone('08012345678')).toBe('2348012345678');
      expect(formatNigerianPhone('+2348012345678')).toBe('2348012345678');
      expect(formatNigerianPhone('2348012345678')).toBe('2348012345678');
    });

    it('generates polite WhatsApp debt recovery reminder URL', () => {
      const customer = {
        name: 'Musa Bello',
        phone: '08033334444',
        totalDebt: 500000 // ₦5,000.00
      };
      const url = generateWhatsAppLink(customer, 'Ikeja Supermarket');
      expect(url).toContain('https://wa.me/2348033334444');
      expect(url).toContain(encodeURIComponent('Musa Bello'));
      expect(url).toContain(encodeURIComponent('₦5,000.00'));
      expect(url).toContain(encodeURIComponent('Ikeja Supermarket'));
    });
  });

  describe('2. Application Shell & 9 Modules Navigation', () => {
    it('renders the application shell with business name and navigation items', async () => {
      render(<App />);

      // Business name in header/sidebar
      expect(screen.getAllByText('Ikeja Supermarket').length).toBeGreaterThan(0);

      // Verify all 9 module labels exist in desktop navigation
      const navModules = [
        'Overview',
        'Business Book',
        'Sales / POS',
        'Expenses',
        'Inventory',
        'Customers',
        'Credit Book',
        'Reports',
        'Settings'
      ];

      for (const mod of navModules) {
        expect(screen.getAllByText(mod).length).toBeGreaterThan(0);
      }
    });

    it('switches views when navigation items are clicked', async () => {
      render(<App />);

      // Default is Overview
      expect(screen.getByText('Daily Financial & Sales Pulse')).toBeInTheDocument();

      // Navigate to Inventory
      const inventoryBtn = screen.getAllByRole('button', { name: /Inventory/i })[0];
      fireEvent.click(inventoryBtn);
      await waitFor(() => {
        expect(screen.getByText('Merchandise & Inventory')).toBeInTheDocument();
      });

      // Navigate to Settings
      const settingsBtn = screen.getAllByRole('button', { name: /Settings/i })[0];
      fireEvent.click(settingsBtn);
      await waitFor(() => {
        expect(screen.getByText('System Settings & Profile')).toBeInTheDocument();
      });
    });
  });

  describe('3. Overview Dashboard & Real Data Invariants', () => {
    it('renders clean empty state when no records exist without fabricating data', async () => {
      render(<Overview onNavigate={vi.fn()} />);

      expect(screen.getByText(/Total Sales Revenue/i)).toBeInTheDocument();
      expect(screen.getAllByText('₦0.00').length).toBeGreaterThan(0);
      expect(screen.getByText('Welcome to your new Business Dashboard')).toBeInTheDocument();
    });

    it('calculates real financial metrics from seeded Dexie records', async () => {
      // Seed a customer
      await msme_ledger_db.customers.add({
        id: 'cust-1',
        name: 'Okonkwo Traders',
        phone: '08099998888',
        totalDebt: 300000, // ₦3,000.00
        sync_status: 'synced',
        updatedAt: new Date()
      });

      // Seed a sale (total: ₦10,000, paid: ₦7,000, debt: ₦3,000)
      await msme_ledger_db.sales.add({
        id: 'sale-1',
        customerId: 'cust-1',
        items: [{ inventoryId: 'inv-1', quantity: 2, price: 500000 }],
        totalAmount: 1000000, // ₦10,000.00
        amountPaid: 700000,   // ₦7,000.00
        balance: 300000,
        paymentStatus: 'partial',
        sync_status: 'synced',
        date: new Date()
      });

      render(<Overview onNavigate={vi.fn()} />);

      await waitFor(() => {
        // Gross sales revenue = ₦10,000.00
        expect(screen.getAllByText('₦10,000.00').length).toBeGreaterThan(0);
        // Cash collected = ₦7,000.00
        expect(screen.getByText('₦7,000.00')).toBeInTheDocument();
        // Receivables = ₦3,000.00
        expect(screen.getAllByText('₦3,000.00').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Okonkwo Traders').length).toBeGreaterThan(0);
      });
    });
  });

  describe('4. Sales / POS Workflow & Stock Integrity', () => {
    it('renders customer select and inventory catalog', async () => {
      await msme_ledger_db.customers.add({
        id: 'cust-pos-1',
        name: 'Mama Nkechi',
        phone: '08055556666',
        totalDebt: 0,
        sync_status: 'synced',
        updatedAt: new Date()
      });

      await msme_ledger_db.inventory.add({
        id: 'inv-pos-1',
        itemName: 'Golden Terra Oil 1L',
        price: 250000, // ₦2,500.00
        stockCount: 15,
        sync_status: 'synced',
        updatedAt: new Date()
      });

      render(<PointOfSale />);

      await waitFor(() => {
        expect(screen.getByText(/Golden Terra Oil 1L/i)).toBeInTheDocument();
        expect(screen.getByText('₦2,500.00')).toBeInTheDocument();
        expect(screen.getByText(/15 left/i)).toBeInTheDocument();
      });
    });

    it('adds product to cart, updates quantity, and performs sale checkout', async () => {
      await msme_ledger_db.customers.add({
        id: 'cust-pos-2',
        name: 'Chidi Motors',
        phone: '08077778888',
        totalDebt: 0,
        sync_status: 'synced',
        updatedAt: new Date()
      });

      await msme_ledger_db.inventory.add({
        id: 'inv-pos-2',
        itemName: 'Brake Pad Set',
        price: 800000, // ₦8,000.00
        stockCount: 10,
        sync_status: 'synced',
        updatedAt: new Date()
      });

      render(<PointOfSale />);

      await waitFor(() => {
        expect(screen.getByText('Brake Pad Set')).toBeInTheDocument();
      });

      // 1. Select Customer
      const customerSelect = screen.getByLabelText(/Select Customer/i);
      fireEvent.change(customerSelect, { target: { value: 'cust-pos-2' } });

      // 2. Add product to cart
      const addProductBtn = screen.getByText('Brake Pad Set');
      fireEvent.click(addProductBtn);

      // Verify cart shows 1 item, total ₦8,000.00
      await waitFor(() => {
        expect(screen.getAllByText('₦8,000.00').length).toBeGreaterThan(0);
      });

      // 3. Enter payment amount (₦8,000)
      const paymentInput = screen.getByPlaceholderText('0.00');
      fireEvent.change(paymentInput, { target: { value: '8000' } });

      // 4. Click Complete Sale
      const checkoutBtn = screen.getByRole('button', { name: /Complete Sale/i });
      fireEvent.click(checkoutBtn);

      // Verify sale recorded in Dexie
      await waitFor(async () => {
        const salesInDb = await msme_ledger_db.sales.toArray();
        expect(salesInDb.length).toBe(1);
        expect(salesInDb[0].totalAmount).toBe(800000);
        expect(salesInDb[0].amountPaid).toBe(800000);
        expect(salesInDb[0].paymentStatus).toBe('paid');

        // Stock deducted from 10 to 9
        const invInDb = await msme_ledger_db.inventory.get('inv-pos-2');
        expect(invInDb.stockCount).toBe(9);
      });
    });
  });

  describe('5. Credit Book & Financial Repayment Separation', () => {
    it('recording debt repayment reduces customer debt and does NOT create a sale record', async () => {
      // Seed customer with ₦5,000 debt
      await msme_ledger_db.customers.add({
        id: 'debtor-1',
        name: 'Pastor Gabriel',
        phone: '08011223344',
        totalDebt: 500000, // ₦5,000.00
        sync_status: 'synced',
        updatedAt: new Date()
      });

      render(<CreditBook />);

      await waitFor(() => {
        expect(screen.getByText('Pastor Gabriel')).toBeInTheDocument();
        expect(screen.getAllByText('₦5,000.00').length).toBeGreaterThan(0);
      });

      // Click "Record Payment" button
      const recordPayBtn = screen.getByRole('button', { name: /Record Payment/i });
      fireEvent.click(recordPayBtn);

      // Enter partial repayment of ₦2,000
      await waitFor(() => {
        expect(screen.getByText(/Record Repayment: Pastor Gabriel/i)).toBeInTheDocument();
      });

      const amountInput = screen.getByPlaceholderText('0.00');
      fireEvent.change(amountInput, { target: { value: '2000' } });

      const saveRepayBtn = screen.getByRole('button', { name: /Save Repayment/i });
      fireEvent.click(saveRepayBtn);

      await waitFor(async () => {
        // Customer debt reduced from ₦5,000 to ₦3,000 (300,000 kobo)
        const updatedCustomer = await msme_ledger_db.customers.get('debtor-1');
        expect(updatedCustomer.totalDebt).toBe(300000);

        // Repayment recorded in transactions table
        const txs = await msme_ledger_db.transactions.toArray();
        expect(txs.length).toBe(1);
        expect(txs[0].type).toBe('PAYMENT');
        expect(txs[0].amount).toBe(200000);

        // FINANCIAL INVARIANT: Zero new sales were created!
        const sales = await msme_ledger_db.sales.toArray();
        expect(sales.length).toBe(0);
      });
    });
  });

  describe('6. Reports Financial Integrity', () => {
    it('displays gross sales, cash inflows, and disclosure on cost accounting', async () => {
      await msme_ledger_db.sales.add({
        id: 'sale-rep-1',
        customerId: 'cust-1',
        items: [{ inventoryId: 'inv-1', quantity: 1, price: 400000 }],
        totalAmount: 400000, // ₦4,000.00
        amountPaid: 400000,
        balance: 0,
        paymentStatus: 'paid',
        sync_status: 'synced',
        date: new Date()
      });

      render(<Reports />);

      await waitFor(() => {
        expect(screen.getByText('Business Financial Statements')).toBeInTheDocument();
        expect(screen.getAllByText('₦4,000.00').length).toBeGreaterThan(0);
        // Financial disclosure visible
        expect(screen.getByText(/Unknown historical costs are never assumed or calculated as zero/i)).toBeInTheDocument();
      });
    });
  });

  describe('7. Settings Business Identity & Offline Metrics', () => {
    it('allows updating shop name and displays local storage record counts', async () => {
      render(<Settings />);

      await waitFor(() => {
        expect(screen.getByText('System Settings & Profile')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Ikeja Supermarket')).toBeInTheDocument();
        expect(screen.getByDisplayValue('NGN (Nigerian Naira - ₦)')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Integer Kobo (100 Kobo = ₦1)')).toBeInTheDocument();
      });

      // Change shop name
      const shopInput = screen.getByDisplayValue('Ikeja Supermarket');
      fireEvent.change(shopInput, { target: { value: 'Lagos Island Mega Store' } });

      const saveBtn = screen.getByRole('button', { name: /Save Store Profile/i });
      fireEvent.click(saveBtn);

      expect(window.localStorage.getItem('shopName')).toBe('Lagos Island Mega Store');
      expect(screen.getByText(/Shop name updated successfully/i)).toBeInTheDocument();
    });
  });
});
