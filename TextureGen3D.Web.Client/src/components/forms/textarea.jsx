import React, { useRef, useEffect, useState } from 'react';

export default function TextArea({
  label,
  name,
  value,
  defaultValue,
  rows = 3,
  placeholder,
  required = false,
  error,
  note,
  maxLength,
  onChange,
  onInput,
  autoResize = false,
  disabled = false,
  className = '',
  ...args
}) {
  const ref = useRef(null);
  const [mounted, setMounted] = useState(false);

  const handleResize = () => {
    if (autoResize && ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = `${ref.current.scrollHeight + 20}px`;
    }
  };

  const handleInput = (e) => {
    if (onInput) onInput(e);
    handleResize();
  };

  const handleChange = (e) => {
    if (onChange) onChange(e);
    handleResize();
  };

  useEffect(() => {
    if (mounted) {
      handleResize();
    } else {
      setMounted(true);
    }
  }, [mounted]);

  return (
    <div className={`mb-4 ${className}`}>
      {label && (
        <label htmlFor={name} className="block text-sm font-medium mb-1">
          {label}{required ? ' *' : ''}
        </label>
      )}
      <textarea
        id={name}
        name={name}
        ref={ref}
        rows={rows}
        value={value}
        defaultValue={defaultValue}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        required={required}
        onChange={handleChange}
        onInput={handleInput}
        className={`w-full px-3 py-2 border rounded bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y ${
          error
            ? 'border-red-500 focus:ring-red-500'
            : 'border-gray-300 dark:border-gray-600'
        }`}
        {...args}
      />
      {note && <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">{note}</p>}
      {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
    </div>
  );
}
