import React, { useState } from 'react';
import { usePendingSyncCount } from '../../config/db.js';
import { pushPendingData } from '../../services/syncService.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSubscription } from '../../context/SubscriptionContext.jsx';
import BrandLogo from './BrandLogo.jsx';
import StorageDiagnosticsModal from './StorageDiagnosticsModal.jsx';

export const MODULE_ITEMS = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Executive business pulse and key operational indicators',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    )
  },
  {
    id: 'business_book',
    label: 'Business Book',
    description: 'Unified chronological activity ledger of all transactions',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    )
  },
  {
    id: 'pos',
    label: 'Sales / POS',
    description: 'Fast cashier terminal for sales, payment collection, and credit',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    )
  },
  {
    id: 'expenses',
    label: 'Expenses',
    description: 'Track operational overhead, vendor payments, and bills',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    )
  },
  {
    id: 'inventory',
    label: 'Inventory',
    description: 'Product catalog, stock tracking, and reorder alerts',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    )
  },
  {
    id: 'customers',
    label: 'Customers',
    description: 'Customer contact directory, purchase history, and balances',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    )
  },
  {
    id: 'credit_book',
    label: 'Credit Book',
    description: 'Receivables management, WhatsApp reminders, and debt recovery',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    )
  },
  {
    id: 'reports',
    label: 'Reports',
    description: 'Financial performance, revenue statements, and valuations',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    )
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Business profile, storage management, and offline trial info',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    )
  }
];

export default function AppShell({
  activeTab,
  onSelectTab,
  children,
  headerActions
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [storageModalOpen, setStorageModalOpen] = useState(false);

  const pendingCount = usePendingSyncCount();
  const shopName = localStorage.getItem('shopName') || 'My Store';
  const isOnline = navigator.onLine;

  const { user, isAuthenticated, currentRole } = useAuth();
  const { isReadOnly, entitlementStatus, statusMessage } = useSubscription();

  const currentModule = MODULE_ITEMS.find((m) => m.id === activeTab) || MODULE_ITEMS[0];

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col md:flex-row font-sans text-[#1E2321] antialiased selection:bg-[#D8ECE1] selection:text-[#1B4332]">
      {/* --------------------------------------------------------------------- */}
      {/* 1. Desktop Fixed Sidebar */}
      {/* --------------------------------------------------------------------- */}
      <aside className="hidden md:flex flex-col w-64 bg-[#141816] text-[#FAF6EE] border-r border-[#2E3431] shrink-0 sticky top-0 h-screen z-30">
        {/* Brand & Business Identity Header */}
        <div className="p-5 border-b border-[#2E3431]">
          <div className="flex items-center gap-3">
            <BrandLogo size={42} />
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-black text-[#FDFBF7] tracking-tight truncate">
                MSME Ledger
              </h1>
              <p className="text-xs text-[#A9AFAA] truncate flex items-center gap-1.5 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-[#2D6A4F]"></span>
                <span className="truncate">{user?.fullName ? `${user.fullName}'s Shop` : shopName}</span>
              </p>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="text-2xs font-bold uppercase px-1.5 py-0.5 rounded bg-[#2E3431] text-[#FAF6EE] border border-[#434A46]">
                  {currentRole}
                </span>
                {entitlementStatus === 'active' && (
                  <span className="text-2xs font-extrabold uppercase px-1.5 py-0.5 rounded bg-[#143621] text-[#D8ECE1] border border-[#2D6A4F]">
                    PRO
                  </span>
                )}
                {entitlementStatus === 'in_grace_period' && (
                  <span className="text-2xs font-extrabold uppercase px-1.5 py-0.5 rounded bg-[#2E3431] text-[#E5DCC5] border border-[#7A6E53]">
                    GRACE
                  </span>
                )}
                {entitlementStatus === 'expired' && (
                  <span className="text-2xs font-extrabold uppercase px-1.5 py-0.5 rounded bg-[#2E3431] text-[#D5C8AB] border border-[#574E3A]">
                    EXPIRED
                  </span>
                )}
                {entitlementStatus === 'clock_tampered_locked' && (
                  <span className="text-2xs font-extrabold uppercase px-1.5 py-0.5 rounded bg-[#2E3431] text-[#BAAB8B] border border-[#7A6E53]">
                    CLOCK LOCKED
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {MODULE_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all text-left ${
                  isActive
                    ? 'bg-[#1B4332] text-[#FDFBF7] shadow-xs font-bold border border-[#143621]'
                    : 'text-[#A9AFAA] hover:text-[#FAF6EE] hover:bg-[#2E3431]'
                }`}
              >
                <span className={`${isActive ? 'text-[#FDFBF7]' : 'text-[#7E8684]'}`}>
                  {item.icon}
                </span>
                <span className="flex-1 truncate">{item.label}</span>
                {item.id === 'pos' && (
                  <span className="text-2xs font-extrabold uppercase px-1.5 py-0.5 rounded bg-[#143621] text-[#D8ECE1] border border-[#2D6A4F]">
                    POS
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer: Guide & Connectivity */}
        <div className="p-4 border-t border-[#2E3431] text-xs text-[#A9AFAA] space-y-2">
          {/* User Guide Button */}
          <button
            type="button"
            onClick={() => onSelectTab('landing')}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold text-[#D8ECE1] bg-[#1B4332] hover:bg-[#22573F] transition-colors border border-[#2D6A4F] shadow-xs"
          >
            <svg className="w-3.5 h-3.5 text-[#D8ECE1]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <span>User Guide &amp; About</span>
          </button>

          {/* Storage & Connectivity Status */}
          <div className="flex items-center justify-between pt-1">
            <span className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-[#2D6A4F]' : 'bg-[#7A6E53]'}`} />
              <span className="font-medium text-[#FAF6EE]">{isOnline ? 'Online (PWA)' : 'Offline Mode'}</span>
            </span>
            <button
              type="button"
              onClick={() => setStorageModalOpen(true)}
              className="text-2xs font-bold text-[#D8ECE1] hover:underline"
              title="View storage status and diagnostics"
            >
              Storage ({pendingCount})
            </button>
          </div>
        </div>
      </aside>

      {/* --------------------------------------------------------------------- */}
      {/* 2. Mobile Sticky Header & Mobile Drawer */}
      {/* --------------------------------------------------------------------- */}
      <div className="md:hidden sticky top-0 z-40 bg-[#141816] text-[#FAF6EE] border-b border-[#2E3431] flex items-center justify-between px-3.5 py-2.5 shadow-md">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-1.5 rounded-lg text-[#A9AFAA] hover:text-[#FAF6EE] hover:bg-[#2E3431] focus:outline-none"
            aria-label="Toggle Navigation Menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <BrandLogo size={28} />
            <span className="font-bold text-sm text-[#FDFBF7] truncate max-w-[120px]">
              {shopName}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Mobile Storage Diagnostics Button */}
          <button
            type="button"
            onClick={() => setStorageModalOpen(true)}
            className="text-2xs font-bold text-[#1B4332] bg-[#D8ECE1] border border-[#B2DAC5] px-2.5 py-1 rounded-full flex items-center gap-1"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#1B4332]" />
            <span>{pendingCount > 0 ? `Sync (${pendingCount})` : 'Storage'}</span>
          </button>
        </div>
      </div>

      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-[#141816]/75 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-72 max-w-xs bg-[#141816] text-[#FAF6EE] h-full flex flex-col p-4 shadow-2xl z-50 border-r border-[#2E3431]">
            <div className="flex items-center justify-between pb-4 border-b border-[#2E3431] mb-3">
              <div className="flex items-center gap-2.5">
                <BrandLogo size={32} />
                <div>
                  <h2 className="text-sm font-black text-[#FDFBF7]">MSME Ledger</h2>
                  <p className="text-2xs text-[#A9AFAA] font-medium">{shopName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="text-[#A9AFAA] hover:text-[#FAF6EE] p-1 rounded-md"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto">
              {MODULE_ITEMS.map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onSelectTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-left transition-colors ${
                      isActive
                        ? 'bg-[#1B4332] text-[#FDFBF7] font-bold border border-[#143621]'
                        : 'text-[#A9AFAA] hover:text-[#FAF6EE] hover:bg-[#2E3431]'
                    }`}
                  >
                    <span className={isActive ? 'text-[#FDFBF7]' : 'text-[#7E8684]'}>
                      {item.icon}
                    </span>
                    <span className="flex-1 truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="pt-3 border-t border-[#2E3431] space-y-2 text-2xs text-[#A9AFAA]">
              <button
                type="button"
                onClick={() => {
                  onSelectTab('landing');
                  setMobileMenuOpen(false);
                }}
                className="w-full py-2 px-3 rounded-lg text-xs font-bold text-[#D8ECE1] bg-[#1B4332] hover:bg-[#22573F] text-center border border-[#2D6A4F]"
              >
                User Guide &amp; About
              </button>
              <div className="flex items-center justify-between pt-1">
                <span>{isOnline ? '● Online (PWA)' : '○ Offline Mode'}</span>
                <span>MSME Ledger v2.1</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* 3. Main Content Area */}
      {/* --------------------------------------------------------------------- */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto overflow-x-hidden bg-[#FDFBF7]">
        {/* Module Header Bar: Non-sticky on mobile to prevent overlapping */}
        <header className="bg-[#FAF6EE] border-b border-[#E5DCC5] px-3.5 py-3 md:px-8 md:py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 static md:static z-20 shadow-2xs">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg md:text-2xl font-black text-[#141816] tracking-tight">
                {currentModule.label}
              </h2>
              <span className="text-2xs font-bold px-2 py-0.5 rounded-full bg-[#F3EDE0] text-[#363C39] border border-[#E5DCC5]">
                Live Data
              </span>
            </div>
            <p className="text-xs text-[#5C6460] mt-0.5 font-medium">
              {currentModule.description}
            </p>
          </div>

          {/* Contextual Action Slot */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {/* Guide Button */}
            <button
              type="button"
              onClick={() => onSelectTab('landing')}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1B4332] bg-[#D8ECE1] hover:bg-[#B2DAC5] border border-[#B2DAC5] px-3 py-2 rounded-lg transition-colors shadow-2xs"
              title="View guide and overview of all features"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              <span>Guide &amp; About</span>
            </button>

            {headerActions}

            {/* Storage Diagnostics & Sync Button */}
            <button
              type="button"
              onClick={() => setStorageModalOpen(true)}
              className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg transition-colors shadow-2xs border ${
                pendingCount > 0
                  ? 'text-[#1B4332] bg-[#D8ECE1] border-[#B2DAC5] hover:bg-[#B2DAC5]'
                  : 'text-[#5C6460] bg-[#F3EDE0] border-[#E5DCC5] hover:bg-[#EFE9DA]'
              }`}
              title="Click to view local storage diagnostics and manual sync"
            >
              <span className={`w-2 h-2 rounded-full ${pendingCount > 0 ? 'bg-[#1B4332] animate-pulse' : 'bg-[#7E8684]'}`} />
              <span>{pendingCount > 0 ? `Pending Sync: ${pendingCount}` : 'Local Storage Clean'}</span>
            </button>
          </div>
        </header>

        {/* Read-Only State Notification Banner */}
        {isReadOnly && (
          <div className="bg-[#F3EDE0] border-b border-[#E5DCC5] text-[#141816] text-xs px-4 py-2.5 font-semibold flex items-center justify-between">
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4 text-[#7A6E53] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span><strong>Read-Only Mode:</strong> {statusMessage}</span>
            </span>
            <span className="text-2xs uppercase tracking-wider font-extrabold px-2 py-0.5 rounded bg-[#FAF6EE] text-[#141816] border border-[#E5DCC5]">
              {entitlementStatus}
            </span>
          </div>
        )}

        {/* Main Workspace */}
        <main className="flex-1 p-3.5 sm:p-5 md:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>

        {/* Legal Footer */}
        <footer className="bg-[#FAF6EE] border-t border-[#E5DCC5] px-4 py-4 text-center text-xs text-[#5C6460] mt-auto font-medium">
          <p>
            &copy; {new Date().getFullYear()} MSME Ledger. Resilient offline-first retail operating system.
          </p>
        </footer>
      </div>

      {/* Global Modals */}
      <StorageDiagnosticsModal
        isOpen={storageModalOpen}
        onClose={() => setStorageModalOpen(false)}
        onNavigateSettings={() => onSelectTab('settings')}
      />
    </div>
  );
}
