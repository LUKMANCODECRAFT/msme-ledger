import React, { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { msme_ledger_db, sb_db } from '../config/db.js';
import { formatNaira, formatDate } from '../utils/formatters.js';
import StatCard from '../components/common/StatCard.jsx';
import Button from '../components/common/Button.jsx';
import { PaymentStatusBadge } from '../components/common/Badge.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useSubscription } from '../context/SubscriptionContext.jsx';

export default function Overview({ onNavigate }) {
  const { currentRole, currentBusinessId } = useAuth();
  const { entitlementStatus } = useSubscription();

  // Live queries across actual stores
  const sales = useLiveQuery(() => msme_ledger_db.sales.toArray()) || [];
  const customers = useLiveQuery(() => msme_ledger_db.customers.toArray()) || [];
  const inventory = useLiveQuery(() => msme_ledger_db.inventory.toArray()) || [];
  const repayments = useLiveQuery(() => msme_ledger_db.transactions?.toArray?.() || []) || [];
  const expenses = useLiveQuery(() => sb_db.expenses?.toArray?.() || []) || [];

  // Customer ID -> Name map for fast O(1) resolution
  const customerMap = useMemo(() => {
    return customers.reduce((acc, c) => {
      acc[c.id] = c.name;
      return acc;
    }, {});
  }, [customers]);

  // Financial calculations strictly in integer kobo
  const financialStats = useMemo(() => {
    // 1. Gross Sales Revenue (sum of all sales totalAmount)
    const totalSalesRevenueKobo = sales.reduce((sum, s) => sum + (s.totalAmount || 0), 0);

    // 2. Direct Sales Cash Received (sum of amountPaid on sales)
    const salesCashReceivedKobo = sales.reduce((sum, s) => sum + (s.amountPaid || 0), 0);

    // 3. Debt Repayment Cash Received (sum of repayment transactions)
    const repaymentCashKobo = repayments
      .filter(t => t.type === 'PAYMENT')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    // Total actual Cash Collected
    const totalCashCollectedKobo = salesCashReceivedKobo + repaymentCashKobo;

    // 4. Total Outstanding Receivables (sum of customer debts)
    const totalReceivablesKobo = customers.reduce((sum, c) => sum + (c.totalDebt || 0), 0);

    // 5. Total Expenses Recorded
    const totalExpensesKobo = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

    // 6. Net Cash Movement (Cash collected minus expenses)
    const netCashMovementKobo = totalCashCollectedKobo - totalExpensesKobo;

    return {
      totalSalesRevenueKobo,
      totalCashCollectedKobo,
      totalReceivablesKobo,
      totalExpensesKobo,
      netCashMovementKobo
    };
  }, [sales, repayments, customers, expenses]);

  // Inventory indicators
  const inventoryStats = useMemo(() => {
    const totalItems = inventory.length;
    const outOfStock = inventory.filter(i => (i.stockCount || 0) <= 0).length;
    const lowStock = inventory.filter(i => (i.stockCount || 0) > 0 && (i.stockCount || 0) <= 5).length;
    const totalUnits = inventory.reduce((sum, i) => sum + (i.stockCount || 0), 0);
    const stockValuationKobo = inventory.reduce((sum, i) => sum + ((i.price || 0) * (i.stockCount || 0)), 0);

    return {
      totalItems,
      outOfStock,
      lowStock,
      totalUnits,
      stockValuationKobo
    };
  }, [inventory]);

  // Top Debtors (customers with debt > 0, highest first)
  const topDebtors = useMemo(() => {
    return customers
      .filter(c => (c.totalDebt || 0) > 0)
      .sort((a, b) => b.totalDebt - a.totalDebt)
      .slice(0, 5);
  }, [customers]);

  // Recent 8 Sales
  const recentSales = useMemo(() => {
    return [...sales]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 8);
  }, [sales]);

  const hasAnyActivity = sales.length > 0 || customers.length > 0 || inventory.length > 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* ------------------------------------------------------------------- */}
      {/* 1. Quick Actions Hero Banner */}
      {/* ------------------------------------------------------------------- */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-6 text-white shadow-md flex flex-col md:flex-row md:items-center md:justify-between gap-6 border border-slate-700/60">
        <div className="space-y-1.5 max-w-xl">
          <div className="flex items-center gap-2">
            <span className="text-2xs font-bold tracking-widest uppercase text-emerald-400 bg-emerald-950/80 px-2.5 py-1 rounded-md border border-emerald-800/80">
              Retail Operations • {currentRole.toUpperCase()}
            </span>
            <span className="text-2xs font-bold tracking-widest uppercase text-slate-300 bg-slate-800/80 px-2.5 py-1 rounded-md border border-slate-700">
              Plan: {entitlementStatus.toUpperCase()}
            </span>
          </div>
          <h2 className="text-xl md:text-2xl font-black tracking-tight text-white">
            Daily Financial & Sales Pulse
          </h2>
          <p className="text-sm text-slate-300">
            Real-time local ledger statistics calculated directly from your device records.
          </p>
        </div>

        {/* Quick Launch Action Buttons */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <Button
            variant="primary"
            size="md"
            onClick={() => onNavigate('pos')}
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            }
          >
            New Sale (POS)
          </Button>

          <Button
            variant="outline"
            size="md"
            onClick={() => onNavigate('inventory')}
            className="bg-slate-800 text-white border-slate-700 hover:bg-slate-700 hover:text-white"
          >
            + Add Stock
          </Button>

          <Button
            variant="outline"
            size="md"
            onClick={() => onNavigate('credit_book')}
            className="bg-slate-800 text-white border-slate-700 hover:bg-slate-700 hover:text-white"
          >
            Credit Book
          </Button>
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 2. Key Performance Indicators (Real Data Only) */}
      {/* ------------------------------------------------------------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
        <StatCard
          title="Total Sales Revenue"
          value={formatNaira(financialStats.totalSalesRevenueKobo)}
          subtitle={`${sales.length} transactions recorded`}
          accentColor="emerald"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />

        <StatCard
          title="Cash Collected"
          value={formatNaira(financialStats.totalCashCollectedKobo)}
          subtitle="Sales cash + debt recoveries"
          accentColor="blue"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          }
        />

        <StatCard
          title="Outstanding Receivables"
          value={formatNaira(financialStats.totalReceivablesKobo)}
          subtitle={`${topDebtors.length} active customer debtors`}
          accentColor={financialStats.totalReceivablesKobo > 0 ? 'rose' : 'slate'}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          }
        />

        <StatCard
          title="Inventory Valuation"
          value={formatNaira(inventoryStats.stockValuationKobo)}
          subtitle={`${inventoryStats.totalUnits} items in catalog`}
          accentColor={inventoryStats.outOfStock > 0 ? 'amber' : 'emerald'}
          badge={inventoryStats.outOfStock > 0 ? `${inventoryStats.outOfStock} out of stock` : undefined}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          }
        />
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 3. Main Dashboard Body: Left Column Sales, Right Column Alerts */}
      {/* ------------------------------------------------------------------- */}
      {!hasAnyActivity ? (
        <EmptyState
          title="Welcome to your new Business Dashboard"
          description="Your sales, receivables, and inventory alerts will automatically appear here as you record daily activity."
          actionLabel="Go to Sales / POS"
          onAction={() => onNavigate('pos')}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Sales Ledger Column (2 cols wide on desktop) */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden flex flex-col">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 tracking-tight">Recent Sales Activity</h3>
                <p className="text-xs text-slate-500">Latest transactions finalized at the cashier</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onNavigate('business_book')}
              >
                View Business Book →
              </Button>
            </div>

            {recentSales.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-sm">
                No sales recorded yet. Click "New Sale (POS)" to record your first sale.
              </div>
            ) : (
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50/70 border-b border-slate-100 text-slate-500 font-semibold text-xs uppercase tracking-wider">
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Customer</th>
                      <th className="py-3 px-4">Items</th>
                      <th className="py-3 px-4 text-right">Total</th>
                      <th className="py-3 px-4 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recentSales.map((sale) => (
                      <tr key={sale.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3.5 px-4 text-xs text-slate-500 whitespace-nowrap">
                          {formatDate(sale.date)}
                        </td>
                        <td className="py-3.5 px-4 font-semibold text-slate-900">
                          {customerMap[sale.customerId] || 'Walk-in Customer'}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600">
                          {sale.items?.length || 1} item{sale.items?.length === 1 ? '' : 's'}
                        </td>
                        <td className="py-3.5 px-4 text-right font-bold text-slate-900">
                          {formatNaira(sale.totalAmount)}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <PaymentStatusBadge status={sale.paymentStatus} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Right Column: Receivables & Stock Status */}
          <div className="space-y-6">
            {/* Top Debtors Recovery Widget */}
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900 tracking-tight">Active Receivables</h3>
                  <p className="text-xs text-slate-500">Unsettled credit balances</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onNavigate('credit_book')}
                >
                  Credit Book →
                </Button>
              </div>

              {topDebtors.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 text-center">
                  ✓ All customer balances are fully settled.
                </p>
              ) : (
                <div className="space-y-3">
                  {topDebtors.map(debtor => (
                    <div
                      key={debtor.id}
                      className="p-3 rounded-xl bg-slate-50/80 border border-slate-100 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">{debtor.name}</p>
                        <p className="text-xs text-slate-500">{debtor.phone}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-sm font-black text-rose-600 block">
                          {formatNaira(debtor.totalDebt)}
                        </span>
                        <span className="text-2xs font-semibold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded">
                          Unpaid
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Inventory Alerts Widget */}
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900 tracking-tight">Stock Warnings</h3>
                  <p className="text-xs text-slate-500">Low & depleted merchandise</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onNavigate('inventory')}
                >
                  Manage →
                </Button>
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                    <span className="text-xs font-semibold text-slate-700">Out of Stock</span>
                  </div>
                  <span className="text-xs font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                    {inventoryStats.outOfStock} items
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                    <span className="text-xs font-semibold text-slate-700">Low Stock (≤ 5 units)</span>
                  </div>
                  <span className="text-xs font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                    {inventoryStats.lowStock} items
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                    <span className="text-xs font-semibold text-slate-700">Healthy Stock</span>
                  </div>
                  <span className="text-xs font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                    {inventoryStats.totalItems - inventoryStats.outOfStock - inventoryStats.lowStock} items
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
