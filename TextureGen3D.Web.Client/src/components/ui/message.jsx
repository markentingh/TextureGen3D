import React from 'react';
import Icon from './icon';

const icons = {
  info: 'info',
  warning: 'warning',
  error: 'error'
};

const styles = {
  info: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-800',
  warning: 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-200 dark:border-yellow-800',
  error: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-200 dark:border-red-800'
};

export default function Message({ type = 'info', children, onClose }) {
  if (!children) return null;

  return (
    <div className={`mb-4 p-3 rounded border flex items-start gap-3 ${styles[type]}`}>
      <Icon name={icons[type]} className="flex-shrink-0" />
      <div className="flex-1 text-sm">{children}</div>
      <button
        type="button"
        onClick={onClose}
        className="flex-shrink-0 flex items-center justify-center p-0 mt-[0.05em] hover:opacity-70 focus:outline-none"
        aria-label="Close message"
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
