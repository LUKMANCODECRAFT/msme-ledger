import React from 'react';

/**
 * Metric/KPI Stat Card Component strictly adhering to
 * Forest Green, Sand/Cream, and Charcoal.
 * 
 * @param {Object} props
 * @param {string} props.title - Metric title (e.g., "Today's Sales")
 * @param {string|number} props.value - Display value (e.g., "₦45,000.00")
 * @param {string} [props.subtitle] - Contextual detail (e.g., "12 orders")
 * @param {React.ReactNode} [props.icon] - Visual accent icon
 * @param {'emerald'|'blue'|'amber'|'rose'|'slate'} [props.accentColor='emerald']
 * @param {string} [props.badge] - Optional badge pill text
 * @param {Function} [props.onClick] - Optional click handler
 * @param {string} [props.className]
 */
export default function StatCard({
  title,
  value,
  subtitle,
  icon,
  accentColor = 'emerald',
  badge,
  onClick,
  className = ''
}) {
  const iconBackgrounds = {
    emerald: 'bg-[#D8ECE1] text-[#1B4332] border border-[#B2DAC5]',
    blue: 'bg-[#D8ECE1] text-[#1B4332] border border-[#B2DAC5]',
    amber: 'bg-[#EFE9DA] text-[#363C39] border border-[#D5C8AB]',
    rose: 'bg-[#141816] text-[#FAF6EE] border border-[#2E3431]',
    slate: 'bg-[#F3EDE0] text-[#1E2321] border border-[#E5DCC5]'
  };

  return (
    <div
      onClick={onClick}
      className={`bg-[#FAF6EE] rounded-2xl p-5 border border-[#E5DCC5] shadow-xs hover:border-[#D5C8AB] transition-all ${onClick ? 'cursor-pointer hover:shadow-sm' : ''} ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#5C6460]">{title}</p>
          <p className="text-2xl font-black tracking-tight text-[#141816]">{value}</p>
        </div>
        {icon && (
          <div className={`p-2.5 rounded-xl shrink-0 ${iconBackgrounds[accentColor] || iconBackgrounds.slate}`}>
            {icon}
          </div>
        )}
      </div>

      {(subtitle || badge) && (
        <div className="mt-3 pt-3 border-t border-[#E5DCC5] flex items-center justify-between text-xs">
          {subtitle && <span className="text-[#434A46] font-medium">{subtitle}</span>}
          {badge && (
            <span className="font-bold text-[#1B4332] bg-[#D8ECE1] px-2 py-0.5 rounded border border-[#B2DAC5]">
              {badge}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
