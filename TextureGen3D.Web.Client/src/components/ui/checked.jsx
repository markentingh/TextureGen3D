import React from 'react';
import Icon from '@/components/ui/icon';

export default function Checked({ checked }) {
  return (
    <div
      className={`inline-flex items-center justify-center rounded-full border-2 w-8 h-8 ${
        checked ? 'border-green-500 text-green-500' : 'border-gray-300'
      }`}
      aria-label={checked ? 'Completed' : 'Not completed'}
    >
      {checked && (
        <Icon
          name="check"
          className="text-green-500"
          style={{ fontSize: '1.25em' }}
        />
      )}
    </div>
  );
}
