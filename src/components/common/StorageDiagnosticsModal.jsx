import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Modal from './Modal.jsx';
import Button from './Button.jsx';
import { msme_ledger_db, sb_db, usePendingSyncCount } from '../../config/db.js';
import { pushPendingData } from '../../services/syncService.js';

export default function StorageDiagnosticsModal({ isOpen, onClose, onNavigateSettings }) {
  const pendingCount = usePendingSyncCount();
  const customerCount = useLiveQuery(() => msme_ledger_db.customers.count()) || 0;
  const inventoryCount = useLiveQuery(() => msme_ledger_db.inventory.count()) || 0;
  const salesCount = useLiveQuery(() => msme_ledger_db.sales.count()) || 0;
  const expenseCount = useLiveQuery(() => sb_db.expenses.count()) || 0;

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState(null);

  const handleManualSync = async () => {
    setIsSyncing(true);
    setSyncFeedback(null);
    try {
      const res = await pushPendingData();
      if (res?.status === 'success') {
        setSyncFeedback({
          type: 'success',
          message: res.message || 'All records successfully synchronized with the cloud!'
        });
      } else {
        setSyncFeedback({
          type: 'info',
          message: res?.message || 'Sync completed.'
        });
      }
    } catch (err) {
      setSyncFeedback({
        type: 'error',
        message: err.message || 'Sync failed. Your records remain safe locally.'
      });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Device Storage & Sync Diagnostics"
      subtitle="Local database integrity and cloud synchronization status"
      maxWidth="md"
    >
      <div className="space-y-6">
        {/* Status Indicator Card */}
        <div className="p-5 rounded-2xl bg-[#FAF6EE] border border-[#E5DCC5] space-y-3">
          <div className="flex items-center justify-between pb-3 border-b border-[#E5DCC5]">
            <div className="flex items-center gap-2.5">
              <span className={`w-3 h-3 rounded-full ${pendingCount > 0 ? 'bg-[#BAAB8B] animate-pulse' : 'bg-[#1B4332]'}`} />
              <div>
                <h4 className="text-sm font-black text-[#141816]">
                  {pendingCount > 0 ? `${pendingCount} Records Pending Cloud Sync` : 'Local Storage Clean & Synced'}
                </h4>
                <p className="text-xs text-[#5C6460]">
                  {pendingCount > 0 ? 'Queued to sync when connected to internet' : 'All device records match local database'}
                </p>
              </div>
            </div>
            <span className="text-2xs font-bold uppercase px-2.5 py-1 rounded-full bg-[#D8ECE1] text-[#1B4332] border border-[#B2DAC5]">
              Active
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
            <div className="p-3 rounded-xl bg-[#FDFBF7] border border-[#E5DCC5] text-center">
              <span className="text-2xs font-bold uppercase text-[#5C6460] block">Customers</span>
              <span className="text-lg font-black text-[#141816]">{customerCount}</span>
            </div>
            <div className="p-3 rounded-xl bg-[#FDFBF7] border border-[#E5DCC5] text-center">
              <span className="text-2xs font-bold uppercase text-[#5C6460] block">Products</span>
              <span className="text-lg font-black text-[#141816]">{inventoryCount}</span>
            </div>
            <div className="p-3 rounded-xl bg-[#FDFBF7] border border-[#E5DCC5] text-center">
              <span className="text-2xs font-bold uppercase text-[#5C6460] block">Sales</span>
              <span className="text-lg font-black text-[#141816]">{salesCount}</span>
            </div>
            <div className="p-3 rounded-xl bg-[#FDFBF7] border border-[#E5DCC5] text-center">
              <span className="text-2xs font-bold uppercase text-[#5C6460] block">Expenses</span>
              <span className="text-lg font-black text-[#141816]">{expenseCount}</span>
            </div>
          </div>
        </div>

        {/* Feedback Message */}
        {syncFeedback && (
          <div
            className={`p-3.5 rounded-xl border text-xs font-bold ${
              syncFeedback.type === 'success'
                ? 'bg-[#D8ECE1] border-[#B2DAC5] text-[#1B4332]'
                : 'bg-[#F3EDE0] border-[#E5DCC5] text-[#141816]'
            }`}
          >
            {syncFeedback.message}
          </div>
        )}

        {/* Action Controls */}
        <div className="space-y-3">
          <Button
            variant="primary"
            size="lg"
            isLoading={isSyncing}
            onClick={handleManualSync}
            className="w-full"
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            }
          >
            Run Diagnostic &amp; Sync Now
          </Button>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="md"
              className="flex-1"
              onClick={() => {
                onClose();
                if (typeof onNavigateSettings === 'function') {
                  onNavigateSettings();
                }
              }}
            >
              Storage Settings &amp; Backup
            </Button>
            <Button
              variant="ghost"
              size="md"
              onClick={onClose}
            >
              Close
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
