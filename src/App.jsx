import React, { useState } from 'react';
import AppShell from './components/common/AppShell.jsx';
import Overview from './pages/Overview.jsx';
import BusinessBook from './pages/BusinessBook.jsx';
import PointOfSale from './pages/PointOfSale.jsx';
import Expenses from './pages/Expenses.jsx';
import Inventory from './pages/Inventory.jsx';
import Customers from './pages/Customers.jsx';
import CreditBook from './pages/CreditBook.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';

import { useBackgroundSync } from './hooks/useBackgroundSync.js';
import { isTrialExpired, getShopId } from './utils/shopIdentity.js';
import ExpiredPaywall from './components/ExpiredPaywall.jsx';
import LandingPage from './components/LandingPage.jsx';
import Button from './components/common/Button.jsx';

export default function App() {
  // Initialize the offline background sync engine
  useBackgroundSync();

  const [isSetup, setIsSetup] = useState(() => Boolean(localStorage.getItem('shopName')));
  const [activeTab, setActiveTab] = useState('overview');
  const isExpired = isTrialExpired();

  // Onboarding Gate: Prompt initial setup if no shopName is configured
  if (!isSetup) {
    return <LandingPage onComplete={() => setIsSetup(true)} />;
  }

  // Hard Paywall Gate: Completely lock app if trial has expired
  if (isExpired) {
    return <ExpiredPaywall shopId={getShopId()} />;
  }

  // Header quick action button depending on active module
  let headerAction = null;
  if (activeTab === 'overview') {
    headerAction = (
      <Button
        variant="primary"
        size="sm"
        onClick={() => setActiveTab('pos')}
        icon={
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        }
      >
        New Sale (POS)
      </Button>
    );
  } else if (activeTab === 'pos') {
    headerAction = (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setActiveTab('business_book')}
      >
        View Activity Ledger
      </Button>
    );
  } else if (activeTab === 'business_book') {
    headerAction = (
      <Button
        variant="primary"
        size="sm"
        onClick={() => setActiveTab('pos')}
      >
        + Ring Up Sale
      </Button>
    );
  }

  return (
    <AppShell
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      headerActions={headerAction}
    >
      {activeTab === 'overview' && <Overview onNavigate={setActiveTab} />}
      {activeTab === 'business_book' && <BusinessBook onNavigate={setActiveTab} />}
      {activeTab === 'pos' && <PointOfSale />}
      {activeTab === 'expenses' && <Expenses />}
      {activeTab === 'inventory' && <Inventory />}
      {activeTab === 'customers' && <Customers onNavigate={setActiveTab} />}
      {activeTab === 'credit_book' && <CreditBook />}
      {activeTab === 'reports' && <Reports />}
      {activeTab === 'settings' && <Settings />}
    </AppShell>
  );
}
