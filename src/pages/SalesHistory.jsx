import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { msme_ledger_db } from '../config/db.js';

const formatNaira = (koboAmount) => {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2
  }).format(koboAmount / 100);
};

const formatDate = (dateString) => {
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(dateString));
};

export default function SalesHistory() {
  const sales = useLiveQuery(() => msme_ledger_db.sales.toArray()) || [];
  const customers = useLiveQuery(() => msme_ledger_db.customers.toArray()) || [];
  
  // Map customer IDs to names for quick O(1) lookup in the render loop
  const customerMap = customers.reduce((acc, c) => {
    acc[c.id] = c.name;
    return acc;
  }, {});

  // Sort sales chronologically (newest first)
  const sortedSales = [...sales].sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      <header className="bg-slate-900 text-slate-50 p-4 shadow-md z-10 relative">
        <h1 className="text-xl font-bold tracking-tight">Sales History</h1>
      </header>

      <main className="flex-1 p-4 max-w-6xl mx-auto w-full flex flex-col gap-4">
        {sortedSales.length === 0 ? (
          <div className="flex-1 flex items-center justify-center mt-12">
            <p className="text-slate-500 font-semibold text-lg border-2 border-dashed border-slate-300 rounded-xl p-10 text-center bg-slate-100 shadow-sm">
              No sales recorded yet. Your transaction history will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto bg-white rounded-xl shadow-sm border border-slate-200">
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-slate-700">
                  <th className="p-4 font-bold text-sm tracking-wide">Date</th>
                  <th className="p-4 font-bold text-sm tracking-wide">Customer</th>
                  <th className="p-4 font-bold text-sm tracking-wide">Total</th>
                  <th className="p-4 font-bold text-sm tracking-wide">Status</th>
                  <th className="p-4 font-bold text-sm tracking-wide">Sync</th>
                </tr>
              </thead>
              <tbody>
                {sortedSales.map((sale) => (
                  <tr key={sale.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="p-4 text-sm text-slate-600 whitespace-nowrap font-medium">
                      {formatDate(sale.date)}
                    </td>
                    <td className="p-4 font-bold text-slate-900">
                      {customerMap[sale.customerId] || 'Unknown Customer'}
                    </td>
                    <td className="p-4 font-black text-emerald-700">
                      {formatNaira(sale.totalAmount)}
                    </td>
                    <td className="p-4">
                      <span className={`inline-block px-3 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${
                        sale.paymentStatus === 'paid' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                        sale.paymentStatus === 'partial' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                        'bg-rose-100 text-rose-800 border border-rose-200'
                      }`}>
                        {sale.paymentStatus}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`inline-block px-3 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${
                        sale.sync_status === 'synced' ? 'bg-slate-100 text-slate-600 border border-slate-200' : 'bg-blue-100 text-blue-800 border border-blue-200'
                      }`}>
                        {sale.sync_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
