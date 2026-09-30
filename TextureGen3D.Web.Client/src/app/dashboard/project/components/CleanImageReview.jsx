import React, { useState } from 'react';
import { useProject } from '@/context/project';
import Spinner from '@/components/ui/spinner';

/**
 * CleanImageReview — small floating card shown right above the MaskToolbar
 * after "Clean Image" runs. Not a real modal: no overlay, so the rest of the
 * project page stays interactive while it's open.
 *
 *   Accept — keep the cleaned uvmap.png, dismiss.
 *   Revert — restore uvmap.png from the uvmap_old.png backup the server saved
 *            (the backup is deleted server-side), then dismiss.
 */
export default function CleanImageReview() {
  const {
    cleanImageReview,
    setCleanImageReview,
    layerApi,
    id,
    viewerRef,
    refreshLayerTextures,
    invalidateLayerAssets,
    setLayerThumbVersion,
  } = useProject();
  const [reverting, setReverting] = useState(false);

  if (!cleanImageReview) return null;

  const revert = async () => {
    if (reverting) return;
    setReverting(true);
    try {
      const res = await layerApi.revertImage(id, cleanImageReview.layerId, cleanImageReview.meshDbId);
      if (!res.data?.success) throw new Error(res.data?.message || 'Revert failed');
      viewerRef.current?.invalidateStampCanvas?.(cleanImageReview.layerId);
      invalidateLayerAssets(cleanImageReview.layerId); // uvmap.png restored from backup
      setLayerThumbVersion((v) => v + 1); // reload uvmap-thumb <img>
      await refreshLayerTextures();
      setCleanImageReview(null);
    } catch (err) {
      console.error('Revert clean image failed:', err);
    } finally {
      setReverting(false);
    }
  };

  return (
    <div className="w-56 rounded-xl bg-charcoal-700/85 backdrop-blur-sm border-2 border-gray-300/60 shadow-lg px-3 py-2">
      <p className="text-xs text-gray-200 mb-2">Do you like the cleaned image results?</p>
      <div className="flex gap-2">
        <button
          onClick={() => setCleanImageReview(null)}
          disabled={reverting}
          className="flex-1 text-xs py-1 rounded-lg border-2 border-green-500 text-green-400 hover:bg-green-500/10 transition disabled:opacity-50"
        >
          Accept
        </button>
        <button
          onClick={revert}
          disabled={reverting}
          className="flex-1 text-xs py-1 rounded-lg border-2 border-red-500 text-red-400 hover:bg-red-500/10 transition disabled:opacity-50 flex items-center justify-center gap-1"
        >
          {reverting && <Spinner className="!text-[12px] !leading-[12px]" />}
          Revert
        </button>
      </div>
    </div>
  );
}
