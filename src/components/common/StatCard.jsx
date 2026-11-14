import React from 'react';

/**
 * Metric/KPI Stat Card Component
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
    emerald: 'bg-emerald-50 text-emerald-600 border border-emerald-100',
    blue: 'bg-blue-50 text-blue-600 border border-blue-100',
    amber: 'bg-amber-50 text-amber-600 border border-amber-100',
    rose: 'bg-rose-50 text-rose-600 border border-rose-100',
    slate: 'bg-slate-100 text-slate-700 border border-slate-200'
  };

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl p-5 border border-slate-200/90 shadow-xs hover:border-slate-300 transition-all ${onClick ? 'cursor-pointer hover:shadow-sm' : ''} ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-700">{title}</p>
          <p className="text-2xl font-black tracking-tight text-slate-900">{value}</p>
        </div>
        {icon && (
          <div className={`p-2.5 rounded-lg shrink-0 ${iconBackgrounds[accentColor] || iconBackgrounds.slate}`}>
            {icon}
          </div>
        )}
      </div>

      {(subtitle || badge) && (
        <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
          {subtitle && <span className="text-slate-700 font-medium">{subtitle}</span>}
          {badge && (
            <span className="font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
              {badge}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
