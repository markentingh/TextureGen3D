import React, { useEffect, useState } from 'react';

const loadImg = (src) =>
  new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });

/**
 * MaskedUvmapThumb — renders a layer's uvmap thumbnail with its mask baked
 * into the alpha channel (white = visible), matching the layer shader's
 * semantics. Prefers the live mask render target (unsaved strokes) and falls
 * back to the saved mask_thumb.png.
 *
 * Everything comes in via props — this renders inside ModalProvider content,
 * which sits outside ProjectProvider (no useProject available).
 */
export default function MaskedUvmapThumb({ layerId, uvmapUrl, maskUrl, size = 100, token, layerMasksRef, viewerRef }) {
  const [thumbUrl, setThumbUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setThumbUrl(null);
    if (!uvmapUrl) return;

    (async () => {
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const fetchImg = async (url) => {
          const res = await fetch(url, { headers });
          if (!res.ok) return null;
          const blob = await res.blob();
          if (!blob.size) return null;
          return loadImg(URL.createObjectURL(blob));
        };

        const uvImg = await fetchImg(uvmapUrl);
        if (!uvImg || cancelled) return;

        // Live mask RT first (includes unsaved brush strokes), else the
        // saved mask thumbnail
        let maskImg = null;
        const entry = layerMasksRef?.current?.get(layerId);
        if (entry?.initialized) {
          const dataUrl = viewerRef.current?.maskToDataURL?.(entry);
          if (dataUrl) maskImg = await loadImg(dataUrl).catch(() => null);
        }
        if (!maskImg && maskUrl) maskImg = await fetchImg(maskUrl);

        const w = uvImg.width;
        const h = uvImg.height;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(uvImg, 0, 0);

        let md = null;
        if (maskImg) {
          const mc = document.createElement('canvas');
          mc.width = w;
          mc.height = h;
          const mctx = mc.getContext('2d');
          mctx.drawImage(maskImg, 0, 0, w, h);
          md = mctx.getImageData(0, 0, w, h).data;
        }

        const imgData = ctx.getImageData(0, 0, w, h);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          if (r * r + g * g + b * b < 7) {
            d[i + 3] = 0; // near-black = empty, matches the shader's contentMask
          } else if (md) {
            d[i + 3] = Math.round((d[i + 3] * md[i]) / 255); // alpha *= mask.r
          }
        }
        ctx.putImageData(imgData, 0, 0);

        if (!cancelled) setThumbUrl(canvas.toDataURL('image/png'));
      } catch {
        /* missing uvmap/mask or fetch failed — leave the thumb empty */
      }
    })();

    return () => { cancelled = true; };
  }, [uvmapUrl, maskUrl, layerId, token, layerMasksRef, viewerRef]);

  return (
    <div
      className="w-full h-full"
      style={{
        // Checkerboard so masked-out areas read as transparent
        backgroundColor: '#9ca3af',
        backgroundImage:
          'linear-gradient(45deg, #6b7280 25%, transparent 25%),' +
          'linear-gradient(-45deg, #6b7280 25%, transparent 25%),' +
          'linear-gradient(45deg, transparent 75%, #6b7280 75%),' +
          'linear-gradient(-45deg, transparent 75%, #6b7280 75%)',
        backgroundSize: '8px 8px',
        backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px',
      }}
    >
      {thumbUrl && (
        <img
          src={thumbUrl}
          alt="Layer"
          width={size}
          height={size}
          className="w-full h-full object-cover"
        />
      )}
    </div>
  );
}
