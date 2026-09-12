import React from 'react';

/**
 * Two-button toggle group. Each option is { value, label }.
 * The active option gets the purple highlight; the other gets a neutral border.
 */
export default function ToggleButtons({ options, value, onChange, className = '' }) {
  return (
    <div className={`flex gap-2 ${className}`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg border ${
            value === opt.value
              ? 'bg-purple-600 text-white border-purple-600'
              : 'text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-purple-400'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
