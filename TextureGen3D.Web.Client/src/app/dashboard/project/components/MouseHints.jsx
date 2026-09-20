import React from 'react';
import { useProject } from '@/context/project';

const MouseRotateIcon = (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="7" y="3.5" width="10" height="17" rx="5" />
    <rect x="10.5" y="4" width="3" height="5" rx="1.5" fill="currentColor" stroke="none" />
  </svg>
);
const MousePanIcon = (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="7" y="3.5" width="10" height="17" rx="5" />
    <rect x="13.5" y="4" width="3" height="5" rx="1.5" fill="currentColor" stroke="none" />
  </svg>
);
const MouseZoomIcon = (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="7" y="3.5" width="10" height="17" rx="5" />
    <rect x="10.5" y="4" width="3" height="5" rx="1.5" fill="currentColor" stroke="none" />
    <path d="M12 10v6" strokeLinecap="round" />
    <path d="M9 13l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Keyboard-key icon showing CTRL as an actual key cap
const CtrlKeyIcon = (
  <svg viewBox="0 0 32 24" className="w-8 h-6" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="1" y="1" width="30" height="22" rx="4" />
    <text x="16" y="16.5" textAnchor="middle" fontSize="9" fontFamily="sans-serif" fill="currentColor" stroke="none">CTRL</text>
  </svg>
);

const MouseHint = React.memo(function MouseHint({ icon, label, title, accent }) {
  return (
    <div
      title={title}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full backdrop-blur-sm border-2 text-charcoal-100 text-xs font-medium shadow-lg cursor-help ${
        accent ? 'bg-green-700/60 border-green-400/70' : 'bg-charcoal-700/85 border-gray-300/60'
      }`}
    >
      <span className="text-gray-300 flex items-center gap-1">{icon}</span>
      <span>{label}</span>
    </div>
  );
});

export default function MouseHints() {
  const { maskTool } = useProject();
  const paintTool = maskTool === 'brush' || maskTool === 'eraser' || maskTool === 'inpaint';

  return (
    <div className="absolute bottom-4 z-20 flex flex-col items-end gap-2 right-80">
      {paintTool && (
        <div className="flex gap-2">
          <MouseHint
            accent
            icon={<>{CtrlKeyIcon}<span>+</span>{MouseZoomIcon}</>}
            label="Brush Size"
            title="Hold Ctrl and scroll the middle mouse wheel up for a larger brush, down for smaller"
          />
          {maskTool === 'inpaint' && (
            <MouseHint
              accent
              icon={CtrlKeyIcon}
              label="Invert Draw"
              title="Hold Ctrl to temporarily invert the +/− draw mode while painting"
            />
          )}
        </div>
      )}
      <div className="flex gap-2">
        <MouseHint
          icon={MouseRotateIcon}
          label="Press & Rotate"
          title="Press and hold the middle mouse button, then drag to rotate the view"
        />
        <MouseHint
          icon={MousePanIcon}
          label="Press & Drag"
          title="Press and hold the right mouse button (or Shift + middle mouse button), then drag to pan the view"
        />
        <MouseHint
          icon={MouseZoomIcon}
          label="Scroll & Zoom"
          title="Scroll the middle mouse wheel up to zoom in, down to zoom out"
        />
      </div>
    </div>
  );
}
