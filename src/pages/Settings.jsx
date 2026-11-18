import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { msme_ledger_db, sb_db, usePendingSyncCount } from '../config/db.js';
import { pushPendingData } from '../services/syncService.js';
import { getShopId } from '../utils/shopIdentity.js';
import Button from '../components/common/Button.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useSubscription } from '../context/SubscriptionContext.jsx';

export default function Settings() {
  const [shopNameInput, setShopNameInput] = useState(() => localStorage.getItem('shopName') || '');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState(null);

  const { user, isAuthenticated, currentBusinessId, currentRole, businesses, switchBusiness, logout } = useAuth();
  const { subscription, entitlementStatus, isReadOnly, statusMessage, getInstructions, submitProof } = useSubscription();

  const [instructionsData, setInstructionsData] = useState(null);
  const [proofForm, setProofForm] = useState({ planId: 'pro', reference: '', amount: '5000' });
  const [proofSubmitting, setProofSubmitting] = useState(false);
  const [proofFeedback, setProofFeedback] = useState(null);

  const pendingCount = usePendingSyncCount();
  const shopId = currentBusinessId || getShopId();
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

  const handleLoadInstructions = async () => {
    try {
      const data = await getInstructions();
      setInstructionsData(data);
      if (data?.paymentReference) {
        setProofForm(prev => ({ ...prev, reference: data.paymentReference }));
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const handleSubmitPaymentProof = async (e) => {
    e.preventDefault();
    setProofSubmitting(true);
    setProofFeedback(null);
    try {
      const amountKobo = Math.round(parseFloat(proofForm.amount) * 100);
      await submitProof({
        planId: proofForm.planId,
        reference: proofForm.reference,
        amount: amountKobo
      });
      setProofFeedback({
        type: 'success',
        message: `Proof for ${proofForm.reference} submitted successfully! Awaiting administrative review.`
      });
    } catch (err) {
      setProofFeedback({
        type: 'error',
        message: err.message
      });
    } finally {
      setProofSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl animate-in fade-in duration-200">
      {/* ------------------------------------------------------------------- */}
      {/* 1. Header */}
      {/* ------------------------------------------------------------------- */}
      <div className="border-b border-slate-200 pb-2">
        <h3 className="text-xl font-bold text-slate-900 tracking-tight">System Settings & Profile</h3>
        <p className="text-xs text-slate-500">Business configuration, multi-tenant RBAC, offline storage, and subscription</p>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 2. Authentication & Tenant Identity */}
      {/* ------------------------------------------------------------------- */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6 space-y-4">
        <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
          <div>
            <h4 className="text-base font-bold text-slate-900 tracking-tight">Merchant & Tenant Identity</h4>
            <p className="text-xs text-slate-500">Authenticated user identity, business switching, and role boundaries</p>
          </div>
          <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200">
            Role: <span className="uppercase text-emerald-700">{currentRole}</span>
          </span>
        </div>

        <div className="space-y-3 text-xs text-slate-600">
          <div className="flex justify-between py-1 border-b border-slate-100">
            <span className="font-semibold text-slate-500">Active Business UUID:</span>
            <span className="font-mono font-bold text-slate-900">{shopId}</span>
          </div>

          <div className="flex justify-between py-1 border-b border-slate-100">
            <span className="font-semibold text-slate-500">Authenticated Account:</span>
            <span className="font-bold text-slate-900">
              {isAuthenticated ? `${user?.fullName} (${user?.email})` : 'Local Retail Device (Unlinked)'}
            </span>
          </div>

          {businesses.length > 1 && (
            <div className="pt-2">
              <label className="font-bold text-slate-700 block mb-1">Switch Active Tenant:</label>
              <select
                value={currentBusinessId}
                onChange={(e) => switchBusiness(e.target.value)}
                className="w-full text-xs font-semibold p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none"
              >
                {businesses.map(b => (
                  <option key={b.id} value={b.id}>{b.name} ({b.id})</option>
                ))}
              </select>
            </div>
          )}

          {isAuthenticated && (
            <div className="pt-2 flex justify-end">
              <Button variant="outline" size="sm" onClick={logout}>
                Sign Out Merchant Session
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 3. Business Profile Card */}
      {/* ------------------------------------------------------------------- */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6 space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <h4 className="text-base font-bold text-slate-900 tracking-tight">Business Profile</h4>
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
                Shop name updated successfully!
              </span>
            )}
          </div>
        </form>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 4. Manual Subscription & Bank Transfer Entitlements */}
      {/* ------------------------------------------------------------------- */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6 space-y-4">
        <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
          <div>
            <h4 className="text-base font-bold text-slate-900 tracking-tight">Subscription & Store Entitlements</h4>
            <p className="text-xs text-slate-500">Manual bank-transfer subscription workflow with offline entitlement protection</p>
          </div>
          <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200">
            {subscription ? (
              <span className={`uppercase font-extrabold ${entitlementStatus === 'active' ? 'text-emerald-700' : 'text-rose-700'}`}>
                {entitlementStatus.replace('_', ' ')}
              </span>
            ) : (
              'Subscription Management Unconnected'
            )}
          </span>
        </div>

        <div className="space-y-3 text-xs text-slate-600">
          <div className="flex justify-between py-1 border-b border-slate-100">
            <span className="font-semibold text-slate-500">Subscription Status:</span>
            <span className="font-bold text-slate-700">
              {subscription ? entitlementStatus.replace('_', ' ') : 'Offline Evaluation (Billing Not Connected)'}
            </span>
          </div>

          <div className="flex justify-between py-1 border-b border-slate-100">
            <span className="font-semibold text-slate-500">Access Mode:</span>
            <span className={`font-bold ${isReadOnly ? 'text-rose-600' : 'text-emerald-600'}`}>
              {isReadOnly ? 'Read-Only (Subscribed writes locked)' : 'Read-Write (Full Access)'}
            </span>
          </div>

          <div className="flex justify-between py-1 border-b border-slate-100">
            <span className="font-semibold text-slate-500">Anti-Clock-Tampering Guard:</span>
            <span className="font-mono text-slate-800">
              {entitlementStatus === 'clock_tampered_locked' ? 'Tampering Detected (Locked)' : 'Verified Synchronized'}
            </span>
          </div>

          {subscription?.expiresAt && (
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="font-semibold text-slate-500">Subscription Expiration:</span>
              <span className="font-mono text-slate-800">
                {new Date(subscription.expiresAt).toLocaleDateString()}
              </span>
            </div>
          )}
        </div>

        {/* Dynamic Bank Instructions Trigger */}
        <div className="pt-2">
          {!instructionsData ? (
            <div className="p-4 bg-[#FAF6EE] rounded-xl border border-[#E5DCC5] text-xs space-y-3">
              <div className="flex items-center justify-between border-b border-[#E5DCC5] pb-2">
                <span className="font-bold text-[#141816]">Official Subscription Bank Transfer</span>
                <span className="text-2xs font-semibold px-2 py-0.5 rounded bg-[#D8ECE1] text-[#1B4332] border border-[#B2DAC5]">
                  Manual Transfer
                </span>
              </div>
              <p className="text-xs text-[#5C6460] leading-relaxed">
                We accept subscription payments via direct bank transfer from any Nigerian bank app or USSD. Click the button below to generate your unique reference code and reveal the designated transfer account.
              </p>
              <Button variant="primary" size="sm" onClick={handleLoadInstructions}>
                Get Dynamic Bank Payment Details (REF-SB-XXXX)
              </Button>
            </div>
          ) : (
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <span className="font-bold text-slate-800">Official Bank Transfer Instructions:</span>
                <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  {instructionsData.paymentReference}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 py-1">
                <div>
                  <span className="text-slate-500 block">Bank Name:</span>
                  <span className="font-bold text-slate-800">{instructionsData.bankDetails.bankName}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Account Name:</span>
                  <span className="font-bold text-slate-800">{instructionsData.bankDetails.accountName}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Account Number:</span>
                  <span className="font-bold text-slate-800 font-mono">{instructionsData.bankDetails.accountNumber}</span>
                </div>
              </div>
              <p className="text-2xs text-slate-500">
                Include the reference code in your transfer description. After completing the transfer, submit proof below.
              </p>
            </div>
          )}
        </div>

        {/* Payment Proof Submission Form */}
        <form onSubmit={handleSubmitPaymentProof} className="pt-2 space-y-3">
          <h5 className="text-xs font-bold text-slate-800">Submit Bank Transfer Proof</h5>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-2xs font-bold text-slate-600 block mb-1">Plan Tier</label>
              <select
                value={proofForm.planId}
                onChange={(e) => setProofForm({ ...proofForm, planId: e.target.value, amount: e.target.value === 'enterprise' ? '15000' : '5000' })}
                className="w-full text-xs font-semibold p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none"
              >
                <option value="pro">Pro Merchant (₦5,000 / mo)</option>
                <option value="enterprise">Enterprise Multi-Shop (₦15,000 / mo)</option>
              </select>
            </div>

            <div>
              <label className="text-2xs font-bold text-slate-600 block mb-1">Payment Reference</label>
              <input
                type="text"
                required
                value={proofForm.reference}
                onChange={(e) => setProofForm({ ...proofForm, reference: e.target.value })}
                placeholder="REF-SB-XXXX"
                className="w-full text-xs font-mono font-bold p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none"
              />
            </div>

            <div>
              <label className="text-2xs font-bold text-slate-600 block mb-1">Amount Paid (₦)</label>
              <input
                type="number"
                required
                value={proofForm.amount}
                onChange={(e) => setProofForm({ ...proofForm, amount: e.target.value })}
                className="w-full text-xs font-bold p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" size="sm" isLoading={proofSubmitting}>
              Submit Transfer Proof for Verification
            </Button>
            {proofFeedback && (
              <span className={`text-xs font-bold ${proofFeedback.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
                {proofFeedback.message}
              </span>
            )}
          </div>
        </form>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 5. Offline Storage & Local Database Health */}
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
    </div>
  );
}
