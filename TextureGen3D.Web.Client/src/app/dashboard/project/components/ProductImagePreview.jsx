import React, { useMemo } from 'react';
import Modal from '@/components/ui/modal';
import Carousel from '@/components/ui/carousel';

function cacheBustUrl(url) {
  if (!url) return url;
  const u = new URL(url, window.location.href);
  u.searchParams.set('r', Math.floor(Math.random() * 100000).toString());
  return u.toString();
}

export default function ProductImagePreview({ show, images = [], alt, defaultIndex = 0, onClose }) {
  if (!show || images.length === 0) return null;

  const bustedImages = useMemo(() => images.map(cacheBustUrl), [images]);

  return (
    <Modal title={alt || 'Product Image'} onClose={onClose} className="max-w-none w-[95vw]" noMaxHeight>
      <Carousel images={bustedImages} alt={alt} singleImage defaultIndex={defaultIndex} infiniteScroll={true} imageClassName="!max-h-none w-auto max-w-full h-auto max-h-[80vh] object-contain" />
    </Modal>
  );
}
