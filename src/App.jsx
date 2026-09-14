import React, { useState } from 'react';
import PointOfSale from './pages/PointOfSale';
import Debtors from './pages/Debtors';
import SalesHistory from './pages/SalesHistory';
import { useBackgroundSync } from './hooks/useBackgroundSync';
import { isTrialExpired, getShopId } from './utils/shopIdentity.js';
import ExpiredPaywall from './components/ExpiredPaywall';
import Onboarding from './components/Onboarding';

function App() {
  // Initialize the background sync engine
  useBackgroundSync();

  const [isSetup, setIsSetup] = useState(!!localStorage.getItem('shopName'));
  const [activeTab, setActiveTab] = useState('pos');
  const isExpired = isTrialExpired();

  // Onboarding Gate
  if (!isSetup) {
    return <Onboarding onComplete={() => setIsSetup(true)} />;
  }

  // Hard Component Swap: completely lock the app if expired
  if (isExpired) {
    return <ExpiredPaywall shopId={getShopId()} />;
  }

  return (
    <div className="flex flex-col min-h-screen bg-slate-100">

      {/* Global Navigation */}
      <nav className="bg-slate-950 p-3 flex gap-3 justify-center shadow-lg z-20 relative">
        <button 
          onClick={() => setActiveTab('pos')}
          className={`px-5 py-2 text-sm font-bold rounded-md transition-colors ${activeTab === 'pos' ? 'bg-emerald-600 text-white shadow-inner' : 'text-slate-300 hover:text-white hover:bg-slate-800'}`}
        >
          POS Dashboard
        </button>
        <button 
          onClick={() => setActiveTab('sales')}
          className={`px-5 py-2 text-sm font-bold rounded-md transition-colors ${activeTab === 'sales' ? 'bg-emerald-600 text-white shadow-inner' : 'text-slate-300 hover:text-white hover:bg-slate-800'}`}
        >
          Sales Ledger
        </button>
        <button 
          onClick={() => setActiveTab('debtors')}
          className={`px-5 py-2 text-sm font-bold rounded-md transition-colors ${activeTab === 'debtors' ? 'bg-emerald-600 text-white shadow-inner' : 'text-slate-300 hover:text-white hover:bg-slate-800'}`}
        >
          Debtors
        </button>
      </nav>

      {/* Main Content Area */}
      <div className="flex-1 w-full">
        {activeTab === 'pos' && <PointOfSale isExpired={isExpired} />}
        {activeTab === 'sales' && <SalesHistory isExpired={isExpired} />}
        {activeTab === 'debtors' && <Debtors isExpired={isExpired} />}
      </div>

      {/* Global Legal Footer */}
      <footer className="bg-slate-900 text-slate-400 py-3 text-center text-xs">
        <p>
          &copy; {new Date().getFullYear()} Lukman Code Craft. 
          <a 
            href="https://docs.google.com/document/d/11sDF_EK3LC1Q2KgApzt9qXu7oNCa5bG_Y2TfqkxR2Hw/edit?usp=sharing" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="ml-2 underline hover:text-white transition-colors"
          >
            Terms & Privacy
          </a>
        </p>
      </footer>
    </div>
  );
}

export default App;
