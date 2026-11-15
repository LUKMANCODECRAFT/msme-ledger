import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { msme_ledger_db, sb_db } from '../config/db.js';
import { formatNaira, formatDate } from '../utils/formatters.js';
import Badge, { PaymentStatusBadge, SyncStatusBadge } from '../components/common/Badge.jsx';
import Button from '../components/common/Button.jsx';
import EmptyState from '../components/common/EmptyState.jsx';

export default function BusinessBook({ onNavigate }) {
  const [filterType, setFilterType] = useState('ALL'); // 'ALL' | 'SALES' | 'REPAYMENTS' | 'EXPENSES'
  const [searchQuery, setSearchQuery] = useState('');

  const sales = useLiveQuery(() => msme_ledger_db.sales.toArray()) || [];
  const customers = useLiveQuery(() => msme_ledger_db.customers.toArray()) || [];
  const transactions = useLiveQuery(() => msme_ledger_db.transactions?.toArray?.() || []) || [];
  const expenses = useLiveQuery(() => sb_db.expenses?.toArray?.() || []) || [];

  // Map customer IDs to names
  const customerMap = useMemo(() => {
    return customers.reduce((acc, c) => {
      acc[c.id] = c.name;
      return acc;
    }, {});
  }, [customers]);

  // Unified chronological ledger entries
  const unifiedEntries = useMemo(() => {
    const list = [];

    // 1. Sales entries
    sales.forEach(s => {
      list.push({
        id: s.id,
        rawDate: new Date(s.date),
        type: 'SALE',
        typeLabel: 'Sale',
        counterparty: customerMap[s.customerId] || 'Walk-in Customer',
        reference: s.id.slice(0, 8).toUpperCase(),
        totalAmountKobo: s.totalAmount || 0,
        amountPaidKobo: s.amountPaid || 0,
        balanceKobo: s.balance || 0,
        isInflow: true,
        paymentStatus: s.paymentStatus,
        syncStatus: s.sync_status || 'synced'
      });
    });

    // 2. Debt Repayment transactions (Financial Inflow)
    transactions.forEach(t => {
      if (t.type === 'PAYMENT') {
        list.push({
          id: t.id,
          rawDate: new Date(t.date),
          type: 'REPAYMENT',
          typeLabel: 'Debt Repayment',
          counterparty: customerMap[t.customerId] || 'Customer Repayment',
          reference: t.id.slice(0, 8).toUpperCase(),
          totalAmountKobo: t.amount || 0,
          amountPaidKobo: t.amount || 0,
          balanceKobo: 0,
          isInflow: true,
          paymentStatus: 'paid',
          syncStatus: t.sync_status || 'pending'
        });
      }
    });

    // 3. Operating expenses (Financial Outflow)
    expenses.forEach(e => {
      list.push({
        id: e.id,
        rawDate: new Date(e.expenseDate || e.createdAt || Date.now()),
        type: 'EXPENSE',
        typeLabel: 'Expense',
        counterparty: e.category || 'Operating Overhead',
        reference: e.id ? e.id.slice(0, 8).toUpperCase() : 'EXP',
        totalAmountKobo: e.amount || 0,
        amountPaidKobo: e.amount || 0,
        balanceKobo: 0,
        isInflow: false,
        paymentStatus: 'paid',
        syncStatus: e.sync_status || 'pending'
      });
    });

    // Sort newest first
    return list.sort((a, b) => b.rawDate - a.rawDate);
  }, [sales, transactions, expenses, customerMap]);

  // Filtered entries
  const filteredEntries = useMemo(() => {
    return unifiedEntries.filter(entry => {
      if (filterType !== 'ALL' && entry.type !== filterType) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesParty = entry.counterparty.toLowerCase().includes(query);
        const matchesRef = entry.reference.toLowerCase().includes(query);
        if (!matchesParty && !matchesRef) return false;
      }
      return true;
    });
  }, [unifiedEntries, filterType, searchQuery]);

  // Aggregate metrics
  const totals = useMemo(() => {
    const grossSalesKobo = sales.reduce((sum, s) => sum + (s.totalAmount || 0), 0);
    const cashInflowsKobo = unifiedEntries.filter(e => e.isInflow).reduce((sum, e) => sum + (e.amountPaidKobo || 0), 0);
    const totalOutflowsKobo = unifiedEntries.filter(e => !e.isInflow).reduce((sum, e) => sum + (e.totalAmountKobo || 0), 0);
    return { grossSalesKobo, cashInflowsKobo, totalOutflowsKobo };
  }, [sales, unifiedEntries]);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* ------------------------------------------------------------------- */}
      {/* 1. Summary Bar */}
      {/* ------------------------------------------------------------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200/90 shadow-2xs">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Gross Sales Recorded</p>
          <p className="text-xl font-black text-slate-900 mt-1">{formatNaira(totals.grossSalesKobo)}</p>
          <p className="text-2xs text-slate-400 mt-0.5">{sales.length} transactions</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/90 shadow-2xs">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Cash Inflows Collected</p>
          <p className="text-xl font-black text-emerald-600 mt-1">{formatNaira(totals.cashInflowsKobo)}</p>
          <p className="text-2xs text-slate-400 mt-0.5">Sales cash + debt payments</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/90 shadow-2xs">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Recorded Outflows</p>
          <p className="text-xl font-black text-slate-800 mt-1">{formatNaira(totals.totalOutflowsKobo)}</p>
          <p className="text-2xs text-slate-400 mt-0.5">{expenses.length} operating expenses</p>
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 2. Filter & Search Controls */}
      {/* ------------------------------------------------------------------- */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        {/* Type Filter Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl overflow-x-auto text-xs font-bold">
          <button
            type="button"
            onClick={() => setFilterType('ALL')}
            className={`px-3.5 py-1.5 rounded-lg transition-colors whitespace-nowrap ${filterType === 'ALL' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
          >
            All Activity ({unifiedEntries.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('SALE')}
            className={`px-3.5 py-1.5 rounded-lg transition-colors whitespace-nowrap ${filterType === 'SALE' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
          >
            Sales ({sales.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('REPAYMENT')}
            className={`px-3.5 py-1.5 rounded-lg transition-colors whitespace-nowrap ${filterType === 'REPAYMENT' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
          >
            Repayments ({transactions.filter(t => t.type === 'PAYMENT').length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('EXPENSE')}
            className={`px-3.5 py-1.5 rounded-lg transition-colors whitespace-nowrap ${filterType === 'EXPENSE' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
          >
            Expenses ({expenses.length})
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative min-w-[260px]">
          <input
            type="text"
            placeholder="Search by customer or ref..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-xs font-medium pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
          />
          <svg className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 3. Chronological Activity Table */}
      {/* ------------------------------------------------------------------- */}
      {filteredEntries.length === 0 ? (
        <EmptyState
          title="No business records found"
          description={searchQuery ? 'No records match your search criteria. Clear the search bar to see all entries.' : 'Your complete business activity history will be compiled here chronologically.'}
          actionLabel={searchQuery ? 'Clear Search' : 'Record a Sale (POS)'}
          onAction={() => {
            if (searchQuery) setSearchQuery('');
            else onNavigate('pos');
          }}
        />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-200/80 text-slate-500 font-bold text-xs uppercase tracking-wider">
                  <th className="py-3.5 px-4">Date & Time</th>
                  <th className="py-3.5 px-4">Type</th>
                  <th className="py-3.5 px-4">Party / Detail</th>
                  <th className="py-3.5 px-4">Reference</th>
                  <th className="py-3.5 px-4 text-right">Inflow (+₦)</th>
                  <th className="py-3.5 px-4 text-right">Outflow (-₦)</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                  <th className="py-3.5 px-4 text-center">Sync</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEntries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3.5 px-4 text-xs text-slate-600 font-medium whitespace-nowrap">
                      {formatDate(entry.rawDate)}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className={`inline-flex items-center text-xs font-bold px-2 py-0.5 rounded-md border ${
                        entry.type === 'SALE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200/80' :
                        entry.type === 'REPAYMENT' ? 'bg-blue-50 text-blue-700 border-blue-200/80' :
                        'bg-amber-50 text-amber-700 border-amber-200/80'
                      }`}>
                        {entry.typeLabel}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-bold text-slate-900">
                      {entry.counterparty}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-500">
                      {entry.reference}
                    </td>
                    <td className="py-3.5 px-4 text-right font-black text-emerald-600 whitespace-nowrap">
                      {entry.isInflow ? (
                        <div>
                          <span>{formatNaira(entry.amountPaidKobo)}</span>
                          {entry.balanceKobo > 0 && (
                            <span className="block text-2xs font-semibold text-rose-500">
                              (Credit: {formatNaira(entry.balanceKobo)})
                            </span>
                          )}
                        </div>
                      ) : '—'}
                    </td>
                    <td className="py-3.5 px-4 text-right font-black text-slate-700 whitespace-nowrap">
                      {!entry.isInflow ? formatNaira(entry.totalAmountKobo) : '—'}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <PaymentStatusBadge status={entry.paymentStatus} />
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <SyncStatusBadge status={entry.syncStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4 border-t border-slate-100 bg-slate-50/50 text-xs text-slate-500 flex items-center justify-between">
            <span>Showing {filteredEntries.length} chronological activity entries</span>
            <span>All amounts stored as native integer kobo</span>
          </div>
        </div>
      )}
    </div>
  );
}
