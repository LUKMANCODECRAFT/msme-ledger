import React from 'react';

/**
 * Standard Status Badge Component strictly adhering to
 * Forest Green, Sand/Cream, and Charcoal.
 * 
 * @param {Object} props
 * @param {'emerald'|'amber'|'rose'|'blue'|'slate'|'purple'|'indigo'} [props.variant='slate']
 * @param {'sm'|'md'} [props.size='sm']
 * @param {React.ReactNode} props.children
 * @param {string} [props.className]
 */
export default function Badge({ variant = 'slate', size = 'sm', children, className = '' }) {
  const variantStyles = {
    emerald: 'bg-[#D8ECE1] text-[#1B4332] border-[#B2DAC5]',
    amber: 'bg-[#EFE9DA] text-[#363C39] border-[#D5C8AB]',
    rose: 'bg-[#141816] text-[#FAF6EE] border-[#2E3431]',
    blue: 'bg-[#D8ECE1] text-[#1B4332] border-[#B2DAC5]',
    slate: 'bg-[#FAF6EE] text-[#363C39] border-[#E5DCC5]',
    purple: 'bg-[#D8ECE1] text-[#1B4332] border-[#B2DAC5]',
    indigo: 'bg-[#D8ECE1] text-[#1B4332] border-[#B2DAC5]'
  };

  const sizeStyles = {
    sm: 'text-xs px-2.5 py-0.5',
    md: 'text-sm px-3 py-1'
  };

  return (
    <span
      className={`inline-flex items-center gap-1 font-semibold rounded-md border tracking-wide uppercase transition-colors ${variantStyles[variant] || variantStyles.slate} ${sizeStyles[size] || sizeStyles.sm} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * Helper to get payment status badge automatically.
 */
export function PaymentStatusBadge({ status }) {
  switch (status) {
    case 'paid':
      return <Badge variant="emerald">Paid</Badge>;
    case 'partial':
      return <Badge variant="amber">Partial</Badge>;
    case 'unpaid':
      return <Badge variant="rose">Unpaid (Credit)</Badge>;
    default:
      return <Badge variant="slate">{status || 'Unknown'}</Badge>;
  }
}

/**
 * Helper to get sync status badge automatically.
 */
export function SyncStatusBadge({ status }) {
  if (status === 'synced') {
    return <Badge variant="emerald">✓ Synced</Badge>;
  }
  return <Badge variant="amber">● Pending</Badge>;
}
