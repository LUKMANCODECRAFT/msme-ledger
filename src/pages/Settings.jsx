import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { msme_ledger_db, sb_db, usePendingSyncCount } from '../config/db.js';
import { pushPendingData } from '../services/syncService.js';
import { getShopId } from '../utils/shopIdentity.js';
import Button from '../components/common/Button.jsx';

export default function Settings() {
  const [shopNameInput, setShopNameInput] = useState(() => localStorage.getItem('shopName') || '');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState(null);

  const pendingCount = usePendingSyncCount();
  const shopId = getShopId();
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
    setSyncFeedback(null);
    try {
      const result = await pushPendingData();
      if (result.status === 'no_pending') {
        setSyncFeedback({
          type: 'no_pending',
          title: 'No Pending Records',
          message: 'All local records are stored on this device. No records are awaiting synchronization.'
        });
      } else if (result.status === 'partial') {
        setSyncFeedback({
          type: 'partial',
          title: 'Partial Synchronization',
          message: result.message
        });
      } else if (result.status === 'success') {
        setSyncFeedback({
          type: 'success',
          title: 'Synchronization Succeeded',
          message: result.message
        });
      }
    } catch (err) {
      if (err.code === 'SYNC_UNAVAILABLE' || err.details?.status === 410) {
        setSyncFeedback({
          type: 'unavailable',
          title: 'Cloud Synchronization Unavailable',
          message: 'The cloud synchronization endpoint has been retired (HTTP 410) and authenticated v2 cloud synchronization is not yet connected. All pending records remain safely stored locally on this device.'
        });
      } else {
        setSyncFeedback({
          type: 'failed',
          title: 'Synchronization Failed',
          message: err.message
        });
      }
    } finally {
      setIsSyncing(false);
    }
  };

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

        {/* Sync Feedback Result Banner */}
        {syncFeedback && (
          <div
            className={`p-4 rounded-xl border text-xs space-y-1 animate-in fade-in ${
              syncFeedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : syncFeedback.type === 'partial'
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : syncFeedback.type === 'unavailable'
                ? 'bg-amber-50/70 border-amber-300 text-amber-900'
                : syncFeedback.type === 'no_pending'
                ? 'bg-slate-50 border-slate-200 text-slate-700'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            <p className="font-bold">{syncFeedback.title}</p>
            <p className="leading-relaxed">{syncFeedback.message}</p>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 4. Subscription & Device Identity */}
      {/* ------------------------------------------------------------------- */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6 space-y-4">
        <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
          <div>
            <h4 className="text-base font-bold text-slate-900 tracking-tight">Device Identity & Subscription</h4>
            <p className="text-xs text-slate-500">Local device identification and billing status</p>
          </div>
          <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200">
            Subscription Management Unconnected
          </span>
        </div>

        <div className="space-y-3 text-xs text-slate-600">
          <div className="flex justify-between py-1 border-b border-slate-100">
            <span className="font-semibold text-slate-500">Device Shop ID:</span>
            <span className="font-mono font-bold text-slate-900">{shopId}</span>
          </div>

          <div className="flex justify-between py-1 border-b border-slate-100">
            <span className="font-semibold text-slate-500">Subscription Status:</span>
            <span className="font-bold text-slate-700">Offline Evaluation (Billing Not Connected)</span>
          </div>

          <div className="flex justify-between py-1 border-b border-slate-100">
            <span className="font-semibold text-slate-500">Commercial Pricing:</span>
            <span className="font-bold text-slate-500">Pending owner authorization</span>
          </div>
        </div>

        <div className="pt-2 text-xs text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-200">
          <p className="font-semibold text-slate-700">Subscription & Entitlements Notice:</p>
          <p className="mt-0.5">
            Commercial subscription plans, pricing tiers, and online billing are pending backend integration.
            This installation operates in local-first retail mode without hardcoded price assumptions.
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 5. Honest Architecture Boundary Notice */}
      {/* ------------------------------------------------------------------- */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 text-xs text-slate-600 space-y-1.5">
        <p className="font-bold text-slate-800">
          Architecture Milestone: Frontend Redesign & Remediation (FE-01R)
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
