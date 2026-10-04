import React from 'react';
import { useProject } from '@/context/project';
import Icon from '@/components/ui/icon';

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

// Keyboard-key icon showing ALT as an actual key cap
const AltKeyIcon = (
  <svg viewBox="0 0 32 24" className="w-8 h-6" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="1" y="1" width="30" height="22" rx="4" />
    <text x="16" y="16.5" textAnchor="middle" fontSize="10" fontFamily="sans-serif" fill="currentColor" stroke="none">ALT</text>
  </svg>
);

const MouseHint = React.memo(function MouseHint({ icon, label, title, accent }) {
  return (
    <div
      title={title}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full backdrop-blur-sm border-2 text-charcoal-100 text-xs font-medium shadow-lg cursor-help ${
        accent === 'blue'
          ? 'bg-blue-700/60 border-blue-400/70'
          : accent
            ? 'bg-green-700/60 border-green-400/70'
            : 'bg-charcoal-700/85 border-gray-300/60'
      }`}
    >
      <span className="text-gray-300 flex items-center gap-1">{icon}</span>
      <span>{label}</span>
    </div>
  );
});

export default function MouseHints() {
  const { maskTool, stampMode } = useProject();
  const paintTool = maskTool === 'brush' || maskTool === 'eraser' || maskTool === 'mask' || maskTool === 'inpaint' || maskTool === 'stamp' || maskTool === 'blur';
  // Touch-capable devices (incl. touchscreen laptops/desktops and pen
  // displays like Samsung Second Screen) get a blue gesture-hints row in
  // addition to the mouse hints. Passive checks catch advertised hardware;
  // pen displays often report nothing, so the first real pen/touch pointer
  // event flips it on too.
  const [isTouch, setIsTouch] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    return 'ontouchstart' in window
      || navigator.maxTouchPoints > 0
      || window.matchMedia?.('(any-pointer: coarse)').matches
      || window.matchMedia?.('(any-hover: none)').matches;
  });
  React.useEffect(() => {
    if (isTouch) return;
    const onPointer = (e) => {
      if (e.pointerType === 'pen' || e.pointerType === 'touch') setIsTouch(true);
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('pointermove', onPointer, true);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('pointermove', onPointer, true);
    };
  }, [isTouch]);

  return (
    // flex-1 + min-w-0 takes the column left over by the tools container —
    // rows wrap inside it and can never reach into the tools' space.
    <div className="flex flex-col items-end gap-2 flex-1 min-w-0">
      {paintTool && (
        <div className="flex w-full flex-wrap justify-end gap-2">
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
          {maskTool === 'mask' && (
            <MouseHint
              accent
              icon={CtrlKeyIcon}
              label="Swap Brush/Eraser"
              title="Hold Ctrl to temporarily switch between the mask brush (reveal) and mask eraser (hide)"
            />
          )}
          {maskTool === 'brush' && (
            <MouseHint
              accent
              icon={AltKeyIcon}
              label="Eye Dropper"
              title="Hold Alt and click the mesh to sample the uvmap color under the cursor into the brush color"
            />
          )}
          {maskTool === 'stamp' && stampMode === 'draw' && (
            <MouseHint
              accent
              icon={AltKeyIcon}
              label="Copy Region"
              title="Hold Alt to temporarily switch to copy region — click the mesh to set the stamp source point"
            />
          )}
        </div>
      )}
      {isTouch && (
        <div className="flex w-full flex-wrap justify-end gap-2">
          <MouseHint
            accent="blue"
            icon={<Icon name="pinch" className="text-2xl" />}
            label="Zoom"
            title="Pinch two fingers together or apart to zoom in and out"
          />
          <MouseHint
            accent="blue"
            icon={<Icon name="touch_double_2" className="text-2xl" />}
            label="Rotate"
            title="Move two fingers together to rotate the view"
          />
          <MouseHint
            accent="blue"
            icon={<Icon name="trackpad_input_3" className="text-2xl" />}
            label="Move"
            title="Drag three fingers to move/pan the view"
          />
        </div>
      )}
      <div className="flex w-full flex-wrap justify-end gap-2">
        <MouseHint
          icon={MouseRotateIcon}
          label="Rotate"
          title="Press and hold the middle mouse button, then drag to rotate the view"
        />
        <MouseHint
          icon={MousePanIcon}
          label="Drag"
          title="Press and hold the right mouse button (or Shift + middle mouse button), then drag to pan the view"
        />
        <MouseHint
          icon={MouseZoomIcon}
          label="Zoom"
          title="Scroll the middle mouse wheel up to zoom in, down to zoom out"
        />
      </div>
    </div>
  );
}
