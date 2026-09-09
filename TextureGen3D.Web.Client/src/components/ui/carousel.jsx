import React, { useRef, useState, useCallback, useEffect } from 'react';
import ButtonIcon from '@/components/ui/button-icon';

export default function Carousel({ images = [], alt = '', onImageClick, onImageError, singleImage = false, defaultIndex = 0, infiniteScroll = false, placeholder = '', imageClassName = '', imageStyle = undefined, imageWidth = '8rem', imageHeight = '12rem', overlayRender, maxHeight = '70vh' }) {
  const scrollRef = useRef(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [singleIndex, setSingleIndex] = useState(defaultIndex);

  useEffect(() => {
    setSingleIndex(defaultIndex);
  }, [images, defaultIndex]);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setOverflowing(el.scrollWidth > el.clientWidth);
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    updateScrollState();
    window.addEventListener('resize', updateScrollState);
    return () => window.removeEventListener('resize', updateScrollState);
  }, [images, updateScrollState]);

  if (images.length === 0) {
    if (placeholder) {
      return (
        <div className={`flex items-center justify-center rounded-lg ${imageClassName}`}>
          <span className="text-sm text-gray-500 dark:text-gray-400">{placeholder}</span>
        </div>
      );
    }
    return null;
  }

  if (singleImage) {
    const showNav = images.length > 1;
    const handleSinglePrev = (e) => {
      e.stopPropagation();
      setSingleIndex((prev) => {
        if (prev === 0) return infiniteScroll ? images.length - 1 : 0;
        return prev - 1;
      });
    };
    const handleSingleNext = (e) => {
      e.stopPropagation();
      setSingleIndex((prev) => {
        if (prev === images.length - 1) return infiniteScroll ? 0 : images.length - 1;
        return prev + 1;
      });
    };
    const singleAtStart = !infiniteScroll && singleIndex === 0;
    const singleAtEnd = !infiniteScroll && singleIndex === images.length - 1;

    return (
      <div className={`${imageStyle ? 'absolute inset-0' : 'relative w-full h-full'} rounded-lg overflow-hidden`}>
        <div className="flex items-center justify-center w-full h-full">
          <img
            src={images[singleIndex]}
            alt={`${alt} ${singleIndex + 1}`}
            className={`max-w-full object-contain rounded-lg cursor-pointer ${imageClassName}`}
            style={{ maxHeight, ...imageStyle }}
            onClick={() => onImageClick?.(images[singleIndex], singleIndex)}
            onError={() => onImageError?.(singleIndex)}
          />
          {overlayRender?.(singleIndex)}
        </div>
        {showNav && (
          <>
            <div className="absolute inset-y-0 left-0 flex items-center pl-1">
              <ButtonIcon
                name="chevron_left"
                onClick={handleSinglePrev}
                title="Previous"
                className={`bg-white/80 dark:bg-gray-800/80 shadow-sm ${singleAtStart ? 'opacity-30 pointer-events-none' : ''}`}
              />
            </div>
            <div className="absolute inset-y-0 right-0 flex items-center pr-1">
              <ButtonIcon
                name="chevron_right"
                onClick={handleSingleNext}
                title="Next"
                className={`bg-white/80 dark:bg-gray-800/80 shadow-sm ${singleAtEnd ? 'opacity-30 pointer-events-none' : ''}`}
              />
            </div>
          </>
        )}
      </div>
    );
  }

  const handlePrev = (e) => {
    e.stopPropagation();
    const el = scrollRef.current;
    if (!el) return;
    if (infiniteScroll && el.scrollLeft <= 1) {
      el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' });
    } else {
      el.scrollBy({ left: -el.clientWidth * 1, behavior: 'smooth' });
    }
  };

  const handleNext = (e) => {
    e.stopPropagation();
    const el = scrollRef.current;
    if (!el) return;
    if (infiniteScroll && el.scrollLeft + el.clientWidth >= el.scrollWidth - 1) {
      el.scrollTo({ left: 0, behavior: 'smooth' });
    } else {
      el.scrollBy({ left: el.clientWidth * 1, behavior: 'smooth' });
    }
  };

  return (
    <div className="relative w-full rounded-lg">
      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        className="overflow-x-auto scroll-smooth rounded-lg"
        style={{ scrollbarWidth: 'none' }}
      >
        <div
          className={overflowing ? 'flex justify-start' : 'flex justify-center'}
          style={{ gap: '1em' }}
        >
          {images.map((src, i) => (
            <div key={i} className="relative flex-shrink-0" style={{ width: imageWidth, height: imageHeight }}>
              <img
                src={src}
                alt={`${alt} ${i + 1}`}
                className={`object-contain cursor-pointer ${imageClassName}`}
                style={{ width: '100%', height: '100%' }}
                onLoad={updateScrollState}
                onClick={() => onImageClick?.(src, i)}
                onError={() => onImageError?.(i)}
              />
              {overlayRender?.(i)}
            </div>
          ))}
        </div>
      </div>
      {overflowing && images.length > 1 && (
        <>
          <div className="absolute inset-y-0 left-0 flex items-center pl-1">
            <ButtonIcon
              name="chevron_left"
              onClick={handlePrev}
              title="Previous"
              className={`bg-white/80 dark:bg-gray-800/80 shadow-sm ${!infiniteScroll && atStart ? 'opacity-30 pointer-events-none' : ''}`}
            />
          </div>
          <div className="absolute inset-y-0 right-0 flex items-center pr-1">
            <ButtonIcon
              name="chevron_right"
              onClick={handleNext}
              title="Next"
              className={`bg-white/80 dark:bg-gray-800/80 shadow-sm ${!infiniteScroll && atEnd ? 'opacity-30 pointer-events-none' : ''}`}
            />
          </div>
        </>
      )}
    </div>
  );
}
