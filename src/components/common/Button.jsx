import React from 'react';

/**
 * Standard Accessible Button Component strictly styled with
 * Forest Green, Sand/Cream, and Charcoal.
 * 
 * @param {Object} props
 * @param {'primary'|'secondary'|'outline'|'danger'|'ghost'} [props.variant='primary']
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {boolean} [props.isLoading=false]
 * @param {boolean} [props.disabled=false]
 * @param {React.ReactNode} [props.icon]
 * @param {React.ReactNode} props.children
 * @param {'button'|'submit'|'reset'} [props.type='button']
 * @param {Function} [props.onClick]
 * @param {string} [props.className]
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  disabled = false,
  icon = null,
  children,
  type = 'button',
  onClick,
  className = '',
  ...rest
}) {
  const variantStyles = {
    primary: 'bg-[#1B4332] text-[#FDFBF7] hover:bg-[#22573F] active:bg-[#143621] focus:ring-[#1B4332] shadow-xs border border-[#143621]',
    secondary: 'bg-[#1E2321] text-[#FAF6EE] hover:bg-[#2E3431] active:bg-[#141816] focus:ring-[#1E2321] shadow-xs border border-[#141816]',
    outline: 'bg-[#FAF6EE] text-[#1E2321] hover:bg-[#F3EDE0] active:bg-[#EFE9DA] border border-[#E5DCC5] focus:ring-[#1B4332] shadow-2xs',
    danger: 'bg-[#141816] text-[#FAF6EE] hover:bg-[#2E3431] active:bg-[#0C0F0E] focus:ring-[#141816] shadow-xs border border-[#2E3431]',
    ghost: 'bg-transparent text-[#434A46] hover:text-[#141816] hover:bg-[#F7F4EB] active:bg-[#EFE9DA] border border-transparent'
  };

  const sizeStyles = {
    sm: 'text-xs font-semibold px-3 py-1.5 rounded-md gap-1.5',
    md: 'text-sm font-semibold px-4 py-2 rounded-lg gap-2',
    lg: 'text-base font-bold px-5 py-2.5 rounded-lg gap-2.5'
  };

  const isDisabled = disabled || isLoading;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      className={`inline-flex items-center justify-center font-medium transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 select-none disabled:opacity-50 disabled:cursor-not-allowed ${variantStyles[variant] || variantStyles.primary} ${sizeStyles[size] || sizeStyles.md} ${className}`}
      {...rest}
    >
      {isLoading ? (
        <svg className="animate-spin h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      ) : icon ? (
        <span className="shrink-0">{icon}</span>
      ) : null}
      <span>{children}</span>
    </button>
  );
}
