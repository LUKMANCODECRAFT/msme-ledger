import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { msme_ledger_db, sb_db, usePendingSyncCount } from '../config/db.js';
import { pushPendingData } from '../services/syncService.js';
import { getShopId } from '../utils/shopIdentity.js';
import { formatDateShort } from '../utils/formatters.js';
import Button from '../components/common/Button.jsx';

export default function Settings() {
  const [shopNameInput, setShopNameInput] = useState(() => localStorage.getItem('shopName') || '');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const pendingCount = usePendingSyncCount();
  const shopId = getShopId();
  const trialEndsAtStr = localStorage.getItem('trialEndsAt');
  const trialEndsDate = trialEndsAtStr ? new Date(trialEndsAtStr) : null;
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

  // Local table counts
  const customerCount = useLiveQuery(() => msme_ledger_db.customers.count()) || 0;
  const inventoryCount = useLiveQuery(() => msme_ledger_db.inventory.count()) || 0;
  const salesCount = useLiveQuery(() => msme_ledger_db.sales.count()) || 0;
  const transactionCount = useLiveQuery(() => msme_ledger_db.transactions?.count?.() || 0) || 0;
  const expenseCount = useLiveQuery(() => sb_db.expenses?.count?.() || 0) || 0;

  const handleSaveProfile = (e) => {
    e.preventDefault();
    if (!shopNameInput.trim()) return;

    localStorage.setItem('shopName', shopNameInput.trim());
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      await pushPendingData();
      alert('Cloud synchronization completed successfully.');
    } catch (err) {
      alert(`Sync failed: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const whatsappPaymentUrl = `https://wa.me/2349132555203?text=${encodeURIComponent(`Hello LCC Admin! I am renewing subscription for Shop: ${shopNameInput}. My Shop ID is: ${shopId}`)}`;

  return (
    <div className="space-y-6 max-w-4xl animate-in fade-in duration-200">
      {/* ------------------------------------------------------------------- */}
      {/* 1. Header */}
      {/* ------------------------------------------------------------------- */}
      <div className="border-b border-slate-200 pb-2">
        <h3 className="text-xl font-bold text-slate-900 tracking-tight">System Settings & Profile</h3>
        <p className="text-xs text-slate-500">Business configuration, offline storage metrics, and license status</p>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 2. Business Profile Card */}
      {/* ------------------------------------------------------------------- */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6 space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <h4 className="text-base font-bold text-slate-900 tracking-tight">Business Identity</h4>
          <p className="text-xs text-slate-500">Displayed on register receipts and customer reminders</p>
        </div>

        <form onSubmit={handleSaveProfile} className="space-y-4 max-w-lg">
          <div>
            <label htmlFor="shopName" className="text-xs font-bold text-slate-700 block mb-1">
              Store / Shop Name
            </label>
            <input
              id="shopName"
              type="text"
              required
              value={shopNameInput}
              onChange={(e) => setShopNameInput(e.target.value)}
              className="w-full text-sm font-semibold p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Currency Code</label>
              <input
                type="text"
                disabled
                value="NGN (Nigerian Naira - ₦)"
                className="w-full text-xs font-semibold p-3 bg-slate-100 text-slate-500 border border-slate-200 rounded-xl cursor-not-allowed"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Monetary Precision</label>
              <input
                type="text"
                disabled
                value="Integer Kobo (100 Kobo = ₦1)"
                className="w-full text-xs font-semibold p-3 bg-slate-100 text-slate-500 border border-slate-200 rounded-xl cursor-not-allowed"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" variant="primary" size="md">
              Save Store Profile
            </Button>
            {saveSuccess && (
              <span className="text-xs font-bold text-emerald-600 animate-in fade-in">
                ✓ Shop name updated successfully!
              </span>
            )}
          </div>
        </form>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 3. Offline Storage & Local Database Health */}
      {/* ------------------------------------------------------------------- */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6 space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <h4 className="text-base font-bold text-slate-900 tracking-tight">Offline Database Status</h4>
          <p className="text-xs text-slate-500">Local client persistence health via IndexedDB (Dexie)</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-center">
            <span className="text-xs text-slate-500 font-semibold block">Customers</span>
            <span className="text-xl font-bold text-slate-900">{customerCount}</span>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-center">
            <span className="text-xs text-slate-500 font-semibold block">Inventory</span>
            <span className="text-xl font-bold text-slate-900">{inventoryCount}</span>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-center">
            <span className="text-xs text-slate-500 font-semibold block">Sales</span>
            <span className="text-xl font-bold text-slate-900">{salesCount}</span>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-center">
            <span className="text-xs text-slate-500 font-semibold block">Repayments</span>
            <span className="text-xl font-bold text-slate-900">{transactionCount}</span>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-center">
            <span className="text-xs text-slate-500 font-semibold block">Expenses</span>
            <span className="text-xl font-bold text-slate-900">{expenseCount}</span>
          </div>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-slate-600 bg-slate-50 p-4 rounded-xl border border-slate-200">
          <div>
            <p className="font-bold text-slate-800">
              Cloud Queue: {pendingCount} records awaiting sync
            </p>
            <p className="text-2xs text-slate-400 mt-0.5">
              Network: {isOnline ? '● Online (Connected)' : '○ Offline Mode'}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleManualSync}
            isLoading={isSyncing}
          >
            Trigger Sync Now
          </Button>
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 4. Subscription & Device Identity */}
      {/* ------------------------------------------------------------------- */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6 space-y-4">
        <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
          <div>
            <h4 className="text-base font-bold text-slate-900 tracking-tight">Device License & Subscription</h4>
            <p className="text-xs text-slate-500">Offline trial status and renewal details</p>
          </div>
          <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
            30-Day Trial Active
          </span>
        </div>

        <div className="space-y-3 text-xs text-slate-600">
          <div className="flex justify-between py-1 border-b border-slate-100">
            <span className="font-semibold text-slate-500">Device Shop ID:</span>
            <span className="font-mono font-bold text-slate-900">{shopId}</span>
          </div>

          <div className="flex justify-between py-1 border-b border-slate-100">
            <span className="font-semibold text-slate-500">Trial Valid Until:</span>
            <span className="font-bold text-slate-900">
              {trialEndsDate ? formatDateShort(trialEndsDate) : '30 Days from setup'}
            </span>
          </div>

          <div className="flex justify-between py-1 border-b border-slate-100">
            <span className="font-semibold text-slate-500">License Renewal Rate:</span>
            <span className="font-bold text-emerald-700">1,500 NGN / month</span>
          </div>
        </div>

        <div className="pt-2">
          <a
            href={whatsappPaymentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-xs font-bold text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 px-4 py-2.5 rounded-xl transition-colors shadow-2xs"
          >
            <span>Renew License via WhatsApp (1,500 NGN) →</span>
          </a>
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 5. Honest Architecture Boundary Notice */}
      {/* ------------------------------------------------------------------- */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 text-xs text-slate-600 space-y-1.5">
        <p className="font-bold text-slate-800">
          Architecture Milestone: Frontend Redesign (FE-01)
        </p>
        <p className="leading-relaxed text-slate-500">
          This installation operates in local-first retail mode with automatic Dexie persistence.
          Server-side authentication (Argon2id + RS256 JWT refresh token lifecycle) has completed backend foundations;
          centralized merchant login, multi-tenant RBAC, and subscription administration will be integrated in subsequent authorized phases.
        </p>
      </div>
    </div>
  );
}
