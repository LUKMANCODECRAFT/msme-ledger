import React, { useState } from 'react';
import Onboarding from './Onboarding';

export default function LandingPage({ onComplete }) {
  const [showOnboarding, setShowOnboarding] = useState(false);

  if (showOnboarding) {
    return <Onboarding onComplete={onComplete} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 font-sans text-center">
      <div className="max-w-xl w-full flex flex-col items-center">
        <h1 className="text-4xl md:text-6xl font-black text-slate-900 mb-4 tracking-tight">
          Kill the Debt Notebook.
        </h1>
        <p className="text-lg md:text-xl text-slate-600 mb-10 font-medium px-4">
          The offline-first ledger that automatically tracks your sales and recovers your money.
        </p>

        <div className="w-full flex flex-col gap-4 mb-10 text-left">
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:border-emerald-500 transition-colors">
            <h3 className="font-bold text-emerald-700 text-lg mb-1">100% Offline</h3>
            <p className="text-slate-600 font-medium">Record sales instantly, even with zero network.</p>
          </div>
          
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:border-emerald-500 transition-colors">
            <h3 className="font-bold text-emerald-700 text-lg mb-1">WhatsApp Reminders</h3>
            <p className="text-slate-600 font-medium">Collect debts with one-click automated messages.</p>
          </div>
          
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:border-emerald-500 transition-colors">
            <h3 className="font-bold text-emerald-700 text-lg mb-1">Cloud Secured</h3>
            <p className="text-slate-600 font-medium">Your data syncs safely to the cloud when the network returns.</p>
          </div>
        </div>

        <button
          onClick={() => setShowOnboarding(true)}
          className="w-full py-5 px-8 bg-emerald-600 text-white text-xl font-black rounded-xl hover:bg-emerald-700 active:bg-emerald-800 transition-transform transform active:scale-95 shadow-xl hover:shadow-2xl"
        >
          Start Free 30-Day Trial
        </button>
      </div>
    </div>
  );
}
