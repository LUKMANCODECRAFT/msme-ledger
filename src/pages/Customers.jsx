import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { msme_ledger_db } from '../config/db.js';
import { createCustomer, recordCustomerRepayment } from '../services/ledgerService.js';
import { formatNaira, formatPhoneDisplay, generateWhatsAppLink } from '../utils/formatters.js';
import Button from '../components/common/Button.jsx';
import Modal from '../components/common/Modal.jsx';
import StatCard from '../components/common/StatCard.jsx';
import EmptyState from '../components/common/EmptyState.jsx';

export default function Customers({ onNavigate }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debtFilter, setDebtFilter] = useState('ALL'); // 'ALL' | 'DEBTORS' | 'CLEAN'

  // Modal: Add Customer
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modal: Record Repayment
  const [selectedDebtor, setSelectedDebtor] = useState(null);
  const [repaymentAmountNaira, setRepaymentAmountNaira] = useState('');

  // Live queries
  const customers = useLiveQuery(() => msme_ledger_db.customers.toArray()) || [];
  const sales = useLiveQuery(() => msme_ledger_db.sales.toArray()) || [];

  // Metrics
  const stats = useMemo(() => {
    const totalCustomers = customers.length;
    const debtors = customers.filter(c => (c.totalDebt || 0) > 0);
    const debtorCount = debtors.length;
    const totalDebtKobo = debtors.reduce((sum, c) => sum + (c.totalDebt || 0), 0);

    return { totalCustomers, debtorCount, totalDebtKobo };
  }, [customers]);

  // Filtered customer list
  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      if (debtFilter === 'DEBTORS' && (c.totalDebt || 0) <= 0) return false;
      if (debtFilter === 'CLEAN' && (c.totalDebt || 0) > 0) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = (c.name || '').toLowerCase().includes(q);
        const matchesPhone = (c.phone || '').includes(q);
        if (!matchesName && !matchesPhone) return false;
      }
      return true;
    });
  }, [customers, debtFilter, searchQuery]);

  // Handle Add Customer
  const handleAddCustomerSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;

    setIsSubmitting(true);
    try {
      await createCustomer({
        name: name.trim(),
        phone: phone.trim()
      });
      setName('');
      setPhone('');
      setIsAddModalOpen(false);
    } catch (err) {
      alert(`Failed to create customer: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Record Repayment (Preserving financial distinction: Repayments are NOT new sales!)
  const handleRecordRepaymentSubmit = async (e) => {
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
      alert(`Repayment cannot exceed the current outstanding debt of ${formatNaira(currentDebtKobo)}.`);
      return;
    }

    try {
      await recordCustomerRepayment({
        customerId: selectedDebtor.id,
        amountKobo: paymentKobo,
        paymentMethod: 'cash',
        notes: 'Customer debt repayment from Customer Directory'
      });

      setSelectedDebtor(null);
      setRepaymentAmountNaira('');
    } catch (err) {
      alert(`Failed to record repayment: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* ------------------------------------------------------------------- */}
      {/* 1. Header & Actions */}
      {/* ------------------------------------------------------------------- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900 tracking-tight">Customer Directory</h3>
          <p className="text-xs text-slate-500">Manage client contacts, balances, and WhatsApp communication</p>
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={() => setIsAddModalOpen(true)}
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          }
        >
          Add Customer
        </Button>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 2. Key Metrics */}
      {/* ------------------------------------------------------------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Total Customers"
          value={stats.totalCustomers}
          subtitle="Registered customer profiles"
          accentColor="slate"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          }
        />

        <StatCard
          title="Active Debtors"
          value={stats.debtorCount}
          subtitle="Customers with unpaid balance"
          accentColor={stats.debtorCount > 0 ? 'amber' : 'emerald'}
          badge={stats.debtorCount > 0 ? 'Follow Up' : 'No Debtors'}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
        />

        <StatCard
          title="Total Receivables Held"
          value={formatNaira(stats.totalDebtKobo)}
          subtitle="Outstanding credit in the field"
          accentColor={stats.totalDebtKobo > 0 ? 'rose' : 'emerald'}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          }
        />
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 3. Filter & Search Controls */}
      {/* ------------------------------------------------------------------- */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl text-xs font-bold">
          <button
            type="button"
            onClick={() => setDebtFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              debtFilter === 'ALL' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Customers ({customers.length})
          </button>
          <button
            type="button"
            onClick={() => setDebtFilter('DEBTORS')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              debtFilter === 'DEBTORS' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Debtors Only ({stats.debtorCount})
          </button>
          <button
            type="button"
            onClick={() => setDebtFilter('CLEAN')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              debtFilter === 'CLEAN' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Clean Balance ({customers.length - stats.debtorCount})
          </button>
        </div>

        <div className="relative min-w-[260px]">
          <input
            type="text"
            placeholder="Search customers by name or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-xs font-medium pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
          />
          <svg className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 4. Customer Directory Table */}
      {/* ------------------------------------------------------------------- */}
      {filteredCustomers.length === 0 ? (
        <EmptyState
          title="No customers found"
          description={searchQuery ? 'No customer records match your search filter.' : 'Register customer profiles to manage sales, track debts, and send automated WhatsApp reminders.'}
          actionLabel={searchQuery ? 'Clear Search' : 'Add First Customer'}
          onAction={() => {
            if (searchQuery) setSearchQuery('');
            else setIsAddModalOpen(true);
          }}
        />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-200/80 text-slate-500 font-bold text-xs uppercase tracking-wider">
                  <th className="py-3.5 px-4">Customer Name</th>
                  <th className="py-3.5 px-4">Phone / WhatsApp</th>
                  <th className="py-3.5 px-4 text-right">Outstanding Debt</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCustomers.map((c) => {
                  const hasDebt = (c.totalDebt || 0) > 0;
                  return (
                    <tr key={c.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-900">
                        {c.name}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-600 font-medium">
                        {formatPhoneDisplay(c.phone)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-black whitespace-nowrap">
                        <span className={hasDebt ? 'text-rose-600' : 'text-slate-400'}>
                          {formatNaira(c.totalDebt)}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span className={`inline-block px-2.5 py-0.5 rounded-md text-xs font-bold uppercase tracking-wider border ${
                          hasDebt ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}>
                          {hasDebt ? 'Has Debt' : 'Clear'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right space-x-2 whitespace-nowrap">
                        {hasDebt ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedDebtor(c);
                                setRepaymentAmountNaira('');
                              }}
                              className="text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline px-2 py-1"
                            >
                              Repay
                            </button>
                            <a
                              href={generateWhatsAppLink(c)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-block text-xs font-bold text-emerald-600 hover:text-emerald-700 hover:underline px-2 py-1"
                            >
                              WhatsApp
                            </a>
                          </>
                        ) : (
                          <span className="text-2xs text-slate-400 px-2 py-1">No Action</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* Modal: Add Customer */}
      {/* ------------------------------------------------------------------- */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Add Customer Profile"
        subtitle="Save customer contact details for sales and debt tracking"
      >
        <form onSubmit={handleAddCustomerSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">Customer Full Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Chief Emeka Obi"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-sm p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">Phone Number (WhatsApp)</label>
            <input
              type="tel"
              required
              placeholder="e.g. 08023456789"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full text-sm p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
            />
            <p className="text-2xs text-slate-400 mt-1">Used for one-click WhatsApp debt collection reminders.</p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="md" onClick={() => setIsAddModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md" isLoading={isSubmitting}>
              Save Customer
            </Button>
          </div>
        </form>
      </Modal>

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
          <form onSubmit={handleRecordRepaymentSubmit} className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-bold text-slate-700">Amount Received (₦)</label>
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

            <p className="text-2xs text-slate-400">
              Important: Debt repayments reduce customer receivables and are recorded as financial repayments, not as new sales revenue.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="md" onClick={() => setSelectedDebtor(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="md">
                Confirm Repayment
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
