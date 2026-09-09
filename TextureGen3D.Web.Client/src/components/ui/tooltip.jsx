import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import ButtonIcon from '@/components/ui/button-icon';

export default function Tooltip({ text, className = '', marginTop = 4 }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ placement: 'bottom', left: 0, top: 0, shiftX: 0 });
  const ref = useRef(null);
  const bubbleRef = useRef(null);

  useEffect(() => {
    if (!show) return;
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setShow(false);
      }
    };
    const handleScroll = () => setShow(false);
    const handleResize = () => setShow(false);
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [show]);

  useLayoutEffect(() => {
    if (!show || !ref.current || !bubbleRef.current) return;

    const iconEl = ref.current.querySelector('button');
    const iconRect = iconEl ? iconEl.getBoundingClientRect() : ref.current.getBoundingClientRect();
    const bubbleRect = bubbleRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 8;
    const gap = 8;

    let placement = 'bottom';
    if (iconRect.bottom + bubbleRect.height + gap + margin > viewportHeight) {
      placement = 'top';
    }

    const iconCenterX = iconRect.left + iconRect.width / 2;
    let leftPx = iconCenterX;
    const halfWidth = bubbleRect.width / 2;
    if (leftPx - halfWidth < margin) {
      leftPx = halfWidth + margin;
    } else if (leftPx + halfWidth > viewportWidth - margin) {
      leftPx = viewportWidth - halfWidth - margin;
    }

    const topPx = placement === 'bottom' ? iconRect.bottom + gap : iconRect.top - gap - bubbleRect.height;
    const shiftX = leftPx - iconCenterX;

    setPos({ placement, left: leftPx, top: topPx, shiftX });
  }, [show, text]);

  const arrowUp = 'border-l-8 border-r-8 border-b-8 border-l-transparent border-r-transparent border-b-primary-600';
  const arrowUpInner = 'border-l-8 border-r-8 border-b-8 border-l-transparent border-r-transparent border-b-primary-600';
  const arrowDown = 'border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-primary-600';
  const arrowDownInner = 'border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-primary-600';

  return (
    <div ref={ref} className={`relative inline-flex ${className}`} style={{ marginTop: `${marginTop}px` }}>
      <ButtonIcon
        name="help"
        onClick={() => setShow(s => !s)}
        title="More info"
      />
      {show && createPortal(
        <div
          ref={bubbleRef}
          className="fixed z-[60] w-72"
          style={{
            left: `${pos.left}px`,
            top: `${pos.top}px`,
            transform: 'translateX(-50%)',
          }}
        >
          <div className="relative bg-primary-600 border border-primary-600 rounded-lg shadow-lg p-3 text-sm text-white">
            {pos.placement === 'bottom' ? (
              <>
                <div className={`absolute -top-2 w-0 h-0 ${arrowUp}`} style={{ left: `calc(50% - ${pos.shiftX}px)`, transform: 'translateX(-50%)' }} />
                <div className={`absolute -top-[7px] w-0 h-0 ${arrowUpInner}`} style={{ left: `calc(50% - ${pos.shiftX}px)`, transform: 'translateX(-50%)' }} />
              </>
            ) : (
              <>
                <div className={`absolute -bottom-2 w-0 h-0 ${arrowDown}`} style={{ left: `calc(50% - ${pos.shiftX}px)`, transform: 'translateX(-50%)' }} />
                <div className={`absolute -bottom-[7px] w-0 h-0 ${arrowDownInner}`} style={{ left: `calc(50% - ${pos.shiftX}px)`, transform: 'translateX(-50%)' }} />
              </>
            )}
            {text}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
