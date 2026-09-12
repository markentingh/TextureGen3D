import React, { useState, useRef, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { ProjectReferences } from '@/api/user/projectReferences';

const ReferenceCell = memo(function ReferenceCell({ ref_, projectId, token, onToggleActive, onDelete, onNewImage, onEditImage }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const menuRef = useRef(null);
  const thumbUrl = ProjectReferences({ token }).thumbUrl(projectId, ref_.id);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <div
      className="relative rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 group"
      style={{ width: 90, height: 80 }}
    >
      <img
        src={thumbUrl}
        alt={ref_.filename}
        className="w-full h-full object-cover"
        draggable={false}
      />

      {/* Checkbox top-left */}
      <input
        type="checkbox"
        checked={ref_.active}
        onChange={onToggleActive}
        className="absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer bg-white/80"
        title={ref_.active ? 'Active' : 'Inactive'}
      />

      {/* 3-dot menu top-right */}
      <div className="absolute top-0.5 right-0.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (menuOpen) {
              setMenuOpen(false);
            } else {
              const rect = e.currentTarget.getBoundingClientRect();
              // Right-align the 112px (w-28) menu with the button's right edge
              const left = Math.max(4, rect.right - 112);
              setMenuPos({ top: rect.bottom + 2, left });
              setMenuOpen(true);
            }
          }}
          className="p-0.5 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition hover:bg-black/70"
          aria-label="Reference menu"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
          </svg>
        </button>
      </div>

      {/* Delete icon bottom-right (hover only) */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="absolute bottom-0.5 right-0.5 p-0.5 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition hover:bg-red-600"
        aria-label="Delete reference"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Dropdown menu rendered via portal at document.body level (escapes all overflow/transform containers) */}
      {menuOpen && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 w-28 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg py-1"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onNewImage(); }}
            className="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
          >
            New Image
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onEditImage(); }}
            className="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
          >
            Edit Image
          </button>
        </div>,
        document.body
      )}
    </div>
  );
});

export default ReferenceCell;
