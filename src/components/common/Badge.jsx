import React from 'react';

/**
 * Standard Status Badge Component
 * 
 * @param {Object} props
 * @param {'emerald'|'amber'|'rose'|'blue'|'slate'|'purple'|'indigo'} [props.variant='slate']
 * @param {'sm'|'md'} [props.size='sm']
 * @param {React.ReactNode} props.children
 * @param {string} [props.className]
 */
export default function Badge({ variant = 'slate', size = 'sm', children, className = '' }) {
  const variantStyles = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
    amber: 'bg-amber-50 text-amber-700 border-amber-200/80',
    rose: 'bg-rose-50 text-rose-700 border-rose-200/80',
    blue: 'bg-blue-50 text-blue-700 border-blue-200/80',
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200/80',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200/80'
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
    return <Badge variant="slate">✓ Synced</Badge>;
  }
  return <Badge variant="amber">● Pending</Badge>;
}
