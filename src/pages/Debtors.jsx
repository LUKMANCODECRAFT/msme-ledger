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

const formatNigerianPhone = (phone) => {
  // Strip all non-numeric characters to sanitize the input
  let cleanPhone = phone.replace(/\D/g, '');
  
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '234' + cleanPhone.substring(1);
  } else if (!cleanPhone.startsWith('234')) {
    cleanPhone = '234' + cleanPhone;
  }
  
  return cleanPhone;
};

const generateWhatsAppLink = (customer) => {
  const formattedPhone = formatNigerianPhone(customer.phone);
  const formattedDebt = formatNaira(customer.totalDebt);
  
  const rawText = `Hello ${customer.name}, this is a polite reminder regarding your outstanding balance of ${formattedDebt}. Please let us know when you can settle this. Thank you for your business.`;
  const encodedText = encodeURIComponent(rawText);
  
  return `https://wa.me/${formattedPhone}?text=${encodedText}`;
};

export default function Debtors() {
  const allCustomers = useLiveQuery(() => msme_ledger_db.customers.toArray()) || [];
  
  // In-memory filter and sort to avoid a Dexie schema version upgrade
  const debtors = allCustomers
    .filter(customer => customer.totalDebt > 0)
    .sort((a, b) => b.totalDebt - a.totalDebt);

  const handleClearDebt = async (customerId) => {
    if (window.confirm("Has this customer fully paid their debt?")) {
      await msme_ledger_db.customers.update(customerId, { totalDebt: 0 });
    }
  };

  const handleRecordPayment = async (customerId, currentDebtKobo) => {
    const currentDebtNaira = currentDebtKobo / 100;
    const paymentInput = prompt(`Current Debt: ₦${currentDebtNaira.toFixed(2)}\n\nEnter amount paid now (₦):`);
    
    if (paymentInput === null) return;
    
    const paymentAmountNaira = parseFloat(paymentInput);
    if (isNaN(paymentAmountNaira) || paymentAmountNaira <= 0) return;

    const paymentAmountKobo = Math.round(paymentAmountNaira * 100);

    if (paymentAmountKobo > currentDebtKobo) {
      alert("Payment cannot be greater than the total debt!");
      return;
    }

    const newBalanceKobo = currentDebtKobo - paymentAmountKobo;

    await msme_ledger_db.customers.update(customerId, { totalDebt: newBalanceKobo });

    await msme_ledger_db.transactions.add({
      id: crypto.randomUUID(),
      customerId,
      type: 'PAYMENT',
      amount: paymentAmountKobo,
      date: new Date().toISOString(),
      sync_status: 'pending'
    });
  };

  const getStatusBadge = (balance) => {
    if (balance <= 0) {
      return <span className="bg-emerald-100 text-emerald-800 px-2 py-1 rounded text-xs font-bold">Paid</span>;
    } else {
      return <span className="bg-amber-100 text-amber-800 px-2 py-1 rounded text-xs font-bold">Outstanding</span>;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      <header className="bg-slate-900 text-slate-50 p-4 shadow-md z-10 relative">
        <h1 className="text-xl font-bold tracking-tight">Outstanding Balances</h1>
      </header>

      <main className="flex-1 p-4 max-w-4xl mx-auto w-full flex flex-col gap-4">
        {debtors.length === 0 ? (
          <div className="flex-1 flex items-center justify-center mt-12">
            <p className="text-slate-500 font-semibold text-lg border-2 border-dashed border-slate-300 rounded-xl p-10 text-center bg-slate-100 shadow-sm">
              No outstanding debts. Your books are clear.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {debtors.map(debtor => (
              <div 
                key={debtor.id} 
                className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center md:justify-between gap-5 transition-all hover:shadow-md hover:border-slate-300"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold text-slate-800 tracking-tight">{debtor.name}</h2>
                    {getStatusBadge(debtor.totalDebt)}
                  </div>
                  <span className="text-sm font-medium text-slate-500">{debtor.phone}</span>
                </div>
                
                <div className="flex flex-col md:items-end gap-3 mt-2 md:mt-0 pt-3 md:pt-0 border-t md:border-none border-slate-100">
                  <span className="text-2xl font-black text-slate-900">
                    {formatNaira(debtor.totalDebt)}
                  </span>
                  <div className="flex gap-2 w-full md:w-auto mt-2 flex-wrap md:flex-nowrap">
                    <button 
                      onClick={() => handleRecordPayment(debtor.id, debtor.totalDebt)}
                      className="flex-1 md:flex-none bg-blue-600 text-white px-3 py-2 text-sm rounded font-medium hover:bg-blue-700 transition-colors shadow-sm"
                    >
                      Record Payment
                    </button>
                    <button 
                      onClick={() => handleClearDebt(debtor.id)}
                      className="flex-1 md:flex-none bg-emerald-600 text-white px-3 py-2 text-sm rounded font-medium hover:bg-emerald-700 transition-colors shadow-sm"
                    >
                      Clear Debt
                    </button>
                    <a 
                      href={generateWhatsAppLink(debtor)}
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex-1 md:flex-none inline-block text-center py-2 px-3 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-900 transition-colors shadow-sm"
                    >
                      WhatsApp
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
