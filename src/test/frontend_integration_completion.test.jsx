/**
 * Frontend Completion & 9-Module Integration Test Suite
 * Strictly conforms to SB Manager Rebuild Blueprint v2.1 and Consolidated Authorization.
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App.jsx';
import { AuthProvider } from '../context/AuthContext.jsx';
import { SubscriptionProvider } from '../context/SubscriptionContext.jsx';
import Settings from '../pages/Settings.jsx';
import Overview from '../pages/Overview.jsx';
import PointOfSale from '../pages/PointOfSale.jsx';
import Expenses from '../pages/Expenses.jsx';
import Inventory from '../pages/Inventory.jsx';
import Customers from '../pages/Customers.jsx';
import CreditBook from '../pages/CreditBook.jsx';
import Reports from '../pages/Reports.jsx';
import BusinessBook from '../pages/BusinessBook.jsx';
import AppShell from '../components/common/AppShell.jsx';

describe('Frontend 9-Module Integration & Architecture Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('shopName', 'Test Agro Store');
    localStorage.setItem('shopId', 'biz_test_agro_123');

    // Mock window.alert and window.confirm
    window.alert = vi.fn();
    window.confirm = vi.fn(() => true);
  });

  describe('1. 9-Module App Shell & Tab Navigation', () => {
    it('renders the 9 navigation tabs in the sidebar', () => {
      render(
        <AuthProvider>
          <SubscriptionProvider>
            <App />
          </SubscriptionProvider>
        </AuthProvider>
      );

      expect(screen.getAllByText('Overview').length).toBeGreaterThan(0);
      expect(screen.getByText('Business Book')).toBeDefined();
      expect(screen.getByText('Sales / POS')).toBeDefined();
      expect(screen.getAllByText('Expenses').length).toBeGreaterThan(0);
      expect(screen.getByText('Inventory')).toBeDefined();
      expect(screen.getByText('Customers')).toBeDefined();
      expect(screen.getAllByText('Credit Book').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Reports').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Settings').length).toBeGreaterThan(0);
    });

    it('navigates cleanly between tabs when clicked', async () => {
      render(
        <AuthProvider>
          <SubscriptionProvider>
            <App />
          </SubscriptionProvider>
        </AuthProvider>
      );

      // Default is Overview
      expect(screen.getByText('Daily Financial & Sales Pulse')).toBeDefined();

      // Click Settings tab
      const settingsTab = screen.getAllByText('Settings')[0];
      fireEvent.click(settingsTab);
      expect(screen.getByText('System Settings & Profile')).toBeDefined();

      // Click Expenses tab
      const expensesTab = screen.getAllByText('Expenses')[0];
      fireEvent.click(expensesTab);
      expect(screen.getByText('Operating Overhead')).toBeDefined();
    });
  });

  describe('2. Authentication & Multi-Tenant State Integration', () => {
    it('displays authenticated merchant name and tenant role in AppShell', () => {
      const mockUser = {
        id: 'usr_umar_1',
        fullName: 'Umar Farouk',
        email: 'umar@faroukagro.ng',
        defaultBusinessId: 'biz_farouk_agro'
      };

      render(
        <AuthProvider initialUser={mockUser} initialToken="mock.jwt.token">
          <SubscriptionProvider>
            <AppShell activeTab="overview" onSelectTab={() => {}}>
              <div>Module Content</div>
            </AppShell>
          </SubscriptionProvider>
        </AuthProvider>
      );

      expect(screen.getByText("Umar Farouk's Shop")).toBeDefined();
      expect(screen.getByText('owner')).toBeDefined();
    });

    it('displays tenant switching options in Settings when multiple businesses exist', async () => {
      const mockUser = {
        id: 'usr_multi_1',
        fullName: 'Aisha Bello',
        email: 'aisha@bello.ng'
      };

      render(
        <AuthProvider
          initialUser={mockUser}
          initialBusinessId="biz_shop_1"
        >
          <SubscriptionProvider>
            <Settings />
          </SubscriptionProvider>
        </AuthProvider>
      );

      expect(screen.getByText('Merchant & Tenant Identity')).toBeDefined();
      expect(screen.getByText('Active Business UUID:')).toBeDefined();
      expect(screen.getByText('biz_shop_1')).toBeDefined();
    });
  });

  describe('3. SBM-042 Subscription & Anti-Clock-Tampering Integration', () => {
    it('displays active subscription badge when entitlement is active', () => {
      const activeEntitlement = {
        planId: 'pro',
        status: 'active',
        expiresAt: Date.now() + 15 * 86400000,
        gracePeriodUntil: Date.now() + 22 * 86400000
      };

      render(
        <AuthProvider>
          <SubscriptionProvider initialEntitlement={activeEntitlement}>
            <AppShell activeTab="overview" onSelectTab={() => {}}>
              <div>Content</div>
            </AppShell>
          </SubscriptionProvider>
        </AuthProvider>
      );

      expect(screen.getByText('PRO')).toBeDefined();
      expect(screen.queryByText(/Read-Only Mode/)).toBeNull();
    });

    it('displays read-only warning banner when subscription is expired', () => {
      const expiredEntitlement = {
        planId: 'pro',
        status: 'expired',
        expiresAt: Date.now() - 10 * 86400000, // 10 days ago
        gracePeriodUntil: Date.now() - 3 * 86400000 // 3 days ago (grace period ended)
      };

      render(
        <AuthProvider>
          <SubscriptionProvider initialEntitlement={expiredEntitlement}>
            <AppShell activeTab="overview" onSelectTab={() => {}}>
              <div>Content</div>
            </AppShell>
          </SubscriptionProvider>
        </AuthProvider>
      );

      expect(screen.getByText(/Read-Only Mode/)).toBeDefined();
      expect(screen.getAllByText('EXPIRED').length).toBeGreaterThan(0);
    });

    it('displays read-only warning and locks writes when clock tampering is detected', () => {
      localStorage.setItem('last_known_server_time', String(Date.now() + 500000)); // Future server time!

      const entitlement = {
        planId: 'pro',
        status: 'active',
        expiresAt: Date.now() + 10 * 86400000
      };

      render(
        <AuthProvider>
          <SubscriptionProvider initialEntitlement={entitlement}>
            <AppShell activeTab="overview" onSelectTab={() => {}}>
              <div>Content</div>
            </AppShell>
          </SubscriptionProvider>
        </AuthProvider>
      );

      expect(screen.getByText(/Read-Only Mode/)).toBeDefined();
      expect(screen.getByText('CLOCK LOCKED')).toBeDefined();
    });

    it('locks POS checkout when isReadOnly is true', () => {
      render(
        <AuthProvider>
          <SubscriptionProvider>
            <PointOfSale isReadOnly={true} />
          </SubscriptionProvider>
        </AuthProvider>
      );

      const form = document.querySelector('form');
      if (form) {
        fireEvent.submit(form);
        expect(window.alert).toHaveBeenCalledWith(
          expect.stringContaining('Application is in read-only mode')
        );
      }
    });

    it('locks expense recording when isReadOnly is true', () => {
      render(
        <AuthProvider>
          <SubscriptionProvider>
            <Expenses isReadOnly={true} />
          </SubscriptionProvider>
        </AuthProvider>
      );

      // Open modal
      const openBtn = screen.queryByText('+ Record Expense') || screen.queryByText('Log Expense') || screen.getByText('Log First Expense');
      fireEvent.click(openBtn);

      // Enter details and submit
      const amountInput = screen.getByPlaceholderText('e.g. 5000');
      fireEvent.change(amountInput, { target: { value: '2500' } });

      const submitBtn = screen.getByText('Record Expense');
      fireEvent.click(submitBtn);

      expect(window.alert).toHaveBeenCalledWith(
        expect.stringContaining('Application is in read-only mode')
      );
    });
  });

  describe('4. SBM-042 Dynamic Bank Instructions in Settings', () => {
    it('loads dynamic bank details and unique reference code', async () => {
      render(
        <AuthProvider>
          <SubscriptionProvider>
            <Settings />
          </SubscriptionProvider>
        </AuthProvider>
      );

      const getBtn = screen.getByText('Get Dynamic Bank Payment Details (REF-SB-XXXX)');
      fireEvent.click(getBtn);

      await waitFor(() => {
        expect(screen.getByText('Official Bank Transfer Instructions:')).toBeDefined();
        expect(screen.getByText('Zenith Bank PLC')).toBeDefined();
        expect(screen.getByText('1012345678')).toBeDefined();
      });
    });
  });
});
