import React from 'react';

const MouseRotateIcon = (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="7" y="2" width="10" height="20" rx="5" />
    <rect x="10.5" y="2" width="3" height="6" rx="1.5" fill="currentColor" stroke="none" />
  </svg>
);
const MousePanIcon = (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="7" y="2" width="10" height="20" rx="5" />
    <rect x="13.5" y="2" width="3" height="6" rx="1.5" fill="currentColor" stroke="none" />
  </svg>
);
const MouseZoomIcon = (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="7" y="2" width="10" height="20" rx="5" />
    <rect x="10.5" y="2" width="3" height="6" rx="1.5" fill="currentColor" stroke="none" />
    <path d="M12 11v6" strokeLinecap="round" />
    <path d="M9 14l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const MouseHint = React.memo(function MouseHint({ icon, label, title }) {
  return (
    <div
      title={title}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-charcoal-700/85 backdrop-blur-sm border-2 border-gray-300/60 text-charcoal-100 text-xs font-medium shadow-lg cursor-help"
    >
      <span className="text-gray-300">{icon}</span>
      <span>{label}</span>
    </div>
  );
});

export default function MouseHints() {
  return (
    <div className="absolute bottom-4 z-20 flex gap-2 right-80">
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
  );
}
