import React from 'react';

export default function ExpiredPaywall({ shopId }) {
  const message = `Hello LCC Admin! I just transferred 1,500 NGN. My Shop ID is: ${shopId}`;
  const whatsappUrl = `https://wa.me/2349132555203?text=${encodeURIComponent(message)}`;

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex items-center justify-center p-4 font-sans text-[#1E2321]">
      <div className="max-w-md w-full bg-[#FAF6EE] border border-[#E5DCC5] rounded-3xl shadow-2xl overflow-hidden text-center">
        {/* Charcoal Header Banner */}
        <div className="bg-[#141816] text-[#FDFBF7] py-7 px-6 border-b border-[#2E3431]">
          <span className="text-2xs font-extrabold uppercase tracking-wider px-3 py-1 rounded-full bg-[#2E3431] text-[#D8ECE1] border border-[#3E8662] mb-3 inline-block">
            Subscription Required
          </span>
          <h1 className="text-2xl font-black tracking-tight uppercase text-[#FDFBF7]">Evaluation Expired</h1>
          <p className="text-[#D8ECE1] mt-1.5 font-medium text-xs">Your 30-day offline trial period has concluded.</p>
        </div>
        
        <div className="p-8 space-y-6">
          <p className="text-[#5C6460] text-sm leading-relaxed font-medium">
            To unlock write operations and cloud synchronization, please complete your subscription renewal via bank transfer. Your data remains perfectly safe on this device.
          </p>

          <div className="bg-[#F3EDE0] rounded-2xl p-5 border border-[#E5DCC5] text-left">
            <h3 className="text-xs uppercase tracking-widest text-[#5C6460] font-bold mb-4">Bank Transfer Details</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-[#5C6460] font-medium">Bank:</span>
                <span className="font-bold text-[#141816]">OPAY</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#5C6460] font-medium">Account No:</span>
                <span className="font-bold text-[#141816] tracking-wider font-mono">9132555203</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#5C6460] font-medium">Name:</span>
                <span className="font-bold text-[#141816]">Lukman yerima ismail</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-[#E5DCC5]">
                <span className="text-[#5C6460] font-medium">Amount:</span>
                <span className="font-black text-[#1B4332] text-base">₦1,500 NGN</span>
              </div>
            </div>
          </div>

          <a 
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full py-4 px-4 bg-[#1B4332] hover:bg-[#22573F] active:bg-[#143621] text-[#FDFBF7] font-black rounded-xl transition-all shadow-md uppercase tracking-wide text-sm border border-[#143621]"
          >
            I Have Paid (Send Receipt)
          </a>
        </div>
      </div>
    </div>
  );
}
