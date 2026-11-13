import React, { useState } from 'react';

export default function Onboarding({ onComplete }) {
  const [shopName, setShopName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!shopName.trim()) return;

    setIsSubmitting(true);
    try {
      // 1. Save shop name offline safely without clearing existing business records
      localStorage.setItem('shopName', shopName.trim());

      // 2. Mark onboarding as complete
      onComplete();
    } catch (error) {
      console.error(error);
      alert('Failed to initialize shop data. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 font-sans">
      <div className="bg-white max-w-md w-full rounded-2xl shadow-xl p-8 border border-slate-200 text-center">
        <h1 className="text-2xl font-black text-slate-900 mb-2">Welcome to MSME Ledger</h1>
        <p className="text-slate-500 mb-8 font-medium">Let's set up your shop.</p>
        
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col text-left">
            <label htmlFor="shopName" className="text-sm font-bold text-slate-700 mb-2">
              Shop Name
            </label>
            <input
              id="shopName"
              type="text"
              required
              className="w-full p-4 bg-slate-50 border border-slate-300 rounded-lg text-lg font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 transition-colors"
              placeholder="e.g. My Amazing Store"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !shopName.trim()}
            className="w-full py-4 px-6 bg-emerald-600 text-white text-lg font-black rounded-lg hover:bg-emerald-700 active:bg-emerald-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md mt-2"
          >
            {isSubmitting ? 'Setting up...' : 'Start Managing Sales'}
          </button>
        </form>
      </div>
    </div>
  );
}
