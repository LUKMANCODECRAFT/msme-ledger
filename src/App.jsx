import React, { useState } from 'react';
import PointOfSale from './pages/PointOfSale';
import Debtors from './pages/Debtors';
import SalesHistory from './pages/SalesHistory';
import { useBackgroundSync } from './hooks/useBackgroundSync';

function App() {
  // Initialize the background sync engine
  useBackgroundSync();

  const [activeTab, setActiveTab] = useState('pos');

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
        {activeTab === 'pos' && <PointOfSale />}
        {activeTab === 'sales' && <SalesHistory />}
        {activeTab === 'debtors' && <Debtors />}
      </div>

      {/* Global Legal Footer */}
      <footer className="bg-slate-900 text-slate-400 py-3 text-center text-xs">
        <p>
          &copy; {new Date().getFullYear()} Lukman Code Craft. 
          <a 
            href="https://notion.so/" 
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
