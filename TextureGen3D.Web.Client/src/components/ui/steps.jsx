import React from 'react';

export default function Steps({ steps, current, currentIndex, maxIndex, onStepClick }) {
  const effectiveMax = maxIndex ?? currentIndex;
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {steps.map((label, index) => {
        const isActive = index === currentIndex;
        const isComplete = index <= effectiveMax && !isActive;
        const isClickable = onStepClick && isComplete;
        return (
          <div key={index} className="flex items-center">
            {index > 0 && (
              <div className={`w-6 h-0.5 ${index <= effectiveMax ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
            )}
            <div
              className={`flex items-center justify-center rounded-full transition-all ${
                isActive
                  ? 'w-8 h-8 border-2 border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                  : isComplete
                    ? 'w-3 h-3 bg-blue-500'
                    : 'w-3 h-3 bg-gray-300 dark:bg-gray-600'
              } ${isClickable ? 'cursor-pointer hover:scale-125' : ''}`}
              title={label}
              onClick={isClickable ? () => onStepClick(index) : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}
