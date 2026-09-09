import React from 'react';

export default function Input({
  label,
  labelAction,
  title,
  name,
  type = 'text',
  value,
  onChange,
  onInput,
  required = false,
  error,
  note,
  placeholder,
  disabled = false,
  formPadding = true,
  prefix,
  className = '',
  ...args
}) {
  return (
    <div className={`${formPadding ? 'mb-4 ' : ''}${className}`}>
      {(label || labelAction) && (
        <div className="flex items-center justify-between mb-2">
          {label && (
            <label htmlFor={name} title={title} className="block text-sm font-medium">
              {label}{required ? ' *' : ''}
            </label>
          )}
          {labelAction}
        </div>
      )}
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 pointer-events-none">{prefix}</span>
        )}
        <input
          type={type}
          id={name}
          name={name}
          value={value}
          onChange={onChange}
          onInput={onInput}
          disabled={disabled}
          placeholder={placeholder}
          required={required}
          className={`w-full ${prefix ? 'pl-7' : 'px-3'} py-2 border rounded bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 ${
            error
              ? 'border-red-500 focus:ring-red-500'
              : 'border-gray-300 dark:border-gray-600'
          }`}
          {...args}
        />
      </div>
      {note && <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">{note}</p>}
      {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
    </div>
  );
}
