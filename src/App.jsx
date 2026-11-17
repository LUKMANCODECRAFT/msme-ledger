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
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { SubscriptionProvider, useSubscription } from './context/SubscriptionContext.jsx';

function MainApp() {
  useBackgroundSync();

  const [isSetup, setIsSetup] = useState(() => Boolean(localStorage.getItem('shopName')));
  const [activeTab, setActiveTab] = useState('overview');
  const isExpired = isTrialExpired();
  const { currentBusinessId, currentRole } = useAuth();
  const { isReadOnly, entitlementStatus } = useSubscription();

  // Onboarding Gate: Prompt initial setup if no shopName is configured
  if (!isSetup) {
    return (
      <LandingPage
        onComplete={() => setIsSetup(true)}
        onLaunchApp={() => setIsSetup(true)}
      />
    );
  }

  // Allow reviewing the Landing Page & User Guide anytime from inside the app
  if (activeTab === 'landing') {
    return (
      <LandingPage
        onComplete={() => {
          setIsSetup(true);
          setActiveTab('overview');
        }}
        onLaunchApp={() => setActiveTab('overview')}
      />
    );
  }

  // Hard Paywall Gate: Completely lock app if trial has expired and no subscription
  if (isExpired && entitlementStatus !== 'active' && entitlementStatus !== 'in_grace_period') {
    return <ExpiredPaywall shopId={currentBusinessId || getShopId()} />;
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
      {activeTab === 'pos' && <PointOfSale isReadOnly={isReadOnly} />}
      {activeTab === 'expenses' && <Expenses isReadOnly={isReadOnly} />}
      {activeTab === 'inventory' && <Inventory isReadOnly={isReadOnly} />}
      {activeTab === 'customers' && <Customers onNavigate={setActiveTab} isReadOnly={isReadOnly} />}
      {activeTab === 'credit_book' && <CreditBook isReadOnly={isReadOnly} />}
      {activeTab === 'reports' && <Reports />}
      {activeTab === 'settings' && <Settings />}
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SubscriptionProvider>
        <MainApp />
      </SubscriptionProvider>
    </AuthProvider>
  );
}
