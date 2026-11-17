import React from 'react';
import Button from './Button.jsx';

/**
 * Standard Empty State Component strictly adhering to
 * Forest Green, Sand/Cream, and Charcoal.
 * 
 * @param {Object} props
 * @param {string} props.title
 * @param {string} props.description
 * @param {React.ReactNode} [props.icon]
 * @param {string} [props.actionLabel]
 * @param {Function} [props.onAction]
 * @param {string} [props.className]
 */
export default function EmptyState({
  title,
  description,
  icon,
  actionLabel,
  onAction,
  className = ''
}) {
  return (
    <div className={`p-8 md:p-12 text-center rounded-3xl border-2 border-dashed border-[#E5DCC5] bg-[#FAF6EE]/80 flex flex-col items-center justify-center max-w-lg mx-auto ${className}`}>
      <div className="w-12 h-12 rounded-2xl bg-[#F3EDE0] border border-[#E5DCC5] flex items-center justify-center text-[#5C6460] mb-4 shadow-2xs">
        {icon || (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
        )}
      </div>
      <h4 className="text-base font-black text-[#141816] mb-1">{title}</h4>
      <p className="text-sm text-[#5C6460] max-w-sm mb-6 leading-relaxed font-medium">{description}</p>
      {actionLabel && onAction && (
        <Button variant="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
