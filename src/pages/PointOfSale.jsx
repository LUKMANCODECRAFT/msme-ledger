import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { msme_ledger_db, usePendingSyncCount } from '../config/db.js';
import { recordSale, createCustomer, addInventory } from '../services/ledgerService.js';
import { pushPendingData } from '../services/syncService.js';

const formatNaira = (koboAmount) => {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2
  }).format(koboAmount / 100);
};

export default function PointOfSale() {
  const pendingCount = usePendingSyncCount();

  const customers = useLiveQuery(() => msme_ledger_db.customers.toArray()) || [];
  const inventory = useLiveQuery(() => msme_ledger_db.inventory.toArray()) || [];

  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [cart, setCart] = useState({}); // Shape: { [inventoryId]: { item, quantity } }
  const [amountPaidInput, setAmountPaidInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSeedData = async () => {
    try {
      await createCustomer({ name: 'John Doe', phone: '09132555203' });
      await createCustomer({ name: 'Jane Smith', phone: '09132555203' });

      // Note: Prices are in Kobo
      await addInventory({ itemName: 'Organic Fertilizer', price: 500000, stockCount: 50 });
      await addInventory({ itemName: 'Premium Seeds', price: 250000, stockCount: 100 });
      await addInventory({ itemName: 'Tractor Rental', price: 1500000, stockCount: 5 });

      alert('Seed data added successfully!');
    } catch (e) {
      alert('Error seeding data: ' + e.message);
    }
  };

  const cartItems = Object.values(cart);

  const totalAmountKobo = useMemo(() => {
    return cartItems.reduce((total, cartItem) => {
      return total + (cartItem.item.price * cartItem.quantity);
    }, 0);
  }, [cartItems]);

  const handleAddToCart = (item) => {
    setCart((prev) => {
      const existing = prev[item.id];
      const newQuantity = existing ? existing.quantity + 1 : 1;

      if (newQuantity > item.stockCount) {
        alert("Cannot add more than available stock.");
        return prev;
      }

      return {
        ...prev,
        [item.id]: {
          item,
          quantity: newQuantity
        }
      };
    });
  };

  const handleUpdateQuantity = (inventoryId, newQuantity) => {
    if (newQuantity <= 0) {
      setCart((prev) => {
        const updated = { ...prev };
        delete updated[inventoryId];
        return updated;
      });
      return;
    }

    const item = inventory.find(i => i.id === inventoryId);
    if (item && newQuantity > item.stockCount) {
      alert("Cannot exceed available stock.");
      return;
    }

    setCart((prev) => ({
      ...prev,
      [inventoryId]: {
        ...prev[inventoryId],
        quantity: newQuantity
      }
    }));
  };

  const handleCheckout = async (e) => {
    e.preventDefault();
    if (!selectedCustomerId) {
      alert("Please select a customer.");
      return;
    }
    if (cartItems.length === 0) {
      alert("Cart is empty.");
      return;
    }

    const parsedAmountNaira = parseFloat(amountPaidInput);
    if (isNaN(parsedAmountNaira) || parsedAmountNaira < 0) {
      alert("Please enter a valid amount paid in Naira.");
      return;
    }

    setIsSubmitting(true);

    try {
      const itemsPayload = cartItems.map(cartItem => ({
        inventoryId: cartItem.item.id,
        quantity: cartItem.quantity,
        price: cartItem.item.price // Native Kobo price fetched directly from db
      }));

      // Conversion: Naira input * 100 = Kobo
      const amountPaidKobo = Math.floor(parsedAmountNaira * 100);

      await recordSale({
        customerId: selectedCustomerId,
        items: itemsPayload,
        amountPaid: amountPaidKobo
      });

      // Clear the local state on success
      setCart({});
      setAmountPaidInput('');
      setSelectedCustomerId('');
      alert("Sale recorded successfully.");
    } catch (error) {
      // Alert any shortages or transactional failures bubbled up from ledgerService
      alert(error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* 2. The Offline-Aware Header */}
      <header className="bg-slate-900 text-slate-50 p-4 flex items-center justify-between shadow-md z-10 relative">
        <h1 className="text-xl font-bold tracking-tight">MSME Ledger</h1>
        <div className="flex items-center gap-3">
          {(customers.length === 0 && inventory.length === 0) && (
            <button
              onClick={handleSeedData}
              className="text-xs font-bold px-3 py-1 bg-emerald-600 hover:bg-emerald-700 rounded transition-colors"
            >
              Seed Data
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (pendingCount > 0) {
                pushPendingData().then(() => alert('Manual sync process initiated! Check the backend terminal.'));
              }
            }}
            className={`text-sm font-medium px-3 py-1 rounded-full border transition-all ${pendingCount > 0
                ? 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200 cursor-pointer shadow-sm active:scale-95'
                : 'bg-emerald-800 text-emerald-100 border-emerald-700 cursor-default'
              }`}
            title={pendingCount > 0 ? "Click to force a manual sync to MongoDB" : "All data is securely backed up"}
          >
            {pendingCount > 0 ? `Sync Queue: ${pendingCount} (Force Sync)` : "✓ Synced"}
          </button>
        </div>
      </header>

      {/* 3. The Fast-Entry Layout */}
      <main className="flex-1 p-4 flex flex-col md:flex-row gap-6 max-w-7xl mx-auto w-full">

        {/* Left Column: Selection Areas */}
        <div className="flex-1 flex flex-col gap-6">
          {/* Section A: Customer Selection */}
          <section className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
            <label htmlFor="customerSelect" className="block text-sm font-semibold text-slate-700 mb-2">
              Select Customer
            </label>
            <select
              id="customerSelect"
              className="w-full p-3 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 transition-colors"
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
            >
              <option value="" disabled>-- Choose a Customer --</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name} ({customer.phone})
                </option>
              ))}
            </select>
          </section>

          {/* Section B: Inventory Tap-Grid */}
          <section className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex-1 flex flex-col">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Inventory</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 overflow-y-auto">
              {inventory.map((item) => {
                const stockRemaining = item.stockCount - (cart[item.id]?.quantity || 0);
                const isOutOfStock = stockRemaining <= 0;

                return (
                  <button
                    key={item.id}
                    onClick={() => handleAddToCart(item)}
                    disabled={isOutOfStock}
                    className={`flex flex-col p-4 rounded-lg border text-left transition-all ${isOutOfStock
                        ? 'bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed'
                        : 'bg-white border-slate-300 hover:border-emerald-600 hover:shadow-md active:bg-emerald-50'
                      }`}
                  >
                    <span className="font-semibold text-slate-900 truncate w-full">{item.itemName}</span>
                    <span className="text-emerald-700 font-bold mt-1">{formatNaira(item.price)}</span>
                    <span className="text-xs text-slate-500 mt-3 font-medium">Stock: {stockRemaining}</span>
                  </button>
                );
              })}
              {inventory.length === 0 && (
                <div className="col-span-full p-6 text-center text-slate-500 border-2 border-dashed border-slate-300 rounded-lg">
                  No inventory items available.
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Right Column: Cart & Checkout (Section C) */}
        <aside className="w-full md:w-96 bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex flex-col h-auto md:max-h-[calc(100vh-8rem)]">
          <h2 className="text-lg font-semibold text-slate-800 mb-4 border-b border-slate-200 pb-2">Cart & Checkout</h2>

          <div className="flex-1 overflow-y-auto min-h-[200px] mb-4 pr-1">
            {cartItems.length === 0 ? (
              <p className="text-slate-500 text-sm text-center mt-8 font-medium">Cart is empty.</p>
            ) : (
              <ul className="space-y-3">
                {cartItems.map((cartItem) => (
                  <li key={cartItem.item.id} className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <div className="flex flex-col overflow-hidden w-full pr-2">
                      <span className="font-semibold text-slate-900 truncate">{cartItem.item.itemName}</span>
                      <span className="text-xs text-slate-500 font-medium">{formatNaira(cartItem.item.price)} each</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleUpdateQuantity(cartItem.item.id, cartItem.quantity - 1)}
                        className="w-8 h-8 flex items-center justify-center bg-white border border-slate-300 rounded-md hover:bg-slate-100 text-slate-600 font-bold active:bg-slate-200 transition-colors"
                      >
                        -
                      </button>
                      <span className="w-6 text-center text-sm font-bold text-slate-900">{cartItem.quantity}</span>
                      <button
                        type="button"
                        onClick={() => handleUpdateQuantity(cartItem.item.id, cartItem.quantity + 1)}
                        className="w-8 h-8 flex items-center justify-center bg-white border border-slate-300 rounded-md hover:bg-slate-100 text-slate-600 font-bold active:bg-slate-200 transition-colors"
                      >
                        +
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form onSubmit={handleCheckout} className="border-t border-slate-200 pt-5 flex flex-col gap-5 mt-auto">
            <div className="flex justify-between items-center bg-slate-50 p-4 rounded-lg border border-slate-200">
              <span className="text-slate-600 font-bold">Total Amount:</span>
              <span className="text-xl font-black text-emerald-700">{formatNaira(totalAmountKobo)}</span>
            </div>

            <div className="flex flex-col">
              <label htmlFor="amountPaid" className="text-sm font-bold text-slate-700 mb-2">
                Amount Paid (NGN)
              </label>
              <input
                id="amountPaid"
                type="number"
                step="0.01"
                min="0"
                required
                className="w-full p-4 bg-slate-50 border border-slate-300 rounded-lg text-lg font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 transition-colors"
                placeholder="0.00"
                value={amountPaidInput}
                onChange={(e) => setAmountPaidInput(e.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting || cartItems.length === 0}
              className="w-full py-4 px-6 bg-emerald-600 text-white text-lg font-black rounded-lg hover:bg-emerald-700 active:bg-emerald-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg active:shadow-sm"
            >
              {isSubmitting ? 'Processing...' : 'Record Sale'}
            </button>
          </form>

        </aside>
      </main>
    </div>
  );
}
