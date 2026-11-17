import React, { useState } from 'react';
import { usePendingSyncCount } from '../../config/db.js';
import { pushPendingData } from '../../services/syncService.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSubscription } from '../../context/SubscriptionContext.jsx';

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

export default function AppShell({ activeTab, onSelectTab, headerActions, children }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pendingCount = usePendingSyncCount();
  const shopName = localStorage.getItem('shopName') || 'MSME Ledger Store';
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  const { user, currentRole } = useAuth();
  const { entitlementStatus, isReadOnly, statusMessage } = useSubscription();

  const currentModule = MODULE_ITEMS.find(m => m.id === activeTab) || MODULE_ITEMS[0];

  const handleSyncClick = () => {
    if (pendingCount > 0) {
      pushPendingData()
        .then((res) => {
          if (res?.status === 'no_pending') {
            alert('All records are already stored locally and clean.');
          } else if (res?.status === 'partial') {
            alert(res.message);
          } else {
            alert(res?.message || 'Synchronization completed.');
          }
        })
        .catch(err => alert(err.message));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row font-sans text-slate-900 antialiased selection:bg-emerald-500 selection:text-white">
      {/* --------------------------------------------------------------------- */}
      {/* 1. Desktop Fixed Sidebar */}
      {/* --------------------------------------------------------------------- */}
      <aside className="hidden md:flex flex-col w-64 bg-slate-900 text-slate-300 border-r border-slate-800 shrink-0 sticky top-0 h-screen z-30">
        {/* Brand & Business Identity Header */}
        <div className="p-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white font-black text-lg shadow-sm">
              ₦
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-bold text-white tracking-tight truncate">
                MSME Ledger
              </h1>
              <p className="text-xs text-slate-400 truncate flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span className="truncate">{user?.fullName ? `${user.fullName}'s Shop` : shopName}</span>
              </p>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="text-2xs font-bold uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  {currentRole}
                </span>
                {entitlementStatus === 'active' && (
                  <span className="text-2xs font-extrabold uppercase px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700">
                    PRO
                  </span>
                )}
                {entitlementStatus === 'in_grace_period' && (
                  <span className="text-2xs font-extrabold uppercase px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-700">
                    GRACE
                  </span>
                )}
                {entitlementStatus === 'expired' && (
                  <span className="text-2xs font-extrabold uppercase px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-700">
                    EXPIRED
                  </span>
                )}
                {entitlementStatus === 'clock_tampered_locked' && (
                  <span className="text-2xs font-extrabold uppercase px-1.5 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800">
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
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all text-left ${isActive
                    ? 'bg-emerald-600 text-white shadow-xs font-bold'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                  }`}
              >
                <span className={`${isActive ? 'text-white' : 'text-slate-400'}`}>
                  {item.icon}
                </span>
                <span className="flex-1 truncate">{item.label}</span>
                {item.id === 'pos' && (
                  <span className="text-2xs font-extrabold uppercase px-1.5 py-0.5 rounded bg-emerald-700/80 text-emerald-100">
                    POS
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer: Connectivity & Account Info */}
        <div className="p-4 border-t border-slate-800 text-xs text-slate-400 space-y-2.5">
          <button
            type="button"
            onClick={() => onSelectTab('landing')}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold text-[#D8ECE1] bg-[#1B4332] hover:bg-[#22573F] transition-colors border border-[#2D6A4F] shadow-xs"
          >
            📖 About & User Guide
          </button>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <span className="font-medium text-slate-300">{isOnline ? 'Online (PWA)' : 'Offline Mode'}</span>
            </span>
            {pendingCount > 0 && (
              <button
                type="button"
                onClick={handleSyncClick}
                className="text-2xs font-bold text-amber-400 bg-amber-950/60 border border-amber-800/80 px-2 py-0.5 rounded hover:bg-amber-900 transition-colors"
                title="Click to force manual sync"
              >
                Sync ({pendingCount})
              </button>
            )}
          </div>
          <p className="text-2xs text-slate-400">
            SB Manager v2.1 • Offline First
          </p>
        </div>
      </aside>

      {/* --------------------------------------------------------------------- */}
      {/* 2. Mobile Sticky Header & Mobile Drawer */}
      {/* --------------------------------------------------------------------- */}
      <div className="md:hidden sticky top-0 z-40 bg-slate-900 text-white border-b border-slate-800 flex items-center justify-between px-4 py-3 shadow-md">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 focus:outline-none"
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
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-emerald-600 flex items-center justify-center font-black text-xs text-white">
              ₦
            </span>
            <span className="font-bold text-sm tracking-tight">{shopName}</span>
          </div>
        </div>

        {/* Mobile Quick Action / Sync Status */}
        <div className="flex items-center gap-2">
          {pendingCount > 0 ? (
            <button
              type="button"
              onClick={handleSyncClick}
              className="text-2xs font-bold px-2 py-1 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30"
            >
              Pending ({pendingCount})
            </button>
          ) : (
            <span className="text-2xs font-semibold px-2 py-0.5 rounded text-slate-300 bg-slate-800 border border-slate-700">
              Local Clean
            </span>
          )}
        </div>
      </div>

      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-slate-950/70 backdrop-blur-2xs"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-72 max-w-xs bg-slate-900 text-slate-300 h-full flex flex-col p-4 shadow-2xl z-50">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-black text-sm">
                  ₦
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">MSME Ledger</h2>
                  <p className="text-2xs text-slate-400">{shopName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-md"
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
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold text-left transition-colors ${isActive
                        ? 'bg-emerald-600 text-white font-bold'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800'
                      }`}
                  >
                    <span className={isActive ? 'text-white' : 'text-slate-400'}>
                      {item.icon}
                    </span>
                    <span className="flex-1 truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="pt-3 border-t border-slate-800 space-y-2 text-2xs text-slate-400">
              <button
                type="button"
                onClick={() => {
                  onSelectTab('landing');
                  setMobileMenuOpen(false);
                }}
                className="w-full py-2 px-3 rounded-lg text-xs font-bold text-[#D8ECE1] bg-[#1B4332] hover:bg-[#22573F] text-center border border-[#2D6A4F]"
              >
                📖 About & User Guide
              </button>
              <div className="flex items-center justify-between">
                <span>{isOnline ? '● Online (PWA)' : '○ Offline Mode'}</span>
                <span>v2.1</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* 3. Main Content Area */}
      {/* --------------------------------------------------------------------- */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Module Header Bar */}
        <header className="bg-white border-b border-slate-200/90 px-4 py-4 md:px-8 md:py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sticky top-0 md:static z-20 shadow-2xs">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">
                {currentModule.label}
              </h2>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                Live Data
              </span>
            </div>
            <p className="text-xs md:text-sm text-slate-500 mt-0.5">
              {currentModule.description}
            </p>
          </div>

          {/* Contextual Action Slot */}
          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={() => onSelectTab('landing')}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1B4332] bg-[#D8ECE1] hover:bg-[#B2DAC5] border border-[#B2DAC5] px-3 py-2 rounded-lg transition-colors shadow-2xs"
              title="View guide and overview of all features"
            >
              <span>📖</span>
              <span>Guide & About</span>
            </button>
            {headerActions}
            {pendingCount > 0 ? (
              <button
                type="button"
                onClick={handleSyncClick}
                className="hidden sm:inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 bg-amber-50 border border-amber-300 px-3 py-2 rounded-lg hover:bg-amber-100 transition-colors shadow-2xs"
                title="Click to check sync status"
              >
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span>Pending Sync: {pendingCount}</span>
              </button>
            ) : (
              <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 bg-slate-100 border border-slate-200 px-3 py-2 rounded-lg shadow-2xs">
                <span className="w-2 h-2 rounded-full bg-slate-400" />
                <span>Local Storage Clean</span>
              </span>
            )}
          </div>
        </header>

        {/* Module Body Content */}
        {isReadOnly && (
          <div className="bg-rose-50 border-b border-rose-200 text-rose-800 text-xs px-4 py-2.5 font-semibold flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span>⚠️</span>
              <span><strong>Read-Only Mode:</strong> {statusMessage}</span>
            </span>
            <span className="text-2xs uppercase tracking-wider font-extrabold px-2 py-0.5 rounded bg-rose-100 text-rose-900 border border-rose-300">
              {entitlementStatus}
            </span>
          </div>
        )}
        <main className="flex-1 p-4 md:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>

        {/* Global Legal Footer */}
        <footer className="bg-white border-t border-slate-200/80 px-4 py-4 text-center text-xs text-slate-400 mt-auto">
          <p>
            &copy; {new Date().getFullYear()} Lukman Code Craft. MSME Ledger — Offline-first retail ERP for Nigerian businesses.
          </p>
        </footer>
      </div>
    </div>
  );
}
