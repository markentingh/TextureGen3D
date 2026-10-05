import React, { useRef, useEffect, useCallback } from 'react';
import ModelViewer from '@/components/viewer/ModelViewer';
import { useProject } from '@/context/project';

export default function ViewportSection() {
  const { selectedMesh, viewerRef, pendingLayersRef, refreshLayerTextures, maskPaintConfigRef, setUnlit, syncAuxMeshes, saveLightPosition } = useProject();
  const refreshRef = useRef(refreshLayerTextures);
  useEffect(() => { refreshRef.current = refreshLayerTextures; }, [refreshLayerTextures]);
  const auxSyncRef = useRef(syncAuxMeshes);
  useEffect(() => { auxSyncRef.current = syncAuxMeshes; }, [syncAuxMeshes]);

  // Stable identity — an inline arrow would defeat ModelViewer's memo() and
  // re-render the canvas on every unrelated context state change.
  const handleMeshLoaded = useCallback((meshMeta) => {
    if (pendingLayersRef.current) {
      refreshRef.current(pendingLayersRef.current, meshMeta?.key);
    }
    // loadMesh keeps aux objects across a selection change — reconcile:
    // drop auxes outside the new set, reposition the rest, load new ones.
    auxSyncRef.current?.();
  }, [pendingLayersRef]);

  return (
    <div className="absolute top-0 left-0 bottom-0 right-72">
      <ModelViewer
        ref={viewerRef}
        selectedMesh={selectedMesh}
        maskPaintConfig={maskPaintConfigRef}
        onMeshLoaded={handleMeshLoaded}
        onUnlitChange={setUnlit}
        onLightDragEnd={saveLightPosition}
      />
    </div>
  );
}
