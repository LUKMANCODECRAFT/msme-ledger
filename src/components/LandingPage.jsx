import React, { useState, useEffect } from 'react';
import Onboarding from './Onboarding.jsx';

export default function LandingPage({ onComplete, onLaunchApp }) {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [activeGuideStep, setActiveGuideStep] = useState(0);
  const [activeModuleIndex, setActiveModuleIndex] = useState(0);
  const [openFaqIndex, setOpenFaqIndex] = useState(null);
  const [existingShopName, setExistingShopName] = useState(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('shopName');
      if (stored && stored.trim()) {
        setExistingShopName(stored.trim());
      }
    } catch {
      // Ignore localStorage access issues in restricted contexts
    }
  }, []);

  const handlePrimaryAction = () => {
    if (existingShopName) {
      if (typeof onLaunchApp === 'function') {
        onLaunchApp();
      } else if (typeof onComplete === 'function') {
        onComplete();
      }
    } else {
      setShowOnboarding(true);
    }
  };

  if (showOnboarding) {
    return (
      <Onboarding
        onComplete={() => {
          if (typeof onComplete === 'function') onComplete();
          if (typeof onLaunchApp === 'function') onLaunchApp();
        }}
      />
    );
  }

  // 5 Step-by-Step Practical Guides on How to Use the System
  const GUIDE_STEPS = [
    {
      step: '01',
      title: 'Quick 30-Second Shop Setup',
      badge: 'Getting Started',
      summary: 'Set up your retail business instantly with zero friction.',
      details:
        'Enter your shop name once. Your local, private database is immediately created inside your browser or device storage. No credit card, no personal phone verification, and no upfront payment required.',
      actionHint: 'Click "Start Setup" to initialize your local store catalog in seconds.',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      )
    },
    {
      step: '02',
      title: 'Add Products & Track Stock',
      badge: 'Inventory Management',
      summary: 'Register inventory with milligram scale-1000 precision.',
      details:
        'Open the Inventory tab to enter product names, selling prices in Naira, and opening stock counts. The system supports whole retail pieces and fractional quantities (e.g. fertilizer, grains, liquids) with automatic low-stock alerts.',
      actionHint: 'Go to Inventory → "+ Add Product" to add items with selling prices and stock.',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      )
    },
    {
      step: '03',
      title: 'Ring Up Sales at the POS Terminal',
      badge: 'Point of Sale',
      summary: 'Checkout cash, transfer, and credit customers in seconds.',
      details:
        'On the POS screen, tap items to add to the cart. Select an existing customer or add a new one. Choose whether the customer pays in Full Cash, Bank Transfer, or takes goods on Credit / Part-Payment. Stock is automatically deducted.',
      actionHint: 'Go to Sales / POS → Tap items → Select Customer → Click Checkout.',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      )
    },
    {
      step: '04',
      title: 'Recover Debts with 1-Click WhatsApp Reminders',
      badge: 'Credit Recovery',
      summary: 'Kill messy paper notebooks and collect owed money faster.',
      details:
        'Open the Credit Book tab to see every customer with an outstanding balance. Tap the green WhatsApp button next to any debtor. MSME Ledger instantly generates a polite, personalized message with their exact debt amount and your bank details.',
      actionHint: 'Go to Credit Book → Find debtor → Tap WhatsApp icon to send payment reminder.',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      )
    },
    {
      step: '05',
      title: 'Track Expenses & Review Daily Profits',
      badge: 'Financial Pulse',
      summary: 'Know your true net profit after fuel, rent, and overheads.',
      details:
        'Record everyday shop overheads—like generator fuel, shop rent, logistics, and vendor restocking—in the Expenses tab. Check the Overview dashboard at closing time to review total revenue, profit margins, and pending cloud sync status.',
      actionHint: 'Review Overview at closing time to see today’s total sales and net profit.',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      )
    }
  ];

  // 9 Integrated Modules Overview
  const MODULES = [
    {
      name: 'Overview Dashboard',
      description: 'Your morning and evening business cockpit: real-time sales revenue, gross margin, credit receivables, and recent transaction stream.',
      icon: '📊'
    },
    {
      name: 'Sales / Point of Sale',
      description: 'Fast barcode or touchscreen cashier register. Build shopping carts, apply discounts, select customers, and ring up sales in seconds.',
      icon: '🛒'
    },
    {
      name: 'Credit Book',
      description: 'Receivables management engine. Track customer credit balances in exact Kobo and generate 1-click WhatsApp payment reminders.',
      icon: '📒'
    },
    {
      name: 'Inventory Control',
      description: 'High-precision stock ledger with scale-1000 support for fractional units, low-stock reorder warnings, and durable stock movements.',
      icon: '📦'
    },
    {
      name: 'Business Activity Book',
      description: 'An immutable, chronological log of every sale, customer payment, credit extension, and stock adjustment.',
      icon: '📑'
    },
    {
      name: 'Customer Directory',
      description: 'Full customer contact rolodex, cumulative lifetime spend, individual debt balances, and past sales histories.',
      icon: '👥'
    },
    {
      name: 'Expense Ledger',
      description: 'Categorized overhead tracking for shop rent, generator diesel, transport, wages, and vendor restocking.',
      icon: '💸'
    },
    {
      name: 'Financial Reports',
      description: 'Clean financial statements, profit & loss analysis, product sales volume breakdowns, and inventory valuation.',
      icon: '📈'
    },
    {
      name: 'Settings & Security',
      description: 'Store identity, offline database backups, manual bank-transfer subscriptions, and tenant collaboration settings.',
      icon: '⚙️'
    }
  ];

  // Frequently Asked Questions
  const FAQS = [
    {
      q: 'Does MSME Ledger really work 100% without internet?',
      a: 'Yes! Unlike conventional web applications that freeze when the network drops, MSME Ledger is built offline-first. Your entire catalog, customer balances, and sales register live directly on your local device database (IndexedDB). You can ring up sales, add stock, and log expenses in deep rural markets with zero internet connectivity.'
    },
    {
      q: 'How does debt recovery over WhatsApp work?',
      a: 'When you record a sale where the customer pays partially or on credit, their debt balance is calculated automatically. In the Credit Book, clicking the WhatsApp button opens WhatsApp with a pre-written, polite reminder mentioning their exact outstanding debt in Naira and your shop’s bank account details for instant transfer.'
    },
    {
      q: 'Will I lose my records if my phone or computer restarts?',
      a: 'No. All transactions, inventory changes, and customer records are written to durable, crash-safe local storage using transactional sagas. Even during abrupt power outages, your records remain intact. When an internet connection becomes available, your records automatically sync to the secure cloud.'
    },
    {
      q: 'How does subscription payment work? Are there recurring card charges?',
      a: 'We strictly reject automated recurring card debits. Subscriptions are handled via transparent manual bank transfer. You request dynamic instructions with a unique reference code (REF-SB-XXXX), transfer directly from your bank app, and submit your reference. Once verified by our team, your offline entitlement token is issued.'
    },
    {
      q: 'Can multiple cashiers or staff use the app simultaneously?',
      a: 'Yes! MSME Ledger features multi-tenant role authorization (Owner, Manager, Cashier, Accountant). Staff can ring up sales while keeping sensitive financial reports and owner settings protected.'
    }
  ];

  return (
    <div className="min-h-screen bg-[#FDFBF7] text-[#1E2321] font-sans selection:bg-[#D8ECE1] selection:text-[#1B4332]">
      {/* --------------------------------------------------------------------- */}
      {/* 1. Top Navigation Bar */}
      {/* --------------------------------------------------------------------- */}
      <header className="sticky top-0 z-50 bg-[#FDFBF7]/95 backdrop-blur-md border-b border-[#E5DCC5]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          {/* Brand Logo & Name */}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#1B4332] text-[#FDFBF7] flex items-center justify-center font-black text-xl shadow-md border border-[#143621]">
              ₦
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-black text-[#1E2321] tracking-tight">MSME Ledger</span>
                <span className="text-2xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#D8ECE1] text-[#1B4332] border border-[#B2DAC5]">
                  Offline-First
                </span>
              </div>
              <p className="text-xs text-[#5C6460] font-medium hidden sm:block">Smart Retail Ledger & POS Operating System</p>
            </div>
          </div>

          {/* Quick Nav Anchor Links */}
          <nav className="hidden md:flex items-center gap-8 text-sm font-bold text-[#5C6460]">
            <a href="#about" className="hover:text-[#1B4332] transition-colors">What It Is</a>
            <a href="#how-to-use" className="hover:text-[#1B4332] transition-colors">How To Use</a>
            <a href="#modules" className="hover:text-[#1B4332] transition-colors">Modules</a>
            <a href="#offline" className="hover:text-[#1B4332] transition-colors">Why Offline</a>
            <a href="#pricing" className="hover:text-[#1B4332] transition-colors">Pricing</a>
            <a href="#faq" className="hover:text-[#1B4332] transition-colors">FAQ</a>
          </nav>

          {/* Action CTAs */}
          <div className="flex items-center gap-3">
            {existingShopName ? (
              <button
                type="button"
                onClick={handlePrimaryAction}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1B4332] text-[#FDFBF7] text-sm font-bold shadow-md hover:bg-[#22573F] active:bg-[#143621] transition-all transform active:scale-95"
              >
                <span>Open {existingShopName}</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePrimaryAction}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1B4332] text-[#FDFBF7] text-sm font-bold shadow-md hover:bg-[#22573F] active:bg-[#143621] transition-all transform active:scale-95"
              >
                <span>Launch App Free</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* --------------------------------------------------------------------- */}
      {/* 2. Hero Section */}
      {/* --------------------------------------------------------------------- */}
      <section className="relative pt-12 pb-20 md:pt-20 md:pb-28 overflow-hidden bg-gradient-to-b from-[#FDFBF7] via-[#F7F4EB] to-[#FDFBF7] border-b border-[#E5DCC5]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          {/* Announcement Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#D8ECE1] text-[#1B4332] border border-[#B2DAC5] text-xs font-black tracking-wide uppercase mb-6 shadow-xs">
            <span className="w-2 h-2 rounded-full bg-[#1B4332] animate-pulse"></span>
            Zero Internet Needed • Built for Retail MSMEs
          </div>

          {/* Main Headline */}
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black text-[#141816] tracking-tight leading-[1.15] mb-6 max-w-4xl mx-auto">
            Say Goodbye to Lost Debt Books and Missing Inventory.
          </h1>

          {/* Subtitle */}
          <p className="text-lg sm:text-xl text-[#363C39] font-medium max-w-3xl mx-auto leading-relaxed mb-10">
            MSME Ledger is the offline-first operating system for retail stores, agro-dealers, and small merchants.
            Ring up sales in seconds without internet, track stock with milligram precision, and recover customer debts over WhatsApp with a single click.
          </p>

          {/* Primary Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-md mx-auto mb-14">
            <button
              type="button"
              onClick={handlePrimaryAction}
              className="w-full sm:w-auto px-8 py-4 rounded-xl bg-[#1B4332] text-[#FDFBF7] text-lg font-black shadow-lg hover:bg-[#22573F] active:bg-[#143621] transition-all transform active:scale-95 border border-[#143621]"
            >
              {existingShopName ? `Go to ${existingShopName} Dashboard` : 'Start Free 30-Day Setup'}
            </button>
            <a
              href="#how-to-use"
              className="w-full sm:w-auto px-7 py-4 rounded-xl bg-[#F7F4EB] text-[#1E2321] text-base font-bold border border-[#E5DCC5] hover:bg-[#EFE9DA] hover:border-[#D5C8AB] transition-colors text-center"
            >
              How It Works ↓
            </a>
          </div>

          {/* 3 Core Value Pillars */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto text-left">
            <div className="bg-[#FAF6EE] p-6 rounded-2xl border border-[#E5DCC5] shadow-xs hover:border-[#1B4332] transition-colors">
              <div className="w-10 h-10 rounded-lg bg-[#D8ECE1] text-[#1B4332] flex items-center justify-center font-bold text-lg mb-3">
                ⚡
              </div>
              <h3 className="font-black text-[#141816] text-lg mb-1">100% Offline-First</h3>
              <p className="text-[#5C6460] text-sm font-medium leading-normal">
                Never stop selling when power goes out or telecom networks fail. All transactions save locally to your device immediately.
              </p>
            </div>

            <div className="bg-[#FAF6EE] p-6 rounded-2xl border border-[#E5DCC5] shadow-xs hover:border-[#1B4332] transition-colors">
              <div className="w-10 h-10 rounded-lg bg-[#D8ECE1] text-[#1B4332] flex items-center justify-center font-bold text-lg mb-3">
                💬
              </div>
              <h3 className="font-black text-[#141816] text-lg mb-1">WhatsApp Debt Recovery</h3>
              <p className="text-[#5C6460] text-sm font-medium leading-normal">
                No more awkward calls or forgotten balances. Send polite, formatted WhatsApp reminders with your shop bank account in 1 tap.
              </p>
            </div>

            <div className="bg-[#FAF6EE] p-6 rounded-2xl border border-[#E5DCC5] shadow-xs hover:border-[#1B4332] transition-colors">
              <div className="w-10 h-10 rounded-lg bg-[#D8ECE1] text-[#1B4332] flex items-center justify-center font-bold text-lg mb-3">
                🔒
              </div>
              <h3 className="font-black text-[#141816] text-lg mb-1">Zero Card Auto-Debits</h3>
              <p className="text-[#5C6460] text-sm font-medium leading-normal">
                We believe in merchant sovereignty. No hidden recurring card deductions. Subscriptions use transparent manual bank transfer.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------------- */}
      {/* 3. "What is MSME Ledger?" (Explaining what the site is about) */}
      {/* --------------------------------------------------------------------- */}
      <section id="about" className="py-20 bg-[#FDFBF7] border-b border-[#E5DCC5]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-xs font-black uppercase tracking-wider text-[#1B4332] bg-[#D8ECE1] px-3 py-1 rounded-full border border-[#B2DAC5]">
              What Is MSME Ledger?
            </span>
            <h2 className="text-3xl sm:text-4xl font-black text-[#141816] mt-4 mb-4 tracking-tight">
              A Complete Business Operating System for African Merchants
            </h2>
            <p className="text-base sm:text-lg text-[#5C6460] font-medium leading-relaxed">
              Paper notebooks get water-damaged, lost, or misplaced. Spreadsheets are too complex for busy checkout counters.
              MSME Ledger gives you the speed of a modern cash register with the precision of an audited accounting ledger.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="bg-[#FAF6EE] p-8 rounded-2xl border border-[#E5DCC5] flex flex-col justify-between hover:shadow-md transition-shadow">
              <div>
                <div className="w-12 h-12 rounded-xl bg-[#1B4332] text-[#FDFBF7] flex items-center justify-center font-black text-xl mb-5">
                  🛒
                </div>
                <h3 className="text-xl font-black text-[#141816] mb-2">Fast Point of Sale (POS)</h3>
                <p className="text-[#363C39] text-sm leading-relaxed mb-4">
                  Cashiers can add items to carts, calculate change, apply discounts, and split payments across cash, bank transfer, and credit within seconds.
                </p>
              </div>
              <div className="pt-4 border-t border-[#E5DCC5] text-xs font-bold text-[#1B4332] flex items-center gap-1">
                <span>Instant receipts & cart totals</span>
              </div>
            </div>

            {/* Feature 2 */}
            <div className="bg-[#FAF6EE] p-8 rounded-2xl border border-[#E5DCC5] flex flex-col justify-between hover:shadow-md transition-shadow">
              <div>
                <div className="w-12 h-12 rounded-xl bg-[#1B4332] text-[#FDFBF7] flex items-center justify-center font-black text-xl mb-5">
                  📒
                </div>
                <h3 className="text-xl font-black text-[#141816] mb-2">Customer Credit Book</h3>
                <p className="text-[#363C39] text-sm leading-relaxed mb-4">
                  Track customer debt down to the exact Kobo. Records who took what, when it was taken, and how much has been repaid. Eliminate disputes forever.
                </p>
              </div>
              <div className="pt-4 border-t border-[#E5DCC5] text-xs font-bold text-[#1B4332] flex items-center gap-1">
                <span>Zero forgotten receivables</span>
              </div>
            </div>

            {/* Feature 3 */}
            <div className="bg-[#FAF6EE] p-8 rounded-2xl border border-[#E5DCC5] flex flex-col justify-between hover:shadow-md transition-shadow">
              <div>
                <div className="w-12 h-12 rounded-xl bg-[#1B4332] text-[#FDFBF7] flex items-center justify-center font-black text-xl mb-5">
                  📦
                </div>
                <h3 className="text-xl font-black text-[#141816] mb-2">Scale-1000 Precision Stock</h3>
                <p className="text-[#363C39] text-sm leading-relaxed mb-4">
                  Engineered for agricultural and bulk retail. Supports fractional quantities (milligrams, grams, kilograms, liters) with tamper-resistant stock deductions.
                </p>
              </div>
              <div className="pt-4 border-t border-[#E5DCC5] text-xs font-bold text-[#1B4332] flex items-center gap-1">
                <span>Scale-1000 integer math</span>
              </div>
            </div>

            {/* Feature 4 */}
            <div className="bg-[#FAF6EE] p-8 rounded-2xl border border-[#E5DCC5] flex flex-col justify-between hover:shadow-md transition-shadow">
              <div>
                <div className="w-12 h-12 rounded-xl bg-[#1B4332] text-[#FDFBF7] flex items-center justify-center font-black text-xl mb-5">
                  💸
                </div>
                <h3 className="text-xl font-black text-[#141816] mb-2">Expense & Overhead Tracking</h3>
                <p className="text-[#363C39] text-sm leading-relaxed mb-4">
                  Record generator fuel, shop rent, transport fees, and supplier payments. See your true net profit rather than misleading gross sales figures.
                </p>
              </div>
              <div className="pt-4 border-t border-[#E5DCC5] text-xs font-bold text-[#1B4332] flex items-center gap-1">
                <span>True profit calculation</span>
              </div>
            </div>

            {/* Feature 5 */}
            <div className="bg-[#FAF6EE] p-8 rounded-2xl border border-[#E5DCC5] flex flex-col justify-between hover:shadow-md transition-shadow">
              <div>
                <div className="w-12 h-12 rounded-xl bg-[#1B4332] text-[#FDFBF7] flex items-center justify-center font-black text-xl mb-5">
                  📑
                </div>
                <h3 className="text-xl font-black text-[#141816] mb-2">Unified Business Book</h3>
                <p className="text-[#363C39] text-sm leading-relaxed mb-4">
                  A transparent chronological ledger detailing every financial event. Review sales receipts, customer debt settlements, and expense receipts in one stream.
                </p>
              </div>
              <div className="pt-4 border-t border-[#E5DCC5] text-xs font-bold text-[#1B4332] flex items-center gap-1">
                <span>Audited activity ledger</span>
              </div>
            </div>

            {/* Feature 6 */}
            <div className="bg-[#FAF6EE] p-8 rounded-2xl border border-[#E5DCC5] flex flex-col justify-between hover:shadow-md transition-shadow">
              <div>
                <div className="w-12 h-12 rounded-xl bg-[#1B4332] text-[#FDFBF7] flex items-center justify-center font-black text-xl mb-5">
                  ☁️
                </div>
                <h3 className="text-xl font-black text-[#141816] mb-2">Safe Offline-to-Cloud Sync</h3>
                <p className="text-[#363C39] text-sm leading-relaxed mb-4">
                  Operate entirely offline with full confidence. As soon as your device connects to mobile data or Wi-Fi, pending records sync automatically in the background.
                </p>
              </div>
              <div className="pt-4 border-t border-[#E5DCC5] text-xs font-bold text-[#1B4332] flex items-center gap-1">
                <span>Automatic background sync</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------------- */}
      {/* 4. "How to Use MSME Ledger" (Step-by-Step Interactive Guide) */}
      {/* --------------------------------------------------------------------- */}
      <section id="how-to-use" className="py-20 bg-[#F7F4EB] border-b border-[#E5DCC5]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-xs font-black uppercase tracking-wider text-[#1B4332] bg-[#D8ECE1] px-3 py-1 rounded-full border border-[#B2DAC5]">
              Step-by-Step Practical Guide
            </span>
            <h2 className="text-3xl sm:text-4xl font-black text-[#141816] mt-4 mb-4 tracking-tight">
              How to Use MSME Ledger in Your Daily Routine
            </h2>
            <p className="text-base sm:text-lg text-[#5C6460] font-medium leading-relaxed">
              Designed for effortless adoption. Follow these five clear steps from opening your store in the morning to balancing your books at night.
            </p>
          </div>

          {/* Interactive Step Navigator */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Step Tabs List */}
            <div className="lg:col-span-5 space-y-3">
              {GUIDE_STEPS.map((stepItem, index) => {
                const isSelected = activeGuideStep === index;
                return (
                  <button
                    key={stepItem.step}
                    type="button"
                    onClick={() => setActiveGuideStep(index)}
                    className={`w-full text-left p-5 rounded-2xl border transition-all flex items-start gap-4 ${
                      isSelected
                        ? 'bg-[#1B4332] text-[#FDFBF7] border-[#143621] shadow-md transform scale-[1.02]'
                        : 'bg-[#FAF6EE] text-[#1E2321] border-[#E5DCC5] hover:border-[#D5C8AB] hover:bg-[#F3EDE0]'
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center font-black text-sm shrink-0 ${
                        isSelected
                          ? 'bg-[#2D6A4F] text-[#FDFBF7] border border-[#3E8662]'
                          : 'bg-[#D8ECE1] text-[#1B4332]'
                      }`}
                    >
                      {stepItem.step}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`text-2xs font-extrabold uppercase px-2 py-0.5 rounded-full ${
                            isSelected
                              ? 'bg-[#143621] text-[#D8ECE1]'
                              : 'bg-[#E5DCC5] text-[#5C6460]'
                          }`}
                        >
                          {stepItem.badge}
                        </span>
                      </div>
                      <h4 className="font-bold text-base leading-snug">{stepItem.title}</h4>
                      <p
                        className={`text-xs mt-1 font-medium truncate ${
                          isSelected ? 'text-[#D8ECE1]' : 'text-[#5C6460]'
                        }`}
                      >
                        {stepItem.summary}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Step Detail Display Card */}
            <div className="lg:col-span-7 bg-[#FDFBF7] p-8 md:p-10 rounded-3xl border border-[#E5DCC5] shadow-sm">
              <div className="flex items-center justify-between pb-6 border-b border-[#E5DCC5] mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-[#D8ECE1] text-[#1B4332] flex items-center justify-center">
                    {GUIDE_STEPS[activeGuideStep].icon}
                  </div>
                  <div>
                    <span className="text-xs font-black uppercase tracking-wider text-[#1B4332]">
                      Step {GUIDE_STEPS[activeGuideStep].step} • {GUIDE_STEPS[activeGuideStep].badge}
                    </span>
                    <h3 className="text-2xl font-black text-[#141816]">
                      {GUIDE_STEPS[activeGuideStep].title}
                    </h3>
                  </div>
                </div>
              </div>

              <div className="space-y-6 text-[#363C39]">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#5C6460] mb-2">
                    What happens in this step
                  </h4>
                  <p className="text-base sm:text-lg leading-relaxed font-medium">
                    {GUIDE_STEPS[activeGuideStep].details}
                  </p>
                </div>

                <div className="p-5 rounded-2xl bg-[#FAF6EE] border border-[#E5DCC5]">
                  <div className="flex items-start gap-3">
                    <span className="text-[#1B4332] font-black text-lg">💡</span>
                    <div>
                      <h5 className="text-xs font-bold uppercase tracking-wider text-[#1B4332] mb-1">
                        How to do it in the app
                      </h5>
                      <p className="text-sm font-semibold text-[#1E2321]">
                        {GUIDE_STEPS[activeGuideStep].actionHint}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="pt-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {GUIDE_STEPS.map((_, dotIdx) => (
                      <button
                        key={dotIdx}
                        type="button"
                        onClick={() => setActiveGuideStep(dotIdx)}
                        className={`w-3 h-3 rounded-full transition-all ${
                          activeGuideStep === dotIdx ? 'w-8 bg-[#1B4332]' : 'bg-[#E5DCC5]'
                        }`}
                        aria-label={`Go to step ${dotIdx + 1}`}
                      />
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={handlePrimaryAction}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#1B4332] text-[#FDFBF7] font-bold text-sm hover:bg-[#22573F] transition-colors"
                  >
                    <span>Try This in MSME Ledger</span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------------- */}
      {/* 5. The 9 Core Modules Explorer */}
      {/* --------------------------------------------------------------------- */}
      <section id="modules" className="py-20 bg-[#FDFBF7] border-b border-[#E5DCC5]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-xs font-black uppercase tracking-wider text-[#1B4332] bg-[#D8ECE1] px-3 py-1 rounded-full border border-[#B2DAC5]">
              9 Complete Modules
            </span>
            <h2 className="text-3xl sm:text-4xl font-black text-[#141816] mt-4 mb-4 tracking-tight">
              Built for Every Corner of Your Shop
            </h2>
            <p className="text-base sm:text-lg text-[#5C6460] font-medium leading-relaxed">
              Every tool your store needs to operate smoothly from morning opening to evening reconciliation.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {MODULES.map((mod, idx) => (
              <div
                key={mod.name}
                className="p-6 rounded-2xl bg-[#FAF6EE] border border-[#E5DCC5] hover:border-[#1B4332] transition-colors shadow-2xs flex flex-col justify-between"
              >
                <div>
                  <div className="text-3xl mb-4">{mod.icon}</div>
                  <h3 className="text-lg font-black text-[#141816] mb-2">{mod.name}</h3>
                  <p className="text-sm text-[#363C39] leading-relaxed">{mod.description}</p>
                </div>
                <div className="mt-5 pt-3 border-t border-[#E5DCC5] flex items-center justify-between text-2xs font-bold text-[#5C6460]">
                  <span>Module 0{idx + 1}</span>
                  <span className="text-[#1B4332]">Offline Enabled ✓</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------------- */}
      {/* 6. Why Offline-First Matters (Reliability Architecture) */}
      {/* --------------------------------------------------------------------- */}
      <section id="offline" className="py-20 bg-[#F7F4EB] border-b border-[#E5DCC5]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-xs font-black uppercase tracking-wider text-[#1B4332] bg-[#D8ECE1] px-3 py-1 rounded-full border border-[#B2DAC5]">
              Offline-First Philosophy
            </span>
            <h2 className="text-3xl sm:text-4xl font-black text-[#141816] mt-4 mb-4 tracking-tight">
              Why Offline-First is Essential for Retail Success
            </h2>
            <p className="text-base sm:text-lg text-[#5C6460] font-medium leading-relaxed">
              When customers are waiting at your cashier desk, waiting 15 seconds for a web page to load is unacceptable.
              Here is how MSME Ledger protects your business:
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* The Old Way */}
            <div className="p-8 rounded-3xl bg-[#FDFBF7] border border-[#E5DCC5] shadow-xs">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs font-black uppercase tracking-wider px-3 py-1 rounded-full bg-[#E5DCC5] text-[#5C6460]">
                  Conventional Cloud POS & Paper
                </span>
              </div>
              <h3 className="text-2xl font-black text-[#141816] mb-4">Slow, Fragile, & Risky</h3>
              <ul className="space-y-4 text-sm text-[#363C39] font-medium">
                <li className="flex items-start gap-3">
                  <span className="text-charcoal-400 font-bold">✕</span>
                  <span>Freezes during network downtime or server maintenance.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-charcoal-400 font-bold">✕</span>
                  <span>Paper books get torn, stolen, soaked in rain, or misplaced.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-charcoal-400 font-bold">✕</span>
                  <span>Customers dispute debt amounts because there is no dated record.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-charcoal-400 font-bold">✕</span>
                  <span>Stock theft goes unnoticed until annual counts.</span>
                </li>
              </ul>
            </div>

            {/* The MSME Ledger Way */}
            <div className="p-8 rounded-3xl bg-[#1B4332] text-[#FDFBF7] border border-[#143621] shadow-lg">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs font-black uppercase tracking-wider px-3 py-1 rounded-full bg-[#2D6A4F] text-[#D8ECE1] border border-[#3E8662]">
                  The MSME Ledger Standard
                </span>
              </div>
              <h3 className="text-2xl font-black text-[#FDFBF7] mb-4">Resilient, Instant, & Sovereign</h3>
              <ul className="space-y-4 text-sm text-[#D8ECE1] font-medium">
                <li className="flex items-start gap-3">
                  <span className="text-[#FDFBF7] font-bold">✓</span>
                  <span>Zero latency: cart updates and sales ring up in under 50 milliseconds.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-[#FDFBF7] font-bold">✓</span>
                  <span>100% offline data durability using client-side IndexedDB & sagas.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-[#FDFBF7] font-bold">✓</span>
                  <span>1-click WhatsApp reminders provide dated proof that eliminates debtor disputes.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-[#FDFBF7] font-bold">✓</span>
                  <span>Scale-1000 precision tracks physical inventory down to fractions of a unit.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------------- */}
      {/* 7. Simple, Transparent Pricing (Bank Transfer) */}
      {/* --------------------------------------------------------------------- */}
      <section id="pricing" className="py-20 bg-[#FDFBF7] border-b border-[#E5DCC5]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-xs font-black uppercase tracking-wider text-[#1B4332] bg-[#D8ECE1] px-3 py-1 rounded-full border border-[#B2DAC5]">
              Straightforward Pricing
            </span>
            <h2 className="text-3xl sm:text-4xl font-black text-[#141816] mt-4 mb-4 tracking-tight">
              No Cards. No Hidden Debits. Simple Bank Transfer.
            </h2>
            <p className="text-base sm:text-lg text-[#5C6460] font-medium leading-relaxed">
              We never ask for your debit card. Upgrade anytime via a direct bank transfer with your unique reference code.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto items-stretch">
            {/* Free Trial */}
            <div className="p-8 rounded-3xl bg-[#FAF6EE] border border-[#E5DCC5] flex flex-col justify-between shadow-2xs">
              <div>
                <div className="text-xs font-black uppercase tracking-wider text-[#5C6460] mb-2">Evaluation</div>
                <h3 className="text-2xl font-black text-[#141816] mb-1">Free 30-Day Trial</h3>
                <p className="text-xs text-[#5C6460] mb-6">Experience full offline retail control with zero risk.</p>
                <div className="text-4xl font-black text-[#141816] mb-6">
                  ₦0 <span className="text-sm font-semibold text-[#5C6460]">/ 30 days</span>
                </div>
                <ul className="space-y-3 text-sm text-[#363C39] mb-8 font-medium">
                  <li className="flex items-center gap-2">✓ All 9 core modules unlocked</li>
                  <li className="flex items-center gap-2">✓ Unlimited local POS checkouts</li>
                  <li className="flex items-center gap-2">✓ Full customer credit book</li>
                  <li className="flex items-center gap-2">✓ WhatsApp payment reminders</li>
                </ul>
              </div>
              <button
                type="button"
                onClick={handlePrimaryAction}
                className="w-full py-3.5 px-4 rounded-xl bg-[#F7F4EB] text-[#1E2321] font-bold border border-[#E5DCC5] hover:bg-[#EFE9DA] transition-colors"
              >
                Start Free Trial
              </button>
            </div>

            {/* Pro Plan */}
            <div className="p-8 rounded-3xl bg-[#1B4332] text-[#FDFBF7] border border-[#143621] flex flex-col justify-between shadow-xl relative transform md:-translate-y-2">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-[#D8ECE1] text-[#1B4332] text-xs font-black uppercase tracking-wider border border-[#B2DAC5]">
                Most Popular
              </div>
              <div>
                <div className="text-xs font-black uppercase tracking-wider text-[#D8ECE1] mb-2">Merchant Pro</div>
                <h3 className="text-2xl font-black text-[#FDFBF7] mb-1">Pro Store</h3>
                <p className="text-xs text-[#D8ECE1] mb-6">For established retail shops and agro-dealers.</p>
                <div className="text-4xl font-black text-[#FDFBF7] mb-6">
                  ₦5,000 <span className="text-sm font-semibold text-[#D8ECE1]">/ month</span>
                </div>
                <ul className="space-y-3 text-sm text-[#D8ECE1] mb-8 font-medium">
                  <li className="flex items-center gap-2">✓ Unlimited catalog & sales volume</li>
                  <li className="flex items-center gap-2">✓ Multi-device cloud synchronization</li>
                  <li className="flex items-center gap-2">✓ WhatsApp debt recovery reminders</li>
                  <li className="flex items-center gap-2">✓ Cryptographic offline entitlement tokens</li>
                  <li className="flex items-center gap-2">✓ 7-day automatic renewal grace period</li>
                </ul>
              </div>
              <button
                type="button"
                onClick={handlePrimaryAction}
                className="w-full py-4 px-4 rounded-xl bg-[#D8ECE1] text-[#1B4332] font-black text-base shadow-md hover:bg-[#B2DAC5] active:bg-[#8BC8A9] transition-colors"
              >
                Get Started
              </button>
            </div>

            {/* Enterprise Plan */}
            <div className="p-8 rounded-3xl bg-[#FAF6EE] border border-[#E5DCC5] flex flex-col justify-between shadow-2xs">
              <div>
                <div className="text-xs font-black uppercase tracking-wider text-[#5C6460] mb-2">Multi-Shop</div>
                <h3 className="text-2xl font-black text-[#141816] mb-1">Enterprise</h3>
                <p className="text-xs text-[#5C6460] mb-6">For businesses managing multiple branches or depots.</p>
                <div className="text-4xl font-black text-[#141816] mb-6">
                  ₦15,000 <span className="text-sm font-semibold text-[#5C6460]">/ month</span>
                </div>
                <ul className="space-y-3 text-sm text-[#363C39] mb-8 font-medium">
                  <li className="flex items-center gap-2">✓ Everything in Pro</li>
                  <li className="flex items-center gap-2">✓ Multiple shop locations & cashiers</li>
                  <li className="flex items-center gap-2">✓ Role-based permissions (Cashier vs Owner)</li>
                  <li className="flex items-center gap-2">✓ Immutable audit logging & reconciliation</li>
                </ul>
              </div>
              <button
                type="button"
                onClick={handlePrimaryAction}
                className="w-full py-3.5 px-4 rounded-xl bg-[#F7F4EB] text-[#1E2321] font-bold border border-[#E5DCC5] hover:bg-[#EFE9DA] transition-colors"
              >
                Choose Enterprise
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------------- */}
      {/* 8. Frequently Asked Questions */}
      {/* --------------------------------------------------------------------- */}
      <section id="faq" className="py-20 bg-[#F7F4EB] border-b border-[#E5DCC5]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="text-xs font-black uppercase tracking-wider text-[#1B4332] bg-[#D8ECE1] px-3 py-1 rounded-full border border-[#B2DAC5]">
              Got Questions?
            </span>
            <h2 className="text-3xl sm:text-4xl font-black text-[#141816] mt-4 mb-4 tracking-tight">
              Frequently Asked Questions
            </h2>
            <p className="text-base text-[#5C6460] font-medium">
              Everything you need to know about setting up and running MSME Ledger.
            </p>
          </div>

          <div className="space-y-4">
            {FAQS.map((faq, idx) => {
              const isOpen = openFaqIndex === idx;
              return (
                <div
                  key={idx}
                  className="rounded-2xl bg-[#FDFBF7] border border-[#E5DCC5] overflow-hidden transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                    className="w-full p-6 text-left flex items-center justify-between gap-4 font-bold text-[#141816] hover:text-[#1B4332] transition-colors"
                  >
                    <span className="text-base sm:text-lg">{faq.q}</span>
                    <span
                      className={`w-7 h-7 rounded-full flex items-center justify-center bg-[#FAF6EE] border border-[#E5DCC5] text-xs transition-transform ${
                        isOpen ? 'rotate-180 text-[#1B4332]' : 'text-[#5C6460]'
                      }`}
                    >
                      ▼
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-6 pb-6 pt-2 text-sm sm:text-base text-[#363C39] font-medium leading-relaxed border-t border-[#E5DCC5]">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------------- */}
      {/* 9. Bottom Call to Action */}
      {/* --------------------------------------------------------------------- */}
      <section className="py-20 bg-[#1B4332] text-[#FDFBF7] border-b border-[#143621]">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#2D6A4F] text-[#FDFBF7] flex items-center justify-center font-black text-3xl mx-auto mb-6 shadow-md border border-[#3E8662]">
            ₦
          </div>
          <h2 className="text-3xl sm:text-5xl font-black text-[#FDFBF7] tracking-tight mb-6">
            Ready to Take Control of Your Store?
          </h2>
          <p className="text-lg text-[#D8ECE1] font-medium max-w-2xl mx-auto mb-10 leading-relaxed">
            Join hundreds of retail merchants and small businesses recording sales offline and recovering debts with ease.
          </p>
          <button
            type="button"
            onClick={handlePrimaryAction}
            className="px-10 py-5 rounded-2xl bg-[#FDFBF7] text-[#1B4332] text-xl font-black shadow-2xl hover:bg-[#FAF6EE] active:bg-[#F3EDE0] transition-all transform active:scale-95"
          >
            {existingShopName ? `Open ${existingShopName}` : 'Launch MSME Ledger Now (Free)'}
          </button>
        </div>
      </section>

      {/* --------------------------------------------------------------------- */}
      {/* 10. Footer */}
      {/* --------------------------------------------------------------------- */}
      <footer className="bg-[#141816] text-[#FAF6EE] py-12 border-t border-[#2E3431]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 pb-8 border-b border-[#2E3431]">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#1B4332] text-[#FDFBF7] flex items-center justify-center font-black text-sm">
                ₦
              </div>
              <div>
                <span className="font-bold text-base text-[#FDFBF7]">MSME Ledger</span>
                <p className="text-2xs text-[#7E8684]">Offline-First Small Business Operating System</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-6 text-xs font-bold text-[#A9AFAA]">
              <a href="#about" className="hover:text-[#FDFBF7] transition-colors">About</a>
              <a href="#how-to-use" className="hover:text-[#FDFBF7] transition-colors">How to Use</a>
              <a href="#modules" className="hover:text-[#FDFBF7] transition-colors">Modules</a>
              <a href="#offline" className="hover:text-[#FDFBF7] transition-colors">Why Offline</a>
              <a href="#pricing" className="hover:text-[#FDFBF7] transition-colors">Pricing</a>
              <a href="#faq" className="hover:text-[#FDFBF7] transition-colors">FAQ</a>
            </div>

            <div className="text-2xs text-[#7E8684]">
              v2.1 • Built with Forest Green, Sand & Charcoal
            </div>
          </div>

          <div className="pt-8 flex flex-col sm:flex-row items-center justify-between text-2xs text-[#7E8684] gap-4">
            <p>© {new Date().getFullYear()} MSME Ledger. All rights reserved.</p>
            <p>Designed for resilient retail operations in emerging markets.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
