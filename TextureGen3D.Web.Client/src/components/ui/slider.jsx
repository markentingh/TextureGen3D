import React from 'react';

export default function Slider({ label, value, onChange, min = 0, max = 1, step = 0.01, className = '' }) {
  const isInteger = step >= 1;
  return (
    <div className={className}>
      {label && (
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-gray-600 dark:text-gray-300">{label}</label>
          <span className="text-sm text-gray-500 dark:text-gray-400">{isInteger ? Math.round(value) : Number(value).toFixed(2)}</span>
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(isInteger ? parseInt(e.target.value) : parseFloat(e.target.value))}
        className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-primary-500"
      />
    </div>
  );
}
