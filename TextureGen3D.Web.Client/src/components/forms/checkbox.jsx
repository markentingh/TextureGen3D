import React from 'react';

export default function Checkbox({
  label,
  name,
  id,
  checked,
  onChange,
  onInput,
  required = false,
  error,
  disabled = false,
  className = '',
  ...args
}) {
  const inputId = id || name;

  return (
    <div className={`mb-4 ${className}`}>
      <label htmlFor={inputId} className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          id={inputId}
          name={name}
          checked={checked}
          onChange={onChange}
          onInput={onInput}
          disabled={disabled}
          required={required}
          className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
          {...args}
        />
        {label && (
          <span className="text-sm">
            {label}{required ? ' *' : ''}
          </span>
        )}
      </label>
      {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
    </div>
  );
}
