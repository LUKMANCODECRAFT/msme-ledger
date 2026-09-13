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
                  <h2 className="text-xl font-bold text-slate-800 tracking-tight">{debtor.name}</h2>
                  <span className="text-sm font-medium text-slate-500">{debtor.phone}</span>
                </div>
                
                <div className="flex flex-col md:items-end gap-3 mt-2 md:mt-0 pt-3 md:pt-0 border-t md:border-none border-slate-100">
                  <span className="text-2xl font-black text-slate-900">
                    {formatNaira(debtor.totalDebt)}
                  </span>
                  <a 
                    href={generateWhatsAppLink(debtor)}
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="inline-block text-center py-3 px-5 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 active:bg-emerald-800 transition-colors shadow-sm"
                  >
                    Send WhatsApp Reminder
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
