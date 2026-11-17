import React from 'react';

/**
 * Official MSME Ledger Brand Icon Component
 * Rendered using vector paths in Forest Green, Sand/Cream, and Charcoal.
 */
export default function BrandLogo({ size = 40, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className}`}
    >
      <rect x="24" y="24" width="464" height="464" rx="112" fill="#1B4332" stroke="#2D6A4F" strokeWidth="8" />
      <rect x="36" y="36" width="440" height="440" rx="100" fill="none" stroke="#D8ECE1" strokeWidth="3" strokeOpacity="0.25" />
      
      {/* Left Ledger Page */}
      <path d="M120 156 C176 142, 236 148, 252 168 L252 364 C236 348, 176 342, 120 356 Z" fill="#FDFBF7" stroke="#E5DCC5" strokeWidth="3" />
      
      {/* Right Ledger Page */}
      <path d="M392 156 C336 142, 276 148, 260 168 L260 364 C276 348, 336 342, 392 356 Z" fill="#FDFBF7" stroke="#E5DCC5" strokeWidth="3" />
      
      {/* Center Seam */}
      <line x1="256" y1="168" x2="256" y2="368" stroke="#D5C8AB" strokeWidth="4" strokeLinecap="round" />
      
      {/* Left Page Financial Bars */}
      <line x1="146" y1="200" x2="226" y2="200" stroke="#1B4332" strokeWidth="6" strokeLinecap="round" strokeOpacity="0.8" />
      <line x1="146" y1="236" x2="226" y2="236" stroke="#5C6460" strokeWidth="5" strokeLinecap="round" strokeOpacity="0.5" />
      <line x1="146" y1="272" x2="206" y2="272" stroke="#5C6460" strokeWidth="5" strokeLinecap="round" strokeOpacity="0.5" />
      <line x1="146" y1="308" x2="216" y2="308" stroke="#5C6460" strokeWidth="5" strokeLinecap="round" strokeOpacity="0.5" />

      {/* Right Page Naira Symbol (₦) */}
      <g transform="translate(320, 252)">
        <path d="M-30 36 L-30 -36 L-10 -36 L12 14 L12 -36 L30 -36 L30 36 L10 36 L-12 -14 L-12 36 Z" fill="#1B4332" />
        <line x1="-36" y1="-7" x2="36" y2="-7" stroke="#1B4332" strokeWidth="6" strokeLinecap="round" />
        <line x1="-36" y1="7" x2="36" y2="7" stroke="#1B4332" strokeWidth="6" strokeLinecap="round" />
      </g>
    </svg>
  );
}
