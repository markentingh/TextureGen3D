import React, { useState, useRef, useEffect, useCallback } from 'react';
import Icon from '@/components/ui/icon';

export default function CarouselElements({ elements, gap = 16, className = '' }) {
  const containerRef = useRef(null);
  const trackRef = useRef(null);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState([]);

  const computePages = useCallback(() => {
    if (!containerRef.current || !trackRef.current) return;
    const containerWidth = containerRef.current.clientWidth;
    const children = Array.from(trackRef.current.children);
    if (children.length === 0) return;

    const itemWidths = children.map(child => child.offsetWidth);
    const pageBreaks = [];
    let currentStart = 0;
    let currentWidth = 0;

    for (let i = 0; i < children.length; i++) {
      const w = itemWidths[i] + (i > currentStart ? gap : 0);
      if (currentWidth + w > containerWidth && i > currentStart) {
        pageBreaks.push({
          start: currentStart,
          end: i,
          offset: itemWidths.slice(currentStart, i).reduce((sum, x) => sum + x + gap, 0) - gap,
        });
        currentStart = i;
        currentWidth = itemWidths[i];
      } else {
        currentWidth += w;
      }
    }
    pageBreaks.push({
      start: currentStart,
      end: children.length,
      offset: itemWidths.slice(currentStart).reduce((sum, x) => sum + x + gap, 0) - gap,
    });
    setPages(pageBreaks);
  }, [gap]);

  useEffect(() => {
    computePages();
    window.addEventListener('resize', computePages);
    return () => window.removeEventListener('resize', computePages);
  }, [elements, computePages]);

  const totalPages = pages.length;
  const currentPage = Math.min(page, Math.max(0, totalPages - 1));
  const slideOffset = currentPage > 0
    ? pages.slice(0, currentPage).reduce((sum, p) => sum + p.offset + gap, 0)
    : 0;

  const handlePrev = useCallback(() => {
    setPage((prev) => Math.max(0, prev - 1));
  }, []);

  const handleNext = useCallback(() => {
    setPage((prev) => Math.min(totalPages - 1, prev + 1));
  }, [totalPages]);

  const handleDotClick = useCallback((p) => {
    setPage(p);
  }, []);

  if (elements.length === 0) return null;

  return (
    <div className={className}>
      <div ref={containerRef} className="overflow-hidden">
        <div
          ref={trackRef}
          className="flex transition-transform duration-300 ease-in-out min-w-full justify-start"
          style={{ transform: `translateX(-${slideOffset}px)`, gap: `${gap}px` }}
        >
          {elements.map((el, i) => (
            <div key={i} className="flex-shrink-0">
              {el}
            </div>
          ))}
        </div>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-4">
          <button
            type="button"
            onClick={handlePrev}
            disabled={currentPage === 0}
            className="flex items-center justify-center w-8 h-8 rounded-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-primary-500 hover:text-primary-500 hover:scale-110 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
            title="Previous"
          >
            <Icon name="chevron_left" className="text-xl" />
          </button>
          <div className="flex items-center gap-2">
            {Array.from({ length: totalPages }, (_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleDotClick(i)}
                className={`w-2.5 h-2.5 rounded-full transition-all duration-150 hover:scale-125 ${
                  i === currentPage
                    ? 'bg-primary-500'
                    : 'bg-gray-300 dark:bg-gray-600 hover:bg-primary-400'
                }`}
                title={`Page ${i + 1}`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={handleNext}
            disabled={currentPage >= totalPages - 1}
            className="flex items-center justify-center w-8 h-8 rounded-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-primary-500 hover:text-primary-500 hover:scale-110 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
            title="Next"
          >
            <Icon name="chevron_right" className="text-xl" />
          </button>
        </div>
      )}
    </div>
  );
}
