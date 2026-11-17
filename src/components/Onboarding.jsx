import React, { useState } from 'react';

export default function Onboarding({ onComplete, onCancel }) {
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
    <div className="min-h-screen bg-[#FDFBF7] flex items-center justify-center p-4 font-sans text-[#1E2321]">
      <div className="bg-[#FAF6EE] max-w-md w-full rounded-3xl shadow-xl p-8 md:p-10 border border-[#E5DCC5] text-center">
        <div className="w-14 h-14 rounded-2xl bg-[#1B4332] text-[#FDFBF7] flex items-center justify-center font-black text-2xl mx-auto mb-5 shadow-md border border-[#143621]">
          ₦
        </div>

        <span className="text-2xs font-extrabold uppercase tracking-wider px-3 py-1 rounded-full bg-[#D8ECE1] text-[#1B4332] border border-[#B2DAC5] mb-3 inline-block">
          Fast 30-Second Setup
        </span>

        <h1 className="text-2xl sm:text-3xl font-black text-[#141816] mb-2 tracking-tight">
          Welcome to MSME Ledger
        </h1>
        <p className="text-[#5C6460] mb-8 font-medium text-sm">
          Enter your shop name to initialize your offline ledger. No internet or card required.
        </p>
        
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col text-left">
            <label htmlFor="shopName" className="text-xs font-bold uppercase tracking-wider text-[#363C39] mb-2">
              Shop Name
            </label>
            <input
              id="shopName"
              type="text"
              required
              className="w-full p-4 bg-[#FDFBF7] border border-[#E5DCC5] rounded-xl text-lg font-bold text-[#141816] focus:outline-none focus:ring-2 focus:ring-[#1B4332] focus:border-[#1B4332] transition-colors placeholder:text-[#A9AFAA]"
              placeholder="e.g. Al-Baraka Agro Store"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !shopName.trim()}
            className="w-full py-4 px-6 bg-[#1B4332] text-[#FDFBF7] text-lg font-black rounded-xl hover:bg-[#22573F] active:bg-[#143621] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md mt-2 border border-[#143621] transform active:scale-95"
          >
            {isSubmitting ? 'Setting up...' : 'Start Managing Sales'}
          </button>

          {typeof onCancel === 'function' && (
            <button
              type="button"
              onClick={onCancel}
              className="text-xs font-bold text-[#5C6460] hover:text-[#1B4332] transition-colors py-1"
            >
              ← Back to Overview
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
