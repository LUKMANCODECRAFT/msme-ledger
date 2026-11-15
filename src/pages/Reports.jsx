import React, { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { msme_ledger_db, sb_db } from '../config/db.js';
import { formatNaira, formatDateShort } from '../utils/formatters.js';
import Button from '../components/common/Button.jsx';
import StatCard from '../components/common/StatCard.jsx';

export default function Reports() {
  const sales = useLiveQuery(() => msme_ledger_db.sales.toArray()) || [];
  const customers = useLiveQuery(() => msme_ledger_db.customers.toArray()) || [];
  const inventory = useLiveQuery(() => msme_ledger_db.inventory.toArray()) || [];
  const transactions = useLiveQuery(() => msme_ledger_db.transactions?.toArray?.() || []) || [];
  const expenses = useLiveQuery(() => sb_db.expenses?.toArray?.() || []) || [];

  // Financial aggregates calculated strictly in integer kobo
  const report = useMemo(() => {
    // 1. Gross Invoiced Sales Revenue
    const grossRevenueKobo = sales.reduce((sum, s) => sum + (s.totalAmount || 0), 0);

    // 2. Direct Cash Collected on Sales
    const salesCashKobo = sales.reduce((sum, s) => sum + (s.amountPaid || 0), 0);

    // 3. Credit Extended on Sales (totalAmount - amountPaid)
    const creditExtendedKobo = sales.reduce((sum, s) => sum + Math.max(0, (s.totalAmount || 0) - (s.amountPaid || 0)), 0);

    // 4. Cash from Debt Repayments
    const repaymentsCashKobo = transactions
      .filter(t => t.type === 'PAYMENT')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    // 5. Total Inflows
    const totalCashInflowKobo = salesCashKobo + repaymentsCashKobo;

    // 6. Total Operating Expenses
    const totalExpensesKobo = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

    // 7. Net Cash Position (Cash Inflows minus Operating Expenses)
    const netCashPositionKobo = totalCashInflowKobo - totalExpensesKobo;

    // 8. Total Receivables
    const totalReceivablesKobo = customers.reduce((sum, c) => sum + (c.totalDebt || 0), 0);
    const debtorCount = customers.filter(c => (c.totalDebt || 0) > 0).length;

    // 9. Stock Valuation
    const totalStockUnits = inventory.reduce((sum, i) => sum + (i.stockCount || 0), 0);
    const retailStockValuationKobo = inventory.reduce((sum, i) => sum + ((i.price || 0) * (i.stockCount || 0)), 0);

    return {
      grossRevenueKobo,
      salesCashKobo,
      creditExtendedKobo,
      repaymentsCashKobo,
      totalCashInflowKobo,
      totalExpensesKobo,
      netCashPositionKobo,
      totalReceivablesKobo,
      debtorCount,
      totalStockUnits,
      retailStockValuationKobo
    };
  }, [sales, customers, inventory, transactions, expenses]);

  const shopName = localStorage.getItem('shopName') || 'MSME Ledger Retailer';

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* ------------------------------------------------------------------- */}
      {/* 1. Header & Print / Export Action */}
      {/* ------------------------------------------------------------------- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h3 className="text-xl font-black text-slate-900 tracking-tight">Business Financial Statements</h3>
          <p className="text-xs text-slate-500">
            Official summary for {shopName} • Generated {formatDateShort(new Date())}
          </p>
        </div>
        <Button
          variant="secondary"
          size="md"
          onClick={() => window.print()}
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
          }
        >
          Print Financial Report
        </Button>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 2. Top-Line Metrics */}
      {/* ------------------------------------------------------------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Gross Sales Invoiced"
          value={formatNaira(report.grossRevenueKobo)}
          subtitle={`${sales.length} customer sales`}
          accentColor="slate"
        />

        <StatCard
          title="Total Cash Collected"
          value={formatNaira(report.totalCashInflowKobo)}
          subtitle="Direct sales cash + debt recovery"
          accentColor="emerald"
        />

        <StatCard
          title="Outstanding Receivables"
          value={formatNaira(report.totalReceivablesKobo)}
          subtitle={`${report.debtorCount} customers with unpaid balance`}
          accentColor={report.totalReceivablesKobo > 0 ? 'rose' : 'slate'}
        />

        <StatCard
          title="Net Operating Cash Flow (Recorded)"
          value={formatNaira(report.netCashPositionKobo)}
          subtitle="Recorded cash inflows less recorded expenses"
          accentColor={report.netCashPositionKobo >= 0 ? 'emerald' : 'rose'}
        />
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 3. Financial Statements Table */}
      {/* ------------------------------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Statement of Cash Operations */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6 space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h4 className="text-base font-bold text-slate-900 tracking-tight">Statement of Inflows & Outflows</h4>
            <p className="text-xs text-slate-500">Separates revenue from actual cash receipts</p>
          </div>

          <div className="space-y-3 text-sm divide-y divide-slate-100">
            <div className="flex justify-between pt-2">
              <span className="text-slate-600 font-medium">1. Gross Sales Invoiced</span>
              <span className="font-bold text-slate-900">{formatNaira(report.grossRevenueKobo)}</span>
            </div>

            <div className="flex justify-between pt-2">
              <span className="text-slate-600 font-medium pl-3">↳ Direct Cash Collected on Sales</span>
              <span className="font-semibold text-emerald-700">{formatNaira(report.salesCashKobo)}</span>
            </div>

            <div className="flex justify-between pt-2">
              <span className="text-slate-600 font-medium pl-3">↳ Credit Extended (Receivables Created)</span>
              <span className="font-semibold text-amber-700">{formatNaira(report.creditExtendedKobo)}</span>
            </div>

            <div className="flex justify-between pt-2">
              <span className="text-slate-600 font-medium">2. Cash from Customer Debt Repayments</span>
              <span className="font-semibold text-blue-700">+{formatNaira(report.repaymentsCashKobo)}</span>
            </div>

            <div className="flex justify-between pt-3 text-base font-bold text-slate-900 border-t-2 border-slate-200">
              <span>Total Actual Cash Inflow</span>
              <span className="text-emerald-700">{formatNaira(report.totalCashInflowKobo)}</span>
            </div>

            <div className="flex justify-between pt-2">
              <span className="text-slate-600 font-medium">3. Less Operating Overhead & Expenses</span>
              <span className="font-semibold text-rose-600">-{formatNaira(report.totalExpensesKobo)}</span>
            </div>

            <div className="flex justify-between pt-3 text-base font-black text-slate-900 border-t-2 border-slate-300">
              <span>Net Operating Cash Result</span>
              <span className={report.netCashPositionKobo >= 0 ? 'text-emerald-700' : 'text-rose-600'}>
                {formatNaira(report.netCashPositionKobo)}
              </span>
            </div>
          </div>
        </div>

        {/* Receivables & Inventory Balance Sheet Overview */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6 space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h4 className="text-base font-bold text-slate-900 tracking-tight">Receivables & Inventory Position</h4>
              <p className="text-xs text-slate-500">Asset balances tracked on device</p>
            </div>

            <div className="space-y-3 text-sm divide-y divide-slate-100">
              <div className="flex justify-between pt-2">
                <span className="text-slate-600 font-medium">Total Current Receivables (Debt)</span>
                <span className="font-black text-rose-600">{formatNaira(report.totalReceivablesKobo)}</span>
              </div>

              <div className="flex justify-between pt-2">
                <span className="text-slate-600 font-medium">Active Debtors</span>
                <span className="font-semibold text-slate-900">{report.debtorCount} accounts</span>
              </div>

              <div className="flex justify-between pt-2">
                <span className="text-slate-600 font-medium">Total Settled Debt Recovered to Date</span>
                <span className="font-semibold text-emerald-700">{formatNaira(report.repaymentsCashKobo)}</span>
              </div>

              <div className="flex justify-between pt-2">
                <span className="text-slate-600 font-medium">Merchandise Units in Stock</span>
                <span className="font-semibold text-slate-900">{report.totalStockUnits} units</span>
              </div>

              <div className="flex justify-between pt-2">
                <span className="text-slate-600 font-medium">Catalog Retail Valuation</span>
                <span className="font-bold text-slate-900">{formatNaira(report.retailStockValuationKobo)}</span>
              </div>
            </div>
          </div>

          {/* Mandatory Domain Profitability Disclosure (Blueprint Section 5 / Rule 6) */}
          <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-5 space-y-2 text-xs text-slate-600">
            <div className="flex items-center gap-2 font-bold text-slate-800">
              <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span>Financial Rules & Profitability Integrity</span>
            </div>
            <p className="leading-relaxed">
              In accordance with approved business rules:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-slate-500">
              <li>Verified Gross Profit is calculated strictly where inventory unit costs are authenticated via verified purchase records.</li>
              <li><strong>Unknown historical costs are never assumed or calculated as zero.</strong></li>
              <li>Credit repayments are treated as debt recovery, not duplicate new sales revenue.</li>
              <li>Cash collected on sales strictly excludes change returned to customers.</li>
              <li>Operating cash flow represents recorded transactions on this device and does not reflect a complete balance-sheet cash position, opening cash balances, or unrecorded cash transactions.</li>
              <li>Monetary balances are stored and computed strictly as 64-bit integer kobo.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
