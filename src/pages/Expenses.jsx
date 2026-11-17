import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { sb_db } from '../config/db.js';
import { formatNaira, formatDate } from '../utils/formatters.js';
import { recordExpense, EXPENSE_CATEGORIES } from '../services/expenseService.js';
import Button from '../components/common/Button.jsx';
import Modal from '../components/common/Modal.jsx';
import StatCard from '../components/common/StatCard.jsx';
import Badge from '../components/common/Badge.jsx';
import EmptyState from '../components/common/EmptyState.jsx';

export default function Expenses() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [expenseOperationId, setExpenseOperationId] = useState(() => `op_ui_exp_${crypto.randomUUID()}`);
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [amountNaira, setAmountNaira] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash'); // 'cash' | 'bank_transfer' | 'pos'
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  // Query live expenses store
  const expenses = useLiveQuery(() => sb_db.expenses?.toArray?.() || []) || [];

  // Sort newest first
  const sortedExpenses = useMemo(() => {
    return [...expenses].sort((a, b) => new Date(b.expenseDate || b.createdAt) - new Date(a.expenseDate || a.createdAt));
  }, [expenses]);

  // Filtered by category
  const filteredExpenses = useMemo(() => {
    if (categoryFilter === 'ALL') return sortedExpenses;
    return sortedExpenses.filter(e => e.category === categoryFilter);
  }, [sortedExpenses, categoryFilter]);

  // Aggregate stats
  const stats = useMemo(() => {
    const totalKobo = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const count = expenses.length;
    const categoriesCount = new Set(expenses.map(e => e.category)).size;

    return { totalKobo, count, categoriesCount };
  }, [expenses]);

  const handleCreateExpense = async (e) => {
    e.preventDefault();
    const parsedNaira = parseFloat(amountNaira);
    if (isNaN(parsedNaira) || parsedNaira <= 0) {
      alert('Please enter a valid positive expense amount.');
      return;
    }

    setIsSubmitting(true);
    try {
      const amountKobo = Math.floor(parsedNaira * 100);
      await recordExpense({
        category,
        amountKobo,
        notes,
        paymentMethod,
        expenseDate,
        operationId: expenseOperationId
      });

      // Reset form upon verified terminal success
      setAmountNaira('');
      setNotes('');
      setIsModalOpen(false);
      setExpenseOperationId(`op_ui_exp_${crypto.randomUUID()}`);
    } catch (err) {
      alert(`Failed to log expense: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* ------------------------------------------------------------------- */}
      {/* 1. Header Banner & Actions */}
      {/* ------------------------------------------------------------------- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900 tracking-tight">Operating Expenses</h3>
          <p className="text-xs text-slate-500">Record operational overheads, bills, and vendor disbursements</p>
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={() => setIsModalOpen(true)}
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          }
        >
          Log Expense
        </Button>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 2. Key Metrics */}
      {/* ------------------------------------------------------------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Total Operating Expenses"
          value={formatNaira(stats.totalKobo)}
          subtitle={`${stats.count} recorded transactions`}
          accentColor="rose"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          }
        />

        <StatCard
          title="Categories Tracked"
          value={stats.categoriesCount}
          subtitle="Active operational categories"
          accentColor="blue"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
          }
        />

        <StatCard
          title="Accounting Treatment"
          value="Operating Overhead"
          subtitle="Non-COGS disbursement"
          accentColor="slate"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 3. Filter Bar */}
      {/* ------------------------------------------------------------------- */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center justify-between gap-3 overflow-x-auto">
        <div className="flex items-center gap-1.5 text-xs font-semibold overflow-x-auto pr-2">
          <button
            type="button"
            onClick={() => setCategoryFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              categoryFilter === 'ALL'
                ? 'bg-slate-900 text-white font-bold'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            All Categories ({expenses.length})
          </button>
          {EXPENSE_CATEGORIES.map(cat => {
            const count = expenses.filter(e => e.category === cat).length;
            if (count === 0) return null;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                  categoryFilter === cat
                    ? 'bg-slate-900 text-white font-bold'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 4. Expenses Table */}
      {/* ------------------------------------------------------------------- */}
      {filteredExpenses.length === 0 ? (
        <EmptyState
          title="No expenses logged"
          description="Log operating costs such as generator fuel, shop rent, logistics, or utilities to keep track of your business outflows."
          actionLabel="Log First Expense"
          onAction={() => setIsModalOpen(true)}
        />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-200/80 text-slate-500 font-bold text-xs uppercase tracking-wider">
                  <th className="py-3.5 px-4">Date</th>
                  <th className="py-3.5 px-4">Category</th>
                  <th className="py-3.5 px-4">Notes / Purpose</th>
                  <th className="py-3.5 px-4">Channel</th>
                  <th className="py-3.5 px-4 text-right">Amount (₦)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredExpenses.map((exp) => (
                  <tr key={exp.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3.5 px-4 text-xs text-slate-500 whitespace-nowrap font-medium">
                      {formatDate(exp.expenseDate || exp.createdAt)}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-slate-900">
                      {exp.category}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-600 max-w-xs truncate">
                      {exp.notes || '—'}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className="text-2xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                        {exp.paymentMethod || 'cash'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right font-black text-rose-600 whitespace-nowrap">
                      {formatNaira(exp.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* Modal: Log Expense */}
      {/* ------------------------------------------------------------------- */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Log Operating Expense"
        subtitle="Record shop overhead disbursements for accounting"
      >
        <form onSubmit={handleCreateExpense} className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">Expense Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full text-sm font-semibold p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              {EXPENSE_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Amount in Naira (₦)</label>
              <input
                type="number"
                step="any"
                min="0"
                required
                placeholder="e.g. 5000"
                value={amountNaira}
                onChange={(e) => setAmountNaira(e.target.value)}
                className="w-full text-sm font-bold p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Expense Date</label>
              <input
                type="date"
                required
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                className="w-full text-sm font-semibold p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">Payment Method</label>
            <div className="grid grid-cols-3 gap-2 text-2xs font-bold">
              {['cash', 'bank_transfer', 'pos'].map(method => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setPaymentMethod(method)}
                  className={`py-2 px-2 rounded-lg border text-center uppercase tracking-wider transition-colors ${
                    paymentMethod === method
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {method === 'pos' ? 'Card / POS' : method.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">Notes / Description (Optional)</label>
            <input
              type="text"
              placeholder="e.g. 20 Litres generator fuel for afternoon shift"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full text-sm p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="md" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md" isLoading={isSubmitting}>
              Record Expense
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
