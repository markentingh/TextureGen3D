import React from 'react';
import { Link } from 'react-router-dom';

export default function ButtonOutline({ to, children, onClick, disabled, color, size, type = 'button', className = '' }) {
  const colorClasses = color === 'green'
    ? 'border-green-600 text-green-600 hover:bg-green-600/10 hover:border-green-500 hover:text-green-500 dark:text-green-500 dark:hover:bg-green-500/10 dark:hover:border-green-400 dark:hover:text-green-400'
    : color === 'red'
    ? 'border-red-600 text-red-600 hover:bg-red-500/10 hover:border-red-500 hover:text-red-500 dark:text-red-500 dark:hover:bg-[#ff00002e] dark:hover:border-[#f00] dark:hover:text-[#ff4b4b]'
    : color === 'gray'
    ? 'border-gray-500 text-gray-500 hover:bg-gray-500/10 hover:border-gray-400 hover:text-gray-400 dark:text-gray-400 dark:hover:bg-[#9ca3af42] dark:hover:border-[#b5b5b5] dark:hover:text-gray-300'
    : color === 'purple'
    ? 'border-purple-600 text-purple-600 hover:bg-purple-600/10 hover:border-purple-500 hover:text-purple-500 dark:text-purple-400 dark:hover:bg-purple-500/10 dark:hover:border-purple-400 dark:hover:text-purple-300'
    : 'border-blue-600 text-blue-600 hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500 dark:text-[#5b9aff] dark:hover:bg-[#0051ff4a] dark:hover:border-[#3776ff] dark:hover:text-[#8db1ff]';
  const sizeClasses = size === 'small'
    ? 'py-1 px-2 text-xs gap-1'
    : 'py-2 px-4';
  const classes = `inline-flex items-center justify-center text-center border rounded transition ${colorClasses} ${sizeClasses} ${className}`;

  if (to) {
    return (
      <Link to={to} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} onClick={onClick} disabled={disabled} className={classes}>
      {children}
    </button>
  );
}
