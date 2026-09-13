import React from 'react';
import PointOfSale from './pages/PointOfSale';
import Debtors from './pages/Debtors';
import { useBackgroundSync } from './hooks/useBackgroundSync';

function App() {
  // Initialize the background sync engine
  useBackgroundSync();

  return (
    <div>
      <PointOfSale />
      {/* <Debtors /> */}
    </div>
  );
}

export default App;
