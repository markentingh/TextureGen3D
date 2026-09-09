import React from 'react';

export default function Select({
  label,
  labelAction,
  name,
  options = [],
  value,
  onChange,
  onInput,
  required = false,
  error,
  note,
  placeholder,
  disabled = false,
  fitContent = false,
  className = '',
  ...args
}) {
  return (
    <div className={`mb-4 ${className}`}>
      {(label || labelAction) && (
        <div className="flex items-center justify-between mb-2">
          {label && (
            <label htmlFor={name} className="block text-sm font-medium">
              {label}{required ? ' *' : ''}
            </label>
          )}
          {labelAction}
        </div>
      )}
      <select
        id={name}
        name={name}
        value={value}
        onChange={onChange}
        onInput={onInput}
        disabled={disabled}
        required={required}
        className={`${fitContent ? '' : 'w-full'} px-3 py-2 border rounded bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 ${
          error
            ? 'border-red-500 focus:ring-red-500'
            : 'border-gray-300 dark:border-gray-600'
        }`}
        {...args}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {note && <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">{note}</p>}
      {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
    </div>
  );
}
