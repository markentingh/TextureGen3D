import React, { useEffect, useState } from 'react';
import { useProject } from '@/context/project';

/** CSS checkerboard used behind thumbnails that carry an alpha channel. */
export const CHECKERBOARD_BG = {
  backgroundColor: '#9ca3af',
  backgroundImage:
    'linear-gradient(45deg, #6b7280 25%, transparent 25%),' +
    'linear-gradient(-45deg, #6b7280 25%, transparent 25%),' +
    'linear-gradient(45deg, transparent 75%, #6b7280 75%),' +
    'linear-gradient(-45deg, transparent 75%, #6b7280 75%)',
  backgroundSize: '8px 8px',
  backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px',
};

/**
 * MaskThumb — renders a layer's mask thumbnail as white strokes on
 * transparency: the mask's luminance becomes the alpha channel of a white
 * image, so painted/visible areas show white and hidden areas let the
 * checkerboard background show through.
 */
export default function MaskThumb({ url, version = 0, size = 47, onClick }) {
  const { token } = useProject();
  const [thumbUrl, setThumbUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setThumbUrl(null);
    if (!url) return;

    (async () => {
      try {
        const res = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const blob = await res.blob();
        if (blob.size === 0) return;
        const bitmap = await createImageBitmap(blob);

        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();

        // White image; alpha = mask luminance (white = visible → opaque)
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          const maskValue = d[i]; // grayscale mask — r == g == b
          d[i] = 255;
          d[i + 1] = 255;
          d[i + 2] = 255;
          d[i + 3] = maskValue;
        }
        ctx.putImageData(imgData, 0, 0);

        if (!cancelled) setThumbUrl(canvas.toDataURL('image/png'));
      } catch {
        /* no mask or fetch failed — leave the thumb empty */
      }
    })();

    return () => { cancelled = true; };
  }, [url, version, token]);

  return (
    <div
      className={`flex-shrink-0 rounded border border-gray-200 dark:border-gray-600 overflow-hidden${onClick ? ' cursor-pointer hover:ring-1 hover:ring-purple-500 transition' : ''}`}
      onClick={onClick}
      title={onClick ? 'Click: load this mask into the inpaint tool — Ctrl+click: add to the inpaint mask' : undefined}
      style={{
        width: size,
        height: size,
        // Checkerboard so the transparent (unpainted) areas are visible
        ...CHECKERBOARD_BG,
      }}
    >
      {thumbUrl && (
        <img
          src={thumbUrl}
          alt="Mask"
          draggable={false}
          className="w-full h-full object-cover"
        />
      )}
    </div>
  );
}
