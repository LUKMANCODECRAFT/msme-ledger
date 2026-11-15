import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { msme_ledger_db } from '../config/db.js';
import { formatNaira, formatDate, formatPhoneDisplay, generateWhatsAppLink } from '../utils/formatters.js';
import { recordCustomerRepayment, clearCustomerDebt } from '../services/ledgerService.js';
import Button from '../components/common/Button.jsx';
import Modal from '../components/common/Modal.jsx';
import StatCard from '../components/common/StatCard.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import { SyncStatusBadge } from '../components/common/Badge.jsx';

export default function CreditBook() {
  const [activeSubTab, setActiveSubTab] = useState('DEBTORS'); // 'DEBTORS' | 'HISTORY'
  const [searchQuery, setSearchQuery] = useState('');

  // Modal: Record Repayment
  const [selectedDebtor, setSelectedDebtor] = useState(null);
  const [repaymentAmountNaira, setRepaymentAmountNaira] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Live queries
  const allCustomers = useLiveQuery(() => msme_ledger_db.customers.toArray()) || [];
  const transactions = useLiveQuery(() => msme_ledger_db.transactions?.toArray?.() || []) || [];

  // Customer map
  const customerMap = useMemo(() => {
    return allCustomers.reduce((acc, c) => {
      acc[c.id] = c;
      return acc;
    }, {});
  }, [allCustomers]);

  // Debtors list: customers with totalDebt > 0, highest debt first
  const debtors = useMemo(() => {
    return allCustomers
      .filter(c => (c.totalDebt || 0) > 0)
      .sort((a, b) => b.totalDebt - a.totalDebt);
  }, [allCustomers]);

  // Filtered debtors
  const filteredDebtors = useMemo(() => {
    if (!searchQuery.trim()) return debtors;
    const q = searchQuery.toLowerCase();
    return debtors.filter(d => (d.name || '').toLowerCase().includes(q) || (d.phone || '').includes(q));
  }, [debtors, searchQuery]);

  // Repayment history list: transactions of type 'PAYMENT', newest first
  const repaymentHistory = useMemo(() => {
    return transactions
      .filter(t => t.type === 'PAYMENT')
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [transactions]);

  // Metrics
  const stats = useMemo(() => {
    const totalReceivablesKobo = debtors.reduce((sum, d) => sum + (d.totalDebt || 0), 0);
    const debtorCount = debtors.length;
    const totalRecoveredKobo = repaymentHistory.reduce((sum, r) => sum + (r.amount || 0), 0);

    return { totalReceivablesKobo, debtorCount, totalRecoveredKobo };
  }, [debtors, repaymentHistory]);

  // Handle Record Repayment
  const handleRecordRepayment = async (e) => {
    e.preventDefault();
    if (!selectedDebtor) return;

    const parsedNaira = parseFloat(repaymentAmountNaira);
    if (isNaN(parsedNaira) || parsedNaira <= 0) {
      alert('Please enter a valid repayment amount in Naira.');
      return;
    }

    const currentDebtKobo = selectedDebtor.totalDebt || 0;
    const paymentKobo = Math.round(parsedNaira * 100);

    if (paymentKobo > currentDebtKobo) {
      alert(`Payment cannot be greater than the outstanding debt of ${formatNaira(currentDebtKobo)}.`);
      return;
    }

    setIsSubmitting(true);
    try {
      await recordCustomerRepayment({
        customerId: selectedDebtor.id,
        amountKobo: paymentKobo,
        paymentMethod: 'cash',
        notes: `Customer debt repayment from Credit Book`
      });

      setSelectedDebtor(null);
      setRepaymentAmountNaira('');
    } catch (err) {
      alert(`Failed to record repayment: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Full Clear Debt
  const handleClearDebt = async (debtor) => {
    if (window.confirm(`Has "${debtor.name}" fully cleared their debt of ${formatNaira(debtor.totalDebt)}?`)) {
      try {
        await clearCustomerDebt({
          customerId: debtor.id,
          paymentMethod: 'cash',
          notes: 'Full debt settlement via Credit Book'
        });
      } catch (err) {
        alert(`Failed to clear debt: ${err.message}`);
      }
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* ------------------------------------------------------------------- */}
      {/* 1. Header Banner */}
      {/* ------------------------------------------------------------------- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900 tracking-tight">Credit Book & Debt Recovery</h3>
          <p className="text-xs text-slate-500">Track outstanding receivables, record settlements, and send WhatsApp reminders</p>
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 2. Key Metrics */}
      {/* ------------------------------------------------------------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Total Outstanding Receivables"
          value={formatNaira(stats.totalReceivablesKobo)}
          subtitle={`${stats.debtorCount} customers with unpaid balances`}
          accentColor={stats.totalReceivablesKobo > 0 ? 'rose' : 'emerald'}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />

        <StatCard
          title="Active Debtors"
          value={stats.debtorCount}
          subtitle="Customers requiring recovery action"
          accentColor={stats.debtorCount > 0 ? 'amber' : 'slate'}
          badge={stats.debtorCount > 0 ? 'Action Needed' : 'Books Clear'}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          }
        />

        <StatCard
          title="Total Repayments Recovered"
          value={formatNaira(stats.totalRecoveredKobo)}
          subtitle={`${repaymentHistory.length} repayment transactions logged`}
          accentColor="emerald"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 3. Sub-Tab Switcher & Search Bar */}
      {/* ------------------------------------------------------------------- */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl text-xs font-bold">
          <button
            type="button"
            onClick={() => setActiveSubTab('DEBTORS')}
            className={`px-4 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
              activeSubTab === 'DEBTORS' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Active Debtors ({debtors.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('HISTORY')}
            className={`px-4 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
              activeSubTab === 'HISTORY' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Repayment Ledger ({repaymentHistory.length})
          </button>
        </div>

        {activeSubTab === 'DEBTORS' && (
          <div className="relative min-w-[260px]">
            <input
              type="text"
              placeholder="Search debtors..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs font-medium pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
            />
            <svg className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 4. Tab A: Active Debtors Cards */}
      {/* ------------------------------------------------------------------- */}
      {activeSubTab === 'DEBTORS' && (
        filteredDebtors.length === 0 ? (
          <EmptyState
            title="No outstanding debt"
            description={searchQuery ? 'No debtors match your search.' : 'Your customer credit ledger is completely clean. All sales are paid in full.'}
            actionLabel={searchQuery ? 'Clear Search' : undefined}
            onAction={searchQuery ? () => setSearchQuery('') : undefined}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredDebtors.map(debtor => (
              <div
                key={debtor.id}
                className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between gap-4 hover:border-slate-300 transition-all"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-base font-bold text-slate-900 tracking-tight">{debtor.name}</h4>
                      <p className="text-xs text-slate-500 font-medium mt-0.5">{formatPhoneDisplay(debtor.phone)}</p>
                    </div>
                    <span className="text-xs font-bold text-rose-700 bg-rose-50 px-2.5 py-0.5 rounded-md border border-rose-200/80">
                      Unsettled
                    </span>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-baseline justify-between">
                    <span className="text-xs text-slate-500 font-medium">Balance Due:</span>
                    <span className="text-xl font-black text-rose-600">
                      {formatNaira(debtor.totalDebt)}
                    </span>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center gap-2 flex-wrap sm:flex-nowrap">
                  <Button
                    variant="primary"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      setSelectedDebtor(debtor);
                      setRepaymentAmountNaira('');
                    }}
                  >
                    Record Payment
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleClearDebt(debtor)}
                    className="hover:border-rose-300 hover:text-rose-700"
                  >
                    Clear
                  </Button>

                  <a
                    href={generateWhatsAppLink(debtor)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center text-xs font-bold px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-2xs"
                  >
                    WhatsApp
                  </a>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ------------------------------------------------------------------- */}
      {/* 5. Tab B: Repayment Ledger History */}
      {/* ------------------------------------------------------------------- */}
      {activeSubTab === 'HISTORY' && (
        repaymentHistory.length === 0 ? (
          <EmptyState
            title="No repayments recorded yet"
            description="When customers make partial or full settlements towards their debts, those transactions are permanently tracked here."
          />
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50/70 border-b border-slate-200/80 text-slate-500 font-bold text-xs uppercase tracking-wider">
                    <th className="py-3.5 px-4">Date</th>
                    <th className="py-3.5 px-4">Customer</th>
                    <th className="py-3.5 px-4">Type</th>
                    <th className="py-3.5 px-4 text-right">Amount Recovered (₦)</th>
                    <th className="py-3.5 px-4 text-center">Sync Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {repaymentHistory.map((repay) => {
                    const cust = customerMap[repay.customerId];
                    return (
                      <tr key={repay.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3.5 px-4 text-xs text-slate-500 whitespace-nowrap font-medium">
                          {formatDate(repay.date)}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-slate-900">
                          {cust?.name || 'Customer Repayment'}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="text-2xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                            Debt Settlement
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right font-black text-emerald-600 whitespace-nowrap">
                          {formatNaira(repay.amount)}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <SyncStatusBadge status={repay.sync_status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50/50 text-xs text-slate-500 flex justify-between">
              <span>{repaymentHistory.length} total settlements recorded</span>
              <span className="font-bold text-emerald-700">Total: {formatNaira(stats.totalRecoveredKobo)}</span>
            </div>
          </div>
        )
      )}

      {/* ------------------------------------------------------------------- */}
      {/* Modal: Record Repayment */}
      {/* ------------------------------------------------------------------- */}
      {selectedDebtor && (
        <Modal
          isOpen={!!selectedDebtor}
          onClose={() => setSelectedDebtor(null)}
          title={`Record Repayment: ${selectedDebtor.name}`}
          subtitle={`Current total debt: ${formatNaira(selectedDebtor.totalDebt)}`}
        >
          <form onSubmit={handleRecordRepayment} className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-bold text-slate-700">Payment Amount Received (₦)</label>
                <button
                  type="button"
                  onClick={() => setRepaymentAmountNaira(((selectedDebtor.totalDebt || 0) / 100).toString())}
                  className="text-2xs font-bold text-emerald-600 hover:underline"
                >
                  Pay Full ({formatNaira(selectedDebtor.totalDebt)})
                </button>
              </div>
              <input
                type="number"
                step="any"
                min="0"
                required
                placeholder="0.00"
                value={repaymentAmountNaira}
                onChange={(e) => setRepaymentAmountNaira(e.target.value)}
                className="w-full text-base font-bold p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>

            {repaymentAmountNaira && !isNaN(parseFloat(repaymentAmountNaira)) && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs flex justify-between">
                <span className="font-semibold text-slate-600">Remaining Balance:</span>
                <span className="font-bold text-slate-900">
                  {formatNaira(Math.max(0, (selectedDebtor.totalDebt || 0) - Math.round(parseFloat(repaymentAmountNaira) * 100)))}
                </span>
              </div>
            )}

            <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200/80 text-2xs text-amber-800">
              Rule compliance: Debt repayments reduce customer receivables and are recorded as financial repayments, not as new sales revenue.
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="md" onClick={() => setSelectedDebtor(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="md" isLoading={isSubmitting}>
                Save Repayment
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
