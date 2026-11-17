import React, { useEffect } from 'react';

/**
 * Standard Accessible Modal Dialog strictly adhering to
 * Forest Green, Sand/Cream, and Charcoal.
 * 
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {Function} props.onClose
 * @param {string} props.title
 * @param {string} [props.subtitle]
 * @param {'sm'|'md'|'lg'|'xl'} [props.maxWidth='md']
 * @param {React.ReactNode} props.children
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  maxWidth = 'md',
  children
}) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxWidthStyles = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl'
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-[#141816]/75 backdrop-blur-xs transition-opacity animate-in fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`relative w-full ${maxWidthStyles[maxWidth] || maxWidthStyles.md} bg-[#FAF6EE] text-[#1E2321] rounded-3xl shadow-2xl border border-[#E5DCC5] overflow-hidden transform transition-all animate-in zoom-in-95`}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-[#E5DCC5] flex items-start justify-between gap-4">
          <div>
            <h3 id="modal-title" className="text-lg font-black text-[#141816] tracking-tight">
              {title}
            </h3>
            {subtitle && (
              <p className="text-xs text-[#5C6460] mt-0.5 font-medium">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#5C6460] hover:text-[#141816] p-1.5 rounded-xl hover:bg-[#F3EDE0] transition-colors"
            aria-label="Close dialog"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
