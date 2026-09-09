import React, { useState, useEffect, useRef } from 'react';
import Icon from '@/components/ui/icon';

export default function Modal({ title, children, onClose, top = false, className }) {
  const innerRef = useRef(null);
  const [maxHeight, setMaxHeight] = useState(null);

  useEffect(() => {
    const updateHeight = () => {
      if (innerRef.current) {
        const rect = innerRef.current.getBoundingClientRect();
        const effectiveTop = Math.max(rect.top, 10);
        const available = window.innerHeight - effectiveTop - 10;
        setMaxHeight(available > 0 ? available : null);
      }
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    const observer = new ResizeObserver(updateHeight);
    if (innerRef.current) observer.observe(innerRef.current);
    return () => {
      window.removeEventListener('resize', updateHeight);
      observer.disconnect();
    };
  }, []);

  const handleBackdropMouseDown = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className={
        top
          ? 'fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[6em] pb-4'
          : 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'
      }
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        ref={innerRef}
        className={
          className
            ? `rounded-lg bg-white dark:bg-gray-800 shadow-xl ${className}`
            : 'w-full max-w-lg rounded-lg bg-white dark:bg-gray-800 shadow-xl'
        }
        style={maxHeight ? { maxHeight: `${maxHeight}px`, overflowY: 'auto' } : undefined}
      >
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <h2 className="text-xl font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            aria-label="Close"
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  );
}
