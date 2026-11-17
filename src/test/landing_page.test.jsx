import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LandingPage from '../components/LandingPage.jsx';

describe('Landing Page & Merchant User Guide Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    window.alert = vi.fn();
  });

  describe('1. Explaining What the Site is About', () => {
    it('renders the core branding and site description', () => {
      render(<LandingPage onComplete={vi.fn()} />);

      // Brand & Headline
      expect(screen.getAllByText('MSME Ledger').length).toBeGreaterThan(0);
      expect(
        screen.getByText(/Say Goodbye to Lost Debt Books and Missing Inventory/i)
      ).toBeDefined();
      expect(
        screen.getByText(/The offline-first operating system for retail stores, agro-dealers, and small merchants/i)
      ).toBeDefined();

      // Core value pillars
      expect(screen.getByText('100% Offline-First')).toBeDefined();
      expect(screen.getByText('WhatsApp Debt Recovery')).toBeDefined();
      expect(screen.getByText('Zero Card Auto-Debits')).toBeDefined();
    });

    it('renders the 6 core business features explaining site capabilities', () => {
      render(<LandingPage onComplete={vi.fn()} />);

      expect(screen.getByText('Fast Point of Sale (POS)')).toBeDefined();
      expect(screen.getByText('Customer Credit Book')).toBeDefined();
      expect(screen.getByText('Scale-1000 Precision Stock')).toBeDefined();
      expect(screen.getByText('Expense & Overhead Tracking')).toBeDefined();
      expect(screen.getByText('Unified Business Book')).toBeDefined();
      expect(screen.getByText('Safe Offline-to-Cloud Sync')).toBeDefined();
    });

    it('renders the 9 integrated modules overview', () => {
      render(<LandingPage onComplete={vi.fn()} />);

      expect(screen.getByText('Overview Dashboard')).toBeDefined();
      expect(screen.getByText('Sales / Point of Sale')).toBeDefined();
      expect(screen.getByText('Credit Book')).toBeDefined();
      expect(screen.getByText('Inventory Control')).toBeDefined();
      expect(screen.getByText('Business Activity Book')).toBeDefined();
      expect(screen.getByText('Customer Directory')).toBeDefined();
      expect(screen.getByText('Expense Ledger')).toBeDefined();
      expect(screen.getByText('Financial Reports')).toBeDefined();
      expect(screen.getByText('Settings & Security')).toBeDefined();
    });
  });

  describe('2. How to Use MSME Ledger (Step-by-Step Interactive Guide)', () => {
    it('renders the 5 step-by-step practical guides and allows navigating between them', () => {
      render(<LandingPage onComplete={vi.fn()} />);

      // Verify all 5 steps are listed in the navigator
      expect(screen.getAllByText('Quick 30-Second Shop Setup').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Add Products & Track Stock')).toBeDefined();
      expect(screen.getByText('Ring Up Sales at the POS Terminal')).toBeDefined();
      expect(screen.getByText('Recover Debts with 1-Click WhatsApp Reminders')).toBeDefined();
      expect(screen.getByText('Track Expenses & Review Daily Profits')).toBeDefined();

      // Step 01 is active by default
      expect(screen.getByText(/Enter your shop name once/i)).toBeDefined();

      // Switch to Step 02 (Inventory)
      fireEvent.click(screen.getByText('Add Products & Track Stock'));
      expect(screen.getByText(/Open the Inventory tab to enter product names/i)).toBeDefined();
      expect(screen.getByText(/Go to Inventory → "\+ Add Product"/i)).toBeDefined();

      // Switch to Step 03 (POS)
      fireEvent.click(screen.getByText('Ring Up Sales at the POS Terminal'));
      expect(screen.getByText(/On the POS screen, tap items to add to the cart/i)).toBeDefined();

      // Switch to Step 04 (WhatsApp debt recovery)
      fireEvent.click(screen.getByText('Recover Debts with 1-Click WhatsApp Reminders'));
      expect(screen.getByText(/Tap the green WhatsApp button next to any debtor/i)).toBeDefined();

      // Switch to Step 05 (Expenses & Profits)
      fireEvent.click(screen.getByText('Track Expenses & Review Daily Profits'));
      expect(screen.getByText(/Record everyday shop overheads—like generator fuel/i)).toBeDefined();
    });
  });

  describe('3. Transparent Pricing & FAQ Accordion', () => {
    it('explains transparent manual bank transfer pricing without card deductions', () => {
      render(<LandingPage onComplete={vi.fn()} />);

      expect(screen.getByText(/No Cards\. No Hidden Debits\. Simple Bank Transfer\./i)).toBeDefined();
      expect(screen.getByText('Free 30-Day Trial')).toBeDefined();
      expect(screen.getByText('Pro Store')).toBeDefined();
      expect(screen.getByText('Enterprise')).toBeDefined();
      expect(screen.getByText('₦5,000')).toBeDefined();
      expect(screen.getByText('₦15,000')).toBeDefined();
    });

    it('toggles FAQ questions open and closed', () => {
      render(<LandingPage onComplete={vi.fn()} />);

      const faqQuestion = screen.getByText('Does MSME Ledger really work 100% without internet?');
      expect(faqQuestion).toBeDefined();

      // Answer is hidden initially
      expect(screen.queryByText(/Unlike conventional web applications that freeze/i)).toBeNull();

      // Click to open
      fireEvent.click(faqQuestion);
      expect(screen.getByText(/Unlike conventional web applications that freeze/i)).toBeDefined();

      // Click again to close
      fireEvent.click(faqQuestion);
      expect(screen.queryByText(/Unlike conventional web applications that freeze/i)).toBeNull();
    });
  });

  describe('4. User Journey & Navigation Call to Actions', () => {
    it('opens Onboarding setup when no shopName is configured in localStorage', () => {
      const onCompleteMock = vi.fn();
      render(<LandingPage onComplete={onCompleteMock} />);

      const startBtn = screen.getByRole('button', { name: /Start Free 30-Day Setup/i });
      fireEvent.click(startBtn);

      // Onboarding component is now visible
      expect(screen.getByText('Welcome to MSME Ledger')).toBeDefined();
      expect(screen.getByLabelText(/Shop Name/i)).toBeDefined();

      // User enters shop name and completes
      const input = screen.getByLabelText(/Shop Name/i);
      fireEvent.change(input, { target: { value: 'Greenfield Retail' } });
      fireEvent.click(screen.getByRole('button', { name: /Start Managing Sales/i }));

      expect(localStorage.getItem('shopName')).toBe('Greenfield Retail');
      expect(onCompleteMock).toHaveBeenCalledTimes(1);
    });

    it('renders "Open [Shop Name]" and triggers onLaunchApp when shopName already exists', () => {
      localStorage.setItem('shopName', 'Danladi Agro Ventures');
      const onLaunchAppMock = vi.fn();

      render(<LandingPage onLaunchApp={onLaunchAppMock} />);

      // Button in header and hero
      const openBtns = screen.getAllByRole('button', { name: /Open Danladi Agro Ventures/i });
      expect(openBtns.length).toBeGreaterThan(0);

      fireEvent.click(openBtns[0]);
      expect(onLaunchAppMock).toHaveBeenCalledTimes(1);
    });
  });
});
