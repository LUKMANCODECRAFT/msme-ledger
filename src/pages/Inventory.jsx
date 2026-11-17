import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { msme_ledger_db } from '../config/db.js';
import { createProduct, adjustStock } from '../services/inventoryService.js';
import { formatNaira, formatNumber } from '../utils/formatters.js';
import Button from '../components/common/Button.jsx';
import Modal from '../components/common/Modal.jsx';
import StatCard from '../components/common/StatCard.jsx';
import Badge from '../components/common/Badge.jsx';
import EmptyState from '../components/common/EmptyState.jsx';

export default function Inventory({ isReadOnly = false }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [stockFilter, setStockFilter] = useState('ALL'); // 'ALL' | 'LOW' | 'OUT' | 'HEALTHY'

  // Modal: Add Product
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addOperationId, setAddOperationId] = useState(() => `op_ui_prod_${crypto.randomUUID()}`);
  const [newProductName, setNewProductName] = useState('');
  const [newProductPriceNaira, setNewProductPriceNaira] = useState('');
  const [newProductStock, setNewProductStock] = useState('');
  const [hasVerifiedCost, setHasVerifiedCost] = useState(false);
  const [unitCostNaira, setUnitCostNaira] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modal: Adjust Stock
  const [selectedItemForAdjust, setSelectedItemForAdjust] = useState(null);
  const [adjustOperationId, setAdjustOperationId] = useState(null);
  const [adjustmentDelta, setAdjustmentDelta] = useState('');
  const [adjustmentType, setAdjustmentType] = useState('ADD'); // 'ADD' | 'REMOVE'
  const [isAdjustSubmitting, setIsAdjustSubmitting] = useState(false);

  // Query live inventory from Dexie
  const inventory = useLiveQuery(() => msme_ledger_db.inventory.toArray()) || [];

  // Metrics
  const stats = useMemo(() => {
    const totalItems = inventory.length;
    const totalUnits = inventory.reduce((sum, i) => sum + (i.stockCount || 0), 0);
    const outOfStock = inventory.filter(i => (i.stockCount || 0) <= 0).length;
    const lowStock = inventory.filter(i => (i.stockCount || 0) > 0 && (i.stockCount || 0) <= 5).length;
    const totalValuationKobo = inventory.reduce((sum, i) => sum + ((i.price || 0) * (i.stockCount || 0)), 0);

    return { totalItems, totalUnits, outOfStock, lowStock, totalValuationKobo };
  }, [inventory]);

  // Filtered inventory
  const filteredInventory = useMemo(() => {
    return inventory.filter(item => {
      // Stock status filter
      if (stockFilter === 'OUT' && (item.stockCount || 0) > 0) return false;
      if (stockFilter === 'LOW' && ((item.stockCount || 0) <= 0 || (item.stockCount || 0) > 5)) return false;
      if (stockFilter === 'HEALTHY' && (item.stockCount || 0) <= 5) return false;

      // Text search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!item.itemName.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [inventory, stockFilter, searchQuery]);

  // Handle Add Product Submit
  const handleAddProduct = async (e) => {
    e.preventDefault();
    if (isReadOnly) {
      alert('Application is in read-only mode due to subscription status. Adding products is locked.');
      return;
    }
    if (!newProductName.trim() || !newProductPriceNaira || !newProductStock) return;

    const parsedPriceNaira = parseFloat(newProductPriceNaira);
    const parsedStock = parseFloat(newProductStock);

    if (isNaN(parsedPriceNaira) || parsedPriceNaira <= 0 || isNaN(parsedStock) || parsedStock < 0) {
      alert('Please enter valid positive numbers for price and stock count.');
      return;
    }

    setIsSubmitting(true);
    try {
      const priceKobo = Math.floor(parsedPriceNaira * 100);
      const costKobo = hasVerifiedCost && unitCostNaira ? Math.floor(parseFloat(unitCostNaira) * 100) : null;

      await createProduct({
        name: newProductName.trim(),
        priceKobo,
        stockCount: newProductStock.trim(),
        hasVerifiedCost,
        verifiedUnitCost: costKobo,
        operationId: addOperationId
      });

      // Reset upon verified terminal success
      setNewProductName('');
      setNewProductPriceNaira('');
      setNewProductStock('');
      setHasVerifiedCost(false);
      setUnitCostNaira('');
      setIsAddModalOpen(false);
      setAddOperationId(`op_ui_prod_${crypto.randomUUID()}`);
    } catch (err) {
      alert(`Failed to add product: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Stock Adjustment
  const handleAdjustStock = async (e) => {
    e.preventDefault();
    if (isReadOnly) {
      alert('Application is in read-only mode due to subscription status. Stock adjustments are locked.');
      return;
    }
    if (!selectedItemForAdjust || !adjustmentDelta) return;

    setIsAdjustSubmitting(true);
    try {
      const opId = adjustOperationId || `op_ui_adj_${selectedItemForAdjust.id}_${crypto.randomUUID()}`;
      await adjustStock({
        productId: selectedItemForAdjust.id,
        delta: adjustmentDelta.trim(),
        movementType: adjustmentType === 'ADD' ? 'RESTOCK' : 'ADJUSTMENT_DAMAGE',
        reason: adjustmentType === 'ADD' ? 'Manual stock restock' : 'Damage or spoilage adjustment',
        operationId: opId
      });

      setSelectedItemForAdjust(null);
      setAdjustOperationId(null);
      setAdjustmentDelta('');
    } catch (err) {
      alert(`Failed to update stock: ${err.message}`);
    } finally {
      setIsAdjustSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* ------------------------------------------------------------------- */}
      {/* 1. Header & Actions */}
      {/* ------------------------------------------------------------------- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900 tracking-tight">Merchandise & Inventory</h3>
          <p className="text-xs text-slate-500">Manage catalog prices, physical counts, and stock movements</p>
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={() => setIsAddModalOpen(true)}
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          }
        >
          Add Product
        </Button>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 2. Key Metrics */}
      {/* ------------------------------------------------------------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Catalog SKUs"
          value={stats.totalItems}
          subtitle={`${stats.totalUnits} total units in stock`}
          accentColor="slate"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          }
        />

        <StatCard
          title="Retail Stock Valuation"
          value={formatNaira(stats.totalValuationKobo)}
          subtitle="At current catalog retail prices"
          accentColor="emerald"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />

        <StatCard
          title="Low Stock Warnings"
          value={stats.lowStock}
          subtitle="Items with ≤ 5 units remaining"
          accentColor={stats.lowStock > 0 ? 'amber' : 'slate'}
          badge={stats.lowStock > 0 ? 'Reorder Soon' : 'Optimal'}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
        />

        <StatCard
          title="Out of Stock"
          value={stats.outOfStock}
          subtitle="Requires immediate replenishment"
          accentColor={stats.outOfStock > 0 ? 'rose' : 'emerald'}
          badge={stats.outOfStock > 0 ? 'Action Required' : 'All Stocked'}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          }
        />
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 3. Filter & Search Bar */}
      {/* ------------------------------------------------------------------- */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        {/* Status Filter Buttons */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl text-xs font-bold overflow-x-auto">
          <button
            type="button"
            onClick={() => setStockFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              stockFilter === 'ALL' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Products ({inventory.length})
          </button>
          <button
            type="button"
            onClick={() => setStockFilter('LOW')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              stockFilter === 'LOW' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Low Stock ({stats.lowStock})
          </button>
          <button
            type="button"
            onClick={() => setStockFilter('OUT')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              stockFilter === 'OUT' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Out of Stock ({stats.outOfStock})
          </button>
          <button
            type="button"
            onClick={() => setStockFilter('HEALTHY')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              stockFilter === 'HEALTHY' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Healthy Stock
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative min-w-[260px]">
          <input
            type="text"
            placeholder="Search merchandise by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-xs font-medium pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
          />
          <svg className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 4. Products Table */}
      {/* ------------------------------------------------------------------- */}
      {filteredInventory.length === 0 ? (
        <EmptyState
          title="No merchandise found"
          description={searchQuery ? 'No catalog items match your search. Try a different keyword.' : 'Add retail products to track stock quantities and ring up cashier sales.'}
          actionLabel={searchQuery ? 'Clear Search' : 'Add First Product'}
          onAction={() => {
            if (searchQuery) setSearchQuery('');
            else setIsAddModalOpen(true);
          }}
        />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-200/80 text-slate-500 font-bold text-xs uppercase tracking-wider">
                  <th className="py-3.5 px-4">Item Name</th>
                  <th className="py-3.5 px-4 text-right">Retail Price</th>
                  <th className="py-3.5 px-4 text-center">Available Stock</th>
                  <th className="py-3.5 px-4 text-center">Stock Status</th>
                  <th className="py-3.5 px-4 text-center">Cost Accounting</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredInventory.map((item) => {
                  const stock = item.stockCount || 0;
                  const isOutOfStock = stock <= 0;
                  const isLowStock = !isOutOfStock && stock <= 5;

                  return (
                    <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-900">
                        {item.itemName}
                      </td>
                      <td className="py-3.5 px-4 text-right font-black text-emerald-600 whitespace-nowrap">
                        {formatNaira(item.price)}
                      </td>
                      <td className="py-3.5 px-4 text-center font-bold text-slate-900">
                        {formatNumber(stock)} units
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span className={`inline-block px-2.5 py-0.5 rounded-md text-xs font-bold uppercase tracking-wider border ${
                          isOutOfStock ? 'bg-rose-50 text-rose-700 border-rose-200' :
                          isLowStock ? 'bg-amber-50 text-amber-700 border-amber-200' :
                          'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}>
                          {isOutOfStock ? 'Out of Stock' : isLowStock ? 'Low Stock' : 'In Stock'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {/* Domain rule: Never interpret unknown cost as zero */}
                        <span className="text-2xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200" title="Unknown cost is never treated as zero in profit calculations">
                          Unspecified Cost
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedItemForAdjust(item);
                            setAdjustOperationId(`op_ui_adj_${item.id}_${crypto.randomUUID()}`);
                            setAdjustmentDelta('');
                          }}
                          className="text-xs font-bold text-emerald-600 hover:text-emerald-700 hover:underline px-2 py-1"
                        >
                          Adjust / Restock
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* Modal: Add New Product */}
      {/* ------------------------------------------------------------------- */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Add Inventory Item"
        subtitle="Register a new retail product into your local catalog"
      >
        <form onSubmit={handleAddProduct} className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">Product Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Indomie Instant Noodles (Carton)"
              value={newProductName}
              onChange={(e) => setNewProductName(e.target.value)}
              className="w-full text-sm p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Selling Price (₦)</label>
              <input
                type="number"
                step="any"
                min="0"
                required
                placeholder="e.g. 7500"
                value={newProductPriceNaira}
                onChange={(e) => setNewProductPriceNaira(e.target.value)}
                className="w-full text-sm font-bold p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Initial Stock Units</label>
              <input
                type="number"
                min="0"
                required
                placeholder="e.g. 25"
                value={newProductStock}
                onChange={(e) => setNewProductStock(e.target.value)}
                className="w-full text-sm font-bold p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
          </div>

          {/* Cost Verification Notice adhering to Blueprint rules */}
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-800">
              <input
                type="checkbox"
                checked={hasVerifiedCost}
                onChange={(e) => setHasVerifiedCost(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
              />
              <span>I have a verified purchase invoice / unit cost</span>
            </label>

            {hasVerifiedCost ? (
              <div>
                <label className="text-2xs font-bold uppercase text-slate-500 block mb-1">Verified Unit Cost (₦)</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="e.g. 6200"
                  value={unitCostNaira}
                  onChange={(e) => setUnitCostNaira(e.target.value)}
                  className="w-full text-xs p-2.5 bg-white border border-slate-300 rounded-lg outline-none"
                />
              </div>
            ) : (
              <p className="text-2xs text-slate-400">
                Notice: In accordance with approved financial rules, unknown historical costs are never assumed to be zero in profit calculations.
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="md" onClick={() => setIsAddModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md" isLoading={isSubmitting}>
              Save to Catalog
            </Button>
          </div>
        </form>
      </Modal>

      {/* ------------------------------------------------------------------- */}
      {/* Modal: Adjust / Restock Stock */}
      {/* ------------------------------------------------------------------- */}
      {selectedItemForAdjust && (
        <Modal
          isOpen={!!selectedItemForAdjust}
          onClose={() => setSelectedItemForAdjust(null)}
          title={`Adjust Stock: ${selectedItemForAdjust.itemName}`}
          subtitle={`Current stock on hand: ${selectedItemForAdjust.stockCount || 0} units`}
        >
          <form onSubmit={handleAdjustStock} className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Adjustment Action</label>
              <div className="grid grid-cols-2 gap-2 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setAdjustmentType('ADD')}
                  className={`py-2 px-3 rounded-xl border text-center transition-colors ${
                    adjustmentType === 'ADD'
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-200'
                  }`}
                >
                  + Add Stock (Restock)
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustmentType('REMOVE')}
                  className={`py-2 px-3 rounded-xl border text-center transition-colors ${
                    adjustmentType === 'REMOVE'
                      ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-200'
                  }`}
                >
                  - Deduct Stock (Damage/Loss)
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                Quantity to {adjustmentType === 'ADD' ? 'Add' : 'Deduct'}
              </label>
              <input
                type="number"
                min="1"
                required
                placeholder="e.g. 10"
                value={adjustmentDelta}
                onChange={(e) => setAdjustmentDelta(e.target.value)}
                className="w-full text-base font-bold p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>

            {adjustmentDelta && !isNaN(parseInt(adjustmentDelta, 10)) && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs flex justify-between">
                <span className="font-semibold text-slate-600">New Resulting Stock:</span>
                <span className="font-bold text-slate-900">
                  {adjustmentType === 'ADD'
                    ? (selectedItemForAdjust.stockCount || 0) + parseInt(adjustmentDelta, 10)
                    : (selectedItemForAdjust.stockCount || 0) - parseInt(adjustmentDelta, 10)
                  } units
                </span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="md" onClick={() => setSelectedItemForAdjust(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="md" isLoading={isAdjustSubmitting} disabled={isAdjustSubmitting}>
                Confirm Adjustment
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
