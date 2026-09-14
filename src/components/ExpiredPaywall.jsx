import React from 'react';

export default function ExpiredPaywall({ shopId }) {
  const message = `Hello LCC Admin! I just transferred 1,500 NGN. My Shop ID is: ${shopId}`;
  const whatsappUrl = `https://wa.me/2349132555203?text=${encodeURIComponent(message)}`;

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 font-sans text-slate-50">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-center">
        <div className="bg-red-600 py-6 px-4">
          <h1 className="text-2xl font-black tracking-wider uppercase text-white">Trial Expired</h1>
          <p className="text-red-100 mt-2 font-medium">Your 30-day offline trial has concluded.</p>
        </div>
        
        <div className="p-8 space-y-6">
          <p className="text-slate-300 text-sm leading-relaxed">
            To unlock the MSME Ledger and resume cloud synchronization, please complete your payment. Your data remains perfectly safe on this device.
          </p>

          <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 text-left">
            <h3 className="text-xs uppercase tracking-widest text-slate-400 font-bold mb-4">Payment Details</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Bank:</span>
                <span className="font-bold text-slate-100">OPAY</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Account No:</span>
                <span className="font-bold text-slate-100 tracking-wider">9132555203</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Name:</span>
                <span className="font-bold text-slate-100">Lukman yerima ismail</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-700">
                <span className="text-slate-400">Amount:</span>
                <span className="font-bold text-emerald-400 text-base">1,500 NGN</span>
              </div>
            </div>
          </div>

          <a 
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full py-4 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition-colors shadow-lg uppercase tracking-wide text-sm"
          >
            I Have Paid (Send Receipt)
          </a>
        </div>
      </div>
    </div>
  );
}
