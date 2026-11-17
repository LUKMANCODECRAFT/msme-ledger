import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { msme_ledger_db } from '../config/db.js';
import { recordSale, createCustomer, addInventory } from '../services/ledgerService.js';
import { formatNaira } from '../utils/formatters.js';
import Button from '../components/common/Button.jsx';
import Modal from '../components/common/Modal.jsx';
import Badge from '../components/common/Badge.jsx';

export default function PointOfSale() {
  const customers = useLiveQuery(() => msme_ledger_db.customers.toArray()) || [];
  const inventory = useLiveQuery(() => msme_ledger_db.inventory.toArray()) || [];

  // Register State
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [cart, setCart] = useState({}); // Shape: { [inventoryId]: { item, quantity } }
  const [amountPaidNaira, setAmountPaidNaira] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash'); // 'cash' | 'bank_transfer' | 'pos'
  const [allowCredit, setAllowCredit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  // Modals
  const [isAddCustomerOpen, setIsAddCustomerOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');

  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductPriceNaira, setNewProductPriceNaira] = useState('');
  const [newProductStock, setNewProductStock] = useState('');

  // Receipt Modal State
  const [receiptData, setReceiptData] = useState(null);

  // Filtered Inventory list
  const filteredInventory = useMemo(() => {
    if (!productSearch.trim()) return inventory;
    const q = productSearch.toLowerCase();
    return inventory.filter(i => (i.itemName || '').toLowerCase().includes(q));
  }, [inventory, productSearch]);

  // Filtered Customers list
  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return customers;
    const q = customerSearch.toLowerCase();
    return customers.filter(c => (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q));
  }, [customers, customerSearch]);

  const cartItems = useMemo(() => Object.values(cart), [cart]);

  // Cart total in integer kobo
  const totalAmountKobo = useMemo(() => {
    return cartItems.reduce((total, cartItem) => {
      return total + (cartItem.item.price * cartItem.quantity);
    }, 0);
  }, [cartItems]);

  const totalAmountNaira = totalAmountKobo / 100;

  // Add item to cart
  const handleAddToCart = (item) => {
    if ((item.stockCount || 0) <= 0) {
      alert(`"${item.itemName}" is out of stock.`);
      return;
    }

    setCart((prev) => {
      const existing = prev[item.id];
      const newQuantity = existing ? existing.quantity + 1 : 1;

      if (newQuantity > item.stockCount) {
        alert(`Cannot add more than available stock (${item.stockCount} units available).`);
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

  // Adjust item quantity in cart
  const handleUpdateQuantity = (inventoryId, newQuantity) => {
    if (newQuantity <= 0) {
      setCart((prev) => {
        const copy = { ...prev };
        delete copy[inventoryId];
        return copy;
      });
      return;
    }

    const item = inventory.find(i => i.id === inventoryId);
    if (item && newQuantity > item.stockCount) {
      alert(`Cannot exceed available stock of ${item.stockCount} units.`);
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

  // Quick helper: Set exact payment amount
  const handleSetExactPayment = () => {
    setAmountPaidNaira(totalAmountNaira.toString());
  };

  // Create new customer
  const handleCreateCustomerSubmit = async (e) => {
    e.preventDefault();
    if (!newCustomerName.trim() || !newCustomerPhone.trim()) return;
    try {
      const newId = await createCustomer({
        name: newCustomerName.trim(),
        phone: newCustomerPhone.trim()
      });
      setSelectedCustomerId(newId);
      setNewCustomerName('');
      setNewCustomerPhone('');
      setIsAddCustomerOpen(false);
    } catch (err) {
      alert(err.message);
    }
  };

  // Create new inventory product
  const handleCreateProductSubmit = async (e) => {
    e.preventDefault();
    if (!newProductName.trim() || !newProductPriceNaira || !newProductStock) return;
    try {
      const parsedPriceNaira = parseFloat(newProductPriceNaira);
      const parsedStock = parseFloat(newProductStock);
      if (isNaN(parsedPriceNaira) || parsedPriceNaira <= 0 || isNaN(parsedStock) || parsedStock < 0) {
        alert('Please enter valid positive numbers for price and stock count.');
        return;
      }

      const priceKobo = Math.floor(parsedPriceNaira * 100);
      await addInventory({
        itemName: newProductName.trim(),
        price: priceKobo,
        stockCount: newProductStock.trim()
      });

      setNewProductName('');
      setNewProductPriceNaira('');
      setNewProductStock('');
      setIsAddProductOpen(false);
    } catch (err) {
      alert(err.message);
    }
  };

  // Finalize Sale
  const handleCheckout = async (e) => {
    e.preventDefault();

    if (!selectedCustomerId) {
      alert('Please select or add a customer for this transaction.');
      return;
    }

    if (cartItems.length === 0) {
      alert('Cart is empty. Add products from the catalog to proceed.');
      return;
    }

    const parsedPaidNaira = parseFloat(amountPaidNaira === '' ? '0' : amountPaidNaira);
    if (isNaN(parsedPaidNaira) || parsedPaidNaira < 0) {
      alert('Please enter a valid amount paid in Naira (₦).');
      return;
    }

    const tenderKobo = Math.floor(parsedPaidNaira * 100);
    if (tenderKobo < totalAmountKobo && !allowCredit) {
      alert('Payment is less than total payable. Please check "Allow credit sale" to confirm recording the remaining balance as customer debt.');
      return;
    }

    setIsSubmitting(true);
    try {
      const itemsPayload = cartItems.map(c => ({
        inventoryId: c.item.id,
        quantity: c.quantity,
        price: c.item.price
      }));

      const saleId = await recordSale({
        customerId: selectedCustomerId,
        items: itemsPayload,
        amountTendered: tenderKobo,
        paymentMethod,
        allowCredit
      });

      const selectedCustomer = customers.find(c => c.id === selectedCustomerId);
      const amountAppliedKobo = Math.min(totalAmountKobo, tenderKobo);
      const changeReturnedKobo = paymentMethod === 'cash' ? Math.max(0, tenderKobo - totalAmountKobo) : 0;
      const balanceKobo = totalAmountKobo - amountAppliedKobo;

      // Show receipt modal
      setReceiptData({
        saleId,
        customerName: selectedCustomer?.name || 'Customer',
        items: [...cartItems],
        totalKobo: totalAmountKobo,
        amountTenderedKobo: tenderKobo,
        amountPaidKobo: amountAppliedKobo,
        changeReturnedKobo,
        paymentMethod,
        balanceKobo,
        date: new Date()
      });

      // Reset cart and inputs
      setCart({});
      setAmountPaidNaira('');
      setAllowCredit(false);
      setSelectedCustomerId('');
      setCustomerSearch('');
    } catch (error) {
      alert(`Sale failed: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedCustomerObj = customers.find(c => c.id === selectedCustomerId);

  return (
    <div className="flex flex-col lg:flex-row gap-6 animate-in fade-in duration-200">
      {/* ------------------------------------------------------------------- */}
      {/* Left Column: Product Catalog & Selection */}
      {/* ------------------------------------------------------------------- */}
      <div className="flex-1 space-y-5">
        {/* Customer Selection Card */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <label htmlFor="customerSelect" className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Select Customer
            </label>
            <button
              type="button"
              onClick={() => setIsAddCustomerOpen(true)}
              className="text-xs font-bold text-emerald-600 hover:text-emerald-700 transition-colors"
            >
              + New Customer
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <input
                type="text"
                placeholder="Filter customers by name/phone..."
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <div>
              <select
                id="customerSelect"
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="w-full text-xs font-semibold p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                <option value="">-- Choose Customer ({filteredCustomers.length}) --</option>
                {filteredCustomers.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.phone}) {c.totalDebt > 0 ? `[Owes ${formatNaira(c.totalDebt)}]` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedCustomerObj && (
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-900">
                Selected: {selectedCustomerObj.name} ({selectedCustomerObj.phone})
              </span>
              {selectedCustomerObj.totalDebt > 0 ? (
                <span className="font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-100">
                  Current Balance: {formatNaira(selectedCustomerObj.totalDebt)}
                </span>
              ) : (
                <span className="font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                  Clean Balance (₦0.00)
                </span>
              )}
            </div>
          )}
        </div>

        {/* Product Catalog Card */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 tracking-tight">Merchandise Catalog</h3>
              <p className="text-xs text-slate-500">Tap products to add to current order cart</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Search catalog..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none w-44"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsAddProductOpen(true)}
              >
                + Add Item
              </Button>
            </div>
          </div>

          {filteredInventory.length === 0 ? (
            <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-xl">
              <p className="text-sm font-semibold text-slate-600 mb-2">No merchandise available</p>
              <p className="text-xs text-slate-400 mb-4">Add your retail inventory items to begin ringing up sales.</p>
              <Button variant="primary" size="sm" onClick={() => setIsAddProductOpen(true)}>
                Add First Product
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 max-h-[500px] overflow-y-auto pr-1">
              {filteredInventory.map(item => {
                const inCartCount = cart[item.id]?.quantity || 0;
                const isOutOfStock = (item.stockCount || 0) <= 0;
                const isLowStock = !isOutOfStock && item.stockCount <= 5;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleAddToCart(item)}
                    disabled={isOutOfStock}
                    className={`p-3.5 rounded-xl border text-left transition-all relative flex flex-col justify-between group ${
                      isOutOfStock
                        ? 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed'
                        : 'bg-white border-slate-200 hover:border-emerald-500 hover:shadow-xs active:scale-[0.98]'
                    }`}
                  >
                    {inCartCount > 0 && (
                      <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-emerald-600 text-white font-bold text-2xs flex items-center justify-center shadow-xs">
                        {inCartCount}
                      </span>
                    )}
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 group-hover:text-emerald-700 transition-colors line-clamp-2">
                        {item.itemName}
                      </h4>
                      <p className="text-sm font-black text-emerald-600 mt-1">
                        {formatNaira(item.price)}
                      </p>
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-2xs">
                      <span className={`font-semibold ${
                        isOutOfStock ? 'text-rose-600' :
                        isLowStock ? 'text-amber-600' : 'text-slate-500'
                      }`}>
                        {isOutOfStock ? 'Out of Stock' : `${item.stockCount} left`}
                      </span>
                      <span className="text-emerald-600 font-bold group-hover:underline">
                        + Add
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* Right Column: Order Cart & Cashier Checkout */}
      {/* ------------------------------------------------------------------- */}
      <div className="w-full lg:w-96 shrink-0">
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 sticky top-20 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900 tracking-tight">Active Register Cart</h3>
              <p className="text-xs text-slate-500">{cartItems.length} distinct item{cartItems.length === 1 ? '' : 's'}</p>
            </div>
            {cartItems.length > 0 && (
              <button
                type="button"
                onClick={() => setCart({})}
                className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:underline"
              >
                Clear Cart
              </button>
            )}
          </div>

          {/* Cart Items List */}
          {cartItems.length === 0 ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <svg className="w-10 h-10 mx-auto text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <p className="text-sm font-semibold text-slate-600">Cart is empty</p>
              <p className="text-xs text-slate-400">Select items from the catalog on the left.</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-60 overflow-y-auto pr-1 divide-y divide-slate-100">
              {cartItems.map(c => {
                const lineTotalKobo = c.item.price * c.quantity;
                return (
                  <div key={c.item.id} className="pt-2.5 first:pt-0 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-900 truncate">{c.item.itemName}</p>
                      <p className="text-2xs text-slate-500 font-medium">
                        {formatNaira(c.item.price)} × {c.quantity}
                      </p>
                    </div>

                    {/* Stepper buttons */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleUpdateQuantity(c.item.id, c.quantity - 1)}
                        className="w-6 h-6 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-black flex items-center justify-center text-xs transition-colors"
                      >
                        -
                      </button>
                      <span className="w-6 text-center text-xs font-bold text-slate-900">
                        {c.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleUpdateQuantity(c.item.id, c.quantity + 1)}
                        className="w-6 h-6 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-black flex items-center justify-center text-xs transition-colors"
                      >
                        +
                      </button>
                    </div>

                    <div className="text-right shrink-0 min-w-[70px]">
                      <span className="text-xs font-bold text-slate-900">
                        {formatNaira(lineTotalKobo)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pricing Calculation Summary */}
          <div className="pt-4 border-t border-slate-100 space-y-2 text-xs">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span className="font-bold text-slate-900">{formatNaira(totalAmountKobo)}</span>
            </div>
            <div className="flex justify-between text-base font-black text-slate-900 pt-2 border-t border-slate-100">
              <span>Total Payable</span>
              <span className="text-emerald-700">{formatNaira(totalAmountKobo)}</span>
            </div>
          </div>

          {/* Payment Section */}
          <form onSubmit={handleCheckout} className="space-y-4 pt-2 border-t border-slate-100">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-700">
                  Amount Received (₦)
                </label>
                {totalAmountNaira > 0 && (
                  <button
                    type="button"
                    onClick={handleSetExactPayment}
                    className="text-2xs font-bold text-emerald-600 hover:underline"
                  >
                    Exact ({formatNaira(totalAmountKobo)})
                  </button>
                )}
              </div>
              <input
                type="number"
                step="any"
                min="0"
                required
                placeholder="0.00"
                value={amountPaidNaira}
                onChange={(e) => setAmountPaidNaira(e.target.value)}
                className="w-full text-base font-bold p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>

            {/* Change or Debt Calculation preview */}
            {amountPaidNaira !== '' && !isNaN(parseFloat(amountPaidNaira)) && (
              <div className="space-y-2">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs flex justify-between items-center">
                  {parseFloat(amountPaidNaira) >= totalAmountNaira ? (
                    <>
                      <span className="font-semibold text-slate-600">
                        {paymentMethod === 'cash' ? 'Change Due (Cash):' : 'Settlement Status:'}
                      </span>
                      <span className="font-bold text-emerald-700">
                        {paymentMethod === 'cash'
                          ? `₦${(parseFloat(amountPaidNaira) - totalAmountNaira).toFixed(2)}`
                          : 'Paid in Full (Exact Settlement)'}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="font-semibold text-rose-600">Credit Shortfall (Debt):</span>
                      <span className="font-bold text-rose-600">
                        ₦{(totalAmountNaira - parseFloat(amountPaidNaira)).toFixed(2)}
                      </span>
                    </>
                  )}
                </div>

                {/* Explicit Credit Authorization Checkbox */}
                {parseFloat(amountPaidNaira) < totalAmountNaira && (
                  <label className="flex items-center gap-2 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs cursor-pointer select-none">
                    <input
                      type="checkbox"
                      id="allowCreditCheckbox"
                      checked={allowCredit}
                      onChange={(e) => setAllowCredit(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                    />
                    <span className="font-semibold text-rose-900">
                      Allow credit sale (record shortfall as customer debt)
                    </span>
                  </label>
                )}
              </div>
            )}

            {/* Payment Method Selector */}
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1.5">
                Payment Channel
              </label>
              <div className="grid grid-cols-3 gap-2 text-2xs font-bold">
                {['cash', 'bank_transfer', 'pos'].map(method => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setPaymentMethod(method)}
                    className={`py-2 px-2 rounded-lg border text-center uppercase tracking-wider transition-colors ${
                      paymentMethod === method
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {method === 'pos' ? 'Card / POS' : method.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              isLoading={isSubmitting}
              disabled={cartItems.length === 0 || !selectedCustomerId}
            >
              Complete Sale ({formatNaira(totalAmountKobo)})
            </Button>
          </form>
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* Modal: New Customer */}
      {/* ------------------------------------------------------------------- */}
      <Modal
        isOpen={isAddCustomerOpen}
        onClose={() => setIsAddCustomerOpen(false)}
        title="Register New Customer"
        subtitle="Quickly add a customer to your offline store database"
      >
        <form onSubmit={handleCreateCustomerSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">Full Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Alhaji Musa"
              value={newCustomerName}
              onChange={(e) => setNewCustomerName(e.target.value)}
              className="w-full text-sm p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">Phone Number (WhatsApp)</label>
            <input
              type="tel"
              required
              placeholder="e.g. 08012345678"
              value={newCustomerPhone}
              onChange={(e) => setNewCustomerPhone(e.target.value)}
              className="w-full text-sm p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="md" onClick={() => setIsAddCustomerOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md">
              Save Customer
            </Button>
          </div>
        </form>
      </Modal>

      {/* ------------------------------------------------------------------- */}
      {/* Modal: New Product */}
      {/* ------------------------------------------------------------------- */}
      <Modal
        isOpen={isAddProductOpen}
        onClose={() => setIsAddProductOpen(false)}
        title="Add Inventory Item"
        subtitle="Catalog a new product for instant cashier entry"
      >
        <form onSubmit={handleCreateProductSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">Product / Item Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Dangote Cement 50kg"
              value={newProductName}
              onChange={(e) => setNewProductName(e.target.value)}
              className="w-full text-sm p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Price in Naira (₦)</label>
              <input
                type="number"
                step="any"
                min="0"
                required
                placeholder="e.g. 8500"
                value={newProductPriceNaira}
                onChange={(e) => setNewProductPriceNaira(e.target.value)}
                className="w-full text-sm p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Stock Units</label>
              <input
                type="number"
                min="0"
                required
                placeholder="e.g. 50"
                value={newProductStock}
                onChange={(e) => setNewProductStock(e.target.value)}
                className="w-full text-sm p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="md" onClick={() => setIsAddProductOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md">
              Save to Catalog
            </Button>
          </div>
        </form>
      </Modal>

      {/* ------------------------------------------------------------------- */}
      {/* Modal: Receipt Confirmation */}
      {/* ------------------------------------------------------------------- */}
      {receiptData && (
        <Modal
          isOpen={!!receiptData}
          onClose={() => setReceiptData(null)}
          title="✓ Sale Finalized Successfully"
          subtitle={`Ref: ${receiptData.saleId.slice(0, 8).toUpperCase()}`}
          maxWidth="sm"
        >
          <div className="space-y-4 text-sm">
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
              <div className="flex justify-between text-xs text-slate-500">
                <span>Customer:</span>
                <span className="font-bold text-slate-900">{receiptData.customerName}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>Items:</span>
                <span className="font-semibold text-slate-700">{receiptData.items.length} product(s)</span>
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>Payment Channel:</span>
                <span className="font-bold text-slate-900 uppercase">{receiptData.paymentMethod?.replace('_', ' ')}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-500 pt-1 border-t border-slate-200">
                <span>Total Amount:</span>
                <span className="font-black text-slate-900">{formatNaira(receiptData.totalKobo)}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>Amount Tendered:</span>
                <span className="font-semibold text-slate-700">{formatNaira(receiptData.amountTenderedKobo)}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>Amount Applied (Collected):</span>
                <span className="font-bold text-emerald-700">{formatNaira(receiptData.amountPaidKobo)}</span>
              </div>
              {receiptData.changeReturnedKobo > 0 && (
                <div className="flex justify-between text-xs text-emerald-700 font-bold">
                  <span>Change Returned:</span>
                  <span>{formatNaira(receiptData.changeReturnedKobo)}</span>
                </div>
              )}
              {receiptData.balanceKobo > 0 && (
                <div className="flex justify-between text-xs text-rose-600 font-bold pt-1 border-t border-rose-100">
                  <span>Credit Balance (Customer Debt):</span>
                  <span>{formatNaira(receiptData.balanceKobo)}</span>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="md"
                className="flex-1"
                onClick={() => window.print()}
              >
                Print Receipt
              </Button>
              <Button
                variant="primary"
                size="md"
                className="flex-1"
                onClick={() => setReceiptData(null)}
              >
                New Sale
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
